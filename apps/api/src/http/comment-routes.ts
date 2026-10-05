import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { jobEnvelopeSchema, providerDeliveryJobPayloadSchema } from "@garanti-kulucka/shared";
import type { AppBindings } from "./types.js";
import { authenticate, requireDatabase } from "./middleware.js";
import {
  CommentIdempotencyConflictError,
  CommentRepository,
  commentPlatforms,
  commentStatuses,
  type CommentActionKind,
  type CommentModerationConfig,
  type CommentStatus,
  serializeComment,
} from "../comments/repository.js";
import { SettingsRepository } from "../settings/repository.js";

/**
 * Legacy `/api/yorumlar*` (frontend/src/pages/yorumlar/YorumlarPage.jsx + routes/commentAiRouter.js)
 * reproduced as backend-owned comment moderation routes. Provider-facing actions never call Meta
 * directly: they are queued on `provider-delivery` as Instagram comment operations and the worker
 * keeps live calls gated by `providers.instagram.live_mode`.
 */

const pageSchema = z.coerce.number().int().min(1).default(1);
const pageSizeSchema = z.coerce.number().int().min(1).max(100).default(30);
const idempotencyKeySchema = z.string().trim().min(1).max(160);

const replySchema = z.object({
  message: z.string().trim().min(1).max(2000),
  reply_type: z.enum(["public", "private"]).default("public"),
  idempotency_key: idempotencyKeySchema,
});

const simpleActionSchema = z.object({
  idempotency_key: idempotencyKeySchema,
});

const configSchema = z.object({
  enabled: z.boolean(),
  platforms: z.object({ instagram: z.boolean(), facebook: z.boolean() }),
  reply_type: z.enum(["public", "private"]),
  delete_profanity: z.boolean(),
  delete_brand_disparagement: z.boolean(),
  risk_manual_examples: z.array(z.string().trim().min(1).max(500)).max(200),
  auto_reply_topics: z.array(z.string().trim().min(1).max(500)).max(200),
  min_confidence: z.number().min(0).max(1),
});

function canModerateComments(role: string | undefined) {
  return role === "admin" || role === "owner" || role === "calisan";
}

function jobIdFromIdempotencyKey(key: string) {
  return `job_comment_${key.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 88)}`;
}

function forbidden(context: Context<AppBindings>) {
  return context.json({ error: { code: "forbidden", message: "Comment moderation access is not allowed" } }, 403);
}

function repository(context: Context<AppBindings>) {
  const db = context.get("db");
  if (!db) {
    return null;
  }
  return new CommentRepository(db, new SettingsRepository(db, context.get("encryptor"), context.get("settingsCache")));
}

async function readJson(context: Context<AppBindings>) {
  try {
    return (await context.req.json()) as unknown;
  } catch {
    return null;
  }
}

const providerOperationByAction: Record<Exclude<CommentActionKind, "mark_manual">, "comment.reply" | "comment.private_reply" | "comment.hide" | "comment.delete"> = {
  reply: "comment.reply",
  private_reply: "comment.private_reply",
  hide: "comment.hide",
  delete: "comment.delete",
};

const nextStatusByAction: Record<CommentActionKind, CommentStatus> = {
  reply: "replied",
  private_reply: "replied",
  hide: "hidden",
  delete: "deleted",
  mark_manual: "manual",
};

