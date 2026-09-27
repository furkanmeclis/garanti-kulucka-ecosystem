import { describe, expect, it } from "vitest";
import type { NewUser } from "../src/index.js";

describe("database schema types", () => {
  it("exposes insertable user shape", () => {
    const user = {
      public_id: "usr_1",
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
    } satisfies NewUser;

    expect(user.email).toBe("admin@example.com");
  });
});
