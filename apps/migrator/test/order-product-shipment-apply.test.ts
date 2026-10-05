import { describe, expect, it } from "vitest";
import {
  applyOrderItemMigrationBatchWithState,
  applyOrderMigrationBatchWithState,
  applyProductMigrationBatchWithState,
  applyShipmentMigrationBatchWithState,
  reconcileDeferredReconciliations,
} from "../src/apply.js";
import { legacyIdMapKey } from "../src/id-map.js";
import { calculateSourcePayloadChecksum } from "../src/legacy-source.js";
import type {
  CanonicalRecord,
  CanonicalWriteResult,
  DeferredReconciliationEntry,
  DeferredReconciliationResult,
  DeferredReconciliationWrite,
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
  OrderCanonicalRecord,
  OrderItemCanonicalRecord,
  ShipmentCanonicalRecord,
  SourceTableSnapshot,
} from "../src/types.js";

const runId = "run_order_product_shipment_apply";
const customerId = "0a32ce63-4c3b-4fd4-917d-726d540a7216";
const conversationId = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const userId = "b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e";
const orderId = "6f1c2b3a-4d5e-4f60-8172-93a4b5c6d7e8";
const orderItemId = "8a100000-0000-4000-8000-000000000001";
const shipmentId = "c1000000-0000-4000-8000-000000000001";

