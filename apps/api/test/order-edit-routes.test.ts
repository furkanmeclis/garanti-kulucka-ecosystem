import type { AppDatabase } from "@garanti-kulucka/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const mocks = vi.hoisted(() => {
  const now = new Date("2026-10-07T08:00:00.000Z");
  let role = "calisan";
  const order = {
    public_id: "ord_1",
    order_number: "GK-1001",
    status: "draft",
    cargo_provider: "ptt",
    notes: null,
    currency: "TRY",
    total_amount: "300.00",
    items_total: "300.00",
    manual_total: false,
    customer: { public_id: "cus_1", full_name: "Ayşe Yılmaz", phone: "05551234567" },
    address: { address_line: "Moda Cad. 1", city: "İstanbul", district: "Kadıköy" },
    items: [{ public_id: "oit_1", product_public_id: null, name: "Kuluçka", quantity: 1, unit_price: "300.00", total_amount: "300.00" }],
    locked_reason: null,
    updated_at: now.toISOString(),
  };
  return {
    order,
    setRole: (next: string) => {
      role = next;
    },
    authRepository: {
      findUserByPublicId: vi.fn(async () => ({ id: 10, public_id: "usr_test", role_id: 1, email: "x@example.com", password_hash: "hash", first_name: "A", last_name: "B", phone: null, is_active: true, is_online: false, last_seen_at: null, sip_username: null, sip_password_encrypted: null, created_at: now, updated_at: now, role_name: role })),
      findSessionByPublicId: vi.fn(async () => ({ id: 100, public_id: "ses_test", user_id: 10, user_agent: null, ip_address: null, expires_at: new Date("2099-02-01T00:00:00.000Z"), revoked_at: null, created_at: now, updated_at: now })),
    },
    repository: {
      get: vi.fn(async (publicId: string) => (publicId === "ord_1" ? order : null)),
      update: vi.fn(async (publicId: string, _input: unknown): Promise<typeof order | null> => (publicId === "ord_1" ? { ...order, notes: "güncel" } : null)),
    },
  };
});

vi.mock("../src/auth/repository.js", () => ({
  AuthRepository: vi.fn(function AuthRepository() {
    return mocks.authRepository;
  }),
  isAdminRole: (role: string) => role === "admin" || role === "owner",
}));

vi.mock("../src/orders/order-edit-repository.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/orders/order-edit-repository.js")>()),
  OrderEditRepository: vi.fn(function OrderEditRepository() {
    return mocks.repository;
  }),
}));

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { OrderEditLockedError, OrderEditItemNotFoundError } = await import("../src/orders/order-edit-repository.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "order-edit-route-test-secret-value",
  encryptionKey: "order-edit-route-encryption-key",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

async function request(method: string, path: string, body?: unknown, role = "calisan") {
  mocks.setRole(role);
  const token = await signAccessToken({ user_public_id: "usr_test", session_public_id: "ses_test", role }, config);
  return createApp({ config, db: {} as AppDatabase }).request(path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

const payload = {
  customer: { full_name: " Ayşe Kaya ", phone: "05551234567" },
  address: { address_line: "Moda Cad. 2", city: "İstanbul", district: "Kadıköy" },
  notes: "  güncel  ",
  cargo_provider: "surat",
  items: [
    { public_id: "oit_1", name: "Kuluçka", quantity: 2, unit_price: "150" },
    { name: "Yedek", quantity: 1, unit_price: "25.50", product_public_id: "prd_1" },
  ],
};

describe("order edit routes (legacy Düzenle modal)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the editable snapshot for staff and 404 for unknown orders", async () => {
    const response = await request("GET", "/api/orders/ord_1/edit", undefined, "kargo_operatoru");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ order: { public_id: "ord_1", items: [{ public_id: "oit_1" }], locked_reason: null } });
    expect((await request("GET", "/api/orders/ord_x/edit")).status).toBe(404);
  });

  it("saves customer, address, items and the line total", async () => {
    const response = await request("PATCH", "/api/orders/ord_1", payload);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ order: { notes: "güncel" } });
    expect(mocks.repository.update).toHaveBeenCalledWith("ord_1", {
      customer: { fullName: "Ayşe Kaya", phone: "05551234567" },
      address: { addressLine: "Moda Cad. 2", city: "İstanbul", district: "Kadıköy" },
      notes: "güncel",
      cargoProvider: "surat",
      items: [
        { publicId: "oit_1", productPublicId: null, name: "Kuluçka", quantity: 2, unitPrice: "150" },
        { publicId: null, productPublicId: "prd_1", name: "Yedek", quantity: 1, unitPrice: "25.50" },
      ],
      totalAmount: null,
      actorUserId: 10,
    });
  });

  it("accepts a manual total and rejects zero totals and invalid payloads", async () => {
    expect((await request("PATCH", "/api/orders/ord_1", { ...payload, total_amount: "300.00" })).status).toBe(200);
    expect(mocks.repository.update).toHaveBeenLastCalledWith("ord_1", expect.objectContaining({ totalAmount: "300.00" }));
    const zero = await request("PATCH", "/api/orders/ord_1", { ...payload, items: [{ name: "Bedava", quantity: 1, unit_price: "0" }] });
    expect(zero.status).toBe(400);
    expect(await zero.json()).toMatchObject({ error: { code: "invalid_order_total" } });
    expect((await request("PATCH", "/api/orders/ord_1", { ...payload, total_amount: "0" })).status).toBe(400);
    expect((await request("PATCH", "/api/orders/ord_1", { ...payload, items: [] })).status).toBe(400);
    expect((await request("PATCH", "/api/orders/ord_1", { ...payload, cargo_provider: "aras" })).status).toBe(400);
    expect((await request("PATCH", "/api/orders/ord_x", payload)).status).toBe(404);
  });

  it("returns 409 for KolayBi-transferred orders and 400 for unknown lines", async () => {
    mocks.repository.update.mockRejectedValueOnce(new OrderEditLockedError("kolaybi"));
    const locked = await request("PATCH", "/api/orders/ord_1", payload, "admin");
    expect(locked.status).toBe(409);
    expect(await locked.json()).toMatchObject({ error: { code: "order_locked", reason: "kolaybi", message: "Bu sipariş KolayBi'ye aktarılmış, düzenlenemez." } });
    mocks.repository.update.mockRejectedValueOnce(new OrderEditItemNotFoundError("oit_x"));
    expect((await request("PATCH", "/api/orders/ord_1", payload)).status).toBe(400);
  });
});
