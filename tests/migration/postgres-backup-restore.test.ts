import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDirectory = fileURLToPath(
  new URL("../../packages/database/migrations/", import.meta.url),
);

describe("PostgreSQL backup and restore rehearsal", () => {
  it("restores canonical data and migration state from a custom-format dump", async () => {
    const container = `gk-backup-restore-${randomUUID().slice(0, 8)}`;
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
      seedCanonicalData(container, "garanti_kulucka");

      docker([
        "exec",
        container,
        "pg_dump",
        "--username",
        "postgres",
        "--dbname",
        "garanti_kulucka",
        "--format",
        "custom",
        "--file",
        "/tmp/garanti_kulucka_rehearsal.dump",
      ]);
      executeSql(container, "postgres", "create database restored_canonical");
      docker([
        "exec",
        container,
        "pg_restore",
        "--username",
        "postgres",
        "--dbname",
        "restored_canonical",
        "--no-owner",
        "/tmp/garanti_kulucka_rehearsal.dump",
      ]);

      expect(rehearsalFingerprint(container, "restored_canonical")).toBe(
        rehearsalFingerprint(container, "garanti_kulucka"),
      );
      expect(query(container, "restored_canonical", `
        select concat_ws(':',
          (select count(*) from migration_runs where run_id = 'p4-backup-rehearsal'),
          (select count(*) from migration_batches where run_id = 'p4-backup-rehearsal' and status = 'succeeded'),
          (select count(*) from legacy_id_map where run_id = 'p4-backup-rehearsal' and target_id = 'cus_backup_1'),
          (select count(*) from customers where public_id = 'cus_backup_1')
        )
      `)).toBe("1:1:1:1");
    } finally {
      docker(["rm", "--force", container], true);
    }
  }, 180_000);
});

function seedCanonicalData(container: string, database: string): void {
  executeSql(container, database, `
    insert into customers (public_id, full_name, phone, email, username, notes)
    values ('cus_backup_1', 'Backup Rehearsal', '+90 555 000 00 00', 'backup@example.test', 'backup-rehearsal', null);

    insert into migration_runs (
      public_id, run_id, source_system, source_database_identity, table_snapshot, row_counts,
      row_content_checksums, batch_size, mapping_catalog_version, plan_fingerprint, source_manifest_hash
    ) values (
      'mrn_backup_rehearsal',
      'p4-backup-rehearsal',
      'legacy_postgres',
      '{"host":"legacy","port":"5432","database":"source"}'::jsonb,
      '[{"entity":"customers","schema":"public","table":"musteriler","idColumn":"id","columns":[]}]'::jsonb,
      '[{"entity":"customers","rows":1}]'::jsonb,
      '[{"entity":"customers","rows":1,"checksum":"sha256:backup"}]'::jsonb,
      1,
      'p4-backup-rehearsal-v1',
      'sha256:plan',
      'sha256:manifest'
    );

    insert into migration_batches (
      public_id, run_id, entity, batch_number, status, limit_rows, offset_rows, expected_rows,
      read_rows, written_rows, skipped_rows, id_map_created, id_map_updated, id_map_unchanged, warnings
    ) values (
      'mbt_backup_rehearsal',
      'p4-backup-rehearsal',
      'customers',
      1,
      'succeeded',
      1,
      0,
      1,
      1,
      1,
      0,
      1,
      0,
      0,
      '[]'::jsonb
    );

    insert into legacy_id_map (
      run_id, source_system, source_table, source_id, target_table, mapping_role, target_id, checksum
    ) values (
      'p4-backup-rehearsal',
      'legacy_postgres',
      'public.musteriler',
      'backup-1',
      'customers',
      'primary',
      'cus_backup_1',
      'sha256:backup'
    );
  `);
}

function rehearsalFingerprint(container: string, database: string): string {
  return query(container, database, `
    select concat_ws('|',
      (select public_id || ':' || full_name || ':' || coalesce(email, '') from customers where public_id = 'cus_backup_1'),
      (select run_id || ':' || mapping_catalog_version || ':' || row_content_checksums::text from migration_runs where run_id = 'p4-backup-rehearsal'),
      (select entity || ':' || status || ':' || written_rows from migration_batches where run_id = 'p4-backup-rehearsal' and batch_number = 1),
      (select source_table || ':' || source_id || ':' || target_table || ':' || mapping_role || ':' || target_id from legacy_id_map where run_id = 'p4-backup-rehearsal')
    )
  `);
}

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
        "select 1",
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
