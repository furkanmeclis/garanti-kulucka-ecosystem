import { createHash } from "node:crypto";
import type { AppDatabase, LegacyIdMapTable, MigrationBatchesTable } from "@garanti-kulucka/database";
import type { Insertable } from "kysely";
import type {
  CanonicalRecord,
  CanonicalWriteResult,
  LegacyIdMapEntry,
  LegacyIdMapKey,
  LegacyIdMapWrite,
  MigrationBatchState,
  MigrationBatchStateFailure,
  MigrationBatchStateStart,
  MigrationBatchStateSuccess,
  MigrationEntity,
  MigrationTarget,
} from "./types.js";

const canonicalTargetTables = new Set<MigrationEntity>([
  "customers",
  "customer_addresses",
  "conversations",
  "messages",
  "products",
  "orders",
  "order_items",
  "shipments",
  "shipment_tracking_events",
  "integration_accounts",
  "integration_settings",
  "webhook_subscriptions",
  "files",
  "settings",
]);

export function assertCanonicalTargetTable(table: string): asserts table is MigrationEntity {
  if (!canonicalTargetTables.has(table as MigrationEntity)) {
    throw new Error(`Unsupported canonical target table: ${table}`);
  }
}

export function mapCanonicalRecordToInsert(record: CanonicalRecord): Record<string, unknown> {
  assertCanonicalTargetTable(record.targetTable);

  if ("id" in record.payload || "created_at" in record.payload || "updated_at" in record.payload) {
    throw new Error(`Canonical record payload contains reserved columns: ${record.targetTable}`);
  }

  return {
    public_id: record.targetId,
    ...record.payload,
  };
}

export class DatabaseMigrationTarget implements MigrationTarget {
  constructor(private readonly db: AppDatabase) {}

  async writeCanonicalRecord(input: CanonicalRecord): Promise<CanonicalWriteResult> {
    const values = mapCanonicalRecordToInsert(input);
    const db = this.db as unknown as DynamicMigrationDatabase;
    const existing = await db
      .selectFrom(input.targetTable)
      .select("public_id")
      .where("public_id", "=", input.targetId)
      .executeTakeFirst();

    await db
      .insertInto(input.targetTable)
      .values(values)
      .onConflict((conflict) =>
        conflict.column("public_id").doUpdateSet({
          ...values,
          updated_at: new Date(),
        } as never),
      )
      .execute();

    return {
      status: existing ? "updated" : "created",
      record: input,
    };
  }

  async findLegacyIdMap(input: LegacyIdMapKey): Promise<LegacyIdMapEntry | null> {
    const row = await this.db
      .selectFrom("legacy_id_map")
      .selectAll()
      .where("source_system", "=", input.sourceSystem)
      .where("source_table", "=", input.sourceTable)
      .where("source_id", "=", input.sourceId)
      .executeTakeFirst();

    return row ? mapLegacyIdMapRow(row) : null;
  }

