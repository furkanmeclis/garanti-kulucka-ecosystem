import { sql, type AppDatabase } from "@garanti-kulucka/database";
import { newPublicId } from "../auth/crypto.js";
import {
  DEFAULT_COMMISSION_AMOUNT_CENTS,
  centsToDecimalString,
  centsToMoney,
  checkPaymentRequestAmount,
  moneyToCents,
  planOrderBalanceMovements,
  type BalanceMovementKind,
  type PaymentRequestStatus,
} from "./rules.js";

export const commissionSettingKey = "balance.commission_amount";

export class BalancePaymentRequestError extends Error {
  constructor(
    readonly code: "invalid_amount" | "insufficient_balance" | "not_found" | "already_processed" | "zero_balance" | "idempotency_conflict",
    message: string,
  ) {
    super(message);
    this.name = "BalancePaymentRequestError";
  }
}

export interface BalanceSummaryResult {
  scope: "all" | "own";
  balance: number;
  total_commission: number;
  total_deduction: number;
  total_payment: number;
  pending_payment: number;
  available_balance: number;
  pending_request_count: number;
}

export interface StaffBalanceResult {
  user_public_id: string;
  first_name: string;
  last_name: string;
  is_online: boolean;
  balance: number;
  pending_payment: number;
  pending_request_count: number;
}

export interface BalanceMovementResult {
  public_id: string;
  kind: string;
  amount: number;
  balance_after: number;
  description: string | null;
  user_public_id: string | null;
  user_full_name: string | null;
  order_public_id: string | null;
  order_number: string | null;
  customer_full_name: string | null;
  created_at: string;
}

export interface PaymentRequestResult {
  public_id: string;
  amount: number;
  status: string;
  user_public_id: string | null;
  user_full_name: string | null;
  processed_by_user_public_id: string | null;
  processed_at: string | null;
  note: string | null;
  created_at: string;
}

export interface StaffOrderResult {
  public_id: string;
  order_number: string;
  customer_full_name: string | null;
  customer_phone: string | null;
  status: string;
  total_amount: number;
  currency: string;
  created_at: string;
}

type Executor = AppDatabase;

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function fullName(first: string | null | undefined, last: string | null | undefined) {
  const name = `${first ?? ""} ${last ?? ""}`.trim();
  return name.length > 0 ? name : null;
}

async function lockUser(db: Executor, userId: number) {
  await sql`select pg_advisory_xact_lock(${7_301_000_000 + userId})`.execute(db);
}

async function userBalanceCents(db: Executor, userId: number) {
  const row = await db
    .selectFrom("balance_movements")
    .select(sql<string>`coalesce(sum(amount), 0)`.as("total"))
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return moneyToCents(row?.total ?? 0);
}

async function pendingRequestCents(db: Executor, userId: number) {
  const row = await db
    .selectFrom("payment_requests")
    .select(sql<string>`coalesce(sum(amount), 0)`.as("total"))
    .where("user_id", "=", userId)
    .where("status", "=", "pending")
    .executeTakeFirst();
  return moneyToCents(row?.total ?? 0);
}

async function readCommissionAmountCents(db: Executor) {
  const setting = await db
    .selectFrom("settings")
    .select(["value"])
    .where("key", "=", commissionSettingKey)
    .where("scope", "=", "global")
    .executeTakeFirst();
  const value = setting?.value as unknown;
  const raw = typeof value === "number" || typeof value === "string"
    ? value
    : value && typeof value === "object" && "amount" in value
      ? (value as { amount: unknown }).amount
      : null;
  const cents = raw === null || raw === undefined ? NaN : moneyToCents(raw as string | number);
  return Number.isFinite(cents) && cents >= 0 ? cents : DEFAULT_COMMISSION_AMOUNT_CENTS;
}

/**
 * Applies legacy commission/deduction/rollback rules for one order. Safe to call repeatedly:
 * the planner is state-based and every appended row carries a unique idempotency key.
 */
