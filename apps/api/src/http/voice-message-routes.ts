import { randomUUID } from "node:crypto";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { jobEnvelopeSchema, providerDeliveryJobPayloadSchema } from "@garanti-kulucka/shared";
import type { AppBindings } from "./types.js";
import { VoiceMessageRepository, type VoiceMessageRecord } from "../voice/voice-message-repository.js";

/**
 * Legacy SesliMesajlarPage (server.js `/api/netgsm/sesli-mesaj/*`) and RehberPage. Sending and report
 * fetching are `netgsm.voice.message.*` provider-delivery jobs gated by `providers.netgsm.live_mode`; the
 * API never calls NetGSM and reads the outcome back from provider attempts.
 */

const liveGate = "providers.netgsm.live_mode";
const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[^\d+]/g, ""))
  .pipe(z.string().regex(/^\+?\d{10,15}$/));
const createSchema = z
  .object({
    recipients: z.array(phoneSchema).min(1).max(500),
    message: z.string().trim().min(1).max(1000).optional(),
    audio_id: z.string().trim().min(1).max(64).optional(),
    ringtime: z.number().int().min(10).max(30).default(20),
    idempotency_key: z.string().trim().min(1).max(160),
  })
  .refine((value) => Boolean(value.message) !== Boolean(value.audio_id), { message: "Provide either message or audio_id" });
const reportSchema = z.object({ idempotency_key: z.string().trim().min(1).max(160) });
const listQuerySchema = z.object({
  status: z.enum(["queued", "sent", "failed", "dry_run"]).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});
