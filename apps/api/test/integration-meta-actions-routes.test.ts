import type { AppDatabase } from "@garanti-kulucka/database";
import type { JobEnvelope } from "@garanti-kulucka/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const mocks = vi.hoisted(() => {
  const now = new Date("2026-10-08T08:00:00.000Z");
  let role = "admin";
  const account = {
    id: 5,
    public_id: "iac_instagram_demo",
    provider_id: 3,
    provider_key: "instagram",
    provider_name: "Instagram Graph API",
    display_name: "Instagram",
    external_account_id: "17841400000000000",
    status: "active",
    metadata: {},
    created_at: now,
    updated_at: now,
  };
  return {
    setRole: (next: string) => {
      role = next;
    },
    snapshot: { account, settings: [], tokens: [{ public_id: "itk_1", token_type: "access_token" }] } as Record<string, unknown> | null,
    disconnectCalls: [] as string[],
    deleteCalls: [] as string[],
    authRepository: {
      findUserByPublicId: vi.fn(async () => ({ id: 10, public_id: "usr_test", role_id: 1, email: "x@example.com", password_hash: "hash", first_name: "A", last_name: "B", phone: null, is_active: true, is_online: false, last_seen_at: null, sip_username: null, sip_password_encrypted: null, created_at: now, updated_at: now, role_name: role })),
      findSessionByPublicId: vi.fn(async () => ({ id: 100, public_id: "ses_test", user_id: 10, user_agent: null, ip_address: null, expires_at: new Date("2099-02-01T00:00:00.000Z"), revoked_at: null, created_at: now, updated_at: now })),
    },
  };
});

vi.mock("../src/auth/repository.js", () => ({
  AuthRepository: vi.fn(function AuthRepository() {
    return mocks.authRepository;
  }),
  isAdminRole: (role: string) => role === "admin" || role === "owner",
}));

vi.mock("../src/integrations/repository.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/integrations/repository.js")>()),
  IntegrationsRepository: vi.fn(function IntegrationsRepository() {
    return {
      getAccountSnapshot: async () => mocks.snapshot,
      deleteProviderAttempts: async (input: { providerKey: string; operation: string | null }) => {
        mocks.deleteCalls.push(`${input.providerKey}:${input.operation ?? "*"}`);
        return 3;
      },
      disconnectAccount: async (input: { accountPublicId: string }) => {
        mocks.disconnectCalls.push(input.accountPublicId);
        const snapshot = mocks.snapshot as { account: Record<string, unknown> } | null;
        return snapshot ? { account: { ...snapshot.account, status: "inactive" }, removed_tokens: 1 } : null;
      },
    };
  }),
}));

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "integration-meta-actions-test-secret",
  encryptionKey: "integration-meta-actions-encryption",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

const jobs: JobEnvelope[] = [];
const db = {} as unknown as AppDatabase;

