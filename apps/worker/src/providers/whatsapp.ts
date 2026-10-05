import type { JobEnvelope, ProviderAttempt, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { providerAttemptCorrelationMetadata } from "./correlation.js";
import { providerAttemptSchema } from "@garanti-kulucka/shared";
import type { ProviderAccountConfig } from "./account-config.js";
import { failureCode, failureMessage, fetchLiveHttpTransport } from "./live-http.js";
import {
  hasMetaGraphError,
  isMetaRateLimitError,
  isMetaTokenError,
  isRecord,
  metaGraphResponseMetadata,
  parseMetaJson,
  payloadString,
  redactMetaHeaders,
  stringSetting,
  stringToken,
  stringValue,
} from "./meta-graph.js";
import { decideProviderRetry, type ProviderRetryDecision } from "./retry.js";
import type { ProviderMediaFile, ProviderMediaFileResolver } from "./media-files.js";
import type { LiveProviderTransportPolicy } from "./transport-policy.js";

export interface WhatsappTransportResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface WhatsappMultipartBody {
  file: {
    field: "file";
    filename: string;
    mime_type: string;
    bytes: Uint8Array;
  };
  fields: Array<[name: string, value: string]>;
}

export interface WhatsappTransportRequest {
  method: "POST";
  url: string;
  headers: Record<string, string>;
  body: string;
  timeout_ms: number;
  whatsapp_endpoint: "messages" | "media";
  multipart?: WhatsappMultipartBody;
}

export type WhatsappFetchTransport = (request: WhatsappTransportRequest) => Promise<WhatsappTransportResponse>;

export interface WhatsappLiveAdapterInput {
  envelope: ProviderRequestEnvelope;
  job: JobEnvelope;
  accountConfig: ProviderAccountConfig;
  policy: LiveProviderTransportPolicy;
  attemptNumber: number;
  maxAttempts: number;
  transport?: WhatsappFetchTransport;
  mediaFileResolver?: ProviderMediaFileResolver;
  now?: Date;
}

export interface WhatsappLiveAdapterResult {
  attempt: ProviderAttempt;
  response_payload: Record<string, unknown>;
}

export class WhatsappLiveTransportError extends Error {
  constructor(
    message: string,
    readonly attempt: ProviderAttempt,
  ) {
    super(message);
    this.name = "WhatsappLiveTransportError";
  }
}

const defaultWhatsappApiUrl = "https://graph.facebook.com/v26.0";
const mediaTypes = new Set(["image", "video", "audio", "document"]);

function apiBaseUrl(settings: Record<string, unknown>): string {
  return stringSetting(settings, ["api_url", "whatsapp.api_url", "WHATSAPP_API_URL"], defaultWhatsappApiUrl).replace(/\/+$/, "");
}

function credentials(accountConfig: ProviderAccountConfig): { apiUrl: string; phoneNumberId: string; accessToken: string } {
  const { settings, tokens } = accountConfig;
  return {
    apiUrl: apiBaseUrl(settings),
    phoneNumberId: stringSetting(
      settings,
      ["phone_number_id", "whatsapp.phone_number_id", "WHATSAPP_PHONE_NUMBER_ID"],
      stringToken(tokens, ["phone_number_id", "WHATSAPP_PHONE_NUMBER_ID"]),
    ),
    accessToken: stringToken(
      tokens,
      ["access_token", "WHATSAPP_ACCESS_TOKEN", "token"],
      stringSetting(settings, ["access_token", "WHATSAPP_ACCESS_TOKEN", "token"]),
    ),
  };
}

function cleanRecipient(input: string): string {
  return input.replace("@s.whatsapp.net", "").replace(/[^0-9]/g, "");
}

function templatePayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(payload.template)) return payload.template;
  const name = payloadString(payload, ["template_name", "name"]);
  const languageCode = payloadString(payload, ["language_code", "template_language", "language"], "tr");
  return {
    name,
    language: { code: languageCode },
    ...(Array.isArray(payload.components) ? { components: payload.components } : {}),
  };
}

function mediaPayload(payload: Record<string, unknown>, mediaType: string): Record<string, unknown> {
  const mediaId = payloadString(payload, ["media_id", "id"]);
  const caption = payloadString(payload, ["caption"]);
  const fileName = payloadString(payload, ["filename", "fileName"]);
  const body: Record<string, unknown> = { id: mediaId };
  if (mediaType !== "audio") body.caption = caption;
  if (mediaType === "document" && fileName) body.filename = fileName;
  return body;
}

