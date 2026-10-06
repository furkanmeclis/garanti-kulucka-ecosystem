import { sql, type AppDatabase, type Selectable } from "@garanti-kulucka/database";
import type {
  ConversationsTable,
  CustomersTable,
  CustomerAddressesTable,
  FilesTable,
  MessageAttachmentsTable,
  MessageShortcutAttachmentsTable,
  MessageShortcutsTable,
  MessagesTable,
  OrderItemsTable,
  OrdersTable,
  ProductsTable,
  ProviderAttemptsTable,
  ShipmentTrackingEventsTable,
  ShipmentsTable,
  StockMovementsTable,
} from "@garanti-kulucka/database";
import { applyOrderBalanceRules } from "../balances/repository.js";
import { newPublicId } from "../auth/crypto.js";

export type ConversationRecord = Selectable<ConversationsTable> & {
  customer_full_name: string | null;
  customer_phone: string | null;
  assigned_user_email: string | null;
};

export type CustomerRecord = Selectable<CustomersTable>;
export type CustomerAddressRecord = Selectable<CustomerAddressesTable>;
export type MessageRecord = Selectable<MessagesTable>;
export type MessageAttachmentRecord = Selectable<MessageAttachmentsTable> & {
  file_public_id: string;
  original_name: string | null;
  mime_type: string | null;
  byte_size: number | null;
};
export type MessageWithAttachmentsRecord = MessageRecord & {
  attachments: MessageAttachmentRecord[];
};
export type MessageShortcutRecord = Selectable<MessageShortcutsTable> & {
  attachments: MessageShortcutAttachmentRecord[];
};
export type MessageShortcutAttachmentRecord = Selectable<MessageShortcutAttachmentsTable> & {
  file_public_id: string;
  original_name: string | null;
  mime_type: string | null;
  byte_size: number | null;
};
type ShortcutTableRecord = Selectable<MessageShortcutsTable>;
export type OrderRecord = Selectable<OrdersTable> & {
  customer_full_name: string | null;
  created_by_user_public_id: string | null;
  created_by_user_email: string | null;
  cargo_provider: string | null;
};
export type ProductRecord = Selectable<ProductsTable>;
export type OrderItemRecord = Selectable<OrderItemsTable>;
export type StockMovementRecord = Selectable<StockMovementsTable> & {
  product_public_id: string;
  created_by_user_email: string | null;
};
export type ProductCategory = "incubator" | "spare_part" | "other";

export interface ListInventoryProductsFilter {
  limit: number;
  category?: ProductCategory;
  search?: string;
  active?: boolean;
}

export interface CreateProductInput {
  name: string;
  sku: string | null;
  category: ProductCategory | null;
  unit: string;
  unitPrice: string;
  stockQuantity: number;
  description: string | null;
  externalProductId: string | null;
  actorUserId: number | null;
}

export interface UpdateProductInput {
  productPublicId: string;
  name?: string;
  sku?: string | null;
  category?: ProductCategory;
  unit?: string;
  unitPrice?: string;
  stockQuantity?: number;
  description?: string | null;
  externalProductId?: string | null;
  actorUserId: number | null;
}

export interface CreateStockMovementInput {
  productPublicId: string;
  movementType: "in" | "out";
  quantity: number;
  notes: string | null;
  actorUserId: number | null;
}

export class ProductNotFoundError extends Error {
  constructor(productPublicId: string) {
    super(`Unknown product: ${productPublicId}`);
    this.name = "ProductNotFoundError";
  }
}

export class InsufficientStockError extends Error {
  constructor(readonly currentQuantity: number, readonly requestedQuantity: number) {
    super(`Yetersiz stok! Mevcut: ${currentQuantity}, Çıkış: ${requestedQuantity}`);
    this.name = "InsufficientStockError";
  }
}

export class DuplicateProductSkuError extends Error {
  constructor(sku: string) {
    super(`Product code already exists: ${sku}`);
    this.name = "DuplicateProductSkuError";
  }
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505";
}

/** Legacy StokPage name-based category inference (kuluçka/makine, yedek/parça). */
export function inferProductCategory(name: string): ProductCategory {
  const normalized = name.toLocaleLowerCase("tr");
  if (normalized.includes("kuluçka") || normalized.includes("makine")) return "incubator";
  if (normalized.includes("yedek") || normalized.includes("parça")) return "spare_part";
  return "other";
}
export type ProviderAttemptRecord = Selectable<ProviderAttemptsTable>;
export type ShipmentRecord = Selectable<ShipmentsTable> & {
  order_number: string | null;
  customer_full_name: string | null;
  tracking_events?: ShipmentTrackingEventRecord[];
};
export type ShipmentTrackingEventRecord = Selectable<ShipmentTrackingEventsTable>;
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
  attachments?: MessageAttachmentInput[];
}

export interface MessageAttachmentInput {
  filePublicId: string;
  attachmentType: "image" | "video" | "document" | "file";
}

export interface UpdateConversationStateInput {
  conversationPublicId: string;
  status?: string;
  unreadCount?: number;
  humanAgentEnabled?: boolean;
  isInPool?: boolean;
  assignedUserId?: number | null;
}

export interface UpdateConversationNotesInput {
  conversationPublicId: string;
  notes: string | null;
}

export interface UpdateCustomerNotesInput {
  conversationPublicId: string;
  notes: string | null;
}