export async function applyOrderBalanceRules(
  db: Executor,
  input: { orderId: number; actorRole: string | null | undefined; actorUserId: number | null },
) {
  const order = await db
    .selectFrom("orders")
    .select(["id", "public_id", "order_number", "status", "created_by_user_id"])
    .where("id", "=", input.orderId)
    .executeTakeFirst();
  if (!order || order.created_by_user_id === null || order.created_by_user_id === undefined) return [];

  const items = await db.selectFrom("order_items").select(["name"]).where("order_id", "=", order.id).execute();
  if (items.length === 0) return [];

  const existing = await db
    .selectFrom("balance_movements")
    .select(["kind", "amount"])
    .where("order_id", "=", order.id)
    .execute();

  const plan = planOrderBalanceMovements({
    orderPublicId: order.public_id,
    orderNumber: order.order_number,
    status: order.status,
    creatorUserId: order.created_by_user_id,
    itemNames: items.map((item) => item.name),
    existingMovements: existing.map((row) => ({ kind: row.kind as BalanceMovementKind, amount_cents: moneyToCents(row.amount) })),
    commissionAmountCents: existing.some((row) => row.kind === "commission") ? 0 : await readCommissionAmountCents(db),
    actorRole: input.actorRole,
  });
  if (plan.length === 0) return [];

  await lockUser(db, order.created_by_user_id);
  let balance = await userBalanceCents(db, order.created_by_user_id);
  const inserted = [];
  for (const movement of plan) {
    const row = await db
      .insertInto("balance_movements")
      .values({
        public_id: newPublicId("bmv"),
        user_id: order.created_by_user_id,
        order_id: order.id,
        payment_request_id: null,
        kind: movement.kind,
        amount: centsToDecimalString(movement.amount_cents),
        balance_after: centsToDecimalString(balance + movement.amount_cents),
        description: movement.description,
        idempotency_key: movement.idempotency_key,
        actor_user_id: input.actorUserId,
      })
      .onConflict((oc) => oc.doNothing())
      .returning(["public_id", "kind"])
      .executeTakeFirst();
    if (row) {
      balance += movement.amount_cents;
      inserted.push(row);
    }
  }
  return inserted;
}

export class BalanceRepository {
  constructor(private readonly db: AppDatabase) {}

  async findUserIdByPublicId(publicId: string) {
    const row = await this.db
      .selectFrom("users")
      .select(["id", "first_name", "last_name"])
      .where("public_id", "=", publicId)
      .executeTakeFirst();
    return row ?? null;
  }

  async getSummary(scopeUserId: number | null): Promise<BalanceSummaryResult> {
    const totals = await this.db
      .selectFrom("balance_movements")
      .select([
        sql<string>`coalesce(sum(amount), 0)`.as("balance"),
        sql<string>`coalesce(sum(case when kind in ('commission', 'rollback', 'adjustment') then amount else 0 end), 0)`.as("commission"),
        sql<string>`coalesce(sum(case when kind in ('cancellation', 'return') then abs(amount) else 0 end), 0)`.as("deduction"),
        sql<string>`coalesce(sum(case when kind = 'payment' then abs(amount) else 0 end), 0)`.as("payment"),
      ])
      .$if(scopeUserId !== null, (builder) => builder.where("user_id", "=", scopeUserId as number))
      .executeTakeFirst();
    const pending = await this.db
      .selectFrom("payment_requests")
      .select([sql<string>`coalesce(sum(amount), 0)`.as("amount"), sql<string>`count(*)`.as("count")])
      .where("status", "=", "pending")
      .$if(scopeUserId !== null, (builder) => builder.where("user_id", "=", scopeUserId as number))
      .executeTakeFirst();

    const balanceCents = moneyToCents(totals?.balance ?? 0);
    const pendingCents = moneyToCents(pending?.amount ?? 0);
    return {
      scope: scopeUserId === null ? "all" : "own",
      balance: centsToMoney(balanceCents),
      total_commission: centsToMoney(moneyToCents(totals?.commission ?? 0)),
      total_deduction: centsToMoney(moneyToCents(totals?.deduction ?? 0)),
      total_payment: centsToMoney(moneyToCents(totals?.payment ?? 0)),
      pending_payment: centsToMoney(pendingCents),
      available_balance: centsToMoney(Math.max(balanceCents - pendingCents, 0)),
      pending_request_count: Number(pending?.count ?? 0),
    };
  }

