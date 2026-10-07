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
import type {
  AutomaticSmsTriggerResponse,
  CommentActionResponse,
  CommentAiSuggestionResponse,
  CommentControlReport,
  CommentListResponse,
  CommentModerationConfig,
  CommentPlatform,
  CommentReplyType,
  CommentStatus,
  ManualSmsSendRequest,
  ManualSmsSendResponse,
  SmsHistoryResponse,
  SmsHistoryType,
  SmsTemplate,
} from "./sms-comments";
import type { InstagramAccountInsights, InstagramInsightsRefresh, InstagramPublication, InstagramPublishRequest, InstagramPublishResponse, ReportAnalysis, ReportCargoProvider } from "./reports-instagram";
import type {
  NetgsmCdrListResponse,
  NetgsmCdrStatistics,
  NetgsmTeyitSettings,
  PagedList,
  PhonebookEntry,
  VapiBulkCallResponse,
  VapiCall,
  VapiCargoNotReceived,
  VapiQueueAddItem,
  VapiQueueItem,
  VapiStartCallRequest,
  VapiStartCallResponse,
  VapiStatistics,
  VoiceMessage,
  VoiceMessageCreateRequest,
  VoiceMessageMutation,
  VoiceMessageStatus,
} from "./voice";
import type {
  BulkCreateShipmentsResponse,
  CargoProviderKey,
  CreateOrderInput,
  CreateShipmentResponse,
  CustomerLookup,
  OrderActionDetail,
  OrderBulkActionResponse,
  OrderProviderStep,
  OrderProviderStepResponse,
  ProductOption,
  ShipmentDraft,
  ShipmentPaymentStatus,
  ShipmentPrintData,
} from "./orders";
import type { DataDeletionInput, DataDeletionRequest, DataDeletionStatus, DataDeletionStatusLookup } from "./privacy";
import type { StoredTokens } from "./session-storage";
import type { AdminLogEntry, CreateManagedUserInput, ManagedRole, ManagedUser, UpdateManagedUserInput } from "./users";

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
  confirmation_status?: string;
  source?: string;
  created_by_user_public_id?: string;
  created_from?: string;
  created_to?: string;
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
  tracking_missing?: boolean;
  not_received?: "ptt" | "surat";
  stage?: "new" | "shipped";
  created_from?: string;
  created_to?: string;
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
    listSmsTemplates: () => request<{ data: SmsTemplate[] }>("/api/sms/templates"),
    createSmsTemplate: (input: { title: string; body: string }) => request<{ template: SmsTemplate }>("/api/sms/templates", { method: "POST", body: input }),
    updateSmsTemplate: (publicId: string, input: { title?: string; body?: string; is_active?: boolean }) =>
      request<{ template: SmsTemplate }>(`/api/sms/templates/${encodeURIComponent(publicId)}`, { method: "PATCH", body: input }),
    deleteSmsTemplate: (publicId: string) => request<{ deleted: boolean }>(`/api/sms/templates/${encodeURIComponent(publicId)}`, { method: "DELETE" }),
    listSmsHistory: (query: { type: SmsHistoryType; q?: string; page: number; page_size: number }) => request<SmsHistoryResponse>("/api/sms/history", { query: { ...query } }),
    sendManualSms: (input: ManualSmsSendRequest) => request<ManualSmsSendResponse>("/api/sms/manual-send", { method: "POST", body: input }),
    triggerAutomaticSms: (provider: "ptt" | "surat", idempotencyKey: string) =>
      request<AutomaticSmsTriggerResponse>("/api/sms/automatic/trigger", { method: "POST", body: { provider, idempotency_key: idempotencyKey } }),
    listComments: (query: { status?: CommentStatus; platform?: CommentPlatform; q?: string; page: number; page_size: number }) => request<CommentListResponse>("/api/comments", { query: { ...query } }),
    commentStats: () => request<{ counts: Record<CommentStatus, number> }>("/api/comments/stats"),
    commentControl: () => request<CommentControlReport>("/api/comments/control"),
    commentSettings: () => request<{ config: CommentModerationConfig }>("/api/comments/settings"),
    saveCommentSettings: (config: CommentModerationConfig) => request<{ config: CommentModerationConfig }>("/api/comments/settings", { method: "PUT", body: config }),
    replyComment: (publicId: string, input: { message: string; reply_type: CommentReplyType; idempotency_key: string }) =>
      request<CommentActionResponse>(`/api/comments/${encodeURIComponent(publicId)}/reply`, { method: "POST", body: input }),
    commentAction: (publicId: string, action: "hide" | "delete" | "manual", idempotencyKey: string) =>
      request<CommentActionResponse>(`/api/comments/${encodeURIComponent(publicId)}/${action}`, { method: "POST", body: { idempotency_key: idempotencyKey } }),
    suggestCommentReply: (publicId: string) => request<CommentAiSuggestionResponse>(`/api/comments/${encodeURIComponent(publicId)}/ai-suggestion`, { method: "POST", body: {} }),
    reportAnalysis: (query: { start_date: string; end_date: string; cargo_provider: ReportCargoProvider; personnel_public_id?: string }) =>
      request<ReportAnalysis>("/api/reports/analysis", { query: { ...query } }),
    instagramInsights: (days: number) => request<InstagramAccountInsights>("/api/instagram/insights/account", { query: { days } }),
    refreshInstagramInsights: () => request<InstagramInsightsRefresh>("/api/instagram/insights/account/refresh", { method: "POST", body: {} }),
    publishInstagram: (input: InstagramPublishRequest) => request<InstagramPublishResponse>("/api/instagram/publications", { method: "POST", body: input }),
    getInstagramPublication: (publicId: string) => request<InstagramPublication>(`/api/instagram/publications/${encodeURIComponent(publicId)}`),
    netgsmStatus: () => request<{ configured: boolean }>("/api/netgsm/status"),
    teyitSettings: () => request<{ settings: NetgsmTeyitSettings }>("/api/netgsm/teyit-settings"),
    saveTeyitSettings: (settings: NetgsmTeyitSettings) => request<{ settings: NetgsmTeyitSettings }>("/api/netgsm/teyit-settings", { method: "PUT", body: settings }),
    syncCdr: (idempotencyKey: string) => request<{ request_id: string; job_id: string | null; queued: boolean }>("/api/netgsm/cdr/sync", { method: "POST", body: { idempotency_key: idempotencyKey } }),
    listCdr: (query: { yon: "gelen" | "giden"; sayfa: number; sayfa_boyutu: number }) => request<NetgsmCdrListResponse>("/api/netgsm/cdr", { query: { ...query } }),
    cdrStatistics: () => request<{ success: boolean; data: NetgsmCdrStatistics; synced_at: string | null }>("/api/netgsm/cdr/istatistik"),
    listVoiceMessages: (query: { status?: VoiceMessageStatus; search?: string; limit: number; offset: number }) =>
      request<{ data: VoiceMessage[]; total_count: number; recipient_total: number; limit: number; offset: number; live_gate: string }>("/api/netgsm/sesli-mesaj", { query: { ...query } }),
    sendVoiceMessage: (input: VoiceMessageCreateRequest) => request<VoiceMessageMutation>("/api/netgsm/sesli-mesaj", { method: "POST", body: input }),
    getVoiceMessage: (publicId: string) => request<{ voice_message: VoiceMessage; live_gate: string }>(`/api/netgsm/sesli-mesaj/${encodeURIComponent(publicId)}`),
    requestVoiceReport: (publicId: string, idempotencyKey: string) =>
      request<VoiceMessageMutation>(`/api/netgsm/sesli-mesaj/${encodeURIComponent(publicId)}/rapor`, { method: "POST", body: { idempotency_key: idempotencyKey } }),
    listPhonebook: (query: { kind?: "customer" | "staff"; search?: string; limit: number; offset: number }) =>
      request<{ data: PhonebookEntry[]; total_count: number; limit: number; offset: number }>("/api/netgsm/rehber", { query: { ...query } }),
    vapiStatistics: () => request<{ statistics: VapiStatistics }>("/api/vapi/statistics"),
    listVapiCargoNotReceived: (query: { provider: string; page: number; page_size: number }) => request<PagedList<VapiCargoNotReceived>>("/api/vapi/cargo-not-received", { query: { ...query } }),
    addToVapiQueue: (items: VapiQueueAddItem[], idempotencyKey: string) =>
      request<{ eklenen: number; atlanan: number; replayed?: boolean }>("/api/vapi/queue", { method: "POST", body: { items, idempotency_key: idempotencyKey } }),
    listVapiQueue: (query: { status: string; page: number; page_size: number }) => request<PagedList<VapiQueueItem>>("/api/vapi/queue", { query: { ...query } }),
    deleteVapiQueueItem: (publicId: string) => request<{ deleted: boolean }>(`/api/vapi/queue/${encodeURIComponent(publicId)}`, { method: "DELETE" }),
    startVapiCall: (input: VapiStartCallRequest) => request<VapiStartCallResponse>("/api/vapi/calls", { method: "POST", body: input }),
    startVapiBulkCalls: (idempotencyKey: string) => request<VapiBulkCallResponse>("/api/vapi/calls/bulk", { method: "POST", body: { idempotency_key: idempotencyKey } }),
    listVapiCalls: (query: { status: string; q?: string; page: number; page_size: number }) => request<PagedList<VapiCall>>("/api/vapi/calls", { query: { ...query } }),
    getVapiCall: (publicId: string) => request<{ call: VapiCall; backfill_queued: boolean }>(`/api/vapi/calls/${encodeURIComponent(publicId)}`),
    createVapiTestCall: (input: { customer_name: string; customer_phone: string; cargo_provider: string; tracking_number: string; last_event_text: string; idempotency_key: string }) =>
      request<{ operation: string; request_id: string }>("/api/webphone/test-call", { method: "POST", body: input }),
    createOrder: (input: CreateOrderInput) => request<OrderSummary>("/api/orders", { method: "POST", body: input }),
    orderProductOptions: () => request<{ data: ProductOption[] }>("/api/orders/product-options", { query: { limit: 100 } }),
    lookupCustomerByPhone: (phone: string) => request<CustomerLookup>("/api/orders/customer-lookup", { query: { phone } }),
    getOrderActionDetail: (publicId: string) => request<{ order: OrderActionDetail; steps: OrderProviderStep[] }>(`/api/orders/${encodeURIComponent(publicId)}/actions`),
    syncOrderProviderSteps: (publicId: string) => request<{ advanced_count: number }>(`/api/orders/${encodeURIComponent(publicId)}/provider-sync`, { method: "POST" }),
    updateOrderStatus: (publicId: string, status: string) => request<unknown>(`/api/orders/${encodeURIComponent(publicId)}/status`, { method: "PATCH", body: { status } }),
    setOrderConfirmation: (publicId: string, confirmation_status: "teyit_edildi" | "ulasilamadi" | "bekliyor") =>
      request<unknown>(`/api/orders/${encodeURIComponent(publicId)}/confirmation`, { method: "PATCH", body: { confirmation_status } }),
    cancelOrder: (publicId: string, status: "cancelled" | "returned", idempotencyKey: string, reason?: string) =>
      request<{ e_document_cancel: OrderProviderStep | null }>(`/api/orders/${encodeURIComponent(publicId)}/cancel`, { method: "POST", body: { status, idempotency_key: idempotencyKey, ...(reason ? { reason } : {}) } }),
    orderKolaybiTransfer: (publicId: string, idempotencyKey: string) =>
      request<OrderProviderStepResponse>(`/api/orders/${encodeURIComponent(publicId)}/kolaybi/transfer`, { method: "POST", body: { idempotency_key: idempotencyKey } }),
    orderEDocument: (publicId: string, idempotencyKey: string) =>
      request<OrderProviderStepResponse>(`/api/orders/${encodeURIComponent(publicId)}/kolaybi/e-document`, { method: "POST", body: { action: "create", idempotency_key: idempotencyKey } }),
    orderInvoice: (publicId: string, idempotencyKey: string) =>
      request<OrderProviderStepResponse>(`/api/orders/${encodeURIComponent(publicId)}/kolaybi/invoice`, { method: "POST", body: { idempotency_key: idempotencyKey } }),
    orderConfirmationCall: (publicId: string, idempotencyKey: string) =>
      request<OrderProviderStepResponse>(`/api/orders/${encodeURIComponent(publicId)}/confirmation-call`, { method: "POST", body: { idempotency_key: idempotencyKey } }),
    orderConfirmationStatus: (publicId: string, idempotencyKey: string) =>
      request<OrderProviderStepResponse>(`/api/orders/${encodeURIComponent(publicId)}/confirmation-call/status`, { method: "POST", body: { idempotency_key: idempotencyKey } }),
    bulkConfirmationCalls: (publicIds: string[], idempotencyKey: string) =>
      request<OrderBulkActionResponse>("/api/orders/bulk/confirmation-calls", { method: "POST", body: { order_public_ids: publicIds, idempotency_key: idempotencyKey } }),
    bulkKolaybiTransfer: (publicIds: string[], idempotencyKey: string) =>
      request<OrderBulkActionResponse>("/api/orders/bulk/kolaybi-transfer", { method: "POST", body: { order_public_ids: publicIds, idempotency_key: idempotencyKey } }),
    getShipmentDraft: (orderPublicId: string) => request<ShipmentDraft>(`/api/orders/${encodeURIComponent(orderPublicId)}/shipment-draft`),
    createShipment: (
      orderPublicId: string,
      input: { provider: CargoProviderKey; payment_status: ShipmentPaymentStatus; idempotency_key: string; recipient_address?: string; recipient_city?: string; recipient_district?: string },
    ) => request<CreateShipmentResponse>(`/api/orders/${encodeURIComponent(orderPublicId)}/shipments`, { method: "POST", body: input }),
    bulkCreateShipments: (input: { provider: CargoProviderKey; order_public_ids: string[]; idempotency_key: string }) =>
      request<BulkCreateShipmentsResponse>("/api/shipments/bulk-create", { method: "POST", body: input }),
    getShipment: (publicId: string) => request<ShipmentSummary>(`/api/shipments/${encodeURIComponent(publicId)}`),
    trackShipment: (publicId: string, idempotencyKey: string) =>
      request<{ provider: string; operation: string; request_id: string; queued: boolean; live_gate: string }>(`/api/shipments/${encodeURIComponent(publicId)}/track`, { method: "POST", body: { idempotency_key: idempotencyKey } }),
    updateShipmentStatus: (publicId: string, input: { status: string; last_event_text: string | null }) =>
      request<ShipmentSummary>(`/api/shipments/${encodeURIComponent(publicId)}/status`, { method: "PATCH", body: { ...input, raw_payload: null } }),
    getShipmentPrint: (publicId: string) => request<ShipmentPrintData>(`/api/shipments/${encodeURIComponent(publicId)}/print`),
    markShipmentPrinted: (publicId: string, idempotencyKey: string) =>
      request<{ shipment_public_id: string; label_printed_at: string }>(`/api/shipments/${encodeURIComponent(publicId)}/printed`, { method: "POST", body: { idempotency_key: idempotencyKey } }),
    triggerTrackingCron: (provider: "ptt" | "surat", idempotencyKey: string) =>
      request<unknown>(`/admin/integrations/provider-cron-triggers/${provider}`, { method: "POST", body: { idempotency_key: idempotencyKey } }),
    submitDataDeletion: (input: DataDeletionInput) =>
      request<{ success: boolean; message: string; reference: string }>("/api/veri-silme-talebi", { method: "POST", body: input, auth: false }),
    dataDeletionStatus: (reference: string) => request<DataDeletionStatusLookup>(`/api/veri-silme-talebi/${encodeURIComponent(reference)}`, { auth: false }),
    listDataDeletionRequests: (query: { status?: DataDeletionStatus; limit: number; offset: number }) =>
      request<{ data: DataDeletionRequest[]; total_count: number; limit: number; offset: number }>("/admin/data-deletion-requests", { query: { ...query } }),
    updateDataDeletionRequest: (publicId: string, input: { status: DataDeletionStatus; note: string | null }) =>
      request<{ request: DataDeletionRequest }>(`/admin/data-deletion-requests/${encodeURIComponent(publicId)}`, { method: "PATCH", body: input }),
    listUsers: () => request<{ data: ManagedUser[]; roles: ManagedRole[] }>("/admin/users"),
    createUser: (input: CreateManagedUserInput) => request<{ user: ManagedUser }>("/admin/users", { method: "POST", body: input }),
    updateUser: (publicId: string, input: UpdateManagedUserInput) => request<{ user: ManagedUser }>(`/admin/users/${encodeURIComponent(publicId)}`, { method: "PATCH", body: input }),
    deactivateUser: (publicId: string) => request<{ user: ManagedUser; deactivated: boolean }>(`/admin/users/${encodeURIComponent(publicId)}`, { method: "DELETE" }),
    listAdminLogs: (limit = 100) => request<{ data: AdminLogEntry[] }>("/admin/logs", { query: { limit } }),
    saveCustomerNotes: (publicId: string, notes: string | null) =>
      request<CustomerSummary>(`/api/customers/${encodeURIComponent(publicId)}/notes`, { method: "PATCH", body: { notes } }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
