import type { AppDatabase } from "@garanti-kulucka/database";
import type { Selectable } from "kysely";
import type {
  ConversationsTable,
  CustomersTable,
  MessagesTable,
  OrdersTable,
  ProductsTable,
  ShipmentsTable,
} from "@garanti-kulucka/database";
import { newPublicId } from "../auth/crypto.js";

export type ConversationRecord = Selectable<ConversationsTable> & {
  customer_full_name: string | null;
  customer_phone: string | null;
  assigned_user_email: string | null;
};

export type CustomerRecord = Selectable<CustomersTable>;
export type MessageRecord = Selectable<MessagesTable>;
export type OrderRecord = Selectable<OrdersTable> & {
  customer_full_name: string | null;
};
export type ProductRecord = Selectable<ProductsTable>;
export type ShipmentRecord = Selectable<ShipmentsTable> & {
  order_number: string | null;
  customer_full_name: string | null;
};

export interface ListConversationsFilter {
  channel?: string;
  status?: string;
  assignedUserId?: number | null;
  limit: number;
}

export interface CreateMessageInput {
  conversationPublicId: string;
  senderType: "customer" | "user" | "ai" | "system";
  senderName: string | null;
  body: string | null;
  externalMessageId: string | null;
  rawPayload: unknown | null;
}

export interface CreateOrderInput {
  customerPublicId: string | null;
  conversationPublicId: string | null;
  createdByUserId: number | null;
  orderNumber: string;
  status: string;
  source: string;
  totalAmount: string;
  currency: string;
  notes: string | null;
}

export interface UpdateShipmentStatusInput {
  shipmentPublicId: string;
  status: string;
  lastEventText: string | null;
  rawPayload: unknown | null;
}

export class DomainRepository {
  constructor(private readonly db: AppDatabase) {}

  async listConversations(filter: ListConversationsFilter): Promise<ConversationRecord[]> {
    let query = this.db
      .selectFrom("conversations")
      .leftJoin("customers", "customers.id", "conversations.customer_id")
      .leftJoin("users", "users.id", "conversations.assigned_user_id")
      .selectAll("conversations")
      .select([
        "customers.full_name as customer_full_name",
        "customers.phone as customer_phone",
        "users.email as assigned_user_email",
      ])
      .$if(Boolean(filter.channel), (builder) => builder.where("conversations.channel", "=", filter.channel as string))
      .$if(Boolean(filter.status), (builder) => builder.where("conversations.status", "=", filter.status as string));

    if (filter.assignedUserId !== undefined) {
      query =
        filter.assignedUserId === null
          ? query.where("conversations.assigned_user_id", "is", null)
          : query.where("conversations.assigned_user_id", "=", filter.assignedUserId);
    }

    return query
      .orderBy("conversations.last_message_at", "desc")
      .orderBy("conversations.created_at", "desc")
      .limit(filter.limit)
      .execute();
  }

  async listMessages(conversationPublicId: string, limit: number): Promise<MessageRecord[]> {
    const conversation = await this.db
      .selectFrom("conversations")
      .select("id")
      .where("public_id", "=", conversationPublicId)
      .executeTakeFirst();

    if (!conversation) {
      return [];
    }

    return this.db
      .selectFrom("messages")
      .selectAll()
      .where("conversation_id", "=", conversation.id)
      .orderBy("sent_at", "asc")
      .limit(limit)
      .execute();
  }

  async listCustomers(limit: number): Promise<CustomerRecord[]> {
    return this.db
      .selectFrom("customers")
      .selectAll()
      .orderBy("updated_at", "desc")
      .orderBy("full_name", "asc")
      .limit(limit)
      .execute();
  }

