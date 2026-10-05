import type { JobEnvelope, ProviderAttempt, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { providerAttemptSchema } from "@garanti-kulucka/shared";
import type { ProviderAccountConfig } from "./account-config.js";
import { decideProviderRetry, type ProviderRetryDecision } from "./retry.js";
import type { LiveProviderTransportPolicy } from "./transport-policy.js";
import { failureCode, failureMessage, fetchLiveHttpTransport } from "./live-http.js";

export interface KolaybiTransportResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface KolaybiTransportRequest {
  method: "GET" | "POST" | "PUT";
  url: string;
  headers: Record<string, string>;
  body: string;
  timeout_ms: number;
  kolaybi_endpoint: "access_token" | "invoices";
}

export type KolaybiFetchTransport = (request: KolaybiTransportRequest) => Promise<KolaybiTransportResponse>;

export interface KolaybiLiveAdapterInput {
  envelope: ProviderRequestEnvelope;
  job: JobEnvelope;
  accountConfig: ProviderAccountConfig;
  policy: LiveProviderTransportPolicy;
  attemptNumber: number;
  maxAttempts: number;
  transport?: KolaybiFetchTransport;
  now?: Date;
}

export interface KolaybiLiveAdapterResult {
  attempt: ProviderAttempt;
  response_payload: Record<string, unknown>;
}

export class KolaybiLiveTransportError extends Error {
  constructor(
    message: string,
    readonly attempt: ProviderAttempt,
  ) {
    super(message);
    this.name = "KolaybiLiveTransportError";
  }
}

interface KolaybiCallRecord {
  request: KolaybiTransportRequest;
  response: KolaybiTransportResponse;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

const defaultKolaybiApiUrl = "https://ofis-sandbox-api.kolaybi.com/kolaybi/v1";
const tokenCache = new Map<string, CachedToken>();

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

function payloadNumber(payload: Record<string, unknown>, keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback;
}

function apiBaseUrl(settings: Record<string, unknown>): string {
  return stringSetting(settings, ["api_url", "kolaybi.api_url", "KOLAYBI_API_URL"], defaultKolaybiApiUrl).replace(/\/+$/, "");
}

function credentials(accountConfig: ProviderAccountConfig): { apiUrl: string; apiKey: string; channel: string } {
  const { settings, tokens } = accountConfig;
  return {
    apiUrl: apiBaseUrl(settings),
    apiKey: stringSetting(settings, ["api_key", "kolaybi.api_key", "KOLAYBI_API_KEY"], stringToken(tokens, ["api_key", "KOLAYBI_API_KEY"])),
    channel: stringSetting(settings, ["channel", "kolaybi.channel", "KOLAYBI_CHANNEL"], stringToken(tokens, ["channel", "KOLAYBI_CHANNEL"])),
  };
}

function tokenCacheKey(accountConfig: ProviderAccountConfig, apiUrl: string, channel: string, apiKey: string): string {
  return `${accountConfig.account_public_id}:${apiUrl}:${channel}:${apiKey}`;
}

function jsonParse(input: string): unknown {
  return JSON.parse(input);
}

function extractAccessToken(response: KolaybiTransportResponse): string | null {
  try {
    const parsed = jsonParse(response.body);
    if (isRecord(parsed)) {
      const dataToken = stringValue(parsed.data);
      if (dataToken) return dataToken;
      const accessToken = stringValue(parsed.access_token);
      if (accessToken) return accessToken;
      const token = stringValue(parsed.token);
      if (token) return token;
    }
  } catch {
    return null;
  }
  return null;
}

function appendInvoiceItems(form: URLSearchParams, payload: Record<string, unknown>): void {
  const items = Array.isArray(payload.items)
    ? payload.items
    : Array.isArray(payload.kalemler)
      ? payload.kalemler
      : [];

  items.forEach((item, index) => {
    if (!isRecord(item)) return;
    const productId = payloadString(item, ["product_id", "kolaybi_product_id"]);
    if (productId) form.append(`items[${index}][product_id]`, productId);
    form.append(`items[${index}][quantity]`, payloadString(item, ["quantity", "miktar"], "1"));
    form.append(`items[${index}][unit_price]`, payloadString(item, ["unit_price", "birim_fiyat"], "0"));
    form.append(`items[${index}][vat_rate]`, payloadString(item, ["vat_rate", "kdv_orani"], "20"));
    form.append(`items[${index}][description]`, payloadString(item, ["description", "urun_adi"], "Urun"));
  });
}

function invoiceForm(envelope: ProviderRequestEnvelope): string {
  const payload = envelope.payload;
  const form = new URLSearchParams();
  const contactId = payloadString(payload, ["contact_id", "kolaybi_contact_id"]);
  const addressId = payloadString(payload, ["address_id", "kolaybi_address_id"]);
  const orderDate = payloadString(payload, ["order_date", "siparis_tarihi"]);
  const currency = payloadString(payload, ["currency"], "try").toLowerCase();
  const description = payloadString(payload, ["description", "siparis_no", "order_public_id"]);

  if (contactId) form.append("contact_id", contactId);
  if (addressId) form.append("address_id", addressId);
  if (orderDate) form.append("order_date", orderDate);
  form.append("currency", currency);
  if (description) form.append("description", description.startsWith("Siparis:") ? description : `Siparis: ${description}`);
  appendInvoiceItems(form, payload);

  if (!Array.isArray(payload.items) && !Array.isArray(payload.kalemler)) {
    const totalAmount = payloadNumber(payload, ["total_amount", "genel_toplam"], 0);
    const unitPrice = Math.round((totalAmount / 1.2) * 100) / 100;
    form.append("items[0][quantity]", "1");
    form.append("items[0][unit_price]", String(unitPrice));
    form.append("items[0][vat_rate]", "20");
    form.append("items[0][description]", payloadString(payload, ["item_description"], "Urun"));
  }

  return form.toString();
}

function tokenRequest(accountConfig: ProviderAccountConfig, policy: LiveProviderTransportPolicy): KolaybiTransportRequest {
  const creds = credentials(accountConfig);
  return {
    method: "POST",
    url: `${creds.apiUrl}/access_token`,
    headers: {
      Channel: creds.channel,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ api_key: creds.apiKey }),
    timeout_ms: policy.timeout_ms,
    kolaybi_endpoint: "access_token",
  };
}

function invoiceRequest(
  envelope: ProviderRequestEnvelope,
  accountConfig: ProviderAccountConfig,
  policy: LiveProviderTransportPolicy,
  token: string,
): KolaybiTransportRequest {
  const creds = credentials(accountConfig);
  return {
    method: "POST",
    url: `${creds.apiUrl}/invoices`,
    headers: {
      Authorization: `Bearer ${token}`,
      Channel: creds.channel,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: invoiceForm(envelope),
    timeout_ms: policy.timeout_ms,
    kolaybi_endpoint: "invoices",
  };
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      const normalized = key.toLowerCase();
      if (normalized === "authorization" || normalized === "x-api-key" || normalized.includes("token")) {
        return [key, "[redacted]"];
      }
      return [key, value];
    }),
  );
}

