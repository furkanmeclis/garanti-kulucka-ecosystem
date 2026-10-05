import type { JobEnvelope, ProviderAttempt, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { providerAttemptCorrelationMetadata } from "./correlation.js";
import { providerAttemptSchema } from "@garanti-kulucka/shared";
import type { ProviderRetryDecision } from "./retry.js";
import { decideProviderRetry } from "./retry.js";
import type { ProviderAccountConfig } from "./account-config.js";
import type { LiveProviderTransportPolicy } from "./transport-policy.js";
import { failureCode, failureMessage, fetchLiveHttpTransport } from "./live-http.js";

export interface SuratTransportResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface SuratTransportRequest {
  method: "POST";
  url: string;
  headers: Record<string, string>;
  body: string;
  timeout_ms: number;
  surat_endpoint: "OrtakBarkodOlustur" | "KargoTakipHareketDetayi";
  account_type: SuratAccountType;
}

export type SuratFetchTransport = (request: SuratTransportRequest) => Promise<SuratTransportResponse>;

export interface SuratLiveAdapterInput {
  envelope: ProviderRequestEnvelope;
  job: JobEnvelope;
  accountConfig: ProviderAccountConfig;
  policy: LiveProviderTransportPolicy;
  attemptNumber: number;
  maxAttempts: number;
  transport?: SuratFetchTransport;
  now?: Date;
}

export interface SuratLiveAdapterResult {
  attempt: ProviderAttempt;
  response_payload: Record<string, unknown>;
}

export class SuratLiveTransportError extends Error {
  constructor(
    message: string,
    readonly attempt: ProviderAttempt,
  ) {
    super(message);
    this.name = "SuratLiveTransportError";
  }
}

type SuratAccountType = "cash" | "cod";

interface SuratCallRecord {
  request: SuratTransportRequest;
  response: SuratTransportResponse;
}

const defaultSuratApiUrl = "https://api01.suratkargo.com.tr/api";
const accountTypes = new Set(["cash", "cod"]);
const waitingMessages = ["Veri aktarımı sağlanmış olup kargo kabul bekleniyor"];

function isRecord(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input);
}

function stringSetting(settings: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = settings[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }

  return fallback;
}

function stringToken(tokens: Record<string, unknown>, keys: string[], fallback = ""): string {
  return stringSetting(tokens, keys, fallback);
}

