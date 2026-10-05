import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { runMigratorCommand } from "../../apps/migrator/src/commands.js";
import { executePostgresMigration } from "../../apps/migrator/src/postgres-runtime.js";
import { legacyMappingCatalog, type LegacyColumnContract } from "../../apps/migrator/src/mapping-catalog.js";

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

describe("PostgreSQL full command apply E2E", () => {
  it("applies every executable legacy table, verifies, stays idempotent, and resumes an interrupted command", async () => {
    const container = `gk-full-apply-${randomUUID().slice(0, 8)}`;
    const tempDir = await mkdtemp(join(tmpdir(), "gk-full-apply-"));
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
      "POSTGRES_DB=legacy_source",
      "postgres:18-alpine",
    ]);

    try {
      await waitForPostgres(container, "legacy_source");
      executeSql(container, "legacy_source", legacySchemaSql());
      executeSql(container, "legacy_source", legacyFixtureSql());
      executeSql(container, "postgres", "create database canonical_target");
      for (const migration of [
        "001_initial_canonical_schema.sql",
        "002_add_migration_identity_targets.sql",
        "003_add_migration_run_manifests.sql",
        "004_add_woocommerce_provider.sql",
        "005_add_migration_row_content_checksums.sql",
        "006_add_migration_deferred_reconciliations.sql",
      ]) {
        executeSql(container, "canonical_target", await migrationSection(migration, "up"));
      }
      seedCanonicalPrerequisites(container);

      const sourceUrl = postgresUrl(container, "legacy_source");
      const targetUrl = postgresUrl(container, "canonical_target");
      const evidenceFile = join(tempDir, "backup-evidence.json");
      const userPublicIdsFile = join(tempDir, "user-public-ids.json");
      const reportFile = join(tempDir, "apply-report.json");
      await writeFile(evidenceFile, JSON.stringify({
        targetDatabaseIdentity: {
          host: "127.0.0.1",
          port: new URL(targetUrl).port,
          database: "canonical_target",
        },
        createdAt: new Date().toISOString(),
      }));
      await writeFile(userPublicIdsFile, JSON.stringify({ [userId]: "usr_agent_1" }));

      const env = {
        SOURCE_DATABASE_URL: sourceUrl,
        TARGET_DATABASE_URL: targetUrl,
        MIGRATION_RUN_ID: "p4_full_command_apply",
        MIGRATION_BATCH_SIZE: "1",
        MIGRATION_APPLY_ENABLED: "true",
        MIGRATION_BACKUP_EVIDENCE: evidenceFile,
        MIGRATION_USER_PUBLIC_IDS_FILE: userPublicIdsFile,
      };

      await expect(runMigratorCommand(
        "migrate:apply",
        env,
        {},
        {
          executeMigration: executePostgresMigration,
          verifyTarget: vi.fn().mockRejectedValue(new Error("interrupted after apply")),
        },
      )).rejects.toThrow("interrupted after apply");
      expect(targetCounts(container)).toBe("1:1:0:1:1:1:1:1:1:1:7:9:0");

      await expect(runMigratorCommand("migrate:apply", env, { reportFile })).resolves.toBeUndefined();
      expect(targetCounts(container)).toBe("1:1:0:1:1:1:1:1:1:1:7:9:0");
      const report = JSON.parse(await readFile(reportFile, "utf8")) as Record<string, unknown>;
      expect(report).toMatchObject({
        command: "migrate:apply",
        status: "passed",
        verification: { status: "passed" },
        reconciliation: { examined: 0, resolved: 0, pending: 0 },
      });
      expect(JSON.stringify(report)).not.toContain("postgres://");

      await expect(runMigratorCommand("migrate:apply", env, { reportFile })).resolves.toBeUndefined();
      expect(targetCounts(container)).toBe("1:1:0:1:1:1:1:1:1:1:7:9:0");
      expect(query(container, "canonical_target", `
        select concat_ws(':', customers.full_name, customer_addresses.city, orders.order_number, shipments.tracking_number)
        from customers
        join customer_addresses on customer_addresses.customer_id = customers.id
        join orders on orders.customer_id = customers.id
        join shipments on shipments.customer_id = customers.id
      `)).toBe("İpek Öztürk:İstanbul:GK-TR-1001:TRK-IST-1");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      docker(["rm", "--force", container], true);
    }
  }, 180_000);
});

