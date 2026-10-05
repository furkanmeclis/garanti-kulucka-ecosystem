import { describe, expect, it } from "vitest";
import { applyCustomerMigrationBatchWithState } from "../src/apply.js";
import { calculateSourcePayloadChecksum } from "../src/legacy-source.js";
import { legacyIdMapKey } from "../src/id-map.js";
import type {
  CanonicalRecord,
  CanonicalWriteResult,
  CustomerAddressCanonicalRecord,
  CustomerExternalIdentityCanonicalRecord,
  LegacyIdMapEntry,
  LegacyIdMapKey,
  LegacyIdMapWrite,
  LegacyRecord,
  LegacySource,
  MigrationBatch,
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
} from "../src/types.js";

const customerId = "0a32ce63-4c3b-4fd4-917d-726d540a7216";

describe("customer fan-out apply", () => {
  it("writes customer, address, and external identities with role-scoped id maps", async () => {
    const source = new CustomerSource([customerRecord()]);
    const target = new CustomerFanOutMemoryTarget(["iac_woocommerce_main", "iac_kolaybi_main"]);
    const batch = customerBatch({ expectedRows: 1 });

    await expect(applyCustomerMigrationBatchWithState({
      runId: "run_customer_apply",
      source,
      target,
      batch,
      integrationAccounts: [
        { publicId: "iac_woocommerce_main", providerKey: "woocommerce", status: "active" },
        { publicId: "iac_kolaybi_main", providerKey: "kolaybi", status: "active" },
      ],
    })).resolves.toMatchObject({
      readRows: 1,
      writtenRows: 4,
      idMapCreated: 4,
    });

    expect(target.records.map((record) => record.targetTable)).toEqual([
      "customers",
      "customer_addresses",
      "customer_external_identities",
      "customer_external_identities",
    ]);
    expect(target.mapRoles()).toEqual([
      "address:default",
      "external_identity:kolaybi",
      "external_identity:woocommerce",
      "primary",
    ]);
    expect(target.records[1]).toMatchObject({
      targetTable: "customer_addresses",
      payload: { customer_id: expect.stringMatching(/^cus_/) },
    });
    expect(target.records[2]).toMatchObject({
      targetTable: "customer_external_identities",
      payload: {
        customer_id: expect.stringMatching(/^cus_/),
        integration_account_id: "iac_woocommerce_main",
      },
    });
  });

  it("fails closed and records a failed batch when an identity account is unresolved", async () => {
    const source = new CustomerSource([customerRecord()]);
    const target = new CustomerFanOutMemoryTarget([]);
    const batch = customerBatch({ expectedRows: 1 });

    await expect(applyCustomerMigrationBatchWithState({
      runId: "run_customer_unresolved",
      source,
      target,
      batch,
      integrationAccounts: [],
    })).rejects.toThrow("requires resolved integration accounts for providers: kolaybi, woocommerce");

    expect(target.records).toEqual([]);
    expect(target.mapRoles()).toEqual([]);
    expect(await target.findMigrationBatchState({ runId: "run_customer_unresolved", batch })).toMatchObject({
      status: "failed",
      errorMessage: "Customer external identity apply requires resolved integration accounts for providers: kolaybi, woocommerce",
    });
  });
});

class CustomerSource implements LegacySource {
  constructor(private readonly rows: readonly LegacyRecord[]) {}

  async count(_entity: MigrationEntity): Promise<number> {
    return this.rows.length;
  }

  async readBatch(_entity: MigrationEntity, options: { limit: number; offset?: number }): Promise<LegacyRecord[]> {
    const offset = options.offset ?? 0;
    return this.rows.slice(offset, offset + options.limit).map((row) => ({ ...row, payload: { ...row.payload } }));
  }

  async describeTables(entities: readonly MigrationEntity[]): Promise<SourceTableSnapshot[]> {
    return entities.map((entity) => ({ entity, schema: "public", table: "musteriler", idColumn: "id", columns: [] }));
  }
}

class CustomerFanOutMemoryTarget implements MigrationTarget {
  private readonly idMaps = new Map<string, LegacyIdMapEntry>();
  private readonly batchStates = new Map<string, MigrationBatchState>();
  private readonly accountPublicIds: Set<string>;
  readonly records: CanonicalRecord[] = [];

  constructor(accountPublicIds: readonly string[]) {
    this.accountPublicIds = new Set(accountPublicIds);
  }

  async writeCanonicalRecord(input: CanonicalRecord): Promise<CanonicalWriteResult> {
    this.records.push(input);
    return { status: "created", record: input };
  }

