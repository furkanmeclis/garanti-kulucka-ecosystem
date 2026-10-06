import type { AppDatabase, Database, Selectable } from "@garanti-kulucka/database";
import { newPublicId } from "../auth/crypto.js";

/**
 * Legacy frontend/src/pages/instagram/{YayinlaPage,AnalitikPage}.jsx + server.js
 * `/api/instagram/publish/{photo,video}` and `/api/instagram/insights/account`.
 * Publishing is recorded here and delivered by the worker (`instagram.media.publish` on the
 * provider-delivery queue); insights stay a backend dry-run boundary over the stored account
 * analytics snapshot so the browser never talks to Meta.
 */

export type InstagramPublicationRecord = Selectable<Database["instagram_publications"]>;

export interface InstagramAccountRecord {
  id: number;
  public_id: string;
  display_name: string;
  external_account_id: string | null;
  status: string;
  metadata: unknown;
}

export interface InstagramPublicationView extends InstagramPublicationRecord {
  account_public_id: string | null;
  file_public_id: string | null;
  attempt_status: string | null;
  attempt_error_message: string | null;
  attempt_response_metadata: unknown;
}

export interface InstagramMediaFileRecord {
  id: number;
  public_id: string;
  object_key: string;
  mime_type: string | null;
  upload_status: string;
  scan_status: string;
}

export class InstagramPublicationConflictError extends Error {
  constructor() {
    super("Instagram publication idempotency key reuse mismatch");
    this.name = "InstagramPublicationConflictError";
  }
}

export interface RecordInstagramPublicationInput {
  accountId: number | null;
  mediaKind: "image" | "video";
  mediaType: "IMAGE" | "REELS" | "VIDEO";
  mediaUrl: string | null;
  fileId: number | null;
  caption: string;
  idempotencyKey: string;
  requestId: string;
  jobId: string | null;
  queued: boolean;
  createdByUserId: number | null;
}

export class InstagramRepository {
  constructor(private readonly db: AppDatabase) {}

  /** Legacy used one INSTAGRAM_PAGE_ID; the canonical default is the first active Instagram account. */
  async findAccount(accountPublicId: string | null): Promise<InstagramAccountRecord | null> {
    let query = this.db
      .selectFrom("integration_accounts")
      .innerJoin("integration_providers", "integration_providers.id", "integration_accounts.provider_id")
      .select([
        "integration_accounts.id",
        "integration_accounts.public_id",
        "integration_accounts.display_name",
        "integration_accounts.external_account_id",
        "integration_accounts.status",
        "integration_accounts.metadata",
      ])
      .where("integration_providers.key", "=", "instagram");
    if (accountPublicId) {
      query = query.where("integration_accounts.public_id", "=", accountPublicId);
    } else {
      query = query.where("integration_accounts.status", "=", "active");
    }
    const account = await query.orderBy("integration_accounts.id", "asc").executeTakeFirst();
    return account ?? null;
  }

