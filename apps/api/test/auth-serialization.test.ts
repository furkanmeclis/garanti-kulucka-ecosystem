import { describe, expect, it } from "vitest";
import { serializeAuthUser, type AuthUserRecord } from "../src/auth/repository.js";

describe("auth serialization", () => {
  it("includes permissions for frontend guards without exposing password hash", () => {
    const user: AuthUserRecord = {
      id: 1,
      public_id: "usr_test",
      role_id: 1,
      email: "admin@example.com",
      password_hash: "secret-hash",
      first_name: "Admin",
      last_name: "User",
      phone: null,
      is_active: true,
      is_online: false,
      last_seen_at: null,
      sip_username: "1001",
      sip_password_encrypted: "encrypted",
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-01T00:00:00.000Z"),
      role_name: "admin",
    };

    const serialized = serializeAuthUser(user, ["settings:read", "settings:write"]);

    expect(serialized).toMatchObject({
      public_id: "usr_test",
      role: "admin",
      permissions: ["settings:read", "settings:write"],
      is_online: false,
      sip_username: "1001",
    });
    expect(serialized).not.toHaveProperty("password_hash");
    expect(serialized).not.toHaveProperty("sip_password_encrypted");
  });
});
