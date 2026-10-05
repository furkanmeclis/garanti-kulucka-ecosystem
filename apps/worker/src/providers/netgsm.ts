import type { JobEnvelope, ProviderAttempt, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { providerAttemptSchema } from "@garanti-kulucka/shared";
import type { ProviderAccountConfig } from "./account-config.js";
import { providerAttemptCorrelationMetadata } from "./correlation.js";
import { failureCode, failureMessage, fetchLiveHttpTransport } from "./live-http.js";
import { decideProviderRetry, type ProviderRetryDecision } from "./retry.js";
import type { LiveProviderTransportPolicy } from "./transport-policy.js";

export interface NetgsmTransportResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface NetgsmTransportRequest {
  method: "POST";
  url: string;
  headers: Record<string, string>;
  body: string;
  timeout_ms: number;
  netgsm_endpoint: "sms.send.xml";
}

export type NetgsmFetchTransport = (request: NetgsmTransportRequest) => Promise<NetgsmTransportResponse>;

export interface NetgsmLiveAdapterInput {
  envelope: ProviderRequestEnvelope;
  job: JobEnvelope;
  accountConfig: ProviderAccountConfig;
  policy: LiveProviderTransportPolicy;
  attemptNumber: number;
  maxAttempts: number;
  transport?: NetgsmFetchTransport;
  now?: Date;
}

export interface NetgsmLiveAdapterResult {
  attempt: ProviderAttempt;
  response_payload: Record<string, unknown>;
}

export class NetgsmLiveTransportError extends Error {
  constructor(
    message: string,
    readonly attempt: ProviderAttempt,
  ) {
    super(message);
    this.name = "NetgsmLiveTransportError";
  }
}

const defaultNetgsmApiUrl = "https://api.netgsm.com.tr";
const successCodes = new Set(["00", "01", "02"]);
const terminalErrorMessages: Record<string, string> = {
  "20": "Mesaj metni bulunamadi",
  "30": "Gecersiz kullanici adi veya sifre",
  "40": "Gecersiz mesaj basligi",
  "50": "Yetersiz kredi",
  "51": "Mesaj basligi onaylanmamis",
  "70": "Gecersiz XML formati",
  "80": "Mesaj limiti asildi",
  "85": "Mukerrer mesaj engeli",
};

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

function payloadNumber(payload: Record<string, unknown>, keys: string[], fallback = 0): number {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback;
}

function escapeXml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function cleanPhone(input: string): string {
  return input.replace(/\D/g, "");
}

function recipientPhones(payload: Record<string, unknown>): string[] {
  const value = payload.recipient_phones ?? payload.telefonlar ?? payload.phones ?? payload.recipient_phone ?? payload.telefon ?? payload.phone;
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => cleanPhone(String(item ?? ""))).filter((item) => item.length >= 10);
}

function credentials(accountConfig: ProviderAccountConfig): {
  apiUrl: string;
  usercode: string;
  password: string;
  msgheader: string;
} {
  const { settings, tokens } = accountConfig;
  return {
    apiUrl: stringSetting(settings, ["api_url", "netgsm.api_url", "NETGSM_API_URL"], defaultNetgsmApiUrl).replace(/\/+$/, ""),
    usercode: stringToken(
      tokens,
      ["sms_usercode", "usercode", "NETGSM_SMS_USERCODE", "NETGSM_USERCODE"],
      stringSetting(settings, ["sms_usercode", "usercode", "NETGSM_SMS_USERCODE", "NETGSM_USERCODE"]),
    ),
    password: stringToken(
      tokens,
      ["sms_password", "password", "NETGSM_SMS_PASSWORD", "NETGSM_PASSWORD"],
      stringSetting(settings, ["sms_password", "password", "NETGSM_SMS_PASSWORD", "NETGSM_PASSWORD"]),
    ),
    msgheader: stringSetting(settings, ["msgheader", "sms_msgheader", "NETGSM_MSGHEADER"]),
  };
}

