import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { jobEnvelopeSchema, providerDeliveryJobPayloadSchema } from "@garanti-kulucka/shared";
import type { AppBindings } from "./types.js";
import { authenticate, requireDatabase } from "./middleware.js";
import { DomainRepository } from "../domain/repository.js";
import { moneyToCents } from "../domain/order-totals.js";
import { OrderEditItemNotFoundError, OrderEditLockedError, OrderEditRepository } from "../orders/order-edit-repository.js";
import {
  OrderActionRepository,
  serializeOrderActionState,
  serializeOrderProviderStep,
  type OrderActionState,
  type OrderProviderAction,
  type OrderProviderStepRecord,
  type OrderProviderStateUpdate,
} from "../orders/action-repository.js";
import {
  confirmationStatusFromOutcome,
  firstKolaybiStep,
  kolaybiStatusForOperation,
  planNextKolaybiStep,
  type KolaybiStepOutcome,
  type KolaybiWorkflowDecision,
  type KolaybiWorkflowOperation,
} from "../orders/kolaybi-workflow.js";

/**
 * Legacy SiparislerPage order actions (status, cancel/return, restore, delete, notes, teyit, KolayBi)
 * and their server.js provider routes. Provider work never runs in the API: each atomic KolayBi/NetGSM
 * operation is a `provider-delivery` job, live calls stay gated by `providers.<provider>.live_mode` plus
 * the account opt-in in the worker, and `POST /:id/provider-sync` advances the KolayBi cari workflow from
 * the worker-written provider attempts.
 */

const idempotencyKeySchema = z.string().trim().min(1).max(160);
const keyBody = z.object({ idempotency_key: idempotencyKeySchema });
const eDocumentSchema = z.object({ action: z.enum(["create", "cancel"]), idempotency_key: idempotencyKeySchema });
const cancelSchema = z.object({ status: z.enum(["cancelled", "returned"]), reason: z.string().trim().max(500).nullable().optional(), idempotency_key: idempotencyKeySchema });
const notesSchema = z.object({ notes: z.string().max(10_000).nullable() });
const moneySchema = z.string().trim().regex(/^\d+(\.\d{1,2})?$/);
const editOrderSchema = z.object({
  customer: z.object({ full_name: z.string().trim().min(1).max(200), phone: z.string().trim().min(1).max(32) }),
  address: z.object({ address_line: z.string().trim().min(1).max(1000), city: z.string().trim().min(1).max(100), district: z.string().trim().min(1).max(100) }),
  notes: z.string().max(10_000).nullable(),
  cargo_provider: z.enum(["ptt", "surat"]).nullable(),
  items: z
    .array(
      z.object({
        public_id: z.string().trim().min(1).nullable().optional(),
        product_public_id: z.string().trim().min(1).nullable().optional(),
        name: z.string().trim().min(1).max(300),
        quantity: z.number().int().min(1).max(10_000),
        unit_price: moneySchema,
      }),
    )
    .min(1)
    .max(100),
  total_amount: moneySchema.nullable().optional(),
});
const manualConfirmationSchema = z.object({ confirmation_status: z.enum(["teyit_edildi", "ulasilamadi", "bekliyor"]) });
const bulkSchema = z.object({ order_public_ids: z.array(z.string().trim().min(1)).min(1).max(200), idempotency_key: idempotencyKeySchema });

const openKolaybiStatuses = new Set(["contact_lookup", "contact_create", "invoice_create"]);
const confirmedStatuses = new Set(["draft", "created", "olusturuldu", "pending_confirmation", "teyit_bekliyor"]);

function canUseOrderActions(role: string | undefined) {
  return role === "admin" || role === "owner" || role === "calisan" || role === "kargo_operatoru";
}

function slug(value: string, max: number) {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, max);
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
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

async function readJson(context: Context<AppBindings>) {
  try {
    return (await context.req.json()) as unknown;
  } catch {
    return null;
  }
}

function invalid(context: Context<AppBindings>, message: string) {
  return context.json({ error: { code: "invalid_request", message } }, 400);
}

