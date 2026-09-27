import type { AppDatabase, LegacyIdMapTable } from "@garanti-kulucka/database";
import type { Insertable } from "kysely";
import type {
  CanonicalRecord,
  CanonicalWriteResult,
  LegacyIdMapEntry,
  LegacyIdMapKey,
  LegacyIdMapWrite,
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
