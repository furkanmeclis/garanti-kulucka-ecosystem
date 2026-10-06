import { Hono, type Context } from "hono";
import { z } from "zod";
import { jobEnvelopeSchema, providerDeliveryJobPayloadSchema } from "@garanti-kulucka/shared";
import type { AppBindings } from "./types.js";
import { authenticate, requireAdmin, requireDatabase } from "./middleware.js";
import {
  VapiRepository,
  serializeVapiCall,
  serializeVapiQueueItem,
  serializeVapiWebhookEvent,
  type VapiCallRecord,
} from "../voice/repository.js";
import { readVapiCallPolicy, writeVapiCallPolicy } from "../voice/policy.js";
import { isWithinCallHours, vapiCallStatuses, vapiQueueStatuses, vapiStatistics } from "../voice/vapi-rules.js";

/**
 * Legacy VAPI AI Aramalar (frontend VapiAramalarPage + server.js `/api/vapi/*`). The API owns the queue and the
 * call log; every outbound call is a `provider-delivery` job (`vapi.call.create`) and the worker keeps live calls
 * gated by `providers.vapi.live_mode` + account opt-in. Call results are read back from worker attempts, the
 * frozen `vapi` `call.webhook` ingestion and `vapi.call.get` backfill snapshots.
 */

const idempotencyKeySchema = z.string().trim().min(1).max(160);
const pageSchema = z.coerce.number().int().min(1).default(1);
const pageSizeSchema = z.coerce.number().int().min(1).max(200).default(25);
const timeSchema = z.string().regex(/^\d{2}:\d{2}$/);

const configSchema = z.object({
  enabled: z.boolean(),
  max_deneme: z.number().int().min(1).max(10),
  arama_baslangic_saati: timeSchema,
  arama_bitis_saati: timeSchema,
  tekrar_arama_saat: z.number().int().min(1).max(720),
});

const queueItemSchema = z.object({
  shipment_public_id: z.string().trim().min(1).optional(),
  customer_phone: z.string().trim().min(1).max(32),
  customer_name: z.string().trim().max(200).optional(),
  cargo_provider: z.string().trim().max(40).optional(),
  tracking_number: z.string().trim().max(120).optional(),
  last_event_text: z.string().trim().max(1000).optional(),
});

const queueAddSchema = z.object({
  items: z.array(queueItemSchema).min(1).max(500),
  idempotency_key: idempotencyKeySchema,
});

const singleCallSchema = z.object({
  queue_public_id: z.string().trim().min(1).optional(),
  shipment_public_id: z.string().trim().min(1).optional(),
  customer_phone: z.string().trim().min(1).max(32),
  customer_name: z.string().trim().max(200).optional(),
  cargo_provider: z.string().trim().max(40).optional(),
  tracking_number: z.string().trim().max(120).optional(),
  last_event_text: z.string().trim().max(1000).optional(),
  idempotency_key: idempotencyKeySchema,
});

const bulkCallSchema = z.object({ idempotency_key: idempotencyKeySchema });

function slug(value: string, max: number) {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, max);
}

function databaseUnavailable(context: Context<AppBindings>) {
  return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
}

function invalid(context: Context<AppBindings>, message: string) {
  return context.json({ error: { code: "invalid_request", message } }, 400);
}

async function readJson(context: Context<AppBindings>) {
  try {
    return (await context.req.json()) as unknown;
  } catch {
    return null;
  }
}

function statusFilter(value: string | undefined, allowed: readonly string[]) {
  if (!value || value === "tumu") return { ok: true as const, value: null };
  return allowed.includes(value) ? { ok: true as const, value } : { ok: false as const };
}

interface CallTarget {
  customerPhone: string;
  customerName: string | null;
  cargoProvider: string | null;
  trackingNumber: string | null;
  lastEventText: string | null;
}

async function queueVapiCall(context: Context<AppBindings>, callPublicId: string, target: CallTarget, idempotencyKey: string) {
  const occurredAt = new Date().toISOString();
  const requestId = `req_vapi_call_${slug(idempotencyKey, 96)}`;
  const envelope = providerDeliveryJobPayloadSchema.parse({
    envelope: {
      request_id: requestId,
      provider: "vapi",
      operation: "call.create",
      direction: "outbound",
      channel: "voice",
      occurred_at: occurredAt,
      payload: {
        call_public_id: callPublicId,
        customer_phone: target.customerPhone,
        customer_name: target.customerName ?? "",
        cargo_provider: target.cargoProvider ?? "",
        tracking_number: target.trackingNumber ?? "",
        last_event_text: target.lastEventText ?? "",
        idempotency_key: idempotencyKey,
      },
      legacy_contract: { source: "legacy-vapi-kargo-call", legacy_event: "arama-baslat" },
    },
  });
  const job = jobEnvelopeSchema.parse({
    job_id: `job_vapi_call_${slug(idempotencyKey, 80)}`,
    queue: "provider-delivery",
    name: "vapi.call.create",
    payload: envelope,
    requested_at: occurredAt,
    request_id: context.get("requestId"),
  });
  return context.get("providerDeliveryQueuePublisher").publish(job);
}

