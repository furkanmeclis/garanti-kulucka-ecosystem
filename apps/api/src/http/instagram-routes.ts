import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { jobEnvelopeSchema, providerDeliveryJobPayloadSchema } from "@garanti-kulucka/shared";
import type { AppBindings } from "./types.js";
import { authenticate, requireDatabase } from "./middleware.js";
import { createMediaStorageFromEnv } from "../files/storage.js";
import { loadStoragePolicies, scanStatusAllowsDownload } from "../files/policy.js";
import {
  InstagramPublicationConflictError,
  InstagramRepository,
  instagramAccountInsightsFromMetadata,
  serializeInstagramPublication,
  type InstagramPublicationRecord,
} from "../instagram/repository.js";
import { isAllowedOutboundUserUrl } from "../security/url-policy.js";

/**
 * Legacy `/instagram/yayinla` + `/instagram/analitik` (admin, calisan). Publishing never calls
 * Meta from the API: the request is recorded idempotently and queued on `provider-delivery` as
 * `instagram.media.publish`; the worker keeps the live Graph call gated by
 * `providers.instagram.live_mode`. Garage media is handed to Graph as a short-lived presigned GET.
 * Account insights are a backend dry-run boundary over the stored analytics snapshot.
 */

const captionLimit = 2200;
const imageMimeTypes = ["image/jpeg", "image/jpg"];
const videoMimeTypes = ["video/mp4", "video/quicktime"];

const publishSchema = z
  .object({
    account_public_id: z.string().trim().min(1).max(64).nullable().default(null),
    image_url: z.string().trim().url().max(2048).nullable().default(null),
    video_url: z.string().trim().url().max(2048).nullable().default(null),
    file_public_id: z.string().trim().min(1).max(64).nullable().default(null),
    media_type: z.enum(["IMAGE", "REELS", "VIDEO"]).nullable().default(null),
    caption: z.string().max(captionLimit).default(""),
    idempotency_key: z.string().trim().min(1).max(160),
  })
  .refine(
    (value) => [value.image_url, value.video_url, value.file_public_id].filter((source) => source !== null).length === 1,
    { message: "Exactly one media source is required" },
  );

const daysSchema = z.coerce.number().int().min(1).max(90).catch(7);

/** Where the stored analytics snapshot came from (`instagram_graph` = written by a live worker job). */
function instagramAnalyticsSync(metadata: unknown) {
  const record = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
  const analytics = record.analytics && typeof record.analytics === "object" && !Array.isArray(record.analytics) ? (record.analytics as Record<string, unknown>) : {};
  return {
    synced_at: typeof analytics.synced_at === "string" ? analytics.synced_at : null,
    source: typeof analytics.source === "string" ? analytics.source : null,
  };
}

function canUseInstagram(role: string | undefined) {
  return role === "admin" || role === "owner" || role === "calisan";
}

function slug(value: string, max: number) {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, max);
}

async function readJson(context: Context<AppBindings>) {
  try {
    return (await context.req.json()) as unknown;
  } catch {
    return null;
  }
}

function databaseUnavailable(context: Context<AppBindings>) {
  return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
}

function publicationMatches(
  existing: InstagramPublicationRecord,
  input: { mediaKind: string; mediaUrl: string | null; fileId: number | null; caption: string; accountId: number | null },
) {
  return (
    existing.media_kind === input.mediaKind &&
    existing.caption === input.caption &&
    existing.account_id === input.accountId &&
    (input.fileId !== null ? existing.file_id === input.fileId : existing.media_url === input.mediaUrl)
  );
}

function publishResponse(publication: InstagramPublicationRecord, replayed: boolean) {
  return {
    provider: "instagram",
    operation: "media.publish",
    publication: serializeInstagramPublication(publication),
    job_id: publication.job_id,
    queued: publication.queued,
    replayed,
    live_call_permitted: false,
    live_gate: "providers.instagram.live_mode",
  };
}

