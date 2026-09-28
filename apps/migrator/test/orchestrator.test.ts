import { describe, expect, it } from "vitest";
import { runMigration } from "../src/orchestrator.js";
import { canonicalMigrationEntities } from "../src/plan.js";
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
  MigrationTarget,
  MigrationRunRegistration,
  MigrationRunState,
  SourceManifest,
  SourceTableSnapshot,
} from "../src/types.js";

class FixtureSource implements LegacySource {
  readonly reads: MigrationEntity[] = [];

  constructor(private readonly records: Partial<Record<MigrationEntity, LegacyRecord[]>>) {}

  async count(entity: MigrationEntity): Promise<number> {
    return this.records[entity]?.length ?? 0;
  }

  async readBatch(entity: MigrationEntity, options: { limit: number; offset?: number }): Promise<LegacyRecord[]> {
    this.reads.push(entity);
    const offset = options.offset ?? 0;
    return (this.records[entity] ?? []).slice(offset, offset + options.limit);
  }

  async describeTables(entities: readonly MigrationEntity[]): Promise<SourceTableSnapshot[]> {
    return entities.map((entity) => ({
      entity,
      schema: "public",
      table: entity,
      idColumn: "id",
      columns: [{ name: "id", ordinalPosition: 1, dataType: "bigint", udtName: "int8", nullable: false }],
    }));
  }
}

class MemoryTarget implements MigrationTarget {
  readonly records: CanonicalRecord[] = [];
  readonly states = new Map<string, MigrationBatchState>();
  readonly runs = new Map<string, MigrationRunState>();

  async registerMigrationRun(input: MigrationRunRegistration): Promise<MigrationRunState> {
    const existing = this.runs.get(input.runId);
    if (existing) return existing;
    const state = { ...input, createdAt: new Date("2026-09-28T00:00:00.000Z") };
    this.runs.set(input.runId, state);
    return state;
  }

  async writeCanonicalRecord(input: CanonicalRecord): Promise<CanonicalWriteResult> {
    this.records.push(input);
    return { status: "created", record: input };
  }

  async findLegacyIdMap(_input: LegacyIdMapKey): Promise<LegacyIdMapEntry | null> {
    return null;
  }

  async upsertLegacyIdMap(input: LegacyIdMapWrite): Promise<LegacyIdMapEntry> {
    return { ...input, migratedAt: new Date("2026-09-28T00:00:00.000Z") };
  }

  async findMigrationBatchState(input: MigrationBatchStateKey): Promise<MigrationBatchState | null> {
    return this.states.get(stateKey(input.runId, input.batch.entity, input.batch.batchNumber)) ?? null;
  }

  async recordMigrationBatchStarted(input: MigrationBatchStateStart): Promise<MigrationBatchState> {
    return this.store(input.runId, input.batch, "running");
  }

  async recordMigrationBatchSucceeded(input: MigrationBatchStateSuccess): Promise<MigrationBatchState> {
    return this.store(input.runId, input.batch, "succeeded", input.result);
  }

  async recordMigrationBatchFailed(input: MigrationBatchStateFailure): Promise<MigrationBatchState> {
    return this.store(input.runId, input.batch, "failed", undefined, input.error.message);
  }

  private store(
    runId: string,
    batch: { entity: MigrationEntity; batchNumber: number; limit: number; offset: number; expectedRows: number },
    status: MigrationBatchState["status"],
    result?: MigrationBatchStateSuccess["result"],
    errorMessage: string | null = null,
  ): MigrationBatchState {
    const state: MigrationBatchState = {
      runId,
      entity: batch.entity,
      batchNumber: batch.batchNumber,
      status,
      limit: batch.limit,
      offset: batch.offset,
      expectedRows: batch.expectedRows,
      readRows: result?.readRows ?? 0,
      writtenRows: result?.writtenRows ?? 0,
      skippedRows: result?.skippedRows ?? 0,
      idMapCreated: result?.idMapCreated ?? 0,
      idMapUpdated: result?.idMapUpdated ?? 0,
      idMapUnchanged: result?.idMapUnchanged ?? 0,
      warnings: result?.warnings ?? [],
      errorMessage,
      startedAt: status === "running" ? new Date("2026-09-28T00:00:00.000Z") : null,
      finishedAt: status === "running" ? null : new Date("2026-09-28T00:01:00.000Z"),
    };
    this.states.set(stateKey(runId, batch.entity, batch.batchNumber), state);
    return state;
  }
}