describe("product/order/order item/shipment apply", () => {
  it("writes products, defers optional order conversations, resolves order item products, and reconciles shipments", async () => {
    const target = new ApplyMemoryTarget();
    target.seedMap("public.musteriler", customerId, "customers", "primary", "cus_0123456789abcdef01234567");

    await expect(applyProductMigrationBatchWithState({
      runId,
      source: new MemorySource([productRecord()]),
      target,
      batch: batch("products", 1),
    })).resolves.toMatchObject({ writtenRows: 1, idMapCreated: 1 });
    expect(target.mapRoles()).toContain("products:primary");

    const orderResult = await applyOrderMigrationBatchWithState({
      runId,
      source: new MemorySource([orderRecord()]),
      target,
      batch: batch("orders", 1),
      userPublicIds: new Map([[userId, "usr_agent_1"]]),
    });
    expect(orderResult.warnings).toEqual([
      expect.objectContaining({ code: "deferred_reconciliation" }),
    ]);
    expect(target.records.find((record) => record.targetTable === "orders")).toMatchObject({
      payload: { customer_id: "cus_0123456789abcdef01234567", conversation_id: null },
    });
    expect(target.deferred).toHaveLength(1);

    await expect(applyOrderItemMigrationBatchWithState({
      runId,
      source: new MemorySource([orderItemRecord()]),
      target,
      batch: batch("order_items", 1),
    })).resolves.toMatchObject({ writtenRows: 1, idMapCreated: 1 });

    const shipmentResult = await applyShipmentMigrationBatchWithState({
      runId,
      source: new MemorySource([shipmentRecord()]),
      target,
      batch: batch("shipments", 1),
    });
    expect(shipmentResult.warnings).toEqual([]);
    expect(target.records.find((record) => record.targetTable === "shipments")).toMatchObject({
      payload: { order_id: expect.stringMatching(/^ord_/) },
    });

    target.seedMap("public.konusmalar", conversationId, "conversations", "primary", "conv_89abcdef0123456789abcdef");
    await expect(reconcileDeferredReconciliations(target, runId)).resolves.toEqual({
      examined: 1,
      resolved: 1,
      pending: 0,
    });
    expect(target.records.find((record) => record.targetTable === "orders")).toMatchObject({
      payload: { conversation_id: "conv_89abcdef0123456789abcdef" },
    });
  });

  it("defers shipment order FKs by tracking number and reconciles after the order batch lands", async () => {
    const target = new ApplyMemoryTarget();
    target.seedMap("public.musteriler", customerId, "customers", "primary", "cus_0123456789abcdef01234567");

    await expect(applyShipmentMigrationBatchWithState({
      runId,
      source: new MemorySource([shipmentRecord({ takip_no: null, surat_kargo_takip_no: "SURAT-1" })]),
      target,
      batch: batch("shipments", 1),
    })).resolves.toMatchObject({
      writtenRows: 1,
      warnings: [expect.objectContaining({ code: "deferred_reconciliation" })],
    });
    expect(target.deferred[0]).toMatchObject({
      lookupSourceId: "SURAT-1",
      lookupMappingRole: "tracking_number:SURAT-1",
    });

    target.seedMap("public.siparisler", orderId, "orders", "tracking_number:SURAT-1", "ord_surat_tracking");
    await expect(reconcileDeferredReconciliations(target, runId)).resolves.toEqual({
      examined: 1,
      resolved: 1,
      pending: 0,
    });
    expect(target.records.find((record) => record.targetTable === "shipments")).toMatchObject({
      payload: { order_id: "ord_surat_tracking" },
    });
  });

  it("fails closed when a shipment tracking number maps to several orders", async () => {
    const target = new ApplyMemoryTarget();
    target.seedMap("public.siparisler", orderId, "orders", "tracking_number:TRK-123", "ord_one");
    target.seedMap(
      "public.siparisler",
      "6f1c2b3a-4d5e-4f60-8172-93a4b5c6d7e9",
      "orders",
      "tracking_number:TRK-123",
      "ord_two",
    );

    await expect(applyShipmentMigrationBatchWithState({
      runId,
      source: new MemorySource([shipmentRecord()]),
      target,
      batch: batch("shipments", 1),
    })).rejects.toThrow("Shipment tracking number TRK-123 resolves to multiple migrated orders");
  });

  it("fails closed when required product FK resolution or item totals are wrong", async () => {
    const missingProductTarget = new ApplyMemoryTarget();
    missingProductTarget.seedMap(
      "public.siparisler",
      orderId,
      "orders",
      "primary",
      "ord_0123456789abcdef01234567",
      "run_missing_product",
    );

    await expect(applyOrderItemMigrationBatchWithState({
      runId: "run_missing_product",
      source: new MemorySource([orderItemRecord()]),
      target: missingProductTarget,
      batch: batch("order_items", 1),
    })).rejects.toThrow(`Cannot resolve product FK for order item public.siparis_kalemleri.${orderItemId}`);

    const mismatchTarget = new ApplyMemoryTarget({ orderTotals: { ord_0123456789abcdef01234567: "99.00" } });
    mismatchTarget.seedMap(
      "public.siparisler",
      orderId,
      "orders",
      "primary",
      "ord_0123456789abcdef01234567",
      "run_total_mismatch",
    );
    mismatchTarget.productsBySku.set("SKU-1", "prd_0123456789abcdef01234567");

    await expect(applyOrderItemMigrationBatchWithState({
      runId: "run_total_mismatch",
      source: new MemorySource([orderItemRecord()]),
      target: mismatchTarget,
      batch: batch("order_items", 1),
    })).rejects.toThrow("Order total mismatch for ord_0123456789abcdef01234567");
  });
});

class MemorySource implements LegacySource {
  constructor(private readonly rows: readonly LegacyRecord[]) {}

  async count(_entity: MigrationEntity): Promise<number> {
    return this.rows.length;
  }

  async readBatch(_entity: MigrationEntity, options: { limit: number; offset?: number }): Promise<LegacyRecord[]> {
    const offset = options.offset ?? 0;
    return this.rows.slice(offset, offset + options.limit).map((row) => ({ ...row, payload: { ...row.payload } }));
  }

  async describeTables(entities: readonly MigrationEntity[]): Promise<SourceTableSnapshot[]> {
    return entities.map((entity) => ({ entity, schema: "public", table: entity, idColumn: "id", columns: [] }));
  }
}

class ApplyMemoryTarget implements MigrationTarget {
  private readonly idMaps = new Map<string, LegacyIdMapEntry>();
  private readonly batchStates = new Map<string, MigrationBatchState>();
  private readonly orderTotals: Record<string, string>;
  readonly productsBySku = new Map<string, string>();
  readonly productsByExternalId = new Map<string, string>();
  readonly records: CanonicalRecord[] = [];
  readonly deferred: DeferredReconciliationEntry[] = [];

  constructor(options: { readonly orderTotals?: Record<string, string> } = {}) {
    this.orderTotals = options.orderTotals ?? {};
  }