export function createInstagramRoutes() {
  const routes = new Hono<AppBindings>();

  routes.use("*", requireDatabase, authenticate);
  routes.use("*", async (context, next) => {
    if (!canUseInstagram(context.get("auth")?.role)) {
      return context.json({ error: { code: "forbidden", message: "Instagram access is not allowed" } }, 403);
    }
    return next();
  });

  routes.post("/publications", async (context) => {
    const payload = publishSchema.safeParse(await readJson(context));
    if (!payload.success) {
      return context.json({ error: { code: "invalid_request", message: "Invalid Instagram publish payload" } }, 400);
    }
    const body = payload.data;
    for (const url of [body.image_url, body.video_url]) {
      if (url !== null && !isAllowedOutboundUserUrl(url)) {
        return context.json({ error: { code: "invalid_request", message: "Instagram media URL is not allowed" } }, 400);
      }
    }

    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const repo = new InstagramRepository(db);

    const account = await repo.findAccount(body.account_public_id);
    if (body.account_public_id && !account) {
      return context.json({ error: { code: "integration_account_not_found", message: "Instagram account not found" } }, 404);
    }

    let mediaKind: "image" | "video" = body.video_url !== null ? "video" : "image";
    let fileId: number | null = null;
    let fileObjectKey: string | null = null;
    if (body.file_public_id !== null) {
      const file = await repo.findMediaFile(body.file_public_id);
      if (!file) {
        return context.json({ error: { code: "not_found", message: "File was not found" } }, 404);
      }
      if (file.upload_status !== "available") {
        return context.json({ error: { code: "file_not_available", message: "File upload is not available" } }, 409);
      }
      const policies = await loadStoragePolicies({ db, settingsCache: context.get("settingsCache") });
      if (!scanStatusAllowsDownload(file.scan_status as never, policies.malwareScan)) {
        return context.json({ error: { code: "file_scan_blocked", message: "File is not cleared for publishing" } }, 423);
      }
      const mime = (file.mime_type ?? "").toLowerCase();
      if (imageMimeTypes.includes(mime)) {
        mediaKind = "image";
      } else if (videoMimeTypes.includes(mime)) {
        mediaKind = "video";
      } else {
        return context.json({ error: { code: "content_type_not_allowed", message: "Instagram media must be JPEG or MP4" } }, 400);
      }
      fileId = file.id;
      fileObjectKey = file.object_key;
    }
    const mediaUrl = body.image_url ?? body.video_url ?? null;
    const mediaType = mediaKind === "video" ? (body.media_type && body.media_type !== "IMAGE" ? body.media_type : "REELS") : "IMAGE";
    const accountId = account?.id ?? null;

    const existing = await repo.findByIdempotencyKey(body.idempotency_key);
    if (existing) {
      if (!publicationMatches(existing, { mediaKind, mediaUrl, fileId, caption: body.caption, accountId })) {
        return context.json(
          { error: { code: "idempotency_conflict", message: "Instagram publish key was reused with a different payload" } },
          409,
        );
      }
      return context.json(publishResponse(existing, true), 202);
    }

    let graphMediaUrl = mediaUrl;
    if (fileObjectKey !== null) {
      graphMediaUrl = (await createMediaStorageFromEnv().createDownloadInstruction(fileObjectKey)).presigned_url;
      if (!graphMediaUrl) {
        return context.json({ error: { code: "storage_unavailable", message: "Media storage is not configured" } }, 503);
      }
    }

    const occurredAt = new Date().toISOString();
    const requestId = `req_igpub_${slug(body.idempotency_key, 80)}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const providerPayload = providerDeliveryJobPayloadSchema.parse({
      envelope: {
        request_id: requestId,
        provider: "instagram",
        operation: "media.publish",
        direction: "outbound",
        channel: "instagram",
        ...(account ? { account_public_id: account.public_id } : {}),
        occurred_at: occurredAt,
        payload: {
          ...(mediaKind === "video"
            ? { video_url: graphMediaUrl, media_type: mediaType }
            : { image_url: graphMediaUrl }),
          caption: body.caption,
          ...(body.file_public_id ? { file_public_id: body.file_public_id } : {}),
          idempotency_key: body.idempotency_key,
        },
        legacy_contract: {
          source: mediaKind === "video" ? "legacy server.js POST /api/instagram/publish/video" : "legacy server.js POST /api/instagram/publish/photo",
          legacy_event: "instagram_yayinla",
        },
      },
    });
    const job = jobEnvelopeSchema.parse({
      job_id: `job_igpub_${slug(body.idempotency_key, 88)}`,
      queue: "provider-delivery",
      name: "instagram.media.publish",
      payload: providerPayload,
      requested_at: occurredAt,
      request_id: context.get("requestId"),
    });
    const jobId = await context.get("providerDeliveryQueuePublisher").publish(job);

    try {
      const publication = await repo.recordPublication({
        accountId,
        mediaKind,
        mediaType,
        mediaUrl: fileId === null ? mediaUrl : null,
        fileId,
        caption: body.caption,
        idempotencyKey: body.idempotency_key,
        requestId,
        jobId,
        queued: jobId !== null,
        createdByUserId: context.get("actorUserId"),
      });
      return context.json(publishResponse(publication, false), 202);
    } catch (error) {
      if (error instanceof InstagramPublicationConflictError) {
        return context.json(
          { error: { code: "idempotency_conflict", message: "Instagram publish key was reused with a different payload" } },
          409,
        );
      }
      throw error;
    }
  });

  routes.get("/publications/:publication_public_id", async (context) => {
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const publication = await new InstagramRepository(db).getPublication(context.req.param("publication_public_id"));
    if (!publication) {
      return context.json({ error: { code: "not_found", message: "Instagram publication not found" } }, 404);
    }
    return context.json(serializeInstagramPublication(publication));
  });

  routes.get("/insights/account", async (context) => {
    const days = daysSchema.parse(context.req.query("days"));
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const accountPublicId = context.req.query("account_public_id")?.trim() || null;
    const account = await new InstagramRepository(db).findAccount(accountPublicId);
    if (!account) {
      return context.json({ error: { code: "instagram_not_connected", message: "Instagram bagli degil" } }, 400);
    }
    const sync = instagramAnalyticsSync(account.metadata);
    return context.json({
      success: true,
      cached: sync.synced_at !== null,
      account_public_id: account.public_id,
      ...instagramAccountInsightsFromMetadata(account.metadata, days),
      provider: "instagram",
      operation: "insights.account",
      // The API never calls Graph; the worker's `instagram.insights.account` job refreshes the snapshot.
      dry_run: sync.source !== "instagram_graph",
      synced_at: sync.synced_at,
      live_gate: "providers.instagram.live_mode",
      live_call_permitted: false,
    });
  });

  routes.post("/insights/account/refresh", async (context) => {
    const body = await readJson(context);
    const requested = body && typeof body === "object" && "account_public_id" in body ? String((body as { account_public_id: unknown }).account_public_id ?? "").trim() : "";
    const db = context.get("db");
    if (!db) return databaseUnavailable(context);
    const account = await new InstagramRepository(db).findAccount(requested || null);
    if (!account) {
      return context.json({ error: { code: "instagram_not_connected", message: "Instagram bagli degil" } }, 400);
    }
    // One manual refresh per account per 5 minutes (legacy cached Graph answers for the same span).
    const bucket = Math.floor(Date.now() / 300_000);
    const key = `${slug(account.public_id, 60)}_manual_${bucket}`;
    const occurredAt = new Date().toISOString();
    const requestId = `req_instagram_insights_${key}`;
    const jobId = await context.get("providerDeliveryQueuePublisher").publish(
      jobEnvelopeSchema.parse({
        job_id: `job_instagram_insights_${key}`,
        queue: "provider-delivery",
        name: "instagram.insights.account",
        payload: providerDeliveryJobPayloadSchema.parse({
          envelope: {
            request_id: requestId,
            provider: "instagram",
            operation: "insights.account",
            direction: "outbound",
            channel: "instagram",
            account_public_id: account.public_id,
            occurred_at: occurredAt,
            payload: { days: 30, reason: "manual" },
            legacy_contract: { source: "server.js GET /api/instagram/insights/account", legacy_event: "instagram_insights_account" },
          },
        }),
        requested_at: occurredAt,
        request_id: context.get("requestId"),
      }),
    );
    return context.json(
      { account_public_id: account.public_id, request_id: requestId, job_id: jobId, queued: jobId !== null, live_gate: "providers.instagram.live_mode", live_call_permitted: false },
      202,
    );
  });

  return routes;
}