function notFound(context: Context<AppBindings>) {
  return context.json({ error: { code: "not_found", message: "Sipariş bulunamadı" } }, 404);
}

function conflict(context: Context<AppBindings>, code: string, message: string) {
  return context.json({ error: { code, message } }, 409);
}

interface EnqueueInput {
  order: OrderActionState;
  action: OrderProviderAction;
  provider: "kolaybi" | "netgsm";
  operation: KolaybiWorkflowOperation | "invoice.e_document.create" | "invoice.e_document.cancel" | "invoice.get" | "call.confirmation.create" | "call.confirmation.status";
  attempt: number;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  legacyEvent: string;
}

async function enqueueStep(context: Context<AppBindings>, repo: OrderActionRepository, input: EnqueueInput) {
  const existing = await repo.findStepByIdempotencyKey(input.idempotencyKey);
  if (existing) {
    if (existing.operation !== input.operation) {
      return { step: null, replayed: false, conflict: true } as const;
    }
    return { step: existing, replayed: true, conflict: false } as const;
  }
  const occurredAt = new Date().toISOString();
  const suffix = `${slug(input.idempotencyKey, 60)}_${shortHash(input.idempotencyKey)}`;
  const requestId = `req_order_${suffix}`;
  const envelopePayload = { ...input.payload, idempotency_key: input.idempotencyKey };
  const providerPayload = providerDeliveryJobPayloadSchema.parse({
    envelope: {
      request_id: requestId,
      provider: input.provider,
      operation: input.operation,
      direction: "outbound",
      channel: input.provider === "kolaybi" ? "accounting" : "voice",
      occurred_at: occurredAt,
      payload: envelopePayload,
      legacy_contract: { source: "legacy-siparisler-page", legacy_event: input.legacyEvent },
    },
  });
  const job = jobEnvelopeSchema.parse({
    job_id: `job_order_${suffix}`,
    queue: "provider-delivery",
    name: `${input.provider}.${input.operation}`,
    payload: providerPayload,
    requested_at: occurredAt,
    request_id: context.get("requestId"),
  });
  const jobId = await context.get("providerDeliveryQueuePublisher").publish(job);
  const step = await repo.insertStep({
    orderId: input.order.id,
    action: input.action,
    provider: input.provider,
    operation: input.operation,
    attempt: input.attempt,
    idempotencyKey: input.idempotencyKey,
    requestId,
    jobId,
    queued: jobId !== null,
    requestPayload: input.payload,
    actorUserId: context.get("actorUserId"),
  });
  return { step, replayed: false, conflict: false } as const;
}

function providerResponse(step: OrderProviderStepRecord, replayed: boolean, extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    provider: step.provider,
    operation: step.operation,
    replayed,
    live_call_permitted: false,
    live_gate: `providers.${step.provider}.live_mode`,
    step: serializeOrderProviderStep(step),
  };
}

/** Reads the worker attempt for a queued step; `null` while the job has not produced a usable outcome. */
async function stepOutcome(repo: OrderActionRepository, step: OrderProviderStepRecord): Promise<KolaybiStepOutcome | null> {
  const attempt = await repo.latestAttempt(step.request_id);
  if (!attempt) return null;
  if (attempt.status === "terminal_failure") {
    return { status: "failed", error: attempt.error_message ?? "Sağlayıcı işlemi başarısız" };
  }
  if (attempt.status !== "success") return null;
  const metadata = parseJsonObject(attempt.response_metadata);
  // Dry-run / fixture attempts carry no provider result; the step stays queued until a live call runs.
  if (!isRecord(metadata.result)) return null;
  return { status: "succeeded", result: metadata.result };
}

