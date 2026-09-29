import { describe, expect, it } from "vitest";
import { createLegacyMappingCatalog, legacyMappingCatalog } from "../src/mapping-catalog.js";
import { runMigration } from "../src/orchestrator.js";
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
  readonly operations: string[] = [];

  constructor(private readonly records: Partial<Record<MigrationEntity, LegacyRecord[]>>) {}

  async count(entity: MigrationEntity): Promise<number> {
    this.operations.push(`count:${entity}`);
    return this.records[entity]?.length ?? 0;
  }

  async readBatch(entity: MigrationEntity, options: { limit: number; offset?: number }): Promise<LegacyRecord[]> {
    this.reads.push(entity);
    const offset = options.offset ?? 0;
    return (this.records[entity] ?? []).slice(offset, offset + options.limit);
  }

  async describeTables(entities: readonly MigrationEntity[]): Promise<SourceTableSnapshot[]> {
    this.operations.push("describe");
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
      mappingCatalog: fixtureCatalog,
      batchSize: 100,
      entities: ["customers"],
      now: new Date("2026-09-28T00:00:00.000Z"),
      sourceSystem: "legacy_postgres",
      sourceDatabaseIdentity: sourceIdentity,
    });

    expect(result.plan.entities).toEqual([{ entity: "customers", totalRows: 1, batches: 1 }]);
    expect(result.sourceManifest.mappingCatalogVersion).toBe("fixture-catalog-v1");
    expect(result.dryRunReport?.totals).toEqual({ plannedRows: 1, plannedBatches: 1, blockedRows: 0 });
    expect(result.batches).toEqual([]);
    expect(source.reads).toEqual([]);
    expect(source.operations).toEqual(["describe", "count:customers"]);
  });

  it("halts before planning when source introspection rejects schema drift", async () => {
    const source = new FixtureSource({ customers: [customer] });
    source.describeTables = async () => {
      source.operations.push("describe");
      throw new Error("Legacy source schema mismatch for public.musteriler: unexpected columns [drift]");
    };

    await expect(runMigration({
      mode: "dry-run",
      source,
      mappingCatalog: fixtureCatalog,
      batchSize: 100,
      entities: ["customers"],
      sourceSystem: "legacy_postgres",
      sourceDatabaseIdentity: sourceIdentity,
    })).rejects.toThrow("unexpected columns [drift]");
    expect(source.operations).toEqual(["describe"]);
    expect(source.reads).toEqual([]);
  });

  it("independently rejects a custom source snapshot that bypasses adapter validation", async () => {
    const source = new FixtureSource({ customers: [customer] });
    source.describeTables = async () => {
      source.operations.push("describe");
      return [{
        entity: "customers",
        schema: "public",
        table: "other",
        idColumn: "id",
        columns: [{ name: "id", ordinalPosition: 1, dataType: "bigint", udtName: "int8", nullable: false }],
      }];
    };

    await expect(runMigration({
      mode: "dry-run",
      source,
      mappingCatalog: fixtureCatalog,
      batchSize: 100,
      entities: ["customers"],
      sourceSystem: "legacy_postgres",
      sourceDatabaseIdentity: sourceIdentity,
    })).rejects.toThrow("Source table snapshot for customers must route to public.customers.id");
    expect(source.operations).toEqual(["describe"]);
  });

  it("derives the manifest version from the explicit validated catalog", async () => {
    const catalog = createLegacyMappingCatalog({
      version: "fixture-catalog-v7",
      tables: [{
        sourceTable: "public.customers",
        idColumn: "id",
        targetEntities: [{ entity: "customers", mapping: "direct", readiness: "dry-run" }],
        columns: [{ name: "id", dataType: "bigint", udtName: "int8", nullable: false, required: true }],
      }],
    });
    const source = new FixtureSource({ customers: [customer] });

    const result = await runMigration({
      mode: "dry-run",
      source,
      mappingCatalog: catalog,
      batchSize: 100,
      entities: ["customers"],
      sourceSystem: "legacy_postgres",
      sourceDatabaseIdentity: sourceIdentity,
    });

    expect(result.sourceManifest.mappingCatalogVersion).toBe("fixture-catalog-v7");
  });

  it("rejects customer apply before source access while external identities are descriptive", async () => {
    const source = new FixtureSource({ customers: [customer] });
    const target = new MemoryTarget();

    await expect(runMigration({
      mode: "apply",
      source,
      mappingCatalog: legacyMappingCatalog,
      target,
      runId: "legacy-import-2026-09",
      batchSize: 100,
      entities: ["customers"],
      sourceSystem: "legacy_postgres",
      sourceDatabaseIdentity: sourceIdentity,
    })).rejects.toThrow(
      "Migration entity customers cannot be applied while customer_external_identities is descriptive in catalog",
    );

    expect(source.operations).toEqual([]);
    expect(source.reads).toEqual([]);
    expect(target.runs.size).toBe(0);
  });

  it("rejects apply before source access until catalog transforms are apply-ready", async () => {
    const source = new FixtureSource({ customers: [customer] });
    const target = new MemoryTarget();

    await expect(runMigration({
      mode: "apply",
      source,
      mappingCatalog: identityReadyCatalog,
      target,
      runId: "legacy-import-2026-09",
      batchSize: 100,
      entities: ["customers"],
      sourceSystem: "legacy_postgres",
      sourceDatabaseIdentity: sourceIdentity,
    })).rejects.toThrow("Apply mode is unavailable until the mapping catalog declares apply-ready transforms");

    expect(source.operations).toEqual([]);
    expect(source.reads).toEqual([]);
    expect(target.runs.size).toBe(0);
  });

  it("rejects descriptive entity selection before source access", async () => {
    const source = new FixtureSource({ customers: [customer] });

    await expect(runMigration({
      mode: "dry-run",
      source,
      mappingCatalog: customerCatalog,
      batchSize: 100,
      entities: ["customer_addresses"],
      sourceSystem: "legacy_postgres",
      sourceDatabaseIdentity: sourceIdentity,
    })).rejects.toThrow("not dry-run-ready in catalog: customer_addresses");

    expect(source.operations).toEqual([]);
    expect(source.reads).toEqual([]);
  });

  it("rejects duplicate entity selection before source access", async () => {
    const source = new FixtureSource({ customers: [customer] });

    await expect(runMigration({
      mode: "dry-run",
      source,
      mappingCatalog: fixtureCatalog,
      batchSize: 100,
      entities: ["customers", "customers"],
      sourceSystem: "legacy_postgres",
      sourceDatabaseIdentity: sourceIdentity,
    })).rejects.toThrow("Migration entities must not contain duplicates");

    expect(source.operations).toEqual([]);
  });

  it("rejects an empty entity selection before source access", async () => {
    const source = new FixtureSource({ customers: [customer] });

    await expect(runMigration({
      mode: "dry-run",
      source,
      mappingCatalog: fixtureCatalog,
      batchSize: 100,
      entities: [],
      sourceSystem: "legacy_postgres",
      sourceDatabaseIdentity: sourceIdentity,
    })).rejects.toThrow("Migration must select at least one entity");

    expect(source.operations).toEqual([]);
  });

  it("uses only the explicit catalog version without a global fallback", async () => {
    const source = new FixtureSource({ customers: [customer] });
    const result = await runMigration({
      mode: "dry-run",
      source,
      mappingCatalog: fixtureCatalog,
      batchSize: 100,
      sourceSystem: "legacy_postgres",
      sourceDatabaseIdentity: sourceIdentity,
    });

    expect(result.sourceManifest.mappingCatalogVersion).toBe("fixture-catalog-v1");
  });

  it("owns the catalog before count can mutate the caller input", async () => {
    const catalog = mutableFixtureCatalog("stable-catalog-v1");
    const source = new FixtureSource({ customers: [customer] });
    source.count = async () => {
      catalog.version = "mutated-catalog-v2";
      catalog.tables[0]!.sourceTable = "public.changed";
      catalog.tables[0]!.columns[0]!.dataType = "text";
      return 1;
    };

    const result = await runMigration({
      mode: "dry-run",
      source,
      mappingCatalog: catalog,
      batchSize: 100,
      entities: ["customers"],
      sourceSystem: "legacy_postgres",
      sourceDatabaseIdentity: sourceIdentity,
    });

    expect(result.sourceManifest.mappingCatalogVersion).toBe("stable-catalog-v1");
    expect(result.sourceManifest.tables[0]?.table).toBe("customers");
  });

  it("owns source snapshots before count can mutate the adapter result", async () => {
    const source = new FixtureSource({ customers: [customer] });
    const snapshot = {
      entity: "customers" as const,
      schema: "public",
      table: "customers",
      idColumn: "id",
      columns: [{ name: "id", ordinalPosition: 1, dataType: "bigint", udtName: "int8", nullable: false }],
    };
    source.describeTables = async () => {
      source.operations.push("describe");
      return [snapshot];
    };
    source.count = async () => {
      snapshot.table = "changed";
      snapshot.columns[0]!.dataType = "text";
      snapshot.columns.push({
        name: "injected",
        ordinalPosition: 2,
        dataType: "text",
        udtName: "text",
        nullable: true,
      });
      return 1;
    };

    const result = await runMigration({
      mode: "dry-run",
      source,
      mappingCatalog: fixtureCatalog,
      batchSize: 100,
      entities: ["customers"],
      sourceSystem: "legacy_postgres",
      sourceDatabaseIdentity: sourceIdentity,
    });

    expect(result.sourceManifest.tables).toEqual([{
      entity: "customers",
      schema: "public",
      table: "customers",
      idColumn: "id",
      columns: [{ name: "id", ordinalPosition: 1, dataType: "bigint", udtName: "int8", nullable: false }],
    }]);
  });

});

