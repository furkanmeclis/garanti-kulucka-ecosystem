import { describe, expect, it } from "vitest";
import type { VerifiedConversationAccount } from "../src/conversation-mapping.js";
import type { VerifiedIntegrationAccount } from "../src/customer-mapping.js";
import { calculateSourcePayloadChecksum } from "../src/legacy-source.js";
import { createLegacyMappingCatalog, legacyMappingCatalog } from "../src/mapping-catalog.js";
import { runMigration } from "../src/orchestrator.js";
import type {
  BatchReadOptions,
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
  it("rejects a customer dry-run from a non-legacy source table before source access", async () => {
    const source = new FixtureSource({ customers: [customer] });

    const error = await runMigration({
      mode: "dry-run",
      source,
      mappingCatalog: fixtureCatalog,
      batchSize: 100,
      entities: ["customers"],
      now: new Date("2026-09-28T00:00:00.000Z"),
      sourceSystem: "legacy_postgres",
      sourceDatabaseIdentity: sourceIdentity,
    }).then(() => null, (reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Customer dry-run requires catalog source table public.musteriler; catalog routes customers from public.customers",
    );
    expect((error as Error).message).not.toContain("Ada Lovelace");
    expect(source.reads).toEqual([]);
    expect(source.operations).toEqual([]);
  });

  it("rejects a default customer selection from a non-legacy source table before source access", async () => {
    const source = new FixtureSource({ customers: [customer] });

    await expect(runMigration({
      mode: "dry-run",
      source,
      mappingCatalog: fixtureCatalog,
      batchSize: 100,
      sourceSystem: "legacy_postgres",
      sourceDatabaseIdentity: sourceIdentity,
    })).rejects.toThrow("catalog routes customers from public.customers");
    expect(source.operations).toEqual([]);
  });

  it("builds a canonical dry-run plan without requiring a target", async () => {
    const source = new LegacyCustomerSource([]);

    const result = await runMigration({
      mode: "dry-run",
      source,
      mappingCatalog: legacyCatalogWithVersion("fixture-catalog-v1"),
      batchSize: 100,
      entities: ["customers"],
      now: new Date("2026-09-28T00:00:00.000Z"),
      sourceSystem: "legacy_postgres",
      sourceDatabaseIdentity: sourceIdentity,
    });

    expect(result.plan.entities).toEqual([{ entity: "customers", totalRows: 0, batches: 0 }]);
    expect(result.sourceManifest.mappingCatalogVersion).toBe("fixture-catalog-v1");
    expect(result.dryRunReport?.totals).toEqual({ plannedRows: 0, plannedBatches: 0, blockedRows: 0 });
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
      mappingCatalog: legacyMappingCatalog,
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
      mappingCatalog: legacyMappingCatalog,
      batchSize: 100,
      entities: ["customers"],
      sourceSystem: "legacy_postgres",
      sourceDatabaseIdentity: sourceIdentity,
    })).rejects.toThrow("Source table snapshot for customers must route to public.musteriler.id");
    expect(source.operations).toEqual(["describe"]);
  });

  it("derives the manifest version from the explicit validated catalog", async () => {
    const catalog = legacyCatalogWithVersion("fixture-catalog-v7");
    const source = new LegacyCustomerSource([]);

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
    const source = new LegacyCustomerSource([]);
    const result = await runMigration({
      mode: "dry-run",
      source,
      mappingCatalog: legacyCatalogWithVersion("fixture-catalog-v1"),
      batchSize: 100,
      sourceSystem: "legacy_postgres",
      sourceDatabaseIdentity: sourceIdentity,
    });

    expect(result.sourceManifest.mappingCatalogVersion).toBe("fixture-catalog-v1");
    expect(result.plan.entities.map(({ entity }) => entity)).toEqual([
      "customers",
      "conversations",
      "messages",
      "orders",
      "order_items",
      "shipments",
      "products",
    ]);
    expect(source.operations).toEqual([
      "describe",
      "count:customers",
      "count:conversations",
      "count:messages",
      "count:orders",
      "count:order_items",
      "count:shipments",
      "count:products",
    ]);
  });

  it("owns the catalog before count can mutate the caller input", async () => {
    const catalog = mutableFixtureCatalog("stable-catalog-v1");
    const source = new LegacyCustomerSource([]);
    source.count = async () => {
      catalog.version = "mutated-catalog-v2";
      catalog.tables[0]!.sourceTable = "public.changed";
      catalog.tables[0]!.columns[0]!.dataType = "text";
      return 0;
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
    expect(result.sourceManifest.tables[0]?.table).toBe("musteriler");
  });

  it("owns source snapshots before count can mutate the adapter result", async () => {
    const source = new LegacyCustomerSource([]);
    const snapshot = {
      entity: "customers" as const,
      schema: "public",
      table: "musteriler",
      idColumn: "id",
      columns: musterilerColumnSnapshots(),
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
        ordinalPosition: 16,
        dataType: "text",
        udtName: "text",
        nullable: true,
      });
      return 0;
    };

    const result = await runMigration({
      mode: "dry-run",
      source,
      mappingCatalog: legacyMappingCatalog,
      batchSize: 100,
      entities: ["customers"],
      sourceSystem: "legacy_postgres",
      sourceDatabaseIdentity: sourceIdentity,
    });

    expect(result.sourceManifest.tables).toEqual([{
      entity: "customers",
      schema: "public",
      table: "musteriler",
      idColumn: "id",
      columns: musterilerColumnSnapshots(),
    }]);
  });

});