function payloadString(payload: Record<string, unknown>, keys: string[], fallback = ""): string {
  return stringSetting(payload, keys, fallback);
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

function normalizeAccountType(input: unknown): SuratAccountType | null {
  if (typeof input !== "string") return null;
  const normalized = input.trim().toLowerCase();
  return accountTypes.has(normalized) ? (normalized as SuratAccountType) : null;
}

function apiBaseUrl(settings: Record<string, unknown>): string {
  return stringSetting(settings, ["api_url", "surat.api_url", "SURAT_API_URL"], defaultSuratApiUrl).replace(/\/+$/, "");
}

function accountCredentials(accountConfig: ProviderAccountConfig, accountType: SuratAccountType): {
  accountType: SuratAccountType;
  user: string;
  pass: string;
} {
  const { settings, tokens } = accountConfig;
  if (accountType === "cod") {
    return {
      accountType,
      user: stringSetting(settings, ["cod_user", "surat.cod_user", "SURAT_COD_USER"], stringToken(tokens, ["cod_user", "SURAT_COD_USER"])),
      pass: stringSetting(settings, ["cod_pass", "surat.cod_pass", "SURAT_COD_PASS"], stringToken(tokens, ["cod_pass", "SURAT_COD_PASS"])),
    };
  }

  return {
    accountType,
    user: stringSetting(settings, ["cash_user", "surat.cash_user", "SURAT_CASH_USER"], stringToken(tokens, ["cash_user", "SURAT_CASH_USER"])),
    pass: stringSetting(settings, ["cash_pass", "surat.cash_pass", "SURAT_CASH_PASS"], stringToken(tokens, ["cash_pass", "SURAT_CASH_PASS"])),
  };
}

function hasCredentials(accountConfig: ProviderAccountConfig, accountType: SuratAccountType): boolean {
  const credentials = accountCredentials(accountConfig, accountType);
  return credentials.user.length > 0 && credentials.pass.length > 0;
}

function createAccountType(envelope: ProviderRequestEnvelope): SuratAccountType {
  const payload = envelope.payload;
  const explicit = normalizeAccountType(payload.hesapTipi) ?? normalizeAccountType(payload.account_type);
  if (explicit) return explicit;

  const cashOnDelivery =
    payloadNumber(payload, ["kapidaOdemeTutari", "cash_on_delivery_amount"], 0) > 0 ||
    payloadNumber(payload, ["kapidaOdemeTahsilatTipi", "cash_on_delivery_collection_type"], 0) > 0;

  return cashOnDelivery ? "cod" : "cash";
}

function trackingAccountTypes(envelope: ProviderRequestEnvelope, accountConfig: ProviderAccountConfig): SuratAccountType[] {
  const explicit =
    normalizeAccountType(envelope.payload.hesapTipi) ??
    normalizeAccountType(envelope.payload.surat_hesap_tipi) ??
    normalizeAccountType(envelope.payload.account_type);
  if (explicit) return [explicit];

  const cash = hasCredentials(accountConfig, "cash");
  const cod = hasCredentials(accountConfig, "cod");
  if (cash && cod) return ["cash", "cod"];
  if (cash) return ["cash"];
  if (cod) return ["cod"];
  return ["cash", "cod"];
}

function shipmentPayload(envelope: ProviderRequestEnvelope, settings: Record<string, unknown>, now: Date): Record<string, unknown> {
  const payload = envelope.payload;
  const kargoTuru = payloadNumber(payload, ["kargoTuru", "cargo_type"], 3);
  const desi = Math.max(1, Math.ceil(payloadNumber(payload, ["desi", "volumetric_weight"], 1)));
  const kg = Math.max(1, Math.ceil(payloadNumber(payload, ["kg", "weight_kg"], 1)));
  const adet = payloadNumber(payload, ["adet", "piece_count"], 1);
  const isDocument = kargoTuru === 1;
  const isKapidaOdeme =
    payloadNumber(payload, ["kapidaOdemeTutari", "cash_on_delivery_amount"], 0) > 0 ||
    payloadNumber(payload, ["kapidaOdemeTahsilatTipi", "cash_on_delivery_collection_type"], 0) > 0;
  const temporaryTrackingNo = payloadString(payload, ["geciciOzelNo", "temporary_tracking_number"], String(now.getTime()));

  const gonderi: Record<string, unknown> = {
    KisiKurum: payloadString(payload, ["aliciAd", "recipient_name"]),
    AliciAdresi: payloadString(payload, ["aliciAdres", "recipient_address"]),
    Il: payloadString(payload, ["aliciIl", "recipient_city"]),
    Ilce: payloadString(payload, ["aliciIlce", "recipient_district"]),
    TelefonCep: payloadString(payload, ["aliciTelefon", "recipient_phone"]).replace(/[^0-9]/g, ""),
    KargoTuru: kargoTuru,
    OdemeTipi: payloadNumber(payload, ["odemeTipi", "payment_type"], 1),
    IrsaliyeSeriNo: isKapidaOdeme
      ? payloadString(payload, ["irsaliyeSeriNo"], stringSetting(settings, ["irsaliye_seri_no", "surat.irsaliye_seri_no", "SURAT_IRSALIYE_SERI_NO"], "A1"))
      : payloadString(payload, ["irsaliyeSeriNo"], ""),
    IrsaliyeSiraNo: isKapidaOdeme
      ? payloadString(payload, ["irsaliyeSiraNo"], String(now.getTime()).slice(-10))
      : payloadString(payload, ["irsaliyeSiraNo"], ""),
    OzelKargoTakipNo: temporaryTrackingNo,
    Adet: adet,
    BirimDesi: isDocument ? "0" : String(desi),
    BirimKg: isDocument ? "0" : String(kg),
    KargoIcerigi: payloadString(payload, ["kargoIcerigi"], `${isDocument ? 0 : desi}:${isDocument ? 0 : kg}:${kargoTuru}:${adet};`),
    TasimaSekli: payloadNumber(payload, ["tasimaSekli"], 1),
    TeslimSekli: payloadNumber(payload, ["teslimSekli"], 1),
    GonderiSekli: payloadNumber(payload, ["gonderiSekli"], 0),
    Pazaryerimi: payloadNumber(payload, ["pazaryerimi"], 0),
    Iademi: payloadNumber(payload, ["iademi"], 0),
    KapidanOdemeTahsilatTipi: isKapidaOdeme ? payloadNumber(payload, ["kapidaOdemeTahsilatTipi", "cash_on_delivery_collection_type"], 1) : 0,
    KapidanOdemeTutari: isKapidaOdeme ? String(payloadNumber(payload, ["kapidaOdemeTutari", "cash_on_delivery_amount"], 0)) : "0",
  };

  const optionalMap: Array<[string, string[]]> = [
    ["SahisBirim", ["sahisBirim"]],
    ["TelefonEv", ["telefonEv"]],
    ["TelefonIs", ["telefonIs"]],
    ["Email", ["aliciEmail", "recipient_email"]],
    ["AliciKodu", ["aliciKodu"]],
    ["ReferansNo", ["referansNo", "reference_number"]],
    ["EkHizmetler", ["ekHizmetler"]],
    ["SevkAdresi", ["sevkAdresi"]],
    ["TeslimSubeKodu", ["teslimSubeKodu"]],
    ["EntegrasyonFirmasi", ["entegrasyonFirmasi"]],
  ];
  for (const [targetKey, sourceKeys] of optionalMap) {
    const value = payloadString(payload, sourceKeys);
    if (value) gonderi[targetKey] = value;
  }

  return gonderi;
}

function createRequest(
  envelope: ProviderRequestEnvelope,
  accountConfig: ProviderAccountConfig,
  policy: LiveProviderTransportPolicy,
  now: Date,
  accountType: SuratAccountType,
  overrideOzelKargoTakipNo?: string,
): SuratTransportRequest {
  const credentials = accountCredentials(accountConfig, accountType);
  const gonderi = shipmentPayload(envelope, accountConfig.settings, now);
  if (overrideOzelKargoTakipNo) {
    gonderi.OzelKargoTakipNo = overrideOzelKargoTakipNo;
  }

  return {
    method: "POST",
    url: `${apiBaseUrl(accountConfig.settings)}/OrtakBarkodOlustur`,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      KullaniciAdi: credentials.user,
      Sifre: credentials.pass,
      Gonderi: gonderi,
    }),
    timeout_ms: policy.timeout_ms,
    surat_endpoint: "OrtakBarkodOlustur",
    account_type: accountType,
  };
}

