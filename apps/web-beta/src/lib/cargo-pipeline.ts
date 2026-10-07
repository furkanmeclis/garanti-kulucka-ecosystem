/** Legacy `kargo_pipeline_kuyrugu` rows and `kargo_pipeline_ayarlar` (backend `/api/cargo-pipeline*`). */
export type CargoPipelineStep = "mesaj" | "sms" | "vapi" | "tamamlandi" | "teslim";
export type CargoPipelineStatus = "bekliyor" | "isleniyor" | "tamamlandi" | "hata" | "iptal" | "teslim";
export type CargoPipelineAction = "run_now" | "skip" | "complete" | "cancel";
export type CargoPipelineTestType = "sms" | "mesaj" | "vapi";

export const cargoPipelineStatuses: CargoPipelineStatus[] = ["bekliyor", "isleniyor", "hata", "tamamlandi", "teslim", "iptal"];

export interface CargoPipelineItem {
  public_id: string;
  shipment_public_id: string | null;
  order_public_id: string | null;
  conversation_public_id: string | null;
  vapi_call_public_id: string | null;
  channel: string | null;
  phone: string | null;
  customer_name: string | null;
  tracking_number: string | null;
  cargo_provider: string | null;
  last_event_text: string | null;
  step: CargoPipelineStep;
  status: CargoPipelineStatus;
  next_run_at: string;
  force_run: boolean;
  attempt_count: number;
  max_attempts: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface CargoPipelineConfig {
  aktif: boolean;
  baslangic_saati: string;
  bitis_saati: string;
  mesaj_gecikme_dk: number;
  sms_gecikme_dk: number;
  vapi_gecikme_dk: number;
  max_deneme: number;
  mesaj_sablonu: string;
}

export interface CargoPipelineTestInput {
  type: CargoPipelineTestType;
  phone: string;
  customer_name?: string;
  tracking_number?: string;
  last_event_text?: string;
  cargo_provider?: string;
  conversation_public_id?: string;
  idempotency_key: string;
}

export interface CargoPipelineTestResult {
  type: CargoPipelineTestType;
  queued: boolean;
  job_ids: string[];
  message: string;
  call_id?: string;
  live_gate: string;
}
