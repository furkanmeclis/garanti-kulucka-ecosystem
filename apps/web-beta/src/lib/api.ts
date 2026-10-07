import type {
  AuthSession,
  AuthUser,
  BackendErrorBody,
  ConversationSummary,
  ConversationSummaryStats,
  CustomerDetail,
  CustomerSummary,
  CustomerSummaryStats,
  ListEnvelope,
  OrderSummary,
  OrderSummaryStats,
  ShipmentSummary,
  ShipmentSummaryStats,
  TokenPair,
  UpdateCustomerRequest,
} from "@garanti-kulucka/shared";
import type {
  AccountingContact,
  AccountingContactInput,
  CreateInvoiceInput,
  CreatePaymentInput,
  InvoiceDetail,
  InvoiceListQuery,
  InvoiceListResponse,
  InvoicePayment,
  KolaybiSyncResult,
  KolaybiSyncStatus,
  ListMeta,
  SyncStatus,
} from "./accounting";
import type {
  BalanceListQuery,
  BalanceMovement,
  BalancePaymentRequest,
  BalancePaymentRequestResult,
  BalancePaymentRequestStatus,
  LedgerBalanceSummary,
  ProcessBalancePaymentRequestResult,
  ProductCategory,
  ProductInput,
  ProductSummary,
  ProductSummaryStats,
  StaffBalance,
  StaffOrder,
  StockMovementSummary,
} from "./inventory-balances";
import type { StoredTokens } from "./session-storage";

/** VITE_BACKEND_BASE_URL (default "/backend"): same-origin proxy in Docker/nginx and the Vite dev server. */
export const defaultBackendBaseUrl = "/backend";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** True when the request never reached the server (offline, DNS, CORS). */
export function isNetworkError(error: unknown) {
  return error instanceof TypeError || (error instanceof ApiError && error.status === 0);
}

type QueryValue = string | number | boolean | null | undefined;

export interface ApiClientOptions {
  baseUrl?: string;
  getTokens: () => StoredTokens | null;
  setTokens: (tokens: StoredTokens | null) => void;
  /** Called once a request is rejected and the refresh token could not renew the session. */
  onSessionExpired?: () => void;
  fetchImpl?: typeof fetch;
}

export interface OrderListQuery {
  search?: string;
  status?: string;
  cargo_provider?: string;
  sort_by?: "created_at" | "updated_at" | "order_number" | "status" | "total_amount";
  sort_direction?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

/** Order action state (`GET /api/orders/{id}/actions`), the fields the beta panel reads. */
export interface OrderActionState {
  public_id: string;
  order_number: string;
  status: string;
  notes: string | null;
  total_amount: string;
  currency: string;
  customer_full_name: string | null;
  customer_phone: string | null;
  confirmation_status: string | null;
  kolaybi: { invoice_id: string | null; e_document_status: string | null };
  created_at: string;
  updated_at: string;
}

export interface OrderDeleteResult {
  deleted: boolean;
  e_document_cancel: { public_id: string } | null;
}

export interface ShipmentListQuery {
  search?: string;
  provider?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface ConversationListQuery {
  channel?: string;
  status?: string;
  limit?: number;
}

export function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>) {
  const base = baseUrl.replace(/\/+$/, "");
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return `${base}${path.startsWith("/") ? path : `/${path}`}${search ? `?${search}` : ""}`;
}

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl ?? defaultBackendBaseUrl;
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  let refreshing: Promise<boolean> | null = null;