export function createCommentRoutes() {
  const routes = new Hono<AppBindings>();

  routes.use("*", requireDatabase, authenticate);
  routes.use("*", async (context, next) => {
    if (!canModerateComments(context.get("auth")?.role)) {
      return forbidden(context);
    }
    return next();
  });

  routes.get("/", async (context) => {
    const repo = repository(context);
    if (!repo) return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);

    const status = context.req.query("status");
    const platform = context.req.query("platform");
    if (status && !(commentStatuses as readonly string[]).includes(status)) {
      return context.json({ error: { code: "invalid_request", message: "Invalid comment status filter" } }, 400);
    }
    if (platform && !(commentPlatforms as readonly string[]).includes(platform)) {
      return context.json({ error: { code: "invalid_request", message: "Invalid comment platform filter" } }, 400);
    }
    const page = pageSchema.parse(context.req.query("page"));
    const pageSize = pageSizeSchema.parse(context.req.query("page_size"));
    const query = context.req.query("q")?.trim();

    const result = await repo.listComments({
      ...(status ? { status: status as CommentStatus } : {}),
      ...(platform ? { platform: platform as (typeof commentPlatforms)[number] } : {}),
      ...(query ? { query } : {}),
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return context.json({ data: result.rows.map(serializeComment), total: result.total, page, page_size: pageSize });
  });

  routes.get("/stats", async (context) => {
    const repo = repository(context);
    if (!repo) return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    return context.json({ counts: await repo.getStatusCounts() });
  });

  routes.get("/settings", async (context) => {
    const repo = repository(context);
    if (!repo) return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    return context.json({ config: await repo.getConfig() });
  });

  routes.put("/settings", async (context) => {
    const payload = configSchema.safeParse(await readJson(context));
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid comment moderation settings payload" } }, 400);
    }
    const repo = repository(context);
    if (!repo) return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);

    const config = await repo.saveConfig(payload.data, {
      actorUserId: context.get("actorUserId"),
      ipAddress: context.req.header("x-forwarded-for") ?? null,
      userAgent: context.req.header("user-agent") ?? null,
    });
    return context.json({ config });
  });

  routes.get("/control", async (context) => {
    const repo = repository(context);
    if (!repo) return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    return context.json(buildControlReport(await repo.getConfig()));
  });

  routes.post("/:comment_public_id/reply", async (context) => {
    const payload = replySchema.safeParse(await readJson(context));
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid comment reply payload" } }, 400);
    }
    return queueCommentAction(context, {
      action: payload.data.reply_type === "private" ? "private_reply" : "reply",
      idempotencyKey: payload.data.idempotency_key,
      message: payload.data.message,
      replyType: payload.data.reply_type,
    });
  });

  routes.post("/:comment_public_id/hide", async (context) => {
    const payload = simpleActionSchema.safeParse(await readJson(context));
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid comment hide payload" } }, 400);
    }
    return queueCommentAction(context, { action: "hide", idempotencyKey: payload.data.idempotency_key });
  });

  routes.post("/:comment_public_id/delete", async (context) => {
    const payload = simpleActionSchema.safeParse(await readJson(context));
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid comment delete payload" } }, 400);
    }
    return queueCommentAction(context, { action: "delete", idempotencyKey: payload.data.idempotency_key });
  });

  routes.post("/:comment_public_id/manual", async (context) => {
    const payload = simpleActionSchema.safeParse(await readJson(context));
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid comment manual payload" } }, 400);
    }
    return queueCommentAction(context, { action: "mark_manual", idempotencyKey: payload.data.idempotency_key });
  });

  routes.post("/:comment_public_id/ai-suggestion", async (context) => {
    const repo = repository(context);
    if (!repo) return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    const comment = await repo.findComment(context.req.param("comment_public_id"));
    if (!comment) {
      return context.json({ error: { code: "not_found", message: "Comment not found" } }, 404);
    }
    return context.json({
      provider: "openai",
      operation: "comments.reply_suggestion",
      dry_run: true,
      live_call_permitted: false,
      comment_public_id: comment.public_id,
      action: "manual",
      suggestion: comment.ai_reply_draft ?? "AI yorum cevabı önerisi backend dry-run sınırında tutuldu.",
    });
  });

  return routes;
}

