import { Hono, type Context } from "hono";
import { z } from "zod";
import { jobEnvelopeSchema, providerDeliveryJobPayloadSchema } from "@garanti-kulucka/shared";
import type { AppBindings } from "./types.js";
import { authenticate, requireAdmin, requireDatabase } from "./middleware.js";
import { NetgsmVoiceRepository, cdrStatistics, filterCdrByDirection, formatCdrDuration } from "../voice/netgsm-repository.js";
import { readNetgsmTeyitSettings, writeNetgsmTeyitSettings } from "../voice/policy.js";

/**
 * Legacy Arama sayfası (AramaPage = NetgsmAyarlar + GorusmeDetayPage) backed by server.js `/api/netgsm/status`,
 * `/api/netgsm/cdr*` and `settings.netgsm_teyit_ayarlar`. CDR reports are fetched by the worker
 * (`netgsm.call.report`, gated by `providers.netgsm.live_mode`); the API serves the latest snapshot.
 */

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const syncSchema = z.object({
  baslangic_tarih: dateSchema.optional(),
  bitis_tarih: dateSchema.optional(),
  idempotency_key: z.string().trim().min(1).max(160),
});
const teyitSchema = z.object({
  aktif: z.boolean(),
  ilk_arama_dakika: z.number().int().min(1).max(60),
  max_deneme: z.number().int().min(1).max(10),
  deneme_arasi_dakika: z.number().int().min(1).max(120),
});
const pageSchema = z.coerce.number().int().min(1).default(1);
const pageSizeSchema = z.coerce.number().int().min(1).max(10_000).default(50);

function slug(value: string, max: number) {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, max);
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

export function createNetgsmVoiceRoutes() {
  const routes = new Hono<AppBindings>();
  routes.use("*", requireDatabase, authenticate, requireAdmin);

  routes.get("/status", async (context) => {
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    return context.json({ configured: await new NetgsmVoiceRepository(db).isConfigured(), live_gate: "providers.netgsm.live_mode" });
  });

  routes.get("/teyit-settings", async (context) => {
    return context.json({ settings: await readNetgsmTeyitSettings(context) });
  });

  routes.put("/teyit-settings", async (context) => {
    const payload = teyitSchema.safeParse(await readJson(context));
    if (!payload.success) return context.json({ error: { code: "invalid_request", message: "Invalid NetGSM teyit settings" } }, 400);
    await writeNetgsmTeyitSettings(context, payload.data);
    return context.json({ settings: payload.data });
  });

  routes.post("/cdr/sync", async (context) => {
    const payload = syncSchema.safeParse(await readJson(context));
    if (!payload.success) return context.json({ error: { code: "invalid_request", message: "Invalid CDR sync payload" } }, 400);
    const occurredAt = new Date().toISOString();
    const requestId = `req_netgsm_call_report_${slug(payload.data.idempotency_key, 96)}`;
    const envelope = providerDeliveryJobPayloadSchema.parse({
      envelope: {
        request_id: requestId,
        provider: "netgsm",
        operation: "call.report",
        direction: "outbound",
        channel: "voice",
        occurred_at: occurredAt,
        payload: {
          ...(payload.data.baslangic_tarih ? { start_date: payload.data.baslangic_tarih } : {}),
          ...(payload.data.bitis_tarih ? { stop_date: payload.data.bitis_tarih } : {}),
        },
        legacy_contract: { source: "server.js GET /api/netgsm/cdr", legacy_event: "netsantral-report" },
      },
    });
    const jobId = await context.get("providerDeliveryQueuePublisher").publish(
      jobEnvelopeSchema.parse({
        job_id: `job_netgsm_call_report_${slug(payload.data.idempotency_key, 80)}`,
        queue: "provider-delivery",
        name: "netgsm.call.report",
        payload: envelope,
        requested_at: occurredAt,
        request_id: context.get("requestId"),
      }),
    );
    return context.json(
      { request_id: requestId, job_id: jobId, queued: true, live_gate: "providers.netgsm.live_mode", live_call_permitted: false },
      202,
    );
  });

  routes.get("/cdr", async (context) => {
    const yon = context.req.query("yon");
    const page = pageSchema.safeParse(context.req.query("sayfa") || undefined);
    const pageSize = pageSizeSchema.safeParse(context.req.query("sayfa_boyutu") || undefined);
    if ((yon && yon !== "gelen" && yon !== "giden") || !page.success || !pageSize.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid CDR filter" } }, 400);
    }
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const snapshot = await new NetgsmVoiceRepository(db).latestCdrSnapshot();
    if (snapshot && snapshot.status !== "success") {
      return context.json({ success: false, error: snapshot.error_message ?? "API hatası", synced_at: snapshot.synced_at.toISOString(), request_id: snapshot.request_id });
    }
    const records = filterCdrByDirection(snapshot?.records ?? [], (yon as "gelen" | "giden" | undefined) ?? null);
    const totalSeconds = records.reduce((sum, record) => sum + (record.sureSaniye || 0), 0);
    return context.json({
      success: true,
      data: {
        kayitlar: records.slice((page.data - 1) * pageSize.data, page.data * pageSize.data),
        toplamKayit: records.length,
        toplamSure: formatCdrDuration(totalSeconds),
        sayfa: page.data,
        sayfaBoyutu: pageSize.data,
      },
      synced_at: snapshot ? snapshot.synced_at.toISOString() : null,
      request_id: snapshot?.request_id ?? null,
    });
  });

  routes.get("/cdr/istatistik", async (context) => {
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const snapshot = await new NetgsmVoiceRepository(db).latestCdrSnapshot();
    const records = snapshot && snapshot.status === "success" ? snapshot.records : [];
    return context.json({ success: true, data: cdrStatistics(records), synced_at: snapshot ? snapshot.synced_at.toISOString() : null });
  });

  return routes;
}
