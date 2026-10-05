import type { JobEnvelope, ProviderAttempt, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { providerAttemptSchema } from "@garanti-kulucka/shared";
import type { ProviderAccountConfig } from "./account-config.js";
import { providerAttemptCorrelationMetadata } from "./correlation.js";
import { failureCode, failureMessage, fetchLiveHttpTransport } from "./live-http.js";
import { decideProviderRetry, type ProviderRetryDecision } from "./retry.js";
import type { LiveProviderTransportPolicy } from "./transport-policy.js";

export interface VapiTransportResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface VapiTransportRequest {
  method: "POST";
  url: string;
  headers: Record<string, string>;
  body: string;
  timeout_ms: number;
  vapi_endpoint: "call.create";
}

export type VapiFetchTransport = (request: VapiTransportRequest) => Promise<VapiTransportResponse>;

export interface VapiLiveAdapterInput {
  envelope: ProviderRequestEnvelope;
  job: JobEnvelope;
  accountConfig: ProviderAccountConfig;
  policy: LiveProviderTransportPolicy;
  attemptNumber: number;
  maxAttempts: number;
  transport?: VapiFetchTransport;
  now?: Date;
}

export interface VapiLiveAdapterResult {
  attempt: ProviderAttempt;
  response_payload: Record<string, unknown>;
}

export class VapiLiveTransportError extends Error {
  constructor(
    message: string,
    readonly attempt: ProviderAttempt,
  ) {
    super(message);
    this.name = "VapiLiveTransportError";
  }
}

const defaultVapiApiUrl = "https://api.vapi.ai";
const defaultCallPath = "/call/phone";

function stringValue(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function stringSetting(settings: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = stringValue(settings[key]);
    if (value) return value;
  }
  return fallback;
}

function stringToken(tokens: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = stringValue(tokens[key]);
    if (value) return value;
  }
  return fallback;
}

function payloadString(payload: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = stringValue(payload[key]);
    if (value) return value;
  }
  return fallback;
}

function cleanPhone(input: string): string {
  const compact = input.replace(/\s+/g, "").replace(/[()-]/g, "");
  if (compact.startsWith("0")) return `+90${compact.slice(1)}`;
  if (compact && !compact.startsWith("+")) return `+90${compact}`;
  return compact;
}

function cargoProviderName(input: string): string {
  return input.toUpperCase() === "PTT" ? "PTT" : "Sürat Kargo";
}

function replaceVariables(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    template,
  );
}

function credentials(accountConfig: ProviderAccountConfig): {
  apiUrl: string;
  callPath: string;
  apiKey: string;
  phoneNumberId: string;
  assistantId: string;
  systemPrompt: string;
  ttsProvider: string;
  ttsVoice: string;
} {
  const { settings, tokens } = accountConfig;
  return {
    apiUrl: stringSetting(settings, ["api_url", "vapi.api_url", "VAPI_API_URL"], defaultVapiApiUrl).replace(/\/+$/, ""),
    callPath: stringSetting(settings, ["call_path", "vapi.call_path", "VAPI_CALL_PATH"], defaultCallPath),
    apiKey: stringToken(
      tokens,
      ["api_key", "VAPI_API_KEY", "token"],
      stringSetting(settings, ["api_key", "VAPI_API_KEY", "token"]),
    ),
    phoneNumberId: stringSetting(settings, ["phone_number_id", "vapi.phone_number_id", "VAPI_PHONE_NUMBER_ID"]),
    assistantId: stringSetting(settings, ["assistant_id", "vapi.assistant_id", "VAPI_ASSISTANT_ID"]),
    systemPrompt: stringSetting(settings, ["system_prompt", "vapi.system_prompt"]),
    ttsProvider: stringSetting(settings, ["tts_provider", "vapi.tts_provider"], "azure"),
    ttsVoice: stringSetting(settings, ["tts_voice", "vapi.tts_voice"], "tr-TR-AhmetNeural"),
  };
}

