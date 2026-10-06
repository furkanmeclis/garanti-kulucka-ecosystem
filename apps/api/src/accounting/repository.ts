import { sql, type AppDatabase, type Selectable } from "@garanti-kulucka/database";
import type {
  AccountingContactsTable,
  InvoiceItemsTable,
  InvoicePaymentsTable,
  InvoicesTable,
} from "@garanti-kulucka/database";
import { newPublicId } from "../auth/crypto.js";
import type { InvoiceIssuer } from "./documents.js";
import {
  fromKurus,
  invoiceNumberFor,
  invoiceTotals,
  lineAmounts,
  openAmount,
  sqlDate,
  statusForPaidTotal,
  toKurus,
  type PaymentMethod,
  type SyncStatus,
} from "./rules.js";

export type AccountingContactRecord = Selectable<AccountingContactsTable>;
export type InvoiceRecord = Selectable<InvoicesTable> & { contact_public_id: string; contact_name: string; order_public_id: string | null; order_number: string | null };
export type InvoiceItemRecord = Selectable<InvoiceItemsTable> & { product_public_id: string | null };
export type InvoicePaymentRecord = Selectable<InvoicePaymentsTable>;

export interface ContactWithBalance extends AccountingContactRecord {
  invoice_count: number;
  open_balance: string;
}

export interface InvoiceDetailRecord {
  invoice: InvoiceRecord;
  contact: AccountingContactRecord;
  items: InvoiceItemRecord[];
  payments: InvoicePaymentRecord[];
}

export class AccountingError extends Error {
  constructor(
    readonly code: "not_found" | "contact_not_found" | "order_not_found" | "product_not_found" | "invoice_cancelled" | "overpayment" | "has_payments" | "idempotency_conflict",
    message: string,
  ) {
    super(message);
    this.name = "AccountingError";
  }
}

export interface ContactInput {
  contactType?: "individual" | "corporate" | undefined;
  name?: string | undefined;
  taxNumber?: string | null | undefined;
  taxOffice?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  addressLine?: string | null | undefined;
  district?: string | null | undefined;
  city?: string | null | undefined;
  country?: string | undefined;
  notes?: string | null | undefined;
  customerPublicId?: string | null | undefined;
}

export interface ListContactsFilter {
  search?: string | undefined;
  syncStatus?: SyncStatus | undefined;
  limit: number;
  offset: number;
}

export interface ListInvoicesFilter {
  search?: string | undefined;
  status?: string | undefined;
  contactPublicId?: string | undefined;
  syncStatus?: SyncStatus | undefined;
  issuedFrom?: string | undefined;
  issuedTo?: string | undefined;
  limit: number;
  offset: number;
}

export interface CreateInvoiceInput {
  idempotencyKey: string;
  contactPublicId: string;
  orderPublicId?: string | null | undefined;
  invoiceType?: "sale" | "sale_return" | undefined;
  issueDate: string;
  dueDate?: string | null | undefined;
  currency?: string | undefined;
  description?: string | null | undefined;
  items: Array<{ description: string; quantity: number; unit?: string | undefined; unitPrice: string; vatRate: number; productPublicId?: string | null | undefined }>;
  actorUserId: number | null;
}

export interface CreatePaymentInput {
  invoicePublicId: string;
  idempotencyKey: string;
  amount: string;
  method: PaymentMethod;
  paidAt?: string | undefined;
  vaultId?: string | null | undefined;
  notes?: string | null | undefined;
  actorUserId: number | null;
}

export type SyncTarget = "contact" | "invoice" | "payment";

export interface ProviderAttemptOutcome {
  status: string;
  response_metadata: unknown;
  error_message: string | null;
}

export interface KolaybiReadiness {
  account: { public_id: string; display_name: string; status: string } | null;
  provider_live_mode: boolean;
  account_live_mode: boolean | null;
  live_call_permitted: boolean;
  live_gate: string;
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true" ? true : value.toLowerCase() === "false" ? false : null;
  return null;
}

