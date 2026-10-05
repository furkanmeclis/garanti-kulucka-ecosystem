import type { AppDatabase } from "@garanti-kulucka/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const routeMocks = vi.hoisted(() => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const conversation = {
    id: 1,
    public_id: "cnv_media",
    customer_id: 2,
    assigned_user_id: null,
    integration_account_id: null,
    channel: "instagram",
    external_thread_id: "thread_1",
    status: "open",
    is_in_pool: false,
    human_agent_enabled: true,
    unread_count: 0,
    last_message_text: "Merhaba",
    last_message_sender_type: "user",
    last_message_at: now,
    notes: "Konuşma notu",
    created_at: now,
    updated_at: now,
    customer_full_name: "Slice Müşteri",
    customer_phone: "555",
    assigned_user_email: null,
  };
  const shortcut = {
    id: 10,
    public_id: "msc_test",
    code: "pdf",
    message: "PDF gönderiyorum",
    type: "custom",
    is_active: true,
    sort_order: 999,
    created_by_user_id: 10,
    created_at: now,
    updated_at: now,
    attachments: [
      {
        id: 20,
        public_id: "msa_test",
        shortcut_id: 10,
        file_id: 30,
        attachment_type: "document",
        sort_order: 0,
        created_at: now,
        updated_at: now,
        file_public_id: "fil_pdf",
        original_name: "kilavuz.pdf",
        mime_type: "application/pdf",
        byte_size: 1234,
      },
    ],
  };

  return {
    authRepository: {
      findUserByPublicId: vi.fn(async () => ({
        id: 10,
        public_id: "usr_calisan",
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
        role_name: "calisan",
      })),
      findSessionByPublicId: vi.fn(async () => ({
        id: 100,
        public_id: "ses_calisan",
        user_id: 10,
        user_agent: null,
        ip_address: null,
        expires_at: new Date("2026-02-01T00:00:00.000Z"),
        revoked_at: null,
        created_at: now,
        updated_at: now,
      })),
    },
    domainRepository: {
      createMessage: vi.fn(async (input) => ({
        id: 1,
        public_id: "msg_media",
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
        attachments: [
          {
            id: 1,
            public_id: "mat_media",
            message_id: 1,
            file_id: 30,
            attachment_type: input.attachments[0].attachmentType,
            created_at: now,
            updated_at: now,
            file_public_id: input.attachments[0].filePublicId,
            original_name: "kilavuz.pdf",
            mime_type: "application/pdf",
            byte_size: 1234,
          },
        ],
      })),
      updateConversationNotes: vi.fn(async () => conversation),
      updateCustomerNotes: vi.fn(async () => ({
        id: 2,
        public_id: "cus_media",
        full_name: "Slice Müşteri",
        phone: "555",
        email: null,
        username: null,
        notes: "Müşteri notu",
        created_at: now,
        updated_at: now,
      })),
      listMessageShortcuts: vi.fn(async () => [shortcut]),
      createMessageShortcut: vi.fn(async () => shortcut),
      updateMessageShortcut: vi.fn(async () => ({ ...shortcut, message: "Güncel PDF" })),
      deleteMessageShortcut: vi.fn(async () => shortcut),
    },
  };
});

vi.mock("../src/auth/repository.js", () => ({
  AuthRepository: vi.fn(function AuthRepository() {
    return routeMocks.authRepository;
  }),
  isAdminRole: (role: string) => role === "admin" || role === "owner",
}));

vi.mock("../src/domain/repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/domain/repository.js")>();

  return {
    ...actual,
    DomainRepository: vi.fn(function DomainRepository() {
      return routeMocks.domainRepository;
    }),
  };
});

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "messages-slice2-route-test-secret",
  encryptionKey: "messages-slice2-route-encryption",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

async function accessToken() {
  return signAccessToken(
    {
      user_public_id: "usr_calisan",
      session_public_id: "ses_calisan",
      role: "calisan",
    },
    config,
  );
}

function app() {
  return createApp({ config, db: {} as AppDatabase });
}

describe("messages slice 2 routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("binds uploaded media references when creating a message", async () => {
    const response = await app().request("/api/conversations/cnv_media/messages", {
      method: "POST",
      headers: {
        authorization: `Bearer ${await accessToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender_type: "user",
        sender_name: "calisan@example.com",
        body: "PDF ektedir",
        attachments: [{ file_public_id: "fil_pdf", attachment_type: "document" }],
      }),
    });

    expect(response.status).toBe(201);
    expect(routeMocks.domainRepository.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationPublicId: "cnv_media",
        attachments: [{ filePublicId: "fil_pdf", attachmentType: "document" }],
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      attachments: [{ file_public_id: "fil_pdf", attachment_type: "document" }],
    });
  });

  it("autosaves conversation and customer notes through backend endpoints", async () => {
    const token = await accessToken();
    const conversationResponse = await app().request("/api/conversations/cnv_media/notes", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ notes: "Konuşma notu" }),
    });
    const customerResponse = await app().request("/api/conversations/cnv_media/customer-notes", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ notes: "Müşteri notu" }),
    });

    expect(conversationResponse.status).toBe(200);
    expect(customerResponse.status).toBe(200);
    expect(routeMocks.domainRepository.updateConversationNotes).toHaveBeenCalledWith({
      conversationPublicId: "cnv_media",
      notes: "Konuşma notu",
    });
    expect(routeMocks.domainRepository.updateCustomerNotes).toHaveBeenCalledWith({
      conversationPublicId: "cnv_media",
      notes: "Müşteri notu",
    });
  });

  it("provides shortcut CRUD and AI reply suggestion dry-run boundary", async () => {
    const token = await accessToken();
    const listResponse = await app().request("/api/message-shortcuts", {
      headers: { authorization: `Bearer ${token}` },
    });
    const createResponse = await app().request("/api/message-shortcuts", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        code: "pdf",
        message: "PDF gönderiyorum",
        attachments: [{ file_public_id: "fil_pdf", attachment_type: "document" }],
      }),
    });
    const updateResponse = await app().request("/api/message-shortcuts/msc_test", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ message: "Güncel PDF" }),
    });
    const deleteResponse = await app().request("/api/message-shortcuts/msc_test", {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    const aiResponse = await app().request("/api/ai/reply-suggestion", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ conversation_public_id: "cnv_media" }),
    });

    expect(listResponse.status).toBe(200);
    expect(createResponse.status).toBe(201);
    expect(updateResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    expect(aiResponse.status).toBe(200);
    await expect(aiResponse.json()).resolves.toMatchObject({
      dry_run: true,
      live_call_permitted: false,
      provider: "openai",
    });
  });
});
