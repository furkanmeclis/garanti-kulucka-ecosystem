import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { jobEnvelopeSchema, providerDeliveryJobPayloadSchema } from "@garanti-kulucka/shared";
import type { AppBindings } from "./types.js";
import { authenticate, requireDatabase } from "./middleware.js";
import {
  SmsRepository,
  SmsSystemTemplateDeleteError,
  SmsTemplateNotFoundError,
  serializeSmsMessage,
  serializeSmsTemplate,
  type SmsHistoryType,
  type SmsMessageRecord,
} from "../sms/repository.js";

/**
 * Legacy SMS center (frontend/src/pages/sms/SmsGonderPage.jsx + server.js `/api/netgsm/sms/*`).
 * Sends never call NetGSM from the API: every recipient becomes a `provider-delivery` job
 * (`netgsm.sms.send`) and the worker keeps live calls gated by `providers.netgsm.live_mode`
 * plus the account opt-in. Delivery state is read back from worker-written provider attempts.
 */

/** Legacy DEGISKENLER — sending with an unfilled variable is rejected exactly like the legacy UI guard. */
export const smsTemplateVariables = ["{musteri_adi}", "{takip_no}", "{kargo_firmasi}"] as const;

const idempotencyKeySchema = z.string().trim().min(1).max(160);
const pageSchema = z.coerce.number().int().min(1).default(1);
const pageSizeSchema = z.coerce.number().int().min(1).max(200).default(25);
const historyTypeSchema = z.enum(["all", "manual", "automatic"]).default("all");

const manualSendSchema = z.object({
  recipients: z.array(z.string().trim().min(1).max(32)).min(1).max(100),
  message: z.string().trim().min(1).max(1000),
  idempotency_key: idempotencyKeySchema,
  template_public_id: z.string().trim().min(1).optional(),
  customer_name: z.string().trim().min(1).max(200).optional(),
  shipment_public_id: z.string().trim().min(1).optional(),
  tracking_number: z.string().trim().min(1).max(120).optional(),
});

const createTemplateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(1000),
  sort_order: z.number().int().min(0).max(10_000).default(99),
});

const updateTemplateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().trim().min(1).max(1000).optional(),
    is_active: z.boolean().optional(),
    sort_order: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), { message: "Empty template update" });

const automaticTriggerSchema = z.object({
  provider: z.enum(["ptt", "surat"]),
  idempotency_key: idempotencyKeySchema,
});

function canUseSmsCenter(role: string | undefined) {
  return role === "admin" || role === "owner" || role === "calisan" || role === "kargo_operatoru";
}

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

/** Legacy `/api/netgsm/sms/gonder` normalization: digits only, at least 10 digits. */
export function normalizeSmsPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

