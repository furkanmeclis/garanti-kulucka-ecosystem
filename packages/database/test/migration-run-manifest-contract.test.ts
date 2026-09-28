import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../migrations/003_add_migration_run_manifests.sql", import.meta.url);

describe("migration run manifest contract", () => {
  it("persists immutable source identity, plan, and manifest inputs", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    const [up, down] = sql.split("-- Down Migration");

    expect(up).toMatch(/CREATE TABLE migration_runs/);
    expect(up).toMatch(/run_id TEXT NOT NULL UNIQUE/);
    expect(up).toMatch(/CONSTRAINT migration_runs_run_id_nonblank\s+CHECK \(btrim\(run_id\) <> ''\)/);
    expect(up).toMatch(/source_database_identity JSONB NOT NULL/);
    expect(up).toMatch(/table_snapshot JSONB NOT NULL/);
    expect(up).toMatch(/row_counts JSONB NOT NULL/);
    expect(up).toMatch(/batch_size BIGINT NOT NULL CHECK \(batch_size > 0\)/);
    expect(up).toMatch(/mapping_catalog_version TEXT NOT NULL/);
    expect(up).toMatch(/plan_fingerprint TEXT NOT NULL/);
    expect(up).toMatch(/source_manifest_hash TEXT NOT NULL/);
    expect(up).not.toMatch(/updated_at TIMESTAMPTZ/);
    expect(up).toMatch(/IF EXISTS \(SELECT 1 FROM migration_batches\)/);
    expect(up).toMatch(/Cannot add migration run manifests while migration_batches contains data/);
    expect(up).toMatch(/IF EXISTS \(SELECT 1 FROM legacy_id_map\)/);
    expect(up).toMatch(/Cannot add migration run manifests while legacy_id_map contains data/);
    expect(up).toMatch(/ADD CONSTRAINT migration_batches_run_id_fkey/);
    expect(up).toMatch(/FOREIGN KEY \(run_id\) REFERENCES migration_runs\(run_id\)/);
    expect(up).toMatch(/ON UPDATE RESTRICT ON DELETE RESTRICT/);
    expect(up).toMatch(/DROP CONSTRAINT legacy_id_map_source_target_role_key/);
    expect(up).toMatch(/ADD COLUMN run_id TEXT NOT NULL/);
    expect(up).toMatch(/ADD CONSTRAINT legacy_id_map_run_id_fkey/);
    expect(up).toMatch(/FOREIGN KEY \(run_id\) REFERENCES migration_runs\(run_id\)/);
    expect(up).toMatch(/ADD CONSTRAINT legacy_id_map_run_source_target_role_key/);
    expect(up).toMatch(
      /UNIQUE \(run_id, source_system, source_table, source_id, target_table, mapping_role\)/,
    );
    expect(up).toMatch(/CREATE UNIQUE INDEX legacy_id_map_run_primary_target_key/);
    expect(up).toMatch(/ON legacy_id_map\(run_id, target_table, target_id\)/);
    expect(up).toMatch(/WHERE mapping_role = 'primary'/);
    expect(up).toMatch(/CREATE TRIGGER migration_runs_immutable/);
    expect(up).toMatch(/BEFORE UPDATE OR DELETE ON migration_runs/);
    expect(up).toMatch(/migration_runs rows are immutable/);
    expect(down).toMatch(/IF EXISTS \(SELECT 1 FROM migration_runs\)/);
    expect(down).toMatch(/DROP CONSTRAINT IF EXISTS migration_batches_run_id_fkey/);
    expect(down).toMatch(/DROP CONSTRAINT IF EXISTS legacy_id_map_run_source_target_role_key/);
    expect(down).toMatch(/DROP INDEX IF EXISTS legacy_id_map_run_primary_target_key/);
    expect(down).toMatch(/DROP CONSTRAINT IF EXISTS legacy_id_map_run_id_fkey/);
    expect(down).toMatch(/DROP COLUMN IF EXISTS run_id/);
    expect(down).toMatch(/ADD CONSTRAINT legacy_id_map_source_target_role_key/);
    expect(down).toMatch(/DROP TRIGGER IF EXISTS migration_runs_immutable ON migration_runs/);
  });
});
