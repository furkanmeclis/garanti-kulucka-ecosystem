import type { AppDatabase, Database } from "@garanti-kulucka/database";
import type { Selectable } from "kysely";
import { newPublicId } from "../auth/crypto.js";
import { applyOrderDeleteBalanceRules } from "../balances/repository.js";
import type { KolaybiWorkflowOrder } from "./kolaybi-workflow.js";

export type OrderProviderStepRecord = Selectable<Database["order_provider_steps"]>;
export type OrderProviderAction =
  | "kolaybi_transfer"
  | "e_document_create"
  | "e_document_cancel"
  | "invoice_get"
  | "confirmation_call"
  | "confirmation_status";

export interface OrderActionState {
  id: number;
  public_id: string;
  order_number: string;
  status: string;
  notes: string | null;
  total_amount: string;
  currency: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  confirmation_status: string | null;
  kolaybi_contact_id: string | null;
  kolaybi_address_id: string | null;
  kolaybi_invoice_id: string | null;
  kolaybi_status: string | null;
  kolaybi_error: string | null;
  e_document_status: string | null;
  confirmation_call_status: string | null;
  confirmation_call_bulk_id: string | null;
  confirmation_pressed_key: string | null;
  confirmation_listen_seconds: number | null;
  confirmation_call_count: number;
  customer_full_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_id: number | null;
}

export type OrderProviderStateUpdate = Partial<
  Pick<
    OrderActionState,
    | "kolaybi_contact_id"
    | "kolaybi_address_id"
    | "kolaybi_invoice_id"
    | "kolaybi_status"
    | "kolaybi_error"
    | "e_document_status"
    | "confirmation_status"
    | "confirmation_call_status"
    | "confirmation_call_bulk_id"
    | "confirmation_pressed_key"
    | "confirmation_listen_seconds"
    | "confirmation_call_count"
    | "status"
  >
>;

export interface InsertOrderProviderStepInput {
  orderId: number;
  action: OrderProviderAction;
  provider: "kolaybi" | "netgsm";
  operation: string;
  attempt: number;
  idempotencyKey: string;
  requestId: string;
  jobId: string | null;
  queued: boolean;
  requestPayload: Record<string, unknown>;
  actorUserId: number | null;
}

export interface ProviderAttemptOutcome {
  status: string;
  response_metadata: unknown;
  error_message: string | null;
}

export class OrderActionNotFoundError extends Error {
  constructor() {
    super("Sipariş bulunamadı");
    this.name = "OrderActionNotFoundError";
  }
}

export class OrderActionRepository {
  constructor(private readonly db: AppDatabase) {}

  async getOrderState(orderPublicId: string, options: { includeDeleted?: boolean } = {}): Promise<OrderActionState | null> {
    const row = await this.db
      .selectFrom("orders")
      .leftJoin("customers", "customers.id", "orders.customer_id")
      .select([
        "orders.id",
        "orders.public_id",
        "orders.order_number",
        "orders.status",
        "orders.notes",
        "orders.total_amount",
        "orders.currency",
        "orders.created_at",
        "orders.updated_at",
        "orders.deleted_at",
        "orders.confirmation_status",
        "orders.kolaybi_contact_id",
        "orders.kolaybi_address_id",
        "orders.kolaybi_invoice_id",
        "orders.kolaybi_status",
        "orders.kolaybi_error",
        "orders.e_document_status",
        "orders.confirmation_call_status",
        "orders.confirmation_call_bulk_id",
        "orders.confirmation_pressed_key",
        "orders.confirmation_listen_seconds",
        "orders.confirmation_call_count",
        "orders.customer_id",
        "customers.full_name as customer_full_name",
        "customers.phone as customer_phone",
        "customers.email as customer_email",
      ])
      .where("orders.public_id", "=", orderPublicId)
      .$if(!options.includeDeleted, (builder) => builder.where("orders.deleted_at", "is", null))
      .executeTakeFirst();
    return (row as OrderActionState | undefined) ?? null;
  }

