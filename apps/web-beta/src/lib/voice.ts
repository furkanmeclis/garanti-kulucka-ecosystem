/** VAPI (`/api/vapi/*`) and NetGSM voice (`/api/netgsm/*`) shapes used by the beta voice pages. */
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

export type VoiceMessageStatus = "queued" | "sent" | "failed" | "dry_run";

export interface VoiceMessageReportRow {
  phone: string;
  status: string;
  pressed_key: string | null;
  listen_seconds: number;
}

export interface VoiceMessage {
  public_id: string;
  recipients: string[];
  recipient_count: number;
  message: string | null;
  audio_id: string | null;
  ringtime: number;
  status: VoiceMessageStatus;
  bulk_id: string | null;
  error_message: string | null;
  report: { report_ready: boolean; message: string | null; rows: VoiceMessageReportRow[] } | null;
  report_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoiceMessageCreateRequest {
  recipients: string[];
  message?: string;
  audio_id?: string;
  ringtime: number;
  idempotency_key: string;
}

export interface VoiceMessageMutation {
  voice_message: VoiceMessage;
  replayed: boolean;
  queued: boolean;
  live_gate: string;
  live_call_permitted: false;
}

export interface PhonebookEntry {
  kind: "customer" | "staff";
  public_id: string;
  name: string;
  phone: string | null;
  extension: string | null;
  role: string | null;
}
