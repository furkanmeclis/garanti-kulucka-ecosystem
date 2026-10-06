import type { AppDatabase } from "@garanti-kulucka/database";
import { validateGlobalSetting } from "@garanti-kulucka/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const routeMocks = vi.hoisted(() => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const managedUser = {
    id: 22,
    public_id: "usr_staff",
    email: "staff@example.com",
    first_name: "Ayşe",
    last_name: "Kaya",
    phone: null,
    role: "calisan",
    is_active: true,
    is_online: false,
    last_seen_at: now,
    sip_username: "3229110532",
    sip_password_encrypted: "{\"alg\":\"enc\"}",
    created_at: now,
  };
  return {
    managedUser,
    roleName: "admin",
    authRepository: {
      findUserByPublicId: vi.fn(async () => ({
        id: 10,
        public_id: "usr_test",
        role_id: 1,
        email: "admin@example.com",
        password_hash: "hash",
        first_name: "Admin",
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
    usersRepository: {
      list: vi.fn(async () => [managedUser]),
      create: vi.fn(async () => managedUser),
      update: vi.fn(async () => managedUser),
      updateOwnProfile: vi.fn(async () => undefined),
      updateOwnPassword: vi.fn(async () => undefined),
      listLogs: vi.fn(async () => [
        {
          id: 1,
          actor_user_id: 10,
          actor_first_name: "Admin",
          actor_last_name: "User",
          action: "create",
          entity_type: "users",
          entity_id: "usr_staff",
          created_at: now,
        },
      ]),
    },
    settingsRepository: {
      list: vi.fn(async () => [{ key: "ai.auto_reply_enabled", scope: "global", value: true, is_secret: false }]),
    },
  };
});

vi.mock("../src/auth/repository.js", () => ({
  AuthRepository: vi.fn(function AuthRepository() {
    return routeMocks.authRepository;
  }),
  isAdminRole: (role: string) => role === "admin" || role === "owner",
}));

vi.mock("../src/admin/users-repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/admin/users-repository.js")>();
  return {
    ...actual,
    AdminUsersRepository: vi.fn(function AdminUsersRepository() {
      return routeMocks.usersRepository;
    }),
  };
});