function trackingRequest(
  envelope: ProviderRequestEnvelope,
  accountConfig: ProviderAccountConfig,
  policy: LiveProviderTransportPolicy,
  accountType: SuratAccountType,
): SuratTransportRequest {
  const credentials = accountCredentials(accountConfig, accountType);
  const webSiparisKodu = payloadString(envelope.payload, ["webSiparisKodu", "tracking_number", "takipNo"]);
  const params = new URLSearchParams({
    CariKodu: credentials.user,
    Sifre: credentials.pass,
    WebSiparisKodu: webSiparisKodu,
  });

  return {
    method: "POST",
    url: `${apiBaseUrl(accountConfig.settings)}/KargoTakipHareketDetayi?${params.toString()}`,
    headers: {
      Accept: "application/json, text/plain, */*",
    },
    body: "",
    timeout_ms: policy.timeout_ms,
    surat_endpoint: "KargoTakipHareketDetayi",
    account_type: accountType,
  };
}

function parseJson(body: string): Record<string, unknown> | null {
  if (!body) return {};
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function providerStatus(responseData: Record<string, unknown> | null, fallbackStatus: number): number {
  const raw = responseData?.httpStatusCode ?? responseData?.StatusCode ?? responseData?.statusCode;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackStatus;
}

function providerMessage(responseData: Record<string, unknown> | null, fallback: string): string {
  const raw = responseData?.Message ?? responseData?.message ?? responseData?.errorMessage ?? responseData?.error;
  return typeof raw === "string" && raw.length > 0 ? raw : fallback;
}

function isWaitingState(responseData: Record<string, unknown> | null): boolean {
  const message = providerMessage(responseData, "").toLocaleLowerCase("tr-TR");
  return waitingMessages.some((waiting) => message.includes(waiting.toLocaleLowerCase("tr-TR")));
}

function hasProviderError(responseData: Record<string, unknown> | null, httpStatusCode: number): boolean {
  if (isWaitingState(responseData)) return false;
  return Boolean(responseData?.isError || responseData?.IsError || httpStatusCode >= 400);
}

function arrayValue(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function parseCreatePayload(response: SuratTransportResponse, accountType: SuratAccountType): Record<string, unknown> | null {
  const data = parseJson(response.body);
  if (!data || hasProviderError(data, response.status)) return null;
  const kargoTakipNo = typeof data.KargoTakipNo === "string" && data.KargoTakipNo.length > 0 ? data.KargoTakipNo : null;
  if (!kargoTakipNo) return null;
  const barcode = arrayValue(data.Barcode);
  const barcodeNo = arrayValue(data.BarcodeNo);

  return {
    success: true,
    data: {
      kargoTakipNo,
      ozelKargoTakipNo: kargoTakipNo,
      webSiparisKodu: kargoTakipNo,
      barkodEtiket: barcode,
      barkodNo: barcodeNo[0] ?? null,
      responseKodu: typeof data.Message === "string" ? data.Message : null,
      hesapTipi: accountType,
      mesaj: typeof data.Message === "string" ? data.Message : "Gönderi oluşturuldu",
      providerStatus: providerStatus(data, response.status),
    },
  };
}

function rawString(input: unknown): string {
  return typeof input === "string" ? input : "";
}

function rawNumber(input: unknown): number | null {
  const parsed = typeof input === "number" ? input : Number(input);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMovement(input: unknown): Record<string, unknown> {
  const movement = isRecord(input) ? input : {};
  return {
    islemTarihi: rawString(movement.IslemTarihi),
    hareketYeri: rawString(movement.HareketYeri),
    islem: rawString(movement.Islem),
    durumuSayi: rawNumber(movement.KargoHareketKargonunDurumuSayi),
  };
}

function calculateShipmentStatus(durumuSayi: number | null): string | null {
  if (durumuSayi === 6 || durumuSayi === 7 || durumuSayi === 12) return "teslim_edildi";
  if (durumuSayi === 5 || durumuSayi === 15) return "dagitimda";
  if (durumuSayi !== null && durumuSayi >= 8) return "dagitimda";
  if (durumuSayi === 4 || durumuSayi === 14) return "dagitimda";
  if (durumuSayi !== null && durumuSayi >= 1 && durumuSayi <= 3) return "kargoya_verildi";
  return null;
}

function buildLastMovement(gonderi: Record<string, unknown>, movements: Record<string, unknown>[]): string {
  const rawStatus = rawString(gonderi.KargonunDurumu);
  const isWaiting = waitingMessages.some((waiting) => rawStatus.toLocaleLowerCase("tr-TR").includes(waiting.toLocaleLowerCase("tr-TR")));
  const latestRealMovement = [...movements].reverse().find((movement) => rawString(movement.islem).length > 0);
  const statusText = isWaiting ? rawString(latestRealMovement?.islem) || rawStatus : rawStatus;
  const location = rawString(gonderi.KargonunBulunduguYer);
  let result = statusText + (location ? ` — ${location}` : "");

  const latestByDate = [...movements].sort((a, b) => {
    const bTime = Date.parse(rawString(b.islemTarihi)) || 0;
    const aTime = Date.parse(rawString(a.islemTarihi)) || 0;
    return bTime - aTime;
  })[0];
  const lastOperation = rawString(latestByDate?.islem);
  const statusNumber = rawNumber(gonderi.KargonunDurumuSayi);
  const currentTransfer = statusNumber === 8 || /devir/i.test(lastOperation);
  const currentReturn = (statusNumber !== null && statusNumber >= 9 && statusNumber <= 16) || /iade/i.test(lastOperation);

  if (gonderi.DevirDurum === "Evet" && rawString(gonderi.DevirSebebi) && currentTransfer) {
    result += ` [Devir: ${rawString(gonderi.DevirSebebi)}]`;
  }
  if (gonderi.IadeDurum === "Evet" && rawString(gonderi.IadeAciklama) && currentReturn) {
    result += ` [İade: ${rawString(gonderi.IadeAciklama)}]`;
  }

  return result;
}

function parseTrackingPayload(response: SuratTransportResponse, accountType: SuratAccountType): Record<string, unknown> | null {
  const data = parseJson(response.body);
  if (!data || hasProviderError(data, response.status)) return null;
  const rawGonderiler = arrayValue(data.Gonderiler);
  if (rawGonderiler.length === 0) {
    if (isWaitingState(data)) {
      return {
        success: true,
        data: {
          gonderiler: [],
          hesapTipi: accountType,
          providerStatus: providerStatus(data, response.status),
          beklemede: true,
          bekledeMesaj: providerMessage(data, ""),
        },
      };
    }
    return null;
  }

  const gonderiler = rawGonderiler.filter(isRecord).map((gonderi) => {
    const hareketler = arrayValue(gonderi.Hareketler).map(normalizeMovement);
    const kargonunDurumuSayi = rawNumber(gonderi.KargonunDurumuSayi);
    return {
      kargoObjId: gonderi.KargoObjId,
      evrakTuru: gonderi.EvrakTuru,
      evrakTarihi: gonderi.Evraktarihi,
      satisKodu: gonderi.Satiskodu,
      toplamAdet: gonderi.ToplamAdet,
      parcaSiraSayi: gonderi.ParcaSiraSayi,
      toplamDesiKg: gonderi.ToplamDesiKg,
      tutar: gonderi.Tutar,
      cikisSubesi: gonderi.CikisSubesi,
      cikisSubeTel: gonderi.CikisSubeTel,
      teslimatSubesi: gonderi.TeslimatSubesi,
      teslimatSubeTel: gonderi.TeslimatSubeTel,
      kargoTakipNo: gonderi.KargoTakipNo,
      takipUrl: gonderi.TakipUrl,
      kargonunBulunduguYer: gonderi.KargonunBulunduguYer,
      sonHareketTarihi: gonderi.SonHareketTarihi,
      kargonunDurumu: gonderi.KargonunDurumu,
      kargonunDurumuSayi,
      devirDurum: gonderi.DevirDurum,
      devirSebebi: gonderi.DevirSebebi,
      iadeDurum: gonderi.IadeDurum,
      iadeAciklama: gonderi.IadeAciklama,
      teslimTarihi: gonderi.TeslimTarihi,
      teslimAlan: gonderi.TeslimAlan,
      hareketler,
      sonHareket: buildLastMovement(gonderi, hareketler),
      shipment_status: calculateShipmentStatus(kargonunDurumuSayi),
    };
  });

  return {
    success: true,
    data: {
      gonderiler,
      hesapTipi: accountType,
      providerStatus: providerStatus(data, response.status),
    },
  };
}

function redactUrl(urlValue: string): { origin: string; path: string; query: Record<string, string> } {
  const url = new URL(urlValue);
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    query[key] = ["CariKodu", "Sifre"].includes(key) ? "[redacted]" : value;
  }
  return { origin: url.origin, path: url.pathname, query };
}

function redactRequestBody(body: string): unknown {
  if (!body) return "";
  const parsed = parseJson(body);
  if (!parsed) return "[unparseable-json]";
  return {
    ...parsed,
    KullaniciAdi: "[redacted]",
    Sifre: "[redacted]",
  };
}

function redactRequest(request: SuratTransportRequest): Record<string, unknown> {
  return {
    method: request.method,
    surat_endpoint: request.surat_endpoint,
    account_type: request.account_type,
    ...redactUrl(request.url),
    headers: request.headers,
    body_bytes: Buffer.byteLength(request.body, "utf8"),
    body: redactRequestBody(request.body),
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
  request: SuratTransportRequest;
  requests?: SuratTransportRequest[];
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
      transport: "surat-rest",
      request: {
        ...redactRequest(input.request),
        ...(input.requests ? { attempts: input.requests.map((request) => redactRequest(request)) } : {}),
      },
      ...(input.retry ? { retry: input.retry } : {}),
    },
    response_metadata: input.response,
    error: input.error,
  });
}

