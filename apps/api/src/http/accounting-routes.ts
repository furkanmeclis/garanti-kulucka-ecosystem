import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { jobEnvelopeSchema, providerDeliveryJobPayloadSchema } from "@garanti-kulucka/shared";
import type { AppBindings } from "./types.js";
import { authenticate, requireDatabase } from "./middleware.js";
import {
  AccountingError,
  AccountingRepository,
  type AccountingContactRecord,
  type ContactWithBalance,
  type InvoiceDetailRecord,
  type InvoicePaymentRecord,
  type InvoiceRecord,
  type SyncTarget,
} from "../accounting/repository.js";
import { renderInvoiceHtml, renderInvoicePdf } from "../accounting/documents.js";
import { invoiceStatuses, openAmount, paymentMethods, sqlDate, syncStatuses } from "../accounting/rules.js";

/**
 * Legacy muhasebe pages (FaturaListPage, FaturaOlusturPage, CariHesaplarPage) as backend routes.
 * Invoices, cari accounts and tahsilat live in the canonical database; "KolayBi senkronu" queues one
 * `provider-delivery` job per pending row (contact.create/update, invoice.create, invoice.payment.create).
 * Live KolayBi calls stay gated in the worker by `providers.kolaybi.live_mode` plus the active
 * KolayBi integration account's own `live_mode` opt-in; without them the worker records a dry run.
 * Manager-only: owner and admin.
 */

const liveGate = "providers.kolaybi.live_mode";
const limitSchema = z.coerce.number().int().min(1).max(200).default(50);
const offsetSchema = z.coerce.number().int().min(0).default(0);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-AA-GG olmalı");
const moneySchema = z.union([z.string().trim().regex(/^\d+(\.\d{1,2})?$/), z.number().nonnegative()]).transform((value) => (typeof value === "number" ? value.toFixed(2) : value));
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value === null || value.trim() === "" ? null : value.trim()));

