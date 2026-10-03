import { describe, expect, it } from "vitest";
import { applyMigrationBatch, applyMigrationBatchWithState } from "../src/apply.js";
import { createDryRunReport } from "../src/reports.js";
import { canonicalMigrationEntities, createMigrationPlan } from "../src/plan.js";
import { legacyIdMapKey, upsertLegacyIdMap } from "../src/id-map.js";
import type {
  CanonicalRecord,
  CanonicalWriteResult,
  LegacyIdMapEntry,
  LegacyIdMapKey,
  LegacyIdMapWrite,
  LegacyRecord,
  LegacySource,
  MigrationEntity,
  MigrationBatchState,
  MigrationBatchStateKey,
  MigrationBatchStateFailure,
  MigrationBatchStateStart,
  MigrationBatchStateSuccess,
  MigrationTarget,
  MigrationRunRegistration,
  MigrationRunState,
  SourceTableSnapshot,
} from "../src/types.js";

class FixtureSource implements LegacySource {
  readonly reads: { entity: MigrationEntity; options: { limit: number; offset?: number; afterSourceId?: string } }[] = [];

  constructor(
    private readonly counts: Record<string, number>,
    private readonly records: Partial<Record<MigrationEntity, LegacyRecord[]>> = {},
  ) {}

  async count(entity: keyof FixtureSource["counts"]): Promise<number> {
    return this.counts[entity] ?? 0;
  }

  async readBatch(
    entity: MigrationEntity,
    options: { limit: number; offset?: number; afterSourceId?: string },
  ): Promise<LegacyRecord[]> {
    this.reads.push({ entity, options });
    const offset = options.offset ?? 0;
    return (this.records[entity] ?? []).slice(offset, offset + options.limit);
  }

  async describeTables(entities: readonly MigrationEntity[]): Promise<SourceTableSnapshot[]> {
    return entities.map((entity) => ({
      entity,
      schema: "public",
      table: entity,
      idColumn: "id",
      columns: [],
    }));
  }
}

class MemoryTarget implements MigrationTarget {
  private readonly entries = new Map<string, LegacyIdMapEntry>();
  private readonly records = new Map<string, CanonicalRecord>();
  private readonly states = new Map<string, MigrationBatchState>();
  readonly batchStateEvents: MigrationBatchState[] = [];
  private readonly runs = new Map<string, MigrationRunState>();

  async registerMigrationRun(input: MigrationRunRegistration): Promise<MigrationRunState> {
    const existing = this.runs.get(input.runId);
    if (existing) return existing;
    const state = { ...input, createdAt: new Date("2026-01-02T03:04:05.000Z") };
    this.runs.set(input.runId, state);
    return state;
  }

  get writtenRecords(): CanonicalRecord[] {
    return [...this.records.values()];
  }

  async writeCanonicalRecord(input: CanonicalRecord): Promise<CanonicalWriteResult> {
    const key = `${input.targetTable}:${input.targetId}`;
    const existing = this.records.get(key);
    this.records.set(key, input);

    return {
      status: existing ? (existing.checksum === input.checksum ? "unchanged" : "updated") : "created",
      record: input,
    };
  }

  async findLegacyIdMap(input: LegacyIdMapKey): Promise<LegacyIdMapEntry | null> {
    return this.entries.get(legacyIdMapKey(input)) ?? null;
  }

  async upsertLegacyIdMap(input: LegacyIdMapWrite): Promise<LegacyIdMapEntry> {
    const entry = {
      ...input,
      migratedAt: new Date("2026-01-02T03:04:05.000Z"),
    };
    this.entries.set(legacyIdMapKey(input), entry);
    return entry;
  }

  async findMigrationBatchState(input: MigrationBatchStateKey): Promise<MigrationBatchState | null> {
    return this.states.get(this.batchStateKey(input.runId, input.batch)) ?? null;
  }

