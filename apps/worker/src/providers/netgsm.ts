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
  method: "POST" | "GET";
  url: string;
  headers: Record<string, string>;
  body: string;
  timeout_ms: number;
  netgsm_endpoint: "sms.send.xml" | "voicesms.send" | "voicesms.report" | "netsantral.report";
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
    .replace(/<password>[\s\S]*?<\/password>/, "<password>[REDACTED]</password>")
    .replace(/"(usercode|password)"\s*:\s*"[^"]*"/g, '"$1":"[REDACTED]"');
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
      transport:
        input.request.netgsm_endpoint === "sms.send.xml"
          ? "netgsm-sms-xml"
          : input.request.netgsm_endpoint === "netsantral.report"
            ? "netgsm-netsantral"
            : "netgsm-voicesms",
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
  if (input.envelope.operation === "call.confirmation.create" || input.envelope.operation === "call.confirmation.status") {
    return sendNetgsmConfirmationCall(input, startedAt);
  }
  if (input.envelope.operation === "call.report") {
    return sendNetgsmCallReport(input, startedAt);
  }
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

// ─── Order confirmation call (legacy "siparis teyit arama" IVR over /voicesms) ───

const defaultTeyitAudioId = "172812485";
const defaultIptalAudioId = "149477742";
const defaultAppUrl = "https://panel.garantikulucka.com";
const confirmationErrorMessages: Record<string, string> = {
  "30": "Gecersiz kullanici adi/sifre veya API erisim izni yok",
  "40": "Ses dosyasi bulunamadi",
  "45": "Telefon numarasi bulunamadi",
  "70": "Parametre hatasi",
};
const reportErrorMessages: Record<string, string> = {
  "30": "Gecersiz kullanici adi/sifre veya API erisim izni yok",
  "40": "Kayit bulunamadi",
  "60": "Marka kodu gecersiz",
  "70": "Hatali sorgulama / parametre hatasi",
  "80": "Sistem hatasi / sinir asimi",
};
const callStatusMap: Record<string, string> = {
  "0": "araniyor",
  "1": "cevaplandi",
  "2": "cevaplanmadi",
  "3": "ulasilamadi",
  "6": "gecersiz_numara",
  "7": "mesgul",
};

function voiceCredentials(accountConfig: ProviderAccountConfig): { apiUrl: string; usercode: string; password: string } {
  const { settings, tokens } = accountConfig;
  const sms = credentials(accountConfig);
  // Legacy resolveTeyitVoiceCredentials: teyit voice account, else NETGSM_VOICE_* -> NETGSM_SMS_* -> NETGSM_*.
  const voiceUsercodeKeys = ["teyit_voice_usercode", "voice_usercode", "NETGSM_VOICE_USERCODE"];
  const voicePasswordKeys = ["teyit_voice_password", "voice_password", "NETGSM_VOICE_PASSWORD"];
  return {
    apiUrl: sms.apiUrl,
    usercode: stringToken(tokens, voiceUsercodeKeys, stringSetting(settings, voiceUsercodeKeys, sms.usercode)),
    password: stringToken(tokens, voicePasswordKeys, stringSetting(settings, voicePasswordKeys, sms.password)),
  };
}