function musterilerColumnSnapshots() {
  return legacyMappingCatalog.tables[0]!.columns.map((column, index) => ({
    name: column.name,
    ordinalPosition: index + 1,
    dataType: column.dataType,
    udtName: column.udtName,
    nullable: column.nullable,
  }));
}

function legacyCatalogWithVersion(version: string) {
  return createLegacyMappingCatalog({ ...legacyMappingCatalog, version });
}

class LegacyCustomerSource implements LegacySource {
  readonly reads: { entity: MigrationEntity; options: BatchReadOptions }[] = [];
  readonly operations: string[] = [];

  constructor(private readonly rows: LegacyRecord[]) {}

  async count(entity: MigrationEntity): Promise<number> {
    this.operations.push(`count:${entity}`);
    return entity === "customers" ? this.rows.length : 0;
  }

  async readBatch(entity: MigrationEntity, options: BatchReadOptions): Promise<LegacyRecord[]> {
    this.operations.push(`read:${entity}`);
    this.reads.push({ entity, options: { ...options } });
    const offset = options.offset ?? 0;
    return this.rows.slice(offset, offset + options.limit);
  }

  async describeTables(entities: readonly MigrationEntity[]): Promise<SourceTableSnapshot[]> {
    this.operations.push("describe");
    return entities.map(legacySnapshotFor);
  }
}

function legacySnapshotFor(entity: MigrationEntity): SourceTableSnapshot {
  const mapping = legacyMappingCatalog.tables.find((table) =>
    table.targetEntities.some((target) => target.entity === entity));
  if (!mapping) throw new Error(`Fixture catalog has no source table for ${entity}`);
  const [schema, table] = mapping.sourceTable.split(".") as [string, string];
  return {
    entity,
    schema,
    table,
    idColumn: mapping.idColumn,
    columns: mapping.columns.map((column, index) => ({
      name: column.name,
      ordinalPosition: index + 1,
      dataType: column.dataType,
      udtName: column.udtName,
      nullable: column.nullable,
    })),
  };
}

function legacyCustomerRow(id: string, overrides: Record<string, unknown> = {}): LegacyRecord {
  const payload = {
    id,
    ad: "Ada",
    soyad: "Lovelace",
    email: null,
    telefon: "+90 555 000 00 00",
    adres: null,
    il: null,
    ilce: null,
    posta_kodu: null,
    notlar: null,
    woocommerce_id: null,
    kolaybi_id: null,
    olusturma_tarihi: "2024-01-02T03:04:05Z",
    guncelleme_tarihi: null,
    username: null,
    ...overrides,
  };
  return {
    sourceSystem: "legacy_postgres",
    sourceTable: "public.musteriler",
    sourceId: id,
    payload,
    checksum: calculateSourcePayloadChecksum(payload),
  };
}

