import type { AppDatabase } from "@garanti-kulucka/database";
import { describe, expect, it } from "vitest";
import { AdminUsersRepository } from "../src/admin/users-repository.js";
import { hashPassword, verifyPassword } from "../src/auth/crypto.js";
import { createSecretEncryptor } from "../src/security/encryption.js";

async function fixture(required: boolean) {
  const user: Record<string, unknown> = {
    id: 5, public_id: "usr_fixture", role: "calisan", email: "fixture@example.test",
    must_change_password: required, password_hash: await hashPassword("temporary-fixture-password"),
  };
  const sessions: Record<string, unknown>[] = [];
  const db = {
    transaction: () => ({ execute: async (callback: (transaction: unknown) => Promise<unknown>) => callback(db) }),
    selectFrom: () => {
      const query = { innerJoin: () => query, select: () => query, where: () => query, forUpdate: () => query,
        executeTakeFirst: async () => ({ ...user }), executeTakeFirstOrThrow: async () => ({ ...user }) };
      return query;
    },
    updateTable: (table: string) => {
      let patch: Record<string, unknown> = {};
      const query = { set: (value: Record<string, unknown>) => { patch = value; return query; }, where: () => query,
        execute: async () => { if (table === "users") Object.assign(user, patch); else sessions.push(patch); } };
      return query;
    },
    insertInto: () => ({ values: () => ({ execute: async () => undefined }) }),
  };
  return { user, sessions, repository: new AdminUsersRepository(db as unknown as AppDatabase, createSecretEncryptor("test-key", "test")) };
}
describe("password change persistence", () => {
  it("clears the forced-change flag and hashes the replacement password", async () => {
    const { repository, user } = await fixture(true);
    await repository.updateOwnPassword(5, "new-fixture-password");
    expect(user.must_change_password).toBe(false);
    expect(await verifyPassword(user.password_hash as string, "new-fixture-password")).toBe(true);
  });
  it("keeps the flag when the temporary password is reused", async () => {
    const { repository, user } = await fixture(true);
    await expect(repository.updateOwnPassword(5, "temporary-fixture-password")).rejects.toThrow("farklı");
    expect(user.must_change_password).toBe(true);
  });
  it("admin resets force a password change and revoke existing sessions", async () => {
    const { repository, user, sessions } = await fixture(false);
    await repository.update({ userPublicId: "usr_fixture", password: "admin-reset-password", sipExtension: "102", actorUserId: 1 });
    expect(user).toMatchObject({ must_change_password: true, sip_extension: "102" });
    expect(await verifyPassword(user.password_hash as string, "admin-reset-password")).toBe(true);
    expect(sessions[0]?.revoked_at).toBeInstanceOf(Date);
  });
});