  async writeCustomerAddressRecord(input: CustomerAddressCanonicalRecord): Promise<CanonicalWriteResult> {
    if (!this.records.some((record) => record.targetTable === "customers" && record.targetId === input.customerPublicId)) {
      throw new Error(`Cannot resolve customer public id ${input.customerPublicId}`);
    }
    const record = {
      targetTable: input.targetTable,
      targetId: input.targetId,
      checksum: input.checksum,
      payload: { ...input.payload, customer_id: input.customerPublicId },
    };
    this.records.push(record);
    return { status: "created", record };
  }

  async writeCustomerExternalIdentityRecord(
    input: CustomerExternalIdentityCanonicalRecord,
  ): Promise<CanonicalWriteResult> {
    if (!this.records.some((record) => record.targetTable === "customers" && record.targetId === input.customerPublicId)) {
      throw new Error(`Cannot resolve customer public id ${input.customerPublicId}`);
    }
    if (!this.accountPublicIds.has(input.integrationAccountPublicId)) {
      throw new Error(`Cannot resolve integration account public id ${input.integrationAccountPublicId}`);
    }
    const record = {
      targetTable: input.targetTable,
      targetId: input.targetId,
      checksum: input.checksum,
      payload: {
        ...input.payload,
        customer_id: input.customerPublicId,
        integration_account_id: input.integrationAccountPublicId,
      },
    };
    this.records.push(record);
    return { status: "created", record };
  }

  async findLegacyIdMap(input: LegacyIdMapKey): Promise<LegacyIdMapEntry | null> {
    return this.idMaps.get(legacyIdMapKey(input)) ?? null;
  }

  async upsertLegacyIdMap(input: LegacyIdMapWrite): Promise<LegacyIdMapEntry> {
    const entry = { ...input, migratedAt: new Date("2026-10-05T00:00:00.000Z") };
    this.idMaps.set(legacyIdMapKey(input), entry);
    return entry;
  }

  mapRoles(): string[] {
    return [...this.idMaps.values()].map((entry) => entry.mappingRole).sort();
  }

  async findMigrationBatchState(input: MigrationBatchStateKey): Promise<MigrationBatchState | null> {
    return this.batchStates.get(batchStateKey(input.runId, input.batch)) ?? null;
  }

  async recordMigrationBatchStarted(input: MigrationBatchStateStart): Promise<MigrationBatchState> {
    const state = batchState(input.runId, input.batch, "running", {});
    this.batchStates.set(batchStateKey(input.runId, input.batch), state);
    return state;
  }

  async recordMigrationBatchSucceeded(input: MigrationBatchStateSuccess): Promise<MigrationBatchState> {
    const state = batchState(input.runId, input.batch, "succeeded", {
      readRows: input.result.readRows,
      writtenRows: input.result.writtenRows,
      idMapCreated: input.result.idMapCreated,
      idMapUpdated: input.result.idMapUpdated,
      idMapUnchanged: input.result.idMapUnchanged,
    });
    this.batchStates.set(batchStateKey(input.runId, input.batch), state);
    return state;
  }

  async recordMigrationBatchFailed(input: MigrationBatchStateFailure): Promise<MigrationBatchState> {
    const state = batchState(input.runId, input.batch, "failed", { errorMessage: input.error.message });
    this.batchStates.set(batchStateKey(input.runId, input.batch), state);
    return state;
  }

  async registerMigrationRun(input: MigrationRunRegistration): Promise<MigrationRunState> {
    return { ...input, createdAt: new Date("2026-10-05T00:00:00.000Z") };
  }
}

function customerRecord(overrides: Record<string, unknown> = {}): LegacyRecord {
  const payload = {
    id: customerId,
    ad: "Ada",
    soyad: "Lovelace",
    email: "ada@example.test",
    telefon: "+90 555 000 00 00",
    adres: "Bagdat Caddesi 1",
    il: "Istanbul",
    ilce: "Kadikoy",
    posta_kodu: "34710",
    notlar: null,
    woocommerce_id: 42,
    kolaybi_id: "kb-42",
    olusturma_tarihi: "2024-01-02T03:04:05Z",
    guncelleme_tarihi: null,
    username: "ada",
    ...overrides,
  };
  return {
    sourceSystem: "legacy_postgres",
    sourceTable: "public.musteriler",
    sourceId: String(payload.id),
    payload,
    checksum: calculateSourcePayloadChecksum(payload),
  };
}

function customerBatch(overrides: Partial<MigrationBatch> = {}): MigrationBatch {
  return {
    entity: "customers",
    batchNumber: 1,
    limit: 1,
    offset: 0,
    expectedRows: 1,
    ...overrides,
  };
}

function batchState(
  runId: string,
  batch: MigrationBatch,
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

function batchStateKey(runId: string, batch: { entity: MigrationEntity; batchNumber: number }): string {
  return `${runId}:${batch.entity}:${batch.batchNumber}`;
}