export async function defaultSuratFetchTransport(request: SuratTransportRequest): Promise<SuratTransportResponse> {
  return fetchLiveHttpTransport(request, "Sürat");
}

function responseMetadata(response: SuratTransportResponse, calls: SuratCallRecord[] = []): Record<string, unknown> {
  return {
    live_call_performed: true,
    accepted: response.status >= 200 && response.status < 300,
    status_code: response.status,
    headers: response.headers,
    body_bytes: Buffer.byteLength(response.body, "utf8"),
    body_preview: response.body.slice(0, 800),
    ...(calls.length > 1
      ? {
          calls: calls.map((call) => ({
            surat_endpoint: call.request.surat_endpoint,
            account_type: call.request.account_type,
            status_code: call.response.status,
            body_bytes: Buffer.byteLength(call.response.body, "utf8"),
            body_preview: call.response.body.slice(0, 800),
          })),
        }
      : {}),
  };
}

function retryDecision(input: SuratLiveAdapterInput, endedAt: Date, statusCode?: number | null, errorCode?: string): ProviderRetryDecision {
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
  input: SuratLiveAdapterInput,
  request: SuratTransportRequest,
  calls: SuratCallRecord[],
  requests: SuratTransportRequest[],
): Promise<SuratTransportResponse> {
  const transport = input.transport ?? defaultSuratFetchTransport;
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
      error: { code: failureCode(error), message: failureMessage(error, "Sürat transport failed") },
      retry: retryMetadata(decision),
    });
    throw new SuratLiveTransportError(failureMessage(error, "Sürat transport failed"), attempt);
  }
}