vi.mock("../src/settings/repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/settings/repository.js")>();
  return {
    ...actual,
    SettingsRepository: vi.fn(function SettingsRepository() {
      return routeMocks.settingsRepository;
    }),
  };
});

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { DuplicateUserEmailError, SelfDeactivationError } = await import("../src/admin/users-repository.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "admin-users-route-test-secret",
  encryptionKey: "admin-users-route-encryption-key",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

async function token(role = "admin") {
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

describe("ayarlar admin routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists users for admin only and never exposes SIP/password secrets", async () => {
    const response = await app().request("/admin/users", { headers: { authorization: `Bearer ${await token()}` } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<Record<string, unknown>>; roles: string[] };
    expect(body.roles).toEqual(["admin", "calisan", "kargo_operatoru"]);
    expect(body.data[0]).toMatchObject({ public_id: "usr_staff", role: "calisan", sip_password_configured: true });
    expect(JSON.stringify(body)).not.toContain("enc");
    expect(JSON.stringify(body)).not.toContain("password_hash");

    for (const role of ["calisan", "kargo_operatoru"]) {
      const denied = await app().request("/admin/users", { headers: { authorization: `Bearer ${await token(role)}` } });
      expect(denied.status).toBe(403);
    }
    const anonymous = await app().request("/admin/users");
    expect(anonymous.status).toBe(401);
  });

  it("creates, updates, deactivates users with legacy validation messages", async () => {
    const accessToken = await token();
    const created = await app().request(
      "/admin/users",
      jsonRequest("POST", accessToken, { email: "Yeni@Example.com", first_name: " Ali ", password: "secret1", role: "kargo_operatoru" }),
    );
    expect(created.status).toBe(201);
    expect(routeMocks.usersRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: "Yeni@Example.com", firstName: "Ali", role: "kargo_operatoru", actorUserId: 10 }),
    );

    const shortPassword = await app().request(
      "/admin/users",
      jsonRequest("POST", accessToken, { email: "a@example.com", first_name: "A", password: "123" }),
    );
    expect(shortPassword.status).toBe(400);
    await expect(shortPassword.json()).resolves.toMatchObject({ error: { message: "Şifre en az 6 karakter olmalı." } });

    routeMocks.usersRepository.create.mockRejectedValueOnce(new DuplicateUserEmailError());
    const duplicate = await app().request(
      "/admin/users",
      jsonRequest("POST", accessToken, { email: "staff@example.com", first_name: "A", password: "secret1" }),
    );
    expect(duplicate.status).toBe(409);

    const updated = await app().request(
      "/admin/users/usr_staff",
      jsonRequest("PATCH", accessToken, { first_name: "Ayşe", role: "admin", sip_username: "", sip_password: "s3cret", password: "newpass" }),
    );
    expect(updated.status).toBe(200);
    expect(routeMocks.usersRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({ userPublicId: "usr_staff", role: "admin", sipUsername: null, sipPassword: "s3cret", password: "newpass" }),
    );

    const unknownField = await app().request("/admin/users/usr_staff", jsonRequest("PATCH", accessToken, { email: "x@example.com" }));
    expect(unknownField.status).toBe(400);

    routeMocks.usersRepository.update.mockRejectedValueOnce(new SelfDeactivationError());
    const self = await app().request("/admin/users/usr_test", jsonRequest("DELETE", accessToken));
    expect(self.status).toBe(409);

    const deleted = await app().request("/admin/users/usr_staff", jsonRequest("DELETE", accessToken));
    expect(deleted.status).toBe(200);
    expect(routeMocks.usersRepository.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ userPublicId: "usr_staff", isActive: false }),
    );
  });

  it("returns işlem logları with actor names for admin", async () => {
    const response = await app().request("/admin/logs?limit=100", { headers: { authorization: `Bearer ${await token()}` } });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ actor_name: "Admin User", action: "create", module: "users" }],
    });
    expect(routeMocks.usersRepository.listLogs).toHaveBeenCalledWith(100);
  });

  it("lets any active user update own profile/password and read AI status", async () => {
    const accessToken = await token("kargo_operatoru");
    const profile = await app().request("/auth/account/profile", jsonRequest("PATCH", accessToken, { first_name: "Mehmet", last_name: "Demir" }));
    expect(profile.status).toBe(200);
    expect(routeMocks.usersRepository.updateOwnProfile).toHaveBeenCalledWith(10, "Mehmet", "Demir");

    const mismatch = await app().request(
      "/auth/account/password",
      jsonRequest("POST", accessToken, { password: "secret1", password_confirmation: "secret2" }),
    );
    expect(mismatch.status).toBe(400);
    await expect(mismatch.json()).resolves.toMatchObject({ error: { message: "Şifreler eşleşmiyor." } });

    const password = await app().request(
      "/auth/account/password",
      jsonRequest("POST", accessToken, { password: "secret1", password_confirmation: "secret1" }),
    );
    expect(password.status).toBe(200);
    expect(routeMocks.usersRepository.updateOwnPassword).toHaveBeenCalledWith(10, "secret1");

    const aiStatus = await app().request("/api/app-settings/ai-status", { headers: { authorization: `Bearer ${accessToken}` } });
    expect(aiStatus.status).toBe(200);
    await expect(aiStatus.json()).resolves.toEqual({ ai_enabled: true });
  });

  it("serves NetGSM balance only as a backend dry-run boundary", async () => {
    const response = await app().request("/admin/integrations/netgsm/balance", { headers: { authorization: `Bearer ${await token()}` } });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      provider: "netgsm",
      balance: null,
      live_call_permitted: false,
      live_gate: "providers.netgsm.live_mode",
    });
    const denied = await app().request("/admin/integrations/netgsm/balance", { headers: { authorization: `Bearer ${await token("calisan")}` } });
    expect(denied.status).toBe(403);
  });

  it("registers legacy Ayarlar keys with secret flags", () => {
    expect(validateGlobalSetting("vapi.api_key", "sk-test").is_secret).toBe(true);
    expect(validateGlobalSetting("netgsm.teyit_voice_password", "pw").is_secret).toBe(true);
    expect(validateGlobalSetting("netgsm.teyit_voice_usercode", "3229110370").is_secret).toBe(false);
    expect(validateGlobalSetting("ai.auto_reply_enabled", true).is_secret).toBe(false);
    expect(
      validateGlobalSetting("kargo_pipeline_ayarlar", {
        aktif: true,
        baslangic_saati: "09:00",
        bitis_saati: "20:00",
        mesaj_gecikme_dk: 0,
        sms_gecikme_dk: 60,
        vapi_gecikme_dk: 120,
        max_deneme: 3,
        mesaj_sablonu: "Sayın {musteri_adi}",
      }).is_secret,
    ).toBe(false);
    expect(() => validateGlobalSetting("kargo_pipeline_ayarlar", { aktif: true })).toThrow();
    expect(() =>
      validateGlobalSetting("vapi_ayarlar", {
        enabled: true,
        assistant_id: "",
        phone_number_id: "pn",
        tts_provider: "azure",
        tts_voice: "tr-TR-AhmetNeural",
        arama_baslangic_saati: "25:00",
        arama_bitis_saati: "18:00",
        max_deneme: 3,
        tekrar_arama_saat: 24,
        otomatik_arama: false,
        system_prompt: "",
      }),
    ).toThrow();
  });
});