const customer: LegacyRecord = {
  sourceSystem: "legacy_postgres",
  sourceTable: "public.customers",
  sourceId: "42",
  payload: {
    id: 42,
    public_id: "legacy-public-id",
    full_name: "Ada Lovelace",
    phone: null,
    email: null,
    username: null,
    notes: null,
    created_at: "2020-01-01T00:00:00.000Z",
    updated_at: "2020-01-02T00:00:00.000Z",
  },
  checksum: "sha256:ada",
};

describe("migration orchestrator", () => {
  it("builds a canonical dry-run plan without reading batches or requiring a target", async () => {
    const source = new FixtureSource({ customers: [customer] });

    const result = await runMigration({
      mode: "dry-run",
      source,
      batchSize: 100,
      entities: ["customers"],
      now: new Date("2026-09-28T00:00:00.000Z"),
      sourceSystem: "legacy_postgres",
      sourceDatabaseIdentity: sourceIdentity,
    });

    expect(result.plan.entities).toEqual([{ entity: "customers", totalRows: 1, batches: 1 }]);
    expect(result.dryRunReport?.totals).toEqual({ plannedRows: 1, plannedBatches: 1, blockedRows: 0 });
    expect(result.batches).toEqual([]);
    expect(source.reads).toEqual([]);
  });

  it("applies canonical batches and resumes without rewriting succeeded batches", async () => {
    const source = new FixtureSource({ customers: [customer] });
    const target = new MemoryTarget();
    const input = {
      mode: "apply" as const,
      source,
      target,
      runId: "legacy-import-2026-09",
      batchSize: 100,
      entities: [...canonicalMigrationEntities],
      sourceSystem: "legacy_postgres",
      sourceDatabaseIdentity: sourceIdentity,
    };

    await expect(runMigration(input)).resolves.toMatchObject({
      mode: "apply",
      batches: [{ readRows: 1, writtenRows: 1, idMapCreated: 1 }],
    });
    await expect(runMigration(input)).resolves.toMatchObject({
      batches: [{ readRows: 1, writtenRows: 1, idMapCreated: 1 }],
    });

    expect(source.reads).toEqual(["customers"]);
    expect(target.records).toHaveLength(1);
    expect(target.records[0]).toMatchObject({
      targetTable: "customers",
      payload: { full_name: "Ada Lovelace" },
    });
    expect(target.records[0]?.payload).not.toHaveProperty("id");
    expect(target.records[0]?.payload).not.toHaveProperty("public_id");
    expect(target.records[0]?.payload).not.toHaveProperty("created_at");
    expect(target.records[0]?.payload).not.toHaveProperty("updated_at");
  });

  it("rejects partial apply before registering a run or writing batch state", async () => {
    const source = new FixtureSource({ customers: [customer] });
    const target = new MemoryTarget();

    await expect(runMigration({
      mode: "apply",
      source,
      target,
      runId: "partial-import-2026-09",
      batchSize: 100,
      entities: ["customers"],
      sourceSystem: "legacy_postgres",
      sourceDatabaseIdentity: sourceIdentity,
    })).rejects.toThrow("Apply mode requires each canonical migration entity exactly once");

    expect(target.runs).toHaveLength(0);
    expect(target.states).toHaveLength(0);
    expect(target.records).toHaveLength(0);
    expect(source.reads).toHaveLength(0);
  });

});

function stateKey(runId: string, entity: MigrationEntity, batchNumber: number): string {
  return `${runId}:${entity}:${batchNumber}`;
}

const sourceIdentity: SourceManifest["databaseIdentity"] = {
  host: "legacy-db.internal",
  port: "5432",
  database: "legacy",
};
