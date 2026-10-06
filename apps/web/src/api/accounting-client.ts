import type { BackendHttpClient } from "./http-client.js";

export type SyncStatus = "local" | "queued" | "synced" | "failed";
export type InvoiceStatus = "issued" | "partially_paid" | "paid" | "cancelled";
export type PaymentMethod = "cash" | "bank_transfer" | "credit_card" | "other";

export interface SyncState {
  status: SyncStatus;
  error: string | null;
  request_id: string | null;
  job_id: string | null;
}

export interface AccountingContact {
  public_id: string;
  contact_type: "individual" | "corporate";
  name: string;
  tax_number: string | null;
  tax_office: string | null;
  phone: string | null;
  email: string | null;
  address_line: string | null;
  district: string | null;
  city: string | null;
  country: string;
  notes: string | null;
  kolaybi_contact_id: string | null;
  sync: SyncState;
  last_synced_at: string | null;
  invoice_count?: number;
  open_balance?: string;
  created_at: string;
  updated_at: string;
}

export interface AccountingContactInput {
  contact_type?: "individual" | "corporate";
  name?: string;
  tax_number?: string | null;
  tax_office?: string | null;
  phone?: string | null;
  email?: string | null;
  address_line?: string | null;
  district?: string | null;
  city?: string | null;
  notes?: string | null;
}

export interface Invoice {
  public_id: string;
  invoice_number: string;
  invoice_type: "sale" | "sale_return";
  status: InvoiceStatus;
  currency: string;
  issue_date: string;
  due_date: string | null;
  description: string | null;
  subtotal: string;
  vat_total: string;
  grand_total: string;
  paid_total: string;
  open_amount: string;
  contact: { public_id: string; name: string };
  order: { public_id: string; order_number: string | null } | null;
  kolaybi_invoice_id: string | null;
  e_document_status: string | null;
  sync: SyncState;
  created_at: string;
  updated_at: string;
}

export interface InvoiceItem {
  public_id: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  vat_rate: string;
  line_subtotal: string;
  line_vat: string;
  line_total: string;
  product_public_id: string | null;
}

export interface InvoicePayment {
  public_id: string;
  amount: string;
  method: PaymentMethod;
  vault_id: string | null;
  paid_at: string;
  notes: string | null;
  sync: SyncState;
  created_at: string;
}

export interface InvoiceDetail extends Omit<Invoice, "contact"> {
  contact: AccountingContact;
  items: InvoiceItem[];
  payments: InvoicePayment[];
}

export interface ListMeta {
  total_count: number;
  limit: number;
  offset: number;
}

export interface InvoiceListResponse {
  data: Invoice[];
  meta: ListMeta;
  totals: { grand_total: string; paid_total: string; open_total: string };
}

export interface InvoiceListQuery {
  search?: string | undefined;
  status?: InvoiceStatus | "open" | undefined;
  sync_status?: SyncStatus | undefined;
  issued_from?: string | undefined;
  issued_to?: string | undefined;
  contact_public_id?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface CreateInvoiceInput {
  idempotency_key: string;
  contact_public_id: string;
  issue_date: string;
  due_date?: string | null;
  description?: string | null;
  items: Array<{ description: string; quantity: number; unit?: string; unit_price: string; vat_rate: number }>;
}

export interface CreatePaymentInput {
  idempotency_key: string;
  amount: string;
  method: PaymentMethod;
  vault_id?: string | null;
  notes?: string | null;
}

export interface KolaybiSyncStatus {
  account: { public_id: string; display_name: string; status: string } | null;
  provider_live_mode: boolean;
  account_live_mode: boolean | null;
  live_call_permitted: boolean;
  live_gate: string;
  counts: Record<"contact" | "invoice" | "payment", Record<SyncStatus, number>>;
}

export interface KolaybiSyncResult {
  provider: "kolaybi";
  live_call_permitted: boolean;
  live_gate: string;
  account_public_id: string | null;
  requested_count: number;
  queued_count: number;
  results: Array<{ target: "contact" | "invoice" | "payment"; public_id: string; operation: string | null; queued: boolean; skipped_reason: string | null }>;
}

function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

const base = "/api/accounting";

export function createAccountingClient(http: BackendHttpClient) {
  return {
    listContacts: (params: { search?: string | undefined; sync_status?: SyncStatus | undefined; limit?: number | undefined; offset?: number | undefined } = {}) =>
      http.request<{ data: AccountingContact[]; meta: ListMeta }>(`${base}/contacts${query({ ...params })}`),
    createContact: (input: AccountingContactInput & { name: string }) =>
      http.request<AccountingContact>(`${base}/contacts`, { method: "POST", body: input }),
    updateContact: (publicId: string, input: AccountingContactInput) =>
      http.request<AccountingContact>(`${base}/contacts/${encodeURIComponent(publicId)}`, { method: "PATCH", body: input }),
    listInvoices: (params: InvoiceListQuery = {}) => http.request<InvoiceListResponse>(`${base}/invoices${query({ ...params })}`),
    getInvoice: (publicId: string) => http.request<InvoiceDetail>(`${base}/invoices/${encodeURIComponent(publicId)}`),
    createInvoice: (input: CreateInvoiceInput) => http.request<InvoiceDetail & { replayed: boolean }>(`${base}/invoices`, { method: "POST", body: input }),
    addPayment: (publicId: string, input: CreatePaymentInput) =>
      http.request<{ invoice: InvoiceDetail; payment: InvoicePayment; replayed: boolean }>(`${base}/invoices/${encodeURIComponent(publicId)}/payments`, {
        method: "POST",
        body: input,
      }),
    cancelInvoice: (publicId: string) => http.request<InvoiceDetail>(`${base}/invoices/${encodeURIComponent(publicId)}/cancel`, { method: "POST" }),
    downloadDocument: async (publicId: string, format: "html" | "pdf") => {
      if (!http.requestBlob) throw new Error("Document download is not supported by this client");
      return http.requestBlob(`${base}/invoices/${encodeURIComponent(publicId)}/document?format=${format}`);
    },
    kolaybiStatus: () => http.request<KolaybiSyncStatus>(`${base}/kolaybi/status`),
    syncKolaybi: (idempotencyKey: string) =>
      http.request<KolaybiSyncResult>(`${base}/kolaybi/sync`, { method: "POST", body: { idempotency_key: idempotencyKey } }),
  };
}

export type AccountingClient = ReturnType<typeof createAccountingClient>;
