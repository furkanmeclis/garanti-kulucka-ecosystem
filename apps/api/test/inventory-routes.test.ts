import type { AppDatabase } from "@garanti-kulucka/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const routeMocks = vi.hoisted(() => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const product = {
    id: 1,
    public_id: "prd_incubator",
    sku: "KLC-001",
    name: "El yapımı kuluçka makinası",
    category: "incubator",
    unit_price: "2550.00",
    stock_quantity: 12,
    is_active: true,
    external_product_id: "6202487",
    unit: "Adet",
    description: "Ana ürün",
    created_at: now,
    updated_at: now,
  };
  const movement = {
    id: 5,
    public_id: "stm_test",
    product_id: 1,
    movement_type: "in",
    quantity: 3,
    previous_quantity: 12,
    new_quantity: 15,
    notes: "Tedarikçi girişi",
    created_by_user_id: 10,
    created_at: now,
    updated_at: now,
    product_public_id: "prd_incubator",
    created_by_user_email: "calisan@example.com",
  };
  return {
    product,
    movement,
    roleName: "calisan",
    authRepository: {
      findUserByPublicId: vi.fn(async () => ({
        id: 10,
        public_id: "usr_test",
        role_id: 1,
        email: "calisan@example.com",
        password_hash: "hash",
        first_name: "Test",
        last_name: "User",
        phone: null,
        is_active: true,
        is_online: false,
        last_seen_at: null,
        sip_username: null,
        sip_password_encrypted: null,
        created_at: now,
        updated_at: now,
        role_name: routeMocks.roleName,
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
    domainRepository: {
      listProducts: vi.fn(async () => [product]),
      listInventoryProducts: vi.fn(async () => [product]),
      createProduct: vi.fn(async () => product),
      updateProduct: vi.fn(async () => ({ ...product, name: "Güncel Makine" })),
      deactivateProduct: vi.fn(async () => ({ ...product, is_active: false })),
      createStockMovement: vi.fn(async () => ({ product: { ...product, stock_quantity: 15 }, movement })),
      listStockMovements: vi.fn(async () => [movement]),
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
const { InsufficientStockError, ProductNotFoundError, DuplicateProductSkuError, inferProductCategory } = await import(
  "../src/domain/repository.js"
);

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "inventory-route-test-secret",
  encryptionKey: "inventory-route-encryption-key",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

async function token(role = "calisan") {
  routeMocks.roleName = role;
  return signAccessToken({ user_public_id: "usr_test", session_public_id: "ses_test", role }, config);
}

function app() {
  return createApp({ config, db: {} as AppDatabase });
}

function jsonRequest(method: string, accessToken: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

describe("inventory (stok) routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("infers legacy categories from product names", () => {
    expect(inferProductCategory("Kuluçka Makinesi 56")).toBe("incubator");
    expect(inferProductCategory("Yedek Parça Seti")).toBe("spare_part");
    expect(inferProductCategory("Nemölçer")).toBe("other");
  });

  it("filters products by category, search and active status", async () => {
    const response = await app().request(
      "/api/products?category=incubator&search=kulu&active=true&limit=100",
      { headers: { authorization: `Bearer ${await token()}` } },
    );
    expect(response.status).toBe(200);
    expect(routeMocks.domainRepository.listInventoryProducts).toHaveBeenCalledWith({
      limit: 100,
      category: "incubator",
      search: "kulu",
      active: true,
    });
    await expect(response.json()).resolves.toMatchObject({ data: [{ public_id: "prd_incubator", unit: "Adet" }] });

    const legacy = await app().request("/api/products?limit=10", { headers: { authorization: `Bearer ${await token()}` } });
    expect(legacy.status).toBe(200);
    expect(routeMocks.domainRepository.listProducts).toHaveBeenCalledWith(10);

    const invalid = await app().request("/api/products?category=unknown", {
      headers: { authorization: `Bearer ${await token()}` },
    });
    expect(invalid.status).toBe(400);
  });

  it("creates, updates and deactivates products with server-side validation", async () => {
    const accessToken = await token();
    const created = await app().request(
      "/api/products",
      jsonRequest("POST", accessToken, { name: "  Yeni Termostat ", sku: "TRM-1", unit: "Adet", unit_price: "120.50", stock_quantity: 4 }),
    );
    expect(created.status).toBe(201);
    expect(routeMocks.domainRepository.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Yeni Termostat", sku: "TRM-1", unitPrice: "120.50", stockQuantity: 4, category: null, actorUserId: 10 }),
    );

    const blank = await app().request("/api/products", jsonRequest("POST", accessToken, { name: "   " }));
    expect(blank.status).toBe(400);
    await expect(blank.json()).resolves.toMatchObject({ error: { message: "Ürün adı gerekli" } });

    const badPrice = await app().request("/api/products", jsonRequest("POST", accessToken, { name: "X", unit_price: "-1" }));
    expect(badPrice.status).toBe(400);
    const badUnit = await app().request("/api/products", jsonRequest("POST", accessToken, { name: "X", unit: "Ton" }));
    expect(badUnit.status).toBe(400);

    const updated = await app().request(
      "/api/products/prd_incubator",
      jsonRequest("PATCH", accessToken, { name: "Güncel Makine", stock_quantity: 20, external_product_id: "" }),
    );
    expect(updated.status).toBe(200);
    expect(routeMocks.domainRepository.updateProduct).toHaveBeenCalledWith({
      productPublicId: "prd_incubator",
      name: "Güncel Makine",
      stockQuantity: 20,
      externalProductId: null,
      actorUserId: 10,
    });

    const emptyPatch = await app().request("/api/products/prd_incubator", jsonRequest("PATCH", accessToken, {}));
    expect(emptyPatch.status).toBe(400);

    const deleted = await app().request("/api/products/prd_incubator", jsonRequest("DELETE", accessToken));
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toMatchObject({ is_active: false });
  });

  it("records stock in/out movements and lists history", async () => {
    const accessToken = await token();
    const response = await app().request(
      "/api/products/prd_incubator/stock-movements",
      jsonRequest("POST", accessToken, { movement_type: "in", quantity: 3, notes: "Tedarikçi girişi" }),
    );
    expect(response.status).toBe(201);
    expect(routeMocks.domainRepository.createStockMovement).toHaveBeenCalledWith({
      productPublicId: "prd_incubator",
      movementType: "in",
      quantity: 3,
      notes: "Tedarikçi girişi",
      actorUserId: 10,
    });
    await expect(response.json()).resolves.toMatchObject({
      product: { stock_quantity: 15 },
      movement: { movement_type: "in", previous_quantity: 12, new_quantity: 15 },
    });

    const zero = await app().request(
      "/api/products/prd_incubator/stock-movements",
      jsonRequest("POST", accessToken, { movement_type: "out", quantity: 0 }),
    );
    expect(zero.status).toBe(400);
    await expect(zero.json()).resolves.toMatchObject({ error: { message: "Miktar 0'dan büyük olmalı" } });

    const history = await app().request("/api/products/prd_incubator/stock-movements?limit=20", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(history.status).toBe(200);
    expect(routeMocks.domainRepository.listStockMovements).toHaveBeenCalledWith("prd_incubator", 20);
    await expect(history.json()).resolves.toMatchObject({ data: [{ public_id: "stm_test", created_by_user_email: "calisan@example.com" }] });
  });

  it("maps insufficient stock, unknown product and duplicate code to client errors", async () => {
    const accessToken = await token();
    routeMocks.domainRepository.createStockMovement.mockRejectedValueOnce(new InsufficientStockError(2, 5));
    const insufficient = await app().request(
      "/api/products/prd_incubator/stock-movements",
      jsonRequest("POST", accessToken, { movement_type: "out", quantity: 5 }),
    );
    expect(insufficient.status).toBe(409);
    await expect(insufficient.json()).resolves.toMatchObject({
      error: { code: "insufficient_stock", message: "Yetersiz stok! Mevcut: 2, Çıkış: 5" },
    });

    routeMocks.domainRepository.deactivateProduct.mockRejectedValueOnce(new ProductNotFoundError("prd_missing"));
    const missing = await app().request("/api/products/prd_missing", jsonRequest("DELETE", accessToken));
    expect(missing.status).toBe(404);

    routeMocks.domainRepository.createProduct.mockRejectedValueOnce(new DuplicateProductSkuError("KLC-001"));
    const duplicate = await app().request("/api/products", jsonRequest("POST", accessToken, { name: "Kopya", sku: "KLC-001" }));
    expect(duplicate.status).toBe(409);
  });

  it("denies inventory management to kargo_operatoru", async () => {
    const accessToken = await token("kargo_operatoru");
    const create = await app().request("/api/products", jsonRequest("POST", accessToken, { name: "X" }));
    const movement = await app().request(
      "/api/products/prd_incubator/stock-movements",
      jsonRequest("POST", accessToken, { movement_type: "in", quantity: 1 }),
    );
    const history = await app().request("/api/products/prd_incubator/stock-movements", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(create.status).toBe(403);
    expect(movement.status).toBe(403);
    expect(history.status).toBe(403);
    expect(routeMocks.domainRepository.createProduct).not.toHaveBeenCalled();
  });
});
