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
    listOrders: (limit = 50) =>
      http.request<{ data: OrderSummary[] }>(`/api/orders?limit=${limit}`),
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
    listShipments: (limit = 50) =>
      http.request<{ data: ShipmentSummary[] }>(`/api/shipments?limit=${limit}`),
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
  };
}