function callBody(envelope: ProviderRequestEnvelope, accountConfig: ProviderAccountConfig): Record<string, unknown> {
  const creds = credentials(accountConfig);
  if (!creds.apiKey) throw new Error("Vapi API key is missing");
  if (!creds.phoneNumberId) throw new Error("Vapi phone number id is missing");

  const payload = envelope.payload;
  const phone = cleanPhone(payloadString(payload, ["customer_phone", "musteri_telefon", "phone", "number"]));
  if (!phone) throw new Error("Vapi customer phone is missing");

  const customerName = payloadString(payload, ["customer_name", "musteri_adi", "name"], "Müşteri");
  const cargoProvider = cargoProviderName(payloadString(payload, ["cargo_provider", "kargo_firmasi"]));
  const trackingNumber = payloadString(payload, ["tracking_number", "takip_no"]);
  const lastEventText = payloadString(payload, ["last_event_text", "son_hareket"], "bilgi alınamadı");
  const variables = {
    musteri_adi: customerName,
    kargo_firmasi: cargoProvider,
    takip_no: trackingNumber,
    son_hareket: lastEventText,
  };
  const baseSystemPrompt = creds.systemPrompt ||
    "Sen Garanti Kuluçka firmasının müşteri temsilcisisin. Sadece müşteriye kargosu hakkında bilgi vermek için aradın.";
  const systemPrompt =
    `ÖNEMLİ: Bu arama SATIŞ veya GENEL DESTEK araması DEĞİL. ` +
    `Sadece kargo bilgilendirmesi yap. Fiyat, ürün özellikleri veya SSS anlatma. ` +
    `Müşteri adı: ${customerName}. Kargo firması: ${cargoProvider}. Takip no: ${trackingNumber}. Son durum: ${lastEventText}.\n\n` +
    replaceVariables(baseSystemPrompt, variables);
  const firstMessage =
    `Merhaba ${customerName}, ben Garanti Kuluçka'dan arıyorum. ` +
    `Kargonuz ${cargoProvider} firmasında, son durumu: ${lastEventText}. ` +
    `İade olmaması için lütfen en kısa sürede şubeden teslim alın.`;
  const voice = {
    provider: creds.ttsProvider,
    voiceId: creds.ttsVoice,
  };
  const model = {
    provider: "openai",
    model: "gpt-4o-mini",
    messages: [{ role: "system", content: systemPrompt }],
  };
  const body: Record<string, unknown> = {
    phoneNumberId: creds.phoneNumberId,
    customer: {
      number: phone,
      ...(customerName ? { name: customerName } : {}),
    },
  };

  if (creds.assistantId) {
    body.assistantId = creds.assistantId;
    body.assistantOverrides = {
      firstMessage,
      model,
      voice,
      variableValues: variables,
      endCallMessage: "İyi günler, hoşça kalın.",
      maxDurationSeconds: 180,
    };
  } else {
    body.assistant = {
      model,
      voice,
      firstMessage,
      transcriber: { provider: "deepgram", model: "nova-2", language: "tr" },
      endCallMessage: "İyi günler, hoşça kalın.",
      maxDurationSeconds: 180,
    };
  }

  return body;
}

