import type { BackendHttpClient } from "./http-client.js";

export type CargoPipelineStep = "mesaj" | "sms" | "vapi" | "tamamlandi" | "teslim";
export type CargoPipelineStatus = "bekliyor" | "isleniyor" | "tamamlandi" | "hata" | "iptal" | "teslim";
export type CargoPipelineAction = "run_now" | "skip" | "complete" | "cancel";
export type CargoPipelineTestType = "sms" | "mesaj" | "vapi";

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

/** Legacy `/api/kargo-pipeline*` → backend `/api/cargo-pipeline*`. */
export function createCargoPipelineClient(http: BackendHttpClient) {
  return {
    list: (params: { status?: string; step?: string; page?: number; pageSize?: number }) => {
      const query = new URLSearchParams();
      if (params.status && params.status !== "tumu") query.set("status", params.status);
      if (params.step && params.step !== "tumu") query.set("step", params.step);
      query.set("page", String(params.page ?? 1));
      query.set("page_size", String(params.pageSize ?? 50));
      return http.request<{ data: CargoPipelineItem[]; total: number; page: number; page_size: number }>(`/api/cargo-pipeline?${query.toString()}`);
    },
    getConfig: () => http.request<{ config: CargoPipelineConfig }>("/api/cargo-pipeline/config"),
    updateConfig: (config: CargoPipelineConfig) => http.request<{ config: CargoPipelineConfig }>("/api/cargo-pipeline/config", { method: "PUT", body: config }),
    action: (publicId: string, action: CargoPipelineAction) =>
      http.request<{ item: CargoPipelineItem }>(`/api/cargo-pipeline/${encodeURIComponent(publicId)}/actions`, { method: "POST", body: { action } }),
    remove: (publicId: string) => http.request<{ deleted: boolean }>(`/api/cargo-pipeline/${encodeURIComponent(publicId)}`, { method: "DELETE" }),
    test: (input: CargoPipelineTestInput) => http.request<CargoPipelineTestResult>("/api/cargo-pipeline/test", { method: "POST", body: input }),
  };
}

export type CargoPipelineClient = ReturnType<typeof createCargoPipelineClient>;
