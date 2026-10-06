import type { BackendHttpClient } from "./http-client.js";

export type SmsHistoryType = "all" | "manual" | "automatic";
export type SmsDeliveryStatus = "queued" | "sent" | "failed";

export interface SmsTemplate {
  public_id: string;
  title: string;
  body: string;
  sort_order: number;
  is_active: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface SmsMessage {
  public_id: string;
  recipient_phone: string;
  customer_name: string | null;
  tracking_number: string | null;
  message: string;
  is_automatic: boolean;
  status: SmsDeliveryStatus;
  error_message: string | null;
  provider_bulk_id: string | null;
  request_id: string;
  job_id: string | null;
  queued: boolean;
  created_at: string;
}

export interface SmsHistoryResponse {
  data: SmsMessage[];
  total: number;
  page: number;
  page_size: number;
}

export interface ManualSmsSendRequest {
  recipients: string[];
  message: string;
  idempotency_key: string;
  template_public_id?: string;
  customer_name?: string;
  shipment_public_id?: string;
  tracking_number?: string;
}

export interface ManualSmsSendResponse {
  provider: "netgsm";
  operation: "sms.send";
  recipient_count: number;
  queued_count: number;
  replayed: boolean;
  live_call_permitted: boolean;
  live_gate: string;
  messages: SmsMessage[];
}

export interface AutomaticSmsTriggerResponse {
  provider: "ptt" | "surat";
  operation: "shipment.track";
  checked_count: number;
  queued_count: number;
  job_ids: string[];
  live_call_permitted: boolean;
  live_gate: string;
}

function templatePath(publicId: string) {
  return `/api/sms/templates/${encodeURIComponent(publicId)}`;
}

export function createSmsClient(http: BackendHttpClient) {
  return {
    listTemplates: () => http.request<{ data: SmsTemplate[] }>("/api/sms/templates"),
    createTemplate: (input: { title: string; body: string; sort_order?: number }) =>
      http.request<{ template: SmsTemplate }>("/api/sms/templates", { method: "POST", body: input }),
    updateTemplate: (publicId: string, input: { title?: string; body?: string; is_active?: boolean; sort_order?: number }) =>
      http.request<{ template: SmsTemplate }>(templatePath(publicId), { method: "PATCH", body: input }),
    deleteTemplate: (publicId: string) => http.request<{ deleted: boolean }>(templatePath(publicId), { method: "DELETE" }),
    listHistory: (params: { type?: SmsHistoryType; q?: string; page?: number; pageSize?: number } = {}) => {
      const search = new URLSearchParams();
      search.set("type", params.type ?? "all");
      search.set("page", String(params.page ?? 1));
      search.set("page_size", String(params.pageSize ?? 25));
      if (params.q?.trim()) search.set("q", params.q.trim());
      return http.request<SmsHistoryResponse>(`/api/sms/history?${search.toString()}`);
    },
    sendManual: (input: ManualSmsSendRequest) =>
      http.request<ManualSmsSendResponse>("/api/sms/manual-send", { method: "POST", body: input }),
    triggerAutomatic: (provider: "ptt" | "surat", idempotencyKey: string) =>
      http.request<AutomaticSmsTriggerResponse>("/api/sms/automatic/trigger", {
        method: "POST",
        body: { provider, idempotency_key: idempotencyKey },
      }),
  };
}

export type SmsClient = ReturnType<typeof createSmsClient>;
