import type { AppDatabase } from "@garanti-kulucka/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const mocks = vi.hoisted(() => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const decision = {
    status: "unknown",
    source: "keyword_fallback",
    warning: false,
    message: null as string | null,
    uncovered_areas: [] as string[],
    checked_at: null,
    live_gate: "providers.surat.live_mode",
    live_enabled: false,
    queued: false,
  };
  return {
    role: "calisan",
    decision,
    check: vi.fn(async () => mocks.decision),
    authRepository: {
      findUserByPublicId: vi.fn(async () => ({
        id: 10, public_id: "usr_test", role_id: 1, email: "t@example.com", password_hash: "hash", first_name: "T", last_name: "U", phone: null,
        is_active: true, is_online: true, last_seen_at: null, sip_username: null, sip_password_encrypted: null, created_at: now, updated_at: now, role_name: mocks.role,
      })),
      findSessionByPublicId: vi.fn(async () => ({
        id: 100, public_id: "ses_test", user_id: 10, user_agent: null, ip_address: null, expires_at: new Date("2099-01-01T00:00:00.000Z"), revoked_at: null, created_at: now, updated_at: now,
      })),
    },
    domainRepository: {
      findDuplicateActiveOrders: vi.fn(async () => ({ phoneMatches: [], nameMatches: [] })),
      findDuplicateOrdersFor: vi.fn(async () => new Map([["ord_1", { phoneMatches: ["GK-2"], nameMatches: [] }], ["ord_3", { phoneMatches: [], nameMatches: ["GK-4", "GK-5"] }]])),
      createOrderFromForm: vi.fn(async () => ({
        id: 1, public_id: "ord_new", customer_id: 1, conversation_id: null, created_by_user_id: 10, order_number: "GK-1", status: "draft", source: "manual",
        total_amount: "100.00", currency: "TRY", confirmation_status: null, notes: null, external_order_id: null, created_at: now, updated_at: now,
        customer_full_name: "Ali Veli", created_by_user_public_id: "usr_test", created_by_user_email: "t@example.com", cargo_provider: "surat",
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
  return { ...actual, DomainRepository: vi.fn(function DomainRepository() { return mocks.domainRepository; }) };
});

vi.mock("../src/cargo/surat-coverage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/cargo/surat-coverage.js")>();
  return { ...actual, SuratCoverageService: vi.fn(function SuratCoverageService() { return { check: mocks.check }; }) };
});

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const config: ApiConfig = {
  databaseUrl: null, jwtSecret: "order-checks-route-test-secret", encryptionKey: "order-checks-route-encryption-key", encryptionKeyId: "test",
  accessTokenTtlSeconds: 300, refreshTokenTtlDays: 30, redisUrl: null, corsOrigin: null,
};

async function post(path: string, body: unknown, role = "calisan") {
  mocks.role = role;
  const token = await signAccessToken({ user_public_id: "usr_test", session_public_id: "ses_test", role }, config);
  return createApp({ config, db: {} as AppDatabase }).request(path, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const orderBody = {
  customer: { full_name: "Ali Veli", phone: "05551234567" },
  address: { address_line: "Sarayköy Mah. 3", city: "Konya", district: "Selçuklu" },
  cargo_provider: "surat",
  items: [{ name: "Kuluçka", quantity: 1, unit_price: "100.00" }],
};

describe("order create checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decision = { ...mocks.decision, warning: false, message: null, status: "unknown", source: "keyword_fallback" };
  });

  it("answers the Sürat coverage precheck for the order form", async () => {
    const response = await post("/api/orders/surat-coverage", { city: "Konya", district: "Selçuklu", address_line: "Sarayköy" }, "kargo_operatoru");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ source: "keyword_fallback", live_gate: "providers.surat.live_mode" });
    expect(mocks.check).toHaveBeenCalledWith({ city: "Konya", district: "Selçuklu", address_line: "Sarayköy" }, expect.anything());
    expect((await post("/api/orders/surat-coverage", { city: "", district: "x" })).status).toBe(400);
  });

  it("blocks a Sürat order once when the carrier says the address is AT dışı, and lets force_surat_at through", async () => {
    mocks.decision = { ...mocks.decision, warning: true, status: "not_covered", source: "provider", message: "Bu adrese sürat kargo teslimat yapmamaktadır", uncovered_areas: ["SARAYKÖY"] };
    const response = await post("/api/orders", orderBody);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "surat_at_warning", coverage: { source: "provider", uncovered_areas: ["SARAYKÖY"] } } });

    await post("/api/orders", { ...orderBody, force_surat_at: true });
    expect(mocks.check).toHaveBeenCalledTimes(1);
    expect(mocks.domainRepository.createOrderFromForm).toHaveBeenCalledTimes(1);
  });

  it("never asks Sürat about PTT orders", async () => {
    await post("/api/orders", { ...orderBody, cargo_provider: "ptt" });
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("checks duplicates for a page of orders in one call", async () => {
    const response = await post("/api/orders/duplicate-check", { order_public_ids: ["ord_1", "ord_2", "ord_3", "ord_1"] }, "kargo_operatoru");
    expect(response.status).toBe(200);
    expect(mocks.domainRepository.findDuplicateOrdersFor).toHaveBeenCalledWith(["ord_1", "ord_2", "ord_3"]);
    await expect(response.json()).resolves.toEqual({
      data: { ord_1: { phone_matches: ["GK-2"], name_matches: [] }, ord_3: { phone_matches: [], name_matches: ["GK-4", "GK-5"] } },
    });
    expect((await post("/api/orders/duplicate-check", { order_public_ids: [] })).status).toBe(400);
    expect((await post("/api/orders/duplicate-check", { order_public_ids: Array.from({ length: 201 }, (_, i) => `ord_${i}`) })).status).toBe(400);
  });
});
