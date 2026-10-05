import type { AppDatabase } from "@garanti-kulucka/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const routeMocks = vi.hoisted(() => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const comment = {
    id: 7,
    public_id: "scm_ig_1",
    integration_account_id: null,
    platform: "instagram",
    external_comment_id: "17890000000000001",
    media_id: "media_1",
    post_id: null,
    username: "civciv_sever",
    text: "Fiyat nedir?",
    status: "manual",
    classification: "soru",
    classification_reason: "fiyat sorusu",
    confidence: "0.810",
    ai_reply_draft: "Fiyatımız 2550 TL efendim.",
    manual_reply: null,
    reply_type: null,
    error_message: null,
    received_at: now,
    created_at: now,
    updated_at: now,
  };
  let role = "calisan";

  return {
    now,
    comment,
    setRole: (next: string) => {
      role = next;
    },
    authRepository: {
      findUserByPublicId: vi.fn(async () => ({
        id: 10,
        public_id: "usr_test",
        role_id: 1,
        email: "calisan@example.com",
        password_hash: "hash",
        first_name: "Calisan",
        last_name: "User",
        phone: null,
        is_active: true,
        is_online: false,
        last_seen_at: null,
        sip_username: null,
        sip_password_encrypted: null,
        created_at: now,
        updated_at: now,
        role_name: role,
      })),
      findSessionByPublicId: vi.fn(async () => ({
        id: 100,
        public_id: "ses_test",
        user_id: 10,
        user_agent: null,
        ip_address: null,
        expires_at: new Date("2099-02-01T00:00:00.000Z"),
        revoked_at: null,
        created_at: now,
        updated_at: now,
      })),
    },
    commentRepository: {
      listComments: vi.fn(async () => ({ rows: [comment], total: 1 })),
      getStatusCounts: vi.fn(async () => ({
        pending: 1,
        manual: 7,
        auto_replied: 2,
        replied: 11,
        deleted: 3,
        hidden: 4,
        error: 0,
      })),
      findComment: vi.fn(async (publicId: string) => (publicId === comment.public_id ? comment : undefined)),
      findActionByIdempotencyKey: vi.fn(async (): Promise<unknown> => undefined),
      recordAction: vi.fn(async (input: { action: string; nextStatus: string; jobId: string | null; queued: boolean; idempotencyKey: string }) => ({
        comment: { ...comment, status: input.nextStatus },
        action: {
          id: 1,
          public_id: "sca_1",
          comment_id: comment.id,
          action: input.action,
          idempotency_key: input.idempotencyKey,
          request_payload: {},
          job_id: input.jobId,
          queued: input.queued,
          actor_user_id: 10,
          created_at: now,
          updated_at: now,
        },
        replayed: false,
      })),
      getConfig: vi.fn(async () => ({
        enabled: true,
        platforms: { instagram: true, facebook: false },
        reply_type: "public",
        delete_profanity: true,
        delete_brand_disparagement: true,
        risk_manual_examples: [],
        auto_reply_topics: [],
        min_confidence: 0.55,
      })),
      saveConfig: vi.fn(async (config: unknown) => config),
    },
  };
});

vi.mock("../src/auth/repository.js", () => ({
  AuthRepository: vi.fn(function AuthRepository() {
    return routeMocks.authRepository;
  }),
  isAdminRole: (role: string) => role === "admin" || role === "owner",
}));

vi.mock("../src/comments/repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/comments/repository.js")>();
  return {
    ...actual,
    CommentRepository: vi.fn(function CommentRepository() {
      return routeMocks.commentRepository;
    }),
  };
});

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "comment-moderation-route-test-secret",
  encryptionKey: "comment-moderation-encryption-k",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

const published: unknown[] = [];
const publisher = {
  publish: vi.fn(async (job: { job_id: string }) => {
    published.push(job);
    return job.job_id;
  }),
};

async function token(role = "calisan") {
  routeMocks.setRole(role);
  return signAccessToken({ user_public_id: "usr_test", session_public_id: "ses_test", role }, config);
}

function app() {
  return createApp({ config, db: {} as AppDatabase, providerDeliveryQueuePublisher: publisher as never });
}

