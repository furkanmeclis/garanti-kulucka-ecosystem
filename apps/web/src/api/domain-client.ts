import type { BackendHttpClient } from "./http-client.js";

export interface ConversationSummary {
  public_id: string;
  channel: string;
  status: string;
  is_in_pool: boolean;
  human_agent_enabled: boolean;
  unread_count: number;
  last_message_text: string | null;
  last_message_sender_type: string | null;
  last_message_at: string | null;
  customer: {
    full_name: string;
    phone: string | null;
  } | null;
  assigned_user_email: string | null;
  notes: string | null;
  updated_at: string;
}

export interface CustomerSummary {
  public_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  username: string | null;
  notes: string | null;
  updated_at: string;
}

export interface CustomerAddress {
  public_id: string;
  label: string | null;
  address_line: string;
  city: string | null;
  district: string | null;
  country: string;
  postal_code: string | null;
  is_default: boolean;
}

export interface CustomerDetail {
  customer: CustomerSummary & { created_at: string };
  addresses: CustomerAddress[];
  orders: OrderSummary[];
  conversations: ConversationSummary[];
}

export interface UpdateCustomerInput {
  full_name?: string;
  phone?: string | null;
  email?: string | null;
  username?: string | null;
}

export interface CustomerLookupResult {
  customer: CustomerSummary | null;
  default_address: {
    address_line: string;
    city: string | null;
    district: string | null;
    country: string;
    postal_code: string | null;
  } | null;
}

export interface MessageSummary {
  public_id: string;
  sender_type: string;
  sender_name: string | null;
  body: string | null;
  external_message_id: string | null;
  is_read: boolean;
  sent_at: string;
  attachments: MessageAttachmentSummary[];
}

export interface MessageAttachmentSummary {
  file_public_id: string;
  attachment_type: "image" | "video" | "document" | "file";
  original_name: string | null;
  mime_type: string | null;
  byte_size: number | null;
}

export interface MessageShortcutSummary {
  public_id: string;
  code: string;
  message: string | null;
  type: "default" | "custom";
  is_active: boolean;
  sort_order: number;
  attachments: MessageAttachmentSummary[];
  updated_at: string;
}

export interface AiReplySuggestionResult {
  provider: "openai";
  operation: "messages.reply_suggestion";
  dry_run: true;
  live_call_permitted: false;
  conversation_public_id: string;
  suggestion: string;
}

export interface OrderSummary {
  public_id: string;
  order_number: string;
  status: string;
  source: string;
  cargo_provider: string | null;
  total_amount: string;
  currency: string;
  confirmation_status: string | null;
  notes: string | null;
  customer_full_name: string | null;
  customer_phone?: string | null;
  created_by_user_public_id: string | null;
  created_by_user_email: string | null;
  created_at: string;
  updated_at: string;
  /** Legacy order-row extras (`GET /api/orders`): linked conversation, latest shipment, KolayBi and teyit call state. */
  conversation_public_id?: string | null;
  shipment?: OrderRowShipment | null;
  kolaybi_status?: string | null;
  kolaybi_invoice_id?: string | null;
  e_document_status?: string | null;
  confirmation_call_status?: string | null;
  confirmation_pressed_key?: string | null;
  confirmation_call_count?: number;
}

/** Latest shipment of an order as returned on the order row (tracking modal / row badge). */
export interface OrderRowShipment {
  public_id: string;
  provider: string | null;
  status: string | null;
  tracking_number: string | null;
}

export interface ListMeta {
  total_count: number;
  limit: number;
  offset: number;
}

export interface OrderListResponse {
  data: OrderSummary[];
  meta?: ListMeta;
}

export interface ProductSummary {
  public_id: string;
  sku: string | null;
  name: string;
  category: string | null;
  unit_price: string;
  stock_quantity: number;
  is_active: boolean;
  external_product_id: string | null;
  unit?: ProductUnit;
  description?: string | null;
  updated_at: string;
}

