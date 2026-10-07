import type { AppDatabase } from "@garanti-kulucka/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const mocks = vi.hoisted(() => {
  const now = new Date("2026-10-07T08:00:00.000Z");
  let role = "admin";
  const baseRow = {
    id: 1,
    public_id: "ddr_1",
    reference: "DEL-ABC123",
    source: "form",
    full_name: "Zeynep Kaya" as string | null,
    email: "zeynep@example.com" as string | null,
    phone: null as string | null,
    instagram_username: null as string | null,
    messenger_psid: null as string | null,
    description: null as string | null,
    status: "pending",
    resolution_note: null as string | null,
    requested_at: now,
    resolved_at: null as Date | null,
    resolved_by_user_id: null as number | null,
    created_at: now,
    updated_at: now,
  };
  return {
    now,
    baseRow,
    setRole: (next: string) => {
      role = next;
    },
    authRepository: {
      findUserByPublicId: vi.fn(async () => ({ id: 10, public_id: "usr_test", role_id: 1, email: "admin@example.com", password_hash: "hash", first_name: "Admin", last_name: "User", phone: null, is_active: true, is_online: false, last_seen_at: null, sip_username: null, sip_password_encrypted: null, created_at: now, updated_at: now, role_name: role })),
      findSessionByPublicId: vi.fn(async () => ({ id: 100, public_id: "ses_test", user_id: 10, user_agent: null, ip_address: null, expires_at: new Date("2099-02-01T00:00:00.000Z"), revoked_at: null, created_at: now, updated_at: now })),
    },
    repository: {
      create: vi.fn(async (input: Record<string, unknown>) => ({ ...baseRow, source: input.source as string, full_name: input.fullName as string | null, email: input.email as string | null, messenger_psid: input.messengerPsid as string | null })),
      list: vi.fn(async () => ({ rows: [baseRow], total: 1 })),
      findByReference: vi.fn(async (reference: string) => (reference === baseRow.reference ? baseRow : null)),
      updateStatus: vi.fn(async (publicId: string, input: { status: string; note: string | null }) => (publicId === "ddr_1" ? { ...baseRow, status: input.status, resolution_note: input.note, resolved_at: now } : null)),
    },
  };
});

vi.mock("../src/auth/repository.js", () => ({
  AuthRepository: vi.fn(function AuthRepository() {
    return mocks.authRepository;
  }),
  isAdminRole: (role: string) => role === "admin" || role === "owner",
}));

vi.mock("../src/privacy/data-deletion-repository.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/privacy/data-deletion-repository.js")>()),
  DataDeletionRepository: vi.fn(function DataDeletionRepository() {
    return mocks.repository;
  }),
}));

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { signedRequestUserId } = await import("../src/http/privacy-routes.js");
const { deletionReference } = await import("../src/privacy/data-deletion-repository.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "data-deletion-route-test-secret-value",
  encryptionKey: "data-deletion-route-encryption-key",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: "https://panel.example.com,https://beta.example.com",
};

let ip = 0;
function app() {
  return createApp({ config, db: {} as AppDatabase });
}

