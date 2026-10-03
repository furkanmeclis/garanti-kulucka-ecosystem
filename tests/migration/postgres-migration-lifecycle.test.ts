import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDirectory = fileURLToPath(
  new URL("../../packages/database/migrations/", import.meta.url),
);

describe("PostgreSQL migration lifecycle", () => {
  it("validates and preserves the additive WooCommerce provider seed", async () => {
    const container = `gk-migration-${randomUUID().slice(0, 8)}`;
    docker([
      "run",
      "--detach",
      "--rm",
      "--name",
      container,
      "--env",
      "POSTGRES_PASSWORD=postgres",
      "--env",
      "POSTGRES_DB=garanti_kulucka",
      "postgres:18-alpine",
    ]);

    try {
      await waitForPostgres(container);
      for (const migration of [
        "001_initial_canonical_schema.sql",
        "002_add_migration_identity_targets.sql",
        "003_add_migration_run_manifests.sql",
        "004_add_woocommerce_provider.sql",
        "005_add_migration_row_content_checksums.sql",
      ]) {
        executeSql(container, "garanti_kulucka", await migrationSection(migration, "up"));
      }

      expect(query(container, "garanti_kulucka", `
        SELECT public_id || ':' || key || ':' || name || ':' || is_active
        FROM integration_providers
        WHERE key = 'woocommerce'
      `)).toBe("prv_woocommerce:woocommerce:WooCommerce:true");
      expect(query(container, "garanti_kulucka", `
        SELECT column_name || ':' || data_type
        FROM information_schema.columns
        WHERE table_name = 'migration_runs' AND column_name = 'row_content_checksums'
      `)).toBe("row_content_checksums:jsonb");

      executeSql(container, "garanti_kulucka", `
        WITH provider AS (
          SELECT id FROM integration_providers WHERE key = 'woocommerce'
        )
        INSERT INTO integration_accounts (public_id, provider_id, display_name)
        SELECT 'iac_woocommerce_test', id, 'WooCommerce migration test' FROM provider;

        WITH provider AS (
          SELECT id FROM integration_providers WHERE key = 'woocommerce'
        )
        INSERT INTO integration_settings (public_id, provider_id, key, value)
        SELECT 'ist_woocommerce_test', id, 'migration-test', '{}'::jsonb FROM provider;

        WITH provider AS (
          SELECT id FROM integration_providers WHERE key = 'woocommerce'
        )
        INSERT INTO webhook_subscriptions (public_id, provider_id, callback_path)
        SELECT 'whs_woocommerce_test', id, '/migration-test' FROM provider;

        WITH provider AS (
          SELECT id FROM integration_providers WHERE key = 'woocommerce'
        )
        INSERT INTO webhook_events (
          public_id, provider_id, event_type, payload_hash, raw_payload
        )
        SELECT 'whe_woocommerce_test', id, 'migration.test', 'sha256:test', '{}'::jsonb FROM provider;

        WITH provider AS (
          SELECT id FROM integration_providers WHERE key = 'woocommerce'
        )
        INSERT INTO provider_attempts (
          public_id, provider_id, request_id, operation, direction, status,
          duration_ms, retry_decision, started_at
        )
        SELECT
          'pat_woocommerce_test', id, 'req_migration_test', 'migration.test',
          'outbound', 'success', 1, 'none', now()
        FROM provider;
      `);

      executeSql(
        container,
        "garanti_kulucka",
        await migrationSection("004_add_woocommerce_provider.sql", "down"),
      );
      expect(query(container, "garanti_kulucka", `
        SELECT concat_ws(':',
          (SELECT count(*) FROM integration_providers WHERE key = 'woocommerce'),
          (SELECT count(*) FROM integration_accounts WHERE public_id = 'iac_woocommerce_test'),
          (SELECT count(*) FROM integration_settings WHERE public_id = 'ist_woocommerce_test'),
          (SELECT count(*) FROM webhook_subscriptions WHERE public_id = 'whs_woocommerce_test'),
          (SELECT count(*) FROM webhook_events WHERE public_id = 'whe_woocommerce_test'),
          (SELECT count(*) FROM provider_attempts WHERE public_id = 'pat_woocommerce_test')
        )
      `)).toBe("1:1:1:1:1:1");

      executeSql(
        container,
        "garanti_kulucka",
        await migrationSection("004_add_woocommerce_provider.sql", "up"),
      );
      expect(query(container, "garanti_kulucka", `
        SELECT count(*) FROM integration_providers WHERE key = 'woocommerce'
      `)).toBe("1");

      executeSql(container, "postgres", "CREATE DATABASE migration_mismatch");
      executeSql(
        container,
        "migration_mismatch",
        await migrationSection("001_initial_canonical_schema.sql", "up"),
      );
      executeSql(container, "migration_mismatch", `
        INSERT INTO integration_providers (public_id, key, name)
        VALUES ('prv_wrong', 'woocommerce', 'WooCommerce')
      `);
      const woocommerceUp = await migrationSection("004_add_woocommerce_provider.sql", "up");
      expect(() => executeSql(
        container,
        "migration_mismatch",
        woocommerceUp,
      )).toThrow(/Existing WooCommerce provider does not match the canonical migration seed/);
    } finally {
      docker(["rm", "--force", container], true);
    }
  }, 180_000);
});

async function migrationSection(
  filename: string,
  section: "up" | "down",
): Promise<string> {
  const sql = await readFile(`${migrationsDirectory}/${filename}`, "utf8");
  const marker = "-- Down Migration";
  const markerIndex = sql.indexOf(marker);
  if (section === "up") return markerIndex === -1 ? sql : sql.slice(0, markerIndex);
  if (markerIndex === -1) throw new Error(`Migration ${filename} has no down section`);
  return sql.slice(markerIndex + marker.length);
}

async function waitForPostgres(container: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      docker([
        "exec",
        container,
        "psql",
        "--username",
        "postgres",
        "--dbname",
        "garanti_kulucka",
        "--command",
        "SELECT 1",
      ]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("PostgreSQL test container did not become ready");
}

function executeSql(container: string, database: string, sql: string): string {
  return docker([
    "exec",
    "--interactive",
    container,
    "psql",
    "--username",
    "postgres",
    "--dbname",
    database,
    "--set",
    "ON_ERROR_STOP=1",
    "--no-psqlrc",
  ], false, sql);
}

function query(container: string, database: string, sql: string): string {
  return docker([
    "exec",
    "--interactive",
    container,
    "psql",
    "--username",
    "postgres",
    "--dbname",
    database,
    "--set",
    "ON_ERROR_STOP=1",
    "--no-psqlrc",
    "--tuples-only",
    "--no-align",
  ], false, sql).trim();
}

function docker(args: string[], ignoreFailure = false, input?: string): string {
  try {
    return execFileSync("docker", args, {
      encoding: "utf8",
      input,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    if (ignoreFailure) return "";
    throw error;
  }
}