  async findMediaFile(filePublicId: string): Promise<InstagramMediaFileRecord | null> {
    const file = await this.db
      .selectFrom("files")
      .select(["id", "public_id", "object_key", "mime_type", "upload_status", "scan_status"])
      .where("public_id", "=", filePublicId)
      .executeTakeFirst();
    return file ?? null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<InstagramPublicationRecord | null> {
    const row = await this.db
      .selectFrom("instagram_publications")
      .selectAll()
      .where("idempotency_key", "=", idempotencyKey)
      .executeTakeFirst();
    return row ?? null;
  }

  async recordPublication(input: RecordInstagramPublicationInput): Promise<InstagramPublicationRecord> {
    const inserted = await this.db
      .insertInto("instagram_publications")
      .values({
        public_id: newPublicId("igp"),
        account_id: input.accountId,
        media_kind: input.mediaKind,
        media_type: input.mediaType,
        media_url: input.mediaUrl,
        file_id: input.fileId,
        caption: input.caption,
        idempotency_key: input.idempotencyKey,
        request_id: input.requestId,
        job_id: input.jobId,
        queued: input.queued,
        created_by_user_id: input.createdByUserId,
      })
      .onConflict((conflict) => conflict.column("idempotency_key").doNothing())
      .returningAll()
      .executeTakeFirst();
    if (inserted) return inserted;
    const existing = await this.findByIdempotencyKey(input.idempotencyKey);
    if (!existing) throw new Error("Instagram publication insert raced without a stored row");
    return existing;
  }

  async getPublication(publicId: string): Promise<InstagramPublicationView | null> {
    const row = await this.db
      .selectFrom("instagram_publications")
      .leftJoin("integration_accounts", "integration_accounts.id", "instagram_publications.account_id")
      .leftJoin("files", "files.id", "instagram_publications.file_id")
      .selectAll("instagram_publications")
      .select([
        "integration_accounts.public_id as account_public_id",
        "files.public_id as file_public_id",
      ])
      .where("instagram_publications.public_id", "=", publicId)
      .executeTakeFirst();
    if (!row) return null;
    const attempt = await this.db
      .selectFrom("provider_attempts")
      .select(["status", "error_message", "response_metadata"])
      .where("request_id", "=", row.request_id)
      .where("operation", "=", "media.publish")
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .executeTakeFirst();
    return {
      ...row,
      attempt_status: attempt?.status ?? null,
      attempt_error_message: attempt?.error_message ?? null,
      attempt_response_metadata: attempt?.response_metadata ?? null,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** media_publish returns `{"id": "<media_id>"}`; the worker stores a redacted body preview. */
export function mediaIdFromAttemptResponse(responseMetadata: unknown): string | null {
  if (!isRecord(responseMetadata)) return null;
  const preview = responseMetadata.body_preview;
  if (typeof preview !== "string" || !preview) return null;
  try {
    const parsed = JSON.parse(preview) as unknown;
    return isRecord(parsed) && typeof parsed.id === "string" && parsed.id ? parsed.id : null;
  } catch {
    return null;
  }
}

export function serializeInstagramPublication(row: InstagramPublicationView | InstagramPublicationRecord) {
  const view = row as Partial<InstagramPublicationView>;
  const attemptStatus = view.attempt_status ?? null;
  const mediaId = mediaIdFromAttemptResponse(view.attempt_response_metadata);
  const status = attemptStatus === null
    ? (row.queued ? "queued" : "recorded")
    : attemptStatus === "success"
      ? (mediaId ? "published" : "dry_run")
      : attemptStatus === "retryable_failure"
        ? "retrying"
        : "failed";
  return {
    public_id: row.public_id,
    account_public_id: view.account_public_id ?? null,
    media_kind: row.media_kind,
    media_type: row.media_type,
    media_url: row.file_id === null ? row.media_url : null,
    file_public_id: view.file_public_id ?? null,
    caption: row.caption,
    idempotency_key: row.idempotency_key,
    request_id: row.request_id,
    job_id: row.job_id,
    queued: row.queued,
    status,
    media_id: mediaId,
    error_message: view.attempt_error_message ?? null,
    created_at: new Date(row.created_at).toISOString(),
  };
}

export interface InstagramInsightMetric {
  name: string;
  period: string;
  title?: string;
  description?: string;
  values: Array<{ value: number; end_time: string }>;
}

const legacyInsightMetrics = ["impressions", "reach", "profile_views"] as const;

function numberFrom(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Legacy `/api/instagram/insights/account?days=N` response shape (`data` = Graph insights
 * metrics, `followers`, `period`) served from the account's stored analytics snapshot
 * (`metadata.analytics.insights` / `metadata.analytics.followers`), windowed to the last N days.
 */
export function instagramAccountInsightsFromMetadata(metadata: unknown, days: number, now: Date = new Date()) {
  const record = isRecord(metadata) ? metadata : {};
  const analytics = isRecord(record.analytics) ? record.analytics : {};
  const until = Math.floor(now.getTime() / 1000);
  const since = until - days * 86_400;
  const rawInsights = Array.isArray(analytics.insights) ? analytics.insights : [];
  const data: InstagramInsightMetric[] = rawInsights
    .filter(isRecord)
    .filter((metric) => typeof metric.name === "string" && (legacyInsightMetrics as readonly string[]).includes(metric.name))
    .map((metric) => {
      const values = (Array.isArray(metric.values) ? metric.values : [])
        .filter(isRecord)
        .map((value) => ({ value: numberFrom(value.value), end_time: typeof value.end_time === "string" ? value.end_time : "" }))
        .filter((value) => {
          const time = Date.parse(value.end_time);
          return Number.isFinite(time) && time / 1000 > since && time / 1000 <= until + 86_400;
        })
        .sort((first, second) => first.end_time.localeCompare(second.end_time));
      return {
        name: metric.name as string,
        period: typeof metric.period === "string" ? metric.period : "day",
        ...(typeof metric.title === "string" ? { title: metric.title } : {}),
        ...(typeof metric.description === "string" ? { description: metric.description } : {}),
        values,
      };
    })
    .sort((first, second) => legacyInsightMetrics.indexOf(first.name as never) - legacyInsightMetrics.indexOf(second.name as never));
  const followersRecord = isRecord(analytics.followers) ? analytics.followers : null;
  const followers = followersRecord
    ? { followers_count: numberFrom(followersRecord.followers_count), media_count: numberFrom(followersRecord.media_count) }
    : analytics.followers !== undefined
      ? { followers_count: numberFrom(analytics.followers), media_count: numberFrom(analytics.media_count) }
      : null;
  return { data, followers, period: { days, since, until } };
}