async function applyKolaybiDecision(
  context: Context<AppBindings>,
  repo: OrderActionRepository,
  order: OrderActionState,
  step: OrderProviderStepRecord,
  decision: KolaybiWorkflowDecision,
) {
  if (decision.kind === "enqueue") {
    const update: OrderProviderStateUpdate = { kolaybi_status: decision.orderStatus, kolaybi_error: null };
    if (decision.operation === "invoice.create") {
      update.kolaybi_contact_id = String(decision.payload.contact_id);
      update.kolaybi_address_id = typeof decision.payload.address_id === "string" ? decision.payload.address_id : null;
    }
    await repo.updateOrderProviderState(order.id, update);
    const rootKey = step.idempotency_key.split(">")[0] as string;
    await enqueueStep(context, repo, {
      order,
      action: "kolaybi_transfer",
      provider: "kolaybi",
      operation: decision.operation,
      attempt: decision.attempt,
      payload: decision.payload,
      idempotencyKey: `${rootKey}>${decision.operation}#${decision.attempt}`,
      legacyEvent: "kolaybi_cari_olustur",
    });
    return;
  }
  if (decision.kind === "completed") {
    await repo.updateOrderProviderState(order.id, {
      kolaybi_contact_id: decision.contactId,
      kolaybi_address_id: decision.addressId,
      kolaybi_invoice_id: decision.invoiceId,
      kolaybi_status: "completed",
      kolaybi_error: null,
      // Legacy: a successful transfer moves olusturuldu / teyit_bekliyor to teyit_edildi.
      ...(confirmedStatuses.has(order.status) ? { status: "confirmed" } : {}),
    });
    return;
  }
  await repo.updateOrderProviderState(order.id, {
    kolaybi_status: "failed",
    kolaybi_error: decision.error,
    ...(decision.contactId ? { kolaybi_contact_id: decision.contactId, kolaybi_address_id: decision.addressId ?? null } : {}),
  });
}

/** Advances every queued provider step of an order from its worker attempt. */
export async function syncOrderProviderSteps(context: Context<AppBindings>, repo: OrderActionRepository, order: OrderActionState) {
  const queued = await repo.listQueuedSteps(order.id);
  let advanced = 0;
  for (const step of queued) {
    const outcome = await stepOutcome(repo, step);
    if (!outcome) continue;
    advanced += 1;
    await repo.completeStep(step.id, {
      status: outcome.status,
      result: outcome.status === "succeeded" ? outcome.result : null,
      errorMessage: outcome.status === "failed" ? outcome.error : null,
    });
    const current = (await repo.getOrderState(order.public_id, { includeDeleted: true })) ?? order;
    if (step.action === "kolaybi_transfer") {
      const workflowOrder = await repo.getWorkflowOrder(current);
      const decision = planNextKolaybiStep(workflowOrder, {
        operation: step.operation as KolaybiWorkflowOperation,
        attempt: step.attempt,
        requestPayload: parseJsonObject(step.request_payload),
        outcome,
      });
      await applyKolaybiDecision(context, repo, current, step, decision);
    } else if (step.action === "e_document_create") {
      await repo.updateOrderProviderState(order.id, { e_document_status: outcome.status === "succeeded" ? "sent" : "failed" });
    } else if (step.action === "e_document_cancel") {
      await repo.updateOrderProviderState(
        order.id,
        outcome.status === "succeeded" ? { e_document_status: "cancelled", kolaybi_status: "cancelled" } : { e_document_status: "failed" },
      );
    } else if (step.action === "confirmation_call") {
      if (outcome.status === "succeeded") {
        const bulkId = outcome.result.bulkId ?? outcome.result.bulk_id;
        await repo.updateOrderProviderState(order.id, {
          confirmation_call_status: "araniyor",
          confirmation_call_bulk_id: typeof bulkId === "string" || typeof bulkId === "number" ? String(bulkId) : null,
          confirmation_pressed_key: null,
        });
      } else {
        await repo.updateOrderProviderState(order.id, { confirmation_call_status: null });
      }
    } else if (step.action === "confirmation_status" && outcome.status === "succeeded") {
      const result = outcome.result;
      const confirmation = confirmationStatusFromOutcome(result.confirmation_outcome);
      await repo.updateOrderProviderState(order.id, {
        ...(typeof result.call_status === "string" ? { confirmation_call_status: result.call_status } : {}),
        confirmation_pressed_key: typeof result.pressed_key === "string" ? result.pressed_key : null,
        ...(typeof result.listen_seconds === "number" ? { confirmation_listen_seconds: result.listen_seconds } : {}),
        ...(confirmation ? { confirmation_status: confirmation } : {}),
      });
    }
  }
  return advanced;
}

