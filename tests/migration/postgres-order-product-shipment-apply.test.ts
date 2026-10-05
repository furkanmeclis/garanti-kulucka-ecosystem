import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyOrderItemMigrationBatchWithState,
  applyOrderMigrationBatchWithState,
  applyProductMigrationBatchWithState,
  applyShipmentMigrationBatchWithState,
  reconcileDeferredReconciliations,
} from "../../apps/migrator/src/apply.js";
import { calculateSourcePayloadChecksum } from "../../apps/migrator/src/legacy-source.js";
import { DatabaseMigrationTarget } from "../../apps/migrator/src/target.js";
import { createDatabase } from "../../packages/database/src/index.js";
import type {
  LegacyRecord,
  LegacySource,
  MigrationEntity,
  SourceTableSnapshot,
} from "../../apps/migrator/src/types.js";

const migrationsDirectory = fileURLToPath(
  new URL("../../packages/database/migrations/", import.meta.url),
);

const customerId = "0a32ce63-4c3b-4fd4-917d-726d540a7216";
const conversationId = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const orderId = "6f1c2b3a-4d5e-4f60-8172-93a4b5c6d7e8";
const orderItemId = "8a100000-0000-4000-8000-000000000001";
const shipmentId = "c1000000-0000-4000-8000-000000000001";

