import type { AppDatabase } from "@garanti-kulucka/database";
import { describe, expect, it, vi } from "vitest";
import { bootstrapLegacyUsers, parseLegacyUsers, type LegacyBootstrapUser } from "../src/bootstrap/legacy-users.js";
import { createSecretEncryptor } from "../src/security/encryption.js";
import { verifyPassword } from "../src/auth/crypto.js";

vi.mock("@garanti-kulucka/database", () => ({ sql: () => ({ execute: async () => undefined }) }));
const encryptor = createSecretEncryptor("test-key", "test");
const fixture = (overrides: Partial<LegacyBootstrapUser> = {}): LegacyBootstrapUser => ({
  public_id: "usr_aabb", email: "fixture@example.test", first_name: "Test", last_name: "User",
  phone: null, role: "owner", is_active: true, sip_username: "fixture-sip",
  sip_password: "fixture-secret", sip_extension: "101", ...overrides,
});
function database(existing: Record<string, unknown>[] = []) {
  const rows = [...existing];
  const inserted: Record<string, unknown>[] = [];
  const db = {
    transaction: () => ({ execute: async (callback: (transaction: unknown) => Promise<unknown>) => {
      const initial = rows.length;
      try { return await callback(db); } catch (error) { rows.splice(initial); inserted.length = 0; throw error; }
    } }),
    selectFrom: (table: string) => {
      let field: unknown; let value: unknown;
      const query = {
        select: () => query,
        where: (key: unknown, _operator: string, target: unknown) => { field = key; value = target; return query; },
        executeTakeFirst: async () => table === "roles" ? { id: 7 } : rows.find((row) => row[typeof field === "string" ? field : "email"] === value),
      };
      return query;
    },
    insertInto: () => ({ values: (row: Record<string, unknown>) => ({ execute: async () => { rows.push(row); inserted.push(row); } }) }),
  };
  return { db: db as unknown as AppDatabase, rows, inserted };
}

describe("legacy user bootstrap", () => {
  it("preserves IDs, activity, owner and SIP; only active users receive random temporary passwords", async () => {
    const { db, inserted } = database();
    let passwords: Record<string, string> = {};
    const result = await bootstrapLegacyUsers(db, [fixture(), fixture({ public_id: "usr_bbcc", email: "inactive@example.test", is_active: false, role: "calisan" })], encryptor, async (value) => { passwords = value; });
    expect(result).toEqual({ created: 2, skipped: 0 });
    expect(inserted[0]).toMatchObject({ public_id: "usr_aabb", role_id: 7, is_active: true, must_change_password: true, sip_extension: "101" });
    expect(inserted[1]).toMatchObject({ is_active: false, must_change_password: false });
    expect(Object.keys(passwords)).toEqual(["fixture@example.test"]);
    const password = passwords["fixture@example.test"]!;
    expect(password.length).toBeGreaterThanOrEqual(32);
    expect(await verifyPassword(inserted[0]!.password_hash as string, password)).toBe(true);
    expect(encryptor.decryptJson(JSON.parse(inserted[0]!.sip_password_encrypted as string))).toBe("fixture-secret");
    expect(inserted[0]!.sip_password_encrypted).not.toContain("fixture-secret");
  });
  it("skips existing public IDs without regenerating credentials", async () => {
    const { db, inserted } = database([{ public_id: "usr_aabb", email: "fixture@example.test" }]);
    const write = vi.fn(async () => undefined);
    expect(await bootstrapLegacyUsers(db, [fixture()], encryptor, write)).toEqual({ created: 0, skipped: 1 });
    expect(inserted).toEqual([]);
    expect(write).toHaveBeenCalledWith({});
  });
  it("rejects email/public-id conflicts and rolls back the whole batch", async () => {
    const { db, rows } = database([{ public_id: "usr_ffff", email: "fixture@example.test" }]);
    const write = vi.fn(async () => undefined);
    await expect(bootstrapLegacyUsers(db, [fixture({ public_id: "usr_ccdd", email: "first@example.test" }), fixture()], encryptor, write)).rejects.toThrow("different public id");
    expect(rows).toHaveLength(1);
    expect(write).not.toHaveBeenCalled();
  });
  it("rolls back when the credential file cannot be written", async () => {
    const { db, rows } = database();
    await expect(bootstrapLegacyUsers(db, [fixture()], encryptor, async () => { throw new Error("disk full"); })).rejects.toThrow("disk full");
    expect(rows).toEqual([]);
  });
  it("validates input without leaking personal data", () => {
    expect(() => parseLegacyUsers([fixture({ role: "unknown" as "owner" })])).toThrow("Invalid legacy users file");
    expect(() => parseLegacyUsers([fixture(), fixture()])).toThrow("Duplicate identities");
    expect(() => parseLegacyUsers([{ ...fixture(), password: "do-not-import" }])).toThrow("Invalid legacy users file");
  });
});