  /** Legacy `tum_personel_bakiyeleri`: every active non-admin staff member with balance and pending requests. */
  async listStaffBalances(): Promise<StaffBalanceResult[]> {
    const rows = await this.db
      .selectFrom("users")
      .innerJoin("roles", "roles.id", "users.role_id")
      .select([
        "users.id",
        "users.public_id",
        "users.first_name",
        "users.last_name",
        "users.is_online",
        sql<string>`coalesce((select sum(bm.amount) from balance_movements bm where bm.user_id = users.id), 0)`.as("balance"),
        sql<string>`coalesce((select sum(pr.amount) from payment_requests pr where pr.user_id = users.id and pr.status = 'pending'), 0)`.as("pending"),
        sql<string>`(select count(*) from payment_requests pr where pr.user_id = users.id and pr.status = 'pending')`.as("pending_count"),
      ])
      .where("roles.name", "=", "calisan")
      .where("users.is_active", "=", true)
      .orderBy("users.first_name", "asc")
      .orderBy("users.last_name", "asc")
      .execute();
    return rows.map((row) => ({
      user_public_id: row.public_id,
      first_name: row.first_name,
      last_name: row.last_name,
      is_online: row.is_online,
      balance: centsToMoney(moneyToCents(row.balance)),
      pending_payment: centsToMoney(moneyToCents(row.pending)),
      pending_request_count: Number(row.pending_count ?? 0),
    }));
  }

  async listMovements(filter: { userId: number | null; limit: number; offset: number }) {
    const base = this.db
      .selectFrom("balance_movements")
      .leftJoin("users", "users.id", "balance_movements.user_id")
      .leftJoin("orders", "orders.id", "balance_movements.order_id")
      .leftJoin("customers", "customers.id", "orders.customer_id")
      .$if(filter.userId !== null, (builder) => builder.where("balance_movements.user_id", "=", filter.userId as number));
    const [rows, count] = await Promise.all([
      base
        .select([
          "balance_movements.public_id",
          "balance_movements.kind",
          "balance_movements.amount",
          "balance_movements.balance_after",
          "balance_movements.description",
          "balance_movements.created_at",
          "users.public_id as user_public_id",
          "users.first_name",
          "users.last_name",
          "orders.public_id as order_public_id",
          "orders.order_number",
          "customers.full_name as customer_full_name",
        ])
        .orderBy("balance_movements.created_at", "desc")
        .orderBy("balance_movements.id", "desc")
        .limit(filter.limit)
        .offset(filter.offset)
        .execute(),
      base.select(sql<string>`count(*)`.as("total")).executeTakeFirst(),
    ]);
    return {
      data: rows.map((row): BalanceMovementResult => ({
        public_id: row.public_id,
        kind: row.kind,
        amount: centsToMoney(moneyToCents(row.amount)),
        balance_after: centsToMoney(moneyToCents(row.balance_after)),
        description: row.description,
        user_public_id: row.user_public_id ?? null,
        user_full_name: fullName(row.first_name, row.last_name),
        order_public_id: row.order_public_id ?? null,
        order_number: row.order_number ?? null,
        customer_full_name: row.customer_full_name ?? null,
        created_at: iso(row.created_at) ?? "",
      })),
      total: Number(count?.total ?? 0),
    };
  }

  async listPaymentRequests(filter: { userId: number | null; status?: PaymentRequestStatus; limit: number; offset: number }) {
    const base = this.db
      .selectFrom("payment_requests")
      .leftJoin("users", "users.id", "payment_requests.user_id")
      .leftJoin("users as processors", "processors.id", "payment_requests.processed_by_user_id")
      .$if(filter.userId !== null, (builder) => builder.where("payment_requests.user_id", "=", filter.userId as number))
      .$if(filter.status !== undefined, (builder) => builder.where("payment_requests.status", "=", filter.status as string));
    const [rows, count] = await Promise.all([
      base
        .select([
          "payment_requests.public_id",
          "payment_requests.amount",
          "payment_requests.status",
          "payment_requests.processed_at",
          "payment_requests.note",
          "payment_requests.created_at",
          "users.public_id as user_public_id",
          "users.first_name",
          "users.last_name",
          "processors.public_id as processed_by_user_public_id",
        ])
        .orderBy("payment_requests.created_at", "desc")
        .orderBy("payment_requests.id", "desc")
        .limit(filter.limit)
        .offset(filter.offset)
        .execute(),
      base.select(sql<string>`count(*)`.as("total")).executeTakeFirst(),
    ]);
    return { data: rows.map(serializePaymentRequestRow), total: Number(count?.total ?? 0) };
  }