function redactBody(request: KolaybiTransportRequest): string {
  if (request.kolaybi_endpoint === "access_token") {
    return JSON.stringify({ api_key: "[redacted]" });
  }
  return request.body;
}

function redactRequest(request: KolaybiTransportRequest): Record<string, unknown> {
  return {
    method: request.method,
    url: request.url,
    headers: redactHeaders(request.headers),
    body: redactBody(request),
    timeout_ms: request.timeout_ms,
    kolaybi_endpoint: request.kolaybi_endpoint,
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

function createAttempt(input: {
  envelope: ProviderRequestEnvelope;
  job: JobEnvelope;
  startedAt: Date;
  endedAt: Date;
  statusCode: number | null;
  status: ProviderAttempt["status"];
  retryDecision: ProviderAttempt["retry_decision"];
  nextRetryAt: string | null;
  request: KolaybiTransportRequest;
  requests: KolaybiTransportRequest[];
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
      transport: "kolaybi-rest",
      request: {
        ...redactRequest(input.request),
        attempts: input.requests.map((request) => redactRequest(request)),
      },
      ...(input.retry ? { retry: input.retry } : {}),
    },
    response_metadata: input.response,
    error: input.error,
  });
}

export async function defaultKolaybiFetchTransport(request: KolaybiTransportRequest): Promise<KolaybiTransportResponse> {
  return fetchLiveHttpTransport(request, "KolayBi");
}

function responseMetadata(response: KolaybiTransportResponse, calls: KolaybiCallRecord[]): Record<string, unknown> {
  const finalCall = calls.at(-1);
  const bodyPreview = finalCall?.request.kolaybi_endpoint === "access_token"
    ? "[redacted]"
    : response.body.slice(0, 800);
  return {
    live_call_performed: true,
    accepted: response.status >= 200 && response.status < 300,
    status_code: response.status,
    headers: response.headers,
    body_bytes: Buffer.byteLength(response.body, "utf8"),
    body_preview: bodyPreview,
    calls: calls.map((call) => ({
      kolaybi_endpoint: call.request.kolaybi_endpoint,
      status_code: call.response.status,
      body_bytes: Buffer.byteLength(call.response.body, "utf8"),
      body_preview: call.request.kolaybi_endpoint === "access_token"
        ? "[redacted]"
        : call.response.body.slice(0, 800),
    })),
  };
}