export type ProductCategory = "incubator" | "spare_part" | "other";
export type ProductUnit = "Adet" | "Kg" | "Lt" | "Mt" | "Koli";
export type StockMovementType = "in" | "out" | "adjustment";

export interface StockMovementSummary {
  public_id: string;
  product_public_id: string;
  movement_type: StockMovementType;
  quantity: number;
  previous_quantity: number;
  new_quantity: number;
  notes: string | null;
  created_by_user_email: string | null;
  created_at: string;
}

export interface ProductInput {
  name: string;
  sku?: string | null;
  category?: ProductCategory | null;
  unit?: ProductUnit;
  unit_price?: string;
  stock_quantity?: number;
  description?: string | null;
  external_product_id?: string | null;
}

export interface InventoryProductFilter {
  category?: ProductCategory;
  search?: string;
  active?: "true" | "false" | "all";
  limit?: number;
}

export interface CreateOrderLineItemInput {
  product_public_id?: string | null;
  name: string;
  quantity: number;
  unit_price: string;
  external_product_id?: string | null;
}

export interface CreateOrderInput {
  customer_public_id?: string | null;
  customer?: {
    full_name: string;
    phone: string;
    email?: string | null;
    username?: string | null;
  };
  address: {
    address_line: string;
    city: string;
    district: string;
    country?: string;
    postal_code?: string | null;
  };
  conversation_public_id?: string | null;
  status?: string;
  source?: string;
  cargo_provider: "ptt" | "surat";
  notes?: string | null;
  currency?: string;
  items: CreateOrderLineItemInput[];
  force_duplicate?: boolean;
  force_surat_at?: boolean;
}

export interface ShipmentSummary {
  public_id: string;
  provider: string;
  tracking_number: string | null;
  barcode_number: string | null;
  status: string;
  recipient_name: string;
  recipient_phone: string | null;
  recipient_city: string | null;
  recipient_district: string | null;
  last_event_text: string | null;
  order_number: string | null;
  customer_full_name: string | null;
  tracking_events: ShipmentTrackingEvent[];
  updated_at: string;
}

export interface ShipmentTrackingEvent {
  public_id: string;
  status: string;
  description: string | null;
  location: string | null;
  occurred_at: string;
}

export interface ShipmentListResponse {
  data: ShipmentSummary[];
  meta?: ListMeta;
}

export interface ShipmentTrackResult {
  provider: string;
  operation: "shipment.track";
  request_id: string;
  job_id: string | null;
  queued: boolean;
  shipment_public_id: string;
  tracking_number: string | null;
  live_call_permitted: boolean;
  live_gate: string;
}

export interface SmsSendResult {
  provider: "netgsm";
  operation: "sms.send";
  request_id: string;
  job_id: string | null;
  queued: boolean;
  recipient_phone: string;
  message_preview: string;
  live_call_permitted: boolean;
}

export interface PaymentRequestResult {
  provider: "kolaybi";
  operation: "balance.payment_request";
  request_id: string;
  queued: boolean;
  live_call_permitted: boolean;
  replayed: boolean;
  order_public_id: string;
  amount: string;
  currency: string;
  order: OrderSummary;
}

export interface CommentModerationSummary {
  manual_queue: number;
  automatic_queue: number;
  answered: number;
  instagram: number;
  facebook: number;
}

export interface ConversationSummaryStats {
  total_count: number;
  unread_count: number;
  pool_count: number;
  human_agent_count: number;
  channel_counts: {
    instagram: number;
    facebook: number;
  };
  status_counts: {
    open: number;
    closed: number;
  };
}

export interface CustomerSummaryStats {
  total_count: number;
  with_phone_count: number;
  with_email_count: number;
  with_notes_count: number;
}

export interface BalanceSummary {
  scope?: "all" | "own";
  balance?: number;
  total_payment?: number;
  total_commission: number;
  total_deduction: number;
  pending_payment: number;
  available_balance: number;
  pending_request_count: number;
}