  /** Legacy `odeme_istegi_olustur`: self-service, locked per user, amount ≤ balance − pending. */
  async createPaymentRequest(input: { userId: number; amountCents: number; idempotencyKey: string }) {
    return this.db.transaction().execute(async (transaction) => {
      const trx = transaction as AppDatabase;
      const existing = await findPaymentRequestByKey(trx, input.idempotencyKey);
      if (existing) {
        if (existing.user_id !== input.userId || moneyToCents(existing.amount) !== input.amountCents) {
          throw new BalancePaymentRequestError("idempotency_conflict", "Ödeme isteği anahtarı farklı içerikle tekrar kullanıldı");
        }
        return { request: await this.getPaymentRequest(trx, existing.public_id), replayed: true };
      }
      await lockUser(trx, input.userId);
      const [balanceCents, pendingCents] = await Promise.all([userBalanceCents(trx, input.userId), pendingRequestCents(trx, input.userId)]);
      const check = checkPaymentRequestAmount({ amountCents: input.amountCents, balanceCents, pendingCents });
      if (!check.ok) throw new BalancePaymentRequestError(check.code, check.message);
      const created = await trx
        .insertInto("payment_requests")
        .values({
          public_id: newPublicId("pay"),
          user_id: input.userId,
          amount: centsToDecimalString(input.amountCents),
          status: "pending",
          processed_by_user_id: null,
          processed_at: null,
          note: null,
          idempotency_key: input.idempotencyKey,
        })
        .returning(["public_id"])
        .executeTakeFirstOrThrow();
      return { request: await this.getPaymentRequest(trx, created.public_id), replayed: false };
    });
  }

  /** Legacy `odeme_istegi_isle`: only pending requests; approval appends a payment movement. */
  async processPaymentRequest(input: { publicId: string; decision: "approved" | "rejected"; adminUserId: number | null; note: string | null }) {
    return this.db.transaction().execute(async (transaction) => {
      const trx = transaction as AppDatabase;
      const request = await trx
        .selectFrom("payment_requests")
        .selectAll()
        .where("public_id", "=", input.publicId)
        .forUpdate()
        .executeTakeFirst();
      if (!request) throw new BalancePaymentRequestError("not_found", "İstek bulunamadı");
      if (request.status !== "pending") {
        throw new BalancePaymentRequestError("already_processed", "Bu istek zaten işlenmiş");
      }
      await lockUser(trx, request.user_id);
      await trx
        .updateTable("payment_requests")
        .set({
          status: input.decision,
          processed_by_user_id: input.adminUserId,
          processed_at: new Date(),
          note: input.note,
          updated_at: new Date(),
        })
        .where("id", "=", request.id)
        .execute();
      if (input.decision === "approved") {
        const balanceCents = await userBalanceCents(trx, request.user_id);
        const amountCents = moneyToCents(request.amount);
        await trx
          .insertInto("balance_movements")
          .values({
            public_id: newPublicId("bmv"),
            user_id: request.user_id,
            order_id: null,
            payment_request_id: request.id,
            kind: "payment",
            amount: centsToDecimalString(-amountCents),
            balance_after: centsToDecimalString(balanceCents - amountCents),
            description: `Ödeme isteği onaylandı (#${request.public_id.slice(0, 12)})`,
            idempotency_key: `payment_request:${request.public_id}:payment`,
            actor_user_id: input.adminUserId,
          })
          .execute();
      }
      return {
        request: await this.getPaymentRequest(trx, request.public_id),
        message: input.decision === "approved" ? "Ödeme yapıldı" : "İstek reddedildi",
      };
    });
  }