const legacyCustomerRows: LegacyRecord[] = [
  legacyCustomerRow("0a32ce63-4c3b-4fd4-917d-726d540a7216", {
    telefon: "ig_ada.lovelace",
    woocommerce_id: 100,
    kolaybi_id: "kb-1",
    adres: "Bağdat Caddesi 1",
  }),
  legacyCustomerRow("1b43df74-5d4c-4fe5-a28e-837e651b8327", { ad: "", soyad: null }),
  legacyCustomerRow("2c54e085-6e5d-4af6-b39f-948f762c9438", { woocommerce_id: 200, il: "İstanbul" }),
];

const verifiedAccounts: VerifiedIntegrationAccount[] = [
  { publicId: "iac_woo_main", providerKey: "woocommerce", status: "active" },
  { publicId: "iac_kolaybi_old", providerKey: "kolaybi", status: "inactive" },
];

function customerDryRun(source: LegacySource, integrationAccounts?: VerifiedIntegrationAccount[]) {
  return runMigration({
    mode: "dry-run",
    source,
    mappingCatalog: legacyMappingCatalog,
    batchSize: 2,
    entities: ["customers"],
    now: new Date("2026-09-30T00:00:00.000Z"),
    sourceSystem: "legacy_postgres",
    sourceDatabaseIdentity: sourceIdentity,
    ...(integrationAccounts ? { integrationAccounts } : {}),
  });
}

describe("customer dry-run validation", () => {
  it("transforms every planned customer batch and resolves identities without a target", async () => {
    const source = new LegacyCustomerSource(legacyCustomerRows);

    const result = await customerDryRun(source, verifiedAccounts);

    expect(source.reads).toEqual([
      { entity: "customers", options: { limit: 2, offset: 0 } },
      { entity: "customers", options: { limit: 2, offset: 2 } },
    ]);
    expect(source.operations).toEqual(["describe", "count:customers", "read:customers", "read:customers"]);
    expect(result.dryRunReport?.customerTransform).toEqual({
      transformedRows: 3,
      addressDrafts: 2,
      resolvedIdentities: 2,
      unresolvedIdentities: 2,
      nameFallbackWarnings: 1,
    });
    expect(result.dryRunReport?.totals).toEqual({ plannedRows: 3, plannedBatches: 2, blockedRows: 0 });
    expect(result.batches).toEqual([]);
  });

  it("leaves every identity candidate unresolved when no accounts are supplied", async () => {
    const result = await customerDryRun(new LegacyCustomerSource(legacyCustomerRows));

    expect(result.dryRunReport?.customerTransform).toMatchObject({
      transformedRows: 3,
      resolvedIdentities: 0,
      unresolvedIdentities: 4,
    });
  });

  it("fails the dry-run on an invalid customer row instead of skipping it", async () => {
    const tampered = { ...legacyCustomerRows[1]!, checksum: `sha256:${"0".repeat(64)}` };
    const source = new LegacyCustomerSource([legacyCustomerRows[0]!, tampered, legacyCustomerRows[2]!]);

    await expect(customerDryRun(source, verifiedAccounts)).rejects.toThrow(
      "Invalid legacy customer row: source payload checksum does not match payload",
    );
  });

  it("fails the dry-run when a batch returns a different row count than planned", async () => {
    const source = new LegacyCustomerSource(legacyCustomerRows);
    const readBatch = source.readBatch.bind(source);
    source.readBatch = async (entity, options) => (await readBatch(entity, options)).slice(0, 1);

    await expect(customerDryRun(source, verifiedAccounts)).rejects.toThrow(
      "Customer dry-run batch 1 returned 1 rows; expected 2",
    );
    expect(source.reads).toHaveLength(1);
  });

  it("rejects an invalid integration account snapshot before source access", async () => {
    const source = new LegacyCustomerSource(legacyCustomerRows);

    await expect(customerDryRun(source, [
      { publicId: "iac_woo_a", providerKey: "woocommerce", status: "active" },
      { publicId: "iac_woo_b", providerKey: "woocommerce", status: "active" },
    ])).rejects.toThrow("Invalid integration account snapshot: provider woocommerce has more than one active account");
    expect(source.operations).toEqual([]);
  });

  it("owns the integration account snapshot before source reads can mutate it", async () => {
    const accounts = verifiedAccounts.map((account) => ({ ...account }));
    const source = new LegacyCustomerSource(legacyCustomerRows);
    const readBatch = source.readBatch.bind(source);
    source.readBatch = async (entity, options) => {
      accounts[0]!.status = "inactive";
      return readBatch(entity, options);
    };

    const result = await customerDryRun(source, accounts);

    expect(result.dryRunReport?.customerTransform?.resolvedIdentities).toBe(2);
  });
});