async function post(path: string, body: unknown, role = "calisan") {
  return app().request(path, {
    method: "POST",
    headers: { authorization: `Bearer ${await token(role)}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("comment moderation routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    published.length = 0;
  });

  it("lists comments with legacy status/platform/search filters and pagination", async () => {
    const response = await app().request("/api/comments?status=manual&platform=instagram&q=fiyat&page=2&page_size=30", {
      headers: { authorization: `Bearer ${await token()}` },
    });

    expect(response.status).toBe(200);
    expect(routeMocks.commentRepository.listComments).toHaveBeenCalledWith({
      status: "manual",
      platform: "instagram",
      query: "fiyat",
      limit: 30,
      offset: 30,
    });
    await expect(response.json()).resolves.toMatchObject({
      total: 1,
      page: 2,
      data: [{ public_id: "scm_ig_1", status: "manual", confidence: 0.81, username: "civciv_sever" }],
    });
  });

  it("rejects unknown filters and denies cargo operators", async () => {
    const invalid = await app().request("/api/comments?status=bogus", {
      headers: { authorization: `Bearer ${await token()}` },
    });
    expect(invalid.status).toBe(400);

    const forbidden = await app().request("/api/comments/stats", {
      headers: { authorization: `Bearer ${await token("kargo_operatoru")}` },
    });
    expect(forbidden.status).toBe(403);
  });

  it("returns stats, settings and control report", async () => {
    const auth = { authorization: `Bearer ${await token("admin")}` };
    const stats = await app().request("/api/comments/stats", { headers: auth });
    await expect(stats.json()).resolves.toMatchObject({ counts: { manual: 7, replied: 11 } });

    const control = await app().request("/api/comments/control", { headers: auth });
    await expect(control.json()).resolves.toMatchObject({ status: "warning", summary: { error: 0 } });

    const saved = await app().request("/api/comments/settings", {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        enabled: false,
        platforms: { instagram: true, facebook: true },
        reply_type: "private",
        delete_profanity: true,
        delete_brand_disparagement: false,
        risk_manual_examples: ["iade"],
        auto_reply_topics: ["fiyat"],
        min_confidence: 0.7,
      }),
    });
    expect(saved.status).toBe(200);
    expect(routeMocks.commentRepository.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ reply_type: "private", risk_manual_examples: ["iade"] }),
      expect.objectContaining({ actorUserId: 10 }),
    );
  });

  it("queues public and private replies as Instagram provider-delivery jobs with idempotency", async () => {
    const response = await post("/api/comments/scm_ig_1/reply", {
      message: "Fiyatımız 2550 TL efendim.",
      reply_type: "public",
      idempotency_key: "yorum-reply-1",
    });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      provider: "instagram",
      operation: "comment.reply",
      queued: true,
      job_id: "job_comment_yorum_reply_1",
      live_call_permitted: false,
      comment: { status: "replied" },
    });
    expect(published[0]).toMatchObject({
      queue: "provider-delivery",
      name: "instagram.comment.reply",
      payload: {
        envelope: {
          provider: "instagram",
          operation: "comment.reply",
          payload: { comment_id: "17890000000000001", message: "Fiyatımız 2550 TL efendim.", idempotency_key: "yorum-reply-1" },
        },
      },
    });

    const privateReply = await post("/api/comments/scm_ig_1/reply", {
      message: "DM ile yazdık",
      reply_type: "private",
      idempotency_key: "yorum-dm-1",
    });
    expect(privateReply.status).toBe(202);
    expect(published[1]).toMatchObject({ name: "instagram.comment.private_reply" });
    expect(routeMocks.commentRepository.recordAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "private_reply", replyType: "private", nextStatus: "replied" }),
    );
  });

  it("queues hide and delete, marks manual without provider call", async () => {
    expect((await post("/api/comments/scm_ig_1/hide", { idempotency_key: "hide-1" })).status).toBe(202);
    expect((await post("/api/comments/scm_ig_1/delete", { idempotency_key: "delete-1" })).status).toBe(202);
    expect((await post("/api/comments/scm_ig_1/manual", { idempotency_key: "manual-1" })).status).toBe(202);
    expect(published.map((job) => (job as { name: string }).name)).toEqual([
      "instagram.comment.hide",
      "instagram.comment.delete",
    ]);
    expect(routeMocks.commentRepository.recordAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "mark_manual", nextStatus: "manual", jobId: null, queued: false }),
    );
  });

  it("replays an idempotent action without re-publishing and rejects key reuse on another action", async () => {
    routeMocks.commentRepository.findActionByIdempotencyKey.mockResolvedValueOnce({
      comment_id: 7,
      action: "hide",
      job_id: "job_comment_hide_1",
      queued: true,
    });
    const replay = await post("/api/comments/scm_ig_1/hide", { idempotency_key: "hide-1" });
    expect(replay.status).toBe(202);
    await expect(replay.json()).resolves.toMatchObject({ replayed: true, job_id: "job_comment_hide_1" });
    expect(publisher.publish).not.toHaveBeenCalled();

    routeMocks.commentRepository.findActionByIdempotencyKey.mockResolvedValueOnce({
      comment_id: 7,
      action: "hide",
      job_id: "job_comment_hide_1",
      queued: true,
    });
    const conflict = await post("/api/comments/scm_ig_1/delete", { idempotency_key: "hide-1" });
    expect(conflict.status).toBe(409);
  });

  it("validates payloads, 404s unknown comments and keeps AI suggestion dry-run", async () => {
    expect((await post("/api/comments/scm_ig_1/reply", { message: "", idempotency_key: "x" })).status).toBe(400);
    expect((await post("/api/comments/scm_ig_1/hide", {})).status).toBe(400);
    expect((await post("/api/comments/scm_missing/hide", { idempotency_key: "h" })).status).toBe(404);

    const suggestion = await post("/api/comments/scm_ig_1/ai-suggestion", {});
    expect(suggestion.status).toBe(200);
    await expect(suggestion.json()).resolves.toMatchObject({
      dry_run: true,
      live_call_permitted: false,
      suggestion: "Fiyatımız 2550 TL efendim.",
    });
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