  /** Legacy `bakiye_sifirla`: append a payment movement for the full current balance. */
  async resetBalance(input: { userPublicId: string; adminUserId: number | null; adminName: string }) {
    return this.db.transaction().execute(async (transaction) => {
      const trx = transaction as AppDatabase;
      const user = await trx.selectFrom("users").select(["id"]).where("public_id", "=", input.userPublicId).executeTakeFirst();
      if (!user) throw new BalancePaymentRequestError("not_found", "Personel bulunamadı");
      await lockUser(trx, user.id);
      const balanceCents = await userBalanceCents(trx, user.id);
      if (balanceCents === 0) throw new BalancePaymentRequestError("zero_balance", "Bakiye zaten sıfır");
      const sequence = await trx
        .selectFrom("balance_movements")
        .select(sql<string>`count(*)`.as("total"))
        .where("user_id", "=", user.id)
        .executeTakeFirst();
      await trx
        .insertInto("balance_movements")
        .values({
          public_id: newPublicId("bmv"),
          user_id: user.id,
          order_id: null,
          payment_request_id: null,
          kind: "payment",
          amount: centsToDecimalString(-balanceCents),
          balance_after: "0.00",
          description: `Bakiye sıfırlandı (Admin: ${input.adminName})`,
          idempotency_key: `user:${input.userPublicId}:reset:${Number(sequence?.total ?? 0) + 1}`,
          actor_user_id: input.adminUserId,
        })
        .execute();
      return { previous_balance: centsToMoney(balanceCents), message: "Bakiye sıfırlandı" };
    });
  }

  async listStaffOrders(userId: number, limit: number): Promise<StaffOrderResult[]> {
    const rows = await this.db
      .selectFrom("orders")
      .leftJoin("customers", "customers.id", "orders.customer_id")
      .select([
        "orders.public_id",
        "orders.order_number",
        "orders.status",
        "orders.total_amount",
        "orders.currency",
        "orders.created_at",
        "customers.full_name as customer_full_name",
        "customers.phone as customer_phone",
      ])
      .where("orders.created_by_user_id", "=", userId)
      .orderBy("orders.created_at", "desc")
      .limit(limit)
      .execute();
    return rows.map((row) => ({
      public_id: row.public_id,
      order_number: row.order_number,
      customer_full_name: row.customer_full_name ?? null,
      customer_phone: row.customer_phone ?? null,
      status: row.status,
      total_amount: centsToMoney(moneyToCents(row.total_amount)),
      currency: row.currency,
      created_at: iso(row.created_at) ?? "",
    }));
  }

  private async getPaymentRequest(db: AppDatabase, publicId: string) {
    const row = await db
      .selectFrom("payment_requests")
      .leftJoin("users", "users.id", "payment_requests.user_id")
      .leftJoin("users as processors", "processors.id", "payment_requests.processed_by_user_id")
      .select([
        "payment_requests.public_id",
        "payment_requests.amount",
        "payment_requests.status",
        "payment_requests.processed_at",
        "payment_requests.note",
        "payment_requests.created_at",
        "users.public_id as user_public_id",
        "users.first_name",
        "users.last_name",
        "processors.public_id as processed_by_user_public_id",
      ])
      .where("payment_requests.public_id", "=", publicId)
      .executeTakeFirstOrThrow();
    return serializePaymentRequestRow(row);
  }
}

async function findPaymentRequestByKey(db: AppDatabase, key: string) {
  return db
    .selectFrom("payment_requests")
    .select(["public_id", "user_id", "amount"])
    .where("idempotency_key", "=", key)
    .executeTakeFirst();
}

function serializePaymentRequestRow(row: {
  public_id: string;
  amount: string;
  status: string;
  processed_at: Date | string | null;
  note: string | null;
  created_at: Date | string;
  user_public_id: string | null;
  first_name: string | null;
  last_name: string | null;
  processed_by_user_public_id: string | null;
}): PaymentRequestResult {
  return {
    public_id: row.public_id,
    amount: centsToMoney(moneyToCents(row.amount)),
    status: row.status,
    user_public_id: row.user_public_id ?? null,
    user_full_name: fullName(row.first_name, row.last_name),
    processed_by_user_public_id: row.processed_by_user_public_id ?? null,
    processed_at: iso(row.processed_at),
    note: row.note,
    created_at: iso(row.created_at) ?? "",
  };
}