export interface OrderSummaryStats {
  total_count: number;
  active_count: number;
  delivered_count: number;
  pending_confirmation_count: number;
  total_revenue: number;
  currency: string;
}

export interface ProductSummaryStats {
  total_count: number;
  active_count: number;
  critical_count: number;
  critical_threshold: number;
  category_counts: {
    incubator: number;
    spare_part: number;
    other: number;
  };
}

export type ShipmentPipelineStep = "mesaj" | "sms" | "vapi" | "teslim";
export type ShipmentPipelineStatus = "bekliyor" | "isleniyor" | "hata" | "teslim";

export interface ShipmentPipelineRow {
  shipment_public_id: string;
  recipient_name: string;
  recipient_phone: string | null;
  tracking_number: string | null;
  barcode_number: string | null;
  step: ShipmentPipelineStep;
  pipeline_status: ShipmentPipelineStatus;
}

export interface ShipmentPipelineSummary {
  counts: {
    all: number;
    mesaj: number;
    sms: number;
    vapi: number;
    teslim: number;
    bekliyor: number;
    isleniyor: number;
    hata: number;
  };
  rows: ShipmentPipelineRow[];
}

export interface ShipmentSummaryStats {
  total_count: number;
  active_count: number;
  delivered_count: number;
  recipient_phone_count: number;
  provider_counts: {
    ptt: number;
    surat: number;
    other: number;
  };
  exception_counts: {
    ptt_not_delivered: number;
    surat_not_delivered: number;
    tracking_missing: number;
  };
}

export interface ReportSummary {
  conversation_count: number;
  order_count: number;
  shipment_count: number;
  total_revenue: number;
  currency: string;
  open_conversation_count: number;
  pending_confirmation_count: number;
  active_shipment_count: number;
  delivered_shipment_count: number;
  delivered_shipment_rate: number;
  confirmation_rate: number;
  active_shipment_rate: number;
}

export interface KolaybiProductList {
  products: Array<{ id: string; name: string | null; sale_price: string | number | null; stock_quantity: string | number | null; unit: string | null; category: string | null }>;
  total: number;
  synced_at: string | null;
  account_configured: boolean;
  live_call_permitted: boolean;
  live_gate: string;
}