const contactBodySchema = z
  .object({
    contact_type: z.enum(["individual", "corporate"]).optional(),
    name: z.string().trim().min(1, "Cari adı gerekli").max(200).optional(),
    tax_number: optionalText(20).refine((value) => value == null || /^\d{10,11}$/.test(value), { message: "VKN/TCKN 10 veya 11 haneli olmalı" }),
    tax_office: optionalText(120),
    phone: optionalText(40),
    email: optionalText(320).refine((value) => value == null || z.string().email().safeParse(value).success, { message: "Geçersiz e-posta" }),
    address_line: optionalText(500),
    district: optionalText(120),
    city: optionalText(120),
    country: z.string().trim().min(1).max(80).optional(),
    notes: optionalText(5000),
    customer_public_id: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

const createContactSchema = contactBodySchema.refine((payload) => payload.name !== undefined, { message: "Cari adı gerekli", path: ["name"] });
const updateContactSchema = contactBodySchema.refine((payload) => Object.values(payload).some((value) => value !== undefined), { message: "En az bir alan gerekli" });

const invoiceItemSchema = z.object({
  description: z.string().trim().min(1, "Kalem açıklaması gerekli").max(500),
  quantity: z.coerce.number().positive("Miktar 0'dan büyük olmalı").max(1_000_000),
  unit: z.string().trim().min(1).max(20).optional(),
  unit_price: moneySchema,
  vat_rate: z.coerce.number().min(0).max(100).default(20),
  product_public_id: z.string().trim().min(1).nullable().optional(),
});

const createInvoiceSchema = z
  .object({
    idempotency_key: z.string().trim().min(1).max(160),
    contact_public_id: z.string().trim().min(1),
    order_public_id: z.string().trim().min(1).nullable().optional(),
    invoice_type: z.enum(["sale", "sale_return"]).optional(),
    issue_date: dateSchema,
    due_date: dateSchema.nullable().optional(),
    currency: z.string().trim().length(3).toUpperCase().optional(),
    description: optionalText(2000),
    items: z.array(invoiceItemSchema).min(1, "En az bir kalem gerekli").max(200),
  })
  .refine((payload) => !payload.due_date || payload.due_date >= payload.issue_date, { message: "Vade tarihi fatura tarihinden önce olamaz", path: ["due_date"] });

const paymentSchema = z.object({
  idempotency_key: z.string().trim().min(1).max(160),
  amount: moneySchema.refine((value) => Number(value) > 0, { message: "Tahsilat tutarı 0'dan büyük olmalı" }),
  method: z.enum(paymentMethods).default("bank_transfer"),
  paid_at: z.string().datetime({ offset: true }).optional(),
  vault_id: optionalText(40),
  notes: optionalText(1000),
});

const syncSchema = z.object({
  idempotency_key: z.string().trim().min(1).max(160),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const knownMessages = new Set([
  "Cari adı gerekli",
  "VKN/TCKN 10 veya 11 haneli olmalı",
  "Geçersiz e-posta",
  "En az bir alan gerekli",
  "Kalem açıklaması gerekli",
  "Miktar 0'dan büyük olmalı",
  "En az bir kalem gerekli",
  "Vade tarihi fatura tarihinden önce olamaz",
  "Tarih YYYY-AA-GG olmalı",
  "Tahsilat tutarı 0'dan büyük olmalı",
]);

function isManager(role: string | undefined) {
  return role === "admin" || role === "owner";
}

function invalid(context: Context<AppBindings>, error: z.ZodError, fallback: string) {
  const message = error.issues[0]?.message;
  return context.json({ error: { code: "invalid_request", message: message && knownMessages.has(message) ? message : fallback } }, 400);
}

async function readJson(context: Context<AppBindings>): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    return undefined;
  }
}

function errorResponse(context: Context<AppBindings>, error: unknown) {
  if (error instanceof AccountingError) {
    const status = error.code === "not_found" || error.code.endsWith("_not_found") ? 404 : error.code === "overpayment" ? 422 : 409;
    return context.json({ error: { code: error.code, message: error.message } }, status);
  }
  throw error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function idString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

// ─── Serializers ─────────────────────────────────────────────────────────────

function syncFields(row: { sync_status: string; sync_error: string | null; sync_request_id: string | null; sync_job_id: string | null }) {
  return { status: row.sync_status, error: row.sync_error, request_id: row.sync_request_id, job_id: row.sync_job_id };
}

export function serializeAccountingContact(contact: AccountingContactRecord | ContactWithBalance) {
  return {
    public_id: contact.public_id,
    contact_type: contact.contact_type,
    name: contact.name,
    tax_number: contact.tax_number,
    tax_office: contact.tax_office,
    phone: contact.phone,
    email: contact.email,
    address_line: contact.address_line,
    district: contact.district,
    city: contact.city,
    country: contact.country,
    notes: contact.notes,
    kolaybi_contact_id: contact.kolaybi_contact_id,
    sync: syncFields(contact),
    last_synced_at: contact.last_synced_at,
    invoice_count: "invoice_count" in contact ? contact.invoice_count : undefined,
    open_balance: "open_balance" in contact ? contact.open_balance : undefined,
    created_at: contact.created_at,
    updated_at: contact.updated_at,
  };
}

export function serializeInvoice(invoice: InvoiceRecord) {
  return {
    public_id: invoice.public_id,
    invoice_number: invoice.invoice_number,
    invoice_type: invoice.invoice_type,
    status: invoice.status,
    currency: invoice.currency,
    issue_date: sqlDate(invoice.issue_date),
    due_date: sqlDate(invoice.due_date),
    description: invoice.description,
    subtotal: invoice.subtotal,
    vat_total: invoice.vat_total,
    grand_total: invoice.grand_total,
    paid_total: invoice.paid_total,
    open_amount: invoice.status === "cancelled" ? "0.00" : openAmount(invoice.grand_total, invoice.paid_total),
    contact: { public_id: invoice.contact_public_id, name: invoice.contact_name },
    order: invoice.order_public_id ? { public_id: invoice.order_public_id, order_number: invoice.order_number } : null,
    kolaybi_invoice_id: invoice.kolaybi_invoice_id,
    e_document_status: invoice.e_document_status,
    sync: syncFields(invoice),
    created_at: invoice.created_at,
    updated_at: invoice.updated_at,
  };
}

function serializePayment(payment: InvoicePaymentRecord) {
  return {
    public_id: payment.public_id,
    amount: payment.amount,
    method: payment.method,
    vault_id: payment.vault_id,
    paid_at: payment.paid_at,
    notes: payment.notes,
    sync: syncFields(payment),
    created_at: payment.created_at,
  };
}

export function serializeInvoiceDetail(detail: InvoiceDetailRecord) {
  return {
    ...serializeInvoice(detail.invoice),
    contact: serializeAccountingContact(detail.contact),
    items: detail.items.map((item) => ({
      public_id: item.public_id,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: item.unit_price,
      vat_rate: item.vat_rate,
      line_subtotal: item.line_subtotal,
      line_vat: item.line_vat,
      line_total: item.line_total,
      product_public_id: item.product_public_id,
    })),
    payments: detail.payments.map(serializePayment),
  };
}

// ─── KolayBi account / issuer lookups ────────────────────────────────────────

// ─── KolayBi sync ────────────────────────────────────────────────────────────

function slug(value: string, max: number) {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, max);
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

type SyncOperation = "contact.create" | "contact.update" | "invoice.create" | "invoice.payment.create";

async function enqueueSync(
  context: Context<AppBindings>,
  repo: AccountingRepository,
  input: { target: SyncTarget; rowId: number; operation: SyncOperation; key: string; payload: Record<string, unknown>; accountPublicId: string | null },
) {
  const suffix = `${slug(input.key, 60)}_${shortHash(input.key)}`;
  const requestId = `req_acct_${suffix}`;
  const occurredAt = new Date().toISOString();
  const envelope = providerDeliveryJobPayloadSchema.parse({
    envelope: {
      request_id: requestId,
      provider: "kolaybi",
      operation: input.operation,
      direction: "outbound",
      channel: "accounting",
      ...(input.accountPublicId ? { account_public_id: input.accountPublicId } : {}),
      occurred_at: occurredAt,
      payload: { ...input.payload, idempotency_key: input.key },
      legacy_contract: { source: "legacy-muhasebe-pages", legacy_event: `accounting.${input.target}.sync` },
    },
  });
  const job = jobEnvelopeSchema.parse({
    job_id: `job_acct_${suffix}`,
    queue: "provider-delivery",
    name: `kolaybi.${input.operation}`,
    payload: envelope,
    requested_at: occurredAt,
    request_id: context.get("requestId"),
  });
  const jobId = await context.get("providerDeliveryQueuePublisher").publish(job);
  await repo.markQueued(input.target, input.rowId, requestId, jobId);
  return { request_id: requestId, job_id: jobId, queued: jobId !== null };
}

/** One KolayBi follow-up job that does not change the row's sync status (payment delete, e-document resend/cancel, invoice delete). */
async function queueKolaybiFollowUp(
  context: Context<AppBindings>,
  repo: AccountingRepository,
  input: { operation: "invoice.payment.delete" | "invoice.e_document.resend" | "invoice.delete"; key: string; payload: Record<string, unknown> },
) {
  const readiness = await repo.kolaybiReadiness(liveGate);
  const accountPublicId = readiness.account?.public_id ?? null;
  const suffix = `${slug(input.key, 60)}_${shortHash(input.key)}`;
  const requestId = `req_acct_${suffix}`;
  const occurredAt = new Date().toISOString();
  const envelope = providerDeliveryJobPayloadSchema.parse({
    envelope: {
      request_id: requestId,
      provider: "kolaybi",
      operation: input.operation,
      direction: "outbound",
      channel: "accounting",
      ...(accountPublicId ? { account_public_id: accountPublicId } : {}),
      occurred_at: occurredAt,
      payload: { ...input.payload, idempotency_key: input.key },
      legacy_contract: { source: "frontend/src/services/kolaybi.js faturalar", legacy_event: `accounting.${input.operation}` },
    },
  });
  const job = jobEnvelopeSchema.parse({
    job_id: `job_acct_${suffix}`,
    queue: "provider-delivery",
    name: `kolaybi.${input.operation}`,
    payload: envelope,
    requested_at: occurredAt,
    request_id: context.get("requestId"),
  });
  const jobId = await context.get("providerDeliveryQueuePublisher").publish(job);
  return { operation: input.operation, request_id: requestId, job_id: jobId, queued: jobId !== null };
}

/** Legacy "e-belge oluşturulmuşsa önce iptal" statuses. */
const cancellableEDocumentStatuses = new Set(["ready", "sent", "delivered", "accepted", "waiting", "queued", "resend_queued"]);

function contactPayload(contact: AccountingContactRecord) {
  return {
    contact_public_id: contact.public_id,
    ...(contact.kolaybi_contact_id ? { contact_id: contact.kolaybi_contact_id } : {}),
    musteri_ad: contact.name,
    is_corporate: contact.contact_type === "corporate",
    ...(contact.tax_number ? { identity_no: contact.tax_number } : {}),
    ...(contact.tax_office ? { tax_office: contact.tax_office } : {}),
    ...(contact.phone ? { phone: contact.phone } : {}),
    ...(contact.email ? { email: contact.email } : {}),
    ...(contact.address_line ? { address: contact.address_line } : {}),
    ...(contact.city ? { city: contact.city } : {}),
    ...(contact.district ? { district: contact.district } : {}),
    ...(contact.country ? { country: contact.country } : {}),
  };
}

/** Reads worker attempts for queued rows and stores the outcome (KolayBi ids, errors, dry runs). */
async function collectSyncResults(repo: AccountingRepository) {
  const queued = await repo.queuedRows();
  let updated = 0;
  const apply = async (target: SyncTarget, rows: Array<{ id: number; sync_request_id: string | null }>) => {
    for (const row of rows) {
      if (!row.sync_request_id) continue;
      const attempt = await repo.latestAttempt(row.sync_request_id);
      if (!attempt) continue;
      if (attempt.status === "terminal_failure") {
        await repo.applySyncResult(target, row.id, { status: "failed", error: attempt.error_message ?? "KolayBi işlemi başarısız" });
        updated += 1;
        continue;
      }
      if (attempt.status !== "success") continue;
      const metadata = parseJsonObject(attempt.response_metadata);
      if (metadata.live_call_performed === false || !isRecord(metadata.result)) {
        await repo.applySyncResult(target, row.id, {
          status: "failed",
          error: `Canlı KolayBi kapalı; istek kuru çalıştırıldı (${liveGate} ve hesap onayı gerekli).`,
        });
        updated += 1;
        continue;
      }
      const result = metadata.result;
      const data = isRecord(result.data) ? result.data : result;
      await repo.applySyncResult(target, row.id, {
        status: "synced",
        kolaybiId: target === "contact" ? idString(result.contact_id) : target === "invoice" ? idString(data.id ?? data.invoice_id ?? data.document_id) : idString(result.payment_id),
        kolaybiAddressId: target === "contact" ? idString(result.address_id) : null,
      });
      updated += 1;
    }
  };
  await apply("contact", queued.contacts);
  await apply("invoice", queued.invoices);
  await apply("payment", queued.payments);
  return updated;
}

export function createAccountingRoutes() {
  const routes = new Hono<AppBindings>();

  routes.use("*", requireDatabase, authenticate);
  routes.use("*", async (context, next) => {
    if (!isManager(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Muhasebe yalnızca yöneticiye açıktır" } }, 403);
    }
    await next();
  });

  const repoFor = (context: Context<AppBindings>) => new AccountingRepository(context.get("db")!);

  // ─── Cari hesaplar ──────────────────────────────────────────────────────────

  routes.get("/contacts", async (context) => {
    const query = z
      .object({ limit: limitSchema, offset: offsetSchema, search: z.string().trim().max(120).optional(), sync_status: z.enum(syncStatuses).optional() })
      .safeParse(Object.fromEntries(new URL(context.req.url).searchParams));
    if (!query.success) return invalid(context, query.error, "Invalid contact list query");
    const result = await repoFor(context).listContacts({
      search: query.data.search,
      syncStatus: query.data.sync_status,
      limit: query.data.limit,
      offset: query.data.offset,
    });
    return context.json({ data: result.rows.map(serializeAccountingContact), meta: { total_count: result.total_count, limit: query.data.limit, offset: query.data.offset } });
  });

  routes.post("/contacts", async (context) => {
    const payload = createContactSchema.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, payload.error, "Invalid contact payload");
    try {
      const data = payload.data;
      const contact = await repoFor(context).createContact(
        {
          contactType: data.contact_type,
          name: data.name as string,
          taxNumber: data.tax_number,
          taxOffice: data.tax_office,
          phone: data.phone,
          email: data.email,
          addressLine: data.address_line,
          district: data.district,
          city: data.city,
          country: data.country,
          notes: data.notes,
          customerPublicId: data.customer_public_id,
        },
        context.get("actorUserId"),
      );
      return context.json(serializeAccountingContact(contact), 201);
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  routes.get("/contacts/:contact_public_id", async (context) => {
    const contact = await repoFor(context).getContact(context.req.param("contact_public_id"));
    if (!contact) return context.json({ error: { code: "not_found", message: "Cari hesap bulunamadı" } }, 404);
    return context.json(serializeAccountingContact(contact));
  });

  routes.patch("/contacts/:contact_public_id", async (context) => {
    const payload = updateContactSchema.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, payload.error, "Invalid contact payload");
    try {
      const data = payload.data;
      const contact = await repoFor(context).updateContact(context.req.param("contact_public_id"), {
        contactType: data.contact_type,
        name: data.name,
        taxNumber: data.tax_number,
        taxOffice: data.tax_office,
        phone: data.phone,
        email: data.email,
        addressLine: data.address_line,
        district: data.district,
        city: data.city,
        country: data.country,
        notes: data.notes,
        customerPublicId: data.customer_public_id,
      });
      if (!contact) return context.json({ error: { code: "not_found", message: "Cari hesap bulunamadı" } }, 404);
      return context.json(serializeAccountingContact(contact));
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  // ─── Faturalar ──────────────────────────────────────────────────────────────

  routes.get("/invoices", async (context) => {
    const query = z
      .object({
        limit: limitSchema,
        offset: offsetSchema,
        search: z.string().trim().max(120).optional(),
        status: z.enum([...invoiceStatuses, "open"]).optional(),
        contact_public_id: z.string().trim().min(1).optional(),
        sync_status: z.enum(syncStatuses).optional(),
        issued_from: dateSchema.optional(),
        issued_to: dateSchema.optional(),
      })
      .safeParse(Object.fromEntries(new URL(context.req.url).searchParams));
    if (!query.success) return invalid(context, query.error, "Invalid invoice list query");
    const result = await repoFor(context).listInvoices({
      search: query.data.search,
      status: query.data.status,
      contactPublicId: query.data.contact_public_id,
      syncStatus: query.data.sync_status,
      issuedFrom: query.data.issued_from,
      issuedTo: query.data.issued_to,
      limit: query.data.limit,
      offset: query.data.offset,
    });
    return context.json({
      data: result.rows.map(serializeInvoice),
      meta: { total_count: result.total_count, limit: query.data.limit, offset: query.data.offset },
      totals: result.totals,
    });
  });

  routes.post("/invoices", async (context) => {
    const payload = createInvoiceSchema.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, payload.error, "Invalid invoice payload");
    try {
      const data = payload.data;
      const { detail, replayed } = await repoFor(context).createInvoice({
        idempotencyKey: data.idempotency_key,
        contactPublicId: data.contact_public_id,
        orderPublicId: data.order_public_id,
        invoiceType: data.invoice_type,
        issueDate: data.issue_date,
        dueDate: data.due_date,
        currency: data.currency,
        description: data.description,
        items: data.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unitPrice: item.unit_price,
          vatRate: item.vat_rate,
          productPublicId: item.product_public_id,
        })),
        actorUserId: context.get("actorUserId"),
      });
      return context.json({ ...serializeInvoiceDetail(detail), replayed }, replayed ? 200 : 201);
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  routes.get("/invoices/:invoice_public_id", async (context) => {
    const detail = await repoFor(context).getInvoice(context.req.param("invoice_public_id"));
    if (!detail) return context.json({ error: { code: "not_found", message: "Fatura bulunamadı" } }, 404);
    return context.json(serializeInvoiceDetail(detail));
  });

  routes.get("/invoices/:invoice_public_id/document", async (context) => {
    const format = context.req.query("format") ?? "html";
    if (format !== "html" && format !== "pdf") {
      return context.json({ error: { code: "invalid_request", message: "format html veya pdf olmalı" } }, 400);
    }
    const repo = repoFor(context);
    const detail = await repo.getInvoice(context.req.param("invoice_public_id"));
    if (!detail) return context.json({ error: { code: "not_found", message: "Fatura bulunamadı" } }, 404);
    const issuer = await repo.invoiceIssuer();
    const filename = `fatura-${detail.invoice.invoice_number}`;
    if (format === "pdf") {
      return new Response(new Uint8Array(renderInvoicePdf(detail, issuer)), {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `${context.req.query("download") === "1" ? "attachment" : "inline"}; filename="${filename}.pdf"`,
          "cache-control": "no-store",
        },
      });
    }
    return new Response(renderInvoiceHtml(detail, issuer), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `inline; filename="${filename}.html"`,
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:",
      },
    });
  });

  routes.post("/invoices/:invoice_public_id/payments", async (context) => {
    const payload = paymentSchema.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, payload.error, "Invalid payment payload");
    try {
      const result = await repoFor(context).addPayment({
        invoicePublicId: context.req.param("invoice_public_id"),
        idempotencyKey: payload.data.idempotency_key,
        amount: payload.data.amount,
        method: payload.data.method,
        paidAt: payload.data.paid_at,
        vaultId: payload.data.vault_id,
        notes: payload.data.notes,
        actorUserId: context.get("actorUserId"),
      });
      return context.json(
        { invoice: serializeInvoiceDetail(result.detail), payment: serializePayment(result.payment), replayed: result.replayed },
        result.replayed ? 200 : 201,
      );
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  routes.delete("/invoices/:invoice_public_id/payments/:payment_public_id", async (context) => {
    const repo = repoFor(context);
    try {
      const result = await repo.deletePayment({
        invoicePublicId: context.req.param("invoice_public_id"),
        paymentPublicId: context.req.param("payment_public_id"),
        actorUserId: context.get("actorUserId"),
      });
      // KolayBi deletes the tahsilat per document; only payments that reached KolayBi need the call.
      const kolaybi =
        result.kolaybiInvoiceId && result.payment.sync_status === "synced"
          ? await queueKolaybiFollowUp(context, repo, {
              operation: "invoice.payment.delete",
              key: `payment_delete_${result.payment.public_id}`,
              payload: { document_id: result.kolaybiInvoiceId, invoice_public_id: context.req.param("invoice_public_id"), payment_public_id: result.payment.public_id },
            })
          : null;
      return context.json({ invoice: serializeInvoiceDetail(result.detail), deleted_payment_public_id: result.payment.public_id, kolaybi, live_gate: liveGate });
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  routes.post("/invoices/:invoice_public_id/e-document/resend", async (context) => {
    const repo = repoFor(context);
    try {
      const documentId = await repo.markEDocumentResend(context.req.param("invoice_public_id"));
      const kolaybi = await queueKolaybiFollowUp(context, repo, {
        operation: "invoice.e_document.resend",
        key: `e_document_resend_${context.req.param("invoice_public_id")}_${Date.now()}`,
        payload: { document_id: documentId, invoice_public_id: context.req.param("invoice_public_id") },
      });
      const detail = await repo.getInvoice(context.req.param("invoice_public_id"));
      return context.json({ invoice: detail ? serializeInvoiceDetail(detail) : null, kolaybi, live_gate: liveGate }, 202);
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  routes.delete("/invoices/:invoice_public_id", async (context) => {
    const repo = repoFor(context);
    const publicId = context.req.param("invoice_public_id");
    try {
      const removed = await repo.deleteInvoice({ invoicePublicId: publicId, actorUserId: context.get("actorUserId") });
      let kolaybi = null;
      if (removed.kolaybiInvoiceId) {
        // One job: the worker cancels the e-document first (when one was issued) and then deletes the invoice.
        const now = new Date();
        const cancel = removed.eDocumentStatus && cancellableEDocumentStatuses.has(removed.eDocumentStatus)
          ? {
              cancel_date: now.toLocaleDateString("sv-SE", { timeZone: "Europe/Istanbul" }),
              cancel_time: now.toLocaleTimeString("tr-TR", { timeZone: "Europe/Istanbul", hour12: false }),
            }
          : {};
        kolaybi = await queueKolaybiFollowUp(context, repo, {
          operation: "invoice.delete",
          key: `invoice_delete_${publicId}`,
          payload: { document_id: removed.kolaybiInvoiceId, invoice_public_id: publicId, ...cancel },
        });
      }
      return context.json({ deleted: true, invoice_number: removed.invoiceNumber, kolaybi, live_gate: liveGate });
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  routes.post("/invoices/:invoice_public_id/cancel", async (context) => {
    try {
      const detail = await repoFor(context).cancelInvoice(context.req.param("invoice_public_id"));
      return context.json(serializeInvoiceDetail(detail));
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  // ─── KolayBi senkronu ───────────────────────────────────────────────────────

  routes.get("/kolaybi/status", async (context) => {
    const repo = repoFor(context);
    await collectSyncResults(repo);
    const [readiness, counts] = await Promise.all([repo.kolaybiReadiness(liveGate), repo.syncCounts()]);
    return context.json({ ...readiness, counts });
  });

  routes.post("/kolaybi/sync", async (context) => {
    const payload = syncSchema.safeParse((await readJson(context)) ?? {});
    if (!payload.success) return invalid(context, payload.error, "Invalid sync payload");
    const repo = repoFor(context);
    await collectSyncResults(repo);
    const readiness = await repo.kolaybiReadiness(liveGate);
    const pending = await repo.pendingSync(payload.data.limit);
    const accountPublicId = readiness.account?.public_id ?? null;
    const root = payload.data.idempotency_key;
    const results: Array<{ target: SyncTarget; public_id: string; operation: SyncOperation | null; queued: boolean; skipped_reason: string | null }> = [];

    for (const contact of pending.contacts) {
      const operation: SyncOperation = contact.kolaybi_contact_id ? "contact.update" : "contact.create";
      const queued = await enqueueSync(context, repo, {
        target: "contact",
        rowId: contact.id,
        operation,
        key: `${root}:contact:${contact.public_id}`,
        payload: contactPayload(contact),
        accountPublicId,
      });
      results.push({ target: "contact", public_id: contact.public_id, operation, queued: queued.queued, skipped_reason: null });
    }

    for (const invoice of pending.invoices) {
      const detail = await repo.getInvoice(invoice.public_id);
      if (!detail) continue;
      if (!detail.contact.kolaybi_contact_id) {
        results.push({ target: "invoice", public_id: invoice.public_id, operation: null, queued: false, skipped_reason: "contact_not_synced" });
        continue;
      }
      const queued = await enqueueSync(context, repo, {
        target: "invoice",
        rowId: invoice.id,
        operation: "invoice.create",
        key: `${root}:invoice:${invoice.public_id}`,
        payload: {
          invoice_public_id: invoice.public_id,
          contact_id: detail.contact.kolaybi_contact_id,
          ...(detail.contact.kolaybi_address_id ? { address_id: detail.contact.kolaybi_address_id } : {}),
          currency: invoice.currency.toLowerCase(),
          description: invoice.description ?? `Fatura: ${invoice.invoice_number}`,
          order_date: sqlDate(invoice.issue_date),
          total_amount: invoice.grand_total,
          items: detail.items.map((item) => ({
            quantity: item.quantity,
            unit_price: item.unit_price,
            vat_rate: item.vat_rate,
            description: item.description,
          })),
        },
        accountPublicId,
      });
      results.push({ target: "invoice", public_id: invoice.public_id, operation: "invoice.create", queued: queued.queued, skipped_reason: null });
    }

    for (const payment of pending.payments) {
      if (!payment.kolaybi_invoice_id) {
        results.push({ target: "payment", public_id: payment.public_id, operation: null, queued: false, skipped_reason: "invoice_not_synced" });
        continue;
      }
      if (!payment.vault_id) {
        results.push({ target: "payment", public_id: payment.public_id, operation: null, queued: false, skipped_reason: "vault_missing" });
        continue;
      }
      const queued = await enqueueSync(context, repo, {
        target: "payment",
        rowId: payment.id,
        operation: "invoice.payment.create",
        key: `${root}:payment:${payment.public_id}`,
        payload: { payment_public_id: payment.public_id, invoice_public_id: payment.invoice_public_id, document_id: payment.kolaybi_invoice_id, vault_id: payment.vault_id, amount: payment.amount },
        accountPublicId,
      });
      results.push({ target: "payment", public_id: payment.public_id, operation: "invoice.payment.create", queued: queued.queued, skipped_reason: null });
    }

    return context.json(
      {
        provider: "kolaybi",
        live_call_permitted: readiness.live_call_permitted,
        live_gate: liveGate,
        account_public_id: accountPublicId,
        requested_count: results.length,
        queued_count: results.filter((row) => row.queued).length,
        results,
      },
      202,
    );
  });

  return routes;
}