function retryDecision(input: KolaybiLiveAdapterInput, endedAt: Date, statusCode?: number | null, errorCode?: string): ProviderRetryDecision {
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

async function performRequest(
  input: KolaybiLiveAdapterInput,
  request: KolaybiTransportRequest,
  calls: KolaybiCallRecord[],
  requests: KolaybiTransportRequest[],
): Promise<KolaybiTransportResponse> {
  const transport = input.transport ?? defaultKolaybiFetchTransport;
  requests.push(request);
  try {
    const response = await transport(request);
    calls.push({ request, response });
    return response;
  } catch (error) {
    const endedAt = input.now ? new Date(input.now) : new Date();
    const decision = retryDecision(input, endedAt, null, failureCode(error));
    const attempt = createAttempt({
      envelope: input.envelope,
      job: input.job,
      startedAt: input.now ?? new Date(),
      endedAt,
      statusCode: null,
      status: decision.status,
      retryDecision: decision.retry_decision,
      nextRetryAt: decision.next_retry_at,
      request,
      requests,
      response: { live_call_performed: true, accepted: false },
      error: { code: failureCode(error), message: failureMessage(error, "KolayBi transport failed") },
      retry: retryMetadata(decision),
    });
    throw new KolaybiLiveTransportError(failureMessage(error, "KolayBi transport failed"), attempt);
  }
}

function throwFailure(
  input: KolaybiLiveAdapterInput,
  request: KolaybiTransportRequest,
  requests: KolaybiTransportRequest[],
  calls: KolaybiCallRecord[],
  response: KolaybiTransportResponse,
  errorCode: "provider_http_error" | "malformed_response",
  message: string,
): never {
  const endedAt = input.now ? new Date(input.now) : new Date();
  const decision = retryDecision(input, endedAt, response.status, errorCode === "malformed_response" ? errorCode : undefined);
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
    requests,
    response: responseMetadata(response, calls),
    error: { code: errorCode, message },
    retry: retryMetadata(decision),
  });
  throw new KolaybiLiveTransportError(message, attempt);
}

async function accessToken(
  input: KolaybiLiveAdapterInput,
  calls: KolaybiCallRecord[],
  requests: KolaybiTransportRequest[],
  forceRefresh = false,
): Promise<string> {
  const creds = credentials(input.accountConfig);
  const cacheKey = tokenCacheKey(input.accountConfig, creds.apiUrl, creds.channel, creds.apiKey);
  const cached = tokenCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() < cached.expiresAt) {
    return cached.token;
  }

  const request = tokenRequest(input.accountConfig, input.policy);
  const response = await performRequest(input, request, calls, requests);
  if (response.status === 429 || response.status >= 500 || response.status === 401) {
    tokenCache.delete(cacheKey);
    throwFailure(input, request, requests, calls, response, "provider_http_error", `KolayBi token request returned HTTP ${response.status}`);
  }
  const token = extractAccessToken(response);
  if (!token) {
    tokenCache.delete(cacheKey);
    throwFailure(input, request, requests, calls, response, "malformed_response", "KolayBi token response could not be normalized");
  }
  tokenCache.set(cacheKey, { token, expiresAt: Date.now() + 23 * 60 * 60 * 1000 });
  return token;
}

function normalizeInvoiceResponse(response: KolaybiTransportResponse): Record<string, unknown> | null {
  try {
    const parsed = jsonParse(response.body);
    if (!isRecord(parsed) || parsed.success === false) return null;
    return {
      success: true,
      data: isRecord(parsed.data) ? parsed.data : parsed,
    };
  } catch {
    return null;
  }
}

export async function sendKolaybiLiveRequest(input: KolaybiLiveAdapterInput): Promise<KolaybiLiveAdapterResult> {
  const startedAt = input.now ?? new Date();
  const calls: KolaybiCallRecord[] = [];
  const requests: KolaybiTransportRequest[] = [];

  if (input.envelope.operation !== "invoice.create") {
    throw new Error(`Unsupported KolayBi operation: ${input.envelope.operation}`);
  }

  let token = await accessToken(input, calls, requests);
  let request = invoiceRequest(input.envelope, input.accountConfig, input.policy, token);
  let response = await performRequest(input, request, calls, requests);

  if (response.status === 401) {
    token = await accessToken(input, calls, requests, true);
    request = invoiceRequest(input.envelope, input.accountConfig, input.policy, token);
    response = await performRequest(input, request, calls, requests);
  }

  if (response.status === 429 || response.status >= 500 || response.status === 401) {
    throwFailure(input, request, requests, calls, response, "provider_http_error", `KolayBi returned HTTP ${response.status}`);
  }

  const payload = normalizeInvoiceResponse(response);
  if (!payload) {
    throwFailure(input, request, requests, calls, response, "malformed_response", "KolayBi response could not be normalized");
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
      requests,
      response: responseMetadata(response, calls),
      error: null,
    }),
  };
}
