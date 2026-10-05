import type { AppDatabase, Database } from "@garanti-kulucka/database";
import type { Selectable } from "kysely";
import { newPublicId } from "../auth/crypto.js";
import type { SettingsRepository } from "../settings/repository.js";

export const commentStatuses = ["pending", "manual", "auto_replied", "replied", "deleted", "hidden", "error"] as const;
export type CommentStatus = (typeof commentStatuses)[number];
export const commentPlatforms = ["instagram", "facebook"] as const;
export type CommentPlatform = (typeof commentPlatforms)[number];
export type CommentActionKind = "reply" | "private_reply" | "hide" | "delete" | "mark_manual";

export type SocialCommentRecord = Selectable<Database["social_comments"]>;
export type SocialCommentActionRecord = Selectable<Database["social_comment_actions"]>;

export const commentSettingsScope = "comments";
export const commentSettingsKey = "comments.moderation_config";

/** Legacy `/api/yorumlar/ayarlar` config shape (commentAiRouter VARSAYILAN_AYAR), stored with English keys. */
export interface CommentModerationConfig {
  enabled: boolean;
  platforms: { instagram: boolean; facebook: boolean };
  reply_type: "public" | "private";
  delete_profanity: boolean;
  delete_brand_disparagement: boolean;
  risk_manual_examples: string[];
  auto_reply_topics: string[];
  min_confidence: number;
}

export const defaultCommentModerationConfig: CommentModerationConfig = {
  enabled: true,
  platforms: { instagram: true, facebook: true },
  reply_type: "public",
  delete_profanity: true,
  delete_brand_disparagement: true,
  risk_manual_examples: [],
  auto_reply_topics: [],
  min_confidence: 0.55,
};

export interface ListCommentsFilter {
  status?: CommentStatus;
  platform?: CommentPlatform;
  query?: string;
  limit: number;
  offset: number;
}

export interface RecordCommentActionInput {
  commentPublicId: string;
  action: CommentActionKind;
  idempotencyKey: string;
  requestPayload: Record<string, unknown>;
  jobId: string | null;
  queued: boolean;
  actorUserId: number | null;
  nextStatus: CommentStatus;
  manualReply?: string | null;
  replyType?: "public" | "private" | null;
}

export interface RecordCommentActionResult {
  comment: SocialCommentRecord;
  action: SocialCommentActionRecord;
  replayed: boolean;
}

export class CommentIdempotencyConflictError extends Error {
  constructor(key: string) {
    super(`Comment action idempotency key reuse mismatch: ${key}`);
    this.name = "CommentIdempotencyConflictError";
  }
}

export class CommentRepository {
  constructor(
    private readonly db: AppDatabase,
    private readonly settings: SettingsRepository | null = null,
  ) {}

  async listComments(filter: ListCommentsFilter): Promise<{ rows: SocialCommentRecord[]; total: number }> {
    const query = filter.query?.trim();
    const base = this.db
      .selectFrom("social_comments")
      .$if(Boolean(filter.status), (builder) => builder.where("status", "=", filter.status as string))
      .$if(Boolean(filter.platform), (builder) => builder.where("platform", "=", filter.platform as string))
      .$if(Boolean(query), (builder) =>
        builder.where((eb) =>
          eb.or([eb("text", "ilike", `%${query}%`), eb("username", "ilike", `%${query}%`)]),
        ),
      );

    const [rows, count] = await Promise.all([
      base
        .selectAll()
        .orderBy("received_at", "desc")
        .orderBy("id", "desc")
        .limit(filter.limit)
        .offset(filter.offset)
        .execute(),
      base.select((eb) => eb.fn.countAll<string>().as("count")).executeTakeFirst(),
    ]);

    return { rows, total: Number(count?.count ?? 0) };
  }

  async getStatusCounts(): Promise<Record<CommentStatus, number>> {
    const rows = await this.db
      .selectFrom("social_comments")
      .select(["status", (eb) => eb.fn.countAll<string>().as("count")])
      .groupBy("status")
      .execute();
    const counts = Object.fromEntries(commentStatuses.map((status) => [status, 0])) as Record<CommentStatus, number>;
    for (const row of rows) {
      if ((commentStatuses as readonly string[]).includes(row.status)) {
        counts[row.status as CommentStatus] = Number(row.count);
      }
    }
    return counts;
  }