export function createSmsRoutes() {
  const routes = new Hono<AppBindings>();

  routes.use("*", requireDatabase, authenticate);
  routes.use("*", async (context, next) => {
    if (!canUseSmsCenter(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "SMS center access is not allowed" } }, 403);
    }
    return next();
  });

  routes.get("/templates", async (context) => {
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const templates = await new SmsRepository(db).listTemplates();
    return context.json({ data: templates.map(serializeSmsTemplate) });
  });

  routes.post("/templates", async (context) => {
    const payload = createTemplateSchema.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, "Başlık ve metin boş olamaz");
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const template = await new SmsRepository(db).createTemplate({
      title: payload.data.title,
      body: payload.data.body,
      sortOrder: payload.data.sort_order,
      actorUserId: context.get("actorUserId"),
    });
    return context.json({ template: serializeSmsTemplate(template) }, 201);
  });

  routes.patch("/templates/:template_public_id", async (context) => {
    const payload = updateTemplateSchema.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, "Başlık ve metin boş olamaz");
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    try {
      const template = await new SmsRepository(db).updateTemplate(context.req.param("template_public_id"), {
        ...(payload.data.title !== undefined ? { title: payload.data.title } : {}),
        ...(payload.data.body !== undefined ? { body: payload.data.body } : {}),
        ...(payload.data.is_active !== undefined ? { isActive: payload.data.is_active } : {}),
        ...(payload.data.sort_order !== undefined ? { sortOrder: payload.data.sort_order } : {}),
      });
      return context.json({ template: serializeSmsTemplate(template) });
    } catch (error) {
      if (error instanceof SmsTemplateNotFoundError) {
        return context.json({ error: { code: "not_found", message: "Şablon bulunamadı" } }, 404);
      }
      throw error;
    }
  });

  routes.delete("/templates/:template_public_id", async (context) => {
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    try {
      await new SmsRepository(db).deleteTemplate(context.req.param("template_public_id"));
      return context.json({ deleted: true });
    } catch (error) {
      if (error instanceof SmsTemplateNotFoundError) {
        return context.json({ error: { code: "not_found", message: "Şablon bulunamadı" } }, 404);
      }
      if (error instanceof SmsSystemTemplateDeleteError) {
        return context.json({ error: { code: "system_template", message: "Sistem şablonları silinemez" } }, 403);
      }
      throw error;
    }
  });

  routes.get("/history", async (context) => {
    const type = historyTypeSchema.safeParse(context.req.query("type") || undefined);
    const page = pageSchema.safeParse(context.req.query("page") || undefined);
    const pageSize = pageSizeSchema.safeParse(context.req.query("page_size") || undefined);
    if (!type.success || !page.success || !pageSize.success) return invalid(context, "Invalid SMS history filter");
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const query = context.req.query("q")?.trim();
    const result = await new SmsRepository(db).listHistory({
      type: type.data as SmsHistoryType,
      ...(query ? { query } : {}),
      limit: pageSize.data,
      offset: (page.data - 1) * pageSize.data,
    });
    return context.json({ data: result.rows.map(serializeSmsMessage), total: result.total, page: page.data, page_size: pageSize.data });
  });

  routes.post("/manual-send", async (context) => {
    const payload = manualSendSchema.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, "Invalid SMS payload");
    if (smsTemplateVariables.some((variable) => payload.data.message.includes(variable))) {
      return context.json(
        { error: { code: "unfilled_variables", message: "Mesajda doldurulmamış değişken var ({musteri_adi} vb.)" } },
        400,
      );
    }
    const phones = payload.data.recipients.map(normalizeSmsPhone);
    if (phones.some((phone) => phone === null)) {
      return context.json({ error: { code: "invalid_phone", message: "Geçerli telefon numarası bulunamadı" } }, 400);
    }
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const repo = new SmsRepository(db);
    const recipients = phones as string[];
    const keys = recipients.map((_, index) => `${payload.data.idempotency_key}#${index}`);
    const existing = new Map((await repo.findMessagesByIdempotencyKeys(keys)).map((row) => [row.idempotency_key, row]));

    for (const [index, key] of keys.entries()) {
      const row = existing.get(key);
      if (row && (row.recipient_phone !== recipients[index] || row.message !== payload.data.message)) {
        return context.json(
          { error: { code: "idempotency_conflict", message: "SMS idempotency key was reused with a different payload" } },
          409,
        );
      }
    }

    const messages: SmsMessageRecord[] = [];
    let replayedCount = 0;
    for (const [index, key] of keys.entries()) {
      const replay = existing.get(key);
      if (replay) {
        replayedCount += 1;
        messages.push(replay);
        continue;
      }
      const recipientPhone = recipients[index] as string;
      const occurredAt = new Date().toISOString();
      const requestId = `req_sms_${slug(key, 80)}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
      const providerPayload = providerDeliveryJobPayloadSchema.parse({
        envelope: {
          request_id: requestId,
          provider: "netgsm",
          operation: "sms.send",
          direction: "outbound",
          channel: "sms",
          occurred_at: occurredAt,
          payload: {
            recipient_phone: recipientPhone,
            message: payload.data.message,
            idempotency_key: key,
          },
          legacy_contract: {
            source: "legacy-sms-gonder-page",
            legacy_event: "netgsm_sms_gonder",
          },
        },
      });
      const job = jobEnvelopeSchema.parse({
        job_id: `job_sms_${slug(key, 88)}`,
        queue: "provider-delivery",
        name: "netgsm.sms.send",
        payload: providerPayload,
        requested_at: occurredAt,
        request_id: context.get("requestId"),
      });
      const jobId = await context.get("providerDeliveryQueuePublisher").publish(job);
      messages.push(
        await repo.recordMessage({
          recipientPhone,
          customerName: payload.data.customer_name ?? null,
          message: payload.data.message,
          shipmentPublicId: payload.data.shipment_public_id ?? null,
          trackingNumber: payload.data.tracking_number ?? null,
          templatePublicId: payload.data.template_public_id ?? null,
          idempotencyKey: key,
          requestId,
          jobId,
          queued: jobId !== null,
          actorUserId: context.get("actorUserId"),
        }),
      );
    }

    return context.json(
      {
        provider: "netgsm",
        operation: "sms.send",
        recipient_count: messages.length,
        queued_count: messages.filter((message) => message.queued).length,
        replayed: replayedCount === messages.length,
        live_call_permitted: false,
        live_gate: "providers.netgsm.live_mode",
        messages: messages.map((message) => serializeSmsMessage(message)),
      },
      202,
    );
  });

  routes.post("/automatic/trigger", async (context) => {
    const payload = automaticTriggerSchema.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, "Invalid automatic SMS trigger payload");
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);

    const provider = payload.data.provider;
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const shipments = await new SmsRepository(db).listTrackableShipments(provider, since);
    const jobIds: string[] = [];
    for (const shipment of shipments) {
      const key = `${payload.data.idempotency_key}_${shipment.public_id}`;
      const occurredAt = new Date().toISOString();
      const providerPayload = providerDeliveryJobPayloadSchema.parse({
        envelope: {
          request_id: `req_${provider}_track_${slug(key, 80)}`,
          provider,
          operation: "shipment.track",
          direction: "outbound",
          channel: "cargo",
          occurred_at: occurredAt,
          payload: {
            shipment_public_id: shipment.public_id,
            tracking_number: shipment.tracking_number,
            barcode_number: shipment.barcode_number,
            customer_full_name: shipment.recipient_name,
            automatic_sms: true,
          },
          legacy_contract: {
            source: "legacy-sms-otomatik-tab",
            legacy_event: `${provider}_cron_takip_guncelle`,
          },
        },
      });
      const job = jobEnvelopeSchema.parse({
        job_id: `job_${slug(key, 96)}`,
        queue: "provider-delivery",
        name: `${provider}.shipment.track`,
        payload: providerPayload,
        requested_at: occurredAt,
        request_id: context.get("requestId"),
      });
      const jobId = await context.get("providerDeliveryQueuePublisher").publish(job);
      if (jobId) jobIds.push(jobId);
    }

    return context.json(
      {
        provider,
        operation: "shipment.track",
        checked_count: shipments.length,
        queued_count: jobIds.length,
        job_ids: jobIds,
        live_call_permitted: false,
        live_gate: `providers.${provider}.live_mode`,
      },
      202,
    );
  });

  return routes;
}