function settingWithEmptyOverride(settings: Record<string, unknown>, key: string, fallback: string): string {
  const value = settings[key];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function zonedParts(date: Date, timeZone: string): { day: string; month: string; year: string; hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return { day: part("day"), month: part("month"), year: part("year"), hour: part("hour"), minute: part("minute") };
}

/** Legacy formatDateDDMMYYYY (ddMMyyyy) in the configured business time zone. */
export function netgsmVoiceDate(date: Date, timeZone = "Europe/Istanbul"): string {
  const { day, month, year } = zonedParts(date, timeZone);
  return `${day}${month}${year}`;
}

/** Legacy formatTimeHHMM (HHmm) in the configured business time zone. */
export function netgsmVoiceTime(date: Date, addMinutes = 0, timeZone = "Europe/Istanbul"): string {
  const { hour, minute } = zonedParts(new Date(date.getTime() + addMinutes * 60_000), timeZone);
  return `${hour}${minute}`;
}

function confirmationCallRequest(input: NetgsmLiveAdapterInput, now: Date): NetgsmTransportRequest {
  const { settings } = input.accountConfig;
  const payload = input.envelope.payload;
  const creds = voiceCredentials(input.accountConfig);
  const phone = cleanPhone(payloadString(payload, ["telefon", "phone", "customer_phone", "recipient_phone"]));
  if (!creds.usercode || !creds.password) throw new Error("NetGSM voice credentials are missing");
  if (!phone) throw new Error("NetGSM confirmation call phone is missing");

  const timeZone = stringSetting(settings, ["timezone", "netgsm.timezone"], "Europe/Istanbul");
  const stop = new Date(now.getTime() + 21 * 60 * 60 * 1000);
  const teyitAudioId = settingWithEmptyOverride(settings, "teyit_audio_id", defaultTeyitAudioId);
  const iptalAudioId = settingWithEmptyOverride(settings, "iptal_audio_id", defaultIptalAudioId);
  const bodyContent = teyitAudioId
    ? `<audioid>${teyitAudioId}</audioid>`
    : `<text>${escapeXml(
        "Sayın müşterimiz, Garanti Kuluçkadan vermiş olduğunuz kuluçka makinası siparişiniz en kısa sürede kargoya verilecektir. " +
          "Siparişi siz vermediyseniz ya da yanlışlık olduğunu düşünüyorsanız, iptal etmek için 9'u tuşlayabilirsiniz. Teşekkürler.",
      )}</text>`;
  const keyContent = iptalAudioId
    ? `<audioid>${iptalAudioId}</audioid>`
    : `<text>${escapeXml("Siparişiniz iptal isteği olarak kaydedilmiştir. Teşekkür ederiz.")}</text>`;
  const appUrl = stringSetting(settings, ["app_url", "APP_URL"], defaultAppUrl).replace(/\/+$/, "");
  const webhookUrl = stringSetting(settings, ["ivr_webhook_url", "voice_webhook_url"], `${appUrl}/api/netgsm/webhook/sesli-mesaj`);

  const xmlBody = `<?xml version='1.0' encoding='UTF-8'?>
<mainbody>
  <header>
    <usercode>${creds.usercode}</usercode>
    <password>${creds.password}</password>
    <startdate>${netgsmVoiceDate(now, timeZone)}</startdate>
    <starttime>${netgsmVoiceTime(now, 1, timeZone)}</starttime>
    <stopdate>${netgsmVoiceDate(stop, timeZone)}</stopdate>
    <stoptime>${netgsmVoiceTime(stop, 0, timeZone)}</stoptime>
    <key>1</key>
    <ringtime>25</ringtime>
    <url>${webhookUrl}</url>
  </header>
  <body>
    ${bodyContent}
    <no>${phone}</no>
    <keys>
      <keydetail>
        <keyinfo>9</keyinfo>
        ${keyContent}
      </keydetail>
    </keys>
  </body>
</mainbody>`;

  return {
    method: "POST",
    url: `${creds.apiUrl}/voicesms/send`,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
    body: xmlBody,
    timeout_ms: input.policy.timeout_ms,
    netgsm_endpoint: "voicesms.send",
  };
}

function confirmationStatusRequest(input: NetgsmLiveAdapterInput): NetgsmTransportRequest {
  const creds = voiceCredentials(input.accountConfig);
  const bulkId = payloadString(input.envelope.payload, ["bulk_id", "ivr_bulk_id", "bulkid"]);
  if (!creds.usercode || !creds.password) throw new Error("NetGSM voice credentials are missing");
  if (!bulkId) throw new Error("NetGSM confirmation call bulk id is missing");
  const url = new URL(`${creds.apiUrl}/voicesms/report`);
  url.searchParams.append("usercode", creds.usercode);
  url.searchParams.append("password", creds.password);
  url.searchParams.append("type", "1");
  url.searchParams.append("bulkid", bulkId);
  return {
    method: "GET",
    url: url.toString(),
    headers: {},
    body: "",
    timeout_ms: input.policy.timeout_ms,
    netgsm_endpoint: "voicesms.report",
  };
}

/** Legacy /api/netgsm/siparis-arama/durum report parsing: telefon|durum|operator|dinleme|basilan_tus. */
export function parseNetgsmConfirmationReport(body: string): Record<string, unknown> {
  const trimmed = body.trim();
  if (trimmed === "50") {
    return { call_status: "araniyor", pressed_key: null, listen_seconds: 0, confirmation_outcome: null, report_ready: false, netgsm_code: "50" };
  }
  if (reportErrorMessages[trimmed]) {
    return {
      call_status: "araniyor",
      pressed_key: null,
      listen_seconds: 0,
      confirmation_outcome: null,
      report_ready: false,
      netgsm_code: trimmed,
      message: reportErrorMessages[trimmed],
    };
  }
  const lines = trimmed.replace(/<br\s*\/?>/gi, "\n").split("\n").filter((line) => line.trim());
  const first = lines[0];
  if (!first) {
    return { call_status: "araniyor", pressed_key: null, listen_seconds: 0, confirmation_outcome: null, report_ready: false, netgsm_code: null };
  }
  const fields = first.split("|").map((field) => field.trim());
  const callStatus = callStatusMap[fields[1] ?? ""] ?? "araniyor";
  const pressedKey = fields[4] ?? "";
  const listenSeconds = Number.parseInt(fields[3] ?? "0", 10) || 0;
  let outcome: string | null = null;
  if (callStatus === "cevaplandi") outcome = pressedKey === "9" ? "iptal_istegi" : "teyit_edildi";
  else if (callStatus === "gecersiz_numara") outcome = "gecersiz_numara";
  else if (["cevaplanmadi", "ulasilamadi", "mesgul"].includes(callStatus)) outcome = "ulasilamadi";
  return {
    call_status: callStatus,
    pressed_key: pressedKey || null,
    listen_seconds: listenSeconds,
    confirmation_outcome: outcome,
    report_ready: callStatus !== "araniyor",
    netgsm_code: null,
  };
}

async function sendNetgsmConfirmationCall(input: NetgsmLiveAdapterInput, startedAt: Date): Promise<NetgsmLiveAdapterResult> {
  const isStatus = input.envelope.operation === "call.confirmation.status";
  const request = isStatus ? confirmationStatusRequest(input) : confirmationCallRequest(input, startedAt);
  const transport = input.transport ?? defaultNetgsmFetchTransport;
  let response: NetgsmTransportResponse;
  try {
    response = await transport(request);
  } catch (error) {
    const endedAt = input.now ? new Date(input.now) : new Date();
    const decision = retryDecision(input, endedAt, null, failureCode(error));
    throw new NetgsmLiveTransportError(
      failureMessage(error, "NetGSM transport failed"),
      createAttempt({
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
      }),
    );
  }

  const parsed = isStatus ? null : parseResponse(response.body);
  if (response.status >= 400) {
    throwFailure(input, startedAt, request, response, "provider_http_error", `NetGSM returned HTTP ${response.status}`, parsed);
  }

  let responsePayload: Record<string, unknown>;
  if (isStatus) {
    responsePayload = {
      success: true,
      bulk_id: payloadString(input.envelope.payload, ["bulk_id", "ivr_bulk_id", "bulkid"]),
      ...parseNetgsmConfirmationReport(response.body),
    };
  } else {
    if (!parsed) {
      throwFailure(input, startedAt, request, response, "malformed_response", "NetGSM response could not be normalized", parsed);
    }
    if (!successCodes.has(parsed.code)) {
      const message = confirmationErrorMessages[parsed.code] ?? `Bilinmeyen hata kodu: ${parsed.code}`;
      throwFailure(input, startedAt, request, response, "netgsm_error_code", message, parsed);
    }
    responsePayload = {
      success: true,
      call_started: true,
      bulkId: parsed.jobId,
      netgsm_code: parsed.code,
      ivr_arama_durumu: "araniyor",
    };
  }

  const endedAt = input.now ? new Date(input.now) : new Date();
  return {
    response_payload: responsePayload,
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

// ─── NetGSM santral CDR report (legacy GET /api/netgsm/cdr → POST /netsantral/report) ───

const cdrErrorMessages: Record<string, string> = {
  "30": "Geçersiz kullanıcı adı veya şifre veya API erişim izni yok",
  "40": "Kayıt bulunamadı veya geçersiz santral bilgisi",
  "70": "Parametre hatası",
  "80": "Sorgu sınırı aşıldı",
  "100": "Sistem hatası",
};

const cdrDirectionLabels: Record<number, string> = {
  0: "Giden Arama",
  1: "Gelen Arama",
  2: "Gelen Cevapsız",
  3: "Giden Cevapsız",
  4: "İç Arama",
  5: "İç Cevapsız",
};

/** Legacy formatNetgsmDate: YYYY-MM-DD → ddMMyyyyHHmm (0000 start, 2359 stop). */
export function netgsmCdrDate(date: string, isEnd: boolean): string {
  const [year = "", month = "", day = ""] = date.split("-");
  return `${day}${month}${year}${isEnd ? "2359" : "0000"}`;
}

/** Legacy formatDuration: seconds → HH:MM:SS. */
export function netgsmCdrDuration(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.trunc(seconds)) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export interface NetgsmCdrRecord {
  id: string | null;
  tarih: string | null;
  arayanNumara: string | null;
  arayanAdi: string;
  arananNumara: string | null;
  yontem: string;
  sure: string;
  sureSaniye: number;
  yon: string;
  yonKod: number | null;
  sesKaydi: string | null;
  hat: string | null;
}

function cdrString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Legacy CDR mapping: flatten `[{ uniqueid, values: [...] }]` into Görüşme Kayıtları rows. */
export function parseNetgsmCdrReport(body: string):
  | { ok: true; records: NetgsmCdrRecord[] }
  | { ok: false; code: string | null; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    const code = body.trim();
    if (cdrErrorMessages[code]) return { ok: false, code, message: cdrErrorMessages[code] };
    return { ok: false, code: null, message: "API yanıtı parse edilemedi" };
  }
  if (typeof parsed === "number" || typeof parsed === "string") {
    const code = String(parsed).trim();
    return { ok: false, code, message: cdrErrorMessages[code] ?? `Bilinmeyen hata kodu: ${code}` };
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;
    if (record.code || record.error) {
      const message = cdrString(record.error) ?? cdrString(record.message) ?? "API hatası";
      return { ok: false, code: cdrString(record.code), message };
    }
    return { ok: true, records: [] };
  }
  if (!Array.isArray(parsed)) return { ok: true, records: [] };
  const records = parsed.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    if (!Array.isArray(entry.values)) return [];
    return entry.values.map((raw: unknown): NetgsmCdrRecord => {
      const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const direction = typeof value.direction === "number" ? value.direction : Number.parseInt(cdrString(value.direction) ?? "", 10);
      const seconds = Number.parseInt(cdrString(value.duration) ?? "0", 10) || 0;
      const directory = cdrString(value.directory);
      return {
        id: cdrString(entry.uniqueid) ?? cdrString(value.commonID),
        tarih: cdrString(value.date),
        arayanNumara: cdrString(value.source),
        arayanAdi: directory ? (directory.replace(/["<>]/g, "").split(" ")[0] ?? "") : "",
        arananNumara: cdrString(value.destination),
        yontem: "Sesli",
        sure: netgsmCdrDuration(seconds),
        sureSaniye: seconds,
        yon: Number.isFinite(direction) ? (cdrDirectionLabels[direction] ?? "Bilinmiyor") : "Bilinmiyor",
        yonKod: Number.isFinite(direction) ? direction : null,
        sesKaydi: cdrString(value.recording),
        hat: cdrString(value.line),
      };
    });
  });
  return { ok: true, records };
}

function callReportRequest(input: NetgsmLiveAdapterInput, now: Date): NetgsmTransportRequest {
  const creds = credentials(input.accountConfig);
  if (!creds.usercode || !creds.password) throw new Error("Net GSM API yapılandırılmamış");
  const payload = input.envelope.payload;
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const startDate = payloadString(payload, ["start_date", "baslangic_tarih"], weekAgo.toISOString().split("T")[0]);
  const stopDate = payloadString(payload, ["stop_date", "bitis_tarih"], now.toISOString().split("T")[0]);
  return {
    method: "POST",
    url: `${creds.apiUrl}/netsantral/report`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      usercode: creds.usercode,
      password: creds.password,
      startdate: netgsmCdrDate(startDate, false),
      stopdate: netgsmCdrDate(stopDate, true),
    }),
    timeout_ms: input.policy.timeout_ms,
    netgsm_endpoint: "netsantral.report",
  };
}

async function sendNetgsmCallReport(input: NetgsmLiveAdapterInput, startedAt: Date): Promise<NetgsmLiveAdapterResult> {
  const request = callReportRequest(input, startedAt);
  const transport = input.transport ?? defaultNetgsmFetchTransport;
  let response: NetgsmTransportResponse;
  try {
    response = await transport(request);
  } catch (error) {
    const endedAt = input.now ? new Date(input.now) : new Date();
    const decision = retryDecision(input, endedAt, null, failureCode(error));
    throw new NetgsmLiveTransportError(
      failureMessage(error, "NetGSM transport failed"),
      createAttempt({
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
      }),
    );
  }
  if (response.status >= 400) {
    throwFailure(input, startedAt, request, response, "provider_http_error", `NetGSM returned HTTP ${response.status}`, null);
  }
  const report = parseNetgsmCdrReport(response.body);
  if (!report.ok) {
    throwFailure(input, startedAt, request, response, "netgsm_error_code", report.message, report.code ? { code: report.code, jobId: null } : null);
  }
  const endedAt = input.now ? new Date(input.now) : new Date();
  const totalSeconds = report.records.reduce((sum, record) => sum + record.sureSaniye, 0);
  return {
    response_payload: { success: true, record_count: report.records.length, records: report.records },
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
      response: {
        live_call_performed: true,
        accepted: true,
        status_code: response.status,
        body_bytes: Buffer.byteLength(response.body, "utf8"),
        cdr_record_count: report.records.length,
        cdr_total_seconds: totalSeconds,
        cdr_records: report.records,
      },
      error: null,
    }),
  };
}