export interface CreateMessageShortcutInput {
  code: string;
  message: string | null;
  type?: "default" | "custom";
  isActive?: boolean;
  sortOrder?: number;
  createdByUserId?: number | null;
  attachments?: MessageAttachmentInput[];
}

export interface UpdateMessageShortcutInput {
  shortcutPublicId: string;
  code?: string;
  message?: string | null;
  isActive?: boolean;
  sortOrder?: number;
  attachments?: MessageAttachmentInput[];
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
  search?: string;
  trackingMissing?: boolean;
  offset?: number;
  limit: number;
}

export interface ListShipmentsResult {
  rows: ShipmentRecord[];
  total_count: number;
  limit: number;
  offset: number;
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

export interface CreateOrderLineItemInput {
  productPublicId: string | null;
  name: string;
  quantity: number;
  unitPrice: string;
  totalAmount: string;
  externalProductId: string | null;
}

export interface CreateOrderFromFormInput {
  customerPublicId: string | null;
  customer: {
    fullName: string;
    phone: string;
    email: string | null;
    username: string | null;
  } | null;
  address: {
    addressLine: string;
    city: string;
    district: string;
    country: string;
    postalCode: string | null;
  };
  conversationPublicId: string | null;
  createdByUserId: number | null;
  status: string;
  source: string;
  cargoProvider: "ptt" | "surat";
  totalAmount: string;
  currency: string;
  notes: string | null;
  items: CreateOrderLineItemInput[];
}

export interface UpdateOrderStatusInput {
  orderPublicId: string;
  status: string;
  notes?: string | null;
  actorRole?: string | null;
  actorUserId?: number | null;
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

function normalizedPhone(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "").slice(-10);
}

function orderNumberFromDate(date: Date) {
  const stamp = date.toISOString().replace(/\D/g, "").slice(0, 14);
  return `ORD-${stamp}-${Math.floor(Math.random() * 900 + 100)}`;
}

function orderCargoProviderExpression() {
  return sql<string | null>`
    coalesce(
      orders.cargo_provider,
      (
        select latest_shipments.provider
        from shipments latest_shipments
        where latest_shipments.order_id = orders.id
        order by latest_shipments.created_at desc, latest_shipments.id desc
        limit 1
      )
    )
  `;
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

  private async findAvailableFilesByPublicIds(
    db: AppDatabase,
    filePublicIds: string[],
  ): Promise<Array<Selectable<FilesTable>>> {
    if (filePublicIds.length === 0) return [];
    return db
      .selectFrom("files")
      .selectAll()
      .where("public_id", "in", filePublicIds)
      .where("upload_status", "=", "available")
      .where("scan_status", "!=", "infected")
      .execute();
  }

  private async listMessageAttachmentsByMessageIds(messageIds: number[]): Promise<MessageAttachmentRecord[]> {
    if (messageIds.length === 0) return [];
    return this.db
      .selectFrom("message_attachments")
      .innerJoin("files", "files.id", "message_attachments.file_id")
      .selectAll("message_attachments")
      .select([
        "files.public_id as file_public_id",
        "files.original_name as original_name",
        "files.mime_type as mime_type",
        "files.byte_size as byte_size",
      ])
      .where("message_attachments.message_id", "in", messageIds)
      .orderBy("message_attachments.created_at", "asc")
      .execute();
  }

  private async listShortcutAttachmentsByShortcutIds(shortcutIds: number[]): Promise<MessageShortcutAttachmentRecord[]> {
    if (shortcutIds.length === 0) return [];
    return this.db
      .selectFrom("message_shortcut_attachments")
      .innerJoin("files", "files.id", "message_shortcut_attachments.file_id")
      .selectAll("message_shortcut_attachments")
      .select([
        "files.public_id as file_public_id",
        "files.original_name as original_name",
        "files.mime_type as mime_type",
        "files.byte_size as byte_size",
      ])
      .where("message_shortcut_attachments.shortcut_id", "in", shortcutIds)
      .orderBy("message_shortcut_attachments.sort_order", "asc")
      .orderBy("message_shortcut_attachments.created_at", "asc")
      .execute();
  }

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
      .selectAll("orders")
      .select([
        "customers.full_name as customer_full_name",
        "users.public_id as created_by_user_public_id",
        "users.email as created_by_user_email",
      ])
      .select(orderCargoProviderExpression().as("cargo_provider"))
      .where("orders.public_id", "=", orderPublicId)
      .executeTakeFirst();

    return order ?? null;
  }

