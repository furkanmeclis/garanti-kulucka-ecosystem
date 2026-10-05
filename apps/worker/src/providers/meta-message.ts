import type { JobEnvelope, ProviderAttempt, ProviderName, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { providerAttemptCorrelationMetadata } from "./correlation.js";
import { providerAttemptSchema } from "@garanti-kulucka/shared";
import type { ProviderAccountConfig } from "./account-config.js";
import { failureCode, failureMessage, fetchLiveHttpTransport } from "./live-http.js";
import {
  hasMetaGraphError,
  isMetaRateLimitError,
  isMetaTokenError,
  metaGraphResponseMetadata,
  parseMetaJson,
  payloadString,
  redactMetaHeaders,
  stringSetting,
  stringToken,
} from "./meta-graph.js";
import { decideProviderRetry, type ProviderRetryDecision } from "./retry.js";
import type { LiveProviderTransportPolicy } from "./transport-policy.js";

export interface MetaMessageTransportResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface MetaMessageTransportRequest {
  method: "POST";
  url: string;
  headers: Record<string, string>;
  body: string;
  timeout_ms: number;
  meta_endpoint: "messages";
  meta_provider: "instagram" | "messenger";
}

export type MetaMessageFetchTransport = (
  request: MetaMessageTransportRequest,
) => Promise<MetaMessageTransportResponse>;

export interface MetaMessageLiveAdapterInput {
  envelope: ProviderRequestEnvelope;
  job: JobEnvelope;
  accountConfig: ProviderAccountConfig;
  policy: LiveProviderTransportPolicy;
  attemptNumber: number;
  maxAttempts: number;
  transport?: MetaMessageFetchTransport;
  now?: Date;
}

export interface MetaMessageLiveAdapterResult {
  attempt: ProviderAttempt;
  response_payload: Record<string, unknown>;
}

export class MetaMessageLiveTransportError extends Error {
  constructor(
    message: string,
    readonly attempt: ProviderAttempt,
  ) {
    super(message);
    this.name = "MetaMessageLiveTransportError";
  }
}

interface MetaMessageAdapterDefinition {
  provider: "instagram" | "messenger";
  displayName: string;
  transportName: string;
  defaultApiUrl: string;
  tokenKeys: string[];
  settingsTokenKeys: string[];
  idKeys: string[];
  endpointIdLabel: string;
  apiUrlKeys: string[];
  tokenErrorCode: string;
  tokenErrorMessage: string;
  normalize: (parsed: Record<string, unknown>) => Record<string, unknown> | null;
  messageBody: (envelope: ProviderRequestEnvelope) => Record<string, unknown>;
  apiUrl?: (accountConfig: ProviderAccountConfig, accessToken: string) => string;
}

const defaultFacebookGraphUrl = "https://graph.facebook.com/v26.0";
const defaultInstagramGraphUrl = "https://graph.instagram.com/v26.0";

function graphUrl(input: string): string {
  return input.replace(/\/+$/, "");
}

function idempotencyKey(envelope: ProviderRequestEnvelope): string | null {
  return typeof envelope.payload.idempotency_key === "string" ? envelope.payload.idempotency_key : null;
}

function defaultNormalize(parsed: Record<string, unknown>): Record<string, unknown> | null {
  if (hasMetaGraphError(parsed)) return null;
  const messageId = typeof parsed.message_id === "string" ? parsed.message_id : null;
  const recipientId = typeof parsed.recipient_id === "string" ? parsed.recipient_id : null;
  if (!messageId && !recipientId) return null;
  return {
    success: true,
    data: parsed,
    message_sent: true,
  };
}

function recipient(envelope: ProviderRequestEnvelope): string {
  return payloadString(envelope.payload, ["to", "recipient_id", "psid", "instagram_user_id"]);
}

function text(envelope: ProviderRequestEnvelope): string {
  return payloadString(envelope.payload, ["message", "text", "body"]);
}

export function instagramMessageBody(envelope: ProviderRequestEnvelope): Record<string, unknown> {
  const body: Record<string, unknown> = {
    recipient: { id: recipient(envelope) },
    message: { text: text(envelope) },
  };
  if (envelope.payload.human_agent === true) {
    body.messaging_type = "MESSAGE_TAG";
    body.tag = "HUMAN_AGENT";
  }
  return body;
}

export function messengerMessageBody(envelope: ProviderRequestEnvelope): Record<string, unknown> {
  const body: Record<string, unknown> = {
    recipient: { id: recipient(envelope) },
    message: { text: text(envelope) },
  };
  if (envelope.payload.human_agent === true) {
    body.messaging_type = "MESSAGE_TAG";
    body.tag = "HUMAN_AGENT";
  } else {
    body.messaging_type = "RESPONSE";
  }
  return body;
}

function resolveInstagramApiUrl(accountConfig: ProviderAccountConfig, accessToken: string): string {
  const configured = stringSetting(accountConfig.settings, ["api_url", "instagram.api_url", "INSTAGRAM_API_URL"]);
  if (configured) return graphUrl(configured);

  const loginType = stringSetting(accountConfig.settings, ["login_type", "instagram.login_type", "ig_login_type"]).toLowerCase();
  if (loginType === "instagram" || loginType === "instagram_login" || loginType.startsWith("instagram")) {
    return defaultInstagramGraphUrl;
  }
  if (loginType === "facebook" || loginType === "facebook_login" || loginType.startsWith("facebook")) {
    return defaultFacebookGraphUrl;
  }
  return accessToken.startsWith("IGAA") ? defaultInstagramGraphUrl : defaultFacebookGraphUrl;
}

function credentials(definition: MetaMessageAdapterDefinition, accountConfig: ProviderAccountConfig) {
  const accessToken = stringToken(
    accountConfig.tokens,
    definition.tokenKeys,
    stringSetting(accountConfig.settings, definition.settingsTokenKeys),
  );
  const endpointId = stringSetting(
    accountConfig.settings,
    definition.idKeys,
    stringToken(accountConfig.tokens, definition.idKeys),
  );
  const apiUrl = definition.apiUrl
    ? definition.apiUrl(accountConfig, accessToken)
    : graphUrl(stringSetting(accountConfig.settings, definition.apiUrlKeys, definition.defaultApiUrl));
  return { apiUrl, endpointId, accessToken };
}

function createRequest(
  definition: MetaMessageAdapterDefinition,
  envelope: ProviderRequestEnvelope,
  accountConfig: ProviderAccountConfig,
  policy: LiveProviderTransportPolicy,
): MetaMessageTransportRequest {
  const creds = credentials(definition, accountConfig);
  const endpointId = creds.endpointId || "me";
  return {
    method: "POST",
    url: `${creds.apiUrl}/${endpointId}/messages`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${creds.accessToken}`,
    },
    body: JSON.stringify(definition.messageBody(envelope)),
    timeout_ms: policy.timeout_ms,
    meta_endpoint: "messages",
    meta_provider: definition.provider,
  };
}

function redactRequest(request: MetaMessageTransportRequest): Record<string, unknown> {
  const url = new URL(request.url);
  return {
    method: request.method,
    meta_provider: request.meta_provider,
    meta_endpoint: request.meta_endpoint,
    origin: url.origin,
    path: url.pathname,
    headers: redactMetaHeaders(request.headers),
    body_bytes: Buffer.byteLength(request.body, "utf8"),
    body: parseMetaJson(request.body) ?? "[unparseable-json]",
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

function retryDecision(
  input: MetaMessageLiveAdapterInput,
  endedAt: Date,
  statusCode?: number | null,
  errorCode?: string,
): ProviderRetryDecision {
  return decideProviderRetry(
    {
      operation: input.envelope.operation,
      ...(typeof statusCode === "number" ? { status_code: statusCode } : {}),
      ...(errorCode ? { error_code: errorCode } : {}),
      attempt_number: input.attemptNumber,
      max_attempts: input.maxAttempts,
      idempotency_key: idempotencyKey(input.envelope),
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
  request: MetaMessageTransportRequest;
  response: Record<string, unknown>;
  error: ProviderAttempt["error"];
  retry?: Record<string, unknown>;
}): ProviderAttempt {
  return providerAttemptSchema.parse({
    provider: input.envelope.provider as ProviderName,
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
    idempotency_key: idempotencyKey(input.envelope),
    request_metadata: {
      ...providerAttemptCorrelationMetadata(input.job, input.envelope),
      queue: input.job.queue,
      channel: input.envelope.channel,
      live_call_performed: true,
      transport: `${input.request.meta_provider}-graph`,
      request: redactRequest(input.request),
      ...(input.retry ? { retry: input.retry } : {}),
    },
    response_metadata: input.response,
    error: input.error,
  });
}

async function defaultMetaMessageFetchTransport(
  request: MetaMessageTransportRequest,
): Promise<MetaMessageTransportResponse> {
  return fetchLiveHttpTransport(request, request.meta_provider === "instagram" ? "Instagram" : "Messenger");
}

function throwFailure(
  definition: MetaMessageAdapterDefinition,
  input: MetaMessageLiveAdapterInput,
  request: MetaMessageTransportRequest,
  response: MetaMessageTransportResponse,
  errorCode: "provider_http_error" | "malformed_response" | "graph_rate_limit" | string,
  message: string,
): never {
  const endedAt = input.now ? new Date(input.now) : new Date();
  const decision = retryDecision(
    input,
    endedAt,
    errorCode === definition.tokenErrorCode ? 401 : response.status,
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
    response: metaGraphResponseMetadata(response),
    error: { code: errorCode, message },
    retry: retryMetadata(decision),
  });
  throw new MetaMessageLiveTransportError(message, attempt);
}

export async function sendMetaMessageLiveRequest(
  definition: MetaMessageAdapterDefinition,
  input: MetaMessageLiveAdapterInput,
): Promise<MetaMessageLiveAdapterResult> {
  const startedAt = input.now ?? new Date();
  if (input.envelope.operation !== "message.send") {
    throw new Error(`Unsupported ${definition.displayName} operation: ${input.envelope.operation}`);
  }

  const request = createRequest(definition, input.envelope, input.accountConfig, input.policy);
  const transport = input.transport ?? defaultMetaMessageFetchTransport;
  let response: MetaMessageTransportResponse;
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
      error: { code: failureCode(error), message: failureMessage(error, `${definition.displayName} transport failed`) },
      retry: retryMetadata(decision),
    });
    throw new MetaMessageLiveTransportError(failureMessage(error, `${definition.displayName} transport failed`), attempt);
  }

  const parsed = parseMetaJson(response.body);
  if (isMetaTokenError(response, parsed)) {
    throwFailure(definition, input, request, response, definition.tokenErrorCode, definition.tokenErrorMessage);
  }
  if (isMetaRateLimitError(response, parsed)) {
    throwFailure(definition, input, request, response, "graph_rate_limit", `${definition.displayName} Graph API rate limit was reached`);
  }
  if (response.status >= 500 || response.status >= 400) {
    throwFailure(definition, input, request, response, "provider_http_error", `${definition.displayName} returned HTTP ${response.status}`);
  }

  const payload = parsed ? definition.normalize(parsed) : null;
  if (!payload) {
    throwFailure(definition, input, request, response, "malformed_response", `${definition.displayName} response could not be normalized`);
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
      response: metaGraphResponseMetadata(response),
      error: null,
    }),
  };
}

export const instagramMessageAdapterDefinition: MetaMessageAdapterDefinition = {
  provider: "instagram",
  displayName: "Instagram",
  transportName: "instagram-graph",
  defaultApiUrl: defaultFacebookGraphUrl,
  tokenKeys: ["access_token", "INSTAGRAM_ACCESS_TOKEN", "token"],
  settingsTokenKeys: ["access_token", "INSTAGRAM_ACCESS_TOKEN", "token"],
  idKeys: ["ig_user_id", "instagram.ig_user_id", "page_id", "INSTAGRAM_PAGE_ID"],
  endpointIdLabel: "ig_user_id",
  apiUrlKeys: ["api_url", "instagram.api_url", "INSTAGRAM_API_URL"],
  tokenErrorCode: "instagram_token_error",
  tokenErrorMessage: "Instagram access token was rejected by Meta",
  normalize: defaultNormalize,
  messageBody: instagramMessageBody,
  apiUrl: resolveInstagramApiUrl,
};

export const messengerMessageAdapterDefinition: MetaMessageAdapterDefinition = {
  provider: "messenger",
  displayName: "Messenger",
  transportName: "messenger-graph",
  defaultApiUrl: defaultFacebookGraphUrl,
  tokenKeys: ["page_access_token", "MESSENGER_PAGE_ACCESS_TOKEN", "access_token", "token"],
  settingsTokenKeys: ["page_access_token", "MESSENGER_PAGE_ACCESS_TOKEN", "access_token", "token"],
  idKeys: ["page_id", "messenger.page_id", "MESSENGER_PAGE_ID"],
  endpointIdLabel: "page_id",
  apiUrlKeys: ["api_url", "messenger.api_url", "MESSENGER_API_URL"],
  tokenErrorCode: "messenger_token_error",
  tokenErrorMessage: "Messenger page access token was rejected by Meta",
  normalize: defaultNormalize,
  messageBody: messengerMessageBody,
};
