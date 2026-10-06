import type { BackendHttpClient } from "./http-client.js";

export type VapiCallStatus = "basladi" | "cevaplandi" | "cevapsiz" | "tamamlandi" | "hata" | "iptal";
export type VapiQueueStatus = "bekliyor" | "araniyor" | "tamamlandi" | "basarisiz";

export interface VapiCallPolicy {
  enabled: boolean;
  max_deneme: number;
  arama_baslangic_saati: string;
  arama_bitis_saati: string;
  tekrar_arama_saat: number;
}

export interface VapiStatistics {
  toplam_arama: number;
  cevaplanan: number;
  cevapsiz: number;
  hatali: number;
  toplam_sure_sn: number;
  ortalama_sure_sn: number;
  toplam_maliyet: string;
  kuyruk_bekleyen: number;
  basari_orani: number;
}

export interface VapiCargoNotReceived {
  id: string;
  shipment_public_id: string;
  takip_no: string | null;
  alici_telefon: string;
  alici_ad: string;
  kargo_firmasi: string;
  son_hareket: string;
  son_hareket_tarihi: string | null;
  durum: string;
  kuyrukta: boolean;
  kuyruk_durumu: VapiQueueStatus | null;
  deneme_sayisi: number;
  son_24s_arandi: boolean;
}

export interface VapiQueueItem {
  id: string;
  public_id: string;
  kargo_id: string | null;
  musteri_telefon: string;
  musteri_adi: string | null;
  kargo_firmasi: string | null;
  takip_no: string | null;
  son_hareket: string | null;
  durum: VapiQueueStatus;
  oncelik: number;
  deneme_sayisi: number;
  max_deneme: number;
  son_arama_zamani: string | null;
  olusturma_tarihi: string;
}

export interface VapiCall {
  id: string;
  public_id: string;
  vapi_call_id: string | null;
  kargo_id: string | null;
  musteri_telefon: string;
  musteri_adi: string | null;
  kargo_firmasi: string | null;
  takip_no: string | null;
  son_hareket: string | null;
  durum: VapiCallStatus;
  arama_ozeti: string | null;
  transkript: unknown;
  sure_sn: number | null;
  maliyet: string | null;
  bitis_nedeni: string | null;
  hata_mesaji: string | null;
  test_aramasi: boolean;
  request_id: string;
  job_id: string | null;
  queued: boolean;
  baslangic: string;
  bitis: string | null;
}

export interface VapiWebhookEvent {
  public_id: string;
  event_type: string;
  external_event_id: string | null;
  status: string;
  received_at: string;
  vapi_call_id: string | null;
  call_status: string | null;
  ended_reason: string | null;
  payload?: unknown;
}

export interface PagedList<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface VapiQueueAddItem {
  shipment_public_id?: string;
  customer_phone: string;
  customer_name?: string;
  cargo_provider?: string;
  tracking_number?: string;
  last_event_text?: string;
}

export interface VapiStartCallRequest extends VapiQueueAddItem {
  queue_public_id?: string;
  idempotency_key: string;
}

export interface VapiStartCallResponse {
  call: VapiCall | null;
  call_id?: string;
  job_id?: string | null;
  replayed: boolean;
  live_gate: string;
  live_call_permitted: boolean;
}

export interface VapiBulkCallResponse {
  aranan: number;
  hatali: number;
  toplam_kuyruk: number;
  mesaj?: string;
  sonuclar: Array<Record<string, unknown>>;
}

