import type { AppDatabase } from "@garanti-kulucka/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const routeMocks = vi.hoisted(() => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const customer = {
    id: 7,
    public_id: "cus_ayse",
    full_name: "Ayşe Yılmaz",
    phone: "+905551112233",
    email: "ayse@example.com",
    username: "ayse.ig",
    notes: "Bayi adayı",
    created_at: now,
    updated_at: now,
  };
  const address = {
    id: 3,
    public_id: "adr_home",
    customer_id: 7,
    label: "Ev",
    address_line: "Atatürk Cd. No:1",
    district: "Merkez",
    city: "Konya",
    country: "TR",
    postal_code: "42000",
    is_default: true,
    created_at: now,
    updated_at: now,
  };
  const order = {
    id: 11,
    public_id: "ord_1",
    customer_id: 7,
    conversation_id: null,
    created_by_user_id: 10,
    order_number: "GK-1001",
    status: "pending",
    source: "manual",
    cargo_provider: "ptt",
    total_amount: "2550.00",
    manual_adjustment_amount: "0.00",
    currency: "TRY",
    confirmation_status: null,
    notes: null,
    external_order_id: null,
    deleted_at: null,
    deleted_by_user_id: null,
    customer_full_name: "Ayşe Yılmaz",
    created_by_user_public_id: "usr_test",
    created_by_user_email: "calisan@example.com",
    created_at: now,
    updated_at: now,
  };
  const conversation = {
    id: 21,
    public_id: "cnv_1",
    customer_id: 7,
    assigned_user_id: null,
    integration_account_id: null,
    channel: "whatsapp",
    external_thread_id: null,
    status: "open",
    is_in_pool: false,
    human_agent_enabled: true,
    unread_count: 2,
    last_message_text: "Merhaba",
    last_message_sender_type: "customer",
    last_message_at: now,
    notes: null,
    customer_full_name: "Ayşe Yılmaz",
    customer_phone: "+905551112233",
    assigned_user_email: null,
    created_at: now,
    updated_at: now,
  };
  return {
    customer,
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
      getCustomerDetail: vi.fn(async (publicId: string) =>
        publicId === "cus_ayse" ? { customer, addresses: [address], orders: [order], conversations: [conversation] } : null,
      ),
      updateCustomer: vi.fn(async (input: { customerPublicId: string; fullName?: string; notes?: string | null }) =>
        input.customerPublicId === "cus_ayse"
          ? { ...customer, full_name: input.fullName ?? customer.full_name, notes: input.notes === undefined ? customer.notes : input.notes }
          : null,
      ),
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
  jwtSecret: "customer-detail-route-test-secret",
  encryptionKey: "customer-detail-route-encryption-key",
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

describe("customer detail routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the customer card with addresses, orders and conversations", async () => {
    const response = await app().request("/api/customers/cus_ayse", { headers: { authorization: `Bearer ${await token()}` } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      customer: { public_id: "cus_ayse", full_name: "Ayşe Yılmaz", notes: "Bayi adayı" },
      addresses: [{ public_id: "adr_home", city: "Konya", is_default: true }],
      orders: [{ public_id: "ord_1", order_number: "GK-1001", total_amount: "2550.00" }],
      conversations: [{ public_id: "cnv_1", channel: "whatsapp", unread_count: 2 }],
    });
    expect(body.addresses[0]).not.toHaveProperty("customer_id");

    const missing = await app().request("/api/customers/cus_missing", { headers: { authorization: `Bearer ${await token()}` } });
    expect(missing.status).toBe(404);
  });

  it("does not shadow the existing summary route", async () => {
    const response = await app().request("/api/customers/summary", { headers: { authorization: `Bearer ${await token("kargo_operatoru")}` } });
    expect(response.status).toBe(403);
    expect(routeMocks.domainRepository.getCustomerDetail).not.toHaveBeenCalled();
  });

  it("updates editable fields, trimming blanks to null", async () => {
    const accessToken = await token();
    const response = await app().request(
      "/api/customers/cus_ayse",
      jsonRequest("PATCH", accessToken, { full_name: "  Ayşe Kaya ", email: "", phone: " +905550000000 " }),
    );
    expect(response.status).toBe(200);
    expect(routeMocks.domainRepository.updateCustomer).toHaveBeenCalledWith({
      customerPublicId: "cus_ayse",
      fullName: "Ayşe Kaya",
      phone: "+905550000000",
      email: null,
      username: undefined,
      notes: undefined,
    });
    await expect(response.json()).resolves.toMatchObject({ public_id: "cus_ayse", full_name: "Ayşe Kaya" });
  });

  it("rejects invalid customer payloads", async () => {
    const accessToken = await token();
    const blankName = await app().request("/api/customers/cus_ayse", jsonRequest("PATCH", accessToken, { full_name: "  " }));
    expect(blankName.status).toBe(400);
    await expect(blankName.json()).resolves.toMatchObject({ error: { message: "Müşteri adı gerekli" } });

    const badEmail = await app().request("/api/customers/cus_ayse", jsonRequest("PATCH", accessToken, { email: "nope" }));
    expect(badEmail.status).toBe(400);
    await expect(badEmail.json()).resolves.toMatchObject({ error: { message: "Geçersiz e-posta" } });

    const empty = await app().request("/api/customers/cus_ayse", jsonRequest("PATCH", accessToken, {}));
    expect(empty.status).toBe(400);

    const unknownField = await app().request("/api/customers/cus_ayse", jsonRequest("PATCH", accessToken, { role: "admin" }));
    expect(unknownField.status).toBe(400);
    expect(routeMocks.domainRepository.updateCustomer).not.toHaveBeenCalled();

    const missing = await app().request("/api/customers/cus_missing", jsonRequest("PATCH", accessToken, { full_name: "X" }));
    expect(missing.status).toBe(404);
  });

  it("saves customer notes", async () => {
    const accessToken = await token("admin");
    const response = await app().request("/api/customers/cus_ayse/notes", jsonRequest("PATCH", accessToken, { notes: "Aradı, tekrar ara" }));
    expect(response.status).toBe(200);
    expect(routeMocks.domainRepository.updateCustomer).toHaveBeenCalledWith({ customerPublicId: "cus_ayse", notes: "Aradı, tekrar ara" });
    await expect(response.json()).resolves.toMatchObject({ notes: "Aradı, tekrar ara" });
  });

  it("keeps the cargo operator out of the customer directory", async () => {
    const accessToken = await token("kargo_operatoru");
    const detail = await app().request("/api/customers/cus_ayse", { headers: { authorization: `Bearer ${accessToken}` } });
    expect(detail.status).toBe(403);
    const update = await app().request("/api/customers/cus_ayse", jsonRequest("PATCH", accessToken, { full_name: "X" }));
    expect(update.status).toBe(403);
    const notes = await app().request("/api/customers/cus_ayse/notes", jsonRequest("PATCH", accessToken, { notes: "x" }));
    expect(notes.status).toBe(403);
  });
});
