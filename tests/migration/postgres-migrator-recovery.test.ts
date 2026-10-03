import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyMigrationBatchWithState } from "../../apps/migrator/src/apply.js";
import { DatabaseMigrationTarget } from "../../apps/migrator/src/target.js";
import { createDatabase } from "../../packages/database/src/index.js";
import type {
  CanonicalRecord,
  CanonicalWriteResult,
  LegacyIdMapEntry,
  LegacyIdMapKey,
  LegacyIdMapWrite,
  LegacyRecord,
  LegacySource,
  MigrationBatchState,
  MigrationBatchStateFailure,
  MigrationBatchStateKey,
  MigrationBatchStateStart,
  MigrationBatchStateSuccess,
  MigrationEntity,
  MigrationRunRegistration,
  MigrationRunState,
  MigrationTarget,
  SourceTableSnapshot,
} from "../../apps/migrator/src/types.js";

const migrationsDirectory = fileURLToPath(
  new URL("../../packages/database/migrations/", import.meta.url),
);

describe("PostgreSQL migrator recovery E2E", () => {
  it("rolls back an interrupted batch and resumes the same run idempotently", async () => {
    const container = `gk-migrator-recovery-${randomUUID().slice(0, 8)}`;
    docker([
      "run",
      "--detach",
      "--rm",
      "--name",
      container,
      "--publish",
      "127.0.0.1::5432",
      "--env",
      "POSTGRES_PASSWORD=postgres",
      "--env",
      "POSTGRES_DB=garanti_kulucka",
      "postgres:18-alpine",
    ]);

    let db: ReturnType<typeof createDatabase> | undefined;
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

      db = createDatabase(postgresUrl(container));
      const target = new DatabaseMigrationTarget(db);
      const runId = "p4-recovery-run";
      const batch = {
        entity: "customers" as const,
        batchNumber: 1,
        limit: 1,
        offset: 0,
        expectedRows: 1,
      };
      const source = new RecoverySource([customerRecord()]);

      await target.registerMigrationRun({
        runId,
        manifest: recoveryManifest(),
      });

      await expect(applyMigrationBatchWithState({
        runId,
        source,
        target: new FailAfterFirstCanonicalWriteTarget(target),
        batch,
        transform: customerTransformer,
      })).rejects.toThrow("simulated network drop after canonical write");

      expect(query(container, "garanti_kulucka", "select count(*) from customers")).toBe("0");
      expect(query(container, "garanti_kulucka", "select count(*) from legacy_id_map")).toBe("0");
      expect(query(container, "garanti_kulucka", `
        select status || ':' || read_rows || ':' || written_rows || ':' || error_message
        from migration_batches
        where run_id = 'p4-recovery-run' and entity = 'customers' and batch_number = 1
      `)).toBe("failed:0:0:simulated network drop after canonical write");

      await expect(applyMigrationBatchWithState({
        runId,
        source,
        target,
        batch,
        transform: customerTransformer,
      })).resolves.toMatchObject({
        readRows: 1,
        writtenRows: 1,
        idMapCreated: 1,
      });

      expect(query(container, "garanti_kulucka", `
        select concat_ws(':',
          (select count(*) from customers where public_id = 'cus_recovery_1'),
          (select count(*) from legacy_id_map where run_id = 'p4-recovery-run' and target_id = 'cus_recovery_1'),
          (select status from migration_batches where run_id = 'p4-recovery-run' and entity = 'customers' and batch_number = 1),
          (select written_rows from migration_batches where run_id = 'p4-recovery-run' and entity = 'customers' and batch_number = 1)
        )
      `)).toBe("1:1:succeeded:1");
      expect(source.reads).toBe(2);

      await expect(applyMigrationBatchWithState({
        runId,
        source,
        target,
        batch,
        transform: customerTransformer,
      })).resolves.toMatchObject({
        readRows: 1,
        writtenRows: 1,
        idMapCreated: 1,
      });

      expect(source.reads).toBe(2);
      expect(query(container, "garanti_kulucka", `
        select concat_ws(':',
          (select count(*) from customers where public_id = 'cus_recovery_1'),
          (select count(*) from legacy_id_map where run_id = 'p4-recovery-run' and target_id = 'cus_recovery_1'),
          (select count(*) from migration_batches where run_id = 'p4-recovery-run' and status = 'succeeded')
        )
      `)).toBe("1:1:1");
    } finally {
      await db?.destroy();
      docker(["rm", "--force", container], true);
    }
  }, 180_000);
});

class RecoverySource implements LegacySource {
  reads = 0;

  constructor(private readonly records: readonly LegacyRecord[]) {}

  async count(_entity: MigrationEntity): Promise<number> {
    return this.records.length;
  }

