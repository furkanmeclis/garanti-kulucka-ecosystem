import type { AppDatabase } from "@garanti-kulucka/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const authMocks = vi.hoisted(() => {
  const state = {
    activeUser: {
      id: 10,
      public_id: "usr_admin",
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
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-01T00:00:00.000Z"),
      role_name: "admin",
    },
    staffUser: {
      id: 11,
      public_id: "usr_staff",
      role_id: 2,
      email: "staff@example.com",
      password_hash: "hash",
      first_name: "Staff",
      last_name: "User",
      phone: null,
      is_active: true,
      is_online: false,
      last_seen_at: null,
      sip_username: null,
      sip_password_encrypted: null,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-01T00:00:00.000Z"),
      role_name: "staff",
    },
    validRefreshToken: "initial_refresh_token_000000",
    nextRefreshToken: "rotated_refresh_token_000000",
    revokedSessions: new Set<string>(),
  };

  const repository = {
    findUserByEmail: vi.fn(async (email: string) =>
      email === state.activeUser.email ? state.activeUser : null,
    ),
    findUserByPublicId: vi.fn(async (publicId: string) => {
      if (publicId === state.activeUser.public_id) {
        return state.activeUser;
      }

      if (publicId === state.staffUser.public_id) {
        return state.staffUser;
      }

      return null;
    }),
    findSessionByPublicId: vi.fn(async (publicId: string) => {
      if (state.revokedSessions.has(publicId)) {
        return null;
      }

      if (publicId === "ses_admin") {
        return {
          id: 100,
          public_id: "ses_admin",
          user_id: state.activeUser.id,
          user_agent: null,
          ip_address: null,
          expires_at: new Date("2026-02-01T00:00:00.000Z"),
          revoked_at: null,
          created_at: new Date("2026-01-01T00:00:00.000Z"),
          updated_at: new Date("2026-01-01T00:00:00.000Z"),
        };
      }

      if (publicId === "ses_staff") {
        return {
          id: 101,
          public_id: "ses_staff",
          user_id: state.staffUser.id,
          user_agent: null,
          ip_address: null,
          expires_at: new Date("2026-02-01T00:00:00.000Z"),
          revoked_at: null,
          created_at: new Date("2026-01-01T00:00:00.000Z"),
          updated_at: new Date("2026-01-01T00:00:00.000Z"),
        };
      }

      return null;
    }),
    listUserPermissions: vi.fn(async () => ["settings:read"]),
    createSession: vi.fn(async () => ({
      id: 100,
      public_id: "ses_admin",
      user_id: state.activeUser.id,
      user_agent: null,
      ip_address: null,
      expires_at: new Date("2026-02-01T00:00:00.000Z"),
      revoked_at: null,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-01T00:00:00.000Z"),
    })),
    rotateRefreshToken: vi.fn(async (refreshToken: string, nextRefreshToken: string) => {
      if (refreshToken !== state.validRefreshToken) {
        return null;
      }

      state.validRefreshToken = nextRefreshToken;
      return {
        userPublicId: state.activeUser.public_id,
        sessionPublicId: "ses_admin",
        roleName: state.activeUser.role_name,
      };
    }),
    revokeSession: vi.fn(async (sessionPublicId: string) => {
      state.revokedSessions.add(sessionPublicId);
    }),
    setUserOnlineStatus: vi.fn(async (userPublicId: string, online: boolean) => {
      if (userPublicId === state.activeUser.public_id) {
        state.activeUser.is_online = online;
        return state.activeUser;
      }

      if (userPublicId === state.staffUser.public_id) {
        state.staffUser.is_online = online;
        return state.staffUser;
      }

      return null;
    }),
  };

  const db = {
    insertInto: vi.fn(() => ({
      values: vi.fn(() => ({
        execute: vi.fn(async () => undefined),
      })),
    })),
  };

  return {
    state,
    db,
    repository,
    verifyPassword: vi.fn(async () => true),
    createRefreshToken: vi.fn(() => state.nextRefreshToken),
  };
});

vi.mock("../src/auth/repository.js", () => ({
  AuthRepository: vi.fn(function AuthRepository() {
    return authMocks.repository;
  }),
  isAdminRole: (role: string) => role === "admin" || role === "owner",
  serializeAuthUser: (user: typeof authMocks.state.activeUser, permissions: string[]) => ({
    public_id: user.public_id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    role: user.role_name,
    permissions,
    is_online: user.is_online,
    sip_username: user.sip_username,
  }),
}));