class LegacyTableSource implements LegacySource {
  readonly reads: { entity: MigrationEntity; options: BatchReadOptions }[] = [];
  readonly operations: string[] = [];

  constructor(private readonly records: Partial<Record<MigrationEntity, LegacyRecord[]>>) {}

  async count(entity: MigrationEntity): Promise<number> {
    this.operations.push(`count:${entity}`);
    return this.records[entity]?.length ?? 0;
  }

  async readBatch(entity: MigrationEntity, options: BatchReadOptions): Promise<LegacyRecord[]> {
    this.operations.push(`read:${entity}`);
    this.reads.push({ entity, options: { ...options } });
    const offset = options.offset ?? 0;
    return (this.records[entity] ?? []).slice(offset, offset + options.limit);
  }

  async describeTables(entities: readonly MigrationEntity[]): Promise<SourceTableSnapshot[]> {
    this.operations.push("describe");
    return entities.map(legacySnapshotFor);
  }
}

function legacyRow(sourceTable: string, id: string, payload: Record<string, unknown>): LegacyRecord {
  return {
    sourceSystem: "legacy_postgres",
    sourceTable,
    sourceId: id,
    payload,
    checksum: calculateSourcePayloadChecksum(payload),
  };
}

function legacyConversationRow(id: string, overrides: Record<string, unknown>): LegacyRecord {
  return legacyRow("public.konusmalar", id, {
    id,
    musteri_id: null,
    kanal: "whatsapp",
    kanal_konusma_id: null,
    atanan_kullanici_id: null,
    durum: "acik",
    son_mesaj_tarihi: null,
    okunmamis_sayisi: 0,
    olusturma_tarihi: "2024-03-01T00:00:00Z",
    guncelleme_tarihi: null,
    son_mesaj_text: null,
    son_mesaj_gonderici: null,
    ig_account_id: null,
    human_agent: false,
    ...overrides,
  });
}

function legacyMessageRow(id: string, overrides: Record<string, unknown>): LegacyRecord {
  return legacyRow("public.mesajlar", id, {
    id,
    konusma_id: null,
    gonderici_tipi: "musteri",
    gonderici_id: null,
    icerik: "Merhaba",
    medya_url: null,
    medya_tipi: null,
    kanal_mesaj_id: null,
    okundu: null,
    olusturma_tarihi: "2024-03-02T00:00:00Z",
    ...overrides,
  });
}

const assignedUserId = "7b98c4c9-ac91-4e3a-9f83-d8c2ba6e3870";
const unknownUserId = "8ca9d5da-bda2-4f4b-a094-e9d3cb7f4981";
const legacyConversationRows: LegacyRecord[] = [
  legacyConversationRow("3d65f196-7f6e-4b07-8c50-a59f873d0549", {
    musteri_id: "0a32ce63-4c3b-4fd4-917d-726d540a7216",
    atanan_kullanici_id: assignedUserId,
  }),
  legacyConversationRow("4e76a2a7-8a7f-4c18-9d61-b6a0984e165a", {
    musteri_id: "1b43df74-5d4c-4fe5-a28e-837e651b8327",
    kanal: "instagram",
    ig_account_id: "ig-17841",
    atanan_kullanici_id: unknownUserId,
  }),
  legacyConversationRow("5f87b3b8-9b80-4d29-8e72-c7b1a95f276b", {
    musteri_id: "2c54e085-6e5d-4af6-b39f-948f762c9438",
    kanal: "panel",
    son_mesaj_text: "Kargonuz yolda",
    son_mesaj_gonderici: "calisan",
  }),
];