  async getWorkflowOrder(order: OrderActionState): Promise<KolaybiWorkflowOrder> {
    const [address, items] = await Promise.all([
      order.customer_id
        ? this.db
            .selectFrom("customer_addresses")
            .select(["address_line", "city", "district", "country"])
            .where("customer_id", "=", order.customer_id)
            .orderBy("is_default", "desc")
            .orderBy("created_at", "desc")
            .executeTakeFirst()
        : Promise.resolve(undefined),
      this.db
        .selectFrom("order_items")
        .leftJoin("products", "products.id", "order_items.product_id")
        .select(["order_items.name", "order_items.quantity", "order_items.unit_price", "order_items.external_product_id", "products.external_product_id as product_external_id"])
        .where("order_items.order_id", "=", order.id)
        .orderBy("order_items.id", "asc")
        .execute(),
    ]);
    return {
      orderPublicId: order.public_id,
      orderNumber: order.order_number,
      createdAt: new Date(order.created_at).toISOString(),
      customer: { fullName: order.customer_full_name ?? "", phone: order.customer_phone ?? "", email: order.customer_email },
      address: address
        ? { addressLine: address.address_line, city: address.city ?? "", district: address.district ?? "", country: address.country }
        : null,
      items: items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        externalProductId: item.external_product_id ?? item.product_external_id ?? null,
      })),
    };
  }

  async hasIncubatorItem(orderId: number): Promise<boolean> {
    const items = await this.db.selectFrom("order_items").select(["name"]).where("order_id", "=", orderId).execute();
    return items.some((item) => /kuluçka|kulucka/i.test(item.name));
  }

  async listSteps(orderId: number, limit = 50): Promise<OrderProviderStepRecord[]> {
    return this.db
      .selectFrom("order_provider_steps")
      .selectAll()
      .where("order_id", "=", orderId)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(limit)
      .execute();
  }

  async listQueuedSteps(orderId: number): Promise<OrderProviderStepRecord[]> {
    return this.db
      .selectFrom("order_provider_steps")
      .selectAll()
      .where("order_id", "=", orderId)
      .where("status", "=", "queued")
      .orderBy("id", "asc")
      .execute();
  }

  async findStepByIdempotencyKey(key: string): Promise<OrderProviderStepRecord | null> {
    return (await this.db.selectFrom("order_provider_steps").selectAll().where("idempotency_key", "=", key).executeTakeFirst()) ?? null;
  }

  async insertStep(input: InsertOrderProviderStepInput): Promise<OrderProviderStepRecord> {
    const inserted = await this.db
      .insertInto("order_provider_steps")
      .values({
        public_id: newPublicId("ops"),
        order_id: input.orderId,
        action: input.action,
        provider: input.provider,
        operation: input.operation,
        attempt: input.attempt,
        status: "queued",
        idempotency_key: input.idempotencyKey,
        request_id: input.requestId,
        job_id: input.jobId,
        queued: input.queued,
        request_payload: JSON.stringify(input.requestPayload),
        result: null,
        error_message: null,
        actor_user_id: input.actorUserId,
      })
      .onConflict((oc) => oc.column("idempotency_key").doNothing())
      .returningAll()
      .executeTakeFirst();
    if (inserted) return inserted;
    return this.db.selectFrom("order_provider_steps").selectAll().where("idempotency_key", "=", input.idempotencyKey).executeTakeFirstOrThrow();
  }

  async completeStep(stepId: number, input: { status: "succeeded" | "failed"; result: Record<string, unknown> | null; errorMessage: string | null }) {
    await this.db
      .updateTable("order_provider_steps")
      .set({
        status: input.status,
        result: input.result === null ? null : JSON.stringify(input.result),
        error_message: input.errorMessage,
        updated_at: new Date(),
      })
      .where("id", "=", stepId)
      .where("status", "=", "queued")
      .execute();
  }

  async updateOrderProviderState(orderId: number, update: OrderProviderStateUpdate) {
    if (Object.keys(update).length === 0) return;
    await this.db
      .updateTable("orders")
      .set({ ...update, updated_at: new Date() })
      .where("id", "=", orderId)
      .execute();
  }

  async updateNotes(orderId: number, notes: string | null) {
    await this.db.updateTable("orders").set({ notes, updated_at: new Date() }).where("id", "=", orderId).execute();
  }

  /** Worker-written provider attempt for the step's request id (latest first). */
  async latestAttempt(requestId: string): Promise<ProviderAttemptOutcome | null> {
    const row = await this.db
      .selectFrom("provider_attempts")
      .select(["status", "response_metadata", "error_message"])
      .where("request_id", "=", requestId)
      .orderBy("started_at", "desc")
      .orderBy("id", "desc")
      .executeTakeFirst();
    return row ?? null;
  }

  /** Soft delete (legacy `siparis_sil`, 073): order row and ledger stay, balance effect follows the actor role. */
  async softDeleteOrder(input: { orderId: number; actorRole: string | null; actorUserId: number | null }) {
    return this.db.transaction().execute(async (transaction) => {
      const updated = await transaction
        .updateTable("orders")
        .set({ deleted_at: new Date(), deleted_by_user_id: input.actorUserId, updated_at: new Date() })
        .where("id", "=", input.orderId)
        .where("deleted_at", "is", null)
        .returning(["id"])
        .executeTakeFirst();
      if (!updated) return { deleted: false, commissionPreserved: true };
      const movement = await applyOrderDeleteBalanceRules(transaction as AppDatabase, input);
      return { deleted: true, commissionPreserved: movement === null };
    });
  }
}

function isoOrNull(value: Date | string | null) {
  return value === null ? null : new Date(value).toISOString();
}

export function serializeOrderActionState(order: OrderActionState) {
  return {
    public_id: order.public_id,
    order_number: order.order_number,
    status: order.status,
    notes: order.notes,
    total_amount: order.total_amount,
    currency: order.currency,
    customer_full_name: order.customer_full_name,
    customer_phone: order.customer_phone,
    deleted_at: isoOrNull(order.deleted_at),
    confirmation_status: order.confirmation_status,
    kolaybi: {
      contact_id: order.kolaybi_contact_id,
      address_id: order.kolaybi_address_id,
      invoice_id: order.kolaybi_invoice_id,
      status: order.kolaybi_status,
      error: order.kolaybi_error,
      e_document_status: order.e_document_status,
    },
    confirmation_call: {
      status: order.confirmation_call_status,
      bulk_id: order.confirmation_call_bulk_id,
      pressed_key: order.confirmation_pressed_key,
      listen_seconds: order.confirmation_listen_seconds,
      call_count: order.confirmation_call_count,
    },
    created_at: new Date(order.created_at).toISOString(),
    updated_at: new Date(order.updated_at).toISOString(),
  };
}

export function serializeOrderProviderStep(step: OrderProviderStepRecord) {
  return {
    public_id: step.public_id,
    action: step.action,
    provider: step.provider,
    operation: step.operation,
    attempt: step.attempt,
    status: step.status,
    request_id: step.request_id,
    job_id: step.job_id,
    queued: step.queued,
    error_message: step.error_message,
    created_at: new Date(step.created_at).toISOString(),
    updated_at: new Date(step.updated_at).toISOString(),
  };
}