function buildXml(input: {
  usercode: string;
  password: string;
  msgheader: string;
  message: string;
  phones: string[];
  dil: string;
  filter: number;
  startDate: string;
  stopDate: string;
}): string {
  const noTags = input.phones.map((phone) => `<no>${phone}</no>`).join("\n    ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<mainbody>
  <header>
    <company dil="${input.dil}">Netgsm</company>
    <usercode>${input.usercode}</usercode>
    <password>${input.password}</password>
    <type>1:n</type>
    <msgheader>${escapeXml(input.msgheader)}</msgheader>
    ${input.filter ? `<filter>${input.filter}</filter>` : ""}
    ${input.startDate ? `<startdate>${input.startDate}</startdate>` : ""}
    ${input.stopDate ? `<stopdate>${input.stopDate}</stopdate>` : ""}
  </header>
  <body>
    <msg><![CDATA[${input.message}]]></msg>
    ${noTags}
  </body>
</mainbody>`;
}

function createRequest(
  envelope: ProviderRequestEnvelope,
  accountConfig: ProviderAccountConfig,
  policy: LiveProviderTransportPolicy,
): NetgsmTransportRequest {
  const creds = credentials(accountConfig);
  const payload = envelope.payload;
  const msgheader = payloadString(payload, ["msgheader", "sender", "sender_title"], creds.msgheader);
  const message = payloadString(payload, ["message", "metin", "text", "body"]);
  const phones = recipientPhones(payload);
  if (!creds.usercode || !creds.password) throw new Error("NetGSM SMS credentials are missing");
  if (!msgheader) throw new Error("NetGSM SMS msgheader is missing");
  if (!message) throw new Error("NetGSM SMS message is missing");
  if (phones.length === 0) throw new Error("NetGSM SMS recipient phone is missing");

  return {
    method: "POST",
    url: `${creds.apiUrl}/sms/send/xml/`,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
    body: buildXml({
      usercode: creds.usercode,
      password: creds.password,
      msgheader,
      message,
      phones,
      dil: payloadString(payload, ["dil", "encoding", "language"], "TR"),
      filter: payloadNumber(payload, ["filter"], 0),
      startDate: payloadString(payload, ["baslangicTarih", "startdate", "start_date"]),
      stopDate: payloadString(payload, ["bitisTarih", "stopdate", "stop_date"]),
    }),
    timeout_ms: policy.timeout_ms,
    netgsm_endpoint: "sms.send.xml",
  };
}

function parseResponse(body: string): { code: string; jobId: string | null } | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  const code = parts[0];
  if (!code) return null;
  return { code, jobId: parts[1] ?? null };
}

function redactXml(xml: string): string {
  return xml
    .replace(/<usercode>[\s\S]*?<\/usercode>/, "<usercode>[REDACTED]</usercode>")
    .replace(/<password>[\s\S]*?<\/password>/, "<password>[REDACTED]</password>");
}

function redactRequest(request: NetgsmTransportRequest): Record<string, unknown> {
  const url = new URL(request.url);
  return {
    method: request.method,
    netgsm_endpoint: request.netgsm_endpoint,
    origin: url.origin,
    path: url.pathname,
    headers: request.headers,
    body_bytes: Buffer.byteLength(request.body, "utf8"),
    body_preview: redactXml(request.body).slice(0, 1200),
    recipient_count: (request.body.match(/<no>/g) ?? []).length,
    timeout_ms: request.timeout_ms,
  };
}

function responseMetadata(response: NetgsmTransportResponse, parsed: { code: string; jobId: string | null } | null): Record<string, unknown> {
  return {
    live_call_performed: true,
    accepted: parsed ? successCodes.has(parsed.code) : false,
    status_code: response.status,
    body_bytes: Buffer.byteLength(response.body, "utf8"),
    body_preview: response.body.slice(0, 800),
    netgsm_code: parsed?.code ?? null,
    netgsm_job_id: parsed?.jobId ?? null,
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

function retryDecision(input: NetgsmLiveAdapterInput, endedAt: Date, statusCode?: number | null, errorCode?: string): ProviderRetryDecision {
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
  request: NetgsmTransportRequest;
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
      transport: "netgsm-sms-xml",
      request: redactRequest(input.request),
      ...(input.retry ? { retry: input.retry } : {}),
    },
    response_metadata: input.response,
    error: input.error,
  });
}

export async function defaultNetgsmFetchTransport(request: NetgsmTransportRequest): Promise<NetgsmTransportResponse> {
  return fetchLiveHttpTransport(request, "NetGSM");
}

function throwFailure(
  input: NetgsmLiveAdapterInput,
  startedAt: Date,
  request: NetgsmTransportRequest,
  response: NetgsmTransportResponse,
  errorCode: "provider_http_error" | "malformed_response" | "netgsm_error_code",
  message: string,
  parsed: { code: string; jobId: string | null } | null,
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
  throw new NetgsmLiveTransportError(message, attempt);
}

export async function sendNetgsmLiveRequest(input: NetgsmLiveAdapterInput): Promise<NetgsmLiveAdapterResult> {
  const startedAt = input.now ?? new Date();
  if (input.envelope.operation !== "sms.send") {
    throw new Error(`Unsupported NetGSM operation: ${input.envelope.operation}`);
  }

  const request = createRequest(input.envelope, input.accountConfig, input.policy);
  const transport = input.transport ?? defaultNetgsmFetchTransport;
  let response: NetgsmTransportResponse;
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
      error: { code: failureCode(error), message: failureMessage(error, "NetGSM transport failed") },
      retry: retryMetadata(decision),
    });
    throw new NetgsmLiveTransportError(failureMessage(error, "NetGSM transport failed"), attempt);
  }

  const parsed = parseResponse(response.body);
  if (response.status === 429 || response.status >= 500 || response.status >= 400) {
    throwFailure(input, startedAt, request, response, "provider_http_error", `NetGSM returned HTTP ${response.status}`, parsed);
  }
  if (!parsed) {
    throwFailure(input, startedAt, request, response, "malformed_response", "NetGSM response could not be normalized", parsed);
  }
  if (successCodes.has(parsed.code)) {
    if (!parsed.jobId) {
      throwFailure(input, startedAt, request, response, "malformed_response", "NetGSM success response did not include a job id", parsed);
    }
    const endedAt = input.now ? new Date(input.now) : new Date();
    return {
      response_payload: {
        success: true,
        sms_sent: true,
        bulkId: parsed.jobId,
        netgsm_code: parsed.code,
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

  const message = terminalErrorMessages[parsed.code] ?? `Bilinmeyen NetGSM hata kodu: ${parsed.code}`;
  throwFailure(input, startedAt, request, response, "netgsm_error_code", message, parsed);
}
