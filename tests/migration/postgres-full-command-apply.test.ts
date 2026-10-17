import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
      for (const migration of await allCanonicalMigrations()) {
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

describe("PostgreSQL command split thread merge E2E", () => {
  it("merges split legacy threads into one conversation, resumes after an interruption and verifies", async () => {
    const container = `gk-thread-merge-${randomUUID().slice(0, 8)}`;
    const tempDir = await mkdtemp(join(tmpdir(), "gk-thread-merge-"));
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
      executeSql(container, "legacy_source", splitThreadFixtureSql());
      executeSql(container, "postgres", "create database canonical_target");
      for (const migration of await allCanonicalMigrations()) {
        executeSql(container, "canonical_target", await migrationSection(migration, "up"));
      }
      seedCanonicalPrerequisites(container);
      executeSql(container, "canonical_target", `
        insert into integration_accounts (public_id, provider_id, display_name, status)
        select 'iac_whatsapp_main', providers.id, 'WhatsApp', 'active'
        from integration_providers providers where providers.key = 'whatsapp';
        -- Interrupt the first run at the first message write; dropping the flag lets the rerun resume.
        create table apply_interrupt_flag (armed boolean);
        insert into apply_interrupt_flag values (true);
        create function interrupt_message_apply() returns trigger language plpgsql as $$
        begin
          if exists (select 1 from apply_interrupt_flag) then
            raise exception 'interrupted for resume test';
          end if;
          return new;
        end $$;
        create trigger interrupt_message_apply before insert on messages
          for each row execute function interrupt_message_apply();
      `);

      const targetUrl = postgresUrl(container, "canonical_target");
      const evidenceFile = join(tempDir, "backup-evidence.json");
      const accountsFile = join(tempDir, "conversation-accounts.json");
      const userPublicIdsFile = join(tempDir, "user-public-ids.json");
      const dryRunReportFile = join(tempDir, "dry-run-report.json");
      const applyReportFile = join(tempDir, "apply-report.json");
      await writeFile(evidenceFile, JSON.stringify({
        targetDatabaseIdentity: { host: "127.0.0.1", port: new URL(targetUrl).port, database: "canonical_target" },
        createdAt: new Date().toISOString(),
      }));
      await writeFile(accountsFile, JSON.stringify([
        { publicId: "iac_whatsapp_main", providerKey: "whatsapp", status: "active", externalAccountId: null },
      ]));
      await writeFile(userPublicIdsFile, JSON.stringify({ [userId]: "usr_agent_1" }));
      const sourceEnv = {
        SOURCE_DATABASE_URL: postgresUrl(container, "legacy_source"),
        MIGRATION_BATCH_SIZE: "1",
        MIGRATION_CONVERSATION_ACCOUNTS_FILE: accountsFile,
        MIGRATION_USER_PUBLIC_IDS_FILE: userPublicIdsFile,
      };
      const applyEnv = {
        ...sourceEnv,
        TARGET_DATABASE_URL: targetUrl,
        MIGRATION_RUN_ID: "thread_merge_apply",
        MIGRATION_APPLY_ENABLED: "true",
        MIGRATION_BACKUP_EVIDENCE: evidenceFile,
      };

      await expect(runMigratorCommand("migrate:dry-run", sourceEnv, { reportFile: dryRunReportFile }))
        .resolves.toBeUndefined();
      const dryRun = JSON.parse(await readFile(dryRunReportFile, "utf8")) as {
        migration: { dryRunReport: { conversationMerge: Record<string, unknown>; totals: Record<string, number> } };
      };
      expect(dryRun.migration.dryRunReport.conversationMerge).toEqual({
        groups: 1,
        memberRows: 3,
        mergedAwayRows: 2,
        largestGroup: 3,
        groupsWithMultipleCustomers: 0,
        byChannel: { whatsapp: { groups: 1, memberRows: 3, mergedAwayRows: 2 } },
        messagesInMergedGroups: 4,
        messagesReassigned: 3,
      });
      expect(dryRun.migration.dryRunReport.totals.blockedRows).toBe(0);

      await expect(runMigratorCommand("migrate:apply", applyEnv)).rejects.toThrow("interrupted for resume test");
      expect(query(container, "canonical_target", "select count(*) from conversations")).toBe("2");
      expect(query(container, "canonical_target", "select count(*) from messages")).toBe("0");

      executeSql(container, "canonical_target", "delete from apply_interrupt_flag;");
      await expect(runMigratorCommand("migrate:apply", applyEnv, { reportFile: applyReportFile }))
        .resolves.toBeUndefined();
      const applyReport = JSON.parse(await readFile(applyReportFile, "utf8")) as Record<string, unknown>;
      expect(applyReport).toMatchObject({
        status: "passed",
        verification: { status: "passed" },
        migration: { conversationMerge: { groups: 1, memberRows: 3, mergedAwayRows: 2 } },
      });
      expect(JSON.stringify(applyReport)).toContain("legacy_id_map.merged_conversations");

      const winnerPublicId = query(container, "canonical_target", `
        select target_id from legacy_id_map where source_id = '${splitThreadIds.newest}' and mapping_role = 'primary'
      `);
      const assertMergedState = () => {
        expect(query(container, "canonical_target", "select count(*) from conversations")).toBe("2");
        expect(query(container, "canonical_target", `
          select concat_ws(':', unread_count, last_message_text, status)
          from conversations where public_id = '${winnerPublicId}'
        `)).toBe("6:En yeni:open");
        expect(query(container, "canonical_target", `
          select string_agg(messages.body, ',' order by messages.sent_at)
          from messages join conversations on conversations.id = messages.conversation_id
          where conversations.public_id = '${winnerPublicId}'
        `)).toBe("eski-1,eski-2,orta-1,yeni-1");
        expect(query(container, "canonical_target", "select count(*) from messages")).toBe("5");
        expect(query(container, "canonical_target", `
          select string_agg(target_id, ',' order by source_id) from legacy_id_map where mapping_role = 'merged_into'
        `)).toBe(`${winnerPublicId},${winnerPublicId}`);
        expect(query(container, "canonical_target", `
          select conversations.public_id from orders join conversations on conversations.id = orders.conversation_id
        `)).toBe(winnerPublicId);
      };
      assertMergedState();

      await expect(runMigratorCommand("migrate:apply", applyEnv)).resolves.toBeUndefined();
      assertMergedState();
      await expect(runMigratorCommand("verify", { TARGET_DATABASE_URL: targetUrl, MIGRATION_RUN_ID: "thread_merge_apply" }))
        .resolves.toBeUndefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      docker(["rm", "--force", container], true);
    }
  }, 180_000);
});