interface WhatsappAttachmentReference {
  file_public_id: string;
  caption: string;
  filename: string;
}

interface UploadedWhatsappMedia {
  media_id: string;
  media_type: "image" | "video" | "audio" | "document";
  filename: string;
  caption: string;
}

function attachmentReference(payload: Record<string, unknown>): WhatsappAttachmentReference | null {
  const attachment = isRecord(payload.attachment) ? payload.attachment : null;
  const filePublicId = attachment
    ? payloadString(attachment, ["file_public_id", "public_id"])
    : payloadString(payload, ["file_public_id", "attachment_file_public_id"]);
  if (!filePublicId) return null;
  return {
    file_public_id: filePublicId,
    caption: (attachment ? payloadString(attachment, ["caption"]) : "") || payloadString(payload, ["caption"]),
    filename: (attachment ? payloadString(attachment, ["filename", "file_name"]) : "") ||
      payloadString(payload, ["filename", "fileName"]),
  };
}

// Legacy /api/whatsapp/send-media: image / video / audio, everything else is a document.
export function whatsappMediaTypeForMime(mimeType: string): UploadedWhatsappMedia["media_type"] {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("image/")) return "image";
  return "document";
}

// Legacy safeFileName: documents require a filename or the media renders broken.
export function whatsappSafeFileName(fileName: string | null, mimeType: string): string {
  return fileName || `media.${(mimeType.split("/")[1] || "bin").replace(/[^a-z0-9.]/gi, "")}`;
}

function uploadedMediaBody(media: UploadedWhatsappMedia): Record<string, unknown> {
  const body: Record<string, unknown> = { id: media.media_id, caption: media.caption };
  if (media.media_type === "document") body.filename = media.filename;
  if (media.media_type === "audio") delete body.caption;
  return body;
}

function messageBody(envelope: ProviderRequestEnvelope, uploaded: UploadedWhatsappMedia | null = null): Record<string, unknown> {
  const payload = envelope.payload;
  const to = cleanRecipient(payloadString(payload, ["to", "recipient_id", "recipient_phone", "phone"]));
  if (uploaded) {
    return {
      messaging_product: "whatsapp",
      to,
      type: uploaded.media_type,
      [uploaded.media_type]: uploadedMediaBody(uploaded),
    };
  }
  const explicitType = payloadString(payload, ["type", "message_type"]).toLowerCase();
  const mediaType = mediaTypes.has(explicitType)
    ? explicitType
    : mediaTypes.has(payloadString(payload, ["media_type"]).toLowerCase())
      ? payloadString(payload, ["media_type"]).toLowerCase()
      : "";

  if (explicitType === "template" || payload.template || payload.template_name) {
    return {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: templatePayload(payload),
    };
  }

  if (mediaType) {
    return {
      messaging_product: "whatsapp",
      to,
      type: mediaType,
      [mediaType]: mediaPayload(payload, mediaType),
    };
  }

  return {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: payloadString(payload, ["message", "text", "body"]) },
  };
}

function createMediaUploadRequest(
  file: ProviderMediaFile,
  filename: string,
  accountConfig: ProviderAccountConfig,
  policy: LiveProviderTransportPolicy,
): WhatsappTransportRequest {
  const creds = credentials(accountConfig);
  return {
    method: "POST",
    url: `${creds.apiUrl}/${creds.phoneNumberId}/media`,
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
    },
    body: "",
    timeout_ms: policy.timeout_ms,
    whatsapp_endpoint: "media",
    multipart: {
      file: { field: "file", filename, mime_type: file.mime_type, bytes: file.bytes },
      fields: [
        ["type", file.mime_type],
        ["messaging_product", "whatsapp"],
      ],
    },
  };
}