const legacyMessageRows: LegacyRecord[] = [
  legacyMessageRow("6a000000-0000-4000-8000-000000000001", {
    konusma_id: "3d65f196-7f6e-4b07-8c50-a59f873d0549",
  }),
  legacyMessageRow("6a000000-0000-4000-8000-000000000002", {
    konusma_id: "4e76a2a7-8a7f-4c18-9d61-b6a0984e165a",
    gonderici_tipi: "calisan",
    gonderici_id: assignedUserId,
    medya_url: "https://cdn.example.com/legacy/1.jpg",
    medya_tipi: "image",
  }),
  legacyMessageRow("6a000000-0000-4000-8000-000000000003", {
    konusma_id: "5f87b3b8-9b80-4d29-8e72-c7b1a95f276b",
    gonderici_tipi: "ai",
    gonderici_id: assignedUserId,
  }),
];

const verifiedConversationAccounts: VerifiedConversationAccount[] = [
  { publicId: "iac_whatsapp_main", providerKey: "whatsapp", status: "active", externalAccountId: null },
  { publicId: "iac_instagram_main", providerKey: "instagram", status: "active", externalAccountId: "ig-17841" },
];

function conversationDryRun(source: LegacySource, entities: MigrationEntity[]) {
  return runMigration({
    mode: "dry-run",
    source,
    mappingCatalog: legacyMappingCatalog,
    batchSize: 2,
    entities,
    now: new Date("2026-09-30T00:00:00.000Z"),
    sourceSystem: "legacy_postgres",
    sourceDatabaseIdentity: sourceIdentity,
    conversationAccounts: verifiedConversationAccounts,
    userPublicIds: new Map([[assignedUserId, "usr_agent_1"]]),
  });
}

describe("conversation dry-run validation", () => {
  it("transforms customers, then conversations, then ordered messages without a target", async () => {
    const source = new LegacyTableSource({
      customers: legacyCustomerRows,
      conversations: legacyConversationRows,
      messages: legacyMessageRows,
    });

    const result = await conversationDryRun(source, ["messages", "conversations", "customers"]);

    expect(source.operations).toEqual([
      "describe",
      "count:messages",
      "count:conversations",
      "count:customers",
      "read:customers",
      "read:customers",
      "read:conversations",
      "read:conversations",
      "read:messages",
      "read:messages",
    ]);
    expect(source.reads.filter(({ entity }) => entity === "messages")).toEqual([
      { entity: "messages", options: { limit: 2, offset: 0 } },
      { entity: "messages", options: { limit: 2, offset: 2 } },
    ]);
    expect(result.dryRunReport?.customerTransform).toMatchObject({ transformedRows: 3 });
    expect(result.dryRunReport?.conversationTransform).toEqual({
      transformedRows: 3,
      unresolvedAssignedUsers: 1,
      resolvedInstagramAccounts: 1,
    });
    expect(result.dryRunReport?.messageTransform).toEqual({ transformedRows: 3, mediaPayloads: 1 });
    expect(result.dryRunReport?.totals).toEqual({ plannedRows: 9, plannedBatches: 6, blockedRows: 0 });
    expect(result.batches).toEqual([]);
  });

  it("rejects conversations without customers and messages without conversations before source access", async () => {
    const source = new LegacyTableSource({ conversations: legacyConversationRows, messages: legacyMessageRows });

    await expect(conversationDryRun(source, ["conversations"])).rejects.toThrow(
      "Conversation dry-run requires customers in the same plan",
    );
    await expect(conversationDryRun(source, ["customers", "messages"])).rejects.toThrow(
      "Message dry-run requires conversations in the same plan",
    );
    expect(source.operations).toEqual([]);
  });

  it("fails the dry-run when a message batch is out of source id order", async () => {
    const [first, second, third] = legacyMessageRows as [LegacyRecord, LegacyRecord, LegacyRecord];
    const source = new LegacyTableSource({
      customers: legacyCustomerRows,
      conversations: legacyConversationRows,
      messages: [first, third, second],
    });

    await expect(conversationDryRun(source, ["customers", "conversations", "messages"])).rejects.toThrow(
      "Message dry-run batch 2 is not in ascending source id order",
    );
  });
});

function mutableFixtureCatalog(version: string) {
  return {
    version,
    tables: [{
      sourceTable: "public.musteriler",
      idColumn: "id",
      targetEntities: [{ entity: "customers" as const, mapping: "direct" as const, readiness: "dry-run" as const }],
      columns: legacyMappingCatalog.tables[0]!.columns.map((column) => ({ ...column })),
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