describe("PostgreSQL product/order/order item/shipment apply", () => {
  it("writes executable targets, records deferred optional FKs, reconciles idempotently, and records total adjustments", async () => {
    const container = `gk-order-ship-${randomUUID().slice(0, 8)}`;
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
      "POSTGRES_DB=canonical_target",
      "postgres:18-alpine",
    ]);

    let db: ReturnType<typeof createDatabase> | undefined;
    try {
      await waitForPostgres(container, "canonical_target");
      for (const migration of await allCanonicalMigrations()) {
        executeSql(container, "canonical_target", await migrationSection(migration, "up"));
      }
      seedPrerequisites(container);

      db = createDatabase(postgresUrl(container, "canonical_target"));
      const target = new DatabaseMigrationTarget(db);
      const runId = "p4_order_product_shipment_apply";
      const registration = {
        runId,
        manifest: {
          sourceSystem: "legacy_postgres",
          databaseIdentity: { host: "127.0.0.1", port: "5432", database: "legacy_source" },
          tables: [],
          rowCounts: [
            { entity: "products", rows: 1 },
            { entity: "orders", rows: 1 },
            { entity: "order_items", rows: 1 },
            { entity: "shipments", rows: 2 },
          ],
          rowContentChecksums: [
            { entity: "products", rows: 1, checksum: "sha256:product-rows" },
            { entity: "orders", rows: 1, checksum: "sha256:order-rows" },
            { entity: "order_items", rows: 1, checksum: "sha256:item-rows" },
            { entity: "shipments", rows: 2, checksum: "sha256:shipment-rows" },
          ],
          batchSize: 2,
          mappingCatalogVersion: "p4-order-product-shipment-test",
          planFingerprint: "sha256:plan",
          sourceManifestHash: "sha256:manifest",
        },
      };
      await target.registerMigrationRun(registration);
      seedAppliedCustomerMap(container, runId);

      await expect(applyProductMigrationBatchWithState({
        runId,
        source: new MemorySource([productRecord()]),
        target,
        batch: batch("products", 1, 0, 1),
      })).resolves.toMatchObject({ writtenRows: 1, idMapCreated: 1 });

      await expect(applyOrderMigrationBatchWithState({
        runId,
        source: new MemorySource([orderRecord()]),
        target,
        batch: batch("orders", 1, 0, 1),
      })).resolves.toMatchObject({
        writtenRows: 1,
        idMapCreated: 2,
        warnings: [
          expect.objectContaining({ code: "deferred_reconciliation" }),
          expect.objectContaining({ code: "unresolved_optional_user" }),
        ],
      });
      expect(query(container, "canonical_target", `
        select count(*) from migration_deferred_reconciliations
        where run_id = '${runId}' and target_table = 'orders' and target_column = 'conversation_id' and status = 'pending'
      `)).toBe("1");

      await expect(applyOrderItemMigrationBatchWithState({
        runId,
        source: new MemorySource([orderItemRecord()]),
        target,
        batch: batch("order_items", 1, 0, 1),
      })).resolves.toMatchObject({ writtenRows: 1, idMapCreated: 1 });

      await expect(applyShipmentMigrationBatchWithState({
        runId,
        source: new MemorySource([
          shipmentRecord("c1000000-0000-4000-8000-000000000001", { takip_no: "TRK-DIRECT" }),
          shipmentRecord("c1000000-0000-4000-8000-000000000002", {
            takip_no: null,
            surat_kargo_takip_no: "SURAT-LATE",
          }),
        ]),
        target,
        batch: batch("shipments", 1, 0, 2),
      })).resolves.toMatchObject({
        writtenRows: 2,
        idMapCreated: 2,
        warnings: [expect.objectContaining({ code: "deferred_reconciliation" })],
      });

      expect(query(container, "canonical_target", `
        select concat_ws(':',
          (select count(*) from products),
          (select count(*) from orders),
          (select count(*) from order_items),
          (select count(*) from shipments),
          (select count(*) from legacy_id_map where run_id = '${runId}'),
          (select count(*) from migration_deferred_reconciliations where run_id = '${runId}' and status = 'pending')
        )
      `)).toBe("1:1:1:2:7:2");
      expect(query(container, "canonical_target", `
        select count(*)
        from order_items item
        join orders ord on ord.id = item.order_id
        join products product on product.id = item.product_id
        where product.sku = 'SKU-1' and ord.total_amount = item.total_amount
      `)).toBe("1");
      expect(query(container, "canonical_target", `
        select count(*)
        from shipments shipment
        join orders ord on ord.id = shipment.order_id
        where shipment.tracking_number = 'TRK-DIRECT'
      `)).toBe("1");

      await expect(applyOrderMigrationBatchWithState({
        runId,
        source: new MemorySource([orderRecord({
          id: "6f1c2b3a-4d5e-4f60-8172-93a4b5c6d7ea",
          siparis_no: "GK-LATE",
          konusma_id: null,
          genel_toplam: "0.00",
          kargo_takip_no: "SURAT-LATE",
        })]),
        target,
        batch: batch("orders", 2, 0, 1),
      })).resolves.toMatchObject({ writtenRows: 1, idMapCreated: 2 });
      seedConversation(container, runId);
      await expect(reconcileDeferredReconciliations(target, runId)).resolves.toEqual({
        examined: 2,
        resolved: 2,
        pending: 0,
      });
      await expect(reconcileDeferredReconciliations(target, runId)).resolves.toEqual({
        examined: 0,
        resolved: 0,
        pending: 0,
      });
      expect(query(container, "canonical_target", `
        select count(*)
        from orders ord
        join conversations conv on conv.id = ord.conversation_id
        where conv.public_id = 'conv_89abcdef0123456789abcdef'
      `)).toBe("1");
      expect(query(container, "canonical_target", `
        select count(*)
        from shipments shipment
        join orders ord on ord.id = shipment.order_id
        where shipment.tracking_number = 'SURAT-LATE' and ord.order_number = 'GK-LATE'
      `)).toBe("1");

      await target.registerMigrationRun({ ...registration, runId: "p4_order_total_mismatch" });
      seedAppliedCustomerMap(container, "p4_order_total_mismatch");
      await applyOrderMigrationBatchWithState({
        runId: "p4_order_total_mismatch",
        source: new MemorySource([orderRecord({ id: "6f1c2b3a-4d5e-4f60-8172-93a4b5c6d7e9", siparis_no: "GK-BAD", genel_toplam: "99.00" })]),
        target,
        batch: batch("orders", 1, 0, 1),
      });
      await expect(applyOrderItemMigrationBatchWithState({
        runId: "p4_order_total_mismatch",
        source: new MemorySource([orderItemRecord({ siparis_id: "6f1c2b3a-4d5e-4f60-8172-93a4b5c6d7e9" })]),
        target,
        batch: batch("order_items", 1, 0, 1),
      })).resolves.toMatchObject({
        writtenRows: 1,
        idMapCreated: 1,
        warnings: [expect.objectContaining({ code: "order_total_manual_adjustment" })],
      });
      expect(query(container, "canonical_target", `
        select manual_adjustment_amount::text
        from orders
        where order_number = 'GK-BAD'
      `)).toBe("78.00");

      await target.registerMigrationRun({ ...registration, runId: "p4_ambiguous_tracking" });
      seedAppliedCustomerMap(container, "p4_ambiguous_tracking");
      await applyOrderMigrationBatchWithState({
        runId: "p4_ambiguous_tracking",
        source: new MemorySource([
          orderRecord({
            id: "6f1c2b3a-4d5e-4f60-8172-93a4b5c6d7eb",
            siparis_no: "GK-AMB-1",
            konusma_id: null,
            kargo_takip_no: "TRK-AMB",
          }),
          orderRecord({
            id: "6f1c2b3a-4d5e-4f60-8172-93a4b5c6d7ec",
            siparis_no: "GK-AMB-2",
            konusma_id: null,
            kargo_takip_no: "TRK-AMB",
          }),
        ]),
        target,
        batch: batch("orders", 1, 0, 2),
      });
      await expect(applyShipmentMigrationBatchWithState({
        runId: "p4_ambiguous_tracking",
        source: new MemorySource([shipmentRecord("c1000000-0000-4000-8000-000000000003", { takip_no: "TRK-AMB" })]),
        target,
        batch: batch("shipments", 1, 0, 1),
      })).resolves.toMatchObject({
        writtenRows: 1,
        warnings: [expect.objectContaining({ code: "ambiguous_tracking_reconciliation" })],
      });
      expect(query(container, "canonical_target", `
        select count(*)
        from migration_deferred_reconciliations
        where run_id = 'p4_ambiguous_tracking'
          and target_table = 'shipments'
          and target_column = 'order_id'
          and lookup_source_id = 'TRK-AMB'
          and lookup_mapping_role = 'tracking_number:TRK-AMB'
          and status = 'pending'
      `)).toBe("1");
    } finally {
      await db?.destroy();
      docker(["rm", "--force", container], true);
    }
  }, 180_000);
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
  const id = typeof overrides.id === "string" ? overrides.id : orderId;
  const payload = {
    id,
    musteri_id: customerId,
    olusturan_id: "b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e",
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
    kargo_takip_no: "TRK-DIRECT",
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
  return legacyRow("public.siparisler", id, payload);
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

function shipmentRecord(id: string, overrides: Record<string, unknown> = {}): LegacyRecord {
  const payload = {
    id,
    musteri_id: customerId,
    kargo_firmasi: "ptt",
    takip_no: `TRK-${id.slice(0, 4)}`,
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
  return legacyRow("public.kargo_gonderimleri", id, payload);
}

function legacyRow(sourceTable: string, sourceId: string, payload: Record<string, unknown>): LegacyRecord {
  return {
    sourceSystem: "legacy_postgres",
    sourceTable,
    sourceId: sourceId.toLowerCase(),
    payload,
    checksum: calculateSourcePayloadChecksum(payload),
  };
}

function batch(entity: MigrationEntity, batchNumber: number, offset: number, expectedRows: number) {
  return { entity, batchNumber, limit: expectedRows, offset, expectedRows };
}

function seedPrerequisites(container: string): void {
  executeSql(container, "canonical_target", `
    insert into integration_providers (public_id, key, name, is_active)
    values ('prv_whatsapp', 'whatsapp', 'WhatsApp Cloud API', true)
    on conflict (key) do nothing;

    insert into customers (public_id, full_name, phone, email)
    values ('cus_0123456789abcdef01234567', 'Ada Lovelace', '+90 555 000 00 00', 'ada@example.test')
    on conflict (public_id) do nothing;
  `);
}

function seedAppliedCustomerMap(container: string, runId: string): void {
  executeSql(container, "canonical_target", `
    insert into legacy_id_map (
      run_id, source_system, source_table, source_id, target_table, mapping_role, target_id, checksum
    ) values (
      '${runId}', 'legacy_postgres', 'public.musteriler', '${customerId}', 'customers', 'primary',
      'cus_0123456789abcdef01234567', null
    )
    on conflict (run_id, source_system, source_table, source_id, target_table, mapping_role)
    do update set target_id = excluded.target_id, checksum = excluded.checksum;
  `);
}

function seedConversation(container: string, runId: string): void {
  executeSql(container, "canonical_target", `
    insert into conversations (public_id, customer_id, channel, status)
    select 'conv_89abcdef0123456789abcdef', id, 'whatsapp', 'open'
    from customers where public_id = 'cus_0123456789abcdef01234567'
    on conflict (public_id) do nothing;

    insert into legacy_id_map (
      run_id, source_system, source_table, source_id, target_table, mapping_role, target_id, checksum
    ) values (
      '${runId}', 'legacy_postgres', 'public.konusmalar', '${conversationId}', 'conversations', 'primary',
      'conv_89abcdef0123456789abcdef', null
    )
    on conflict (run_id, source_system, source_table, source_id, target_table, mapping_role)
    do update set target_id = excluded.target_id, checksum = excluded.checksum;
  `);
}

async function migrationSection(filename: string, section: "up" | "down"): Promise<string> {
  const sql = await readFile(`${migrationsDirectory}/${filename}`, "utf8");
  const marker = "-- Down Migration";
  const markerIndex = sql.indexOf(marker);
  if (section === "up") return markerIndex === -1 ? sql : sql.slice(0, markerIndex);
  if (markerIndex === -1) throw new Error(`Migration ${filename} has no down section`);
  return sql.slice(markerIndex + marker.length);
}

async function waitForPostgres(container: string, database: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      docker([
        "exec",
        container,
        "psql",
        "--username",
        "postgres",
        "--dbname",
        database,
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

function postgresUrl(container: string, database: string): string {
  const port = docker(["port", container, "5432/tcp"]).trim().split(":").pop();
  if (!port) throw new Error("PostgreSQL test container did not publish a host port");
  return `postgres://postgres:postgres@127.0.0.1:${port}/${database}`;
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

async function allCanonicalMigrations(): Promise<string[]> {
  return (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
}
