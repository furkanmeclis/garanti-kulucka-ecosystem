import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  cargoPipelineActions,
  cargoPipelineSettingKey,
  cargoPipelineSettingScope,
  cargoPipelineStatuses,
  cargoPipelineSteps,
  fillCargoPipelineTemplate,
  jobEnvelopeSchema,
  normalizeCargoPipelineConfig,
  planOutboundDelivery,
  providerDeliveryJobPayloadSchema,
} from "@garanti-kulucka/shared";
import type { AppBindings } from "./types.js";
import { authenticate, requireDatabase } from "./middleware.js";
import { CargoPipelineRepository, serializeCargoPipelineItem } from "../cargo/pipeline-repository.js";
import { DomainRepository } from "../domain/repository.js";
import { SmsRepository } from "../sms/repository.js";
import { VapiRepository } from "../voice/repository.js";
import { readSetting, readVapiCallPolicy, writeSetting } from "../voice/policy.js";
import { queueVapiCall, requestIdFor } from "./vapi-routes.js";

/**
 * Legacy KargoPipelinePage + KargoPipelineAyarlar + KargoPipelineTestPaneli (server.js `/api/kargo-pipeline*`).
 * The worker engine (`apps/worker/src/cargo-pipeline.ts`) walks the rows; these routes list them, apply the
 * legacy row actions, edit the global `kargo_pipeline_ayarlar` setting and send test SMS / channel message / VAPI calls
 * through the provider-delivery queue (live gates still apply).
 */

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const delaySchema = z.number().int().min(0).max(1440);

const configSchema = z.object({
  aktif: z.boolean(),
  baslangic_saati: timeSchema,
  bitis_saati: timeSchema,
  mesaj_gecikme_dk: delaySchema,
  sms_gecikme_dk: delaySchema,
  vapi_gecikme_dk: delaySchema,
  max_deneme: z.number().int().min(1).max(10),
  mesaj_sablonu: z.string().trim().min(1).max(2000),
});

const actionSchema = z.object({ action: z.enum(cargoPipelineActions) });

const testSchema = z.object({
  type: z.enum(["sms", "mesaj", "vapi"]),
  phone: z.string().trim().min(1).max(32),
  customer_name: z.string().trim().max(200).optional(),
  tracking_number: z.string().trim().max(120).optional(),
  last_event_text: z.string().trim().max(500).optional(),
  cargo_provider: z.string().trim().max(40).optional(),
  conversation_public_id: z.string().trim().min(1).optional(),
  idempotency_key: z.string().trim().min(1).max(160),
});

const pageSchema = z.coerce.number().int().min(1).default(1);
const pageSizeSchema = z.coerce.number().int().min(1).max(200).default(50);

function isManager(role: string | undefined) {
  return role === "admin" || role === "owner";
}

function canReadPipeline(role: string | undefined) {
  return isManager(role) || role === "calisan" || role === "kargo_operatoru";
}

function forbidden(context: Context<AppBindings>) {
  return context.json({ error: { code: "forbidden", message: "Kargo pipeline yönetimi yalnızca yöneticiye açık" } }, 403);
}

function invalid(context: Context<AppBindings>, message: string) {
  return context.json({ error: { code: "invalid_request", message } }, 400);
}

function databaseUnavailable(context: Context<AppBindings>) {
  return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
}

async function readJson(context: Context<AppBindings>) {
  try {
    return (await context.req.json()) as unknown;
  } catch {
    return null;
  }
}

function slug(value: string, max: number) {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, max);
}

function filterValue(value: string | undefined, allowed: readonly string[]) {
  if (!value || value === "tumu") return { ok: true as const, value: null };
  return allowed.includes(value) ? { ok: true as const, value } : { ok: false as const };
}

