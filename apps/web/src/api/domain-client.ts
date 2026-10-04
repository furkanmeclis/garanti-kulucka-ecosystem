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

export interface MessageSummary {
  public_id: string;
  sender_type: string;
  sender_name: string | null;
  body: string | null;
  external_message_id: string | null;
  is_read: boolean;
  sent_at: string;
}

export interface OrderSummary {
  public_id: string;
  order_number: string;
  status: string;
  source: string;
  total_amount: string;
  currency: string;
  confirmation_status: string | null;
  notes: string | null;
  customer_full_name: string | null;
  created_at: string;
  updated_at: string;
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
  updated_at: string;
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
  updated_at: string;
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

export interface BalanceSummary {
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

export function createDomainClient(http: BackendHttpClient) {
  return {
    listConversations: (params: { channel?: string; status?: string; limit?: number } = {}) => {
      const search = new URLSearchParams();
      if (params.channel) search.set("channel", params.channel);
      if (params.status) search.set("status", params.status);
      if (params.limit) search.set("limit", String(params.limit));
      const query = search.toString();
      return http.request<{ data: ConversationSummary[] }>(`/api/conversations${query ? `?${query}` : ""}`);
    },
    listCustomers: (limit = 50) =>
      http.request<{ data: CustomerSummary[] }>(`/api/customers?limit=${limit}`),
    getCommentModerationSummary: () =>
      http.request<CommentModerationSummary>("/api/comments/moderation-summary"),
    listMessages: (conversationPublicId: string, limit = 100) =>
      http.request<{ data: MessageSummary[] }>(
        `/api/conversations/${encodeURIComponent(conversationPublicId)}/messages?limit=${limit}`,
      ),
    createMessage: (
      conversationPublicId: string,
      input: {
        sender_type?: "customer" | "user" | "ai" | "system";
        sender_name?: string | null;
        body: string | null;
        external_message_id?: string | null;
        raw_payload?: unknown | null;
      },
    ) =>
      http.request<MessageSummary>(
        `/api/conversations/${encodeURIComponent(conversationPublicId)}/messages`,
        {
          method: "POST",
          body: input,
        },
      ),
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
    listOrders: (params: { status?: string; confirmation_status?: string; limit?: number } | number = {}) => {
      const normalized = typeof params === "number" ? { limit: params } : params;
      const search = new URLSearchParams();
      if (normalized.status) search.set("status", normalized.status);
      if (normalized.confirmation_status) search.set("confirmation_status", normalized.confirmation_status);
      if (normalized.limit !== undefined) search.set("limit", String(normalized.limit));
      const query = search.toString();
      return http.request<{ data: OrderSummary[] }>(`/api/orders${query ? `?${query}` : ""}`);
    },
    getBalanceSummary: () =>
      http.request<BalanceSummary>("/api/balances/summary"),
    getOrderSummary: () =>
      http.request<OrderSummaryStats>("/api/orders/summary"),
    getProductSummary: () =>
      http.request<ProductSummaryStats>("/api/products/summary"),
    listProducts: (limit = 50) =>
      http.request<{ data: ProductSummary[] }>(`/api/products?limit=${limit}`),
    createOrder: (input: {
      customer_public_id?: string | null;
      conversation_public_id?: string | null;
      order_number: string;
      status?: string;
      source?: string;
      total_amount: string;
      currency?: string;
      notes?: string | null;
    }) =>
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
    listShipments: (params: { provider?: string; status?: string; tracking_missing?: boolean; limit?: number } | number = {}) => {
      const normalized = typeof params === "number" ? { limit: params } : params;
      const search = new URLSearchParams();
      if (normalized.provider) search.set("provider", normalized.provider);
      if (normalized.status) search.set("status", normalized.status);
      if (normalized.tracking_missing !== undefined) search.set("tracking_missing", String(normalized.tracking_missing));
      if (normalized.limit !== undefined) search.set("limit", String(normalized.limit));
      const query = search.toString();
      return http.request<{ data: ShipmentSummary[] }>(`/api/shipments${query ? `?${query}` : ""}`);
    },
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
