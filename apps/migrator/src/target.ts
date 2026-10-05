import { createHash } from "node:crypto";
import type {
  AppDatabase,
  LegacyIdMapTable,
  MigrationBatchesTable,
  MigrationRunsTable,
} from "@garanti-kulucka/database";
import { sql, type Insertable, type QueryExecutorProvider, type Selectable } from "kysely";
import { assertMigrationRunId } from "./source-manifest.js";
import type {
  CanonicalRecord,
  CanonicalWriteResult,
  ConversationCanonicalRecord,
  CustomerAddressCanonicalRecord,
  CustomerExternalIdentityCanonicalRecord,
  LegacyIdMapEntry,
  LegacyIdMapKey,
  LegacyIdMapWrite,
  MessageCanonicalRecord,
  MigrationBatchState,
  MigrationBatchStateKey,
  MigrationBatchStateFailure,
  MigrationBatchStateStart,
  MigrationBatchStateSuccess,
  MigrationEntity,
  MigrationTarget,
  MigrationRunRegistration,
  MigrationRunState,
  SourceDatabaseIdentity,
  SourceEntityRowCount,
  SourceTableSnapshot,
} from "./types.js";

const canonicalTargetTables = new Set<MigrationEntity>([
  "customers",
  "customer_external_identities",
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

  if (
    "id" in record.payload ||
    "public_id" in record.payload ||
    "created_at" in record.payload ||
    "updated_at" in record.payload
  ) {
    throw new Error(`Canonical record payload contains reserved columns: ${record.targetTable}`);
  }

  return {
    public_id: record.targetId,
    ...record.payload,
  };
}

export class DatabaseMigrationTarget implements MigrationTarget {
  constructor(
    private readonly db: AppDatabase,
    private readonly transactionBoundaryEnabled = true,
  ) {}

  async runInTransaction<T>(operation: (target: MigrationTarget) => Promise<T>): Promise<T> {
    if (!this.transactionBoundaryEnabled) return operation(this);

    return this.db.transaction().execute((transaction) =>
      operation(new DatabaseMigrationTarget(transaction as unknown as AppDatabase, false)),
    );
  }

  async runWithMigrationRunLock<T>(
    runId: string,
    operation: (target: MigrationTarget) => Promise<T>,
  ): Promise<T> {
    assertMigrationRunId(runId);
    const lockKey = `garanti-kulucka:migration:${runId}`;

    return this.db.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`.execute(
        transaction as unknown as QueryExecutorProvider,
      );
      return operation(new DatabaseMigrationTarget(transaction as unknown as AppDatabase, false));
    });
  }

  async writeCanonicalRecord(input: CanonicalRecord): Promise<CanonicalWriteResult> {
    return this.writeResolvedRecord(input);
  }

  async writeCustomerAddressRecord(input: CustomerAddressCanonicalRecord): Promise<CanonicalWriteResult> {
    const customerId = await this.findRequiredPublicId("customers", input.customerPublicId, "customer");
    return this.writeResolvedRecord({
      targetTable: input.targetTable,
      targetId: input.targetId,
      checksum: input.checksum,
      payload: {
        customer_id: customerId,
        label: input.payload.label,
        address_line: input.payload.address_line,
        district: input.payload.district,
        city: input.payload.city,
        country: input.payload.country,
        postal_code: input.payload.postal_code,
        is_default: input.payload.is_default,
      },
    });
  }

  async writeCustomerExternalIdentityRecord(
    input: CustomerExternalIdentityCanonicalRecord,
  ): Promise<CanonicalWriteResult> {
    const customerId = await this.findRequiredPublicId("customers", input.customerPublicId, "customer");
    const integrationAccountId = await this.findRequiredPublicId(
      "integration_accounts",
      input.integrationAccountPublicId,
      "integration account",
    );
    return this.writeResolvedRecord({
      targetTable: input.targetTable,
      targetId: input.targetId,
      checksum: input.checksum,
      payload: {
        customer_id: customerId,
        integration_account_id: integrationAccountId,
        external_id: input.payload.external_id,
        metadata: jsonb(input.payload.metadata),
      },
    });
  }

  async writeConversationRecord(input: ConversationCanonicalRecord): Promise<CanonicalWriteResult> {
    const customerId = await this.findRequiredPublicId("customers", input.customerPublicId, "customer");
    const assignedUserId = input.assignedUserPublicId === null
      ? null
      : await this.findRequiredPublicId("users", input.assignedUserPublicId, "assigned user");
    const integrationAccountId = input.integrationAccountPublicId === null
      ? null
      : await this.findRequiredIntegrationAccountForChannel(input.integrationAccountPublicId, input.payload.channel);

    return this.writeResolvedRecord({
      targetTable: input.targetTable,
      targetId: input.targetId,
      checksum: input.checksum,
      payload: {
        customer_id: customerId,
        assigned_user_id: assignedUserId,
        integration_account_id: integrationAccountId,
        channel: input.payload.channel,
        external_thread_id: input.payload.external_thread_id,
        status: input.payload.status,
        is_in_pool: input.payload.is_in_pool,
        human_agent_enabled: input.payload.human_agent_enabled,
        unread_count: input.payload.unread_count,
        last_message_text: input.payload.last_message_text,
        last_message_sender_type: input.payload.last_message_sender_type,
        last_message_at: input.payload.last_message_at,
      },
    });
  }

  async writeMessageRecord(input: MessageCanonicalRecord): Promise<CanonicalWriteResult> {
    const conversationId = await this.findRequiredPublicId(
      "conversations",
      input.conversationPublicId,
      "conversation",
    );

    return this.writeResolvedRecord({
      targetTable: input.targetTable,
      targetId: input.targetId,
      checksum: input.checksum,
      payload: {
        conversation_id: conversationId,
        sender_type: input.payload.sender_type,
        body: input.payload.body,
        external_message_id: input.payload.external_message_id,
        is_read: input.payload.is_read,
        sent_at: input.payload.sent_at,
        raw_payload: input.payload.raw_payload === null ? null : jsonb(input.payload.raw_payload),
      },
    });
  }

  private async findRequiredPublicId(
    table: "customers" | "integration_accounts" | "conversations" | "users",
    publicId: string,
    label: string,
  ): Promise<number> {
    const db = this.db as unknown as DynamicMigrationDatabase;
    const row = await db
      .selectFrom(table)
      .select("id")
      .where("public_id", "=", publicId)
      .executeTakeFirst();
    const id = row?.id;
    if (typeof id !== "number") {
      throw new Error(`Cannot resolve ${label} public id ${publicId} for FK-resolving migration write`);
    }
    return id;
  }

  private async findRequiredIntegrationAccountForChannel(publicId: string, channel: string): Promise<number> {
    if (channel !== "whatsapp" && channel !== "instagram" && channel !== "messenger") {
      throw new Error(`Cannot attach ${channel} conversation to integration account ${publicId}`);
    }

    const row = await this.db
      .selectFrom("integration_accounts as account")
      .innerJoin("integration_providers as provider", "provider.id", "account.provider_id")
      .select(["account.id as id", "provider.key as providerKey"])
      .where("account.public_id", "=", publicId)
      .executeTakeFirst();
    if (!row || typeof row.id !== "number" || typeof row.providerKey !== "string") {
      throw new Error(`Cannot resolve integration account public id ${publicId} for FK-resolving migration write`);
    }
    if (row.providerKey !== channel) {
      throw new Error(
        `Conversation channel ${channel} does not match integration account ${publicId} provider ${row.providerKey}`,
      );
    }
    return row.id;
  }

  private async writeResolvedRecord(input: CanonicalRecord): Promise<CanonicalWriteResult> {
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
      .where("run_id", "=", input.runId)
      .where("source_system", "=", input.sourceSystem)
      .where("source_table", "=", input.sourceTable)
      .where("source_id", "=", input.sourceId)
      .where("target_table", "=", input.targetTable)
      .where("mapping_role", "=", input.mappingRole)
      .executeTakeFirst();

    return row ? mapLegacyIdMapRow(row) : null;
  }

  async upsertLegacyIdMap(input: LegacyIdMapWrite): Promise<LegacyIdMapEntry> {
    const row = await this.db
      .insertInto("legacy_id_map")
      .values({
        run_id: input.runId,
        source_system: input.sourceSystem,
        source_table: input.sourceTable,
        source_id: input.sourceId,
        target_table: input.targetTable,
        mapping_role: input.mappingRole,
        target_id: input.targetId,
        checksum: input.checksum,
      })
      .onConflict((conflict) =>
        conflict.columns(["run_id", "source_system", "source_table", "source_id", "target_table", "mapping_role"]).doUpdateSet({
          target_id: input.targetId,
          checksum: input.checksum,
          migrated_at: new Date(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    return mapLegacyIdMapRow(row);
  }

  async registerMigrationRun(input: MigrationRunRegistration): Promise<MigrationRunState> {
    assertMigrationRunId(input.runId);
    await this.db
      .insertInto("migration_runs")
      .values({
        public_id: migrationRunPublicId(input.runId),
        run_id: input.runId,
        source_system: input.manifest.sourceSystem,
        source_database_identity: jsonb(input.manifest.databaseIdentity),
        table_snapshot: jsonb(input.manifest.tables),
        row_counts: jsonb(input.manifest.rowCounts),
        row_content_checksums: jsonb(input.manifest.rowContentChecksums ?? []),
        batch_size: input.manifest.batchSize,
        mapping_catalog_version: input.manifest.mappingCatalogVersion,
        plan_fingerprint: input.manifest.planFingerprint,
        source_manifest_hash: input.manifest.sourceManifestHash,
      })
      .onConflict((conflict) => conflict.column("run_id").doNothing())
      .execute();

    const row = await this.db
      .selectFrom("migration_runs")
      .selectAll()
      .where("run_id", "=", input.runId)
      .executeTakeFirstOrThrow();

    return mapMigrationRunState(row);
  }

  async findMigrationBatchState(input: MigrationBatchStateKey): Promise<MigrationBatchState | null> {
    const row = await this.db
      .selectFrom("migration_batches")
      .selectAll()
      .where("run_id", "=", input.runId)
      .where("entity", "=", input.batch.entity)
      .where("batch_number", "=", input.batch.batchNumber)
      .executeTakeFirst();

    return row ? mapMigrationBatchStateRow(row) : null;
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
        warnings: jsonb([]),
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
          warnings: jsonb([]),
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
        warnings: jsonb(input.result.warnings),
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
          warnings: jsonb(input.result.warnings),
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
        warnings: jsonb([]),
        error_message: input.error.message,
        started_at: null,
        finished_at: finishedAt,
      })
      .onConflict((conflict) =>
        conflict
          .columns(["run_id", "entity", "batch_number"])
          .doUpdateSet({
            status: "failed",
            error_message: input.error.message,
            finished_at: finishedAt,
            updated_at: finishedAt,
          })
          .where("migration_batches.status", "!=", "succeeded"),
      )
      .returningAll()
      .executeTakeFirst();

    if (!row) {
      const existing = await this.findMigrationBatchState({
        runId: input.runId,
        batch: input.batch,
      });
      if (existing) return existing;
      throw new Error(`Failed to record migration batch failure: ${input.batch.entity} batch ${input.batch.batchNumber}`);
    }

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
  executeTakeFirst(): Promise<Insertable<LegacyIdMapTable> & { migrated_at?: Date | string } | undefined>;
  executeTakeFirstOrThrow(): Promise<Insertable<LegacyIdMapTable> & { migrated_at?: Date | string }>;
}

interface DynamicConflictBuilder {
  column(column: string): DynamicConflictBuilder;
  columns(columns: string[]): DynamicConflictBuilder;
  doNothing(): DynamicConflictBuilder;
  doUpdateSet(values: Record<string, unknown>): DynamicConflictBuilder;
  where(column: string, operator: string, value: unknown): DynamicConflictBuilder;
}

function mapLegacyIdMapRow(row: Insertable<LegacyIdMapTable> & { migrated_at?: Date | string }): LegacyIdMapEntry {
  return {
    runId: row.run_id,
    sourceSystem: row.source_system,
    sourceTable: row.source_table,
    sourceId: row.source_id,
    targetTable: row.target_table,
    mappingRole: row.mapping_role,
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

function migrationRunPublicId(runId: string): string {
  const hash = createHash("sha256").update(runId).digest("hex").slice(0, 24);
  return `mrn_${hash}`;
}

function jsonb(value: unknown): string {
  return JSON.stringify(value);
}

function mapMigrationRunState(row: Selectable<MigrationRunsTable>): MigrationRunState {
  const rowContentChecksums = mapMigrationRunRowContentChecksums(row.row_content_checksums);
  return {
    runId: row.run_id,
    manifest: {
      sourceSystem: row.source_system,
      databaseIdentity: row.source_database_identity as SourceDatabaseIdentity,
      tables: row.table_snapshot as SourceTableSnapshot[],
      rowCounts: row.row_counts as SourceEntityRowCount[],
      ...(rowContentChecksums ? { rowContentChecksums } : {}),
      batchSize: Number(row.batch_size),
      mappingCatalogVersion: row.mapping_catalog_version,
      planFingerprint: row.plan_fingerprint,
      sourceManifestHash: row.source_manifest_hash,
    },
    createdAt: row.created_at,
  };
}

function mapMigrationRunRowContentChecksums(
  value: MigrationRunsTable["row_content_checksums"] | undefined,
): MigrationRunState["manifest"]["rowContentChecksums"] {
  return Array.isArray(value) && value.length > 0
    ? value as MigrationRunState["manifest"]["rowContentChecksums"]
    : undefined;
}
