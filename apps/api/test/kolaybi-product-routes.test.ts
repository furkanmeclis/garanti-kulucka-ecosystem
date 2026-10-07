import type { AppDatabase } from "@garanti-kulucka/database";
import type { JobEnvelope } from "@garanti-kulucka/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const mocks = vi.hoisted(() => {
  const now = new Date("2026-10-07T08:00:00.000Z");
  let role = "calisan";
  return {
    setRole: (next: string) => {
      role = next;
    },
    metadata: { kolaybi_products: { products: [{ id: "11", name: "Kuluçka 48" }], synced_at: "2026-10-07T07:00:00.000Z" } } as Record<string, unknown>,
    account: { public_id: "iac_kolaybi" } as { public_id: string } | null,
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

vi.mock("../src/accounting/repository.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/accounting/repository.js")>()),
  AccountingRepository: vi.fn(function AccountingRepository() {
    return {
      kolaybiReadiness: async (liveGate: string) => ({ account: mocks.account, provider_live_mode: false, account_live_mode: null, live_call_permitted: false, live_gate: liveGate }),
    };
  }),
}));

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "kolaybi-product-route-test-secret",
  encryptionKey: "kolaybi-product-route-encryption",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

const jobs: JobEnvelope[] = [];
const db = {
  selectFrom: () => ({ select: () => ({ where: () => ({ executeTakeFirst: async () => ({ metadata: mocks.metadata }) }) }) }),
} as unknown as AppDatabase;

async function request(method: string, path: string, role = "calisan") {
  mocks.setRole(role);
  const token = await signAccessToken({ user_public_id: "usr_test", session_public_id: "ses_test", role }, config);
  return createApp({ config, db, providerDeliveryQueuePublisher: { publish: async (job) => (jobs.push(job), job.job_id) } }).request(path, { method, headers: { authorization: `Bearer ${token}` } });
}

describe("KolayBi product list routes (legacy /api/kolaybi/urunler)", () => {
  beforeEach(() => {
    jobs.length = 0;
    mocks.account = { public_id: "iac_kolaybi" };
  });

  it("serves the stored snapshot for inventory staff", async () => {
    const response = await request("GET", "/api/products/kolaybi");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      products: [{ id: "11", name: "Kuluçka 48" }],
      total: 1,
      synced_at: "2026-10-07T07:00:00.000Z",
      account_configured: true,
      live_call_permitted: false,
      live_gate: "providers.kolaybi.live_mode",
    });
    mocks.account = null;
    await expect((await request("GET", "/api/products/kolaybi")).json()).resolves.toMatchObject({ products: [], total: 0, synced_at: null, account_configured: false });
    expect((await request("GET", "/api/products/kolaybi", "kargo_operatoru")).status).toBe(403);
  });

  it("queues a product.list refresh", async () => {
    const response = await request("POST", "/api/products/kolaybi/refresh", "admin");
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ queued: true, live_gate: "providers.kolaybi.live_mode" });
    expect(jobs[0]).toMatchObject({ name: "kolaybi.product.list", payload: { envelope: { provider: "kolaybi", operation: "product.list", account_public_id: "iac_kolaybi", payload: { per_page: 200, max_pages: 20 } } } });
  });
});