  private async lookupCustomerByPhoneInDb(
    db: AppDatabase,
    phone: string,
  ): Promise<{ customer: CustomerRecord | null; defaultAddress: CustomerAddressRecord | null }> {
    const phoneTail = normalizedPhone(phone);
    if (!phoneTail) return { customer: null, defaultAddress: null };

    const customers = await db
      .selectFrom("customers")
      .selectAll()
      .where("phone", "is not", null)
      .orderBy("updated_at", "desc")
      .limit(100)
      .execute();
    const customer = customers.find((item) => normalizedPhone(item.phone) === phoneTail) ?? null;
    const defaultAddress = customer
      ? await db
          .selectFrom("customer_addresses")
          .selectAll()
          .where("customer_id", "=", customer.id)
          .orderBy("is_default", "desc")
          .orderBy("updated_at", "desc")
          .executeTakeFirst()
      : null;

    return { customer, defaultAddress: defaultAddress ?? null };
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

  async listMessages(conversationPublicId: string, limit: number): Promise<MessageWithAttachmentsRecord[]> {
    const conversation = await this.db
      .selectFrom("conversations")
      .select("id")
      .where("public_id", "=", conversationPublicId)
      .executeTakeFirst();

    if (!conversation) {
      return [];
    }

    const messages = await this.db
      .selectFrom("messages")
      .selectAll()
      .where("conversation_id", "=", conversation.id)
      .orderBy("sent_at", "asc")
      .limit(limit)
      .execute();
    const attachments = await this.listMessageAttachmentsByMessageIds(messages.map((message) => message.id));
    const attachmentsByMessageId = new Map<number, MessageAttachmentRecord[]>();
    for (const attachment of attachments) {
      const list = attachmentsByMessageId.get(attachment.message_id) ?? [];
      list.push(attachment);
      attachmentsByMessageId.set(attachment.message_id, list);
    }

    return messages.map((message) => ({
      ...message,
      attachments: attachmentsByMessageId.get(message.id) ?? [],
    }));
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

  async lookupCustomerByPhone(phone: string): Promise<{ customer: CustomerRecord | null; defaultAddress: CustomerAddressRecord | null }> {
    return this.lookupCustomerByPhoneInDb(this.db, phone);
  }

  async findDuplicateActiveOrders(input: { phone: string; fullName: string }): Promise<{ phoneMatches: OrderRecord[]; nameMatches: OrderRecord[] }> {
    const phoneTail = normalizedPhone(input.phone);
    const activeOrders = await this.listOrders({ status: "active", limit: 200 });
    let phoneMatches: OrderRecord[] = [];
    if (phoneTail) {
      type OrderWithCustomerPhone = OrderRecord & { customer_phone: string | null };
      const matchedCustomers: OrderWithCustomerPhone[] = await this.db
        .selectFrom("orders")
        .leftJoin("customers", "customers.id", "orders.customer_id")
        .leftJoin("users", "users.id", "orders.created_by_user_id")
        .selectAll("orders")
        .select([
          "customers.full_name as customer_full_name",
          "users.public_id as created_by_user_public_id",
          "users.email as created_by_user_email",
          "customers.phone as customer_phone",
        ])
        .select(orderCargoProviderExpression().as("cargo_provider"))
        .where("orders.status", "not in", ["cancelled", "returned"])
        .where("orders.deleted_at", "is", null)
        .orderBy("orders.created_at", "desc")
        .limit(200)
        .execute();
      phoneMatches = matchedCustomers
        .filter((order) => normalizedPhone(order.customer_phone) === phoneTail)
        .map(({ customer_phone: _customerPhone, ...order }) => order as OrderRecord);
    }

    const normalizedName = input.fullName.trim().toLocaleLowerCase("tr-TR");
    const nameMatches = normalizedName.length >= 4
      ? activeOrders.filter((order) => (order.customer_full_name ?? "").trim().toLocaleLowerCase("tr-TR") === normalizedName)
      : [];
    return { phoneMatches, nameMatches };
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

  async createMessage(input: CreateMessageInput): Promise<MessageWithAttachmentsRecord> {
    return this.db.transaction().execute(async (transaction) => {
      const conversation = await transaction
        .selectFrom("conversations")
        .select("id")
        .where("public_id", "=", input.conversationPublicId)
        .executeTakeFirst();

      if (!conversation) {
        throw new Error(`Unknown conversation: ${input.conversationPublicId}`);
      }

      const attachmentInputs = input.attachments ?? [];
      const files = await this.findAvailableFilesByPublicIds(
        transaction as AppDatabase,
        attachmentInputs.map((attachment) => attachment.filePublicId),
      );
      if (files.length !== attachmentInputs.length) {
        throw new Error("One or more attachment files are unavailable");
      }
      const filesByPublicId = new Map(files.map((file) => [file.public_id, file]));

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

      if (attachmentInputs.length > 0) {
        await transaction
          .insertInto("message_attachments")
          .values(attachmentInputs.map((attachment) => {
            const file = filesByPublicId.get(attachment.filePublicId);
            if (!file) {
              throw new Error("One or more attachment files are unavailable");
            }
            return {
              public_id: newPublicId("mat"),
              message_id: message.id,
              file_id: file.id,
              attachment_type: attachment.attachmentType,
            };
          }))
          .execute();
      }

      await transaction
        .updateTable("conversations")
        .set({
          last_message_text: input.body ?? (attachmentInputs.length > 0 ? "[Medya]" : null),
          last_message_sender_type: input.senderType,
          last_message_at: message.sent_at,
          unread_count: input.senderType === "customer" ? 1 : 0,
          updated_at: new Date(),
        })
        .where("id", "=", conversation.id)
        .execute();

      return {
        ...message,
        attachments: attachmentInputs.map((attachment) => {
          const file = filesByPublicId.get(attachment.filePublicId);
          if (!file) {
            throw new Error("One or more attachment files are unavailable");
          }
          return {
            id: 0,
            public_id: "",
            message_id: message.id,
            file_id: file.id,
            attachment_type: attachment.attachmentType,
            created_at: message.created_at,
            updated_at: message.updated_at,
            file_public_id: file.public_id,
            original_name: file.original_name,
            mime_type: file.mime_type,
            byte_size: file.byte_size,
          };
        }),
      };
    });
  }

  async updateConversationNotes(input: UpdateConversationNotesInput): Promise<ConversationRecord> {
    await this.db
      .updateTable("conversations")
      .set({
        notes: input.notes,
        updated_at: new Date(),
      })
      .where("public_id", "=", input.conversationPublicId)
      .execute();

    const conversation = await this.getConversationByPublicId(this.db, input.conversationPublicId);
    if (!conversation) {
      throw new Error(`Unknown conversation: ${input.conversationPublicId}`);
    }
    return conversation;
  }

  async updateCustomerNotes(input: UpdateCustomerNotesInput): Promise<CustomerRecord> {
    return this.db.transaction().execute(async (transaction) => {
      const conversation = await transaction
        .selectFrom("conversations")
        .select("customer_id")
        .where("public_id", "=", input.conversationPublicId)
        .executeTakeFirst();
      if (!conversation?.customer_id) {
        throw new Error(`Conversation has no customer: ${input.conversationPublicId}`);
      }
      return transaction
        .updateTable("customers")
        .set({
          notes: input.notes,
          updated_at: new Date(),
        })
        .where("id", "=", conversation.customer_id)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  async listMessageShortcuts(): Promise<MessageShortcutRecord[]> {
    const shortcuts = await this.db
      .selectFrom("message_shortcuts")
      .selectAll()
      .orderBy("is_active", "desc")
      .orderBy("sort_order", "asc")
      .orderBy("created_at", "asc")
      .execute();
    const attachments = await this.listShortcutAttachmentsByShortcutIds(shortcuts.map((shortcut) => shortcut.id));
    const attachmentsByShortcutId = new Map<number, MessageShortcutAttachmentRecord[]>();
    for (const attachment of attachments) {
      const list = attachmentsByShortcutId.get(attachment.shortcut_id) ?? [];
      list.push(attachment);
      attachmentsByShortcutId.set(attachment.shortcut_id, list);
    }
    return shortcuts.map((shortcut) => ({
      ...shortcut,
      attachments: attachmentsByShortcutId.get(shortcut.id) ?? [],
    }));
  }

  async createMessageShortcut(input: CreateMessageShortcutInput): Promise<MessageShortcutRecord> {
    return this.db.transaction().execute(async (transaction) => {
      const attachmentInputs = input.attachments ?? [];
      const files = await this.findAvailableFilesByPublicIds(
        transaction as AppDatabase,
        attachmentInputs.map((attachment) => attachment.filePublicId),
      );
      if (files.length !== attachmentInputs.length) {
        throw new Error("One or more shortcut files are unavailable");
      }
      const filesByPublicId = new Map(files.map((file) => [file.public_id, file]));
      const shortcut = await transaction
        .insertInto("message_shortcuts")
        .values({
          public_id: newPublicId("msc"),
          code: input.code,
          message: input.message,
          type: input.type ?? "custom",
          is_active: input.isActive ?? true,
          sort_order: input.sortOrder ?? 999,
          created_by_user_id: input.createdByUserId ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      if (attachmentInputs.length > 0) {
        await transaction
          .insertInto("message_shortcut_attachments")
          .values(attachmentInputs.map((attachment, index) => {
            const file = filesByPublicId.get(attachment.filePublicId);
            if (!file) {
              throw new Error("One or more shortcut files are unavailable");
            }
            return {
              public_id: newPublicId("msa"),
              shortcut_id: shortcut.id,
              file_id: file.id,
              attachment_type: attachment.attachmentType,
              sort_order: index,
            };
          }))
          .execute();
      }
      return {
        ...shortcut,
        attachments: attachmentInputs.map((attachment, index) => {
          const file = filesByPublicId.get(attachment.filePublicId);
          if (!file) {
            throw new Error("One or more shortcut files are unavailable");
          }
          return {
            id: 0,
            public_id: "",
            shortcut_id: shortcut.id,
            file_id: file.id,
            attachment_type: attachment.attachmentType,
            sort_order: index,
            created_at: shortcut.created_at,
            updated_at: shortcut.updated_at,
            file_public_id: file.public_id,
            original_name: file.original_name,
            mime_type: file.mime_type,
            byte_size: file.byte_size,
          };
        }),
      };
    });
  }

  async updateMessageShortcut(input: UpdateMessageShortcutInput): Promise<MessageShortcutRecord> {
    return this.db.transaction().execute(async (transaction) => {
      const shortcut = await transaction
        .selectFrom("message_shortcuts")
        .selectAll()
        .where("public_id", "=", input.shortcutPublicId)
        .executeTakeFirst();
      if (!shortcut) {
        throw new Error(`Unknown message shortcut: ${input.shortcutPublicId}`);
      }
      await transaction
        .updateTable("message_shortcuts")
        .set({
          ...(input.code !== undefined ? { code: input.code } : {}),
          ...(input.message !== undefined ? { message: input.message } : {}),
          ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
          ...(input.sortOrder !== undefined ? { sort_order: input.sortOrder } : {}),
          updated_at: new Date(),
        })
        .where("id", "=", shortcut.id)
        .execute();
      if (input.attachments !== undefined) {
        const files = await this.findAvailableFilesByPublicIds(
          transaction as AppDatabase,
          input.attachments.map((attachment) => attachment.filePublicId),
        );
        if (files.length !== input.attachments.length) {
          throw new Error("One or more shortcut files are unavailable");
        }
        const filesByPublicId = new Map(files.map((file) => [file.public_id, file]));
        await transaction
          .deleteFrom("message_shortcut_attachments")
          .where("shortcut_id", "=", shortcut.id)
          .execute();
        if (input.attachments.length > 0) {
          await transaction
            .insertInto("message_shortcut_attachments")
            .values(input.attachments.map((attachment, index) => {
              const file = filesByPublicId.get(attachment.filePublicId);
              if (!file) {
                throw new Error("One or more shortcut files are unavailable");
              }
              return {
                public_id: newPublicId("msa"),
                shortcut_id: shortcut.id,
                file_id: file.id,
                attachment_type: attachment.attachmentType,
                sort_order: index,
              };
            }))
            .execute();
        }
      }
      const updated = await transaction
        .selectFrom("message_shortcuts")
        .selectAll()
        .where("id", "=", shortcut.id)
        .executeTakeFirstOrThrow();
      const attachments = await transaction
        .selectFrom("message_shortcut_attachments")
        .innerJoin("files", "files.id", "message_shortcut_attachments.file_id")
        .selectAll("message_shortcut_attachments")
        .select([
          "files.public_id as file_public_id",
          "files.original_name as original_name",
          "files.mime_type as mime_type",
          "files.byte_size as byte_size",
        ])
        .where("message_shortcut_attachments.shortcut_id", "=", shortcut.id)
        .orderBy("message_shortcut_attachments.sort_order", "asc")
        .execute();
      return {
        ...updated,
        attachments,
      };
    });
  }

  async deleteMessageShortcut(shortcutPublicId: string): Promise<MessageShortcutRecord> {
    return this.db.transaction().execute(async (transaction) => {
      const shortcut = await transaction
        .selectFrom("message_shortcuts")
        .selectAll()
        .where("public_id", "=", shortcutPublicId)
        .executeTakeFirst();
      if (!shortcut) {
        throw new Error(`Unknown message shortcut: ${shortcutPublicId}`);
      }
      await transaction
        .deleteFrom("message_shortcuts")
        .where("id", "=", shortcut.id)
        .execute();
      return {
        ...shortcut,
        attachments: [],
      };
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
      .where("orders.deleted_at", "is", null)
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
      next = next.where(orderCargoProviderExpression(), "in", ["surat", "Sürat"]) as typeof next;
    } else if (filter.cargoProvider === "other") {
      next = next.where(orderCargoProviderExpression(), "not in", ["ptt", "surat", "Sürat"]) as typeof next;
    } else if (filter.cargoProvider) {
      next = next.where(orderCargoProviderExpression(), "=", filter.cargoProvider) as typeof next;
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
      .selectAll("orders")
      .select([
        "customers.full_name as customer_full_name",
        "users.public_id as created_by_user_public_id",
        "users.email as created_by_user_email",
      ])
      .select(orderCargoProviderExpression().as("cargo_provider"));

    return this.applyOrderFilters(baseQuery, filter)
      .orderBy(`orders.${sortBy}`, sortDirection)
      .orderBy("orders.id", "desc")
      .offset(offset)
      .limit(filter.limit)
      .execute();
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

  async listOrderProductOptions(limit: number): Promise<ProductRecord[]> {
    return this.db
      .selectFrom("products")
      .selectAll()
      .where("is_active", "=", true)
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

  async listInventoryProducts(filter: ListInventoryProductsFilter): Promise<ProductRecord[]> {
    let query = this.db.selectFrom("products").selectAll();
    if (filter.active !== undefined) {
      query = query.where("is_active", "=", filter.active);
    }
    if (filter.category === "other") {
      query = query.where((eb) =>
        eb.or([eb("category", "is", null), eb("category", "not in", ["incubator", "spare_part"])]),
      );
    } else if (filter.category) {
      query = query.where("category", "=", filter.category);
    }
    const search = filter.search?.trim();
    if (search) {
      const pattern = `%${search.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
      query = query.where((eb) => eb.or([eb("name", "ilike", pattern), eb("sku", "ilike", pattern)]));
    }
    return query.orderBy("category", "asc").orderBy("name", "asc").limit(filter.limit).execute();
  }

  async createProduct(input: CreateProductInput): Promise<ProductRecord> {
    try {
      return await this.db.transaction().execute(async (transaction) => {
        const product = await transaction
          .insertInto("products")
          .values({
            public_id: newPublicId("prd"),
            sku: input.sku,
            name: input.name,
            category: input.category ?? inferProductCategory(input.name),
            unit: input.unit,
            unit_price: input.unitPrice,
            stock_quantity: input.stockQuantity,
            description: input.description,
            external_product_id: input.externalProductId,
            is_active: true,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        if (product.stock_quantity > 0) {
          await transaction
            .insertInto("stock_movements")
            .values({
              public_id: newPublicId("stm"),
              product_id: product.id,
              movement_type: "in",
              quantity: product.stock_quantity,
              previous_quantity: 0,
              new_quantity: product.stock_quantity,
              notes: "Açılış stoğu",
              created_by_user_id: input.actorUserId,
            })
            .execute();
        }
        return product;
      });
    } catch (error) {
      if (isUniqueViolation(error) && input.sku) {
        throw new DuplicateProductSkuError(input.sku);
      }
      throw error;
    }
  }

  async updateProduct(input: UpdateProductInput): Promise<ProductRecord> {
    try {
      return await this.db.transaction().execute(async (transaction) => {
        const current = await transaction
          .selectFrom("products")
          .selectAll()
          .where("public_id", "=", input.productPublicId)
          .forUpdate()
          .executeTakeFirst();
        if (!current) {
          throw new ProductNotFoundError(input.productPublicId);
        }
        const updated = await transaction
          .updateTable("products")
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.sku !== undefined ? { sku: input.sku } : {}),
            ...(input.category !== undefined ? { category: input.category } : {}),
            ...(input.unit !== undefined ? { unit: input.unit } : {}),
            ...(input.unitPrice !== undefined ? { unit_price: input.unitPrice } : {}),
            ...(input.stockQuantity !== undefined ? { stock_quantity: input.stockQuantity } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.externalProductId !== undefined ? { external_product_id: input.externalProductId } : {}),
            updated_at: new Date(),
          })
          .where("id", "=", current.id)
          .returningAll()
          .executeTakeFirstOrThrow();
        if (input.stockQuantity !== undefined && input.stockQuantity !== current.stock_quantity) {
          await transaction
            .insertInto("stock_movements")
            .values({
              public_id: newPublicId("stm"),
              product_id: current.id,
              movement_type: "adjustment",
              quantity: Math.abs(input.stockQuantity - current.stock_quantity),
              previous_quantity: current.stock_quantity,
              new_quantity: input.stockQuantity,
              notes: "Stok kartı düzenlemesi",
              created_by_user_id: input.actorUserId,
            })
            .execute();
        }
        return updated;
      });
    } catch (error) {
      if (isUniqueViolation(error) && input.sku) {
        throw new DuplicateProductSkuError(input.sku);
      }
      throw error;
    }
  }

  async deactivateProduct(productPublicId: string): Promise<ProductRecord> {
    const product = await this.db
      .updateTable("products")
      .set({ is_active: false, updated_at: new Date() })
      .where("public_id", "=", productPublicId)
      .returningAll()
      .executeTakeFirst();
    if (!product) {
      throw new ProductNotFoundError(productPublicId);
    }
    return product;
  }

  async createStockMovement(input: CreateStockMovementInput): Promise<{ product: ProductRecord; movement: StockMovementRecord }> {
    return this.db.transaction().execute(async (transaction) => {
      const current = await transaction
        .selectFrom("products")
        .selectAll()
        .where("public_id", "=", input.productPublicId)
        .forUpdate()
        .executeTakeFirst();
      if (!current) {
        throw new ProductNotFoundError(input.productPublicId);
      }
      const delta = input.movementType === "in" ? input.quantity : -input.quantity;
      const product = await transaction
        .updateTable("products")
        .set({ stock_quantity: sql<number>`stock_quantity + ${delta}`, updated_at: new Date() })
        .where("id", "=", current.id)
        .where(sql<boolean>`stock_quantity + ${delta} >= 0`)
        .returningAll()
        .executeTakeFirst();
      if (!product) {
        throw new InsufficientStockError(current.stock_quantity, input.quantity);
      }
      const movement = await transaction
        .insertInto("stock_movements")
        .values({
          public_id: newPublicId("stm"),
          product_id: current.id,
          movement_type: input.movementType,
          quantity: input.quantity,
          previous_quantity: product.stock_quantity - delta,
          new_quantity: product.stock_quantity,
          notes: input.notes,
          created_by_user_id: input.actorUserId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const actor = input.actorUserId
        ? await transaction.selectFrom("users").select("email").where("id", "=", input.actorUserId).executeTakeFirst()
        : undefined;
      return {
        product,
        movement: { ...movement, product_public_id: product.public_id, created_by_user_email: actor?.email ?? null },
      };
    });
  }

  async listStockMovements(productPublicId: string, limit: number): Promise<StockMovementRecord[]> {
    const product = await this.db
      .selectFrom("products")
      .select(["id", "public_id"])
      .where("public_id", "=", productPublicId)
      .executeTakeFirst();
    if (!product) {
      throw new ProductNotFoundError(productPublicId);
    }
    const rows = await this.db
      .selectFrom("stock_movements")
      .leftJoin("users", "users.id", "stock_movements.created_by_user_id")
      .selectAll("stock_movements")
      .select("users.email as created_by_user_email")
      .where("stock_movements.product_id", "=", product.id)
      .orderBy("stock_movements.created_at", "desc")
      .orderBy("stock_movements.id", "desc")
      .limit(limit)
      .execute();
    return rows.map((row) => ({ ...row, product_public_id: product.public_id }));
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
          cargo_provider: null,
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

  async createOrderFromForm(input: CreateOrderFromFormInput): Promise<OrderRecord> {
    return this.db.transaction().execute(async (transaction) => {
      let customer: Pick<CustomerRecord, "id" | "public_id" | "full_name" | "phone"> | null = null;
      if (input.customerPublicId) {
        customer = await transaction
          .selectFrom("customers")
          .select(["id", "public_id", "full_name", "phone"])
          .where("public_id", "=", input.customerPublicId)
          .executeTakeFirst() ?? null;
      }
      if (!customer && input.customer) {
        const existing = await this.lookupCustomerByPhoneInDb(transaction as AppDatabase, input.customer.phone);
        if (existing.customer) {
          customer = existing.customer;
          await transaction
            .updateTable("customers")
            .set({
              full_name: input.customer.fullName,
              email: input.customer.email,
              username: input.customer.username,
              updated_at: new Date(),
            })
            .where("id", "=", existing.customer.id)
            .execute();
        } else {
          customer = await transaction
            .insertInto("customers")
            .values({
              public_id: newPublicId("cus"),
              full_name: input.customer.fullName,
              phone: input.customer.phone,
              email: input.customer.email,
              username: input.customer.username,
              notes: null,
            })
            .returning(["id", "public_id", "full_name", "phone"])
            .executeTakeFirstOrThrow();
        }
      }
      if (!customer) {
        throw new Error("Order customer could not be resolved");
      }

      await transaction
        .insertInto("customer_addresses")
        .values({
          public_id: newPublicId("adr"),
          customer_id: customer.id,
          label: "Teslimat",
          address_line: input.address.addressLine,
          district: input.address.district,
          city: input.address.city,
          country: input.address.country,
          postal_code: input.address.postalCode,
          is_default: true,
        })
        .execute();

      const conversation = input.conversationPublicId
        ? await transaction
            .selectFrom("conversations")
            .select("id")
            .where("public_id", "=", input.conversationPublicId)
            .executeTakeFirst()
        : null;
      const now = new Date();
      let orderNumber = orderNumberFromDate(now);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const existing = await transaction
          .selectFrom("orders")
          .select("id")
          .where("order_number", "=", orderNumber)
          .executeTakeFirst();
        if (!existing) break;
        orderNumber = orderNumberFromDate(new Date(now.getTime() + attempt + 1));
      }

      const order = await transaction
        .insertInto("orders")
        .values({
          public_id: newPublicId("ord"),
          customer_id: customer.id,
          conversation_id: conversation?.id ?? null,
          created_by_user_id: input.createdByUserId,
          order_number: orderNumber,
          status: input.status,
          source: input.source,
          cargo_provider: input.cargoProvider,
          total_amount: input.totalAmount,
          currency: input.currency,
          confirmation_status: null,
          notes: input.notes,
          external_order_id: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      for (const item of input.items) {
        const product = item.productPublicId
          ? await transaction
              .selectFrom("products")
              .select(["id", "external_product_id"])
              .where("public_id", "=", item.productPublicId)
              .executeTakeFirst()
          : null;
        await transaction
          .insertInto("order_items")
          .values({
            public_id: newPublicId("oit"),
            order_id: order.id,
            product_id: product?.id ?? null,
            name: item.name,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            total_amount: item.totalAmount,
            external_product_id: item.externalProductId ?? product?.external_product_id ?? null,
          })
          .execute();
        if (product) {
          // Legacy stok_dusur parity: atomic decrement clamped at zero (GREATEST(0, stock - qty)).
          const previous = await transaction
            .selectFrom("products")
            .select("stock_quantity")
            .where("id", "=", product.id)
            .forUpdate()
            .executeTakeFirstOrThrow();
          const updated = await transaction
            .updateTable("products")
            .set({
              stock_quantity: sql<number>`GREATEST(0, stock_quantity - ${item.quantity})`,
              updated_at: new Date(),
            })
            .where("id", "=", product.id)
            .returning("stock_quantity")
            .executeTakeFirstOrThrow();
          const previousQuantity = Number(previous.stock_quantity);
          const newQuantity = Number(updated.stock_quantity);
          const decremented = previousQuantity - newQuantity;
          if (decremented > 0) {
            await transaction
              .insertInto("stock_movements")
              .values({
                public_id: newPublicId("stm"),
                product_id: product.id,
                movement_type: "out",
                quantity: decremented,
                previous_quantity: previousQuantity,
                new_quantity: newQuantity,
                notes: `Sipariş ${orderNumber}`,
                created_by_user_id: input.createdByUserId,
              })
              .execute();
          }
        }
      }

      // Legacy siparis_kalem_komisyon_ekle trigger parity: incubator orders credit the creator once.
      await applyOrderBalanceRules(transaction as AppDatabase, {
        orderId: order.id,
        actorRole: null,
        actorUserId: input.createdByUserId,
      });

      return (await this.getOrderByPublicId(transaction as AppDatabase, order.public_id)) ?? {
        ...order,
        customer_full_name: customer.full_name,
        created_by_user_public_id: null,
        created_by_user_email: null,
        cargo_provider: input.cargoProvider,
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
    // Legacy siparis_durum_degisimi trigger parity: iptal/iade deducts, revert credits back.
    await applyOrderBalanceRules(this.db, {
      orderId: order.id,
      actorRole: input.actorRole ?? null,
      actorUserId: input.actorUserId ?? null,
    });
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

  private applyShipmentFilters<T>(query: T, filter: ListShipmentsFilter): T {
    const searchPattern = filter.search ? `%${filter.search}%` : null;
    type ShipmentFilterBuilder = {
      $if: (condition: boolean, callback: (builder: ShipmentFilterBuilder) => ShipmentFilterBuilder) => ShipmentFilterBuilder;
      where: (...args: unknown[]) => ShipmentFilterBuilder;
    };
    let next = query as ShipmentFilterBuilder;
    next = next
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
      .$if(Boolean(searchPattern), (builder) =>
        builder.where((expression: {
          or: (items: unknown[]) => unknown;
          (column: string, operator: string, value: string): unknown;
        }) =>
          expression.or([
            expression("shipments.tracking_number", "ilike", searchPattern as string),
            expression("shipments.barcode_number", "ilike", searchPattern as string),
            expression("shipments.recipient_name", "ilike", searchPattern as string),
            expression("shipments.recipient_phone", "ilike", searchPattern as string),
            expression("shipments.status", "ilike", searchPattern as string),
            expression("orders.order_number", "ilike", searchPattern as string),
            expression("customers.full_name", "ilike", searchPattern as string),
          ]),
        ),
      );

    return next as T;
  }

  async listShipmentsPage(filter: ListShipmentsFilter): Promise<ListShipmentsResult> {
    const offset = filter.offset ?? 0;
    const countQuery = this.applyShipmentFilters(
      this.db
        .selectFrom("shipments")
        .leftJoin("orders", "orders.id", "shipments.order_id")
        .leftJoin("customers", "customers.id", "shipments.customer_id")
        .select((expression) => [expression.fn.countAll<number>().as("total_count")]),
      filter,
    );
    const countRow = await countQuery.executeTakeFirst();
    const rows = await this.listShipments({ ...filter, offset });

    return {
      rows,
      total_count: Number(countRow?.total_count ?? rows.length),
      limit: filter.limit,
      offset,
    };
  }

  async listShipments(filter: ListShipmentsFilter): Promise<ShipmentRecord[]> {
    const offset = filter.offset ?? 0;
    const baseQuery = this.db
      .selectFrom("shipments")
      .leftJoin("orders", "orders.id", "shipments.order_id")
      .leftJoin("customers", "customers.id", "shipments.customer_id")
      .selectAll("shipments")
      .select(["orders.order_number as order_number", "customers.full_name as customer_full_name"]);
    const rows = await this.applyShipmentFilters(baseQuery, filter)
      .orderBy("shipments.created_at", "desc")
      .orderBy("shipments.id", "desc")
      .offset(offset)
      .limit(filter.limit)
      .execute();
    const events = await this.listShipmentTrackingEvents(rows.map((shipment) => shipment.id));
    const eventsByShipmentId = new Map<number, ShipmentTrackingEventRecord[]>();
    for (const event of events) {
      const current = eventsByShipmentId.get(event.shipment_id) ?? [];
      current.push(event);
      eventsByShipmentId.set(event.shipment_id, current);
    }
    return rows.map((shipment) => ({
      ...shipment,
      tracking_events: eventsByShipmentId.get(shipment.id) ?? [],
    }));
  }

  async getShipmentByPublicId(shipmentPublicId: string): Promise<ShipmentRecord | null> {
    const row = await this.db
      .selectFrom("shipments")
      .leftJoin("orders", "orders.id", "shipments.order_id")
      .leftJoin("customers", "customers.id", "shipments.customer_id")
      .selectAll("shipments")
      .select(["orders.order_number as order_number", "customers.full_name as customer_full_name"])
      .where("shipments.public_id", "=", shipmentPublicId)
      .executeTakeFirst();
    if (!row) return null;
    const tracking_events = await this.listShipmentTrackingEvents([row.id]);
    return { ...row, tracking_events };
  }

  private async listShipmentTrackingEvents(shipmentIds: number[]): Promise<ShipmentTrackingEventRecord[]> {
    if (shipmentIds.length === 0) return [];
    return this.db
      .selectFrom("shipment_tracking_events")
      .selectAll()
      .where("shipment_id", "in", shipmentIds)
      .orderBy("occurred_at", "desc")
      .orderBy("id", "desc")
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

    return await this.getShipmentByPublicId(shipment.public_id) ?? {
      ...shipment,
      order_number: null,
      customer_full_name: null,
      tracking_events: [],
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
    notes: conversation.notes,
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

export function serializeMessage(message: MessageRecord | MessageWithAttachmentsRecord) {
  return {
    public_id: message.public_id,
    sender_type: message.sender_type,
    sender_name: message.sender_name,
    body: message.body,
    external_message_id: message.external_message_id,
    is_read: message.is_read,
    sent_at: message.sent_at,
    attachments: "attachments" in message
      ? message.attachments.map(serializeMessageAttachment)
      : [],
  };
}

export function serializeMessageAttachment(attachment: MessageAttachmentRecord) {
  return {
    file_public_id: attachment.file_public_id,
    attachment_type: attachment.attachment_type,
    original_name: attachment.original_name,
    mime_type: attachment.mime_type,
    byte_size: attachment.byte_size === null ? null : Number(attachment.byte_size),
  };
}

export function serializeMessageShortcut(shortcut: MessageShortcutRecord | ShortcutTableRecord) {
  return {
    public_id: shortcut.public_id,
    code: shortcut.code,
    message: shortcut.message,
    type: shortcut.type,
    is_active: shortcut.is_active,
    sort_order: Number(shortcut.sort_order),
    attachments: "attachments" in shortcut
      ? shortcut.attachments.map((attachment) => ({
          file_public_id: attachment.file_public_id,
          attachment_type: attachment.attachment_type,
          original_name: attachment.original_name,
          mime_type: attachment.mime_type,
          byte_size: attachment.byte_size === null ? null : Number(attachment.byte_size),
        }))
      : [],
    updated_at: shortcut.updated_at,
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
    unit: product.unit,
    description: product.description,
    updated_at: product.updated_at,
  };
}

export function serializeStockMovement(movement: StockMovementRecord) {
  return {
    public_id: movement.public_id,
    product_public_id: movement.product_public_id,
    movement_type: movement.movement_type,
    quantity: movement.quantity,
    previous_quantity: movement.previous_quantity,
    new_quantity: movement.new_quantity,
    notes: movement.notes,
    created_by_user_email: movement.created_by_user_email,
    created_at: movement.created_at,
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
    tracking_events: (shipment.tracking_events ?? []).map((event) => ({
      public_id: event.public_id,
      status: event.status,
      description: event.description,
      location: event.location,
      occurred_at: event.occurred_at,
    })),
    updated_at: shipment.updated_at,
  };
}