async function startKolaybiTransfer(context: Context<AppBindings>, repo: OrderActionRepository, order: OrderActionState, key: string) {
  const replay = await repo.findStepByIdempotencyKey(key);
  if (replay) return { ok: true as const, step: replay, replayed: true };
  if (order.kolaybi_invoice_id) {
    return { ok: false as const, code: "already_transferred", message: "Bu sipariş zaten KolayBi'ye aktarılmış. Kargoya aktarmak için 'Kargoya Aktar' butonunu kullanın." };
  }
  if (order.kolaybi_status && openKolaybiStatuses.has(order.kolaybi_status)) {
    return { ok: false as const, code: "transfer_in_progress", message: "Aktarılıyor..." };
  }
  const workflowOrder = await repo.getWorkflowOrder(order);
  const decision = firstKolaybiStep(workflowOrder, { contactId: order.kolaybi_contact_id, addressId: order.kolaybi_address_id });
  if (decision.kind !== "enqueue") return { ok: false as const, code: "invalid_state", message: "Aktarım başarısız" };
  const result = await enqueueStep(context, repo, {
    order,
    action: "kolaybi_transfer",
    provider: "kolaybi",
    operation: decision.operation,
    attempt: decision.attempt,
    payload: decision.payload,
    idempotencyKey: key,
    legacyEvent: "kolaybi_cari_olustur",
  });
  if (result.conflict || !result.step) return { ok: false as const, code: "idempotency_conflict", message: "Idempotency key was reused for another operation" };
  await repo.updateOrderProviderState(order.id, { kolaybi_status: kolaybiStatusForOperation(decision.operation), kolaybi_error: null });
  return { ok: true as const, step: result.step, replayed: result.replayed };
}

async function startConfirmationCall(context: Context<AppBindings>, repo: OrderActionRepository, order: OrderActionState, key: string) {
  const replay = await repo.findStepByIdempotencyKey(key);
  if (replay) return { ok: true as const, step: replay, replayed: true };
  if (!order.customer_phone) return { ok: false as const, code: "missing_phone", message: "Telefon numarası bulunamadı" };
  if (!(await repo.hasIncubatorItem(order.id))) {
    return { ok: false as const, code: "no_machine", message: "Siparişte kuluçka makinesi yok, teyit araması yapılmadı" };
  }
  const result = await enqueueStep(context, repo, {
    order,
    action: "confirmation_call",
    provider: "netgsm",
    operation: "call.confirmation.create",
    attempt: 0,
    payload: { order_public_id: order.public_id, telefon: order.customer_phone, musteri_adi: order.customer_full_name ?? "" },
    idempotencyKey: key,
    legacyEvent: "netgsm_siparis_arama",
  });
  if (result.conflict || !result.step) return { ok: false as const, code: "idempotency_conflict", message: "Idempotency key was reused for another operation" };
  if (!result.replayed) {
    await repo.updateOrderProviderState(order.id, { confirmation_call_count: order.confirmation_call_count + 1, confirmation_pressed_key: null });
  }
  return { ok: true as const, step: result.step, replayed: result.replayed };
}

async function enqueueEDocumentCancel(context: Context<AppBindings>, repo: OrderActionRepository, order: OrderActionState, key: string) {
  if (!order.kolaybi_invoice_id) return null;
  const result = await enqueueStep(context, repo, {
    order,
    action: "e_document_cancel",
    provider: "kolaybi",
    operation: "invoice.e_document.cancel",
    attempt: 0,
    payload: { order_public_id: order.public_id, invoice_id: order.kolaybi_invoice_id },
    idempotencyKey: key,
    legacyEvent: "kolaybi_e_fatura_iptal",
  });
  if (result.step && !result.replayed) await repo.updateOrderProviderState(order.id, { e_document_status: "cancel_queued" });
  return result.step;
}