function throwHttpError(
  input: SuratLiveAdapterInput,
  request: SuratTransportRequest,
  requests: SuratTransportRequest[],
  calls: SuratCallRecord[],
  response: SuratTransportResponse,
): never {
  const endedAt = input.now ? new Date(input.now) : new Date();
  const decision = retryDecision(input, endedAt, response.status);
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
    error: { code: "provider_http_error", message: `Sürat returned HTTP ${response.status}` },
    retry: retryMetadata(decision),
  });
  throw new SuratLiveTransportError(`Sürat returned HTTP ${response.status}`, attempt);
}

function throwMalformed(
  input: SuratLiveAdapterInput,
  request: SuratTransportRequest,
  requests: SuratTransportRequest[],
  calls: SuratCallRecord[],
  response: SuratTransportResponse,
): never {
  const endedAt = input.now ? new Date(input.now) : new Date();
  const decision = retryDecision(input, endedAt, response.status, "malformed_response");
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
    error: { code: "malformed_response", message: "Sürat response could not be normalized" },
    retry: retryMetadata(decision),
  });
  throw new SuratLiveTransportError("Sürat response could not be normalized", attempt);
}

export async function sendSuratLiveRequest(input: SuratLiveAdapterInput): Promise<SuratLiveAdapterResult> {
  const startedAt = input.now ?? new Date();
  const calls: SuratCallRecord[] = [];
  const requests: SuratTransportRequest[] = [];

  if (input.envelope.operation === "shipment.create") {
    const accountType = createAccountType(input.envelope);
    const firstRequest = createRequest(input.envelope, input.accountConfig, input.policy, startedAt, accountType);
    const firstResponse = await performRequest(input, firstRequest, calls, requests);
    if (firstResponse.status === 429 || firstResponse.status >= 500) throwHttpError(input, firstRequest, requests, calls, firstResponse);

    const firstPayload = parseCreatePayload(firstResponse, accountType);
    if (!firstPayload || !isRecord(firstPayload.data) || typeof firstPayload.data.kargoTakipNo !== "string") {
      throwMalformed(input, firstRequest, requests, calls, firstResponse);
    }

    const trackingNo = firstPayload.data.kargoTakipNo;
    const secondRequest = createRequest(input.envelope, input.accountConfig, input.policy, startedAt, accountType, trackingNo);
    const secondResponse = await performRequest(input, secondRequest, calls, requests);
    if (secondResponse.status === 429 || secondResponse.status >= 500) throwHttpError(input, secondRequest, requests, calls, secondResponse);

    const secondPayload = parseCreatePayload(secondResponse, accountType);
    const payload = secondPayload ?? firstPayload;
    const endedAt = input.now ? new Date(input.now) : new Date();
    return {
      response_payload: payload,
      attempt: createAttempt({
        envelope: input.envelope,
        job: input.job,
        startedAt,
        endedAt,
        statusCode: secondResponse.status,
        status: "success",
        retryDecision: "none",
        nextRetryAt: null,
        request: secondRequest,
        requests,
        response: responseMetadata(secondResponse, calls),
        error: null,
      }),
    };
  }

  let lastRequest: SuratTransportRequest | null = null;
  let lastResponse: SuratTransportResponse | null = null;
  for (const accountType of trackingAccountTypes(input.envelope, input.accountConfig)) {
    const request = trackingRequest(input.envelope, input.accountConfig, input.policy, accountType);
    lastRequest = request;
    const response = await performRequest(input, request, calls, requests);
    lastResponse = response;
    if (response.status === 429 || response.status >= 500) throwHttpError(input, request, requests, calls, response);

    const payload = parseTrackingPayload(response, accountType);
    if (payload) {
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
  }

  if (!lastRequest || !lastResponse) {
    throw new Error("Sürat transport did not execute");
  }
  throwMalformed(input, lastRequest, requests, calls, lastResponse);
}