export function createCargoPipelineRoutes() {
  const routes = new Hono<AppBindings>();
  routes.use("*", requireDatabase, authenticate);

  routes.get("/", async (context) => {
    if (!canReadPipeline(context.get("auth")?.role)) return context.json({ error: { code: "forbidden", message: "Kargo pipeline erişimi yok" } }, 403);
    const status = filterValue(context.req.query("status"), cargoPipelineStatuses);
    const step = filterValue(context.req.query("step"), cargoPipelineSteps);
    const page = pageSchema.safeParse(context.req.query("page") || undefined);
    const pageSize = pageSizeSchema.safeParse(context.req.query("page_size") || undefined);
    if (!status.ok || !step.ok || !page.success || !pageSize.success) return invalid(context, "Invalid cargo pipeline filter");
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    // VAPI results reach vapi_calls through this reconciliation; the worker engine then advances the row.
    await new VapiRepository(db).reconcileOpenCalls().catch(() => undefined);
    const { rows, total } = await new CargoPipelineRepository(db).list({ status: status.value, step: step.value, page: page.data, pageSize: pageSize.data });
    return context.json({ data: rows.map(serializeCargoPipelineItem), total, page: page.data, page_size: pageSize.data });
  });

  routes.get("/config", async (context) => {
    if (!isManager(context.get("auth")?.role)) return forbidden(context);
    return context.json({ config: normalizeCargoPipelineConfig(await readSetting(context, cargoPipelineSettingScope, cargoPipelineSettingKey)) });
  });

  routes.put("/config", async (context) => {
    if (!isManager(context.get("auth")?.role)) return forbidden(context);
    const payload = configSchema.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, "Invalid cargo pipeline config payload");
    if (payload.data.baslangic_saati >= payload.data.bitis_saati) return invalid(context, "Başlangıç saati bitiş saatinden önce olmalı");
    await writeSetting(context, cargoPipelineSettingScope, cargoPipelineSettingKey, payload.data);
    return context.json({ config: payload.data });
  });

  routes.post("/test", async (context) => {
    if (!isManager(context.get("auth")?.role)) return forbidden(context);
    const payload = testSchema.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, "Telefon numarası ve test tipi gerekli");
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const data = payload.data;
    const config = normalizeCargoPipelineConfig(await readSetting(context, cargoPipelineSettingScope, cargoPipelineSettingKey));
    const target = {
      customerName: data.customer_name || "Test Müşteri",
      trackingNumber: data.tracking_number || "TEST-000",
      lastEventText: data.last_event_text || "şubede bekliyor",
      cargoProvider: data.cargo_provider || "PTT",
    };
    const message = fillCargoPipelineTemplate(config.mesaj_sablonu, target);
    const phone = data.phone.replace(/\D/g, "");
    const key = `cargo_pipeline_test_${slug(data.idempotency_key, 100)}`;

    if (data.type === "sms") {
      if (phone.length < 10) return invalid(context, "Geçerli telefon numarası bulunamadı");
      const occurredAt = new Date().toISOString();
      const requestId = `req_${slug(key, 80)}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
      const job = jobEnvelopeSchema.parse({
        job_id: `job_${slug(key, 100)}`,
        queue: "provider-delivery",
        name: "netgsm.sms.send",
        payload: providerDeliveryJobPayloadSchema.parse({
          envelope: {
            request_id: requestId,
            provider: "netgsm",
            operation: "sms.send",
            direction: "outbound",
            channel: "sms",
            occurred_at: occurredAt,
            payload: { recipient_phone: phone, message, idempotency_key: key },
            legacy_contract: { source: "server.js POST /api/kargo-pipeline/test", legacy_event: "kargo_pipeline_test_sms" },
          },
        }),
        requested_at: occurredAt,
        request_id: context.get("requestId"),
      });
      const jobId = await context.get("providerDeliveryQueuePublisher").publish(job);
      await new SmsRepository(db).recordMessage({
        recipientPhone: phone,
        customerName: target.customerName,
        message,
        shipmentPublicId: null,
        trackingNumber: target.trackingNumber,
        templatePublicId: null,
        idempotencyKey: key,
        requestId,
        jobId,
        queued: jobId !== null,
        actorUserId: context.get("actorUserId"),
      });
      return context.json({ type: "sms", queued: jobId !== null, job_ids: jobId ? [jobId] : [], message, live_gate: "providers.netgsm.live_mode" }, 202);
    }

    if (data.type === "mesaj") {
      if (!data.conversation_public_id) return invalid(context, "Kanal mesajı için konuşma gerekli");
      const domain = new DomainRepository(db);
      const conversation = await domain.getConversationDeliveryTarget(data.conversation_public_id);
      if (!conversation) return context.json({ error: { code: "not_found", message: "Konuşma bulunamadı" } }, 404);
      const created = await domain.createMessage({
        conversationPublicId: conversation.public_id,
        senderType: "system",
        senderName: "Garanti Kuluçka",
        body: message,
        externalMessageId: null,
        rawPayload: { source: "cargo_pipeline_test" },
      });
      const plan = planOutboundDelivery({
        target: { ...conversation, customer_phone: conversation.customer_phone ?? phone },
        messagePublicId: created.public_id,
        body: message,
        attachments: [],
        requestId: context.get("requestId"),
        idempotencyPrefix: "cargo_pipeline_test",
        legacyContract: { source: "server.js POST /api/kargo-pipeline/test", legacy_event: "kargo_pipeline_test_mesaj" },
      });
      if ("reason" in plan) {
        return context.json({ error: { code: "delivery_skipped", message: `Kanal mesajı gönderilemedi: ${plan.reason}` } }, 422);
      }
      const jobIds: string[] = [];
      for (const job of plan.jobs) {
        const jobId = await context.get("providerDeliveryQueuePublisher").publish(job);
        if (jobId) jobIds.push(jobId);
      }
      return context.json({ type: "mesaj", queued: jobIds.length > 0, job_ids: jobIds, message, live_gate: `providers.${plan.provider}.live_mode` }, 202);
    }

    const policy = await readVapiCallPolicy(context);
    if (!policy.enabled) return context.json({ error: { code: "vapi_disabled", message: "VAPI devre dışı. Ayarlardan etkinleştirin." } }, 422);
    const repo = new VapiRepository(db);
    const callTarget = { customerPhone: data.phone, customerName: target.customerName, cargoProvider: target.cargoProvider, trackingNumber: target.trackingNumber, lastEventText: target.lastEventText };
    const existing = await repo.findCallByIdempotencyKey(key);
    const callPublicId =
      existing?.public_id ??
      (await repo.createCall({ queueId: null, shipmentId: null, ...callTarget, isTest: true, idempotencyKey: key, requestId: requestIdFor(key), actorUserId: context.get("actorUserId") }));
    const jobId = await queueVapiCall(context, callPublicId, callTarget, key);
    await repo.markCallQueued(callPublicId, jobId);
    return context.json({ type: "vapi", queued: jobId !== null, job_ids: jobId ? [jobId] : [], message, call_id: callPublicId, live_gate: "providers.vapi.live_mode" }, 202);
  });

  routes.post("/:public_id/actions", async (context) => {
    if (!isManager(context.get("auth")?.role)) return forbidden(context);
    const payload = actionSchema.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, "Geçersiz aksiyon");
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const row = await new CargoPipelineRepository(db).applyAction(context.req.param("public_id"), payload.data.action, new Date());
    if (!row) return context.json({ error: { code: "not_found", message: "Kayıt bulunamadı" } }, 404);
    return context.json({ item: serializeCargoPipelineItem(row) });
  });

  routes.delete("/:public_id", async (context) => {
    if (!isManager(context.get("auth")?.role)) return forbidden(context);
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const deleted = await new CargoPipelineRepository(db).delete(context.req.param("public_id"));
    if (!deleted) return context.json({ error: { code: "not_found", message: "Kayıt bulunamadı" } }, 404);
    return context.json({ deleted: true });
  });

  return routes;
}