  async recordMigrationBatchStarted(input: MigrationBatchStateStart): Promise<MigrationBatchState> {
    const state = this.batchState(input.runId, input.batch, "running", {
      startedAt: input.startedAt ?? new Date("2026-01-02T03:04:05.000Z"),
    });
    this.setBatchState(state);
    return state;
  }

  async recordMigrationBatchSucceeded(input: MigrationBatchStateSuccess): Promise<MigrationBatchState> {
    const state = this.batchState(input.runId, input.batch, "succeeded", {
      readRows: input.result.readRows,
      writtenRows: input.result.writtenRows,
      skippedRows: input.result.skippedRows,
      idMapCreated: input.result.idMapCreated,
      idMapUpdated: input.result.idMapUpdated,
      idMapUnchanged: input.result.idMapUnchanged,
      warnings: input.result.warnings,
      finishedAt: input.finishedAt ?? new Date("2026-01-02T03:05:05.000Z"),
    });
    this.setBatchState(state);
    return state;
  }

  async recordMigrationBatchFailed(input: MigrationBatchStateFailure): Promise<MigrationBatchState> {
    const existing = await this.findMigrationBatchState({ runId: input.runId, batch: input.batch });
    if (existing?.status === "succeeded") return existing;

    const state = this.batchState(input.runId, input.batch, "failed", {
      errorMessage: input.error.message,
      finishedAt: input.finishedAt ?? new Date("2026-01-02T03:05:05.000Z"),
    });
    this.setBatchState(state);
    return state;
  }

  seedBatchState(state: MigrationBatchState): void {
    this.setBatchState(state);
  }

  private setBatchState(state: MigrationBatchState): void {
    this.states.set(this.batchStateKey(state.runId, state), state);
    this.batchStateEvents.push(state);
  }

  private batchStateKey(
    runId: string,
    batch: { entity: MigrationEntity; batchNumber: number },
  ): string {
    return `${runId}:${batch.entity}:${batch.batchNumber}`;
  }

  private batchState(
    runId: string,
    batch: { entity: MigrationEntity; batchNumber: number; limit: number; offset: number; expectedRows: number },
    status: MigrationBatchState["status"],
    overrides: Partial<MigrationBatchState>,
  ): MigrationBatchState {
    return {
      runId,
      entity: batch.entity,
      batchNumber: batch.batchNumber,
      status,
      limit: batch.limit,
      offset: batch.offset,
      expectedRows: batch.expectedRows,
      readRows: 0,
      writtenRows: 0,
      skippedRows: 0,
      idMapCreated: 0,
      idMapUpdated: 0,
      idMapUnchanged: 0,
      warnings: [],
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      ...overrides,
    };
  }
}

class TransactionalMemoryTarget extends MemoryTarget {
  transactionCalls = 0;
  readonly transactionTarget = new MemoryTarget();

  async runInTransaction<T>(operation: (target: MigrationTarget) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    const result = await operation(this.transactionTarget);
    for (const record of this.transactionTarget.writtenRecords) {
      await this.writeCanonicalRecord(record);
    }
    for (const state of this.transactionTarget.batchStateEvents) {
      this.batchStateEvents.push(state);
    }
    return result;
  }
}

class FreshTransactionalMemoryTarget extends MemoryTarget {
  transactionCalls = 0;
  transactionTargets: MemoryTarget[] = [];

  async runInTransaction<T>(operation: (target: MigrationTarget) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    const transactionTarget = new MemoryTarget();
    this.transactionTargets.push(transactionTarget);
    const result = await operation(transactionTarget);
    for (const record of transactionTarget.writtenRecords) {
      await this.writeCanonicalRecord(record);
    }
    for (const state of transactionTarget.batchStateEvents) {
      this.seedBatchState(state);
    }
    return result;
  }
}

class RollbackMemoryTarget extends MemoryTarget {
  transactionCalls = 0;
  readonly transactionTarget = new MemoryTarget();