function requestIdFor(idempotencyKey: string) {
  return `req_vapi_call_${slug(idempotencyKey, 96)}`;
}

function sameTarget(row: VapiCallRecord, target: CallTarget) {
  return row.customer_phone === target.customerPhone && (row.tracking_number ?? null) === (target.trackingNumber ?? null);
}

export function createVapiRoutes() {
  const routes = new Hono<AppBindings>();
  routes.use("*", requireDatabase, authenticate, requireAdmin);

  routes.get("/config", async (context) => {
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const [policy, readiness] = await Promise.all([readVapiCallPolicy(context), new VapiRepository(db).providerReadiness()]);
    return context.json({
      config: policy,
      provider: { ...readiness, live_gate: "providers.vapi.live_mode", live_call_permitted: false },
    });
  });

  routes.put("/config", async (context) => {
    const payload = configSchema.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, "Invalid VAPI config payload");
    if (payload.data.arama_baslangic_saati > payload.data.arama_bitis_saati) return invalid(context, "Arama başlangıç saati bitiş saatinden sonra olamaz");
    await writeVapiCallPolicy(context, payload.data);
    return context.json({ config: payload.data });
  });

  routes.get("/statistics", async (context) => {
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const repo = new VapiRepository(db);
    await repo.reconcileOpenCalls();
    return context.json({ statistics: vapiStatistics(await repo.statisticsInput(new Date())) });
  });

  routes.get("/cargo-not-received", async (context) => {
    const provider = context.req.query("provider") ?? "tumu";
    const page = pageSchema.safeParse(context.req.query("page") || undefined);
    const pageSize = pageSizeSchema.safeParse(context.req.query("page_size") || undefined);
    if (!["tumu", "ptt", "surat"].includes(provider) || !page.success || !pageSize.success) return invalid(context, "Invalid cargo filter");
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const result = await new VapiRepository(db).listCargoNotReceived({
      provider: provider === "tumu" ? null : (provider as "ptt" | "surat"),
      limit: pageSize.data,
      offset: (page.data - 1) * pageSize.data,
      now: new Date(),
    });
    return context.json({
      data: result.rows.map((row) => ({
        id: row.shipment_public_id,
        shipment_public_id: row.shipment_public_id,
        takip_no: row.tracking_number,
        alici_telefon: row.recipient_phone,
        alici_ad: row.recipient_name,
        kargo_firmasi: row.provider,
        son_hareket: row.last_event_text,
        son_hareket_tarihi: row.last_event_at ? new Date(row.last_event_at).toISOString() : null,
        durum: row.status,
        olusturma_tarihi: new Date(row.created_at).toISOString(),
        kuyrukta: row.queued,
        kuyruk_durumu: row.queue_status,
        deneme_sayisi: row.attempt_count,
        son_24s_arandi: row.called_last_24h,
      })),
      total: result.total,
      page: page.data,
      page_size: pageSize.data,
    });
  });

  routes.post("/queue", async (context) => {
    const payload = queueAddSchema.safeParse(await readJson(context));
    if (!payload.success) return context.json({ error: { code: "invalid_request", message: "Kargo listesi gerekli" } }, 400);
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const policy = await readVapiCallPolicy(context);
    const result = await new VapiRepository(db).addToQueue({
      items: payload.data.items,
      maxAttempts: policy.max_deneme,
      idempotencyKey: payload.data.idempotency_key,
      actorUserId: context.get("actorUserId"),
    });
    return context.json({ eklenen: result.added, atlanan: result.skipped, replayed: result.replayed > 0 }, result.replayed === payload.data.items.length ? 200 : 201);
  });

  routes.get("/queue", async (context) => {
    const status = statusFilter(context.req.query("status"), vapiQueueStatuses);
    const page = pageSchema.safeParse(context.req.query("page") || undefined);
    const pageSize = pageSizeSchema.safeParse(context.req.query("page_size") || undefined);
    if (!status.ok || !page.success || !pageSize.success) return invalid(context, "Invalid queue filter");
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const result = await new VapiRepository(db).listQueue({ status: status.value, limit: pageSize.data, offset: (page.data - 1) * pageSize.data });
    return context.json({ data: result.rows.map(serializeVapiQueueItem), total: result.total, page: page.data, page_size: pageSize.data });
  });

  routes.delete("/queue/:queue_public_id", async (context) => {
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const deleted = await new VapiRepository(db).deleteQueueItem(context.req.param("queue_public_id"));
    if (!deleted) return context.json({ error: { code: "not_found", message: "Kuyruk kaydı bulunamadı" } }, 404);
    return context.json({ deleted: true });
  });

  // Legacy arama-baslat: one call for a queue row (or an ad-hoc number); the queue row becomes `araniyor`.
  routes.post("/calls", async (context) => {
    const payload = singleCallSchema.safeParse(await readJson(context));
    if (!payload.success) return context.json({ error: { code: "invalid_request", message: "Telefon numarası gerekli" } }, 400);
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const repo = new VapiRepository(db);
    const key = payload.data.idempotency_key;
    const target: CallTarget = {
      customerPhone: payload.data.customer_phone,
      customerName: payload.data.customer_name ?? null,
      cargoProvider: payload.data.cargo_provider ?? null,
      trackingNumber: payload.data.tracking_number ?? null,
      lastEventText: payload.data.last_event_text ?? null,
    };
    const existing = await repo.findCallByIdempotencyKey(key);
    if (existing) {
      if (!sameTarget(existing, target)) {
        return context.json({ error: { code: "idempotency_conflict", message: "Arama anahtarı farklı bir istekle yeniden kullanıldı" } }, 409);
      }
      return context.json({ call: serializeVapiCall(existing), replayed: true, live_gate: "providers.vapi.live_mode", live_call_permitted: false });
    }
    const policy = await readVapiCallPolicy(context);
    if (!policy.enabled) {
      return context.json({ error: { code: "vapi_disabled", message: "VAPI devre dışı. Ayarlardan etkinleştirin." } }, 400);
    }
    const queueItem = payload.data.queue_public_id ? await repo.getQueueItem(payload.data.queue_public_id) : null;
    if (payload.data.queue_public_id && !queueItem) {
      return context.json({ error: { code: "not_found", message: "Kuyruk kaydı bulunamadı" } }, 404);
    }
    const shipmentId = queueItem?.shipment_id ?? (await repo.findShipmentId(payload.data.shipment_public_id));
    const callPublicId = await repo.createCall({
      queueId: queueItem?.id ?? null,
      shipmentId,
      ...target,
      isTest: false,
      idempotencyKey: key,
      requestId: requestIdFor(key),
      actorUserId: context.get("actorUserId"),
    });
    const jobId = await queueVapiCall(context, callPublicId, target, key);
    await repo.markCallQueued(callPublicId, jobId);
    if (queueItem) await repo.markQueueCalling(queueItem.id, new Date());
    const call = await repo.getCall(callPublicId);
    return context.json(
      { call: call ? serializeVapiCall(call) : null, call_id: callPublicId, job_id: jobId, replayed: false, live_gate: "providers.vapi.live_mode", live_call_permitted: false },
      202,
    );
  });

  // Legacy toplu-arama: arama saatleri, max deneme → basarisiz, tekrar arama süresi, 50 bekleyen kayıt.
  routes.post("/calls/bulk", async (context) => {
    const payload = bulkCallSchema.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, "Invalid bulk call payload");
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const policy = await readVapiCallPolicy(context);
    if (!policy.enabled) return context.json({ error: { code: "vapi_disabled", message: "VAPI devre dışı" } }, 400);
    const now = new Date();
    if (!isWithinCallHours(policy, now)) {
      return context.json(
        {
          error: {
            code: "outside_call_hours",
            message: `Arama saatleri dışında. Aramalar ${policy.arama_baslangic_saati}-${policy.arama_bitis_saati} arasında yapılabilir.`,
          },
        },
        400,
      );
    }
    const repo = new VapiRepository(db);
    const queue = await repo.listWaitingQueue(50);
    if (queue.length === 0) return context.json({ mesaj: "Kuyrukta bekleyen arama yok", aranan: 0, hatali: 0, toplam_kuyruk: 0, sonuclar: [] });

    let called = 0;
    let failed = 0;
    const results: Array<Record<string, unknown>> = [];
    for (const item of queue) {
      if (item.attempt_count >= (item.max_attempts || 3)) {
        await repo.setQueueStatus(item.id, "basarisiz");
        results.push({ telefon: item.customer_phone, durum: "basarisiz", sebep: "Maksimum deneme sayısına ulaşıldı" });
        continue;
      }
      if (item.last_called_at) {
        const hours = (now.getTime() - new Date(item.last_called_at).getTime()) / (1000 * 60 * 60);
        if (hours < policy.tekrar_arama_saat) {
          results.push({ telefon: item.customer_phone, durum: "bekliyor", sebep: "Tekrar arama süresi dolmadı" });
          continue;
        }
      }
      const key = `${payload.data.idempotency_key}:${item.public_id}`;
      const target: CallTarget = {
        customerPhone: item.customer_phone,
        customerName: item.customer_name,
        cargoProvider: item.cargo_provider,
        trackingNumber: item.tracking_number,
        lastEventText: item.last_event_text,
      };
      try {
        const existing = await repo.findCallByIdempotencyKey(key);
        if (existing) {
          called += 1;
          results.push({ telefon: item.customer_phone, durum: "arandi", call_id: existing.public_id, replayed: true });
          continue;
        }
        const callPublicId = await repo.createCall({
          queueId: item.id,
          shipmentId: item.shipment_id,
          ...target,
          isTest: false,
          idempotencyKey: key,
          requestId: requestIdFor(key),
          actorUserId: context.get("actorUserId"),
        });
        const jobId = await queueVapiCall(context, callPublicId, target, key);
        await repo.markCallQueued(callPublicId, jobId);
        await repo.markQueueCalling(item.id, now);
        called += 1;
        results.push({ telefon: item.customer_phone, durum: "arandi", call_id: callPublicId });
      } catch (error) {
        failed += 1;
        results.push({ telefon: item.customer_phone, durum: "hata", hata: error instanceof Error ? error.message : "Bilinmeyen hata" });
      }
    }
    return context.json({ aranan: called, hatali: failed, toplam_kuyruk: queue.length, sonuclar: results, live_gate: "providers.vapi.live_mode" }, 202);
  });

  routes.get("/calls", async (context) => {
    const status = statusFilter(context.req.query("status"), vapiCallStatuses);
    const page = pageSchema.safeParse(context.req.query("page") || undefined);
    const pageSize = pageSizeSchema.safeParse(context.req.query("page_size") || undefined);
    if (!status.ok || !page.success || !pageSize.success) return invalid(context, "Invalid call filter");
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const repo = new VapiRepository(db);
    await repo.reconcileOpenCalls();
    const search = context.req.query("q")?.trim() || null;
    const result = await repo.listCalls({ status: status.value, search, limit: pageSize.data, offset: (page.data - 1) * pageSize.data });
    return context.json({ data: result.rows.map(serializeVapiCall), total: result.total, page: page.data, page_size: pageSize.data });
  });

  // Legacy GET /api/vapi/aramalar/:id: when the webhook was missed the detail triggers a `vapi.call.get` backfill.
  routes.get("/calls/:call_public_id", async (context) => {
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const repo = new VapiRepository(db);
    const publicId = context.req.param("call_public_id");
    await repo.reconcileOpenCalls({ publicId });
    const call = await repo.getCall(publicId);
    if (!call) return context.json({ error: { code: "not_found", message: "Arama bulunamadı" } }, 404);
    let backfillJobId: string | null = null;
    if (call.vapi_call_id && !call.is_test && (call.transcript === null || call.status === "basladi")) {
      const bucket = Math.floor(Date.now() / 60_000);
      const occurredAt = new Date().toISOString();
      const requestId = `req_vapi_call_get_${call.public_id}_${bucket}`;
      const envelope = providerDeliveryJobPayloadSchema.parse({
        envelope: {
          request_id: requestId,
          provider: "vapi",
          operation: "call.get",
          direction: "outbound",
          channel: "voice",
          occurred_at: occurredAt,
          payload: { vapi_call_id: call.vapi_call_id, call_public_id: call.public_id },
          legacy_contract: { source: "server.js GET /api/vapi/aramalar/:id", legacy_event: "call-detail-backfill" },
        },
      });
      backfillJobId = await context.get("providerDeliveryQueuePublisher").publish(
        jobEnvelopeSchema.parse({
          job_id: `job_vapi_call_get_${slug(call.public_id, 60)}_${bucket}`,
          queue: "provider-delivery",
          name: "vapi.call.get",
          payload: envelope,
          requested_at: occurredAt,
          request_id: context.get("requestId"),
        }),
      );
    }
    return context.json({ call: serializeVapiCall(call), backfill_queued: backfillJobId !== null, backfill_job_id: backfillJobId });
  });

  routes.get("/webhooks", async (context) => {
    const page = pageSchema.safeParse(context.req.query("page") || undefined);
    const pageSize = pageSizeSchema.safeParse(context.req.query("page_size") || undefined);
    if (!page.success || !pageSize.success) return invalid(context, "Invalid webhook filter");
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const callId = context.req.query("call_id")?.trim() || null;
    const result = await new VapiRepository(db).listWebhookEvents({ callId, limit: pageSize.data, offset: (page.data - 1) * pageSize.data });
    return context.json({ data: result.rows.map((row) => serializeVapiWebhookEvent(row)), total: result.total, page: page.data, page_size: pageSize.data });
  });

  routes.get("/webhooks/:event_public_id", async (context) => {
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const event = await new VapiRepository(db).getWebhookEvent(context.req.param("event_public_id"));
    if (!event) return context.json({ error: { code: "not_found", message: "Webhook kaydı bulunamadı" } }, 404);
    return context.json({ event: serializeVapiWebhookEvent(event, true) });
  });

  return routes;
}
