import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../migrations/006_add_migration_deferred_reconciliations.sql", import.meta.url);

describe("migration deferred reconciliation contract", () => {
  it("adds a durable queryable deferred reconciliation table", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    const [up, down] = migration.split("-- Down Migration");

    expect(up).toMatch(/CREATE TABLE migration_deferred_reconciliations/);
    expect(up).toMatch(/run_id TEXT NOT NULL REFERENCES migration_runs\(run_id\)/);
    expect(up).toMatch(/status TEXT NOT NULL DEFAULT 'pending' CHECK \(status IN \('pending', 'resolved'\)\)/);
    expect(up).toMatch(/CREATE UNIQUE INDEX migration_deferred_reconciliations_lookup_key/);
    expect(up).toMatch(/CREATE INDEX migration_deferred_reconciliations_pending_idx/);
    expect(down).toMatch(/Cannot drop migration deferred reconciliations while records exist/);
    expect(down).toMatch(/DROP TABLE IF EXISTS migration_deferred_reconciliations/);
  });
});