  async function send(path: string, init: { method?: string; body?: unknown; query?: Record<string, QueryValue>; auth?: boolean }) {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    const tokens = init.auth === false ? null : options.getTokens();
    if (tokens) headers.Authorization = `Bearer ${tokens.access_token}`;
    return fetchImpl(buildUrl(baseUrl, path, init.query), {
      method: init.method ?? "GET",
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  }

  async function refreshSession(): Promise<boolean> {
    const tokens = options.getTokens();
    if (!tokens) return false;
    refreshing ??= (async () => {
      try {
        const response = await send("/auth/refresh", { method: "POST", body: { refresh_token: tokens.refresh_token }, auth: false });
        if (!response.ok) return false;
        const pair = (await response.json()) as TokenPair;
        options.setTokens({ access_token: pair.access_token, refresh_token: pair.refresh_token });
        return true;
      } catch {
        return false;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function request<T>(path: string, init: { method?: string; body?: unknown; query?: Record<string, QueryValue>; auth?: boolean } = {}): Promise<T> {
    let response = await send(path, init);
    if (response.status === 401 && init.auth !== false && options.getTokens()) {
      if (await refreshSession()) {
        response = await send(path, init);
      }
      if (response.status === 401) {
        options.setTokens(null);
        options.onSessionExpired?.();
      }
    }
    if (!response.ok) {
      let body: BackendErrorBody | null = null;
      try {
        body = (await response.json()) as BackendErrorBody;
      } catch {
        body = null;
      }
      throw new ApiError(response.status, body?.error?.code ?? null, body?.error?.message ?? `HTTP ${response.status}`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /** Authenticated file download (invoice PDF/HTML): the blob plus the server's file name. */
  async function requestBlob(path: string, query?: Record<string, QueryValue>): Promise<{ blob: Blob; filename: string | null }> {
    let response = await send(path, { ...(query ? { query } : {}) });
    if (response.status === 401 && options.getTokens() && (await refreshSession())) {
      response = await send(path, { ...(query ? { query } : {}) });
    }
    if (!response.ok) throw new ApiError(response.status, null, `HTTP ${response.status}`);
    const disposition = response.headers.get("content-disposition") ?? "";
    const match = disposition.match(/filename="?([^";]+)"?/i);
    return { blob: await response.blob(), filename: match?.[1] ?? null };
  }

  return {
    baseUrl,
    requestBlob,
    async login(email: string, password: string) {
      const session = await request<AuthSession>("/auth/login", { method: "POST", body: { email, password }, auth: false });
      options.setTokens({ access_token: session.access_token, refresh_token: session.refresh_token });
      return session;
    },
    me: () => request<AuthUser>("/auth/me"),
    async logout() {
      try {
        if (options.getTokens()) await request<unknown>("/auth/logout", { method: "POST" });
      } finally {
        options.setTokens(null);
      }
    },
    updateProfile: (input: { first_name: string; last_name?: string }) =>
      request<{ first_name: string; last_name: string }>("/auth/account/profile", { method: "PATCH", body: input }),
    changePassword: (input: { password: string; password_confirmation: string }) =>
      request<{ updated: boolean }>("/auth/account/password", { method: "POST", body: input }),
    orderSummary: () => request<OrderSummaryStats>("/api/orders/summary"),
    conversationSummary: () => request<ConversationSummaryStats>("/api/conversations/summary"),
    customerSummary: () => request<CustomerSummaryStats>("/api/customers/summary"),
    shipmentSummary: () => request<ShipmentSummaryStats>("/api/shipments/summary"),
    listOrders: (query: OrderListQuery = {}) => request<ListEnvelope<OrderSummary>>("/api/orders", { query: { ...query } }),
    listShipments: (query: ShipmentListQuery = {}) => request<ListEnvelope<ShipmentSummary>>("/api/shipments", { query: { ...query } }),
    listConversations: (query: ConversationListQuery = {}) =>
      request<ListEnvelope<ConversationSummary>>("/api/conversations", { query: { ...query } }),
    listCustomers: (limit = 200) => request<ListEnvelope<CustomerSummary>>("/api/customers", { query: { limit } }),
    getCustomer: (publicId: string) => request<CustomerDetail>(`/api/customers/${encodeURIComponent(publicId)}`),
    updateCustomer: (publicId: string, input: UpdateCustomerRequest) =>
      request<CustomerSummary>(`/api/customers/${encodeURIComponent(publicId)}`, { method: "PATCH", body: input }),
    getOrderActions: (publicId: string) => request<{ order: OrderActionState }>(`/api/orders/${encodeURIComponent(publicId)}/actions`),
    restoreOrder: (publicId: string) => request<{ order: OrderActionState }>(`/api/orders/${encodeURIComponent(publicId)}/restore`, { method: "POST" }),
    deleteOrder: (publicId: string, idempotencyKey: string) =>
      request<OrderDeleteResult>(`/api/orders/${encodeURIComponent(publicId)}`, { method: "DELETE", body: { idempotency_key: idempotencyKey } }),
    updateOrderNotes: (publicId: string, notes: string | null) =>
      request<{ order: OrderActionState }>(`/api/orders/${encodeURIComponent(publicId)}/notes`, { method: "PATCH", body: { notes } }),
    listInvoices: (query: InvoiceListQuery = {}) => request<InvoiceListResponse>("/api/accounting/invoices", { query: { ...query } }),
    getInvoice: (publicId: string) => request<InvoiceDetail>(`/api/accounting/invoices/${encodeURIComponent(publicId)}`),
    createInvoice: (input: CreateInvoiceInput) => request<InvoiceDetail & { replayed: boolean }>("/api/accounting/invoices", { method: "POST", body: input }),
    addInvoicePayment: (publicId: string, input: CreatePaymentInput) =>
      request<{ invoice: InvoiceDetail; payment: InvoicePayment; replayed: boolean }>(`/api/accounting/invoices/${encodeURIComponent(publicId)}/payments`, { method: "POST", body: input }),
    cancelInvoice: (publicId: string) => request<InvoiceDetail>(`/api/accounting/invoices/${encodeURIComponent(publicId)}/cancel`, { method: "POST" }),
    invoiceDocument: (publicId: string, format: "pdf" | "html") => requestBlob(`/api/accounting/invoices/${encodeURIComponent(publicId)}/document`, { format }),
    listAccountingContacts: (query: { search?: string; sync_status?: SyncStatus; limit?: number; offset?: number } = {}) =>
      request<{ data: AccountingContact[]; meta: ListMeta }>("/api/accounting/contacts", { query: { ...query } }),
    createAccountingContact: (input: AccountingContactInput & { name: string }) => request<AccountingContact>("/api/accounting/contacts", { method: "POST", body: input }),
    updateAccountingContact: (publicId: string, input: AccountingContactInput) =>
      request<AccountingContact>(`/api/accounting/contacts/${encodeURIComponent(publicId)}`, { method: "PATCH", body: input }),
    kolaybiStatus: () => request<KolaybiSyncStatus>("/api/accounting/kolaybi/status"),
    syncKolaybi: (idempotencyKey: string) => request<KolaybiSyncResult>("/api/accounting/kolaybi/sync", { method: "POST", body: { idempotency_key: idempotencyKey } }),
    productSummary: () => request<ProductSummaryStats>("/api/products/summary"),
    listProducts: (query: { category?: ProductCategory; search?: string; active?: "true" | "false" | "all"; limit?: number } = {}) =>
      request<{ data: ProductSummary[] }>("/api/products", { query: { limit: 200, ...query } }),
    createProduct: (input: ProductInput) => request<ProductSummary>("/api/products", { method: "POST", body: input }),
    updateProduct: (publicId: string, input: Partial<ProductInput>) => request<ProductSummary>(`/api/products/${encodeURIComponent(publicId)}`, { method: "PATCH", body: input }),
    deactivateProduct: (publicId: string) => request<ProductSummary>(`/api/products/${encodeURIComponent(publicId)}`, { method: "DELETE" }),
    listStockMovements: (publicId: string) => request<{ data: StockMovementSummary[] }>(`/api/products/${encodeURIComponent(publicId)}/stock-movements`, { query: { limit: 50 } }),
    createStockMovement: (publicId: string, input: { movement_type: "in" | "out"; quantity: number; notes?: string | null }) =>
      request<{ product: ProductSummary; movement: StockMovementSummary }>(`/api/products/${encodeURIComponent(publicId)}/stock-movements`, { method: "POST", body: input }),
    balanceSummary: () => request<LedgerBalanceSummary>("/api/balances/summary"),
    listStaffBalances: () => request<{ data: StaffBalance[] }>("/api/balances/staff"),
    listStaffOrders: (userPublicId: string) => request<{ data: StaffOrder[] }>(`/api/balances/staff/${encodeURIComponent(userPublicId)}/orders`),
    resetStaffBalance: (userPublicId: string) =>
      request<{ previous_balance: number; message: string }>(`/api/balances/staff/${encodeURIComponent(userPublicId)}/reset`, { method: "POST", body: {} }),
    listBalanceMovements: (query: BalanceListQuery = {}) => request<{ data: BalanceMovement[]; total: number }>("/api/balances/movements", { query: { ...query } }),
    listPaymentRequests: (query: BalanceListQuery & { status?: BalancePaymentRequestStatus } = {}) =>
      request<{ data: BalancePaymentRequest[]; total: number }>("/api/balances/payment-requests", { query: { ...query } }),
    createPaymentRequest: (input: { amount: string; idempotency_key: string }) =>
      request<BalancePaymentRequestResult>("/api/balances/payment-requests", { method: "POST", body: input }),
    processPaymentRequest: (publicId: string, decision: "approve" | "reject") =>
      request<ProcessBalancePaymentRequestResult>(`/api/balances/payment-requests/${encodeURIComponent(publicId)}/${decision}`, { method: "POST", body: {} }),
    saveCustomerNotes: (publicId: string, notes: string | null) =>
      request<CustomerSummary>(`/api/customers/${encodeURIComponent(publicId)}/notes`, { method: "PATCH", body: { notes } }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
