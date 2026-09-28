import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../migrations/002_add_migration_identity_targets.sql", import.meta.url);

async function migrationSections() {
  const sql = await readFile(migrationUrl, "utf8");
  const [up, down] = sql.split("-- Down Migration");

  if (!up || !down) {
    throw new Error("Migration must define forward and down sections");
  }

  return { up, down };
}

describe("migration identity target contract", () => {
  it("creates constrained customer external identities and indexed foreign keys", async () => {
    const { up } = await migrationSections();

    expect(up).toMatch(/CREATE TABLE customer_external_identities/);
    expect(up).toMatch(/id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY/);
    expect(up).toMatch(/public_id TEXT NOT NULL UNIQUE/);
    expect(up).toMatch(/customer_id BIGINT NOT NULL REFERENCES customers\(id\) ON DELETE CASCADE/);
    expect(up).toMatch(/integration_account_id BIGINT NOT NULL REFERENCES integration_accounts\(id\) ON DELETE CASCADE/);
    expect(up).not.toMatch(/provider TEXT/);
    expect(up).toMatch(/external_id TEXT NOT NULL/);
    expect(up).toMatch(/metadata JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
    expect(up).toMatch(/CHECK \(jsonb_typeof\(metadata\) = 'object'\)/);
    expect(up).toMatch(/UNIQUE \(integration_account_id, external_id\)/);
    expect(up).toMatch(/UNIQUE \(customer_id, integration_account_id\)/);
    expect(up).toMatch(/customer_external_identities_customer_id_idx[\s\S]*\(customer_id\)/);
    expect(up).toMatch(/customer_external_identities_integration_account_id_idx[\s\S]*\(integration_account_id\)/);
  });

  it("adds the nullable conversation integration account relation and index", async () => {
    const { up } = await migrationSections();

    expect(up).toMatch(/ADD COLUMN integration_account_id BIGINT/);
    expect(up).toMatch(/FOREIGN KEY \(integration_account_id\)[\s\S]*REFERENCES integration_accounts\(id\)[\s\S]*ON DELETE SET NULL/);
    expect(up).toMatch(/conversations_integration_account_id_idx[\s\S]*conversations\(integration_account_id\)/);
    expect(up).toMatch(/DROP INDEX conversations_channel_external_thread_idx/);
    expect(up).toMatch(
      /conversations_account_external_thread_idx[\s\S]*\(integration_account_id, external_thread_id\)[\s\S]*WHERE integration_account_id IS NOT NULL AND external_thread_id IS NOT NULL/,
    );
    expect(up).toMatch(
      /conversations_accountless_channel_external_thread_idx[\s\S]*\(channel, external_thread_id\)[\s\S]*WHERE integration_account_id IS NULL AND external_thread_id IS NOT NULL/,
    );
  });

  it("adds role-aware multi-target legacy id mappings", async () => {
    const { up, down } = await migrationSections();

    expect(up).toMatch(/ADD COLUMN mapping_role TEXT NOT NULL DEFAULT 'primary'/);
    expect(up).toMatch(/DROP CONSTRAINT legacy_id_map_source_system_source_table_source_id_key/);
    expect(up).toMatch(
      /UNIQUE \(source_system, source_table, source_id, target_table, mapping_role\)/,
    );
    expect(down).toMatch(/HAVING count\(\*\) > 1/);
    expect(down).toMatch(/DROP CONSTRAINT IF EXISTS legacy_id_map_source_target_role_key/);
    expect(down).toMatch(/DROP COLUMN IF EXISTS mapping_role/);
  });

  it("removes dependent conversation objects before the identity table on down", async () => {
    const { down } = await migrationSections();
    const scopedIndexPosition = down.indexOf("DROP INDEX IF EXISTS conversations_account_external_thread_idx");
    const accountlessIndexPosition = down.indexOf("DROP INDEX IF EXISTS conversations_accountless_channel_external_thread_idx");
    const legacyIndexPosition = down.indexOf("CREATE UNIQUE INDEX conversations_channel_external_thread_idx");
    const indexPosition = down.indexOf("DROP INDEX IF EXISTS conversations_integration_account_id_idx");
    const constraintPosition = down.indexOf("DROP CONSTRAINT IF EXISTS conversations_integration_account_id_fkey");
    const columnPosition = down.indexOf("DROP COLUMN IF EXISTS integration_account_id");
    const tablePosition = down.indexOf("DROP TABLE IF EXISTS customer_external_identities");

    expect(scopedIndexPosition).toBeGreaterThanOrEqual(0);
    expect(accountlessIndexPosition).toBeGreaterThan(scopedIndexPosition);
    expect(legacyIndexPosition).toBeGreaterThan(accountlessIndexPosition);
    expect(indexPosition).toBeGreaterThan(legacyIndexPosition);
    expect(indexPosition).toBeGreaterThanOrEqual(0);
    expect(constraintPosition).toBeGreaterThan(indexPosition);
    expect(columnPosition).toBeGreaterThan(constraintPosition);
    expect(tablePosition).toBeGreaterThan(columnPosition);
  });
});