const phonebookQuerySchema = z.object({
  kind: z.enum(["customer", "staff"]).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

function slug(value: string, max: number) {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(value) ? value : {};
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

function serialize(row: VoiceMessageRecord) {
  return {
    public_id: row.public_id,
    recipients: Array.isArray(row.recipients) ? row.recipients : [],
    recipient_count: row.recipient_count,
    message: row.message_text,
    audio_id: row.audio_id,
    ringtime: row.ringtime,
    status: row.status,
    bulk_id: row.bulk_id,
    error_message: row.error_message,
    report: row.report ?? null,
    report_checked_at: row.report_checked_at ? row.report_checked_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/** Moves queued rows to sent / failed / dry_run from the worker attempt of their send job. */
async function reconcileSend(repo: VoiceMessageRepository, row: VoiceMessageRecord) {
  if (row.status !== "queued") return row;
  const attempt = await repo.latestAttempt(row.request_id);
  if (!attempt) return row;
  if (attempt.status === "terminal_failure") {
    return repo.update(row.id, { status: "failed", error_message: attempt.error_message ?? "NetGSM sesli mesaj gönderilemedi" });
  }
  if (attempt.status !== "success") return row;
  const metadata = jsonObject(attempt.response_metadata);
  if (metadata.live_call_performed === false || !isRecord(metadata.result)) {
    return repo.update(row.id, { status: "dry_run", error_message: `Canlı NetGSM kapalı; istek kuru çalıştırıldı (${liveGate} ve hesap onayı gerekli).` });
  }
  const bulkId = metadata.result.bulkId;
  return repo.update(row.id, { status: "sent", bulk_id: typeof bulkId === "string" || typeof bulkId === "number" ? String(bulkId) : null, error_message: null });
}

/** Stores the latest per-number report fetched by the `voice.message.report` job. */
async function reconcileReport(repo: VoiceMessageRepository, row: VoiceMessageRecord) {
  if (!row.report_request_id) return row;
  const attempt = await repo.latestAttempt(row.report_request_id);
  if (!attempt || attempt.status !== "success") return row;
  const metadata = jsonObject(attempt.response_metadata);
  if (!isRecord(metadata.result)) return row;
  const result = metadata.result;
  const report = { report_ready: result.report_ready === true, message: typeof result.message === "string" ? result.message : null, rows: Array.isArray(result.rows) ? result.rows : [] };
  if (row.report && JSON.stringify(row.report) === JSON.stringify(report)) return row;
  return repo.update(row.id, { report, report_checked_at: new Date() });
}

export function registerVoiceMessageRoutes(routes: Hono<AppBindings>) {
  const repoFor = (context: Context<AppBindings>) => {
    const db = context.get("db");
    return db ? new VoiceMessageRepository(db) : null;
  };
  const unavailable = (context: Context<AppBindings>) =>
    context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);

  routes.get("/sesli-mesaj", async (context) => {
    const query = listQuerySchema.safeParse(context.req.query());
    if (!query.success) return invalid(context, "Invalid voice message filter");
    const repo = repoFor(context);
    if (!repo) return unavailable(context);
    const page = await repo.list(query.data);
    const rows = [];
    for (const row of page.rows) rows.push(await reconcileSend(repo, row));
    return context.json({
      data: rows.map(serialize),
      total_count: page.total_count,
      recipient_total: page.recipient_total,
      limit: query.data.limit,
      offset: query.data.offset,
      live_gate: liveGate,
    });
  });

  routes.post("/sesli-mesaj", async (context) => {
    const payload = createSchema.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, "Invalid voice message payload");
    const repo = repoFor(context);
    if (!repo) return unavailable(context);
    const recipients = [...new Set(payload.data.recipients)];
    const replay = await repo.findByIdempotencyKey(payload.data.idempotency_key);
    if (replay) {
      const same =
        JSON.stringify(replay.recipients) === JSON.stringify(recipients) &&
        replay.message_text === (payload.data.message ?? null) &&
        replay.audio_id === (payload.data.audio_id ?? null);
      if (!same) {
        return context.json({ error: { code: "idempotency_conflict", message: "Voice message idempotency key was reused with a different payload" } }, 409);
      }
      return context.json({ voice_message: serialize(replay), replayed: true, queued: replay.job_id !== null, live_gate: liveGate, live_call_permitted: false }, 200);
    }

    const requestId = `req_netgsm_voice_message_${slug(payload.data.idempotency_key, 80)}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const record = await repo.create({
      recipients,
      messageText: payload.data.message ?? null,
      audioId: payload.data.audio_id ?? null,
      ringtime: payload.data.ringtime,
      requestId,
      idempotencyKey: payload.data.idempotency_key,
      actorUserId: context.get("actorUserId") ?? null,
    });
    const accountPublicId = await repo.activeAccountPublicId("netgsm");
    const occurredAt = new Date().toISOString();
    const envelope = providerDeliveryJobPayloadSchema.parse({
      envelope: {
        request_id: requestId,
        provider: "netgsm",
        operation: "voice.message.send",
        direction: "outbound",
        channel: "voice",
        occurred_at: occurredAt,
        ...(accountPublicId ? { account_public_id: accountPublicId } : {}),
        payload: {
          voice_message_public_id: record.public_id,
          recipients,
          ...(payload.data.message ? { message: payload.data.message } : {}),
          ...(payload.data.audio_id ? { audio_id: payload.data.audio_id } : {}),
          ringtime: payload.data.ringtime,
          recipient_count: recipients.length,
          idempotency_key: `voice:${record.public_id}`,
        },
        legacy_contract: { source: "server.js POST /api/netgsm/sesli-mesaj/gonder", legacy_event: "netgsm_sesli_mesaj_gonder" },
      },
    });
    const jobId = await context.get("providerDeliveryQueuePublisher").publish(
      jobEnvelopeSchema.parse({
        job_id: `job_netgsm_voice_message_${record.public_id}`,
        queue: "provider-delivery",
        name: "netgsm.voice.message.send",
        payload: envelope,
        requested_at: occurredAt,
        request_id: context.get("requestId"),
      }),
    );
    const stored = jobId ? await repo.update(record.id, { job_id: jobId }) : record;
    return context.json({ voice_message: serialize(stored), replayed: false, queued: jobId !== null, live_gate: liveGate, live_call_permitted: false }, 202);
  });

  routes.get("/sesli-mesaj/:publicId", async (context) => {
    const repo = repoFor(context);
    if (!repo) return unavailable(context);
    const row = await repo.get(context.req.param("publicId"));
    if (!row) return context.json({ error: { code: "not_found", message: "Voice message not found" } }, 404);
    const current = await reconcileReport(repo, await reconcileSend(repo, row));
    return context.json({ voice_message: serialize(current), live_gate: liveGate });
  });

  routes.post("/sesli-mesaj/:publicId/rapor", async (context) => {
    const payload = reportSchema.safeParse(await readJson(context));
    if (!payload.success) return invalid(context, "Invalid voice message report payload");
    const repo = repoFor(context);
    if (!repo) return unavailable(context);
    const found = await repo.get(context.req.param("publicId"));
    if (!found) return context.json({ error: { code: "not_found", message: "Voice message not found" } }, 404);
    const row = await reconcileSend(repo, found);
    if (!row.bulk_id) {
      return context.json({ error: { code: "report_unavailable", message: "NetGSM bulk id henüz yok; rapor sorgulanamaz" } }, 409);
    }
    const requestId = `req_netgsm_voice_report_${slug(payload.data.idempotency_key, 80)}`;
    if (row.report_request_id === requestId) {
      return context.json({ voice_message: serialize(row), replayed: true, queued: true, live_gate: liveGate, live_call_permitted: false }, 200);
    }
    const accountPublicId = await repo.activeAccountPublicId("netgsm");
    const occurredAt = new Date().toISOString();
    const envelope = providerDeliveryJobPayloadSchema.parse({
      envelope: {
        request_id: requestId,
        provider: "netgsm",
        operation: "voice.message.report",
        direction: "outbound",
        channel: "voice",
        occurred_at: occurredAt,
        ...(accountPublicId ? { account_public_id: accountPublicId } : {}),
        payload: { voice_message_public_id: row.public_id, bulk_id: row.bulk_id },
        legacy_contract: { source: "server.js GET /api/netgsm/sesli-mesaj/rapor/:bulkId", legacy_event: "netgsm_sesli_mesaj_rapor" },
      },
    });
    const jobId = await context.get("providerDeliveryQueuePublisher").publish(
      jobEnvelopeSchema.parse({
        job_id: `job_netgsm_voice_report_${slug(payload.data.idempotency_key, 80)}`,
        queue: "provider-delivery",
        name: "netgsm.voice.message.report",
        payload: envelope,
        requested_at: occurredAt,
        request_id: context.get("requestId"),
      }),
    );
    const stored = await repo.update(row.id, { report_request_id: requestId });
    return context.json({ voice_message: serialize(stored), replayed: false, queued: jobId !== null, live_gate: liveGate, live_call_permitted: false }, 202);
  });

  routes.get("/rehber", async (context) => {
    const query = phonebookQuerySchema.safeParse(context.req.query());
    if (!query.success) return invalid(context, "Invalid phonebook filter");
    const repo = repoFor(context);
    if (!repo) return unavailable(context);
    const book = await repo.phonebook(query.data);
    return context.json({ data: book.rows, total_count: book.total_count, limit: query.data.limit, offset: query.data.offset });
  });
}
