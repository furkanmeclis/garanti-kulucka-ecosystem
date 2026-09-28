import { describe, expect, it } from "vitest";
import type { Database, NewCustomerExternalIdentity, NewUser } from "../src/index.js";

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

  it("exposes customer identity and conversation integration account shapes", () => {
    const identity = {
      public_id: "cei_1",
      customer_id: 1,
      integration_account_id: 10,
      external_id: "customer-42",
      metadata: { legacy_column: "woocommerce_id" },
    } satisfies NewCustomerExternalIdentity;

    const integrationAccountId: Database["conversations"]["integration_account_id"] = null;

    expect(identity.integration_account_id).toBe(10);
    expect(integrationAccountId).toBeNull();
  });
});
