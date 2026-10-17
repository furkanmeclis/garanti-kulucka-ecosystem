import { mkdtemp, mkdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mapLegacyUsers, privateOutput } from "../../../tools/legacy-users-export.mjs";
import { openPrivateOutput } from "../src/bootstrap/private-file.js";

const row = { id: "00000000-0000-4000-a000-000000000001", email: "fixture@example.test", ad: "Test", soyad: "User", telefon: null,
  aktif: true, role_name: "admin", sip_kullanici_adi: "fixture", sip_sifre: "secret", sip_dahili: 101 };
const mapping = { [row.id]: "usr_aabb" };
const paths: string[] = [];
afterEach(async () => { for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true }); });
describe("read-only legacy export mapping", () => {
  it("maps owner, inactive history users and SIP extension without copying auth passwords", () => {
    const users = mapLegacyUsers([{ ...row, aktif: false }], mapping, row.email.toUpperCase());
    expect(users[0]).toMatchObject({ public_id: "usr_aabb", role: "owner", is_active: false, sip_extension: "101" });
    expect(users[0]).not.toHaveProperty("password");
  });
  it("rejects unknown roles, missing mappings, invalid IDs and missing owner", () => {
    expect(() => mapLegacyUsers([{ ...row, role_name: "unknown" }], mapping, row.email)).toThrow("Unknown legacy role");
    expect(() => mapLegacyUsers([row], {}, row.email)).toThrow("Missing or invalid");
    expect(() => mapLegacyUsers([row], { [row.id]: "bad" }, row.email)).toThrow("Missing or invalid");
    expect(() => mapLegacyUsers([row], mapping, "missing@example.test")).toThrow("Owner");
  });
});
for (const [name, create] of [["export", privateOutput], ["bootstrap", openPrivateOutput]] as const) {
  describe(`${name} private output`, () => {
    it("creates mode 600 and refuses overwriting files", async () => {
      const directory = await mkdtemp(join(tmpdir(), "legacy-output-")); paths.push(directory);
      const path = join(directory, "secret.json");
      const file = await create(path); await file.close();
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      await expect(create(path)).rejects.toThrow();
    });
    it("refuses repository paths and symlinked parents pointing into the repository", async () => {
      await expect(create(resolve("secret.json"))).rejects.toThrow("outside");
      const directory = await mkdtemp(join(tmpdir(), "legacy-output-")); paths.push(directory);
      await mkdir(join(directory, "nested"));
      await symlink(resolve("."), join(directory, "repo"));
      await expect(create(join(directory, "repo", "secret.json"))).rejects.toThrow("outside");
    });
  });
}