function createRequest(
  envelope: ProviderRequestEnvelope,
  accountConfig: ProviderAccountConfig,
  policy: LiveProviderTransportPolicy,
  uploaded: UploadedWhatsappMedia | null = null,
): WhatsappTransportRequest {
  const creds = credentials(accountConfig);
  return {
    method: "POST",
    url: `${creds.apiUrl}/${creds.phoneNumberId}/messages`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${creds.accessToken}`,
    },
    body: JSON.stringify(messageBody(envelope, uploaded)),
    timeout_ms: policy.timeout_ms,
    whatsapp_endpoint: "messages",
  };
}

function parseJson(body: string): Record<string, unknown> | null {
  return parseMetaJson(body);
}

function normalizeResponse(response: WhatsappTransportResponse): Record<string, unknown> | null {
  const parsed = parseJson(response.body);
  if (!parsed || hasMetaGraphError(parsed)) return null;
  if (!Array.isArray(parsed.messages)) return null;
  return {
    success: true,
    data: parsed,
    message_sent: true,
  };
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return redactMetaHeaders(headers);
}

function redactRequest(request: WhatsappTransportRequest): Record<string, unknown> {
  const url = new URL(request.url);
  if (request.multipart) {
    return {
      method: request.method,
      whatsapp_endpoint: request.whatsapp_endpoint,
      origin: url.origin,
      path: url.pathname,
      headers: redactHeaders(request.headers),
      body_bytes: request.multipart.file.bytes.byteLength,
      body: {
        multipart: true,
        file: {
          filename: request.multipart.file.filename,
          mime_type: request.multipart.file.mime_type,
          byte_size: request.multipart.file.bytes.byteLength,
        },
        fields: Object.fromEntries(request.multipart.fields),
      },
      timeout_ms: request.timeout_ms,
    };
  }
  return {
    method: request.method,
    whatsapp_endpoint: request.whatsapp_endpoint,
    origin: url.origin,
    path: url.pathname,
    headers: redactHeaders(request.headers),
    body_bytes: Buffer.byteLength(request.body, "utf8"),
    body: parseJson(request.body) ?? "[unparseable-json]",
    timeout_ms: request.timeout_ms,
  };
}

function retryMetadata(decision: ProviderRetryDecision): Record<string, unknown> {
  return {
    reason: decision.reason,
    attempts_remaining: decision.attempts_remaining,
    retry_delay_ms: decision.retry_delay_ms,
    error_retryable: decision.error_retryable,
  };
}

function responseMetadata(response: WhatsappTransportResponse): Record<string, unknown> {
  return metaGraphResponseMetadata(response);
}

function retryDecision(input: WhatsappLiveAdapterInput, endedAt: Date, statusCode?: number | null, errorCode?: string): ProviderRetryDecision {
  return decideProviderRetry(
    {
      operation: input.envelope.operation,
      ...(typeof statusCode === "number" ? { status_code: statusCode } : {}),
      ...(errorCode ? { error_code: errorCode } : {}),
      attempt_number: input.attemptNumber,
      max_attempts: input.maxAttempts,
      idempotency_key:
        typeof input.envelope.payload.idempotency_key === "string"
          ? input.envelope.payload.idempotency_key
          : null,
    },
    endedAt,
  );
}

function createAttempt(input: {
  envelope: ProviderRequestEnvelope;
  job: JobEnvelope;
  startedAt: Date;
  endedAt: Date;
  statusCode: number | null;
  status: ProviderAttempt["status"];
  retryDecision: ProviderAttempt["retry_decision"];
  nextRetryAt: string | null;
  request: WhatsappTransportRequest;
  response: Record<string, unknown>;
  error: ProviderAttempt["error"];
  retry?: Record<string, unknown>;
  mediaUpload?: Record<string, unknown> | null;
  liveCallPerformed?: boolean;
}): ProviderAttempt {
  return providerAttemptSchema.parse({
    provider: input.envelope.provider,
    operation: input.envelope.operation,
    direction: input.envelope.direction,
    request_id: input.envelope.request_id,
    account_public_id: input.envelope.account_public_id,
    started_at: input.startedAt.toISOString(),
    duration_ms: Math.max(0, input.endedAt.getTime() - input.startedAt.getTime()),
    status: input.status,
    status_code: input.statusCode,
    retry_decision: input.retryDecision,
    next_retry_at: input.nextRetryAt,
    idempotency_key:
      typeof input.envelope.payload.idempotency_key === "string"
        ? input.envelope.payload.idempotency_key
        : null,
    request_metadata: {
      ...providerAttemptCorrelationMetadata(input.job, input.envelope),
      queue: input.job.queue,
      channel: input.envelope.channel,
      live_call_performed: input.liveCallPerformed ?? true,
      transport: "whatsapp-graph",
      request: redactRequest(input.request),
      ...(input.mediaUpload ? { media_upload: input.mediaUpload } : {}),
      ...(input.retry ? { retry: input.retry } : {}),
    },
    response_metadata: input.response,
    error: input.error,
  });
}

export function whatsappMultipartFormData(multipart: WhatsappMultipartBody): FormData {
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(multipart.file.bytes)], { type: multipart.file.mime_type });
  formData.append(multipart.file.field, blob, multipart.file.filename);
  for (const [name, value] of multipart.fields) {
    formData.append(name, value);
  }
  return formData;
}

export async function defaultWhatsappFetchTransport(request: WhatsappTransportRequest): Promise<WhatsappTransportResponse> {
  if (request.multipart) {
    return fetchLiveHttpTransport(
      { ...request, body: whatsappMultipartFormData(request.multipart) },
      "WhatsApp",
    );
  }
  return fetchLiveHttpTransport(request, "WhatsApp");
}

function throwFailure(
  input: WhatsappLiveAdapterInput,
  request: WhatsappTransportRequest,
  response: WhatsappTransportResponse,
  errorCode: "provider_http_error" | "malformed_response" | "whatsapp_token_error" | "graph_rate_limit",
  message: string,
  mediaUpload: Record<string, unknown> | null = null,
): never {
  const endedAt = input.now ? new Date(input.now) : new Date();
  const statusCode = errorCode === "whatsapp_token_error" ? 401 : response.status;
  const decision = retryDecision(
    input,
    endedAt,
    statusCode,
    errorCode === "malformed_response" || errorCode === "graph_rate_limit" ? errorCode : undefined,
  );
  const attempt = createAttempt({
    envelope: input.envelope,
    job: input.job,
    startedAt: input.now ?? new Date(),
    endedAt,
    statusCode: response.status,
    status: decision.status,
    retryDecision: decision.retry_decision,
    nextRetryAt: decision.next_retry_at,
    request,
    response: responseMetadata(response),
    error: { code: errorCode, message },
    retry: retryMetadata(decision),
    mediaUpload,
  });
  throw new WhatsappLiveTransportError(message, attempt);
}

function throwTransportFailure(
  input: WhatsappLiveAdapterInput,
  request: WhatsappTransportRequest,
  startedAt: Date,
  error: unknown,
  mediaUpload: Record<string, unknown> | null = null,
): never {
  const endedAt = input.now ? new Date(input.now) : new Date();
  const decision = retryDecision(input, endedAt, null, failureCode(error));
  const attempt = createAttempt({
    envelope: input.envelope,
    job: input.job,
    startedAt,
    endedAt,
    statusCode: null,
    status: decision.status,
    retryDecision: decision.retry_decision,
    nextRetryAt: decision.next_retry_at,
    request,
    response: { live_call_performed: true, accepted: false },
    error: { code: failureCode(error), message: failureMessage(error, "WhatsApp transport failed") },
    retry: retryMetadata(decision),
    mediaUpload,
  });
  throw new WhatsappLiveTransportError(failureMessage(error, "WhatsApp transport failed"), attempt);
}

function throwMediaFileFailure(
  input: WhatsappLiveAdapterInput,
  startedAt: Date,
  attachment: WhatsappAttachmentReference,
  message: string,
): never {
  const endedAt = input.now ? new Date(input.now) : new Date();
  const decision = retryDecision(input, endedAt, null, "media_file_unavailable");
  const creds = credentials(input.accountConfig);
  const attempt = createAttempt({
    envelope: input.envelope,
    job: input.job,
    startedAt,
    endedAt,
    statusCode: null,
    status: decision.status,
    retryDecision: decision.retry_decision,
    nextRetryAt: decision.next_retry_at,
    request: {
      method: "POST",
      url: `${creds.apiUrl}/${creds.phoneNumberId}/media`,
      headers: { Authorization: `Bearer ${creds.accessToken}` },
      body: "",
      timeout_ms: input.policy.timeout_ms,
      whatsapp_endpoint: "media",
    },
    response: { live_call_performed: false, accepted: false },
    error: { code: "media_file_unavailable", message },
    retry: retryMetadata(decision),
    mediaUpload: { file_public_id: attachment.file_public_id, uploaded: false },
    liveCallPerformed: false,
  });
  throw new WhatsappLiveTransportError(message, attempt);
}

function checkGraphResponse(
  input: WhatsappLiveAdapterInput,
  request: WhatsappTransportRequest,
  response: WhatsappTransportResponse,
  mediaUpload: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const parsed = parseJson(response.body);
  if (isMetaTokenError(response, parsed)) {
    throwFailure(input, request, response, "whatsapp_token_error", "WhatsApp access token was rejected by Meta", mediaUpload);
  }
  if (isMetaRateLimitError(response, parsed)) {
    throwFailure(input, request, response, "graph_rate_limit", "WhatsApp Graph API rate limit was reached", mediaUpload);
  }
  if (response.status >= 400) {
    throwFailure(input, request, response, "provider_http_error", `WhatsApp returned HTTP ${response.status}`, mediaUpload);
  }
  return parsed;
}

async function uploadAttachment(
  input: WhatsappLiveAdapterInput,
  attachment: WhatsappAttachmentReference,
  transport: WhatsappFetchTransport,
  startedAt: Date,
): Promise<{ uploaded: UploadedWhatsappMedia; metadata: Record<string, unknown> }> {
  if (!input.mediaFileResolver) {
    throwMediaFileFailure(input, startedAt, attachment, "WhatsApp media upload requires an object storage file resolver");
  }
  let file: ProviderMediaFile;
  try {
    file = await input.mediaFileResolver.resolve(attachment.file_public_id);
  } catch (error) {
    throwMediaFileFailure(input, startedAt, attachment, failureMessage(error, "Media file could not be loaded"));
  }

  const filename = whatsappSafeFileName(attachment.filename || file.file_name, file.mime_type);
  const request = createMediaUploadRequest(file, filename, input.accountConfig, input.policy);
  const baseMetadata = { file_public_id: attachment.file_public_id, uploaded: false };
  let response: WhatsappTransportResponse;
  try {
    response = await transport(request);
  } catch (error) {
    throwTransportFailure(input, request, startedAt, error, baseMetadata);
  }
  const parsed = checkGraphResponse(input, request, response, baseMetadata);
  const mediaId = parsed && !hasMetaGraphError(parsed) ? stringValue(parsed.id) : "";
  if (!mediaId) {
    throwFailure(input, request, response, "malformed_response", "WhatsApp media upload did not return a media id", baseMetadata);
  }
  return {
    uploaded: {
      media_id: mediaId,
      media_type: whatsappMediaTypeForMime(file.mime_type),
      filename,
      caption: attachment.caption,
    },
    metadata: {
      file_public_id: attachment.file_public_id,
      uploaded: true,
      media_id: mediaId,
      request: redactRequest(request),
      response: responseMetadata(response),
    },
  };
}

export async function sendWhatsappLiveRequest(input: WhatsappLiveAdapterInput): Promise<WhatsappLiveAdapterResult> {
  const startedAt = input.now ?? new Date();
  if (input.envelope.operation !== "message.send") {
    throw new Error(`Unsupported WhatsApp operation: ${input.envelope.operation}`);
  }

  const transport = input.transport ?? defaultWhatsappFetchTransport;
  const attachment = attachmentReference(input.envelope.payload);
  const upload = attachment ? await uploadAttachment(input, attachment, transport, startedAt) : null;
  const mediaUpload = upload?.metadata ?? null;
  const request = createRequest(input.envelope, input.accountConfig, input.policy, upload?.uploaded ?? null);
  let response: WhatsappTransportResponse;
  try {
    response = await transport(request);
  } catch (error) {
    throwTransportFailure(input, request, startedAt, error, mediaUpload);
  }

  checkGraphResponse(input, request, response, mediaUpload);

  const normalized = normalizeResponse(response);
  if (!normalized) {
    throwFailure(input, request, response, "malformed_response", "WhatsApp response could not be normalized", mediaUpload);
  }
  const payload = upload
    ? { ...normalized, media_id: upload.uploaded.media_id, media_type: upload.uploaded.media_type }
    : normalized;

  const endedAt = input.now ? new Date(input.now) : new Date();
  return {
    response_payload: payload,
    attempt: createAttempt({
      envelope: input.envelope,
      job: input.job,
      startedAt,
      endedAt,
      statusCode: response.status,
      status: "success",
      retryDecision: "none",
      nextRetryAt: null,
      request,
      response: responseMetadata(response),
      error: null,
      mediaUpload,
    }),
  };
}