const splitThreadIds = {
  oldest: "7a000000-0000-4000-8000-000000000001",
  middle: "7a000000-0000-4000-8000-000000000002",
  newest: "7a000000-0000-4000-8000-000000000003",
} as const;

function splitThreadFixtureSql(): string {
  const conversation = (id: string, lastMessageAt: string, unread: number, status: string, text: string) => `
    ('${id}', '${customerId}', 'whatsapp', 'wa-split-thread', null, '${status}',
     '${lastMessageAt}', ${unread}, '2024-01-01T00:00:00+03:00', null, '${text}', 'musteri', null, false)`;
  const message = (id: string, conversation: string, body: string, sentAt: string) => `
    ('${id}', '${conversation}', 'musteri', null, '${body}', null, null, 'wamid.${id}', true, '${sentAt}')`;
  return `
    insert into public.konusmalar (
      id, musteri_id, kanal, kanal_konusma_id, atanan_kullanici_id, durum,
      son_mesaj_tarihi, okunmamis_sayisi, olusturma_tarihi, guncelleme_tarihi,
      son_mesaj_text, son_mesaj_gonderici, ig_account_id, human_agent
    ) values
      ${conversation(splitThreadIds.middle, "2024-02-02T00:00:00+03:00", 2, "kapali", "Orta")},
      ${conversation(splitThreadIds.oldest, "2024-02-01T00:00:00+03:00", 1, "beklemede", "Eski")},
      ${conversation(splitThreadIds.newest, "2024-02-03T00:00:00+03:00", 3, "acik", "En yeni")};

    insert into public.mesajlar (
      id, konusma_id, gonderici_tipi, gonderici_id, icerik, medya_url, medya_tipi,
      kanal_mesaj_id, okundu, olusturma_tarihi
    ) values
      ${message("8a000000-0000-4000-8000-000000000001", splitThreadIds.newest, "yeni-1", "2024-02-03T00:00:00+03:00")},
      ${message("8a000000-0000-4000-8000-000000000002", splitThreadIds.oldest, "eski-1", "2024-02-01T00:00:00+03:00")},
      ${message("8a000000-0000-4000-8000-000000000003", splitThreadIds.middle, "orta-1", "2024-02-02T00:00:00+03:00")},
      ${message("8a000000-0000-4000-8000-000000000004", splitThreadIds.oldest, "eski-2", "2024-02-01T00:30:00+03:00")};

    update public.siparisler set konusma_id = '${splitThreadIds.oldest}';
  `;
}