  async upsertLegacyIdMap(input: LegacyIdMapWrite): Promise<LegacyIdMapEntry> {
    const row = await this.db
      .insertInto("legacy_id_map")
      .values({
        source_system: input.sourceSystem,
        source_table: input.sourceTable,
        source_id: input.sourceId,
        target_table: input.targetTable,
        target_id: input.targetId,
        checksum: input.checksum,
      })
      .onConflict((conflict) =>
        conflict.columns(["source_system", "source_table", "source_id"]).doUpdateSet({
          target_table: input.targetTable,
          target_id: input.targetId,
          checksum: input.checksum,
          migrated_at: new Date(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    return mapLegacyIdMapRow(row);
  }

  async recordMigrationBatchStarted(input: MigrationBatchStateStart): Promise<MigrationBatchState> {
    const startedAt = input.startedAt ?? new Date();
    const row = await this.db
      .insertInto("migration_batches")
      .values({
        public_id: migrationBatchPublicId(input.runId, input.batch.entity, input.batch.batchNumber),
        run_id: input.runId,
        entity: input.batch.entity,
        batch_number: input.batch.batchNumber,
        status: "running",
        limit_rows: input.batch.limit,
        offset_rows: input.batch.offset,
        expected_rows: input.batch.expectedRows,
        read_rows: 0,
        written_rows: 0,
        skipped_rows: 0,
        id_map_created: 0,
        id_map_updated: 0,
        id_map_unchanged: 0,
        warnings: [],
        error_message: null,
        started_at: startedAt,
        finished_at: null,
      })
      .onConflict((conflict) =>
        conflict.columns(["run_id", "entity", "batch_number"]).doUpdateSet({
          status: "running",
          limit_rows: input.batch.limit,
          offset_rows: input.batch.offset,
          expected_rows: input.batch.expectedRows,
          read_rows: 0,
          written_rows: 0,
          skipped_rows: 0,
          id_map_created: 0,
          id_map_updated: 0,
          id_map_unchanged: 0,
          warnings: [],
          error_message: null,
          started_at: startedAt,
          finished_at: null,
          updated_at: startedAt,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    return mapMigrationBatchStateRow(row);
  }

  async recordMigrationBatchSucceeded(input: MigrationBatchStateSuccess): Promise<MigrationBatchState> {
    const finishedAt = input.finishedAt ?? new Date();
    const row = await this.db
      .insertInto("migration_batches")
      .values({
        public_id: migrationBatchPublicId(input.runId, input.batch.entity, input.batch.batchNumber),
        run_id: input.runId,
        entity: input.batch.entity,
        batch_number: input.batch.batchNumber,
        status: "succeeded",
        limit_rows: input.batch.limit,
        offset_rows: input.batch.offset,
        expected_rows: input.batch.expectedRows,
        read_rows: input.result.readRows,
        written_rows: input.result.writtenRows,
        skipped_rows: input.result.skippedRows,
        id_map_created: input.result.idMapCreated,
        id_map_updated: input.result.idMapUpdated,
        id_map_unchanged: input.result.idMapUnchanged,
        warnings: input.result.warnings,
        error_message: null,
        started_at: null,
        finished_at: finishedAt,
      })
      .onConflict((conflict) =>
        conflict.columns(["run_id", "entity", "batch_number"]).doUpdateSet({
          status: "succeeded",
          read_rows: input.result.readRows,
          written_rows: input.result.writtenRows,
          skipped_rows: input.result.skippedRows,
          id_map_created: input.result.idMapCreated,
          id_map_updated: input.result.idMapUpdated,
          id_map_unchanged: input.result.idMapUnchanged,
          warnings: input.result.warnings,
          error_message: null,
          finished_at: finishedAt,
          updated_at: finishedAt,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    return mapMigrationBatchStateRow(row);
  }

  async recordMigrationBatchFailed(input: MigrationBatchStateFailure): Promise<MigrationBatchState> {
    const finishedAt = input.finishedAt ?? new Date();
    const row = await this.db
      .insertInto("migration_batches")
      .values({
        public_id: migrationBatchPublicId(input.runId, input.batch.entity, input.batch.batchNumber),
        run_id: input.runId,
        entity: input.batch.entity,
        batch_number: input.batch.batchNumber,
        status: "failed",
        limit_rows: input.batch.limit,
        offset_rows: input.batch.offset,
        expected_rows: input.batch.expectedRows,
        read_rows: 0,
        written_rows: 0,
        skipped_rows: 0,
        id_map_created: 0,
        id_map_updated: 0,
        id_map_unchanged: 0,
        warnings: [],
        error_message: input.error.message,
        started_at: null,
        finished_at: finishedAt,
      })
      .onConflict((conflict) =>
        conflict.columns(["run_id", "entity", "batch_number"]).doUpdateSet({
          status: "failed",
          error_message: input.error.message,
          finished_at: finishedAt,
          updated_at: finishedAt,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    return mapMigrationBatchStateRow(row);
  }
}

interface DynamicMigrationDatabase {
  selectFrom(table: string): DynamicSelectBuilder;
  insertInto(table: string): DynamicInsertBuilder;
}

interface DynamicSelectBuilder {
  select(selection: string): DynamicSelectBuilder;
  selectAll(): DynamicSelectBuilder;
  where(column: string, operator: string, value: unknown): DynamicSelectBuilder;
  executeTakeFirst(): Promise<Record<string, unknown> | undefined>;
}

interface DynamicInsertBuilder {
  values(input: Record<string, unknown>): DynamicInsertBuilder;
  onConflict(callback: (conflict: DynamicConflictBuilder) => unknown): DynamicInsertBuilder;
  returningAll(): DynamicInsertBuilder;
  execute(): Promise<unknown>;
  executeTakeFirstOrThrow(): Promise<Insertable<LegacyIdMapTable> & { migrated_at?: Date | string }>;
}

interface DynamicConflictBuilder {
  column(column: string): DynamicConflictBuilder;
  columns(columns: string[]): DynamicConflictBuilder;
  doUpdateSet(values: Record<string, unknown>): DynamicConflictBuilder;
}

function mapLegacyIdMapRow(row: Insertable<LegacyIdMapTable> & { migrated_at?: Date | string }): LegacyIdMapEntry {
  return {
    sourceSystem: row.source_system,
    sourceTable: row.source_table,
    sourceId: row.source_id,
    targetTable: row.target_table,
    targetId: row.target_id,
    checksum: row.checksum ?? null,
    migratedAt: row.migrated_at ? new Date(row.migrated_at) : new Date(),
  };
}

type MigrationBatchStateRow = Insertable<MigrationBatchesTable> & {
  started_at?: Date | string | null;
  finished_at?: Date | string | null;
};

function mapMigrationBatchStateRow(row: MigrationBatchStateRow): MigrationBatchState {
  return {
    runId: row.run_id,
    entity: row.entity as MigrationEntity,
    batchNumber: Number(row.batch_number),
    status: row.status as MigrationBatchState["status"],
    limit: Number(row.limit_rows),
    offset: Number(row.offset_rows),
    expectedRows: Number(row.expected_rows),
    readRows: Number(row.read_rows),
    writtenRows: Number(row.written_rows),
    skippedRows: Number(row.skipped_rows),
    idMapCreated: Number(row.id_map_created),
    idMapUpdated: Number(row.id_map_updated),
    idMapUnchanged: Number(row.id_map_unchanged),
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
    errorMessage: row.error_message ?? null,
    startedAt: row.started_at ? new Date(row.started_at) : null,
    finishedAt: row.finished_at ? new Date(row.finished_at) : null,
  };
}

function migrationBatchPublicId(runId: string, entity: MigrationEntity, batchNumber: number): string {
  const hash = createHash("sha256").update(`${runId}:${entity}:${batchNumber}`).digest("hex").slice(0, 24);
  return `mbt_${hash}`;
}