  async createMessage(input: CreateMessageInput): Promise<MessageRecord> {
    return this.db.transaction().execute(async (transaction) => {
      const conversation = await transaction
        .selectFrom("conversations")
        .select("id")
        .where("public_id", "=", input.conversationPublicId)
        .executeTakeFirst();

      if (!conversation) {
        throw new Error(`Unknown conversation: ${input.conversationPublicId}`);
      }

      const message = await transaction
        .insertInto("messages")
        .values({
          public_id: newPublicId("msg"),
          conversation_id: conversation.id,
          sender_type: input.senderType,
          sender_name: input.senderName,
          body: input.body,
          external_message_id: input.externalMessageId,
          is_read: input.senderType !== "customer",
          sent_at: new Date(),
          raw_payload: input.rawPayload,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await transaction
        .updateTable("conversations")
        .set({
          last_message_text: input.body,
          last_message_sender_type: input.senderType,
          last_message_at: message.sent_at,
          unread_count: input.senderType === "customer" ? 1 : 0,
          updated_at: new Date(),
        })
        .where("id", "=", conversation.id)
        .execute();

      return message;
    });
  }

  async listOrders(limit: number): Promise<OrderRecord[]> {
    return this.db
      .selectFrom("orders")
      .leftJoin("customers", "customers.id", "orders.customer_id")
      .selectAll("orders")
      .select("customers.full_name as customer_full_name")
      .orderBy("orders.created_at", "desc")
      .limit(limit)
      .execute();
  }

  async listProducts(limit: number): Promise<ProductRecord[]> {
    return this.db
      .selectFrom("products")
      .selectAll()
      .orderBy("updated_at", "desc")
      .orderBy("name", "asc")
      .limit(limit)
      .execute();
  }

  async createOrder(input: CreateOrderInput): Promise<OrderRecord> {
    return this.db.transaction().execute(async (transaction) => {
      const [customer, conversation] = await Promise.all([
        input.customerPublicId
          ? transaction
              .selectFrom("customers")
              .select(["id", "full_name"])
              .where("public_id", "=", input.customerPublicId)
              .executeTakeFirst()
          : null,
        input.conversationPublicId
          ? transaction
              .selectFrom("conversations")
              .select("id")
              .where("public_id", "=", input.conversationPublicId)
              .executeTakeFirst()
          : null,
      ]);

      const order = await transaction
        .insertInto("orders")
        .values({
          public_id: newPublicId("ord"),
          customer_id: customer?.id ?? null,
          conversation_id: conversation?.id ?? null,
          created_by_user_id: input.createdByUserId,
          order_number: input.orderNumber,
          status: input.status,
          source: input.source,
          total_amount: input.totalAmount,
          currency: input.currency,
          confirmation_status: null,
          notes: input.notes,
          external_order_id: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        ...order,
        customer_full_name: customer?.full_name ?? null,
      };
    });
  }

  async listShipments(limit: number): Promise<ShipmentRecord[]> {
    return this.db
      .selectFrom("shipments")
      .leftJoin("orders", "orders.id", "shipments.order_id")
      .leftJoin("customers", "customers.id", "shipments.customer_id")
      .selectAll("shipments")
      .select(["orders.order_number as order_number", "customers.full_name as customer_full_name"])
      .orderBy("shipments.created_at", "desc")
      .limit(limit)
      .execute();
  }

  async updateShipmentStatus(input: UpdateShipmentStatusInput): Promise<ShipmentRecord> {
    const shipment = await this.db
      .updateTable("shipments")
      .set({
        status: input.status,
        last_event_text: input.lastEventText,
        raw_payload: input.rawPayload,
        updated_at: new Date(),
      })
      .where("public_id", "=", input.shipmentPublicId)
      .returningAll()
      .executeTakeFirst();

    if (!shipment) {
      throw new Error(`Unknown shipment: ${input.shipmentPublicId}`);
    }

    return {
      ...shipment,
      order_number: null,
      customer_full_name: null,
    };
  }
}

export function serializeConversation(conversation: ConversationRecord) {
  return {
    public_id: conversation.public_id,
    channel: conversation.channel,
    status: conversation.status,
    is_in_pool: conversation.is_in_pool,
    human_agent_enabled: conversation.human_agent_enabled,
    unread_count: Number(conversation.unread_count),
    last_message_text: conversation.last_message_text,
    last_message_sender_type: conversation.last_message_sender_type,
    last_message_at: conversation.last_message_at,
    customer: conversation.customer_full_name
      ? {
          full_name: conversation.customer_full_name,
          phone: conversation.customer_phone,
        }
      : null,
    assigned_user_email: conversation.assigned_user_email,
    updated_at: conversation.updated_at,
  };
}

export function serializeCustomer(customer: CustomerRecord) {
  return {
    public_id: customer.public_id,
    full_name: customer.full_name,
    phone: customer.phone,
    email: customer.email,
    username: customer.username,
    notes: customer.notes,
    updated_at: customer.updated_at,
  };
}

export function serializeMessage(message: MessageRecord) {
  return {
    public_id: message.public_id,
    sender_type: message.sender_type,
    sender_name: message.sender_name,
    body: message.body,
    external_message_id: message.external_message_id,
    is_read: message.is_read,
    sent_at: message.sent_at,
  };
}

export function serializeOrder(order: OrderRecord) {
  return {
    public_id: order.public_id,
    order_number: order.order_number,
    status: order.status,
    source: order.source,
    total_amount: order.total_amount,
    currency: order.currency,
    confirmation_status: order.confirmation_status,
    notes: order.notes,
    customer_full_name: order.customer_full_name,
    created_at: order.created_at,
    updated_at: order.updated_at,
  };
}

export function serializeProduct(product: ProductRecord) {
  return {
    public_id: product.public_id,
    sku: product.sku,
    name: product.name,
    category: product.category,
    unit_price: product.unit_price,
    stock_quantity: product.stock_quantity,
    is_active: product.is_active,
    external_product_id: product.external_product_id,
    updated_at: product.updated_at,
  };
}

export function serializeShipment(shipment: ShipmentRecord) {
  return {
    public_id: shipment.public_id,
    provider: shipment.provider,
    tracking_number: shipment.tracking_number,
    barcode_number: shipment.barcode_number,
    status: shipment.status,
    recipient_name: shipment.recipient_name,
    recipient_phone: shipment.recipient_phone,
    recipient_city: shipment.recipient_city,
    recipient_district: shipment.recipient_district,
    last_event_text: shipment.last_event_text,
    order_number: shipment.order_number,
    customer_full_name: shipment.customer_full_name,
    updated_at: shipment.updated_at,
  };
}