function createRequest(
  envelope: ProviderRequestEnvelope,
  accountConfig: ProviderAccountConfig,
  policy: LiveProviderTransportPolicy,
): VapiTransportRequest {
  const creds = credentials(accountConfig);
  return {
    method: "POST",
    url: `${creds.apiUrl}${creds.callPath.startsWith("/") ? creds.callPath : `/${creds.callPath}`}`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${creds.apiKey}`,
    },
    body: JSON.stringify(callBody(envelope, accountConfig)),
    timeout_ms: policy.timeout_ms,
    vapi_endpoint: "call.create",
  };
}

function parseJson(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) =>
      key.toLowerCase() === "authorization" ? [key, "[REDACTED]"] : [key, value],
    ),
  );
}

function redactRequest(request: VapiTransportRequest): Record<string, unknown> {
  const url = new URL(request.url);
  return {
    method: request.method,
    vapi_endpoint: request.vapi_endpoint,
    origin: url.origin,
    path: url.pathname,
    headers: redactHeaders(request.headers),
    body_bytes: Buffer.byteLength(request.body, "utf8"),
    body: parseJson(request.body) ?? "[unparseable-json]",
    timeout_ms: request.timeout_ms,
  };
}

function responseMetadata(response: VapiTransportResponse, parsed: Record<string, unknown> | null): Record<string, unknown> {
  return {
    live_call_performed: true,
    accepted: response.status >= 200 && response.status < 300 && typeof parsed?.id === "string",
    status_code: response.status,
    body_bytes: Buffer.byteLength(response.body, "utf8"),
    body_preview: response.body.slice(0, 800),
    vapi_call_id: typeof parsed?.id === "string" ? parsed.id : null,
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

function retryDecision(input: VapiLiveAdapterInput, endedAt: Date, statusCode?: number | null, errorCode?: string): ProviderRetryDecision {
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
  request: VapiTransportRequest;
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
      ...providerAttemptCorrelationMetadata(input.job, input.envelope),
      queue: input.job.queue,
      channel: input.envelope.channel,
      live_call_performed: true,
      transport: "vapi-http",
      request: redactRequest(input.request),
      ...(input.retry ? { retry: input.retry } : {}),
    },
    response_metadata: input.response,
    error: input.error,
  });
}

export async function defaultVapiFetchTransport(request: VapiTransportRequest): Promise<VapiTransportResponse> {
  return fetchLiveHttpTransport(request, "Vapi");
}

function throwFailure(
  input: VapiLiveAdapterInput,
  startedAt: Date,
  request: VapiTransportRequest,
  response: VapiTransportResponse,
  errorCode: "provider_http_error" | "malformed_response",
  message: string,
  parsed: Record<string, unknown> | null,
): never {
  const endedAt = input.now ? new Date(input.now) : new Date();
  const decision = retryDecision(
    input,
    endedAt,
    response.status,
    errorCode === "malformed_response" ? errorCode : undefined,
  );
  const attempt = createAttempt({
    envelope: input.envelope,
    job: input.job,
    startedAt,
    endedAt,
    statusCode: response.status,
    status: decision.status,
    retryDecision: decision.retry_decision,
    nextRetryAt: decision.next_retry_at,
    request,
    response: responseMetadata(response, parsed),
    error: { code: errorCode, message },
    retry: retryMetadata(decision),
  });
  throw new VapiLiveTransportError(message, attempt);
}

export async function sendVapiLiveRequest(input: VapiLiveAdapterInput): Promise<VapiLiveAdapterResult> {
  const startedAt = input.now ?? new Date();
  if (input.envelope.operation !== "call.create") {
    throw new Error(`Unsupported Vapi operation: ${input.envelope.operation}`);
  }

  const request = createRequest(input.envelope, input.accountConfig, input.policy);
  const transport = input.transport ?? defaultVapiFetchTransport;
  let response: VapiTransportResponse;
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
      error: { code: failureCode(error), message: failureMessage(error, "Vapi transport failed") },
      retry: retryMetadata(decision),
    });
    throw new VapiLiveTransportError(failureMessage(error, "Vapi transport failed"), attempt);
  }

  const parsed = parseJson(response.body);
  if (response.status === 429 || response.status >= 500 || response.status >= 400) {
    throwFailure(input, startedAt, request, response, "provider_http_error", `Vapi returned HTTP ${response.status}`, parsed);
  }
  if (!parsed || typeof parsed.id !== "string" || parsed.id.trim().length === 0) {
    throwFailure(input, startedAt, request, response, "malformed_response", "Vapi response could not be normalized", parsed);
  }

  const endedAt = input.now ? new Date(input.now) : new Date();
  return {
    response_payload: {
      success: true,
      call_created: true,
      call_id: parsed.id,
      data: parsed,
    },
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
      response: responseMetadata(response, parsed),
      error: null,
    }),
  };
}