  seedMap(
    sourceTable: string,
    sourceId: string,
    targetTable: string,
    mappingRole: string,
    targetId: string,
    mapRunId = runId,
  ): void {
    const entry = {
      runId: mapRunId,
      sourceSystem: "legacy_supabase",
      sourceTable,
      sourceId: sourceId.toLowerCase(),
      targetTable,
      mappingRole,
      targetId,
      checksum: null,
      migratedAt: new Date("2026-10-05T00:00:00.000Z"),
    };
    this.idMaps.set(legacyIdMapKey(entry), entry);
  }

  async writeCanonicalRecord(input: CanonicalRecord): Promise<CanonicalWriteResult> {
    this.upsertRecord(input);
    if (input.targetTable === "products") {
      const sku = input.payload.sku;
      const externalProductId = input.payload.external_product_id;
      if (typeof sku === "string") this.productsBySku.set(sku, input.targetId);
      if (typeof externalProductId === "string") this.productsByExternalId.set(externalProductId, input.targetId);
    }
    return { status: "created", record: input };
  }

  async writeOrderRecord(input: OrderCanonicalRecord): Promise<CanonicalWriteResult> {
    const record = {
      targetTable: input.targetTable,
      targetId: input.targetId,
      checksum: input.checksum,
      payload: {
        ...input.payload,
        customer_id: input.customerPublicId,
        conversation_id: input.conversationPublicId,
        created_by_user_id: input.createdByUserPublicId,
      },
    };
    this.upsertRecord(record);
    return { status: "created", record };
  }

  async writeOrderItemRecord(input: OrderItemCanonicalRecord): Promise<CanonicalWriteResult> {
    const record = {
      targetTable: input.targetTable,
      targetId: input.targetId,
      checksum: input.checksum,
      payload: { ...input.payload, order_id: input.orderPublicId, product_id: input.productPublicId },
    };
    this.upsertRecord(record);
    return { status: "created", record };
  }

  async writeShipmentRecord(input: ShipmentCanonicalRecord): Promise<CanonicalWriteResult> {
    const record = {
      targetTable: input.targetTable,
      targetId: input.targetId,
      checksum: input.checksum,
      payload: { ...input.payload, order_id: input.orderPublicId, customer_id: input.customerPublicId },
    };
    this.upsertRecord(record);
    return { status: "created", record };
  }

  async findProductPublicIdBySku(sku: string): Promise<string | null> {
    return this.productsBySku.get(sku) ?? null;
  }

  async findProductPublicIdByExternalId(externalProductId: string): Promise<string | null> {
    return this.productsByExternalId.get(externalProductId) ?? null;
  }

  async recordDeferredReconciliation(input: DeferredReconciliationWrite): Promise<DeferredReconciliationEntry> {
    const existing = this.deferred.find((entry) =>
      entry.runId === input.runId
      && entry.sourceTable === input.sourceTable
      && entry.sourceId === input.sourceId
      && entry.targetTable === input.targetTable
      && entry.targetId === input.targetId
      && entry.targetColumn === input.targetColumn
    );
    if (existing) return existing;
    const entry = {
      ...input,
      publicId: `mdr_${this.deferred.length + 1}`,
      status: "pending" as const,
      resolvedTargetId: null,
      resolvedAt: null,
      errorMessage: null,
    };
    this.deferred.push(entry);
    return entry;
  }

  async reconcileDeferredReconciliations(inputRunId: string): Promise<DeferredReconciliationResult> {
    let resolved = 0;
    let pending = 0;
    for (const entry of this.deferred.filter((item) => item.runId === inputRunId && item.status === "pending")) {
      const matches = await this.findLegacyIdMapsByMappingRole({
        runId: inputRunId,
        sourceSystem: entry.sourceSystem,
        sourceTable: entry.lookupSourceTable,
        targetTable: entry.lookupTargetTable,
        mappingRole: entry.lookupMappingRole,
      });
      if (matches.length > 1) throw new Error(`Ambiguous deferred reconciliation ${entry.publicId}`);
      const map = matches[0] ?? null;
      if (!map) {
        pending += 1;
        continue;
      }
      const record = this.records.find((item) => item.targetTable === entry.targetTable && item.targetId === entry.targetId);
      if (record) record.payload[entry.targetColumn] = map.targetId;
      Object.assign(entry, { status: "resolved", resolvedTargetId: map.targetId, resolvedAt: new Date("2026-10-05T00:00:00.000Z") });
      resolved += 1;
    }
    return { examined: resolved + pending, resolved, pending };
  }

