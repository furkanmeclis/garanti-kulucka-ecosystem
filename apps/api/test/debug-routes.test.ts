import type { AppDatabase } from "@garanti-kulucka/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const mocks = vi.hoisted(() => {
  const now = new Date("2026-10-06T09:00:00.000Z");
  const settings: Record<string, unknown> = { "providers.whatsapp.live_mode": false, "ai.auto_reply_enabled": true, "ai.model": "gpt-4o-mini", "ai.system_prompt": "Kibar ol." };
  return {
    roleName: "admin",
    published: [] as Array<{ job_id: string; payload: { envelope: Record<string, unknown> } }>,
    authRepository: {
      findUserByPublicId: vi.fn(async () => ({ id: 10, public_id: "usr_test", role_id: 1, email: "admin@example.com", password_hash: "hash", first_name: "Test", last_name: "Admin", phone: null, is_active: true, is_online: false, last_seen_at: null, sip_username: null, sip_password_encrypted: null, created_at: now, updated_at: now, role_name: mocks.roleName })),
      findSessionByPublicId: vi.fn(async () => ({ id: 100, public_id: "ses_test", user_id: 10, user_agent: null, ip_address: null, expires_at: new Date("2099-01-01"), revoked_at: null, created_at: now, updated_at: now })),
    },
    repository: {
      providerAccounts: vi.fn(async (keys: string[]) =>
        keys.includes("whatsapp")
          ? [{ provider_key: "whatsapp", account_public_id: "iac_wa", display_name: "WhatsApp", status: "active", external_account_id: "1234567890", settings: { waba_id: "998877", display_phone_number: "905551112233" }, secret_settings: ["webhook.verify_token"], token_types: ["access_token"] }]
          : [{ provider_key: "instagram", account_public_id: "iac_ig", display_name: "Instagram", status: "active", external_account_id: "17841", settings: { live_mode: true }, secret_settings: [], token_types: [] }],
      ),
      globalSetting: vi.fn(async (key: string) => settings[key]),
      channelStats: vi.fn(async () => ({ conversation_count: 3, today_inbound: 5, today_outbound: 4 })),
      recentWebhookEvents: vi.fn(async () => [
        { public_id: "whe_1", provider_key: "whatsapp", event_type: "message.webhook", status: "processed", received_at: now, processed_at: now, raw_payload: { entry: [{ text: "merhaba", access_token: "EAAG-secret" }] } },
      ]),
      recentProviderAttempts: vi.fn(async () => [{ request_id: "req_1", provider_key: "whatsapp", operation: "message.send", status: "success", status_code: 202, duration_ms: 12, error_message: null, started_at: now }]),
      aiStats: vi.fn(async () => ({ today_ai_replies: 2, total_ai_replies: 40 })),
      recentAiMessages: vi.fn(async () => [{ public_id: "msg_ai", body: "Merhaba!", sent_at: now, conversation_public_id: "cnv_1", channel: "whatsapp", customer_name: "Ayşe", customer_phone: "0555" }]),
      trainingStats: vi.fn(async (answeredOnly: boolean) => ({ total: 7, by_channel: { whatsapp: 5, instagram: 2, messenger: 0 }, answered_only: answeredOnly })),
      trainingConversations: vi.fn(async () => [
        { public_id: "cnv_1", channel: "whatsapp", created_at: now, customer_name: "Ayşe", messages: [{ sender_type: "customer", body: "Fiyat?", sent_at: now }, { sender_type: "user", body: "2550 TL", sent_at: now }] },
        { public_id: "cnv_2", channel: "instagram", created_at: now, customer_name: null, messages: [{ sender_type: "user", body: "Merhaba", sent_at: now }, { sender_type: "customer", body: "Selam", sent_at: now }] },
      ]),
    },
  };
});

vi.mock("../src/auth/repository.js", () => ({
  AuthRepository: vi.fn(function AuthRepository() {
    return mocks.authRepository;
  }),
  isAdminRole: (role: string) => role === "admin" || role === "owner",
}));

vi.mock("../src/debug/repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/debug/repository.js")>();
  return { ...actual, DebugRepository: vi.fn(function DebugRepository() { return mocks.repository; }) };
});

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { payloadPreview } = await import("../src/http/debug-routes.js");
const { formatTrainingExport } = await import("../src/debug/training.js");

const config: ApiConfig = { databaseUrl: null, jwtSecret: "debug-route-test-secret", encryptionKey: "debug-route-encryption-key", encryptionKeyId: "test", accessTokenTtlSeconds: 300, refreshTokenTtlDays: 30, redisUrl: null, corsOrigin: null };
const publisher = { publish: vi.fn(async (job: (typeof mocks.published)[number]) => { mocks.published.push(job); return job.job_id; }) };

