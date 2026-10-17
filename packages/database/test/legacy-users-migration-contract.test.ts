import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("adds guarded password-change and SIP columns with compatible rollback", async () => {
  const migration = await readFile(new URL("../migrations/029_add_user_must_change_password_and_sip_extension.sql", import.meta.url), "utf8");
  const [up, down] = migration.split("-- Down Migration");
  expect(up).toContain("-- Up Migration");
  expect(up).toMatch(/ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false/);
  expect(up).toMatch(/ADD COLUMN IF NOT EXISTS sip_extension TEXT/);
  expect(down).toMatch(/DROP COLUMN IF EXISTS must_change_password/);
  expect(down).toMatch(/DROP COLUMN IF EXISTS sip_extension/);
});