export function createOrderActionRoutes() {
  const routes = new Hono<AppBindings>();

  routes.use("*", requireDatabase, authenticate);
  routes.use("*", async (context, next) => {
    if (!canUseOrderActions(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Order access is not allowed" } }, 403);
    }
    return next();
  });

  const repoFor = (context: Context<AppBindings>) => new OrderActionRepository(context.get("db") as NonNullable<AppBindings["Variables"]["db"]>);

  routes.post("/bulk/confirmation-calls", async (context) => {
    const payload = bulkSchema.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, "Invalid bulk confirmation payload");
    const repo = repoFor(context);
    const results = [];
    for (const publicId of payload.data.order_public_ids) {
      const order = await repo.getOrderState(publicId);
      if (!order) {
        results.push({ order_public_id: publicId, queued: false, skipped_reason: "not_found" });
        continue;
      }
      if (order.confirmation_status === "teyit_edildi") {
        results.push({ order_public_id: publicId, queued: false, skipped_reason: "already_confirmed" });
        continue;
      }
      const started = await startConfirmationCall(context, repo, order, `${payload.data.idempotency_key}:${publicId}`);
      results.push(started.ok
        ? { order_public_id: publicId, queued: started.step.queued, replayed: started.replayed, skipped_reason: null }
        : { order_public_id: publicId, queued: false, skipped_reason: started.code });
    }
    return context.json({
      provider: "netgsm",
      operation: "call.confirmation.create",
      requested_count: results.length,
      queued_count: results.filter((row) => row.queued).length,
      live_call_permitted: false,
      live_gate: "providers.netgsm.live_mode",
      results,
    }, 202);
  });

  routes.post("/bulk/kolaybi-transfer", async (context) => {
    const payload = bulkSchema.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, "Invalid bulk KolayBi payload");
    const repo = repoFor(context);
    const results = [];
    for (const publicId of payload.data.order_public_ids) {
      const order = await repo.getOrderState(publicId);
      if (!order) {
        results.push({ order_public_id: publicId, queued: false, skipped_reason: "not_found" });
        continue;
      }
      const started = await startKolaybiTransfer(context, repo, order, `${payload.data.idempotency_key}:${publicId}`);
      results.push(started.ok
        ? { order_public_id: publicId, queued: started.step.queued, replayed: started.replayed, skipped_reason: null }
        : { order_public_id: publicId, queued: false, skipped_reason: started.code });
    }
    return context.json({
      provider: "kolaybi",
      operation: "contact.find",
      requested_count: results.length,
      queued_count: results.filter((row) => row.queued).length,
      live_call_permitted: false,
      live_gate: "providers.kolaybi.live_mode",
      results,
    }, 202);
  });

  routes.get("/:order_public_id/actions", async (context) => {
    const repo = repoFor(context);
    const order = await repo.getOrderState(context.req.param("order_public_id"));
    if (!order) return notFound(context);
    const steps = await repo.listSteps(order.id);
    return context.json({ order: serializeOrderActionState(order), steps: steps.map(serializeOrderProviderStep) });
  });

  routes.post("/:order_public_id/provider-sync", async (context) => {
    const repo = repoFor(context);
    const order = await repo.getOrderState(context.req.param("order_public_id"), { includeDeleted: true });
    if (!order) return notFound(context);
    const advanced = await syncOrderProviderSteps(context, repo, order);
    const refreshed = (await repo.getOrderState(order.public_id, { includeDeleted: true })) ?? order;
    const steps = await repo.listSteps(order.id);
    return context.json({ advanced_count: advanced, order: serializeOrderActionState(refreshed), steps: steps.map(serializeOrderProviderStep) });
  });

  routes.patch("/:order_public_id/notes", async (context) => {
    const payload = notesSchema.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, "Invalid notes payload");
    const repo = repoFor(context);
    const order = await repo.getOrderState(context.req.param("order_public_id"));
    if (!order) return notFound(context);
    await repo.updateNotes(order.id, payload.data.notes?.trim() ? payload.data.notes : null);
    const refreshed = (await repo.getOrderState(order.public_id)) ?? order;
    return context.json({ order: serializeOrderActionState(refreshed) });
  });

  routes.patch("/:order_public_id/confirmation", async (context) => {
    const payload = manualConfirmationSchema.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, "Invalid confirmation payload");
    const repo = repoFor(context);
    const order = await repo.getOrderState(context.req.param("order_public_id"));
    if (!order) return notFound(context);
    const value = payload.data.confirmation_status === "bekliyor" ? null : payload.data.confirmation_status;
    await repo.updateOrderProviderState(order.id, { confirmation_status: value });
    const refreshed = (await repo.getOrderState(order.public_id)) ?? order;
    return context.json({ order: serializeOrderActionState(refreshed) });
  });

  routes.post("/:order_public_id/cancel", async (context) => {
    const payload = cancelSchema.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, "Invalid cancel payload");
    const repo = repoFor(context);
    const order = await repo.getOrderState(context.req.param("order_public_id"));
    if (!order) return notFound(context);
    if (order.status === payload.data.status) {
      return context.json({ replayed: true, order: serializeOrderActionState(order), e_document_cancel: null });
    }
    if (["cancelled", "returned", "delivered"].includes(order.status) && payload.data.status === "cancelled") {
      return conflict(context, "invalid_status", "İptal yapılamadı");
    }
    // Legacy: an invoiced order first cancels the KolayBi e-document, the order is cancelled regardless.
    const eDocumentStep = await enqueueEDocumentCancel(context, repo, order, `${payload.data.idempotency_key}:e_document_cancel`);
    await new DomainRepository(context.get("db") as NonNullable<AppBindings["Variables"]["db"]>).updateOrderStatus({
      orderPublicId: order.public_id,
      status: payload.data.status,
      ...(payload.data.reason ? { notes: order.notes ? `${order.notes}\n${payload.data.reason}` : payload.data.reason } : {}),
      actorRole: context.get("auth")?.role ?? null,
      actorUserId: context.get("actorUserId"),
    });
    const refreshed = (await repo.getOrderState(order.public_id)) ?? order;
    return context.json({
      replayed: false,
      order: serializeOrderActionState(refreshed),
      e_document_cancel: eDocumentStep ? serializeOrderProviderStep(eDocumentStep) : null,
    });
  });

  routes.post("/:order_public_id/restore", async (context) => {
    const repo = repoFor(context);
    const order = await repo.getOrderState(context.req.param("order_public_id"));
    if (!order) return notFound(context);
    if (!["cancelled", "returned"].includes(order.status)) {
      return conflict(context, "invalid_status", "Geri alma yapılamadı");
    }
    // Legacy siparis_geri_al: back to "Oluşturuldu"; the balance trigger credits a rollback.
    await new DomainRepository(context.get("db") as NonNullable<AppBindings["Variables"]["db"]>).updateOrderStatus({
      orderPublicId: order.public_id,
      status: "draft",
      actorRole: context.get("auth")?.role ?? null,
      actorUserId: context.get("actorUserId"),
    });
    const refreshed = (await repo.getOrderState(order.public_id)) ?? order;
    return context.json({ order: serializeOrderActionState(refreshed) });
  });

  // Legacy SiparislerPage "Düzenle" modal: read the editable snapshot, then save customer/address/items/total.
  routes.get("/:order_public_id/edit", async (context) => {
    const order = await new OrderEditRepository(context.get("db")!).get(context.req.param("order_public_id"));
    if (!order) return notFound(context);
    return context.json({ order });
  });

  routes.patch("/:order_public_id", async (context) => {
    const payload = editOrderSchema.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, "Invalid order edit payload");
    const data = payload.data;
    const total = data.total_amount ?? null;
    if (total !== null && moneyToCents(total) <= 0) {
      return context.json({ error: { code: "invalid_order_total", message: "Sipariş tutarı 0 TL olamaz. Lütfen fiyat bilgisini kontrol edin." } }, 400);
    }
    const itemsCents = data.items.reduce((sum, item) => sum + moneyToCents(item.unit_price) * item.quantity, 0);
    if (total === null && itemsCents <= 0) {
      return context.json({ error: { code: "invalid_order_total", message: "Sipariş tutarı 0 TL olamaz. Lütfen fiyat bilgisini kontrol edin." } }, 400);
    }
    try {
      const order = await new OrderEditRepository(context.get("db")!).update(context.req.param("order_public_id"), {
        customer: { fullName: data.customer.full_name, phone: data.customer.phone },
        address: { addressLine: data.address.address_line, city: data.address.city, district: data.address.district },
        notes: data.notes?.trim() ? data.notes.trim() : null,
        cargoProvider: data.cargo_provider,
        items: data.items.map((item) => ({ publicId: item.public_id ?? null, productPublicId: item.product_public_id ?? null, name: item.name, quantity: item.quantity, unitPrice: item.unit_price })),
        totalAmount: total,
        actorUserId: context.get("actorUserId"),
      });
      if (!order) return notFound(context);
      return context.json({ order });
    } catch (error) {
      if (error instanceof OrderEditLockedError) {
        const message =
          error.reason === "kolaybi" ? "Bu sipariş KolayBi'ye aktarılmış, düzenlenemez." : error.reason === "deleted" ? "Silinmiş sipariş düzenlenemez." : "İptal edilmiş sipariş düzenlenemez.";
        return context.json({ error: { code: "order_locked", message, reason: error.reason } }, 409);
      }
      if (error instanceof OrderEditItemNotFoundError) return invalid(context, "Sipariş kalemi bulunamadı");
      throw error;
    }
  });

  routes.delete("/:order_public_id", async (context) => {
    const body = await readJson(context);
    const parsedKey = isRecord(body) ? idempotencyKeySchema.safeParse(body.idempotency_key) : null;
    const repo = repoFor(context);
    const order = await repo.getOrderState(context.req.param("order_public_id"), { includeDeleted: true });
    if (!order) return notFound(context);
    if (order.deleted_at) {
      return context.json({ deleted: true, replayed: true, commission_preserved: true, order: serializeOrderActionState(order), e_document_cancel: null });
    }
    const key = parsedKey?.success ? parsedKey.data : `delete:${order.public_id}`;
    const eDocumentStep = order.kolaybi_invoice_id ? await enqueueEDocumentCancel(context, repo, order, `${key}:e_document_cancel`) : null;
    const result = await repo.softDeleteOrder({
      orderId: order.id,
      actorRole: context.get("auth")?.role ?? null,
      actorUserId: context.get("actorUserId"),
    });
    const refreshed = (await repo.getOrderState(order.public_id, { includeDeleted: true })) ?? order;
    return context.json({
      deleted: true,
      replayed: !result.deleted,
      commission_preserved: result.commissionPreserved,
      order: serializeOrderActionState(refreshed),
      e_document_cancel: eDocumentStep ? serializeOrderProviderStep(eDocumentStep) : null,
    });
  });

  routes.post("/:order_public_id/kolaybi/transfer", async (context) => {
    const payload = keyBody.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, "Invalid KolayBi transfer payload");
    const repo = repoFor(context);
    const order = await repo.getOrderState(context.req.param("order_public_id"));
    if (!order) return notFound(context);
    const started = await startKolaybiTransfer(context, repo, order, payload.data.idempotency_key);
    if (!started.ok) return conflict(context, started.code, started.message);
    return context.json(providerResponse(started.step, started.replayed, { workflow: "kolaybi_cari_invoice" }), 202);
  });

  routes.post("/:order_public_id/kolaybi/e-document", async (context) => {
    const payload = eDocumentSchema.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, "Invalid e-document payload");
    const repo = repoFor(context);
    const order = await repo.getOrderState(context.req.param("order_public_id"));
    if (!order) return notFound(context);
    if (!order.kolaybi_invoice_id) return conflict(context, "not_transferred", "Önce KolayBi'ye aktarılmalı");
    if (payload.data.action === "cancel") {
      const replayed = (await repo.findStepByIdempotencyKey(payload.data.idempotency_key)) !== null;
      const step = await enqueueEDocumentCancel(context, repo, order, payload.data.idempotency_key);
      if (!step) return conflict(context, "not_transferred", "Önce KolayBi'ye aktarılmalı");
      return context.json(providerResponse(step, replayed), 202);
    }
    const result = await enqueueStep(context, repo, {
      order,
      action: "e_document_create",
      provider: "kolaybi",
      operation: "invoice.e_document.create",
      attempt: 0,
      payload: { order_public_id: order.public_id, invoice_id: order.kolaybi_invoice_id, send_type: "ELEKTRONIK" },
      idempotencyKey: payload.data.idempotency_key,
      legacyEvent: "kolaybi_e_fatura_olustur",
    });
    if (result.conflict || !result.step) return conflict(context, "idempotency_conflict", "Idempotency key was reused for another operation");
    if (!result.replayed) await repo.updateOrderProviderState(order.id, { e_document_status: "queued" });
    return context.json(providerResponse(result.step, result.replayed), 202);
  });

  routes.post("/:order_public_id/kolaybi/invoice", async (context) => {
    const payload = keyBody.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, "Invalid invoice payload");
    const repo = repoFor(context);
    const order = await repo.getOrderState(context.req.param("order_public_id"));
    if (!order) return notFound(context);
    if (!order.kolaybi_invoice_id) return conflict(context, "not_transferred", "Bu siparişin henüz KolayBi faturası yok. Önce 'KB1' ile aktarın.");
    const result = await enqueueStep(context, repo, {
      order,
      action: "invoice_get",
      provider: "kolaybi",
      operation: "invoice.get",
      attempt: 0,
      payload: { order_public_id: order.public_id, invoice_id: order.kolaybi_invoice_id },
      idempotencyKey: payload.data.idempotency_key,
      legacyEvent: "kolaybi_e_fatura_durum",
    });
    if (result.conflict || !result.step) return conflict(context, "idempotency_conflict", "Idempotency key was reused for another operation");
    return context.json(providerResponse(result.step, result.replayed, { invoice_id: order.kolaybi_invoice_id }), 202);
  });

  routes.post("/:order_public_id/confirmation-call", async (context) => {
    const payload = keyBody.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, "Invalid confirmation call payload");
    const repo = repoFor(context);
    const order = await repo.getOrderState(context.req.param("order_public_id"));
    if (!order) return notFound(context);
    const started = await startConfirmationCall(context, repo, order, payload.data.idempotency_key);
    if (!started.ok) return conflict(context, started.code, started.message);
    return context.json(providerResponse(started.step, started.replayed), 202);
  });

  routes.post("/:order_public_id/confirmation-call/status", async (context) => {
    const payload = keyBody.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, "Invalid confirmation status payload");
    const repo = repoFor(context);
    const order = await repo.getOrderState(context.req.param("order_public_id"));
    if (!order) return notFound(context);
    if (!order.confirmation_call_bulk_id) return conflict(context, "no_call", "Henüz sonuç yok");
    const result = await enqueueStep(context, repo, {
      order,
      action: "confirmation_status",
      provider: "netgsm",
      operation: "call.confirmation.status",
      attempt: 0,
      payload: { order_public_id: order.public_id, bulk_id: order.confirmation_call_bulk_id },
      idempotencyKey: payload.data.idempotency_key,
      legacyEvent: "netgsm_siparis_arama_durum",
    });
    if (result.conflict || !result.step) return conflict(context, "idempotency_conflict", "Idempotency key was reused for another operation");
    return context.json(providerResponse(result.step, result.replayed), 202);
  });

  return routes;
}
