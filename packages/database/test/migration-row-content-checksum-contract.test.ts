import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../migrations/005_add_migration_row_content_checksums.sql", import.meta.url);

describe("migration row content checksum contract", () => {
  it("adds a JSONB array field to persisted migration run manifests", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    const [up, down] = sql.split("-- Down Migration");

    expect(up).toMatch(/ADD COLUMN row_content_checksums JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
    expect(up).toMatch(/CONSTRAINT migration_runs_row_content_checksums_array/);
    expect(up).toMatch(/CHECK \(jsonb_typeof\(row_content_checksums\) = 'array'\)/);
    expect(down).toMatch(/row_content_checksums <> '\[\]'::jsonb/);
    expect(down).toMatch(/Cannot drop migration row content checksums while migration_runs contains row fingerprints/);
    expect(down).toMatch(/DROP CONSTRAINT IF EXISTS migration_runs_row_content_checksums_array/);
    expect(down).toMatch(/DROP COLUMN IF EXISTS row_content_checksums/);
  });
});
