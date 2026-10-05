import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { executePostgresMigration } from "../../apps/migrator/src/postgres-runtime.js";
import { legacyMappingCatalog, type LegacyColumnContract } from "../../apps/migrator/src/mapping-catalog.js";
import { migrationApplyDisabledMessage } from "../../apps/migrator/src/errors.js";

const migrationsDirectory = fileURLToPath(
  new URL("../../packages/database/migrations/", import.meta.url),
);

const customerId = "0a32ce63-4c3b-4fd4-917d-726d540a7216";
const conversationId = "3d65f196-7f6e-4b07-8c50-a59f873d0549";
const messageId = "4e76a207-806f-4c18-9d61-b60f984e1650";
const orderId = "a1000000-0000-4000-8000-000000000001";
const orderItemId = "b1000000-0000-4000-8000-000000000001";
const shipmentId = "c1000000-0000-4000-8000-000000000001";
const userId = "99999999-9999-4999-8999-999999999999";

describe("PostgreSQL migrator dry-run E2E", () => {
  it("validates every dry-run-ready legacy table through the real PostgreSQL source runtime without a target", async () => {
    const container = `gk-migrator-dry-run-${randomUUID().slice(0, 8)}`;
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
      "POSTGRES_DB=garanti_kulucka",
      "postgres:18-alpine",
    ]);

    try {
      await waitForPostgres(container);
      executeSql(container, "garanti_kulucka", legacySchemaSql());
      executeSql(container, "garanti_kulucka", legacyFixtureSql());
      executeSql(container, "postgres", "create database canonical_target");
      for (const migration of [
        "001_initial_canonical_schema.sql",
        "002_add_migration_identity_targets.sql",
        "003_add_migration_run_manifests.sql",
        "004_add_woocommerce_provider.sql",
        "005_add_migration_row_content_checksums.sql",
      ]) {
        executeSql(container, "canonical_target", await migrationSection(migration, "up"));
      }
      expect(canonicalTargetCounts(container)).toBe("0:0:0:0:0:0:0:0:0:0");

      const result = await executePostgresMigration({
        mode: "dry-run",
        sourceDatabaseUrl: postgresUrl(container),
        sourceSystem: "legacy_postgres",
        batchSize: 2,
        userPublicIds: new Map([[userId, "usr_agent_1"]]),
      });

      expect(result.mode).toBe("dry-run");
      expect(result.batches).toEqual([]);
      expect(result.dryRunReport?.totals).toEqual({
        plannedRows: 8,
        plannedBatches: 8,
        blockedRows: 0,
      });
      expect(result.plan.entities).toEqual([
        { entity: "customers", totalRows: 1, batches: 1 },
        { entity: "conversations", totalRows: 1, batches: 1 },
        { entity: "messages", totalRows: 1, batches: 1 },
        { entity: "products", totalRows: 1, batches: 1 },
        { entity: "orders", totalRows: 1, batches: 1 },
        { entity: "order_items", totalRows: 1, batches: 1 },
        { entity: "shipments", totalRows: 1, batches: 1 },
        { entity: "shipment_tracking_events", totalRows: 1, batches: 1 },
      ]);
      expect(result.dryRunReport?.customerTransform).toMatchObject({
        transformedRows: 1,
        addressDrafts: 1,
      });
      expect(result.dryRunReport?.conversationTransform).toEqual({
        transformedRows: 1,
        unresolvedAssignedUsers: 0,
        resolvedInstagramAccounts: 0,
      });
      expect(result.dryRunReport?.messageTransform).toEqual({
        transformedRows: 1,
        mediaPayloads: 0,
      });
      expect(result.dryRunReport?.productTransform).toEqual({
        transformedRows: 1,
        inactiveProducts: 0,
      });
      expect(result.dryRunReport?.orderTransform).toEqual({
        transformedRows: 1,
        customerResolutionByPhone: 1,
        unresolvedConversations: 0,
        unresolvedCreators: 0,
      });
      expect(result.dryRunReport?.orderItemTransform).toEqual({
        transformedRows: 1,
        resolvedProducts: 1,
        unresolvedProducts: 0,
        skuProductMatches: 1,
        externalProductMatches: 0,
        totalAdjustmentWarnings: 1,
        totalAdjustmentAmount: "123.00",
      });
      expect(result.dryRunReport?.shipmentTransform).toEqual({
        transformedRows: 1,
        unresolvedCustomers: 0,
        linkedOrdersByTracking: 1,
        pttShipments: 1,
        suratShipments: 0,
        manualShipments: 0,
      });
      expect(result.dryRunReport?.shipmentTrackingEventTransform).toEqual({
        transformedRows: 1,
        uniqueEvents: 1,
        duplicateRows: 0,
        futureDatedRows: 0,
        providerTimeEvents: 1,
        firstSeenEvents: 0,
        unresolvedShipments: 0,
      });
      expect(result.sourceManifest.rowContentChecksums).toHaveLength(8);
      expect(result.sourceManifest.rowContentChecksums).toEqual(
        expect.arrayContaining([
          { entity: "customers", rows: 1, checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
          { entity: "conversations", rows: 1, checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
          { entity: "messages", rows: 1, checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
          { entity: "products", rows: 1, checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
          { entity: "orders", rows: 1, checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
          { entity: "order_items", rows: 1, checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
          { entity: "shipments", rows: 1, checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
          { entity: "shipment_tracking_events", rows: 1, checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
        ]),
      );
      expect(query(container, "garanti_kulucka", "select count(*) from public.musteriler")).toBe("1");
      expect(canonicalTargetCounts(container)).toBe("0:0:0:0:0:0:0:0:0:0");
      await expect(executePostgresMigration({
        mode: "apply",
        sourceDatabaseUrl: postgresUrl(container),
        targetDatabaseUrl: postgresUrl(container, "canonical_target"),
        sourceSystem: "legacy_postgres",
        runId: "p4-real-postgres-e2e",
        batchSize: 2,
      })).rejects.toThrow(migrationApplyDisabledMessage);
      expect(canonicalTargetCounts(container)).toBe("0:0:0:0:0:0:0:0:0:0");
    } finally {
      docker(["rm", "--force", container], true);
    }
  }, 180_000);
});

async function migrationSection(
  filename: string,
  section: "up" | "down",
): Promise<string> {
  const sql = await readFile(`${migrationsDirectory}/${filename}`, "utf8");
  const marker = "-- Down Migration";
  const markerIndex = sql.indexOf(marker);
  if (section === "up") return markerIndex === -1 ? sql : sql.slice(0, markerIndex);
  if (markerIndex === -1) throw new Error(`Migration ${filename} has no down section`);
  return sql.slice(markerIndex + marker.length);
}

function legacySchemaSql(): string {
  return legacyMappingCatalog.tables.map((table) => {
    const columns = table.columns.map((column) =>
      `${quoteIdentifier(column.name)} ${sqlType(column)}${column.nullable ? "" : " not null"}`);
    return `create table ${quoteQualifiedIdentifier(table.sourceTable)} (${columns.join(", ")});`;
  }).join("\n");
}

function sqlType(column: LegacyColumnContract): string {
  if (column.dataType === "timestamp with time zone" && column.udtName === "timestamptz") return "timestamptz";
  if (column.dataType === "character varying" && column.udtName === "varchar") return "varchar";
  if (column.dataType === "integer" && column.udtName === "int4") return "integer";
  if (column.dataType === "smallint" && column.udtName === "int2") return "smallint";
  if (column.dataType === "boolean" && column.udtName === "bool") return "boolean";
  if (column.dataType === "numeric" && column.udtName === "numeric") return "numeric";
  if (column.dataType === "text" && column.udtName === "text") return "text";
  if (column.dataType === "uuid" && column.udtName === "uuid") return "uuid";
  throw new Error(`Unsupported legacy column type ${column.dataType}/${column.udtName}`);
}

function quoteQualifiedIdentifier(identifier: string): string {
  return identifier.split(".").map(quoteIdentifier).join(".");
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function legacyFixtureSql(): string {
  return `
    insert into public.musteriler (
      id, ad, soyad, email, telefon, adres, il, ilce, posta_kodu, notlar,
      woocommerce_id, kolaybi_id, olusturma_tarihi, guncelleme_tarihi, username
    ) values (
      '${customerId}', 'Ada', 'Lovelace', 'ada@example.test', '+90 555 000 00 00',
      'Bagdat Caddesi 1', 'Istanbul', 'Kadikoy', '34710', null,
      null, null, '2024-01-02T03:04:05Z', null, 'ada'
    );

    insert into public.konusmalar (
      id, musteri_id, kanal, kanal_konusma_id, atanan_kullanici_id, durum,
      son_mesaj_tarihi, okunmamis_sayisi, olusturma_tarihi, guncelleme_tarihi,
      son_mesaj_text, son_mesaj_gonderici, ig_account_id, ig_login_type, human_agent
    ) values (
      '${conversationId}', '${customerId}', 'panel', 'panel-thread-1', '${userId}', 'acik',
      '2024-01-02T04:04:05Z', 0, '2024-01-02T03:04:05Z', null,
      'Merhaba', 'musteri', null, 'business', true
    );

    insert into public.mesajlar (
      id, konusma_id, gonderici_tipi, gonderici_id, icerik,
      media_url, media_type, gonderici_adi, medya_url, medya_tipi,
      kanal_mesaj_id, okundu, olusturma_tarihi
    ) values (
      '${messageId}', '${conversationId}', 'musteri', null, 'Merhaba',
      null, null, 'Ada Lovelace', null, null,
      'msg-legacy-1', true, '2024-01-02T04:05:05Z'
    );

    insert into public.urunler (
      id, ad, kod, kategori, birim, satis_fiyati, stok_miktari, kritik_seviye,
      aciklama, aktif, olusturma_tarihi, guncelleme_tarihi, kolaybi_product_id
    ) values (
      1, 'Urun 1', 'SKU-1', 'diger', 'adet', 10.00, 5, 1,
      'Fixture product', true, '2024-01-02T03:04:05Z', null, 'kb-product-1'
    );

    insert into public.siparisler (
      id, musteri_id, olusturan_id, konusma_id, musteri_ad, musteri_telefon,
      musteri_adres, musteri_il, musteri_ilce, musteri_posta_kodu, musteri_ulke, siparis_no,
      siparis_tipi, durum, ara_toplam, kdv_toplam, kargo_ucreti, genel_toplam,
      kargo_takip_no, kargo_firmasi, teyit_durumu, teyit_tarihi, teyit_eden_id,
      notlar, iptal_nedeni, iade_nedeni, olusturma_tarihi, guncelleme_tarihi,
      kolaybi_siparis_id, ivr_bulk_id, ivr_tus, ivr_arama_durumu, ivr_arama_tarihi,
      kolaybi_contact_id, kolaybi_address_id, ivr_dinleme_suresi, kargo_yazdirildi,
      kargo_son_hareket, kargo_son_hareket_tarihi, kargoya_aktarilma_tarihi,
      efatura_durumu, sevk_edilme_tarihi, durum_oncelik, mukerrer,
      teyit_arama_deneme, kaynak, mukerrer_ad, at_disi
    ) values (
      '${orderId}', null, '${userId}', '${conversationId}', 'Ada Lovelace',
      '+90 555 000 00 00', 'Bagdat Caddesi 1', 'Istanbul', 'Kadikoy', '34710', 'TR',
      'GK-1001', 'normal', 'olusturuldu', 100.00, 18.00, 25.00, 143.00,
      'TRK-1', null, 'bekliyor', null, null, null, null, null,
      '2024-01-02T03:04:05Z', null, 'kb-order-1', null, null, null, null,
      null, null, null, false, null, null, null, null, null, null,
      false, 0, 'manuel', false, null
    );

    insert into public.siparis_kalemleri (
      id, siparis_id, stok_id, urun_adi, urun_kodu, miktar, birim, birim_fiyat,
      kdv_orani, toplam_fiyat, olusturma_tarihi, kolaybi_product_id
    ) values (
      '${orderItemId}', '${orderId}', null, 'Urun 1', 'SKU-1', 2, 'adet',
      10.00, 20.00, 20.00, '2024-01-02T03:04:05Z', null
    );

    insert into public.kargo_gonderimleri (
      id, musteri_id, kargo_firmasi, takip_no, barkod_url, alici_ad, alici_telefon,
      alici_adres, alici_il, alici_ilce, alici_posta_kodu, gonderi_tipi, agirlik,
      desi, ucret, odeme_tipi, durum, notlar, olusturan_id, olusturma_tarihi,
      guncelleme_tarihi, alici_email, kargo_turu, tasima_sekli, teslim_sekli,
      adet, kapida_odeme_tutari, kargo_icerigi, son_hareket, son_hareket_tarihi,
      surat_web_siparis_kodu, surat_kargo_takip_no, surat_hesap_tipi, surat_barkod_no
    ) values (
      '${shipmentId}', null, 'ptt', 'TRK-1', null, 'Ada Lovelace',
      '+90 555 000 00 00', 'Bagdat Caddesi 1', 'Istanbul', 'Kadikoy', '34710',
      null, 1.5, null, 99.50, null, 'beklemede', null, null,
      '2024-01-02T03:04:05Z', null, null, null, null, null,
      1, null, null, null, null, null, null, null, null
    );

    insert into public.kargo_takip (
      id, kargo_id, durum, aciklama, lokasyon, tarih
    ) values (
      'd1000000-0000-4000-8000-000000000001',
      '${shipmentId}',
      'Teslim edildi',
      null,
      'Istanbul',
      '2024-01-03T03:04:05Z'
    );
  `;
}

async function waitForPostgres(container: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      docker([
        "exec",
        container,
        "psql",
        "--username",
        "postgres",
        "--dbname",
        "garanti_kulucka",
        "--command",
        "SELECT 1",
      ]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("PostgreSQL test container did not become ready");
}

function canonicalTargetCounts(container: string): string {
  return query(container, "canonical_target", `
    select concat_ws(':',
      (select count(*) from customers),
      (select count(*) from conversations),
      (select count(*) from messages),
      (select count(*) from products),
      (select count(*) from orders),
      (select count(*) from order_items),
      (select count(*) from shipments),
      (select count(*) from migration_runs),
      (select count(*) from migration_batches),
      (select count(*) from legacy_id_map)
    )
  `);
}

function postgresUrl(container: string, database = "garanti_kulucka"): string {
  const port = docker(["port", container, "5432/tcp"]).trim().split(":").pop();
  if (!port) throw new Error("PostgreSQL test container did not publish a host port");
  return `postgres://postgres:postgres@127.0.0.1:${port}/${database}`;
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