  async assertOrderTotalsConsistent(input: { readonly orderPublicId: string }): Promise<void> {
    const expected = this.orderTotals[input.orderPublicId] ?? "21.00";
    const actual = this.records
      .filter((record) => record.targetTable === "order_items" && record.payload.order_id === input.orderPublicId)
      .reduce((sum, record) => sum + Number(record.payload.total_amount), 0)
      .toFixed(2);
    if (expected !== actual) {
      throw new Error(`Order total mismatch for ${input.orderPublicId}: order total ${expected} does not equal item total ${actual}`);
    }
  }

  async findLegacyIdMap(input: LegacyIdMapKey): Promise<LegacyIdMapEntry | null> {
    return this.idMaps.get(legacyIdMapKey(input)) ?? null;
  }

  async findLegacyIdMapsByMappingRole(input: {
    readonly runId: string;
    readonly sourceSystem: string;
    readonly sourceTable: string;
    readonly targetTable: string;
    readonly mappingRole: string;
  }): Promise<readonly LegacyIdMapEntry[]> {
    return [...this.idMaps.values()]
      .filter((entry) =>
        entry.runId === input.runId
        && entry.sourceSystem === input.sourceSystem
        && entry.sourceTable === input.sourceTable
        && entry.targetTable === input.targetTable
        && entry.mappingRole === input.mappingRole
      )
      .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  }

  async upsertLegacyIdMap(input: LegacyIdMapWrite): Promise<LegacyIdMapEntry> {
    const entry = { ...input, migratedAt: new Date("2026-10-05T00:00:00.000Z") };
    this.idMaps.set(legacyIdMapKey(input), entry);
    return entry;
  }