  async findComment(publicId: string): Promise<SocialCommentRecord | undefined> {
    return this.db.selectFrom("social_comments").selectAll().where("public_id", "=", publicId).executeTakeFirst();
  }

  async findActionByIdempotencyKey(idempotencyKey: string): Promise<SocialCommentActionRecord | undefined> {
    return this.db
      .selectFrom("social_comment_actions")
      .selectAll()
      .where("idempotency_key", "=", idempotencyKey)
      .executeTakeFirst();
  }

  async recordAction(input: RecordCommentActionInput): Promise<RecordCommentActionResult> {
    return this.db.transaction().execute(async (transaction) => {
      const comment = await transaction
        .selectFrom("social_comments")
        .selectAll()
        .where("public_id", "=", input.commentPublicId)
        .forUpdate()
        .executeTakeFirst();
      if (!comment) {
        throw new Error(`Unknown comment: ${input.commentPublicId}`);
      }

      const existing = await transaction
        .selectFrom("social_comment_actions")
        .selectAll()
        .where("idempotency_key", "=", input.idempotencyKey)
        .executeTakeFirst();
      if (existing) {
        if (existing.comment_id !== comment.id || existing.action !== input.action) {
          throw new CommentIdempotencyConflictError(input.idempotencyKey);
        }
        return { comment, action: existing, replayed: true };
      }

      const action = await transaction
        .insertInto("social_comment_actions")
        .values({
          public_id: newPublicId("sca"),
          comment_id: comment.id,
          action: input.action,
          idempotency_key: input.idempotencyKey,
          request_payload: input.requestPayload,
          job_id: input.jobId,
          queued: input.queued,
          actor_user_id: input.actorUserId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const updated = await transaction
        .updateTable("social_comments")
        .set({
          status: input.nextStatus,
          ...(input.manualReply !== undefined ? { manual_reply: input.manualReply } : {}),
          ...(input.replyType !== undefined ? { reply_type: input.replyType } : {}),
          error_message: null,
          updated_at: new Date(),
        })
        .where("id", "=", comment.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      return { comment: updated, action, replayed: false };
    });
  }

  async getConfig(): Promise<CommentModerationConfig> {
    if (!this.settings) {
      return defaultCommentModerationConfig;
    }
    const settings = await this.settings.list(commentSettingsScope);
    const stored = settings.find((setting) => setting.key === commentSettingsKey);
    return normalizeCommentConfig(stored?.value);
  }

  async saveConfig(
    config: CommentModerationConfig,
    actor: { actorUserId: number | null; ipAddress: string | null; userAgent: string | null },
  ): Promise<CommentModerationConfig> {
    if (!this.settings) {
      throw new Error("Settings repository is not configured");
    }
    const { setting } = await this.settings.upsert({
      key: commentSettingsKey,
      scope: commentSettingsScope,
      value: config,
      isSecret: false,
      ...actor,
    });
    return normalizeCommentConfig(setting.value);
  }
}

export function normalizeCommentConfig(value: unknown): CommentModerationConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultCommentModerationConfig;
  }
  const raw = value as Partial<CommentModerationConfig>;
  return {
    ...defaultCommentModerationConfig,
    ...raw,
    platforms: { ...defaultCommentModerationConfig.platforms, ...(raw.platforms ?? {}) },
  };
}

export function serializeComment(comment: SocialCommentRecord) {
  return {
    public_id: comment.public_id,
    platform: comment.platform,
    external_comment_id: comment.external_comment_id,
    media_id: comment.media_id,
    post_id: comment.post_id,
    username: comment.username,
    text: comment.text,
    status: comment.status,
    classification: comment.classification,
    classification_reason: comment.classification_reason,
    confidence: comment.confidence === null ? null : Number(comment.confidence),
    ai_reply_draft: comment.ai_reply_draft,
    manual_reply: comment.manual_reply,
    reply_type: comment.reply_type,
    error_message: comment.error_message,
    received_at: new Date(comment.received_at).toISOString(),
    updated_at: new Date(comment.updated_at).toISOString(),
  };
}