const contactColumns = {
  contactType: "contact_type",
  name: "name",
  taxNumber: "tax_number",
  taxOffice: "tax_office",
  phone: "phone",
  email: "email",
  addressLine: "address_line",
  district: "district",
  city: "city",
  country: "country",
  notes: "notes",
} as const satisfies Record<Exclude<keyof ContactInput, "customerPublicId">, keyof AccountingContactRecord>;

function searchPattern(search: string | undefined) {
  const trimmed = search?.trim();
  return trimmed ? `%${trimmed.replace(/[\\%_]/g, (match) => `\\${match}`)}%` : null;
}

export class AccountingRepository {
  constructor(private readonly db: AppDatabase) {}

  // ─── Cari hesaplar ──────────────────────────────────────────────────────────

  private contactBalanceQuery(db: AppDatabase = this.db) {
    return db
      .selectFrom("accounting_contacts")
      .leftJoin(
        (eb) =>
          eb
            .selectFrom("invoices")
            .select((inner) => [
              "contact_id",
              inner.fn.countAll<number>().as("invoice_count"),
              sql<string>`coalesce(sum(case when invoices.status <> 'cancelled' then invoices.grand_total - invoices.paid_total else 0 end), 0)`.as("open_balance"),
            ])
            .groupBy("contact_id")
            .as("balances"),
        (join) => join.onRef("balances.contact_id", "=", "accounting_contacts.id"),
      )
      .selectAll("accounting_contacts")
      .select([
        sql<number>`coalesce(balances.invoice_count, 0)`.as("invoice_count"),
        sql<string>`coalesce(balances.open_balance, 0)::numeric(14,2)::text`.as("open_balance"),
      ]);
  }

  async listContacts(filter: ListContactsFilter): Promise<{ rows: ContactWithBalance[]; total_count: number }> {
    const pattern = searchPattern(filter.search);
    let base = this.contactBalanceQuery();
    let count = this.db.selectFrom("accounting_contacts").select((eb) => eb.fn.countAll<number>().as("total_count"));
    if (pattern) {
      base = base.where((eb) =>
        eb.or([
          eb("accounting_contacts.name", "ilike", pattern),
          eb("accounting_contacts.phone", "ilike", pattern),
          eb("accounting_contacts.email", "ilike", pattern),
          eb("accounting_contacts.tax_number", "ilike", pattern),
        ]),
      );
      count = count.where((eb) =>
        eb.or([eb("name", "ilike", pattern), eb("phone", "ilike", pattern), eb("email", "ilike", pattern), eb("tax_number", "ilike", pattern)]),
      );
    }
    if (filter.syncStatus) {
      base = base.where("accounting_contacts.sync_status", "=", filter.syncStatus);
      count = count.where("sync_status", "=", filter.syncStatus);
    }
    const [rows, countRow] = await Promise.all([
      base.orderBy("accounting_contacts.name", "asc").orderBy("accounting_contacts.id", "asc").limit(filter.limit).offset(filter.offset).execute(),
      count.executeTakeFirst(),
    ]);
    return { rows: rows.map((row) => ({ ...row, invoice_count: Number(row.invoice_count) })), total_count: Number(countRow?.total_count ?? 0) };
  }

  async getContact(publicId: string): Promise<ContactWithBalance | null> {
    const row = await this.contactBalanceQuery().where("accounting_contacts.public_id", "=", publicId).executeTakeFirst();
    return row ? { ...row, invoice_count: Number(row.invoice_count) } : null;
  }

  private async customerIdFor(publicId: string | null | undefined): Promise<number | null | undefined> {
    if (publicId === undefined) return undefined;
    if (publicId === null) return null;
    const customer = await this.db.selectFrom("customers").select("id").where("public_id", "=", publicId).executeTakeFirst();
    if (!customer) throw new AccountingError("not_found", "Müşteri bulunamadı");
    return customer.id;
  }