describe("PostgreSQL command customer identity accounts E2E", () => {
  it("fails the dry-run like apply without accounts, then resolves social identities from the conversation account file", async () => {
    const container = `gk-identity-accounts-${randomUUID().slice(0, 8)}`;
    const tempDir = await mkdtemp(join(tmpdir(), "gk-identity-accounts-"));
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
      executeSql(container, "legacy_source", `
        insert into public.musteriler (
          id, ad, soyad, email, telefon, adres, il, ilce, posta_kodu, notlar,
          woocommerce_id, kolaybi_id, olusturma_tarihi, guncelleme_tarihi, username
        ) values
          ('${socialCustomerIds[0]}', 'Ayşe', null, null, 'ig_17841400000000001', null, null, null, null, null,
           null, null, '2024-01-02T03:04:05+03:00', null, null),
          ('${socialCustomerIds[1]}', 'Çağrı', null, null, 'fb_2468013579', null, null, null, null, null,
           null, null, '2024-01-02T03:04:05+03:00', null, null);
      `);
      executeSql(container, "postgres", "create database canonical_target");
      for (const migration of await allCanonicalMigrations()) {
        executeSql(container, "canonical_target", await migrationSection(migration, "up"));
      }
      executeSql(container, "canonical_target", `
        insert into integration_accounts (public_id, provider_id, display_name, external_account_id, status)
        select account.public_id, providers.id, account.public_id, account.external_account_id, 'active'
        from (values
          ('iac_whatsapp_main', 'whatsapp', null),
          ('iac_messenger_main', 'messenger', null),
          ('iac_instagram_main', 'instagram', '17841400000000000')
        ) as account(public_id, provider_key, external_account_id)
        join integration_providers providers on providers.key = account.provider_key;
      `);

      const targetUrl = postgresUrl(container, "canonical_target");
      const evidenceFile = join(tempDir, "backup-evidence.json");
      const accountsFile = join(tempDir, "conversation-accounts.json");
      const dryRunReportFile = join(tempDir, "dry-run-report.json");
      await writeFile(evidenceFile, JSON.stringify({
        targetDatabaseIdentity: { host: "127.0.0.1", port: new URL(targetUrl).port, database: "canonical_target" },
        createdAt: new Date().toISOString(),
      }));
      await writeFile(accountsFile, JSON.stringify([
        { publicId: "iac_whatsapp_main", providerKey: "whatsapp", status: "active", externalAccountId: null },
        { publicId: "iac_messenger_main", providerKey: "messenger", status: "active", externalAccountId: null },
        { publicId: "iac_instagram_main", providerKey: "instagram", status: "active", externalAccountId: "17841400000000000" },
      ]));
      const sourceEnv = {
        SOURCE_DATABASE_URL: postgresUrl(container, "legacy_source"),
        MIGRATION_BATCH_SIZE: "1",
      };
      const applyEnv = {
        ...sourceEnv,
        TARGET_DATABASE_URL: targetUrl,
        MIGRATION_RUN_ID: "identity_accounts_apply",
        MIGRATION_APPLY_ENABLED: "true",
        MIGRATION_BACKUP_EVIDENCE: evidenceFile,
      };

      await expect(runMigratorCommand("migrate:dry-run", sourceEnv)).rejects.toThrow(
        "Customer external identity dry-run requires resolved integration accounts for providers: instagram, messenger",
      );
      await expect(runMigratorCommand("migrate:apply", applyEnv)).rejects.toThrow(
        "Customer external identity apply requires resolved integration accounts for providers: instagram",
      );
      expect(query(container, "canonical_target", "select count(*) from customers")).toBe("0");

      await expect(runMigratorCommand(
        "migrate:dry-run",
        { ...sourceEnv, MIGRATION_CONVERSATION_ACCOUNTS_FILE: accountsFile },
        { reportFile: dryRunReportFile },
      )).resolves.toBeUndefined();
      const dryRunReport = JSON.parse(await readFile(dryRunReportFile, "utf8")) as {
        migration: { dryRunReport: { customerTransform: Record<string, number> } };
      };
      expect(dryRunReport.migration.dryRunReport.customerTransform).toMatchObject({
        transformedRows: 2,
        resolvedIdentities: 2,
        unresolvedIdentities: 0,
      });

      await expect(runMigratorCommand(
        "migrate:apply",
        { ...applyEnv, MIGRATION_CONVERSATION_ACCOUNTS_FILE: accountsFile },
      )).resolves.toBeUndefined();
      expect(query(container, "canonical_target", `
        select string_agg(concat_ws(':', accounts.public_id, identities.external_id), ',' order by accounts.public_id)
        from customer_external_identities identities
        join integration_accounts accounts on accounts.id = identities.integration_account_id
      `)).toBe("iac_instagram_main:17841400000000001,iac_messenger_main:2468013579");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      docker(["rm", "--force", container], true);
    }
  }, 180_000);
});

const socialCustomerIds = [
  "5a000000-0000-4000-8000-000000000001",
  "5a000000-0000-4000-8000-000000000002",
] as const;

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
  if (column.dataType === "jsonb" && column.udtName === "jsonb") return "jsonb";
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

async function allCanonicalMigrations(): Promise<string[]> {
  return (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
}