async function call(method: string, path: string, body?: unknown, role = "admin") {
  mocks.roleName = role;
  const token = await signAccessToken({ user_public_id: "usr_test", session_public_id: "ses_test", role }, config);
  return createApp({ config, db: {} as AppDatabase, providerDeliveryQueuePublisher: publisher as never }).request(path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("debug routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.published.length = 0;
  });

  it("is manager-only", async () => {
    for (const role of ["calisan", "kargo_operatoru"]) {
      expect((await call("GET", "/api/debug/whatsapp", undefined, role)).status).toBe(403);
      expect((await call("GET", "/api/debug/ai-training/export", undefined, role)).status).toBe(403);
    }
    expect((await call("GET", "/api/debug/ai", undefined, "owner")).status).toBe(200);
  });

  it("reports WhatsApp config without secrets, stats, redacted webhooks and attempts", async () => {
    const response = await call("GET", "/api/debug/whatsapp");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      live_gate: "providers.whatsapp.live_mode",
      provider_live_mode: false,
      callback_path: "/webhooks/whatsapp",
      config: { phone_number_id: "1234567890", waba_id: "998877", access_token_configured: true, verify_token_configured: true, live_call_permitted: false },
      stats: { today_inbound: 5, today_outbound: 4, conversation_count: 3 },
      attempts: [{ request_id: "req_1", operation: "message.send" }],
    });
    expect(body.webhooks[0].preview).toContain("merhaba");
    expect(JSON.stringify(body)).not.toContain("EAAG-secret");
  });

  it("queues the WhatsApp test message as a gated provider job", async () => {
    const response = await call("POST", "/api/debug/whatsapp/test-send", { to: "+90 555 111 22 33", idempotency_key: "wa-test-1" });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ provider: "whatsapp", queued: true, to: "905551112233", live_call_permitted: false, account_public_id: "iac_wa" });
    expect(mocks.published[0]?.payload.envelope).toMatchObject({ provider: "whatsapp", operation: "message.send", account_public_id: "iac_wa", payload: { to: "905551112233", idempotency_key: "wa-test-1" } });
    const bad = await call("POST", "/api/debug/whatsapp/test-send", { to: "12", idempotency_key: "k" });
    await expect(bad.json()).resolves.toMatchObject({ error: { message: "Telefon numarası gerekli" } });
  });

  it("reports Instagram/Messenger accounts and live state", async () => {
    const body = await (await call("GET", "/api/debug/instagram")).json();
    expect(body.callback_paths).toEqual({ instagram: "/webhooks/instagram", messenger: "/webhooks/messenger" });
    expect(body.accounts[0]).toMatchObject({ provider: "instagram", account_live_mode: true, live_call_permitted: false });
  });

  it("shows AI config/stats/recent replies and keeps the AI test in dry run", async () => {
    const debug = await (await call("GET", "/api/debug/ai")).json();
    expect(debug).toMatchObject({
      config: { auto_reply_enabled: true, model: "gpt-4o-mini", system_prompt_source: "database", system_prompt_length: 9, live_call_permitted: false },
      stats: { today_ai_replies: 2, total_ai_replies: 40 },
      recent: [{ body: "Merhaba!", channel: "whatsapp" }],
    });
    const test = await call("POST", "/api/debug/ai/test", { message: "Kuluçka makinesi fiyatı?" });
    await expect(test.json()).resolves.toMatchObject({ dry_run: true, live_call_permitted: false, test_message: "Kuluçka makinesi fiyatı?" });
    expect((await call("POST", "/api/debug/ai/test", { message: " " })).status).toBe(400);
  });

  it("exports AI training data in text/jsonl/json with stats", async () => {
    await expect((await call("GET", "/api/debug/ai-training/stats?answered_only=false")).json()).resolves.toMatchObject({ total: 7, answered_only: false });
    const text = await call("GET", "/api/debug/ai-training/export?format=text&offset=0&limit=50&channel=whatsapp");
    expect(text.headers.get("content-type")).toContain("text/plain");
    expect(text.headers.get("content-disposition")).toBe('attachment; filename="ai-egitim-0-50.txt"');
    expect(text.headers.get("x-export-count")).toBe("1");
    expect(await text.text()).toBe("### Konuşma 1 (whatsapp)\nMüşteri: Fiyat?\nTemsilci: 2550 TL\n");
    expect(mocks.repository.trainingConversations).toHaveBeenCalledWith({ channel: "whatsapp", answeredOnly: true, minMessages: 2, offset: 0, limit: 50 });
    const jsonl = await call("GET", "/api/debug/ai-training/export?format=jsonl");
    expect(JSON.parse((await jsonl.text()).trim())).toMatchObject({ messages: [{ role: "system" }, { role: "user", content: "Fiyat?" }, { role: "assistant", content: "2550 TL" }] });
    expect((await call("GET", "/api/debug/ai-training/export?format=csv")).status).toBe(400);
  });

  it("redacts and truncates webhook payload previews", () => {
    expect(payloadPreview('{"hub":{"verify_token":"x"},"ok":1}')).toBe('{"hub":{"verify_token":"[redacted]"},"ok":1}');
    expect(payloadPreview({ text: "a".repeat(2000) }).length).toBeLessThanOrEqual(601);
    expect(formatTrainingExport([], "jsonl").body).toBe("");
  });
});
