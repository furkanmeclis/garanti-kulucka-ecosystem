import type { AppDatabase } from "@garanti-kulucka/database";
import type { JobEnvelope } from "@garanti-kulucka/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const mocks = vi.hoisted(() => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const conversation = {
    id: 1,
    public_id: "cnv_ai",
    customer_id: 2,
    assigned_user_id: null,
    integration_account_id: null,
    channel: "whatsapp",
    external_thread_id: null,
    status: "open",
    is_in_pool: false,
    human_agent_enabled: false,
    unread_count: 1,
    last_message_text: "Kargom nerede?",
    last_message_sender_type: "customer",
    last_message_at: now,
    notes: null,
    created_at: now,
    updated_at: now,
    customer_full_name: "AI Müşteri",
    customer_phone: "05551234567",
    assigned_user_email: null,
  };
  return {
    now,
    conversation,
    role: "calisan",
    draft: vi.fn(async () => ({
      provider: "openai" as const,
      operation: "messages.reply_suggestion" as const,
      dry_run: true,
      live_call_permitted: false,
      suggestion: "AI yanıt önerisi backend dry-run sınırında tutuldu.",
    })),
    authRepository: {
      findUserByPublicId: vi.fn(async () => ({
        id: 10,
        public_id: "usr_test",
        role_id: 1,
        email: "test@example.com",
        password_hash: "hash",
        first_name: "Test",
        last_name: "User",
        phone: null,
        is_active: true,
        is_online: true,
        last_seen_at: null,
        sip_username: null,
        sip_password_encrypted: null,
        created_at: now,
        updated_at: now,
        role_name: mocks.role,
      })),
      findSessionByPublicId: vi.fn(async () => ({
        id: 100,
        public_id: "ses_test",
        user_id: 10,
        user_agent: null,
        ip_address: null,
        expires_at: new Date("2099-01-01T00:00:00.000Z"),
        revoked_at: null,
        created_at: now,
        updated_at: now,
      })),
    },
    domainRepository: {
      getConversation: vi.fn(async (): Promise<Record<string, unknown> | null> => mocks.conversation),
      getConversationDeliveryTarget: vi.fn(async () => ({ public_id: "cnv_ai", channel: "whatsapp", external_thread_id: null, customer_phone: "05551234567" })),
      createMessage: vi.fn(async (input: { senderType: string; senderName: string | null; body: string | null }) => ({
        id: 7,
        public_id: "msg_ai",
        conversation_id: 1,
        sender_type: input.senderType,
        sender_name: input.senderName,
        body: input.body,
        external_message_id: null,
        is_read: true,
        sent_at: now,
        raw_payload: null,
        created_at: now,
        updated_at: now,
        attachments: [],
      })),
    },
  };
});

vi.mock("../src/auth/repository.js", () => ({
  AuthRepository: vi.fn(function AuthRepository() {
    return mocks.authRepository;
  }),
  isAdminRole: (role: string) => role === "admin" || role === "owner",
}));

vi.mock("../src/domain/repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/domain/repository.js")>();
  return {
    ...actual,
    DomainRepository: vi.fn(function DomainRepository() {
      return mocks.domainRepository;
    }),
  };
});

vi.mock("../src/ai/reply.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ai/reply.js")>();
  return { ...actual, draftConversationReply: mocks.draft };
});

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { ConversationNotAwaitingReplyError } = await import("../src/domain/repository.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "ai-reply-route-test-secret",
  encryptionKey: "ai-reply-route-encryption-key",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

const publishedJobs: JobEnvelope[] = [];

function app() {
  return createApp({
    config,
    db: {} as AppDatabase,
    providerDeliveryQueuePublisher: {
      publish: async (job) => {
        publishedJobs.push(job);
        return job.job_id;
      },
    },
  });
}

async function send(role = "calisan", conversation = "cnv_ai") {
  mocks.role = role;
  const token = await signAccessToken({ user_public_id: "usr_test", session_public_id: "ses_test", role }, config);
  return app().request(`/api/conversations/${conversation}/ai-reply`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
}

const liveDraft = {
  provider: "openai" as const,
  operation: "messages.reply_suggestion" as const,
  dry_run: false,
  live_call_permitted: true,
  suggestion: "  Siparişiniz bugün kargoya verildi.  ",
};

describe("AI üret ve gönder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publishedJobs.length = 0;
  });

  it("never sends a dry-run draft to the customer and returns it as a suggestion", async () => {
    const response = await send();
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ai_live_disabled", suggestion: "AI yanıt önerisi backend dry-run sınırında tutuldu.", dry_run: true },
    });
    expect(mocks.domainRepository.createMessage).not.toHaveBeenCalled();
    expect(publishedJobs).toHaveLength(0);
  });

  it("does not answer a conversation whose last message is already answered", async () => {
    mocks.domainRepository.getConversation.mockResolvedValueOnce({ ...mocks.conversation, last_message_sender_type: "user" });
    const response = await send();
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "already_answered" } });
    expect(mocks.draft).not.toHaveBeenCalled();
    expect(mocks.domainRepository.createMessage).not.toHaveBeenCalled();
  });

  it("sends a live draft as an AI message through the provider-delivery queue", async () => {
    mocks.draft.mockResolvedValueOnce(liveDraft);
    const response = await send();
    expect(response.status).toBe(201);
    expect(mocks.domainRepository.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ conversationPublicId: "cnv_ai", senderType: "ai", body: "Siparişiniz bugün kargoya verildi.", onlyIfAwaitingReply: true }),
    );
    await expect(response.json()).resolves.toMatchObject({
      public_id: "msg_ai",
      sender_type: "ai",
      delivery: { provider: "whatsapp", queued: true, job_ids: ["job_ai_msg_ai_0"], live_gate: "providers.whatsapp.live_mode" },
    });
    expect(publishedJobs[0]).toMatchObject({
      name: "whatsapp.message.send",
      payload: { envelope: { payload: { to: "905551234567", message: "Siparişiniz bugün kargoya verildi.", idempotency_key: "ai_msg_ai_0" }, legacy_contract: { legacy_event: "ai_reply_send" } } },
    });
  });

  it("loses a concurrent race cleanly when another reply landed first", async () => {
    mocks.draft.mockResolvedValueOnce(liveDraft);
    mocks.domainRepository.createMessage.mockRejectedValueOnce(new ConversationNotAwaitingReplyError("ai"));
    const response = await send();
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "already_answered" } });
    expect(publishedJobs).toHaveLength(0);
  });

  it("rejects unknown conversations, empty drafts and the cargo role", async () => {
    mocks.domainRepository.getConversation.mockResolvedValueOnce(null);
    expect((await send("calisan", "cnv_missing")).status).toBe(404);

    mocks.draft.mockResolvedValueOnce({ ...liveDraft, suggestion: "   " });
    const empty = await send();
    expect(empty.status).toBe(422);

    expect((await send("kargo_operatoru")).status).toBe(403);
    expect(mocks.domainRepository.createMessage).not.toHaveBeenCalled();
  });
});