  async readBatch(_entity: MigrationEntity): Promise<LegacyRecord[]> {
    this.reads += 1;
    return [...this.records];
  }

  async describeTables(entities: readonly MigrationEntity[]): Promise<SourceTableSnapshot[]> {
    return entities.map((entity) => ({
      entity,
      schema: "public",
      table: "musteriler",
      idColumn: "id",
      columns: [{ name: "id", ordinalPosition: 1, dataType: "uuid", udtName: "uuid", nullable: false }],
    }));
  }
}

class FailAfterFirstCanonicalWriteTarget implements MigrationTarget {
  private writesBeforeFailure = 0;

  constructor(private readonly inner: MigrationTarget) {}

  async runWithMigrationRunLock<T>(
    runId: string,
    operation: (target: MigrationTarget) => Promise<T>,
  ): Promise<T> {
    if (!this.inner.runWithMigrationRunLock) return operation(this);
    return this.inner.runWithMigrationRunLock(runId, (target) =>
      operation(new FailAfterFirstCanonicalWriteTarget(target)));
  }

  async runInTransaction<T>(operation: (target: MigrationTarget) => Promise<T>): Promise<T> {
    if (!this.inner.runInTransaction) return operation(this);
    return this.inner.runInTransaction((target) =>
      operation(new FailAfterFirstCanonicalWriteTarget(target)));
  }

  async writeCanonicalRecord(input: CanonicalRecord): Promise<CanonicalWriteResult> {
    const result = await this.inner.writeCanonicalRecord(input);
    this.writesBeforeFailure += 1;
    if (this.writesBeforeFailure === 1) {
      throw new Error("simulated network drop after canonical write");
    }
    return result;
  }

  findLegacyIdMap(input: LegacyIdMapKey): Promise<LegacyIdMapEntry | null> {
    return this.inner.findLegacyIdMap(input);
  }

  upsertLegacyIdMap(input: LegacyIdMapWrite): Promise<LegacyIdMapEntry> {
    return this.inner.upsertLegacyIdMap(input);
  }

  findMigrationBatchState(input: MigrationBatchStateKey): Promise<MigrationBatchState | null> {
    return this.inner.findMigrationBatchState(input);
  }

  recordMigrationBatchStarted(input: MigrationBatchStateStart): Promise<MigrationBatchState> {
    return this.inner.recordMigrationBatchStarted(input);
  }

  recordMigrationBatchSucceeded(input: MigrationBatchStateSuccess): Promise<MigrationBatchState> {
    return this.inner.recordMigrationBatchSucceeded(input);
  }

  recordMigrationBatchFailed(input: MigrationBatchStateFailure): Promise<MigrationBatchState> {
    return this.inner.recordMigrationBatchFailed(input);
  }

  registerMigrationRun(input: MigrationRunRegistration): Promise<MigrationRunState> {
    return this.inner.registerMigrationRun(input);
  }
}

function customerRecord(): LegacyRecord {
  return {
    sourceSystem: "legacy_postgres",
    sourceTable: "public.musteriler",
    sourceId: "recovery-1",
    payload: {
      full_name: "Ada Recovery",
      phone: "+90 555 000 00 00",
      email: "recovery@example.test",
      username: "ada-recovery",
      notes: null,
    },
    checksum: "sha256:recovery",
  };
}

function customerTransformer(record: LegacyRecord): CanonicalRecord {
  return {
    targetTable: "customers",
    targetId: "cus_recovery_1",
    payload: record.payload,
    checksum: record.checksum,
  };
}

function recoveryManifest() {
  return {
    sourceSystem: "legacy_postgres",
    databaseIdentity: { host: "127.0.0.1", port: "5432", database: "legacy" },
    tables: [{
      entity: "customers" as const,
      schema: "public",
      table: "musteriler",
      idColumn: "id",
      columns: [{ name: "id", ordinalPosition: 1, dataType: "uuid", udtName: "uuid", nullable: false }],
    }],
    rowCounts: [{ entity: "customers" as const, rows: 1 }],
    rowContentChecksums: [{ entity: "customers" as const, rows: 1, checksum: "sha256:rows" }],
    batchSize: 1,
    mappingCatalogVersion: "p4-recovery-e2e-v1",
    planFingerprint: "sha256:plan",
    sourceManifestHash: "sha256:manifest",
  };
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

function postgresUrl(container: string): string {
  const port = docker(["port", container, "5432/tcp"]).trim().split(":").at(-1);
  if (!port) throw new Error("PostgreSQL test container did not publish a host port");
  return `postgres://postgres:postgres@127.0.0.1:${port}/garanti_kulucka`;
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