async function anonymous(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  ip += 1;
  return app().request(path, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${ip}`, ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

async function authed(method: string, path: string, body?: unknown, role = "admin") {
  mocks.setRole(role);
  const token = await signAccessToken({ user_public_id: "usr_test", session_public_id: "ses_test", role }, config);
  return app().request(path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

describe("data deletion requests (legacy DataDeletionPage)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts the anonymous legacy form and returns a DEL reference", async () => {
    const response = await anonymous("POST", "/api/veri-silme-talebi", { ad: "  Zeynep Kaya ", email: "zeynep@example.com", telefon: "", instagram_kullanici_adi: "zeynep.k", aciklama: "Lütfen silin" });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ success: true, referans: "DEL-ABC123", reference: "DEL-ABC123" });
    expect(mocks.repository.create).toHaveBeenCalledWith(expect.objectContaining({ source: "form", fullName: "Zeynep Kaya", email: "zeynep@example.com", phone: null, instagramUsername: "zeynep.k", description: "Lütfen silin" }));
  });

  it("requires a name and a valid email", async () => {
    const missing = await anonymous("POST", "/api/veri-silme-talebi", { email: "a@example.com" });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: { message: "Ad Soyad alanı zorunludur" } });
    expect((await anonymous("POST", "/api/veri-silme-talebi", { ad: "X", email: "not-an-email" })).status).toBe(400);
    const noContact = await anonymous("POST", "/api/veri-silme-talebi", { ad: "X", email: "", telefon: " " });
    expect(noContact.status).toBe(400);
    expect(await noContact.json()).toMatchObject({ error: { message: expect.stringContaining("En az bir iletişim bilgisi") } });
    expect(mocks.repository.create).not.toHaveBeenCalled();
  });

  it("rate limits the public form per client IP", async () => {
    const shared = createApp({ config, db: {} as AppDatabase });
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await shared.request("/api/veri-silme-talebi", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" }, body: JSON.stringify({ ad: "Ali", telefon: "05550000000" }) });
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 5).every((status) => status === 201)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it("answers the Meta data deletion callback with a panel status URL", async () => {
    const payload = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "1234567890" })).toString("base64url");
    const response = await anonymous("POST", "/api/facebook/data-deletion", `signed_request=sig.${payload}`, { "content-type": "application/x-www-form-urlencoded" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://panel.example.com/veri-silme?ref=DEL-ABC123", confirmation_code: "DEL-ABC123" });
    expect(mocks.repository.create).toHaveBeenCalledWith(expect.objectContaining({ source: "facebook", messengerPsid: "1234567890", fullName: null }));
  });

  it("parses only numeric user ids from signed requests", () => {
    expect(signedRequestUserId(`x.${Buffer.from('{"user_id":"42"}').toString("base64url")}`)).toBe("42");
    expect(signedRequestUserId(`x.${Buffer.from('{"user_id":"<script>"}').toString("base64url")}`)).toBeNull();
    expect(signedRequestUserId("garbage")).toBeNull();
    expect(signedRequestUserId(undefined)).toBeNull();
    expect(deletionReference(0)).toMatch(/^DEL-0[A-Z0-9]{4}$/);
  });

  it("exposes only the status for a public reference lookup", async () => {
    const response = await anonymous("GET", "/api/veri-silme-talebi/DEL-ABC123");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reference: "DEL-ABC123", status: "pending", requested_at: mocks.now.toISOString(), resolved_at: null });
    expect((await anonymous("GET", "/api/veri-silme-talebi/DEL-NOPE")).status).toBe(404);
  });

  it("lets managers list and close requests", async () => {
    expect((await authed("GET", "/admin/data-deletion-requests", undefined, "calisan")).status).toBe(403);
    expect((await app().request("/admin/data-deletion-requests")).status).toBe(401);
    const list = await authed("GET", "/admin/data-deletion-requests?status=pending&limit=10", undefined, "owner");
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ total_count: 1, limit: 10, offset: 0, data: [{ public_id: "ddr_1", reference: "DEL-ABC123", full_name: "Zeynep Kaya", status: "pending" }] });
    expect(mocks.repository.list).toHaveBeenCalledWith({ status: "pending", limit: 10, offset: 0 });
    expect((await authed("GET", "/admin/data-deletion-requests?status=bogus")).status).toBe(400);

    const closed = await authed("PATCH", "/admin/data-deletion-requests/ddr_1", { status: "completed", note: "Kayıtlar silindi" });
    expect(closed.status).toBe(200);
    expect(await closed.json()).toMatchObject({ request: { status: "completed", resolution_note: "Kayıtlar silindi" } });
    expect(mocks.repository.updateStatus).toHaveBeenCalledWith("ddr_1", { status: "completed", note: "Kayıtlar silindi", actorUserId: 10 });
    expect((await authed("PATCH", "/admin/data-deletion-requests/ddr_404", { status: "completed" })).status).toBe(404);
    expect((await authed("PATCH", "/admin/data-deletion-requests/ddr_1", { status: "deleted" })).status).toBe(400);
  });
});