export interface NetgsmTeyitSettings {
  aktif: boolean;
  ilk_arama_dakika: number;
  max_deneme: number;
  deneme_arasi_dakika: number;
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

export interface NetgsmCdrListResponse {
  success: boolean;
  error?: string;
  data?: { kayitlar: NetgsmCdrRecord[]; toplamKayit: number; toplamSure: string; sayfa: number; sayfaBoyutu: number };
  synced_at: string | null;
  request_id?: string | null;
}

export interface NetgsmCdrStatistics {
  gelenArama: number;
  gidenArama: number;
  gelenCevapli: number;
  gelenCevapsiz: number;
  toplamSure: string;
  toplamGorisme: number;
  ortalamaSure: string;
  cevaplananOran: number;
}

function query(params: Record<string, string | number | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function createVoiceClient(http: BackendHttpClient) {
  return {
    getVapiConfig: () => http.request<{ config: VapiCallPolicy; provider: { account_configured: boolean; live_gate: string } }>("/api/vapi/config"),
    updateVapiConfig: (config: VapiCallPolicy) => http.request<{ config: VapiCallPolicy }>("/api/vapi/config", { method: "PUT", body: config }),
    getVapiStatistics: () => http.request<{ statistics: VapiStatistics }>("/api/vapi/statistics"),
    listCargoNotReceived: (params: { provider?: string; page?: number; pageSize?: number } = {}) =>
      http.request<PagedList<VapiCargoNotReceived>>(
        `/api/vapi/cargo-not-received${query({ provider: params.provider ?? "tumu", page: params.page ?? 1, page_size: params.pageSize ?? 25 })}`,
      ),
    addToQueue: (items: VapiQueueAddItem[], idempotencyKey: string) =>
      http.request<{ eklenen: number; atlanan: number; replayed?: boolean }>("/api/vapi/queue", {
        method: "POST",
        body: { items, idempotency_key: idempotencyKey },
      }),
    listQueue: (params: { status?: string; page?: number; pageSize?: number } = {}) =>
      http.request<PagedList<VapiQueueItem>>(
        `/api/vapi/queue${query({ status: params.status ?? "tumu", page: params.page ?? 1, page_size: params.pageSize ?? 25 })}`,
      ),
    deleteQueueItem: (publicId: string) =>
      http.request<{ deleted: boolean }>(`/api/vapi/queue/${encodeURIComponent(publicId)}`, { method: "DELETE" }),
    startCall: (input: VapiStartCallRequest) => http.request<VapiStartCallResponse>("/api/vapi/calls", { method: "POST", body: input }),
    startBulkCalls: (idempotencyKey: string) =>
      http.request<VapiBulkCallResponse>("/api/vapi/calls/bulk", { method: "POST", body: { idempotency_key: idempotencyKey } }),
    listCalls: (params: { status?: string; q?: string; page?: number; pageSize?: number } = {}) =>
      http.request<PagedList<VapiCall>>(
        `/api/vapi/calls${query({ status: params.status ?? "tumu", q: params.q?.trim(), page: params.page ?? 1, page_size: params.pageSize ?? 20 })}`,
      ),
    getCall: (publicId: string) =>
      http.request<{ call: VapiCall; backfill_queued: boolean }>(`/api/vapi/calls/${encodeURIComponent(publicId)}`),
    listWebhookEvents: (params: { callId?: string; page?: number; pageSize?: number } = {}) =>
      http.request<PagedList<VapiWebhookEvent>>(
        `/api/vapi/webhooks${query({ call_id: params.callId, page: params.page ?? 1, page_size: params.pageSize ?? 25 })}`,
      ),
    getWebhookEvent: (publicId: string) => http.request<{ event: VapiWebhookEvent }>(`/api/vapi/webhooks/${encodeURIComponent(publicId)}`),
    getNetgsmStatus: () => http.request<{ configured: boolean }>("/api/netgsm/status"),
    getTeyitSettings: () => http.request<{ settings: NetgsmTeyitSettings }>("/api/netgsm/teyit-settings"),
    updateTeyitSettings: (settings: NetgsmTeyitSettings) =>
      http.request<{ settings: NetgsmTeyitSettings }>("/api/netgsm/teyit-settings", { method: "PUT", body: settings }),
    syncCdr: (input: { baslangic_tarih?: string; bitis_tarih?: string; idempotency_key: string }) =>
      http.request<{ request_id: string; job_id: string | null; queued: boolean }>("/api/netgsm/cdr/sync", { method: "POST", body: input }),
    listCdr: (params: { yon: "gelen" | "giden"; sayfa: number; sayfaBoyutu: number }) =>
      http.request<NetgsmCdrListResponse>(`/api/netgsm/cdr${query({ yon: params.yon, sayfa: params.sayfa, sayfa_boyutu: params.sayfaBoyutu })}`),
    getCdrStatistics: () => http.request<{ success: boolean; data: NetgsmCdrStatistics; synced_at: string | null }>("/api/netgsm/cdr/istatistik"),
  };
}

export type VoiceClient = ReturnType<typeof createVoiceClient>;
