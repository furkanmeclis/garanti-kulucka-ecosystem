import type { BackendHttpClient } from "./http-client.js";

export type OrderProviderAction =
  | "kolaybi_transfer"
  | "e_document_create"
  | "e_document_cancel"
  | "invoice_get"
  | "confirmation_call"
  | "confirmation_status";

export interface OrderProviderStep {
  public_id: string;
  action: OrderProviderAction;
  provider: "kolaybi" | "netgsm";
  operation: string;
  attempt: number;
  status: "queued" | "succeeded" | "failed";
  request_id: string;
  job_id: string | null;
  queued: boolean;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderActionState {
  public_id: string;
  order_number: string;
  status: string;
  notes: string | null;
  total_amount: string;
  currency: string;
  customer_full_name: string | null;
  customer_phone: string | null;
  deleted_at: string | null;
  confirmation_status: string | null;
  kolaybi: {
    contact_id: string | null;
    address_id: string | null;
    invoice_id: string | null;
    status: string | null;
    error: string | null;
    e_document_status: string | null;
  };
  confirmation_call: {
    status: string | null;
    bulk_id: string | null;
    pressed_key: string | null;
    listen_seconds: number | null;
    call_count: number;
  };
  created_at: string;
  updated_at: string;
}

export interface OrderActionsResponse {
  order: OrderActionState;
  steps: OrderProviderStep[];
}

export interface OrderProviderSyncResponse extends OrderActionsResponse {
  advanced_count: number;
}

export interface OrderProviderStepResponse {
  provider: "kolaybi" | "netgsm";
  operation: string;
  replayed: boolean;
  live_call_permitted: boolean;
  live_gate: string;
  workflow?: string;
  invoice_id?: string;
  step: OrderProviderStep;
}

export interface OrderBulkActionResponse {
  provider: "kolaybi" | "netgsm";
  operation: string;
  requested_count: number;
  queued_count: number;
  live_call_permitted: boolean;
  live_gate: string;
  results: Array<{ order_public_id: string; queued: boolean; replayed?: boolean; skipped_reason: string | null }>;
}

export interface OrderDeleteResponse {
  deleted: boolean;
  replayed: boolean;
  commission_preserved: boolean;
  order: OrderActionState;
  e_document_cancel: OrderProviderStep | null;
}

export interface OrderCancelResponse {
  replayed: boolean;
  order: OrderActionState;
  e_document_cancel: OrderProviderStep | null;
}

function orderPath(publicId: string, suffix = "") {
  return `/api/orders/${encodeURIComponent(publicId)}${suffix}`;
}

/** Legacy SiparislerPage "Düzenle" modal snapshot (`GET /api/orders/{id}/edit`). */
export interface EditableOrder {
  public_id: string;
  order_number: string;
  status: string;
  cargo_provider: string | null;
  notes: string | null;
  currency: string;
  total_amount: string;
  items_total: string;
  manual_total: boolean;
  customer: { public_id: string; full_name: string; phone: string | null } | null;
  address: { address_line: string; city: string | null; district: string | null } | null;
  items: Array<{ public_id: string; product_public_id: string | null; name: string; quantity: number; unit_price: string; total_amount: string }>;
  locked_reason: "kolaybi" | "deleted" | "cancelled" | null;
  updated_at: string;
}

export interface EditOrderInput {
  customer: { full_name: string; phone: string };
  address: { address_line: string; city: string; district: string };
  notes: string | null;
  cargo_provider: "ptt" | "surat" | null;
  items: Array<{ public_id?: string | null; product_public_id?: string | null; name: string; quantity: number; unit_price: string }>;
  total_amount?: string | null;
}

export function newIdempotencyKey(prefix: string) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

export function createOrderActionsClient(http: BackendHttpClient) {
  return {
    getActions: (publicId: string) => http.request<OrderActionsResponse>(orderPath(publicId, "/actions")),
    getEditable: (publicId: string) => http.request<{ order: EditableOrder }>(orderPath(publicId, "/edit")),
    editOrder: (publicId: string, input: EditOrderInput) => http.request<{ order: EditableOrder }>(orderPath(publicId), { method: "PATCH", body: input }),
    syncProviderSteps: (publicId: string) => http.request<OrderProviderSyncResponse>(orderPath(publicId, "/provider-sync"), { method: "POST" }),
    updateStatus: (publicId: string, status: string) => http.request<unknown>(orderPath(publicId, "/status"), { method: "PATCH", body: { status } }),
    updateNotes: (publicId: string, notes: string | null) =>
      http.request<{ order: OrderActionState }>(orderPath(publicId, "/notes"), { method: "PATCH", body: { notes } }),
    setConfirmation: (publicId: string, confirmationStatus: "teyit_edildi" | "ulasilamadi" | "bekliyor") =>
      http.request<{ order: OrderActionState }>(orderPath(publicId, "/confirmation"), { method: "PATCH", body: { confirmation_status: confirmationStatus } }),
    cancel: (publicId: string, status: "cancelled" | "returned", idempotencyKey: string, reason?: string) =>
      http.request<OrderCancelResponse>(orderPath(publicId, "/cancel"), {
        method: "POST",
        body: { status, idempotency_key: idempotencyKey, ...(reason ? { reason } : {}) },
      }),
    restore: (publicId: string) => http.request<{ order: OrderActionState }>(orderPath(publicId, "/restore"), { method: "POST" }),
    remove: (publicId: string, idempotencyKey: string) =>
      http.request<OrderDeleteResponse>(orderPath(publicId), { method: "DELETE", body: { idempotency_key: idempotencyKey } }),
    kolaybiTransfer: (publicId: string, idempotencyKey: string) =>
      http.request<OrderProviderStepResponse>(orderPath(publicId, "/kolaybi/transfer"), { method: "POST", body: { idempotency_key: idempotencyKey } }),
    eDocument: (publicId: string, action: "create" | "cancel", idempotencyKey: string) =>
      http.request<OrderProviderStepResponse>(orderPath(publicId, "/kolaybi/e-document"), { method: "POST", body: { action, idempotency_key: idempotencyKey } }),
    invoice: (publicId: string, idempotencyKey: string) =>
      http.request<OrderProviderStepResponse>(orderPath(publicId, "/kolaybi/invoice"), { method: "POST", body: { idempotency_key: idempotencyKey } }),
    confirmationCall: (publicId: string, idempotencyKey: string) =>
      http.request<OrderProviderStepResponse>(orderPath(publicId, "/confirmation-call"), { method: "POST", body: { idempotency_key: idempotencyKey } }),
    confirmationStatus: (publicId: string, idempotencyKey: string) =>
      http.request<OrderProviderStepResponse>(orderPath(publicId, "/confirmation-call/status"), { method: "POST", body: { idempotency_key: idempotencyKey } }),
    bulkConfirmationCalls: (publicIds: string[], idempotencyKey: string) =>
      http.request<OrderBulkActionResponse>("/api/orders/bulk/confirmation-calls", {
        method: "POST",
        body: { order_public_ids: publicIds, idempotency_key: idempotencyKey },
      }),
    bulkKolaybiTransfer: (publicIds: string[], idempotencyKey: string) =>
      http.request<OrderBulkActionResponse>("/api/orders/bulk/kolaybi-transfer", {
        method: "POST",
        body: { order_public_ids: publicIds, idempotency_key: idempotencyKey },
      }),
  };
}

export type OrderActionsClient = ReturnType<typeof createOrderActionsClient>;