function mutableFixtureCatalog(version: string) {
  return {
    version,
    tables: [{
      sourceTable: "public.customers",
      idColumn: "id",
      targetEntities: [{ entity: "customers" as const, mapping: "direct" as const, readiness: "dry-run" as const }],
      columns: [{ name: "id", dataType: "bigint", udtName: "int8", nullable: false, required: true }],
    }],
  };
}

function stateKey(runId: string, entity: MigrationEntity, batchNumber: number): string {
  return `${runId}:${entity}:${batchNumber}`;
}

const sourceIdentity: SourceManifest["databaseIdentity"] = {
  host: "legacy-db.internal",
  port: "5432",
  database: "legacy",
};

const fixtureCatalog = createLegacyMappingCatalog({
  version: "fixture-catalog-v1",
  tables: [{
    sourceTable: "public.customers",
    idColumn: "id",
    targetEntities: [{ entity: "customers", mapping: "direct", readiness: "dry-run" }],
    columns: [{ name: "id", dataType: "bigint", udtName: "int8", nullable: false, required: true }],
  }],
});

const identityReadyCatalog = createLegacyMappingCatalog({
  version: "identity-ready-catalog-v1",
  tables: [{
    sourceTable: "public.customers",
    idColumn: "id",
    targetEntities: [
      { entity: "customers", mapping: "direct", readiness: "dry-run" },
      { entity: "customer_external_identities", mapping: "direct", readiness: "dry-run" },
    ],
    columns: [{ name: "id", dataType: "bigint", udtName: "int8", nullable: false, required: true }],
  }],
});

const customerCatalog = createLegacyMappingCatalog({
  version: "customer-catalog-v1",
  tables: [{
    sourceTable: "public.customers",
    idColumn: "id",
    targetEntities: [
      { entity: "customers", mapping: "direct", readiness: "dry-run" },
      { entity: "customer_addresses", mapping: "synthetic", readiness: "descriptive" },
    ],
    columns: [{ name: "id", dataType: "bigint", udtName: "int8", nullable: false, required: true }],
  }],
});