async function request(method: string, path: string, body?: unknown, role = "admin") {
  mocks.setRole(role);
  const token = await signAccessToken({ user_public_id: "usr_test", session_public_id: "ses_test", role }, config);
  return createApp({ config, db, providerDeliveryQueuePublisher: { publish: async (job) => (jobs.push(job), job.job_id) } }).request(path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function instagramSnapshot() {
  return mocks.snapshot as { account: Record<string, unknown>; tokens: unknown[] };
}

describe("Instagram / Messenger account actions (legacy subscribe-webhook, lab thread control, disconnect)", () => {
  beforeEach(() => {
    jobs.length = 0;
    mocks.disconnectCalls.length = 0;
    const snapshot = instagramSnapshot();
    snapshot.account.provider_key = "instagram";
    snapshot.tokens = [{ public_id: "itk_1", token_type: "access_token" }];
  });

  it("queues instagram.webhook.subscribe with the requested fields", async () => {
    const response = await request("POST", "/admin/integrations/accounts/iac_instagram_demo/webhook-subscription", {
      action: "subscribe",
      subscribed_fields: ["messages", "comments"],
      idempotency_key: "Sub-1",
    });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      queued: true,
      job_id: "job_instagram_webhook_subscribe_sub_1",
      account_public_id: "iac_instagram_demo",
      provider_key: "instagram",
      operation: "webhook.subscribe",
      live_gate: "providers.instagram.live_mode",
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      name: "instagram.webhook.subscribe",
      payload: {
        envelope: {
          provider: "instagram",
          channel: "instagram",
          operation: "webhook.subscribe",
          account_public_id: "iac_instagram_demo",
          payload: { subscribed_fields: ["messages", "comments"], idempotency_key: "Sub-1" },
        },
      },
    });
  });

  it("queues messenger thread control with the recipient and metadata", async () => {
    instagramSnapshot().account.provider_key = "messenger";
    const response = await request("POST", "/admin/integrations/accounts/iac_instagram_demo/thread-control", {
      action: "take",
      recipient_id: "2468",
      metadata: "panel",
      idempotency_key: "take-1",
    });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ operation: "thread.take", provider_key: "messenger" });
    expect(jobs[0]).toMatchObject({
      name: "messenger.thread.take",
      payload: { envelope: { provider: "messenger", channel: "messenger", payload: { recipient_id: "2468", metadata: "panel", idempotency_key: "take-1" } } },
    });

    const owner = await request("POST", "/admin/integrations/accounts/iac_instagram_demo/thread-control", { action: "owner", recipient_id: "2468", idempotency_key: "own-1" });
    expect(owner.status).toBe(202);
    expect(jobs[1]?.payload).toMatchObject({ envelope: { operation: "thread.owner" } });
  });

  it("rejects providers outside Instagram/Messenger and invalid payloads", async () => {
    instagramSnapshot().account.provider_key = "whatsapp";
    const unsupported = await request("POST", "/admin/integrations/accounts/iac_instagram_demo/webhook-subscription", { action: "subscribe", idempotency_key: "x" });
    expect(unsupported.status).toBe(400);
    await expect(unsupported.json()).resolves.toMatchObject({ error: { code: "unsupported_provider" } });

    const invalid = await request("POST", "/admin/integrations/accounts/iac_instagram_demo/thread-control", { action: "take", idempotency_key: "x" });
    expect(invalid.status).toBe(400);
    expect(jobs).toHaveLength(0);
  });

  it("disconnects: queues the unsubscribe while a token exists, then deactivates and deletes tokens", async () => {
    const response = await request("POST", "/admin/integrations/accounts/iac_instagram_demo/disconnect", { idempotency_key: "dc-1" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      account: { public_id: "iac_instagram_demo", status: "inactive" },
      removed_tokens: 1,
      unsubscribe_job_id: "job_instagram_webhook_unsubscribe_dc_1",
    });
    expect(mocks.disconnectCalls).toEqual(["iac_instagram_demo"]);
    expect(jobs[0]).toMatchObject({ name: "instagram.webhook.unsubscribe", payload: { envelope: { payload: { reason: "disconnect" } } } });
  });

  it("skips the unsubscribe job without a stored token", async () => {
    instagramSnapshot().tokens = [];
    const response = await request("POST", "/admin/integrations/accounts/iac_instagram_demo/disconnect", { idempotency_key: "dc-2" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ unsubscribe_job_id: null });
    expect(jobs).toHaveLength(0);
  });

  it("clears persisted provider attempts server side (legacy cron-debug temizle)", async () => {
    const response = await request("DELETE", "/admin/integrations/provider-attempts?provider_key=ptt&operation=shipment.track");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ provider_key: "ptt", operation: "shipment.track", deleted: 3 });
    expect(mocks.deleteCalls).toEqual(["ptt:shipment.track"]);

    const invalid = await request("DELETE", "/admin/integrations/provider-attempts");
    expect(invalid.status).toBe(400);
    const staff = await request("DELETE", "/admin/integrations/provider-attempts?provider_key=surat", undefined, "calisan");
    expect(staff.status).toBe(403);
  });

  it("returns 404 for unknown accounts and 403 for staff", async () => {
    const staff = await request("POST", "/admin/integrations/accounts/iac_instagram_demo/disconnect", { idempotency_key: "x" }, "calisan");
    expect(staff.status).toBe(403);
    mocks.snapshot = null;
    const missing = await request("POST", "/admin/integrations/accounts/iac_missing/disconnect", { idempotency_key: "x" });
    expect(missing.status).toBe(404);
    mocks.snapshot = {
      account: { id: 5, public_id: "iac_instagram_demo", provider_id: 3, provider_key: "instagram", provider_name: "Instagram Graph API", display_name: "Instagram", external_account_id: "1", status: "active", metadata: {}, created_at: new Date(), updated_at: new Date() },
      settings: [],
      tokens: [{ public_id: "itk_1", token_type: "access_token" }],
    };
  });
});
