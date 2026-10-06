import type { JobEnvelope, ProviderAttempt, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { providerAttemptCorrelationMetadata } from "./correlation.js";
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
  kolaybi_endpoint: KolaybiEndpoint;
}

export type KolaybiEndpoint =
  | "access_token"
  | "invoices"
  | "invoices.show"
  | "invoices.e_document.create"
  | "invoices.e_document.cancel"
  | "associates.list"
  | "associates.create"
  | "associates.update"
  | "invoices.proceed"
  | "products.list";

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
      ...providerAttemptCorrelationMetadata(input.job, input.envelope),
      queue: input.job.queue,
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
  errorCode: "provider_http_error" | "malformed_response" | "provider_rejected",
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

type KolaybiRequestBuilder = (token: string) => KolaybiTransportRequest;

interface KolaybiCallContext {
  input: KolaybiLiveAdapterInput;
  calls: KolaybiCallRecord[];
  requests: KolaybiTransportRequest[];
  token: string;
}

interface KolaybiOperationResult {
  request: KolaybiTransportRequest;
  response: KolaybiTransportResponse;
  payload: Record<string, unknown>;
}

function authHeaders(accountConfig: ProviderAccountConfig, token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Channel: credentials(accountConfig).channel,
  };
}

function formHeaders(accountConfig: ProviderAccountConfig, token: string): Record<string, string> {
  return {
    ...authHeaders(accountConfig, token),
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

function getRequest(
  input: KolaybiLiveAdapterInput,
  path: string,
  endpoint: KolaybiEndpoint,
  headers: Record<string, string>,
): KolaybiTransportRequest {
  return {
    method: "GET",
    url: `${credentials(input.accountConfig).apiUrl}${path}`,
    headers,
    body: "",
    timeout_ms: input.policy.timeout_ms,
    kolaybi_endpoint: endpoint,
  };
}

function postFormRequest(
  input: KolaybiLiveAdapterInput,
  path: string,
  endpoint: KolaybiEndpoint,
  token: string,
  form: URLSearchParams,
): KolaybiTransportRequest {
  return {
    method: "POST",
    url: `${credentials(input.accountConfig).apiUrl}${path}`,
    headers: formHeaders(input.accountConfig, token),
    body: form.toString(),
    timeout_ms: input.policy.timeout_ms,
    kolaybi_endpoint: endpoint,
  };
}

/**
 * Performs one authorized KolayBi call, refreshing the bearer token once on HTTP 401
 * (legacy getKolayBiToken cache semantics). Any HTTP status >= 400 becomes a provider failure.
 */
async function authorizedCall(
  context: KolaybiCallContext,
  build: KolaybiRequestBuilder,
): Promise<{ request: KolaybiTransportRequest; response: KolaybiTransportResponse }> {
  const { input, calls, requests } = context;
  let request = build(context.token);
  let response = await performRequest(input, request, calls, requests);
  if (response.status === 401) {
    context.token = await accessToken(input, calls, requests, true);
    request = build(context.token);
    response = await performRequest(input, request, calls, requests);
  }
  if (response.status >= 400) {
    const timeoutHint = (response.status === 504 || response.status === 524) &&
      request.kolaybi_endpoint === "invoices.e_document.create"
      ? " (GIB yanit vermedi; e-belge olusmus olabilir, invoice.get ile durumu kontrol edin)"
      : "";
    throwFailure(input, request, requests, calls, response, "provider_http_error", `KolayBi returned HTTP ${response.status}${timeoutHint}`);
  }
  return { request, response };
}

function parseJsonRecord(
  context: KolaybiCallContext,
  request: KolaybiTransportRequest,
  response: KolaybiTransportResponse,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = jsonParse(response.body);
  } catch {
    parsed = null;
  }
  if (!isRecord(parsed)) {
    throwFailure(context.input, request, context.requests, context.calls, response, "malformed_response", "KolayBi response could not be normalized");
  }
  if (parsed.success === false) {
    const message = stringValue(parsed.message) || stringValue(parsed.error) || "KolayBi rejected the request";
    throwFailure(context.input, request, context.requests, context.calls, response, "provider_rejected", message);
  }
  return parsed;
}

function requiredPayloadString(payload: Record<string, unknown>, keys: string[], label: string): string {
  const value = payloadString(payload, keys);
  if (!value) throw new Error(`KolayBi ${label} is missing`);
  return value;
}

function recordList(input: unknown): Record<string, unknown>[] {
  return Array.isArray(input) ? input.filter(isRecord) : [];
}

function firstAddressId(contact: Record<string, unknown>): string | number | null {
  const addresses = contact.address ?? contact.addresses;
  if (Array.isArray(addresses)) {
    const first = addresses.find(isRecord);
    const id = first?.id;
    return typeof id === "string" || typeof id === "number" ? id : null;
  }
  if (isRecord(addresses) && (typeof addresses.id === "string" || typeof addresses.id === "number")) {
    return addresses.id;
  }
  return null;
}

/** Legacy normalTelefon: last 10 digits after stripping 0090/090/90/0 prefixes. */
export function normalizeKolaybiPhone(input: string): string {
  let digits = input.replace(/[^\d]/g, "");
  if (digits.startsWith("0090")) digits = digits.slice(4);
  else if (digits.startsWith("090")) digits = digits.slice(3);
  else if (digits.startsWith("90") && digits.length >= 12) digits = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
  return digits.slice(-10);
}

function lastTenDigits(input: string): string {
  return input.replace(/\D/g, "").slice(-10);
}

async function eDocumentCreate(context: KolaybiCallContext): Promise<KolaybiOperationResult> {
  const payload = context.input.envelope.payload;
  const documentId = requiredPayloadString(payload, ["document_id", "invoice_id", "kolaybi_invoice_id"], "e-document document_id");
  const { request, response } = await authorizedCall(context, (token) => {
    const form = new URLSearchParams();
    form.append("document_id", documentId);
    return postFormRequest(context.input, "/invoices/e-document/create", "invoices.e_document.create", token, form);
  });
  const parsed = parseJsonRecord(context, request, response);
  return {
    request,
    response,
    payload: { success: true, document_id: documentId, data: isRecord(parsed.data) ? parsed.data : parsed },
  };
}

async function eDocumentCancel(context: KolaybiCallContext): Promise<KolaybiOperationResult> {
  const payload = context.input.envelope.payload;
  const documentId = requiredPayloadString(payload, ["document_id", "invoice_id", "kolaybi_invoice_id"], "e-document cancel document_id");
  const cancelDate = requiredPayloadString(payload, ["cancel_date"], "e-document cancel_date");
  const cancelTime = payloadString(payload, ["cancel_time"]);
  const { request, response } = await authorizedCall(context, (token) => {
    const form = new URLSearchParams();
    form.append("document_id", documentId);
    form.append("cancel_date", cancelDate);
    if (cancelTime) form.append("cancel_time", cancelTime);
    return postFormRequest(context.input, "/invoices/e-document/cancel", "invoices.e_document.cancel", token, form);
  });
  const parsed = parseJsonRecord(context, request, response);
  return {
    request,
    response,
    payload: { success: true, document_id: documentId, data: isRecord(parsed.data) ? parsed.data : parsed },
  };
}

async function invoiceGet(context: KolaybiCallContext): Promise<KolaybiOperationResult> {
  const payload = context.input.envelope.payload;
  const invoiceId = requiredPayloadString(payload, ["invoice_id", "document_id", "kolaybi_invoice_id"], "invoice_id");
  const { request, response } = await authorizedCall(context, (token) =>
    getRequest(context.input, `/invoices/${encodeURIComponent(invoiceId)}`, "invoices.show", authHeaders(context.input.accountConfig, token)),
  );
  const parsed = parseJsonRecord(context, request, response);
  // Legacy: GET /invoices/{id} only returns { data: { uuid } }; uuid present => sent to GIB.
  const invoiceData = isRecord(parsed.data) ? parsed.data : parsed;
  const uuid = stringValue(invoiceData.uuid) || null;
  const numericId = Number(invoiceId);
  return {
    request,
    response,
    payload: {
      success: true,
      data: {
        invoice_id: Number.isFinite(numericId) ? numericId : invoiceId,
        e_document_status: uuid ? "sent" : "ready",
        e_document_uuid: uuid,
        e_document_date: null,
        is_e_document: !!uuid,
        send_type: null,
      },
    },
  };
}

function contactSummary(contact: Record<string, unknown>): Record<string, unknown> {
  return {
    id: contact.id ?? null,
    full_name: stringValue(contact.full_name) || `${stringValue(contact.name)} ${stringValue(contact.surname)}`.replace(/\s+/g, " ").trim(),
    identity_no: contact.identity_no ?? null,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    tax_office: contact.tax_office ?? null,
    address_id: firstAddressId(contact),
  };
}

async function contactFind(context: KolaybiCallContext): Promise<KolaybiOperationResult> {
  const payload = context.input.envelope.payload;
  const phone = payloadString(payload, ["phone", "musteri_telefon", "telefon"]);
  const phoneKey = lastTenDigits(phone);
  // Legacy kolaybiCariBulByKey derives the unique keys exactly like the cari create form.
  const identityNo = payloadString(payload, ["identity_no", "musteri_tckn"], phoneKey ? `1${phoneKey}` : "");
  const email = payloadString(payload, ["email", "musteri_email"], phoneKey ? `${phoneKey}@garantikulucka.com` : "");
  let last: { request: KolaybiTransportRequest; response: KolaybiTransportResponse } | null = null;

  const filters: Array<["identity_no" | "email", string]> = [["identity_no", identityNo], ["email", email]];
  for (const [key, value] of filters) {
    if (!value) continue;
    last = await authorizedCall(context, (token) =>
      getRequest(
        context.input,
        `/associates?${key}=${encodeURIComponent(value)}&per_page=50`,
        "associates.list",
        authHeaders(context.input.accountConfig, token),
      ),
    );
    const list = recordList(parseJsonRecord(context, last.request, last.response).data);
    const exact = list.find((contact) =>
      key === "identity_no"
        ? stringValue(contact.identity_no) === value
        : stringValue(contact.email).toLowerCase() === value.toLowerCase(),
    );
    const found = exact ?? (list.length === 1 ? list[0] : undefined);
    if (found) {
      return { ...last, payload: { success: true, found: true, matched_by: key, contact: contactSummary(found) } };
    }
  }

  // Legacy kolaybiMusteriAra fallback: page through associates (250/page, max 10 pages) by phone.
  const normalizedPhone = normalizeKolaybiPhone(phone);
  if (normalizedPhone.length >= 10) {
    const perPage = 250;
    for (let page = 1; page <= 10; page += 1) {
      const params = new URLSearchParams({ per_page: String(perPage), page: String(page) });
      last = await authorizedCall(context, (token) =>
        getRequest(context.input, `/associates?${params.toString()}`, "associates.list", authHeaders(context.input.accountConfig, token)),
      );
      const list = recordList(parseJsonRecord(context, last.request, last.response).data);
      if (list.length === 0) break;
      const match = list.find((contact) => {
        const candidate = normalizeKolaybiPhone(stringValue(contact.phone));
        return candidate.length >= 10 && candidate === normalizedPhone;
      });
      if (match) {
        return { ...last, payload: { success: true, found: true, matched_by: "phone", contact: contactSummary(match) } };
      }
      if (list.length < perPage) break;
    }
  }

  if (!last) throw new Error("KolayBi contact lookup requires identity_no, email or phone");
  return { ...last, payload: { success: true, found: false, matched_by: null, contact: null } };
}

function contactForm(payload: Record<string, unknown>, now: Date): URLSearchParams {
  const rawName = payloadString(payload, ["musteri_ad", "full_name", "customer_name"]);
  // Legacy: strip cargo suffixes (PTT/Surat) and collapse whitespace before splitting name/surname.
  const cleanName = rawName
    .replace(/\s*(PTT\s*S[uü]rat|S[uü]rat\s*Kargo|PTT\s*Kargo|S[uü]rat|PTT)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleanName.split(/\s+/);
  const name = payloadString(payload, ["name"], parts[0] || cleanName);
  const surname = payloadString(payload, ["surname"], parts.length > 1 ? parts.slice(1).join(" ") : cleanName);
  if (!name) throw new Error("KolayBi contact name is missing");

  const phone = payloadString(payload, ["phone", "musteri_telefon", "telefon"]);
  const phoneKey = lastTenDigits(phone);
  const isCorporate = payload.is_corporate === true || payload.musteri_is_corporate === true;
  const form = new URLSearchParams();
  form.append("is_corporate", isCorporate ? "true" : "false");
  form.append("associate_type", "customer");
  form.append("name", name);
  form.append("surname", surname);
  form.append("identity_no", payloadString(payload, ["identity_no", "musteri_tckn"], phoneKey ? `1${phoneKey}` : "11111111111"));
  form.append(
    "email",
    payloadString(payload, ["email", "musteri_email"], phoneKey ? `${phoneKey}@garantikulucka.com` : `musteri${now.getTime()}@garantikulucka.com`),
  );
  const taxOffice = payloadString(payload, ["tax_office", "musteri_tax_office"], "Diğer");
  if (taxOffice && payload.skip_tax_office !== true) form.append("tax_office", taxOffice);
  if (phone) {
    let tel = phone.replace(/\D/g, "").replace(/^0/, "");
    if (tel.length === 10) tel = `+90${tel}`;
    else if (tel.length === 12 && tel.startsWith("90")) tel = `+${tel}`;
    else if (!tel.startsWith("+")) tel = `+90${tel}`;
    form.append("phone", tel);
  }
  const address = payloadString(payload, ["address", "musteri_adres"]);
  const city = payloadString(payload, ["city", "musteri_il"]);
  if ((address || city) && payload.skip_address !== true) {
    const district = payloadString(payload, ["district", "musteri_ilce"]);
    const country = payloadString(payload, ["country", "musteri_ulke"]);
    if (address) form.append("addresses[address]", address);
    if (city) form.append("addresses[city]", city);
    if (district) form.append("addresses[district]", district);
    if (country) form.append("addresses[country]", country);
    form.append("addresses[address_type]", payloadString(payload, ["address_type"], "invoice"));
  }
  return form;
}

async function contactCreate(context: KolaybiCallContext): Promise<KolaybiOperationResult> {
  const now = context.input.now ?? new Date();
  const form = contactForm(context.input.envelope.payload, now);
  const { request, response } = await authorizedCall(context, (token) =>
    postFormRequest(context.input, "/associates", "associates.create", token, form),
  );
  const parsed = parseJsonRecord(context, request, response);
  const data = isRecord(parsed.data) ? parsed.data : parsed;
  const contactId = data.id ?? null;
  if (contactId === null) {
    throwFailure(context.input, request, context.requests, context.calls, response, "malformed_response", "KolayBi contact response did not include an id");
  }
  return {
    request,
    response,
    payload: { success: true, contact_id: contactId, address_id: firstAddressId(data) },
  };
}

/** Legacy cariHesaplar.guncelle: `PUT /associates/{id}` with a JSON body built like the create form. */
async function contactUpdate(context: KolaybiCallContext): Promise<KolaybiOperationResult> {
  const payload = context.input.envelope.payload;
  const contactId = requiredPayloadString(payload, ["contact_id", "kolaybi_contact_id"], "contact_id");
  const form = contactForm(payload, context.input.now ?? new Date());
  const body: Record<string, unknown> = {};
  const address: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    const nested = /^addresses\[(\w+)\]$/.exec(key);
    if (nested?.[1]) address[nested[1]] = value;
    else body[key] = key === "is_corporate" ? value === "true" : value;
  }
  if (Object.keys(address).length > 0) body.addresses = [address];
  const { request, response } = await authorizedCall(context, (token) => ({
    method: "PUT",
    url: `${credentials(context.input.accountConfig).apiUrl}/associates/${encodeURIComponent(contactId)}`,
    headers: { ...authHeaders(context.input.accountConfig, token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeout_ms: context.input.policy.timeout_ms,
    kolaybi_endpoint: "associates.update",
  }));
  const parsed = parseJsonRecord(context, request, response);
  const data = isRecord(parsed.data) ? parsed.data : parsed;
  return { request, response, payload: { success: true, contact_id: data.id ?? contactId, address_id: firstAddressId(data) } };
}

/** Legacy faturalar.tahsilatYap: `POST /invoices/proceed` (document_id, vault_id, optional amount). */
async function invoicePaymentCreate(context: KolaybiCallContext): Promise<KolaybiOperationResult> {
  const payload = context.input.envelope.payload;
  const documentId = requiredPayloadString(payload, ["document_id", "invoice_id", "kolaybi_invoice_id"], "tahsilat document_id");
  const vaultId = requiredPayloadString(payload, ["vault_id"], "tahsilat vault_id");
  const amount = payloadString(payload, ["amount"]);
  const { request, response } = await authorizedCall(context, (token) => {
    const form = new URLSearchParams();
    form.append("document_id", documentId);
    form.append("vault_id", vaultId);
    if (amount) form.append("amount", amount);
    return postFormRequest(context.input, "/invoices/proceed", "invoices.proceed", token, form);
  });
  const parsed = parseJsonRecord(context, request, response);
  const data = isRecord(parsed.data) ? parsed.data : parsed;
  return { request, response, payload: { success: true, document_id: documentId, payment_id: data.id ?? null, data } };
}

async function productList(context: KolaybiCallContext): Promise<KolaybiOperationResult> {
  const payload = context.input.envelope.payload;
  const perPage = Math.max(1, Math.trunc(payloadNumber(payload, ["per_page"], 200)));
  const maxPages = Math.max(1, Math.min(20, Math.trunc(payloadNumber(payload, ["max_pages"], 20))));
  const creds = credentials(context.input.accountConfig);
  const products: Record<string, unknown>[] = [];
  let last: { request: KolaybiTransportRequest; response: KolaybiTransportResponse } | null = null;

  for (let page = 1; page <= maxPages; page += 1) {
    // Legacy /api/kolaybi/urunler sends x-api-key + x-channel-code alongside the bearer token.
    last = await authorizedCall(context, (token) =>
      getRequest(context.input, `/products?per_page=${perPage}&page=${page}`, "products.list", {
        Authorization: `Bearer ${token}`,
        "x-api-key": creds.apiKey,
        "x-channel-code": creds.channel,
      }),
    );
    const list = recordList(parseJsonRecord(context, last.request, last.response).data);
    products.push(...list);
    if (list.length < perPage) break;
  }

  if (!last) throw new Error("KolayBi product list did not perform a request");
  return {
    ...last,
    payload: {
      success: true,
      toplam: products.length,
      urunler: products.map((product) => ({
        id: product.id ?? null,
        name: product.name ?? null,
        sale_price: product.sale_price ?? null,
        stock_quantity: product.total_stock_quantity ?? null,
        unit: product.sale_unit_description ?? null,
        category: product.category ?? null,
      })),
    },
  };
}

const kolaybiOperations: Partial<Record<ProviderRequestEnvelope["operation"], (context: KolaybiCallContext) => Promise<KolaybiOperationResult>>> = {
  "invoice.e_document.create": eDocumentCreate,
  "invoice.e_document.cancel": eDocumentCancel,
  "invoice.get": invoiceGet,
  "contact.find": contactFind,
  "contact.create": contactCreate,
  "contact.update": contactUpdate,
  "invoice.payment.create": invoicePaymentCreate,
  "product.list": productList,
};

export async function sendKolaybiLiveRequest(input: KolaybiLiveAdapterInput): Promise<KolaybiLiveAdapterResult> {
  const startedAt = input.now ?? new Date();
  const calls: KolaybiCallRecord[] = [];
  const requests: KolaybiTransportRequest[] = [];

  const operation = kolaybiOperations[input.envelope.operation];
  if (operation) {
    const context: KolaybiCallContext = { input, calls, requests, token: await accessToken(input, calls, requests) };
    const result = await operation(context);
    const endedAt = input.now ? new Date(input.now) : new Date();
    return {
      response_payload: result.payload,
      attempt: createAttempt({
        envelope: input.envelope,
        job: input.job,
        startedAt,
        endedAt,
        statusCode: result.response.status,
        status: "success",
        retryDecision: "none",
        nextRetryAt: null,
        request: result.request,
        requests,
        response: responseMetadata(result.response, calls),
        error: null,
      }),
    };
  }

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