  mapRoles(): string[] {
    return [...this.idMaps.values()].map((entry) => `${entry.targetTable}:${entry.mappingRole}`).sort();
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
      warnings: input.result.warnings,
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

  private upsertRecord(record: CanonicalRecord): void {
    const index = this.records.findIndex((item) => item.targetTable === record.targetTable && item.targetId === record.targetId);
    if (index === -1) this.records.push(record);
    else this.records[index] = record;
  }
}

function productRecord(overrides: Record<string, unknown> = {}): LegacyRecord {
  const payload = {
    id: 42,
    ad: "Kulucka Makinesi",
    kod: "SKU-1",
    kategori: "kulucka",
    birim: "adet",
    satis_fiyati: "21.00",
    stok_miktari: 7,
    kritik_seviye: 2,
    aciklama: null,
    aktif: true,
    olusturma_tarihi: "2024-01-02T03:04:05+03:00",
    guncelleme_tarihi: null,
    kolaybi_product_id: "kb-1",
    ...overrides,
  };
  return legacyRow("public.urunler", "42", payload);
}

function orderRecord(overrides: Record<string, unknown> = {}): LegacyRecord {
  const payload = {
    id: orderId,
    musteri_id: customerId,
    olusturan_id: userId,
    konusma_id: conversationId,
    musteri_ad: "Ayse Yilmaz",
    musteri_telefon: "+90 532 111 22 33",
    musteri_adres: "Ataturk Cad. 1",
    musteri_il: "Istanbul",
    musteri_ilce: "Kadikoy",
    musteri_posta_kodu: "34710",
    siparis_no: "GK-1001",
    siparis_tipi: "normal",
    durum: "olusturuldu",
    ara_toplam: "21.00",
    kdv_toplam: "0.00",
    kargo_ucreti: "0.00",
    genel_toplam: "21.00",
    kargo_takip_no: "TRK-123",
    kargo_firmasi: null,
    teyit_durumu: "bekliyor",
    teyit_tarihi: null,
    teyit_eden_id: null,
    notlar: null,
    iptal_nedeni: null,
    iade_nedeni: null,
    olusturma_tarihi: "2024-01-02T03:04:05+03:00",
    guncelleme_tarihi: null,
    kolaybi_siparis_id: "kb-order-1",
    ivr_bulk_id: null,
    ivr_tus: null,
    ivr_arama_durumu: null,
    ivr_arama_tarihi: null,
    kolaybi_contact_id: null,
    kolaybi_address_id: null,
    ivr_dinleme_suresi: null,
    kargo_yazdirildi: null,
    kargo_son_hareket: null,
    kargo_son_hareket_tarihi: null,
    kargoya_aktarilma_tarihi: null,
    efatura_durumu: null,
    sevk_edilme_tarihi: null,
    durum_oncelik: null,
    mukerrer: false,
    teyit_arama_deneme: 0,
    kaynak: "manuel",
    mukerrer_ad: false,
    at_disi: null,
    ...overrides,
  };
  return legacyRow("public.siparisler", orderId, payload);
}

function orderItemRecord(overrides: Record<string, unknown> = {}): LegacyRecord {
  const payload = {
    id: orderItemId,
    siparis_id: orderId,
    stok_id: null,
    urun_adi: "Yedek Fan",
    urun_kodu: "SKU-1",
    miktar: 2,
    birim: "adet",
    birim_fiyat: "10.50",
    kdv_orani: "20",
    toplam_fiyat: "21.00",
    olusturma_tarihi: "2024-01-02T03:04:05+03:00",
    kolaybi_product_id: null,
    ...overrides,
  };
  return legacyRow("public.siparis_kalemleri", orderItemId, payload);
}

function shipmentRecord(overrides: Record<string, unknown> = {}): LegacyRecord {
  const payload = {
    id: shipmentId,
    musteri_id: customerId,
    kargo_firmasi: "ptt",
    takip_no: "TRK-123",
    barkod_url: null,
    alici_ad: "Ayse Yilmaz",
    alici_telefon: "+90 532 111 22 33",
    alici_adres: "Ataturk Cad. 1",
    alici_il: "Istanbul",
    alici_ilce: "Kadikoy",
    alici_posta_kodu: "34710",
    gonderi_tipi: "standart",
    agirlik: "1.5",
    desi: null,
    ucret: "99.50",
    odeme_tipi: "gonderici",
    durum: "yolda",
    notlar: null,
    olusturan_id: null,
    olusturma_tarihi: "2024-01-02T03:04:05+03:00",
    guncelleme_tarihi: null,
    alici_email: null,
    kargo_turu: null,
    tasima_sekli: null,
    teslim_sekli: null,
    adet: 1,
    kapida_odeme_tutari: null,
    kargo_icerigi: "yedek parca",
    son_hareket: "Transfer merkezinde",
    son_hareket_tarihi: "2024-01-03T03:04:05+03:00",
    surat_web_siparis_kodu: null,
    surat_kargo_takip_no: null,
    surat_hesap_tipi: null,
    surat_barkod_no: null,
    ...overrides,
  };
  return legacyRow("public.kargo_gonderimleri", shipmentId, payload);
}

function legacyRow(sourceTable: string, sourceId: string, payload: Record<string, unknown>): LegacyRecord {
  return {
    sourceSystem: "legacy_supabase",
    sourceTable,
    sourceId: sourceId.toLowerCase(),
    payload,
    checksum: calculateSourcePayloadChecksum(payload),
  };
}

function batch(entity: MigrationEntity, expectedRows: number): MigrationBatch {
  return { entity, batchNumber: 1, limit: expectedRows, offset: 0, expectedRows };
}

function batchState(
  stateRunId: string,
  stateBatch: MigrationBatch,
  status: MigrationBatchState["status"],
  overrides: Partial<MigrationBatchState>,
): MigrationBatchState {
  return {
    runId: stateRunId,
    entity: stateBatch.entity,
    batchNumber: stateBatch.batchNumber,
    status,
    limit: stateBatch.limit,
    offset: stateBatch.offset,
    expectedRows: stateBatch.expectedRows,
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

function batchStateKey(stateRunId: string, stateBatch: MigrationBatch): string {
  return `${stateRunId}:${stateBatch.entity}:${stateBatch.batchNumber}`;
}