async function migrationSection(filename: string, section: "up" | "down"): Promise<string> {
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
      '${customerId}', 'İpek', 'Öztürk', 'ipek.ozturk@example.test', '+90 532 111 22 33',
      'Bağdat Caddesi 42', 'İstanbul', 'Kadıköy', '34710', 'Karışık ad fixture',
      null, null, '2024-01-02T03:04:05+03:00', null, 'ipek_ozturk'
    );

    insert into public.konusmalar (
      id, musteri_id, kanal, kanal_konusma_id, atanan_kullanici_id, durum,
      son_mesaj_tarihi, okunmamis_sayisi, olusturma_tarihi, guncelleme_tarihi,
      son_mesaj_text, son_mesaj_gonderici, ig_account_id, human_agent
    ) values (
      '${conversationId}', '${customerId}', 'panel', 'panel-thread-1', '${userId}', 'acik',
      '2024-01-02T04:04:05+03:00', 0, '2024-01-02T03:04:05+03:00', null,
      'Merhaba, ölçü XL mi?', 'musteri', null, true
    );

    insert into public.mesajlar (
      id, konusma_id, gonderici_tipi, gonderici_id, icerik, medya_url, medya_tipi,
      kanal_mesaj_id, okundu, olusturma_tarihi
    ) values (
      '${messageId}', '${conversationId}', 'musteri', null, 'Merhaba, ölçü XL mi?', null, null,
      'msg-legacy-1', true, '2024-01-02T04:05:05+03:00'
    );

    insert into public.urunler (
      id, ad, kod, kategori, birim, satis_fiyati, stok_miktari, kritik_seviye,
      aciklama, aktif, olusturma_tarihi, guncelleme_tarihi, kolaybi_product_id
    ) values (
      42, 'Pamuklu Tişört XL', 'SKU-TR-XL', 'diger', 'adet', 30.00, 5, 1,
      'Türkçe karakterli ürün', true, '2024-01-02T03:04:05+03:00', null, null
    );

    insert into public.siparisler (
      id, musteri_id, olusturan_id, konusma_id, musteri_ad, musteri_telefon,
      musteri_adres, musteri_il, musteri_ilce, musteri_posta_kodu, siparis_no,
      siparis_tipi, durum, ara_toplam, kdv_toplam, kargo_ucreti, genel_toplam,
      kargo_takip_no, kargo_firmasi, teyit_durumu, teyit_tarihi, teyit_eden_id,
      notlar, iptal_nedeni, iade_nedeni, olusturma_tarihi, guncelleme_tarihi,
      kolaybi_siparis_id, ivr_bulk_id, ivr_tus, ivr_arama_durumu, ivr_arama_tarihi,
      kolaybi_contact_id, kolaybi_address_id, ivr_dinleme_suresi, kargo_yazdirildi,
      kargo_son_hareket, kargo_son_hareket_tarihi, kargoya_aktarilma_tarihi,
      efatura_durumu, sevk_edilme_tarihi, durum_oncelik, mukerrer,
      teyit_arama_deneme, kaynak, mukerrer_ad, at_disi
    ) values (
      '${orderId}', '${customerId}', '${userId}', '${conversationId}', 'İpek Öztürk',
      '+90 532 111 22 33', 'Bağdat Caddesi 42', 'İstanbul', 'Kadıköy', '34710',
      'GK-TR-1001', 'normal', 'olusturuldu', 30.00, 0.00, 0.00, 30.00,
      'TRK-IST-1', 'ptt', 'bekliyor', null, null, 'Kapıda teslim', null, null,
      '2024-01-02T03:04:05+03:00', null, null, null, null, null, null,
      null, null, null, false, null, null, null, null, null, null,
      false, 0, 'manuel', false, null
    );

    insert into public.siparis_kalemleri (
      id, siparis_id, stok_id, urun_adi, urun_kodu, miktar, birim, birim_fiyat,
      kdv_orani, toplam_fiyat, olusturma_tarihi, kolaybi_product_id
    ) values (
      '${orderItemId}', '${orderId}', null, 'Pamuklu Tişört XL', 'SKU-TR-XL', 1, 'adet',
      30.00, 0.00, 30.00, '2024-01-02T03:04:05+03:00', null
    );

    insert into public.kargo_gonderimleri (
      id, musteri_id, kargo_firmasi, takip_no, barkod_url, alici_ad, alici_telefon,
      alici_adres, alici_il, alici_ilce, alici_posta_kodu, gonderi_tipi, agirlik,
      desi, ucret, odeme_tipi, durum, notlar, olusturan_id, olusturma_tarihi,
      guncelleme_tarihi, alici_email, kargo_turu, tasima_sekli, teslim_sekli,
      adet, kapida_odeme_tutari, kargo_icerigi, son_hareket, son_hareket_tarihi,
      surat_web_siparis_kodu, surat_kargo_takip_no, surat_hesap_tipi, surat_barkod_no
    ) values (
      '${shipmentId}', '${customerId}', 'ptt', 'TRK-IST-1', null, 'İpek Öztürk',
      '+90 532 111 22 33', 'Bağdat Caddesi 42', 'İstanbul', 'Kadıköy', '34710',
      null, 1.5, null, 65.50, null, 'beklemede', null, null,
      '2024-01-02T03:04:05+03:00', null, null, null, null, null,
      1, null, 'tişört', null, null, null, null, null, null
    );
  `;
}

function seedCanonicalPrerequisites(container: string): void {
  executeSql(container, "canonical_target", `
    insert into users (public_id, role_id, email, password_hash, first_name, last_name, is_active)
    select 'usr_agent_1', roles.id, 'agent@example.test', 'hash', 'Destek', 'Ekibi', true
    from roles where roles.name = 'agent'
    on conflict (public_id) do nothing;
  `);
}

function targetCounts(container: string): string {
  return query(container, "canonical_target", `
    select concat_ws(':',
      (select count(*) from customers),
      (select count(*) from customer_addresses),
      (select count(*) from customer_external_identities),
      (select count(*) from conversations),
      (select count(*) from messages),
      (select count(*) from products),
      (select count(*) from orders),
      (select count(*) from order_items),
      (select count(*) from shipments),
      (select count(*) from migration_runs),
      (select count(*) from migration_batches),
      (select count(*) from legacy_id_map),
      (select count(*) from migration_deferred_reconciliations where status = 'pending')
    )
  `);
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
