import type { AppDatabase } from "@garanti-kulucka/database";
import type { Selectable } from "kysely";
import type {
  ConversationsTable,
  CustomersTable,
  MessagesTable,
  OrdersTable,
  ProductsTable,
  ProviderAttemptsTable,
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
  created_by_user_public_id: string | null;
  created_by_user_email: string | null;
  cargo_provider: string | null;
};
export type ProductRecord = Selectable<ProductsTable>;
export type ProviderAttemptRecord = Selectable<ProviderAttemptsTable>;
export type ShipmentRecord = Selectable<ShipmentsTable> & {
  order_number: string | null;
  customer_full_name: string | null;
};
export type ShipmentPipelineStep = "mesaj" | "sms" | "vapi" | "teslim";
export type ShipmentPipelineStatus = "bekliyor" | "isleniyor" | "hata" | "teslim";

export interface ListConversationsFilter {
  channel?: string;
  channels?: string[];
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

export interface UpdateConversationStateInput {
  conversationPublicId: string;
  status?: string;
  unreadCount?: number;
  humanAgentEnabled?: boolean;
  isInPool?: boolean;
  assignedUserId?: number | null;
}

export interface ConversationSummaryRecord {
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

export interface CustomerSummaryRecord {
  total_count: number;
  with_phone_count: number;
  with_email_count: number;
  with_notes_count: number;
}

export interface ListOrdersFilter {
  status?: string;
  confirmationStatus?: string;
  search?: string;
  source?: string;
  cargoProvider?: string;
  createdByUserPublicId?: string;
  createdFrom?: Date;
  createdTo?: Date;
  sortBy?: "created_at" | "order_number" | "status" | "total_amount";
  sortDirection?: "asc" | "desc";
  offset?: number;
  limit: number;
}

export interface ListOrdersResult {
  rows: OrderRecord[];
  total_count: number;
  limit: number;
  offset: number;
}

export interface ListShipmentsFilter {
  provider?: string;
  providers?: string[];
  excludeProviders?: string[];
  status?: string;
  trackingMissing?: boolean;
  limit: number;
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

export interface UpdateOrderStatusInput {
  orderPublicId: string;
  status: string;
  notes?: string | null;
}

export interface RequestOrderPaymentInput {
  orderPublicId: string;
  amount: string;
  currency: string;
  idempotencyKey: string;
  requestId: string;
}

export interface PaymentRequestRecord {
  order: OrderRecord;
  attempt: ProviderAttemptRecord;
  replayed: boolean;
}

export interface BalanceSummaryRecord {
  total_commission: number;
  total_deduction: number;
  pending_payment: number;
  available_balance: number;
  pending_request_count: number;
}

export interface OrderSummaryRecord {
  total_count: number;
  active_count: number;
  delivered_count: number;
  pending_confirmation_count: number;
  total_revenue: number;
  currency: string;
}

export interface ProductSummaryRecord {
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

export interface ShipmentPipelineRowRecord {
  shipment_public_id: string;
  recipient_name: string;
  recipient_phone: string | null;
  tracking_number: string | null;
  barcode_number: string | null;
  step: ShipmentPipelineStep;
  pipeline_status: ShipmentPipelineStatus;
}

export interface ShipmentSummaryRecord {
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

export interface ShipmentPipelineSummaryRecord {
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
  rows: ShipmentPipelineRowRecord[];
}

export interface ReportSummaryRecord {
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

export interface UpdateShipmentStatusInput {
  shipmentPublicId: string;
  status: string;
  lastEventText: string | null;
  rawPayload: unknown | null;
}

function moneyCents(value: string) {
  const [whole = "0", fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

function centsToMoney(cents: number) {
  return Math.round(cents) / 100;
}

function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

function pipelineStepFromShipment(shipment: ShipmentRecord): ShipmentPipelineStep {
  if (shipment.status === "delivered") return "teslim";
  if (!shipment.recipient_phone) return "mesaj";
  const provider = shipment.provider.toLocaleLowerCase("tr-TR");
  if (provider.includes("sürat") || provider.includes("surat")) return "sms";
  return "vapi";
}

function pipelineStatusFromShipment(shipment: ShipmentRecord): ShipmentPipelineStatus {
  if (shipment.status === "delivered") return "teslim";
  if (!shipment.tracking_number && !shipment.barcode_number) return "hata";
  if (shipment.status === "in_transit") return "isleniyor";
  return "bekliyor";
}

export class DomainRepository {
  constructor(private readonly db: AppDatabase) {}

  private async getConversationByPublicId(db: AppDatabase, conversationPublicId: string): Promise<ConversationRecord | null> {
    const conversation = await db
      .selectFrom("conversations")
      .leftJoin("customers", "customers.id", "conversations.customer_id")
      .leftJoin("users", "users.id", "conversations.assigned_user_id")
      .selectAll("conversations")
      .select([
        "customers.full_name as customer_full_name",
        "customers.phone as customer_phone",
        "users.email as assigned_user_email",
      ])
      .where("conversations.public_id", "=", conversationPublicId)
      .executeTakeFirst();

    return conversation ?? null;
  }

  private async getOrderByPublicId(db: AppDatabase, orderPublicId: string): Promise<OrderRecord | null> {
    const order = await db
      .selectFrom("orders")
      .leftJoin("customers", "customers.id", "orders.customer_id")
      .leftJoin("users", "users.id", "orders.created_by_user_id")
      .leftJoin("shipments", "shipments.order_id", "orders.id")
      .selectAll("orders")
      .select([
        "customers.full_name as customer_full_name",
        "users.public_id as created_by_user_public_id",
        "users.email as created_by_user_email",
        "shipments.provider as cargo_provider",
      ])
      .where("orders.public_id", "=", orderPublicId)
      .executeTakeFirst();

    return order ?? null;
  }

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
      .$if(Boolean(filter.channels?.length), (builder) =>
        builder.where("conversations.channel", "in", filter.channels as string[]),
      )
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

  async getConversationSummary(): Promise<ConversationSummaryRecord> {
    const conversations = await this.listConversations({ limit: 200 });
    return conversations.reduce<ConversationSummaryRecord>(
      (summary, conversation) => {
        const channel = conversation.channel.toLocaleLowerCase("tr-TR");
        summary.total_count += 1;
        summary.unread_count += Number(conversation.unread_count);
        if (conversation.is_in_pool) summary.pool_count += 1;
        if (conversation.human_agent_enabled) summary.human_agent_count += 1;
        if (channel === "instagram") summary.channel_counts.instagram += 1;
        if (channel === "facebook" || channel === "messenger") summary.channel_counts.facebook += 1;
        if (conversation.status === "open") summary.status_counts.open += 1;
        if (conversation.status === "closed") summary.status_counts.closed += 1;
        return summary;
      },
      {
        total_count: 0,
        unread_count: 0,
        pool_count: 0,
        human_agent_count: 0,
        channel_counts: {
          instagram: 0,
          facebook: 0,
        },
        status_counts: {
          open: 0,
          closed: 0,
        },
      },
    );
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

  async getCustomerSummary(): Promise<CustomerSummaryRecord> {
    const summary = await this.db
      .selectFrom("customers")
      .select((expression) => [
        expression.fn.countAll<number>().as("total_count"),
        expression.fn.count<number>("phone").as("with_phone_count"),
        expression.fn.count<number>("email").as("with_email_count"),
        expression.fn.count<number>("notes").as("with_notes_count"),
      ])
      .executeTakeFirst();

    return {
      total_count: Number(summary?.total_count ?? 0),
      with_phone_count: Number(summary?.with_phone_count ?? 0),
      with_email_count: Number(summary?.with_email_count ?? 0),
      with_notes_count: Number(summary?.with_notes_count ?? 0),
    };
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

  async updateConversationState(input: UpdateConversationStateInput): Promise<ConversationRecord> {
    return this.db.transaction().execute(async (transaction) => {
      const conversation = await transaction
        .selectFrom("conversations")
        .select("id")
        .where("public_id", "=", input.conversationPublicId)
        .executeTakeFirst();

      if (!conversation) {
        throw new Error(`Unknown conversation: ${input.conversationPublicId}`);
      }

      if (input.unreadCount === 0) {
        await transaction
          .updateTable("messages")
          .set({
            is_read: true,
            updated_at: new Date(),
          })
          .where("conversation_id", "=", conversation.id)
          .execute();
      }

      await transaction
        .updateTable("conversations")
        .set({
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.unreadCount !== undefined ? { unread_count: input.unreadCount } : {}),
          ...(input.humanAgentEnabled !== undefined ? { human_agent_enabled: input.humanAgentEnabled } : {}),
          ...(input.isInPool !== undefined ? { is_in_pool: input.isInPool } : {}),
          ...(input.assignedUserId !== undefined ? { assigned_user_id: input.assignedUserId } : {}),
          updated_at: new Date(),
        })
        .where("id", "=", conversation.id)
        .execute();

      const updatedConversation = await this.getConversationByPublicId(transaction as AppDatabase, input.conversationPublicId);
      if (!updatedConversation) {
        throw new Error(`Unknown conversation: ${input.conversationPublicId}`);
      }
      return updatedConversation;
    });
  }

  private applyOrderFilters<T>(query: T, filter: ListOrdersFilter): T {
    const searchPattern = filter.search ? `%${filter.search}%` : null;
    type OrderFilterBuilder = {
      $if: (condition: boolean, callback: (builder: OrderFilterBuilder) => OrderFilterBuilder) => OrderFilterBuilder;
      where: (...args: unknown[]) => OrderFilterBuilder;
    };
    let next = query as OrderFilterBuilder;
    next = next
      .$if(filter.status === "active", (builder) =>
        builder.where("orders.status", "not in", ["cancelled", "returned", "delivered"]),
      )
      .$if(Boolean(filter.status && filter.status !== "active"), (builder) =>
        builder.where("orders.status", "=", filter.status as string),
      )
      .$if(filter.confirmationStatus === "pending", (builder) =>
        builder.where("orders.confirmation_status", "is", null),
      )
      .$if(Boolean(filter.confirmationStatus && filter.confirmationStatus !== "pending"), (builder) =>
        builder.where("orders.confirmation_status", "=", filter.confirmationStatus as string),
      )
      .$if(Boolean(filter.source), (builder) => builder.where("orders.source", "=", filter.source as string))
      .$if(Boolean(filter.createdByUserPublicId), (builder) =>
        builder.where("users.public_id", "=", filter.createdByUserPublicId as string),
      )
      .$if(Boolean(filter.createdFrom), (builder) => builder.where("orders.created_at", ">=", filter.createdFrom as Date))
      .$if(Boolean(filter.createdTo), (builder) => builder.where("orders.created_at", "<=", filter.createdTo as Date))
      .$if(Boolean(searchPattern), (builder) =>
        builder.where((expression: {
          or: (items: unknown[]) => unknown;
          (column: string, operator: string, value: string): unknown;
        }) =>
          expression.or([
            expression("orders.order_number", "ilike", searchPattern as string),
            expression("orders.status", "ilike", searchPattern as string),
            expression("orders.source", "ilike", searchPattern as string),
            expression("orders.notes", "ilike", searchPattern as string),
            expression("customers.full_name", "ilike", searchPattern as string),
          ]),
        ),
      );

    if (filter.cargoProvider === "surat") {
      next = next.where("shipments.provider", "in", ["surat", "Sürat"]) as typeof next;
    } else if (filter.cargoProvider === "other") {
      next = next.where("shipments.provider", "not in", ["ptt", "surat", "Sürat"]) as typeof next;
    } else if (filter.cargoProvider) {
      next = next.where("shipments.provider", "=", filter.cargoProvider) as typeof next;
    }

    return next as T;
  }

  async listOrdersPage(filter: ListOrdersFilter): Promise<ListOrdersResult> {
    const sortBy = filter.sortBy ?? "created_at";
    const sortDirection = filter.sortDirection ?? "desc";
    const offset = filter.offset ?? 0;
    const countQuery = this.applyOrderFilters(
      this.db
        .selectFrom("orders")
        .leftJoin("customers", "customers.id", "orders.customer_id")
        .leftJoin("users", "users.id", "orders.created_by_user_id")
        .leftJoin("shipments", "shipments.order_id", "orders.id")
        .select((expression) => [expression.fn.countAll<number>().as("total_count")]),
      filter,
    );
    const countRow = await countQuery.executeTakeFirst();
    const rows = await this.listOrders({ ...filter, sortBy, sortDirection, offset });

    return {
      rows,
      total_count: Number(countRow?.total_count ?? rows.length),
      limit: filter.limit,
      offset,
    };
  }

  async listOrders(filter: ListOrdersFilter): Promise<OrderRecord[]> {
    const sortBy = filter.sortBy ?? "created_at";
    const sortDirection = filter.sortDirection ?? "desc";
    const offset = filter.offset ?? 0;
    const baseQuery = this.db
      .selectFrom("orders")
      .leftJoin("customers", "customers.id", "orders.customer_id")
      .leftJoin("users", "users.id", "orders.created_by_user_id")
      .leftJoin("shipments", "shipments.order_id", "orders.id")
      .selectAll("orders")
      .select([
        "customers.full_name as customer_full_name",
        "users.public_id as created_by_user_public_id",
        "users.email as created_by_user_email",
        "shipments.provider as cargo_provider",
      ]);

    return this.applyOrderFilters(baseQuery, filter)
      .orderBy(`orders.${sortBy}`, sortDirection)
      .orderBy("orders.id", "desc")
      .offset(offset)
      .limit(filter.limit)
      .execute();
  }

  async getBalanceSummary(): Promise<BalanceSummaryRecord> {
    const orders = await this.listOrders({ limit: 200 });
    const payableOrders = orders.filter((order) => !["cancelled", "returned"].includes(order.status));
    const pendingOrders = payableOrders.filter((order) => order.confirmation_status === null);
    const cancelledOrders = orders.filter((order) => ["cancelled", "returned"].includes(order.status));
    const totalCommissionCents = payableOrders.reduce((sum, order) => sum + moneyCents(order.total_amount) * 0.1, 0);
    const totalDeductionCents = cancelledOrders.reduce((sum, order) => sum + moneyCents(order.total_amount) * 0.1, 0);
    const pendingPaymentCents = pendingOrders.reduce((sum, order) => sum + moneyCents(order.total_amount) * 0.1, 0);
    return {
      total_commission: centsToMoney(totalCommissionCents),
      total_deduction: centsToMoney(totalDeductionCents),
      pending_payment: centsToMoney(pendingPaymentCents),
      available_balance: centsToMoney(Math.max(totalCommissionCents - totalDeductionCents - pendingPaymentCents, 0)),
      pending_request_count: pendingOrders.length,
    };
  }

  async getOrderSummary(): Promise<OrderSummaryRecord> {
    const orders = await this.listOrders({ limit: 200 });
    return {
      total_count: orders.length,
      active_count: orders.filter((order) => !["cancelled", "returned", "delivered"].includes(order.status)).length,
      delivered_count: orders.filter((order) => order.status === "delivered").length,
      pending_confirmation_count: orders.filter((order) => order.confirmation_status === null).length,
      total_revenue: centsToMoney(orders.reduce((sum, order) => sum + moneyCents(order.total_amount), 0)),
      currency: orders[0]?.currency ?? "TRY",
    };
  }

  async getReportSummary(): Promise<ReportSummaryRecord> {
    const [conversations, orders, shipments] = await Promise.all([
      this.listConversations({ limit: 200 }),
      this.listOrders({ limit: 200 }),
      this.listShipments({ limit: 200 }),
    ]);
    const pendingConfirmationCount = orders.filter((order) => order.confirmation_status === null).length;
    const confirmedOrderCount = orders.length - pendingConfirmationCount;
    const activeShipmentCount = shipments.filter((shipment) => shipment.status !== "delivered").length;
    const deliveredShipmentCount = shipments.filter((shipment) => shipment.status === "delivered").length;
    const totalRevenueCents = orders.reduce((sum, order) => sum + moneyCents(order.total_amount), 0);
    const currency = orders[0]?.currency ?? "TRY";

    return {
      conversation_count: conversations.length,
      order_count: orders.length,
      shipment_count: shipments.length,
      total_revenue: centsToMoney(totalRevenueCents),
      currency,
      open_conversation_count: conversations.filter((conversation) => conversation.status === "open").length,
      pending_confirmation_count: pendingConfirmationCount,
      active_shipment_count: activeShipmentCount,
      delivered_shipment_count: deliveredShipmentCount,
      delivered_shipment_rate: percentage(deliveredShipmentCount, shipments.length),
      confirmation_rate: percentage(confirmedOrderCount, orders.length),
      active_shipment_rate: percentage(activeShipmentCount, shipments.length),
    };
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

  async getProductSummary(): Promise<ProductSummaryRecord> {
    const criticalThreshold = 3;
    const products = await this.listProducts(200);
    const incubatorCount = products.filter((product) => product.category === "incubator").length;
    const sparePartCount = products.filter((product) => product.category === "spare_part").length;

    return {
      total_count: products.length,
      active_count: products.filter((product) => product.is_active).length,
      critical_count: products.filter((product) => product.stock_quantity <= criticalThreshold).length,
      critical_threshold: criticalThreshold,
      category_counts: {
        incubator: incubatorCount,
        spare_part: sparePartCount,
        other: Math.max(products.length - incubatorCount - sparePartCount, 0),
      },
    };
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
        created_by_user_public_id: null,
        created_by_user_email: null,
        cargo_provider: null,
      };
    });
  }

  async updateOrderStatus(input: UpdateOrderStatusInput): Promise<OrderRecord> {
    const values: { status: string; notes?: string | null } = { status: input.status };
    if (input.notes !== undefined) {
      values.notes = input.notes;
    }
    const order = await this.db
      .updateTable("orders")
      .set({
        ...values,
        updated_at: new Date(),
      })
      .where("public_id", "=", input.orderPublicId)
      .returningAll()
      .executeTakeFirst();
    if (!order) {
      throw new Error(`Unknown order: ${input.orderPublicId}`);
    }
    return (await this.getOrderByPublicId(this.db, order.public_id)) ?? {
      ...order,
      customer_full_name: null,
      created_by_user_public_id: null,
      created_by_user_email: null,
      cargo_provider: null,
    };
  }

  async requestOrderPayment(input: RequestOrderPaymentInput): Promise<PaymentRequestRecord> {
    return this.db.transaction().execute(async (transaction) => {
      const order = await this.getOrderByPublicId(transaction as AppDatabase, input.orderPublicId);
      if (!order) {
        throw new Error(`Unknown order: ${input.orderPublicId}`);
      }

      const provider = await transaction
        .selectFrom("integration_providers")
        .select("id")
        .where("key", "=", "kolaybi")
        .where("is_active", "=", true)
        .executeTakeFirst();

      if (!provider) {
        throw new Error("Unknown provider for payment request persistence: kolaybi");
      }

      const existingAttempt = await transaction
        .selectFrom("provider_attempts")
        .selectAll()
        .where("provider_id", "=", provider.id)
        .where("idempotency_key", "=", input.idempotencyKey)
        .executeTakeFirst();

      if (existingAttempt) {
        assertPaymentRequestAttemptMatches(existingAttempt, input);
        return { order, attempt: existingAttempt, replayed: true };
      }

      const attempt = await transaction
        .insertInto("provider_attempts")
        .values({
          public_id: newPublicId("pat"),
          provider_id: provider.id,
          account_id: null,
          request_id: input.requestId,
          operation: "balance.payment_request",
          direction: "outbound",
          status: "success",
          status_code: null,
          duration_ms: 0,
          retry_decision: "none",
          next_retry_at: null,
          idempotency_key: input.idempotencyKey,
          request_metadata: {
            order_public_id: input.orderPublicId,
            amount: input.amount,
            currency: input.currency,
            live_call_permitted: false,
          },
          response_metadata: {
            mode: "dry_run",
            persisted: true,
          },
          error_code: null,
          error_message: null,
          started_at: new Date(),
        })
        .onConflict((oc) =>
          oc.columns(["provider_id", "idempotency_key"]).where("idempotency_key", "is not", null).doNothing(),
        )
        .returningAll()
        .executeTakeFirst();

      if (attempt) {
        return { order, attempt, replayed: false };
      }

      const replayedAttempt = await transaction
        .selectFrom("provider_attempts")
        .selectAll()
        .where("provider_id", "=", provider.id)
        .where("idempotency_key", "=", input.idempotencyKey)
        .executeTakeFirst();

      if (!replayedAttempt) {
        throw new Error(`Payment request idempotency conflict could not be replayed: ${input.idempotencyKey}`);
      }

      assertPaymentRequestAttemptMatches(replayedAttempt, input);
      return { order, attempt: replayedAttempt, replayed: true };
    });
  }

  async listShipments(filter: ListShipmentsFilter): Promise<ShipmentRecord[]> {
    return this.db
      .selectFrom("shipments")
      .leftJoin("orders", "orders.id", "shipments.order_id")
      .leftJoin("customers", "customers.id", "shipments.customer_id")
      .selectAll("shipments")
      .select(["orders.order_number as order_number", "customers.full_name as customer_full_name"])
      .$if(Boolean(filter.providers?.length), (builder) =>
        builder.where("shipments.provider", "in", filter.providers as string[]),
      )
      .$if(Boolean(filter.excludeProviders?.length), (builder) =>
        builder.where("shipments.provider", "not in", filter.excludeProviders as string[]),
      )
      .$if(Boolean(filter.provider), (builder) => builder.where("shipments.provider", "=", filter.provider as string))
      .$if(Boolean(filter.status), (builder) => builder.where("shipments.status", "=", filter.status as string))
      .$if(filter.trackingMissing === true, (builder) =>
        builder
          .where("shipments.tracking_number", "is", null)
          .where("shipments.barcode_number", "is", null),
      )
      .orderBy("shipments.created_at", "desc")
      .limit(filter.limit)
      .execute();
  }

  async getShipmentSummary(): Promise<ShipmentSummaryRecord> {
    const shipments = await this.listShipments({ limit: 200 });
    const pttShipments = shipments.filter((shipment) => shipment.provider.toLocaleLowerCase("tr-TR").includes("ptt"));
    const suratShipments = shipments.filter((shipment) => {
      const provider = shipment.provider.toLocaleLowerCase("tr-TR");
      return provider.includes("sürat") || provider.includes("surat");
    });
    const deliveredShipments = shipments.filter((shipment) => shipment.status === "delivered");

    return {
      total_count: shipments.length,
      active_count: shipments.length - deliveredShipments.length,
      delivered_count: deliveredShipments.length,
      recipient_phone_count: shipments.filter((shipment) => Boolean(shipment.recipient_phone)).length,
      provider_counts: {
        ptt: pttShipments.length,
        surat: suratShipments.length,
        other: Math.max(shipments.length - pttShipments.length - suratShipments.length, 0),
      },
      exception_counts: {
        ptt_not_delivered: pttShipments.filter((shipment) => shipment.status !== "delivered").length,
        surat_not_delivered: suratShipments.filter((shipment) => shipment.status !== "delivered").length,
        tracking_missing: shipments.filter((shipment) => !shipment.tracking_number && !shipment.barcode_number).length,
      },
    };
  }

  async getShipmentPipelineSummary(): Promise<ShipmentPipelineSummaryRecord> {
    const shipments = await this.listShipments({ limit: 200 });
    const rows = shipments.map((shipment) => ({
      shipment_public_id: shipment.public_id,
      recipient_name: shipment.recipient_name,
      recipient_phone: shipment.recipient_phone,
      tracking_number: shipment.tracking_number,
      barcode_number: shipment.barcode_number,
      step: pipelineStepFromShipment(shipment),
      pipeline_status: pipelineStatusFromShipment(shipment),
    }));
    return {
      counts: {
        all: rows.length,
        mesaj: rows.filter((row) => row.step === "mesaj").length,
        sms: rows.filter((row) => row.step === "sms").length,
        vapi: rows.filter((row) => row.step === "vapi").length,
        teslim: rows.filter((row) => row.step === "teslim").length,
        bekliyor: rows.filter((row) => row.pipeline_status === "bekliyor").length,
        isleniyor: rows.filter((row) => row.pipeline_status === "isleniyor").length,
        hata: rows.filter((row) => row.pipeline_status === "hata").length,
      },
      rows,
    };
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

function assertPaymentRequestAttemptMatches(attempt: ProviderAttemptRecord, input: RequestOrderPaymentInput) {
  const metadata = attempt.request_metadata as {
    order_public_id?: unknown;
    amount?: unknown;
    currency?: unknown;
  };
  if (
    metadata.order_public_id !== input.orderPublicId ||
    metadata.amount !== input.amount ||
    metadata.currency !== input.currency
  ) {
    throw new Error(`Payment request idempotency key reuse mismatch: ${input.idempotencyKey}`);
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

export function serializeConversationSummary(summary: ConversationSummaryRecord) {
  return summary;
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

export function serializeCustomerSummary(summary: CustomerSummaryRecord) {
  return summary;
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
    cargo_provider: order.cargo_provider,
    total_amount: order.total_amount,
    currency: order.currency,
    confirmation_status: order.confirmation_status,
    notes: order.notes,
    customer_full_name: order.customer_full_name,
    created_by_user_public_id: order.created_by_user_public_id,
    created_by_user_email: order.created_by_user_email,
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

export function serializeProductSummary(summary: ProductSummaryRecord) {
  return summary;
}

export function serializeShipmentSummary(summary: ShipmentSummaryRecord) {
  return summary;
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