  async createContact(input: ContactInput & { name: string }, actorUserId: number | null): Promise<AccountingContactRecord> {
    const customerId = await this.customerIdFor(input.customerPublicId);
    return this.db
      .insertInto("accounting_contacts")
      .values({
        public_id: newPublicId("acc"),
        customer_id: customerId ?? null,
        contact_type: input.contactType ?? "individual",
        name: input.name,
        tax_number: input.taxNumber ?? null,
        tax_office: input.taxOffice ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address_line: input.addressLine ?? null,
        district: input.district ?? null,
        city: input.city ?? null,
        country: input.country ?? "Türkiye",
        notes: input.notes ?? null,
        kolaybi_contact_id: null,
        kolaybi_address_id: null,
        sync_error: null,
        sync_request_id: null,
        sync_job_id: null,
        last_synced_at: null,
        created_by_user_id: actorUserId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** Partial update; a synced contact goes back to `local` so the next sync pushes the change. */
  async updateContact(publicId: string, input: ContactInput): Promise<AccountingContactRecord | null> {
    const changes: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(contactColumns)) {
      const value = input[key as keyof typeof contactColumns];
      if (value !== undefined) changes[column] = value;
    }
    const customerId = await this.customerIdFor(input.customerPublicId);
    if (customerId !== undefined) changes.customer_id = customerId;
    const updated = await this.db
      .updateTable("accounting_contacts")
      .set({
        ...changes,
        sync_status: sql<string>`case when sync_status = 'synced' then 'local' else sync_status end`,
        updated_at: new Date(),
      })
      .where("public_id", "=", publicId)
      .returningAll()
      .executeTakeFirst();
    return updated ?? null;
  }

  // ─── Faturalar ──────────────────────────────────────────────────────────────

  private invoiceQuery(db: AppDatabase = this.db) {
    return db
      .selectFrom("invoices")
      .innerJoin("accounting_contacts", "accounting_contacts.id", "invoices.contact_id")
      .leftJoin("orders", "orders.id", "invoices.order_id")
      .selectAll("invoices")
      .select([
        "accounting_contacts.public_id as contact_public_id",
        "accounting_contacts.name as contact_name",
        "orders.public_id as order_public_id",
        "orders.order_number as order_number",
      ]);
  }

  async listInvoices(filter: ListInvoicesFilter) {
    const pattern = searchPattern(filter.search);
    type Builder = ReturnType<AccountingRepository["invoiceQuery"]>;
    const where = <Q extends Builder | ReturnType<AccountingRepository["invoiceSummaryQuery"]>>(query: Q): Q => {
      let next = query as Builder;
      if (pattern) {
        next = next.where((eb) =>
          eb.or([
            eb("invoices.invoice_number", "ilike", pattern),
            eb("invoices.description", "ilike", pattern),
            eb("accounting_contacts.name", "ilike", pattern),
            eb("orders.order_number", "ilike", pattern),
          ]),
        );
      }
      if (filter.status === "open") next = next.where("invoices.status", "in", ["issued", "partially_paid"]);
      else if (filter.status) next = next.where("invoices.status", "=", filter.status);
      if (filter.contactPublicId) next = next.where("accounting_contacts.public_id", "=", filter.contactPublicId);
      if (filter.syncStatus) next = next.where("invoices.sync_status", "=", filter.syncStatus);
      if (filter.issuedFrom) next = next.where("invoices.issue_date", ">=", filter.issuedFrom);
      if (filter.issuedTo) next = next.where("invoices.issue_date", "<=", filter.issuedTo);
      return next as Q;
    };
    const [rows, summary] = await Promise.all([
      where(this.invoiceQuery())
        .orderBy("invoices.issue_date", "desc")
        .orderBy("invoices.id", "desc")
        .limit(filter.limit)
        .offset(filter.offset)
        .execute(),
      where(this.invoiceSummaryQuery()).executeTakeFirst(),
    ]);
    return {
      rows: rows as InvoiceRecord[],
      total_count: Number(summary?.total_count ?? 0),
      totals: {
        grand_total: summary?.grand_total ?? "0.00",
        paid_total: summary?.paid_total ?? "0.00",
        open_total: summary?.open_total ?? "0.00",
      },
    };
  }

  private invoiceSummaryQuery() {
    return this.db
      .selectFrom("invoices")
      .innerJoin("accounting_contacts", "accounting_contacts.id", "invoices.contact_id")
      .leftJoin("orders", "orders.id", "invoices.order_id")
      .select((eb) => [
        eb.fn.countAll<number>().as("total_count"),
        sql<string>`coalesce(sum(case when invoices.status <> 'cancelled' then invoices.grand_total else 0 end), 0)::numeric(14,2)::text`.as("grand_total"),
        sql<string>`coalesce(sum(case when invoices.status <> 'cancelled' then invoices.paid_total else 0 end), 0)::numeric(14,2)::text`.as("paid_total"),
        sql<string>`coalesce(sum(case when invoices.status <> 'cancelled' then invoices.grand_total - invoices.paid_total else 0 end), 0)::numeric(14,2)::text`.as("open_total"),
      ]);
  }

  async getInvoice(publicId: string, db: AppDatabase = this.db): Promise<InvoiceDetailRecord | null> {
    const invoice = (await this.invoiceQuery(db).where("invoices.public_id", "=", publicId).executeTakeFirst()) as InvoiceRecord | undefined;
    if (!invoice) return null;
    const [contact, items, payments] = await Promise.all([
      db.selectFrom("accounting_contacts").selectAll().where("id", "=", invoice.contact_id).executeTakeFirstOrThrow(),
      db
        .selectFrom("invoice_items")
        .leftJoin("products", "products.id", "invoice_items.product_id")
        .selectAll("invoice_items")
        .select("products.public_id as product_public_id")
        .where("invoice_items.invoice_id", "=", invoice.id)
        .orderBy("invoice_items.sort_order", "asc")
        .orderBy("invoice_items.id", "asc")
        .execute(),
      db.selectFrom("invoice_payments").selectAll().where("invoice_id", "=", invoice.id).orderBy("paid_at", "asc").orderBy("id", "asc").execute(),
    ]);
    return { invoice, contact, items, payments };
  }

  /** Idempotent by `idempotency_key`: a replay returns the stored invoice with `replayed: true`. */
  async createInvoice(input: CreateInvoiceInput): Promise<{ detail: InvoiceDetailRecord; replayed: boolean }> {
    const existing = await this.db.selectFrom("invoices").select("public_id").where("idempotency_key", "=", input.idempotencyKey).executeTakeFirst();
    if (existing) {
      const detail = await this.getInvoice(existing.public_id);
      if (!detail) throw new AccountingError("not_found", "Fatura bulunamadı");
      return { detail, replayed: true };
    }

    const publicId = await this.db.transaction().execute(async (transaction) => {
      const db = transaction as AppDatabase;
      const contact = await db.selectFrom("accounting_contacts").select("id").where("public_id", "=", input.contactPublicId).executeTakeFirst();
      if (!contact) throw new AccountingError("contact_not_found", "Cari hesap bulunamadı");
      let orderId: number | null = null;
      if (input.orderPublicId) {
        const order = await db.selectFrom("orders").select("id").where("public_id", "=", input.orderPublicId).executeTakeFirst();
        if (!order) throw new AccountingError("order_not_found", "Sipariş bulunamadı");
        orderId = order.id;
      }
      const productPublicIds = [...new Set(input.items.map((item) => item.productPublicId).filter((value): value is string => Boolean(value)))];
      const products = productPublicIds.length
        ? await db.selectFrom("products").select(["id", "public_id"]).where("public_id", "in", productPublicIds).execute()
        : [];
      const productIds = new Map(products.map((product) => [product.public_id, product.id]));
      if (productIds.size !== productPublicIds.length) throw new AccountingError("product_not_found", "Ürün bulunamadı");

      const lines = input.items.map((item) => ({ item, amounts: lineAmounts({ quantity: item.quantity, unitPrice: item.unitPrice, vatRate: item.vatRate }) }));
      const totals = invoiceTotals(lines.map((line) => line.amounts));
      const sequence = await sql<{ value: string }>`select nextval('invoice_number_seq')::text as value`.execute(db);
      const invoice = await db
        .insertInto("invoices")
        .values({
          public_id: newPublicId("inv"),
          invoice_number: invoiceNumberFor(input.issueDate, Number(sequence.rows[0]?.value ?? 0)),
          contact_id: contact.id,
          order_id: orderId,
          invoice_type: input.invoiceType ?? "sale",
          currency: input.currency ?? "TRY",
          issue_date: input.issueDate,
          due_date: input.dueDate ?? null,
          description: input.description ?? null,
          subtotal: totals.subtotal,
          vat_total: totals.vatTotal,
          grand_total: totals.grandTotal,
          kolaybi_invoice_id: null,
          e_document_status: null,
          sync_error: null,
          sync_request_id: null,
          sync_job_id: null,
          last_synced_at: null,
          idempotency_key: input.idempotencyKey,
          cancelled_at: null,
          created_by_user_id: input.actorUserId,
        })
        .returning(["id", "public_id"])
        .executeTakeFirstOrThrow();
      await db
        .insertInto("invoice_items")
        .values(
          lines.map((line, index) => ({
            public_id: newPublicId("ini"),
            invoice_id: invoice.id,
            product_id: line.item.productPublicId ? productIds.get(line.item.productPublicId) ?? null : null,
            description: line.item.description,
            quantity: String(line.item.quantity),
            unit: line.item.unit ?? "Adet",
            unit_price: fromKurus(toKurus(line.item.unitPrice)),
            vat_rate: String(line.item.vatRate),
            line_subtotal: line.amounts.lineSubtotal,
            line_vat: line.amounts.lineVat,
            line_total: line.amounts.lineTotal,
            sort_order: index,
          })),
        )
        .execute();
      return invoice.public_id;
    });

    const detail = await this.getInvoice(publicId);
    if (!detail) throw new AccountingError("not_found", "Fatura bulunamadı");
    return { detail, replayed: false };
  }

  /** Tahsilat: locks the invoice, rejects overpayment and keeps `paid_total` / `status` in step. */
  async addPayment(input: CreatePaymentInput): Promise<{ detail: InvoiceDetailRecord; payment: InvoicePaymentRecord; replayed: boolean }> {
    const replay = await this.db
      .selectFrom("invoice_payments")
      .innerJoin("invoices", "invoices.id", "invoice_payments.invoice_id")
      .selectAll("invoice_payments")
      .select("invoices.public_id as invoice_public_id")
      .where("invoice_payments.idempotency_key", "=", input.idempotencyKey)
      .executeTakeFirst();
    if (replay) {
      if (replay.invoice_public_id !== input.invoicePublicId) throw new AccountingError("idempotency_conflict", "Bu işlem anahtarı başka bir faturada kullanıldı");
      const detail = await this.getInvoice(input.invoicePublicId);
      if (!detail) throw new AccountingError("not_found", "Fatura bulunamadı");
      const { invoice_public_id: _invoicePublicId, ...payment } = replay;
      return { detail, payment, replayed: true };
    }

    const payment = await this.db.transaction().execute(async (transaction) => {
      const db = transaction as AppDatabase;
      const invoice = await db
        .selectFrom("invoices")
        .select(["id", "status", "grand_total", "paid_total"])
        .where("public_id", "=", input.invoicePublicId)
        .forUpdate()
        .executeTakeFirst();
      if (!invoice) throw new AccountingError("not_found", "Fatura bulunamadı");
      if (invoice.status === "cancelled") throw new AccountingError("invoice_cancelled", "İptal edilmiş faturaya tahsilat girilemez");
      const amount = toKurus(input.amount);
      const remaining = toKurus(invoice.grand_total) - toKurus(invoice.paid_total);
      if (amount > remaining) throw new AccountingError("overpayment", `Tahsilat kalan tutarı (${fromKurus(Math.max(0, remaining))}) aşıyor`);
      const paidTotal = fromKurus(toKurus(invoice.paid_total) + amount);
      const inserted = await db
        .insertInto("invoice_payments")
        .values({
          public_id: newPublicId("pay"),
          invoice_id: invoice.id,
          amount: fromKurus(amount),
          method: input.method,
          vault_id: input.vaultId ?? null,
          paid_at: input.paidAt ?? new Date(),
          notes: input.notes ?? null,
          sync_error: null,
          sync_request_id: null,
          sync_job_id: null,
          idempotency_key: input.idempotencyKey,
          created_by_user_id: input.actorUserId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await db
        .updateTable("invoices")
        .set({ paid_total: paidTotal, status: statusForPaidTotal(invoice.grand_total, paidTotal), updated_at: new Date() })
        .where("id", "=", invoice.id)
        .execute();
      return inserted;
    });

    const detail = await this.getInvoice(input.invoicePublicId);
    if (!detail) throw new AccountingError("not_found", "Fatura bulunamadı");
    return { detail, payment, replayed: false };
  }

  /** Cancels an unpaid invoice (legacy "fatura sil" on a draft); paid invoices must be refunded first. */
  async cancelInvoice(publicId: string): Promise<InvoiceDetailRecord> {
    await this.db.transaction().execute(async (transaction) => {
      const db = transaction as AppDatabase;
      const invoice = await db.selectFrom("invoices").select(["id", "status", "paid_total"]).where("public_id", "=", publicId).forUpdate().executeTakeFirst();
      if (!invoice) throw new AccountingError("not_found", "Fatura bulunamadı");
      if (invoice.status === "cancelled") return;
      if (toKurus(invoice.paid_total) > 0) throw new AccountingError("has_payments", "Tahsilatı olan fatura iptal edilemez");
      await db.updateTable("invoices").set({ status: "cancelled", cancelled_at: new Date(), updated_at: new Date() }).where("id", "=", invoice.id).execute();
    });
    const detail = await this.getInvoice(publicId);
    if (!detail) throw new AccountingError("not_found", "Fatura bulunamadı");
    return detail;
  }

  // ─── KolayBi senkronu ───────────────────────────────────────────────────────

  async markQueued(target: SyncTarget, id: number, requestId: string, jobId: string | null) {
    const table = target === "contact" ? "accounting_contacts" : target === "invoice" ? "invoices" : "invoice_payments";
    await this.db
      .updateTable(table)
      .set({ sync_status: "queued", sync_error: null, sync_request_id: requestId, sync_job_id: jobId, updated_at: new Date() })
      .where("id", "=", id)
      .execute();
  }

  /** Rows waiting for KolayBi (not yet synced, or failed) — the "KolayBi'ye gönder" batch. */
  async pendingSync(limit: number) {
    const [contacts, invoices, payments] = await Promise.all([
      this.db.selectFrom("accounting_contacts").selectAll().where("sync_status", "in", ["local", "failed"]).orderBy("id", "asc").limit(limit).execute(),
      this.invoiceQuery()
        .where("invoices.sync_status", "in", ["local", "failed"])
        .where("invoices.status", "<>", "cancelled")
        .orderBy("invoices.id", "asc")
        .limit(limit)
        .execute() as Promise<InvoiceRecord[]>,
      this.db
        .selectFrom("invoice_payments")
        .innerJoin("invoices", "invoices.id", "invoice_payments.invoice_id")
        .selectAll("invoice_payments")
        .select(["invoices.kolaybi_invoice_id as kolaybi_invoice_id", "invoices.public_id as invoice_public_id"])
        .where("invoice_payments.sync_status", "in", ["local", "failed"])
        .orderBy("invoice_payments.id", "asc")
        .limit(limit)
        .execute(),
    ]);
    return { contacts, invoices, payments };
  }

  async syncCounts() {
    const rows = await sql<{ target: SyncTarget; sync_status: SyncStatus; count: string }>`
      select 'contact' as target, sync_status, count(*)::text as count from accounting_contacts group by sync_status
      union all
      select 'invoice' as target, sync_status, count(*)::text as count from invoices where status <> 'cancelled' group by sync_status
      union all
      select 'payment' as target, sync_status, count(*)::text as count from invoice_payments group by sync_status
    `.execute(this.db);
    const empty = () => ({ local: 0, queued: 0, synced: 0, failed: 0 });
    const counts = { contact: empty(), invoice: empty(), payment: empty() };
    for (const row of rows.rows) counts[row.target][row.sync_status] = Number(row.count);
    return counts;
  }

  async queuedRows() {
    const [contacts, invoices, payments] = await Promise.all([
      this.db.selectFrom("accounting_contacts").select(["id", "sync_request_id"]).where("sync_status", "=", "queued").execute(),
      this.db.selectFrom("invoices").select(["id", "sync_request_id"]).where("sync_status", "=", "queued").execute(),
      this.db.selectFrom("invoice_payments").select(["id", "sync_request_id"]).where("sync_status", "=", "queued").execute(),
    ]);
    return { contacts, invoices, payments };
  }

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

  async applySyncResult(target: SyncTarget, id: number, result: { status: "synced" | "failed"; error?: string | null; kolaybiId?: string | null; kolaybiAddressId?: string | null }) {
    const base = { sync_status: result.status, sync_error: result.status === "failed" ? result.error ?? "KolayBi senkronu başarısız" : null, updated_at: new Date() };
    if (target === "contact") {
      await this.db
        .updateTable("accounting_contacts")
        .set({
          ...base,
          ...(result.status === "synced" ? { last_synced_at: new Date() } : {}),
          ...(result.kolaybiId ? { kolaybi_contact_id: result.kolaybiId } : {}),
          ...(result.kolaybiAddressId ? { kolaybi_address_id: result.kolaybiAddressId } : {}),
        })
        .where("id", "=", id)
        .execute();
    } else if (target === "invoice") {
      await this.db
        .updateTable("invoices")
        .set({
          ...base,
          ...(result.status === "synced" ? { last_synced_at: new Date() } : {}),
          ...(result.kolaybiId ? { kolaybi_invoice_id: result.kolaybiId } : {}),
        })
        .where("id", "=", id)
        .execute();
    } else {
      await this.db.updateTable("invoice_payments").set(base).where("id", "=", id).execute();
    }
  }

  /** Mirrors the worker's account-config gate: provider live_mode AND (account live_mode or unset). */
  async kolaybiReadiness(liveGate: string): Promise<KolaybiReadiness> {
    const db = this.db;
    const [account, providerSetting] = await Promise.all([
      db
        .selectFrom("integration_accounts")
        .innerJoin("integration_providers", "integration_providers.id", "integration_accounts.provider_id")
        .select(["integration_accounts.id", "integration_accounts.public_id", "integration_accounts.display_name", "integration_accounts.status", "integration_providers.id as provider_id"])
        .where("integration_providers.key", "=", "kolaybi")
        .where("integration_providers.is_active", "=", true)
        .orderBy(({ eb }) => eb.case().when("integration_accounts.status", "=", "active").then(0).else(1).end())
        .orderBy("integration_accounts.id", "asc")
        .executeTakeFirst(),
      db.selectFrom("settings").select("value").where("scope", "=", "global").where("key", "=", liveGate).executeTakeFirst(),
    ]);
    const providerLiveMode = booleanValue(providerSetting?.value) === true;
    let accountLiveMode: boolean | null = null;
    if (account) {
      const setting = await db
        .selectFrom("integration_settings")
        .select(["value", "is_secret"])
        .where("provider_id", "=", account.provider_id)
        .where("account_id", "=", account.id)
        .where("key", "=", "live_mode")
        .executeTakeFirst();
      accountLiveMode = setting && !setting.is_secret ? booleanValue(setting.value) : null;
    }
    return {
      account: account ? { public_id: account.public_id, display_name: account.display_name, status: account.status } : null,
      provider_live_mode: providerLiveMode,
      account_live_mode: accountLiveMode,
      live_call_permitted: Boolean(account && account.status === "active" && providerLiveMode && accountLiveMode !== false),
      live_gate: liveGate,
    };
  }

  async invoiceIssuer(): Promise<InvoiceIssuer> {
    const db = this.db;
    const rows = await db
      .selectFrom("settings")
      .select(["key", "value"])
      .where("scope", "=", "global")
      .where("is_secret", "=", false)
      .where("key", "in", ["gonderici_adi", "gonderici_telefon", "gonderici_adres", "gonderici_il", "gonderici_ilce"])
      .execute();
    const value = (key: string) => {
      const raw = rows.find((row) => row.key === key)?.value;
      return typeof raw === "string" && raw.trim() ? raw.trim() : null;
    };
    return {
      name: value("gonderici_adi") ?? "Garanti Kuluçka",
      phone: value("gonderici_telefon"),
      address: value("gonderici_adres"),
      city: value("gonderici_il"),
      district: value("gonderici_ilce"),
    };
  }
}

export { openAmount, sqlDate };