vi.mock("../src/auth/crypto.js", () => ({
  createRefreshToken: authMocks.createRefreshToken,
  verifyPassword: authMocks.verifyPassword,
}));

const { createApp } = await import("../src/app.js");
const { signAccessToken, verifyAccessToken } = await import("../src/auth/tokens.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "auth-lifecycle-test-secret",
  encryptionKey: "auth-lifecycle-encryption-key",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

function createTestApp() {
  return createApp({ config, db: authMocks.db as unknown as AppDatabase });
}

async function accessToken(input: { userPublicId: string; sessionPublicId: string; role: string }) {
  return signAccessToken(
    {
      user_public_id: input.userPublicId,
      session_public_id: input.sessionPublicId,
      role: input.role,
    },
    config,
  );
}

describe("auth lifecycle", () => {
  beforeEach(() => {
    authMocks.state.validRefreshToken = "initial_refresh_token_000000";
    authMocks.state.nextRefreshToken = "rotated_refresh_token_000000";
    authMocks.state.revokedSessions.clear();
    authMocks.state.activeUser.is_online = false;
    authMocks.state.staffUser.is_online = false;
    vi.clearAllMocks();
  });

  it("rotates refresh tokens and rejects reuse of the previous token", async () => {
    const app = createTestApp();

    const firstResponse = await app.request("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: "initial_refresh_token_000000" }),
      headers: { "content-type": "application/json" },
    });

    expect(firstResponse.status).toBe(200);
    const firstPayload = await firstResponse.json();
    expect(firstPayload.refresh_token).toBe("rotated_refresh_token_000000");
    await expect(verifyAccessToken(firstPayload.access_token, config)).resolves.toMatchObject({
      user_public_id: "usr_admin",
      session_public_id: "ses_admin",
      role: "admin",
    });

    const reuseResponse = await app.request("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: "initial_refresh_token_000000" }),
      headers: { "content-type": "application/json" },
    });

    expect(reuseResponse.status).toBe(401);
    await expect(reuseResponse.json()).resolves.toMatchObject({
      error: { code: "invalid_refresh_token" },
    });
    expect(authMocks.repository.rotateRefreshToken).toHaveBeenCalledTimes(2);
  });

  it("revokes the session on logout and rejects the same access token afterward", async () => {
    const app = createTestApp();
    const token = await accessToken({
      userPublicId: "usr_admin",
      sessionPublicId: "ses_admin",
      role: "admin",
    });

    const logoutResponse = await app.request("/auth/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(logoutResponse.status).toBe(200);
    expect(authMocks.repository.revokeSession).toHaveBeenCalledWith("ses_admin");
    expect(authMocks.repository.setUserOnlineStatus).toHaveBeenCalledWith("usr_admin", false);

    const meResponse = await app.request("/auth/me", {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(meResponse.status).toBe(401);
    await expect(meResponse.json()).resolves.toMatchObject({
      error: { code: "unauthorized" },
    });
  });

  it("rejects access tokens when the user is disabled or no longer available", async () => {
    const token = await accessToken({
      userPublicId: "usr_disabled",
      sessionPublicId: "ses_admin",
      role: "admin",
    });

    const response = await createTestApp().request("/auth/me", {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unauthorized" },
    });
  });

  it("returns forbidden for authenticated non-admin users on admin middleware", async () => {
    const token = await accessToken({
      userPublicId: "usr_staff",
      sessionPublicId: "ses_staff",
      role: "staff",
    });

    const response = await createTestApp().request("/admin/settings", {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "forbidden" },
    });
  });

  it("updates authenticated user presence through the backend auth boundary", async () => {
    const token = await accessToken({
      userPublicId: "usr_staff",
      sessionPublicId: "ses_staff",
      role: "staff",
    });

    const response = await createTestApp().request("/auth/presence", {
      method: "PATCH",
      body: JSON.stringify({ online: true }),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      public_id: "usr_staff",
      role: "staff",
      is_online: true,
    });
    expect(authMocks.repository.setUserOnlineStatus).toHaveBeenCalledWith("usr_staff", true);
  });
});