  async runInTransaction<T>(operation: (target: MigrationTarget) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    return operation(this.transactionTarget);
  }
}

class LockingMemoryTarget extends TransactionalMemoryTarget {
  readonly lockedRunIds: string[] = [];

  async runWithMigrationRunLock<T>(
    runId: string,
    operation: (target: MigrationTarget) => Promise<T>,
  ): Promise<T> {
    this.lockedRunIds.push(runId);
    return operation(this);
  }
}

class SucceedingBeforeLockOperationTarget extends LockingMemoryTarget {
  constructor(private readonly succeededState: MigrationBatchState) {
    super();
  }

  override async runWithMigrationRunLock<T>(
    runId: string,
    operation: (target: MigrationTarget) => Promise<T>,
  ): Promise<T> {
    this.lockedRunIds.push(runId);
    this.seedBatchState(this.succeededState);
    return operation(this);
  }
}

describe("migration foundation", () => {
  it("anchors the default entity plan to the canonical table catalog", async () => {
    const plan = await createMigrationPlan({
      source: new FixtureSource({}),
      mode: "dry-run",
      batchSize: 100,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(plan.entities.map(({ entity }) => entity)).toEqual(canonicalMigrationEntities);
  });

  it("creates a deterministic dry-run batch plan from source counts", async () => {
    const source = new FixtureSource({
      customers: 5,
      messages: 1,
      orders: 0,
    });

    const plan = await createMigrationPlan({
      source,
      mode: "dry-run",
      batchSize: 2,
      entities: ["customers", "messages", "orders"],
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(plan).toMatchObject({
      mode: "dry-run",
      batchSize: 2,
      totalRows: 6,
      createdAt: "2026-01-01T00:00:00.000Z",
      entities: [
        { entity: "customers", totalRows: 5, batches: 3 },
        { entity: "messages", totalRows: 1, batches: 1 },
        { entity: "orders", totalRows: 0, batches: 0 },
      ],
    });
    expect(plan.batches).toEqual([
      { entity: "customers", batchNumber: 1, limit: 2, offset: 0, expectedRows: 2 },
      { entity: "customers", batchNumber: 2, limit: 2, offset: 2, expectedRows: 2 },
      { entity: "customers", batchNumber: 3, limit: 2, offset: 4, expectedRows: 1 },
      { entity: "messages", batchNumber: 1, limit: 2, offset: 0, expectedRows: 1 },
    ]);
  });

  it("builds dry-run reports without mutating the target", async () => {
    const plan = await createMigrationPlan({
      source: new FixtureSource({ customers: 3 }),
      mode: "dry-run",
      batchSize: 2,
      entities: ["customers"],
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const report = createDryRunReport({
      plan,
      warnings: [{ entity: "customers", code: "unknown_field", message: "Legacy field ignored: musteri_notu" }],
      now: new Date("2026-01-01T00:00:01.000Z"),
    });

    expect(report.totals).toEqual({ plannedRows: 3, plannedBatches: 2, blockedRows: 1 });
    expect(report.entities).toEqual([
      { entity: "customers", plannedRows: 3, plannedBatches: 2, blockedRows: 1 },
    ]);
    expect(report.generatedAt).toBe("2026-01-01T00:00:01.000Z");
  });

  it("upserts legacy id map entries idempotently", async () => {
    const target = new MemoryTarget();
    const write: LegacyIdMapWrite = {
      runId: "run_2026_01",
      sourceSystem: "legacy_supabase",
      sourceTable: "customers",
      sourceId: "42",
      targetTable: "customers",
      mappingRole: "primary",
      targetId: "1001",
      checksum: "sha256:first",
    };

    await expect(upsertLegacyIdMap(target, write)).resolves.toMatchObject({ status: "created" });
    await expect(upsertLegacyIdMap(target, write)).resolves.toMatchObject({ status: "unchanged" });
    await expect(upsertLegacyIdMap(target, { ...write, checksum: "sha256:changed" })).resolves.toMatchObject({
      status: "updated",
      entry: { checksum: "sha256:changed" },
    });

    await expect(
      upsertLegacyIdMap(target, {
        ...write,
        targetTable: "customer_addresses",
        mappingRole: "legacy_default_address",
        targetId: "2001",
      }),
    ).resolves.toMatchObject({ status: "created" });
  });

  it("isolates legacy id map entries by migration run", async () => {
    const target = new MemoryTarget();
    const write: LegacyIdMapWrite = {
      runId: "run_1",
      sourceSystem: "legacy_supabase",
      sourceTable: "customers",
      sourceId: "42",
      targetTable: "customers",
      mappingRole: "primary",
      targetId: "cus_1",
      checksum: "sha256:first",
    };

    await expect(upsertLegacyIdMap(target, write)).resolves.toMatchObject({ status: "created" });
    await expect(upsertLegacyIdMap(target, { ...write, runId: "run_2" })).resolves.toMatchObject({
      status: "created",
    });
    await expect(target.findLegacyIdMap({ ...write, runId: "run_1" })).resolves.toMatchObject({
      runId: "run_1",
    });
    await expect(target.findLegacyIdMap({ ...write, runId: "run_2" })).resolves.toMatchObject({
      runId: "run_2",
    });
  });

  it("applies batches through source and target ports idempotently", async () => {
    const source = new FixtureSource(
      { customers: 2 },
      {
        customers: [
          {
            sourceSystem: "legacy_supabase",
            sourceTable: "customers",
            sourceId: "1",
            payload: { full_name: "Ada Lovelace" },
            checksum: "sha256:ada",
          },
          {
            sourceSystem: "legacy_supabase",
            sourceTable: "customers",
            sourceId: "2",
            payload: { full_name: "Grace Hopper" },
            checksum: "sha256:grace",
          },
        ],
      },
    );
    const target = new MemoryTarget();
    const batch = {
      entity: "customers",
      batchNumber: 1,
      limit: 10,
      offset: 0,
      expectedRows: 2,
    } as const;

    await expect(applyMigrationBatch({ source, target, runId: "run_2026_01", batch })).resolves.toMatchObject({
      readRows: 2,
      writtenRows: 2,
      skippedRows: 0,
      idMapCreated: 2,
      idMapUpdated: 0,
      idMapUnchanged: 0,
    });

    await expect(applyMigrationBatch({ source, target, runId: "run_2026_01", batch })).resolves.toMatchObject({
      readRows: 2,
      writtenRows: 2,
      skippedRows: 0,
      idMapCreated: 0,
      idMapUpdated: 0,
      idMapUnchanged: 2,
    });
    expect(target.writtenRecords).toHaveLength(2);
  });

  it("uses batch offsets without converting them into source id cursors", async () => {
    const source = new FixtureSource(
      { customers: 3 },
      {
        customers: [
          {
            sourceSystem: "legacy_supabase",
            sourceTable: "customers",
            sourceId: "10",
            payload: { full_name: "Ada Lovelace" },
            checksum: "sha256:ada",
          },
          {
            sourceSystem: "legacy_supabase",
            sourceTable: "customers",
            sourceId: "20",
            payload: { full_name: "Grace Hopper" },
            checksum: "sha256:grace",
          },
          {
            sourceSystem: "legacy_supabase",
            sourceTable: "customers",
            sourceId: "30",
            payload: { full_name: "Katherine Johnson" },
            checksum: "sha256:katherine",
          },
        ],
      },
    );
    const target = new MemoryTarget();

    await expect(
      applyMigrationBatch({
        source,
        target,
        runId: "run_2026_01",
        batch: {
          entity: "customers",
          batchNumber: 2,
          limit: 2,
          offset: 2,
          expectedRows: 1,
        },
      }),
    ).resolves.toMatchObject({
      batchNumber: 2,
      readRows: 1,
      writtenRows: 1,
    });

    expect(source.reads).toEqual([
      {
        entity: "customers",
        options: { limit: 2, offset: 2 },
      },
    ]);
    expect(target.writtenRecords).toEqual([
      expect.objectContaining({
        payload: { full_name: "Katherine Johnson" },
      }),
    ]);
  });

  it("records batch state around a successful apply", async () => {
    const source = new FixtureSource(
      { customers: 1 },
      {
        customers: [
          {
            sourceSystem: "legacy_supabase",
            sourceTable: "customers",
            sourceId: "10",
            payload: { full_name: "Ada Lovelace" },
            checksum: "sha256:ada",
          },
        ],
      },
    );
    const target = new MemoryTarget();

    await expect(
      applyMigrationBatchWithState({
        runId: "run_2026_01_01",
        source,
        target,
        batch: {
          entity: "customers",
          batchNumber: 1,
          limit: 10,
          offset: 0,
          expectedRows: 1,
        },
      }),
    ).resolves.toMatchObject({
      readRows: 1,
      writtenRows: 1,
    });

    expect(target.batchStateEvents.map((state) => state.status)).toEqual(["running", "succeeded"]);
    expect(target.batchStateEvents[1]).toMatchObject({
      runId: "run_2026_01_01",
      entity: "customers",
      batchNumber: 1,
      readRows: 1,
      writtenRows: 1,
      idMapCreated: 1,
    });
  });

  it("runs successful apply writes and succeeded checkpoint through a target transaction", async () => {
    const source = new FixtureSource(
      { customers: 1 },
      {
        customers: [
          {
            sourceSystem: "legacy_supabase",
            sourceTable: "customers",
            sourceId: "10",
            payload: { full_name: "Ada Lovelace" },
            checksum: "sha256:ada",
          },
        ],
      },
    );
    const target = new TransactionalMemoryTarget();

    await expect(
      applyMigrationBatchWithState({
        runId: "run_2026_01_01",
        source,
        target,
        batch: {
          entity: "customers",
          batchNumber: 1,
          limit: 10,
          offset: 0,
          expectedRows: 1,
        },
      }),
    ).resolves.toMatchObject({
      readRows: 1,
      writtenRows: 1,
    });

    expect(target.transactionCalls).toBe(1);
    expect(target.batchStateEvents.map((state) => state.status)).toEqual(["running", "succeeded"]);
    expect(target.writtenRecords).toEqual([
      expect.objectContaining({
        payload: { full_name: "Ada Lovelace" },
      }),
    ]);
  });

  it("takes a run-scoped lock before applying a non-resumed batch when supported by the target", async () => {
    const source = new FixtureSource(
      { customers: 1 },
      {
        customers: [
          {
            sourceSystem: "legacy_supabase",
            sourceTable: "customers",
            sourceId: "10",
            payload: { full_name: "Ada Lovelace" },
            checksum: "sha256:ada",
          },
        ],
      },
    );
    const target = new LockingMemoryTarget();

    await expect(
      applyMigrationBatchWithState({
        runId: "run_2026_01_01",
        source,
        target,
        batch: {
          entity: "customers",
          batchNumber: 1,
          limit: 10,
          offset: 0,
          expectedRows: 1,
        },
      }),
    ).resolves.toMatchObject({ writtenRows: 1 });

    expect(target.lockedRunIds).toEqual(["run_2026_01_01"]);
    expect(target.transactionCalls).toBe(1);
  });

  it("does not take a run-scoped lock when a succeeded batch is skipped on resume", async () => {
    const source = new FixtureSource({ customers: 1 });
    const target = new LockingMemoryTarget();
    target.seedBatchState({
      runId: "run_2026_01_01",
      entity: "customers",
      batchNumber: 1,
      status: "succeeded",
      limit: 10,
      offset: 0,
      expectedRows: 1,
      readRows: 1,
      writtenRows: 1,
      skippedRows: 0,
      idMapCreated: 1,
      idMapUpdated: 0,
      idMapUnchanged: 0,
      warnings: [],
      errorMessage: null,
      startedAt: new Date("2026-01-02T03:04:05.000Z"),
      finishedAt: new Date("2026-01-02T03:05:05.000Z"),
    });

    await expect(
      applyMigrationBatchWithState({
        runId: "run_2026_01_01",
        source,
        target,
        batch: {
          entity: "customers",
          batchNumber: 1,
          limit: 10,
          offset: 0,
          expectedRows: 1,
        },
      }),
    ).resolves.toMatchObject({ writtenRows: 1 });

    expect(target.lockedRunIds).toEqual([]);
    expect(target.transactionCalls).toBe(0);
  });

  it("rechecks succeeded batch state after taking the run-scoped lock", async () => {
    const source = new FixtureSource(
      { customers: 1 },
      {
        customers: [
          {
            sourceSystem: "legacy_supabase",
            sourceTable: "customers",
            sourceId: "10",
            payload: { full_name: "Ada Lovelace" },
            checksum: "sha256:ada",
          },
        ],
      },
    );
    const target = new SucceedingBeforeLockOperationTarget({
      runId: "run_2026_01_01",
      entity: "customers",
      batchNumber: 1,
      status: "succeeded",
      limit: 10,
      offset: 0,
      expectedRows: 1,
      readRows: 1,
      writtenRows: 1,
      skippedRows: 0,
      idMapCreated: 1,
      idMapUpdated: 0,
      idMapUnchanged: 0,
      warnings: [],
      errorMessage: null,
      startedAt: new Date("2026-01-02T03:04:05.000Z"),
      finishedAt: new Date("2026-01-02T03:05:05.000Z"),
    });

    await expect(
      applyMigrationBatchWithState({
        runId: "run_2026_01_01",
        source,
        target,
        batch: {
          entity: "customers",
          batchNumber: 1,
          limit: 10,
          offset: 0,
          expectedRows: 1,
        },
      }),
    ).resolves.toMatchObject({ writtenRows: 1 });

    expect(target.lockedRunIds).toEqual(["run_2026_01_01"]);
    expect(target.transactionCalls).toBe(0);
    expect(source.reads).toEqual([]);
  });

  it("records failed batch state and rethrows the apply error", async () => {
    const source = new FixtureSource(
      { customers: 1 },
      {
        customers: [
          {
            sourceSystem: "legacy_supabase",
            sourceTable: "customers",
            sourceId: "10",
            payload: { full_name: "Ada Lovelace" },
            checksum: "sha256:ada",
          },
        ],
      },
    );
    const target = new MemoryTarget();
    const error = new Error("cannot map legacy customer");

    await expect(
      applyMigrationBatchWithState({
        runId: "run_2026_01_01",
        source,
        target,
        batch: {
          entity: "customers",
          batchNumber: 1,
          limit: 10,
          offset: 0,
          expectedRows: 1,
        },
        transform: () => {
          throw error;
        },
      }),
    ).rejects.toThrow("cannot map legacy customer");

    expect(target.batchStateEvents.map((state) => state.status)).toEqual(["running", "failed"]);
    expect(target.batchStateEvents[1]).toMatchObject({
      runId: "run_2026_01_01",
      entity: "customers",
      batchNumber: 1,
      errorMessage: "cannot map legacy customer",
    });
  });

  it("keeps transactional writes isolated when apply fails and records failure outside the transaction", async () => {
    const source = new FixtureSource(
      { customers: 2 },
      {
        customers: [
          {
            sourceSystem: "legacy_supabase",
            sourceTable: "customers",
            sourceId: "10",
            payload: { full_name: "Ada Lovelace" },
            checksum: "sha256:ada",
          },
          {
            sourceSystem: "legacy_supabase",
            sourceTable: "customers",
            sourceId: "11",
            payload: { full_name: "Grace Hopper" },
            checksum: "sha256:grace",
          },
        ],
      },
    );
    const target = new RollbackMemoryTarget();

    await expect(
      applyMigrationBatchWithState({
        runId: "run_2026_01_01",
        source,
        target,
        batch: {
          entity: "customers",
          batchNumber: 1,
          limit: 10,
          offset: 0,
          expectedRows: 2,
        },
        transform: (record) => {
          if (record.sourceId === "11") throw new Error("cannot map second customer");
          return {
            targetTable: "customers",
            targetId: "cus_10",
            payload: { full_name: "Ada Lovelace" },
            checksum: "sha256:ada",
          };
        },
      }),
    ).rejects.toThrow("cannot map second customer");

    expect(target.transactionCalls).toBe(1);
    expect(target.writtenRecords).toEqual([]);
    expect(target.batchStateEvents.map((state) => state.status)).toEqual(["failed"]);
    expect(target.transactionTarget.writtenRecords).toHaveLength(1);
    expect(target.transactionTarget.batchStateEvents.map((state) => state.status)).toEqual(["running"]);
  });

  it("does not let a late failure record clobber an already succeeded batch", async () => {
    const target = new MemoryTarget();
    const batch = {
      entity: "customers",
      batchNumber: 1,
      limit: 10,
      offset: 0,
      expectedRows: 1,
    } as const;
    target.seedBatchState({
      runId: "run_2026_01_01",
      ...batch,
      status: "succeeded",
      readRows: 1,
      writtenRows: 1,
      skippedRows: 0,
      idMapCreated: 1,
      idMapUpdated: 0,
      idMapUnchanged: 0,
      warnings: [],
      errorMessage: null,
      startedAt: new Date("2026-01-02T03:04:05.000Z"),
      finishedAt: new Date("2026-01-02T03:05:05.000Z"),
    });

    await expect(
      target.recordMigrationBatchFailed({
        runId: "run_2026_01_01",
        batch,
        error: new Error("late failure"),
      }),
    ).resolves.toMatchObject({
      status: "succeeded",
      errorMessage: null,
    });

    expect(target.batchStateEvents.map((state) => state.status)).toEqual(["succeeded"]);
  });

  it("retries a failed transactional batch without committing partial rows or duplicating on resume", async () => {
    const source = new FixtureSource(
      { customers: 2 },
      {
        customers: [
          {
            sourceSystem: "legacy_supabase",
            sourceTable: "customers",
            sourceId: "10",
            payload: { full_name: "Ada Lovelace" },
            checksum: "sha256:ada",
          },
          {
            sourceSystem: "legacy_supabase",
            sourceTable: "customers",
            sourceId: "11",
            payload: { full_name: "Grace Hopper" },
            checksum: "sha256:grace",
          },
        ],
      },
    );
    const target = new FreshTransactionalMemoryTarget();
    const batch = {
      entity: "customers",
      batchNumber: 1,
      limit: 10,
      offset: 0,
      expectedRows: 2,
    } as const;

    await expect(
      applyMigrationBatchWithState({
        runId: "run_2026_01_01",
        source,
        target,
        batch,
        transform: (record) => {
          if (record.sourceId === "11") throw new Error("temporary network failure");
          return {
            targetTable: "customers",
            targetId: "cus_10",
            payload: { full_name: "Ada Lovelace" },
            checksum: "sha256:ada",
          };
        },
      }),
    ).rejects.toThrow("temporary network failure");

    expect(target.transactionCalls).toBe(1);
    expect(target.writtenRecords).toEqual([]);
    expect(target.transactionTargets[0]?.writtenRecords).toHaveLength(1);
    expect(target.batchStateEvents.map((state) => state.status)).toEqual(["failed"]);

    await expect(
      applyMigrationBatchWithState({
        runId: "run_2026_01_01",
        source,
        target,
        batch,
        transform: (record) => ({
          targetTable: "customers",
          targetId: `cus_${record.sourceId}`,
          payload: record.payload,
          checksum: record.checksum,
        }),
      }),
    ).resolves.toMatchObject({
      readRows: 2,
      writtenRows: 2,
      idMapCreated: 2,
    });

    expect(target.transactionCalls).toBe(2);
    expect(target.writtenRecords.map((record) => record.targetId)).toEqual(["cus_10", "cus_11"]);
    expect(target.batchStateEvents.map((state) => state.status)).toEqual(["failed", "running", "succeeded"]);
    expect(source.reads).toHaveLength(2);

    await expect(
      applyMigrationBatchWithState({
        runId: "run_2026_01_01",
        source,
        target,
        batch,
      }),
    ).resolves.toMatchObject({
      readRows: 2,
      writtenRows: 2,
      idMapCreated: 2,
    });

    expect(target.transactionCalls).toBe(2);
    expect(source.reads).toHaveLength(2);
    expect(target.writtenRecords.map((record) => record.targetId)).toEqual(["cus_10", "cus_11"]);
  });

  it("marks a short-read batch failed before writing any target rows", async () => {
    const source = new FixtureSource(
      { customers: 2 },
      {
        customers: [
          {
            sourceSystem: "legacy_supabase",
            sourceTable: "customers",
            sourceId: "10",
            payload: { full_name: "Ada Lovelace" },
            checksum: "sha256:ada",
          },
        ],
      },
    );
    const target = new MemoryTarget();

    await expect(
      applyMigrationBatchWithState({
        runId: "run_2026_01_01",
        source,
        target,
        batch: {
          entity: "customers",
          batchNumber: 1,
          limit: 2,
          offset: 0,
          expectedRows: 2,
        },
      }),
    ).rejects.toThrow("expected 2, received 1");

    expect(target.writtenRecords).toEqual([]);
    expect(target.batchStateEvents.map((state) => state.status)).toEqual(["running", "failed"]);
    expect(target.batchStateEvents[1]).toMatchObject({
      status: "failed",
      errorMessage: expect.stringContaining("expected 2, received 1"),
    });
  });

  it("skips already succeeded batches when resuming the same run", async () => {
    const source = new FixtureSource(
      { customers: 1 },
      {
        customers: [
          {
            sourceSystem: "legacy_supabase",
            sourceTable: "customers",
            sourceId: "10",
            payload: { full_name: "Ada Lovelace" },
            checksum: "sha256:ada",
          },
        ],
      },
    );
    const target = new MemoryTarget();
    target.seedBatchState({
      runId: "run_2026_01_01",
      entity: "customers",
      batchNumber: 1,
      status: "succeeded",
      limit: 10,
      offset: 0,
      expectedRows: 1,
      readRows: 1,
      writtenRows: 1,
      skippedRows: 0,
      idMapCreated: 1,
      idMapUpdated: 0,
      idMapUnchanged: 0,
      warnings: [],
      errorMessage: null,
      startedAt: new Date("2026-01-02T03:04:05.000Z"),
      finishedAt: new Date("2026-01-02T03:05:05.000Z"),
    });

    await expect(
      applyMigrationBatchWithState({
        runId: "run_2026_01_01",
        source,
        target,
        batch: {
          entity: "customers",
          batchNumber: 1,
          limit: 10,
          offset: 0,
          expectedRows: 1,
        },
      }),
    ).resolves.toMatchObject({
      readRows: 1,
      writtenRows: 1,
      idMapCreated: 1,
    });

    expect(source.reads).toEqual([]);
    expect(target.writtenRecords).toEqual([]);
    expect(target.batchStateEvents).toHaveLength(1);
  });
});
