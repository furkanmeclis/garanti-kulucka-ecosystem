import type { JobEnvelope, ProviderAttempt, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { providerAttemptSchema } from "@garanti-kulucka/shared";
import type { ProviderAccountConfig } from "./account-config.js";
import { failureCode, failureMessage, fetchLiveHttpTransport } from "./live-http.js";
import { decideProviderRetry, type ProviderRetryDecision } from "./retry.js";
import type { LiveProviderTransportPolicy } from "./transport-policy.js";

export interface WhatsappTransportResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface WhatsappTransportRequest {
  method: "POST";
  url: string;
  headers: Record<string, string>;
  body: string;
  timeout_ms: number;
  whatsapp_endpoint: "messages";
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

function isRecord(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input);
}

function stringValue(input: unknown): string {
  if (typeof input === "string") return input;
  if (typeof input === "number" && Number.isFinite(input)) return String(input);
  return "";
}

function stringSetting(settings: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = stringValue(settings[key]);
    if (value.length > 0) return value;
  }
  return fallback;
}

function stringToken(tokens: Record<string, unknown>, keys: string[], fallback = ""): string {
  return stringSetting(tokens, keys, fallback);
}

function payloadString(payload: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = stringValue(payload[key]);
    if (value.length > 0) return value;
  }
  return fallback;
}

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

function messageBody(envelope: ProviderRequestEnvelope): Record<string, unknown> {
  const payload = envelope.payload;
  const to = cleanRecipient(payloadString(payload, ["to", "recipient_id", "recipient_phone", "phone"]));
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

function createRequest(
  envelope: ProviderRequestEnvelope,
  accountConfig: ProviderAccountConfig,
  policy: LiveProviderTransportPolicy,
): WhatsappTransportRequest {
  const creds = credentials(accountConfig);
  return {
    method: "POST",
    url: `${creds.apiUrl}/${creds.phoneNumberId}/messages`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${creds.accessToken}`,
    },
    body: JSON.stringify(messageBody(envelope)),
    timeout_ms: policy.timeout_ms,
    whatsapp_endpoint: "messages",
  };
}

function parseJson(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function metaErrorCode(parsed: Record<string, unknown> | null): number | null {
  const error = isRecord(parsed?.error) ? parsed.error : null;
  const parsedCode = Number(error?.code);
  return Number.isFinite(parsedCode) ? parsedCode : null;
}

function hasMetaError(parsed: Record<string, unknown> | null): boolean {
  return isRecord(parsed?.error);
}

function normalizeResponse(response: WhatsappTransportResponse): Record<string, unknown> | null {
  const parsed = parseJson(response.body);
  if (!parsed || hasMetaError(parsed)) return null;
  if (!Array.isArray(parsed.messages)) return null;
  return {
    success: true,
    data: parsed,
    message_sent: true,
  };
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) =>
      key.toLowerCase() === "authorization" ? [key, "[redacted]"] : [key, value],
    ),
  );
}

function redactRequest(request: WhatsappTransportRequest): Record<string, unknown> {
  const url = new URL(request.url);
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
  const parsed = parseJson(response.body);
  const bodyPreview = isRecord(parsed?.error)
    ? JSON.stringify({
        ...parsed,
        error: {
          ...parsed.error,
          message: "[redacted]",
        },
      }).slice(0, 800)
    : response.body.slice(0, 800);
  return {
    live_call_performed: true,
    accepted: response.status >= 200 && response.status < 300 && !hasMetaError(parsed),
    status_code: response.status,
    headers: response.headers,
    body_bytes: Buffer.byteLength(response.body, "utf8"),
    body_preview: bodyPreview,
  };
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
      queue: input.job.queue,
      job_id: input.job.job_id,
      channel: input.envelope.channel,
      live_call_performed: true,
      transport: "whatsapp-graph",
      request: redactRequest(input.request),
      ...(input.retry ? { retry: input.retry } : {}),
    },
    response_metadata: input.response,
    error: input.error,
  });
}

export async function defaultWhatsappFetchTransport(request: WhatsappTransportRequest): Promise<WhatsappTransportResponse> {
  return fetchLiveHttpTransport(request, "WhatsApp");
}

function throwFailure(
  input: WhatsappLiveAdapterInput,
  request: WhatsappTransportRequest,
  response: WhatsappTransportResponse,
  errorCode: "provider_http_error" | "malformed_response" | "whatsapp_token_error",
  message: string,
): never {
  const endedAt = input.now ? new Date(input.now) : new Date();
  const statusCode = errorCode === "whatsapp_token_error" ? 401 : response.status;
  const decision = retryDecision(
    input,
    endedAt,
    statusCode,
    errorCode === "malformed_response" ? errorCode : undefined,
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
  });
  throw new WhatsappLiveTransportError(message, attempt);
}

export async function sendWhatsappLiveRequest(input: WhatsappLiveAdapterInput): Promise<WhatsappLiveAdapterResult> {
  const startedAt = input.now ?? new Date();
  if (input.envelope.operation !== "message.send") {
    throw new Error(`Unsupported WhatsApp operation: ${input.envelope.operation}`);
  }

  const request = createRequest(input.envelope, input.accountConfig, input.policy);
  const transport = input.transport ?? defaultWhatsappFetchTransport;
  let response: WhatsappTransportResponse;
  try {
    response = await transport(request);
  } catch (error) {
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
    });
    throw new WhatsappLiveTransportError(failureMessage(error, "WhatsApp transport failed"), attempt);
  }

  const parsed = parseJson(response.body);
  if (response.status === 401 || metaErrorCode(parsed) === 190) {
    throwFailure(input, request, response, "whatsapp_token_error", "WhatsApp access token was rejected by Meta");
  }
  if (response.status === 429 || response.status >= 500 || response.status >= 400) {
    throwFailure(input, request, response, "provider_http_error", `WhatsApp returned HTTP ${response.status}`);
  }

  const payload = normalizeResponse(response);
  if (!payload) {
    throwFailure(input, request, response, "malformed_response", "WhatsApp response could not be normalized");
  }

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
    }),
  };
}