async function queueCommentAction(
  context: Context<AppBindings>,
  input: { action: CommentActionKind; idempotencyKey: string; message?: string; replyType?: "public" | "private" },
) {
  const repo = repository(context);
  if (!repo) return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);

  const commentPublicId = context.req.param("comment_public_id") ?? "";
  const comment = await repo.findComment(commentPublicId);
  if (!comment) {
    return context.json({ error: { code: "not_found", message: "Comment not found" } }, 404);
  }

  const replay = await repo.findActionByIdempotencyKey(input.idempotencyKey);
  if (replay) {
    if (replay.comment_id !== comment.id || replay.action !== input.action) {
      return context.json({ error: { code: "idempotency_conflict", message: "Comment action idempotency key was reused with different payload" } }, 409);
    }
    return context.json(actionResponse(comment, input.action, replay.job_id, replay.queued, true), 202);
  }

  let jobId: string | null = null;
  const requestPayload: Record<string, unknown> = {
    comment_id: comment.external_comment_id,
    ...(input.message !== undefined ? { message: input.message } : {}),
    idempotency_key: input.idempotencyKey,
  };

  if (input.action !== "mark_manual") {
    const operation = providerOperationByAction[input.action];
    const occurredAt = new Date().toISOString();
    const providerPayload = providerDeliveryJobPayloadSchema.parse({
      envelope: {
        request_id: `req_${randomUUID().replaceAll("-", "")}`,
        provider: "instagram",
        operation,
        direction: "outbound",
        channel: "instagram",
        occurred_at: occurredAt,
        payload: requestPayload,
        legacy_contract: {
          source: "legacy routes/commentAiRouter.js",
          legacy_event: `yorumlar_${input.action}`,
        },
      },
    });
    const job = jobEnvelopeSchema.parse({
      job_id: jobIdFromIdempotencyKey(input.idempotencyKey),
      queue: "provider-delivery",
      name: `instagram.${operation}`,
      payload: providerPayload,
      requested_at: occurredAt,
      request_id: context.get("requestId"),
    });
    jobId = await context.get("providerDeliveryQueuePublisher").publish(job);
  }

  try {
    const result = await repo.recordAction({
      commentPublicId: comment.public_id,
      action: input.action,
      idempotencyKey: input.idempotencyKey,
      requestPayload: { ...requestPayload, platform: comment.platform },
      jobId,
      queued: jobId !== null,
      actorUserId: context.get("actorUserId"),
      nextStatus: nextStatusByAction[input.action],
      ...(input.message !== undefined ? { manualReply: input.message } : {}),
      ...(input.replyType !== undefined ? { replyType: input.replyType } : {}),
    });
    return context.json(
      actionResponse(result.comment, input.action, result.action.job_id, result.action.queued, result.replayed),
      202,
    );
  } catch (error) {
    if (error instanceof CommentIdempotencyConflictError) {
      return context.json({ error: { code: "idempotency_conflict", message: "Comment action idempotency key was reused with different payload" } }, 409);
    }
    throw error;
  }
}

function actionResponse(
  comment: Parameters<typeof serializeComment>[0],
  action: CommentActionKind,
  jobId: string | null,
  queued: boolean,
  replayed: boolean,
) {
  return {
    provider: action === "mark_manual" ? null : "instagram",
    operation: action === "mark_manual" ? null : providerOperationByAction[action],
    action,
    job_id: jobId,
    queued,
    replayed,
    live_call_permitted: false,
    comment: serializeComment(comment),
  };
}

export function buildControlReport(config: CommentModerationConfig) {
  const checks = [
    {
      id: "pipeline_enabled",
      level: config.enabled ? "ok" : "warning",
      title: config.enabled ? "AI pipeline açık" : "AI pipeline kapalı",
      detail: config.enabled ? "Yorumlar sınıflandırma kuyruğuna alınır." : "Yeni yorumlar otomatik işlenmez; Ayarlar'dan açılabilir.",
    },
    {
      id: "platforms",
      level: config.platforms.instagram || config.platforms.facebook ? "ok" : "error",
      title: config.platforms.instagram || config.platforms.facebook ? "Platform seçili" : "Hiçbir platform seçili değil",
      detail: `Instagram ${config.platforms.instagram ? "açık" : "kapalı"} · Facebook ${config.platforms.facebook ? "açık" : "kapalı"}`,
    },
    {
      id: "ai_dry_run",
      level: "warning",
      title: "AI cevap önerisi dry-run",
      detail: "OpenAI canlı çağrısı backend tarafından kapalı tutuluyor; öneriler dry-run olarak döner.",
    },
    {
      id: "provider_live_mode",
      level: "warning",
      title: "Instagram canlı mod kapısı",
      detail: "Cevap/gizle/sil aksiyonları provider-delivery kuyruğuna yazılır; canlı Meta çağrısı providers.instagram.live_mode ile açılır.",
    },
  ] as const;
  const summary = {
    ok: checks.filter((check) => check.level === "ok").length,
    warning: checks.filter((check) => check.level === "warning").length,
    error: checks.filter((check) => check.level === "error").length,
  };
  return {
    status: summary.error > 0 ? "critical" : summary.warning > 0 ? "warning" : "ready",
    summary,
    warnings: checks.filter((check) => check.level !== "ok"),
    checks,
  };
}