export function createDomainClient(http: BackendHttpClient) {
  return {
    listConversations: (params: { channel?: string; status?: string; limit?: number; search?: string; offset?: number } = {}) => {
      const search = new URLSearchParams();
      if (params.channel) search.set("channel", params.channel);
      if (params.status) search.set("status", params.status);
      if (params.limit) search.set("limit", String(params.limit));
      if (params.search) search.set("search", params.search);
      if (params.offset) search.set("offset", String(params.offset));
      const query = search.toString();
      return http.request<{ data: ConversationSummary[] }>(`/api/conversations${query ? `?${query}` : ""}`);
    },
    getConversationSummary: () =>
      http.request<ConversationSummaryStats>("/api/conversations/summary"),
    /** Legacy "Tümünü okundu yap": omit channel (or "all") for every channel; "facebook" covers Messenger. */
    markAllConversationsRead: (channel?: string) =>
      http.request<{ updated: number }>("/api/conversations/mark-all-read", {
        method: "POST",
        body: channel && channel !== "all" ? { channel } : {},
      }),
    listCustomers: (limit = 50) =>
      http.request<{ data: CustomerSummary[] }>(`/api/customers?limit=${limit}`),
    lookupCustomerByPhone: (phone: string) =>
      http.request<CustomerLookupResult>(`/api/orders/customer-lookup?phone=${encodeURIComponent(phone)}`),
    getCustomerSummary: () =>
      http.request<CustomerSummaryStats>("/api/customers/summary"),
    getCustomer: (customerPublicId: string) =>
      http.request<CustomerDetail>(`/api/customers/${encodeURIComponent(customerPublicId)}`),
    updateCustomer: (customerPublicId: string, input: UpdateCustomerInput) =>
      http.request<CustomerSummary>(`/api/customers/${encodeURIComponent(customerPublicId)}`, {
        method: "PATCH",
        body: input,
      }),
    saveCustomerProfileNotes: (customerPublicId: string, notes: string | null) =>
      http.request<CustomerSummary>(`/api/customers/${encodeURIComponent(customerPublicId)}/notes`, {
        method: "PATCH",
        body: { notes },
      }),
    /** Legacy /api/kolaybi/urunler snapshot + refresh (worker `kolaybi.product.list`). */
    listKolaybiProducts: () => http.request<KolaybiProductList>("/api/products/kolaybi"),
    refreshKolaybiProducts: () =>
      http.request<{ request_id: string; job_id: string | null; queued: boolean; live_call_permitted: boolean; live_gate: string }>("/api/products/kolaybi/refresh", { method: "POST" }),
    getCommentModerationSummary: () =>
      http.request<CommentModerationSummary>("/api/comments/moderation-summary"),
    /** Newest `limit` messages (oldest → newest) older than `before`; `has_more` says whether older ones exist. */
    listMessages: (conversationPublicId: string, limit = 100, before?: string) =>
      http.request<{ data: MessageSummary[]; has_more?: boolean }>(
        `/api/conversations/${encodeURIComponent(conversationPublicId)}/messages?limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ""}`,
      ),
    createMessage: (
      conversationPublicId: string,
      input: {
        sender_type?: "customer" | "user" | "ai" | "system";
        sender_name?: string | null;
        body: string | null;
        external_message_id?: string | null;
        raw_payload?: unknown | null;
        attachments?: Array<{
          file_public_id: string;
          attachment_type: "image" | "video" | "document" | "file";
        }>;
      },
    ) =>
      http.request<MessageSummary>(
        `/api/conversations/${encodeURIComponent(conversationPublicId)}/messages`,
        {
          method: "POST",
          body: input,
        },
      ),
    updateConversationNotes: (conversationPublicId: string, notes: string | null) =>
      http.request<ConversationSummary>(
        `/api/conversations/${encodeURIComponent(conversationPublicId)}/notes`,
        {
          method: "PATCH",
          body: { notes },
        },
      ),
    updateCustomerNotes: (conversationPublicId: string, notes: string | null) =>
      http.request<CustomerSummary>(
        `/api/conversations/${encodeURIComponent(conversationPublicId)}/customer-notes`,
        {
          method: "PATCH",
          body: { notes },
        },
      ),
    listMessageShortcuts: () =>
      http.request<{ data: MessageShortcutSummary[] }>("/api/message-shortcuts"),
    createMessageShortcut: (input: {
      code: string;
      message?: string | null;
      type?: "default" | "custom";
      is_active?: boolean;
      sort_order?: number;
      attachments?: Array<{
        file_public_id: string;
        attachment_type: "image" | "video" | "document" | "file";
      }>;
    }) =>
      http.request<MessageShortcutSummary>("/api/message-shortcuts", {
        method: "POST",
        body: input,
      }),
    updateMessageShortcut: (
      shortcutPublicId: string,
      input: {
        code?: string;
        message?: string | null;
        is_active?: boolean;
        sort_order?: number;
        attachments?: Array<{
          file_public_id: string;
          attachment_type: "image" | "video" | "document" | "file";
        }>;
      },
    ) =>
      http.request<MessageShortcutSummary>(
        `/api/message-shortcuts/${encodeURIComponent(shortcutPublicId)}`,
        {
          method: "PATCH",
          body: input,
        },
      ),
    deleteMessageShortcut: (shortcutPublicId: string) =>
      http.request<MessageShortcutSummary>(
        `/api/message-shortcuts/${encodeURIComponent(shortcutPublicId)}`,
        { method: "DELETE" },
      ),
    createAiReplySuggestion: (conversationPublicId: string) =>
      http.request<AiReplySuggestionResult>("/api/ai/reply-suggestion", {
        method: "POST",
        body: { conversation_public_id: conversationPublicId },
      }),
    updateConversationState: (
      conversationPublicId: string,
      input: {
        status?: string;
        unread_count?: number;
        human_agent_enabled?: boolean;
        is_in_pool?: boolean;
        assign_to_me?: boolean;
      },
    ) =>
      http.request<ConversationSummary>(
        `/api/conversations/${encodeURIComponent(conversationPublicId)}/state`,
        {
          method: "PATCH",
          body: input,
        },
      ),
    listOrders: (params: {
      status?: string;
      confirmation_status?: string;
      search?: string;
      source?: string;
      cargo_provider?: string;
      created_by_user_public_id?: string;
      created_from?: string;
      created_to?: string;
      sort_by?: "created_at" | "updated_at" | "order_number" | "status" | "total_amount";
      sort_direction?: "asc" | "desc";
      offset?: number;
      limit?: number;
    } | number = {}) => {
      const normalized = typeof params === "number" ? { limit: params } : params;
      const search = new URLSearchParams();
      if (normalized.status) search.set("status", normalized.status);
      if (normalized.confirmation_status) search.set("confirmation_status", normalized.confirmation_status);
      if (normalized.search) search.set("search", normalized.search);
      if (normalized.source) search.set("source", normalized.source);
      if (normalized.cargo_provider) search.set("cargo_provider", normalized.cargo_provider);
      if (normalized.created_by_user_public_id) search.set("created_by_user_public_id", normalized.created_by_user_public_id);
      if (normalized.created_from) search.set("created_from", normalized.created_from);
      if (normalized.created_to) search.set("created_to", normalized.created_to);
      if (normalized.sort_by) search.set("sort_by", normalized.sort_by);
      if (normalized.sort_direction) search.set("sort_direction", normalized.sort_direction);
      if (normalized.offset !== undefined) search.set("offset", String(normalized.offset));
      if (normalized.limit !== undefined) search.set("limit", String(normalized.limit));
      const query = search.toString();
      return http.request<OrderListResponse>(`/api/orders${query ? `?${query}` : ""}`);
    },
    getBalanceSummary: () =>
      http.request<BalanceSummary>("/api/balances/summary"),
    getOrderSummary: () =>
      http.request<OrderSummaryStats>("/api/orders/summary"),
    getProductSummary: () =>
      http.request<ProductSummaryStats>("/api/products/summary"),
    listProducts: (limit = 50) =>
      http.request<{ data: ProductSummary[] }>(`/api/products?limit=${limit}`),
    listInventoryProducts: (filter: InventoryProductFilter = {}) => {
      const search = new URLSearchParams();
      search.set("limit", String(filter.limit ?? 200));
      if (filter.category) search.set("category", filter.category);
      if (filter.search?.trim()) search.set("search", filter.search.trim());
      if (filter.active) search.set("active", filter.active);
      return http.request<{ data: ProductSummary[] }>(`/api/products?${search.toString()}`);
    },
    createProduct: (input: ProductInput) =>
      http.request<ProductSummary>("/api/products", { method: "POST", body: input }),
    updateProduct: (productPublicId: string, input: Partial<ProductInput>) =>
      http.request<ProductSummary>(`/api/products/${encodeURIComponent(productPublicId)}`, {
        method: "PATCH",
        body: input,
      }),
    deactivateProduct: (productPublicId: string) =>
      http.request<ProductSummary>(`/api/products/${encodeURIComponent(productPublicId)}`, { method: "DELETE" }),
    listProductStockMovements: (productPublicId: string, limit = 50) =>
      http.request<{ data: StockMovementSummary[] }>(
        `/api/products/${encodeURIComponent(productPublicId)}/stock-movements?limit=${limit}`,
      ),
    createProductStockMovement: (
      productPublicId: string,
      input: { movement_type: "in" | "out"; quantity: number; notes?: string | null },
    ) =>
      http.request<{ product: ProductSummary; movement: StockMovementSummary }>(
        `/api/products/${encodeURIComponent(productPublicId)}/stock-movements`,
        { method: "POST", body: input },
      ),
    listOrderProductOptions: (limit = 50) =>
      http.request<{ data: ProductSummary[] }>(`/api/orders/product-options?limit=${limit}`),
    createOrder: (input: CreateOrderInput) =>
      http.request<OrderSummary>("/api/orders", {
        method: "POST",
        body: input,
      }),
    updateOrderStatus: (
      orderPublicId: string,
      input: {
        status: string;
        notes?: string | null;
      },
    ) =>
      http.request<OrderSummary>(
        `/api/orders/${encodeURIComponent(orderPublicId)}/status`,
        {
          method: "PATCH",
          body: input,
        },
      ),
    requestPayment: (
      orderPublicId: string,
      input: {
        amount: string;
        currency: string;
        idempotency_key: string;
      },
    ) =>
      http.request<PaymentRequestResult>(
        `/api/orders/${encodeURIComponent(orderPublicId)}/payment-request`,
        {
          method: "POST",
          body: input,
        },
      ),
    listShipments: (
      params:
        | {
            provider?: string;
            status?: string;
            tracking_missing?: boolean;
            not_received?: "ptt" | "surat";
            stage?: "new" | "shipped";
            created_by_user_public_id?: string;
            created_from?: string;
            created_to?: string;
            search?: string;
            offset?: number;
            limit?: number;
          }
        | number = {},
    ) => {
      const normalized = typeof params === "number" ? { limit: params } : params;
      const search = new URLSearchParams();
      if (normalized.provider) search.set("provider", normalized.provider);
      if (normalized.not_received) search.set("not_received", normalized.not_received);
      if (normalized.stage) search.set("stage", normalized.stage);
      if (normalized.created_by_user_public_id) search.set("created_by_user_public_id", normalized.created_by_user_public_id);
      if (normalized.created_from) search.set("created_from", normalized.created_from);
      if (normalized.created_to) search.set("created_to", normalized.created_to);
      if (normalized.status) search.set("status", normalized.status);
      if (normalized.tracking_missing !== undefined) search.set("tracking_missing", String(normalized.tracking_missing));
      if (normalized.search) search.set("search", normalized.search);
      if (normalized.limit !== undefined) search.set("limit", String(normalized.limit));
      if (normalized.offset !== undefined && normalized.offset > 0) search.set("offset", String(normalized.offset));
      const query = search.toString();
      return http.request<ShipmentListResponse>(`/api/shipments${query ? `?${query}` : ""}`);
    },
    getShipment: (shipmentPublicId: string) =>
      http.request<ShipmentSummary>(`/api/shipments/${encodeURIComponent(shipmentPublicId)}`),
    getShipmentSummary: () =>
      http.request<ShipmentSummaryStats>("/api/shipments/summary"),
    getShipmentPipelineSummary: () =>
      http.request<ShipmentPipelineSummary>("/api/shipments/pipeline-summary"),
    getReportSummary: () =>
      http.request<ReportSummary>("/api/reports/summary"),
    updateShipmentStatus: (
      shipmentPublicId: string,
      input: {
        status: string;
        last_event_text?: string | null;
        raw_payload?: unknown | null;
      },
    ) =>
      http.request<ShipmentSummary>(
        `/api/shipments/${encodeURIComponent(shipmentPublicId)}/status`,
        {
          method: "PATCH",
          body: input,
        },
      ),
    trackShipment: (shipmentPublicId: string, input: { idempotency_key?: string } = {}) =>
      http.request<ShipmentTrackResult>(
        `/api/shipments/${encodeURIComponent(shipmentPublicId)}/track`,
        {
          method: "POST",
          body: input,
        },
      ),
    sendSms: (input: {
      recipient_phone: string;
      message: string;
      idempotency_key?: string;
      shipment_public_id?: string;
    }) =>
      http.request<SmsSendResult>("/api/sms/send", {
        method: "POST",
        body: input,
      }),
  };
}
