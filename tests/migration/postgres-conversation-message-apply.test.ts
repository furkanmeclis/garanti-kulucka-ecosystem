import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyConversationMigrationBatchWithState,
  applyMessageMigrationBatchWithState,
} from "../../apps/migrator/src/apply.js";
import { calculateSourcePayloadChecksum } from "../../apps/migrator/src/legacy-source.js";
import { DatabaseMigrationTarget } from "../../apps/migrator/src/target.js";
import { createDatabase } from "../../packages/database/src/index.js";
import type { InlineMediaObject, MigratorMediaStorage } from "../../apps/migrator/src/media-storage.js";
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
const conversationOneId = "6f1c2b3a-4d5e-4f60-8172-93a4b5c6d7e8";
const conversationTwoId = "7f1c2b3a-4d5e-4f60-8172-93a4b5c6d7e8";
const messageOneId = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const messageTwoId = "2a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const messageThreeId = "3a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const messageFourId = "4a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const legacyMediaHash = "d".repeat(64);
const legacyMediaKey = `mesajlar/${legacyMediaHash}.jpg`;

describe("PostgreSQL conversation and message apply", () => {
  it("writes conversations/messages idempotently, resumes partial batches, resolves FKs, and preserves media/order", async () => {
    const container = `gk-conv-msg-${randomUUID().slice(0, 8)}`;
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
      const runId = "p4_conversation_message_apply";
      const registration = {
        runId,
        manifest: {
          sourceSystem: "legacy_postgres",
          databaseIdentity: { host: "127.0.0.1", port: "5432", database: "legacy_source" },
          tables: [],
          rowCounts: [
            { entity: "conversations", rows: 2 },
            { entity: "messages", rows: 4 },
          ],
          rowContentChecksums: [
            { entity: "conversations", rows: 2, checksum: "sha256:conversation-rows" },
            { entity: "messages", rows: 4, checksum: "sha256:message-rows" },
          ],
          batchSize: 1,
          mappingCatalogVersion: "p4-conversation-message-test",
          planFingerprint: "sha256:plan",
          sourceManifestHash: "sha256:manifest",
        },
      };
      await target.registerMigrationRun(registration);
      seedAppliedCustomerMap(container, runId);

      const conversationSource = new MemorySource([
        conversationRecord(conversationOneId),
        conversationRecord(conversationTwoId),
      ]);
      const accountSnapshot = [
        { publicId: "iac_whatsapp_main", providerKey: "whatsapp" as const, status: "active" as const, externalAccountId: null },
      ];
      const firstConversationBatch = batch("conversations", 1, 0, 1);
      const secondConversationBatch = batch("conversations", 2, 1, 1);

      await expect(applyConversationMigrationBatchWithState({
        runId,
        source: conversationSource,
        target,
        batch: firstConversationBatch,
        integrationAccounts: accountSnapshot,
      })).resolves.toMatchObject({ writtenRows: 1, idMapCreated: 1 });
      expect(targetCounts(container)).toBe("1:0:2");

      await expect(applyConversationMigrationBatchWithState({
        runId,
        source: conversationSource,
        target,
        batch: firstConversationBatch,
        integrationAccounts: accountSnapshot,
      })).resolves.toMatchObject({ writtenRows: 1, idMapCreated: 1 });
      expect(targetCounts(container)).toBe("1:0:2");

      await expect(applyConversationMigrationBatchWithState({
        runId,
        source: conversationSource,
        target,
        batch: secondConversationBatch,
        integrationAccounts: accountSnapshot,
      })).resolves.toMatchObject({ writtenRows: 1, idMapCreated: 1 });
      expect(targetCounts(container)).toBe("2:0:3");

      const messageSource = new MemorySource([
        messageRecord(messageTwoId, { medya_url: "https://cdn.example.test/a.jpg", medya_tipi: "image" }),
        messageRecord(messageOneId),
        messageRecord(messageThreeId, {
          media_url: "data:image/png;base64,aGVsbG8=",
          media_type: "image",
          gonderici_adi: "Ada",
        }),
        messageRecord(messageFourId, {
          media_url: `s3://gk-legacy-media/${legacyMediaKey}`,
          media_type: "image",
        }),
      ]);
      const mediaStorage = new FakeMediaStorage();
      await expect(applyMessageMigrationBatchWithState({
        runId,
        source: messageSource,
        target,
        batch: batch("messages", 1, 0, 4),
        mediaStorage,
      })).resolves.toMatchObject({ writtenRows: 8, idMapCreated: 4 });
      expect(mediaStorage.uploads).toEqual([{ sourceTable: "public.mesajlar", sourceId: messageThreeId }]);
      expect(mediaStorage.heads).toEqual([`gk-legacy-media/${legacyMediaKey}`]);
      expect(targetCounts(container)).toBe("2:4:7");

      // Idempotent rerun of the same batch keeps one files row per checksum and no extra uploads/rows.
      await expect(applyMessageMigrationBatchWithState({
        runId,
        source: messageSource,
        target,
        batch: batch("messages", 1, 0, 4),
        mediaStorage,
      })).resolves.toMatchObject({ writtenRows: 8 });
      expect(mediaStorage.uploads).toHaveLength(1);
      expect(targetCounts(container)).toBe("2:4:7");
      expect(query(container, "canonical_target", `
        select concat_ws(':', count(*), count(distinct f.checksum))
        from files f
      `)).toBe("2:2");
      expect(query(container, "canonical_target", `
        select concat_ws(':', f.bucket, f.object_key, f.mime_type, f.byte_size, f.checksum, f.upload_status, f.scan_status)
        from message_attachments attachment
        join files f on f.id = attachment.file_id
        join messages m on m.id = attachment.message_id
        join legacy_id_map map on map.target_id = m.public_id
        where map.run_id = '${runId}' and map.source_id = '${messageFourId}'
      `)).toBe(`gk-legacy-media:${legacyMediaKey}:image/jpeg:4096:sha256:${legacyMediaHash}:available:skipped`);
      expect(query(container, "canonical_target", `
        select concat_ws(':', raw_payload ? 'media_url', raw_payload->'media_storage'->>'bucket')
        from messages m
        join legacy_id_map map on map.target_id = m.public_id
        where map.run_id = '${runId}' and map.source_id = '${messageFourId}'
      `)).toBe("f:gk-legacy-media");

      expect(query(container, "canonical_target", `
        select count(*)
        from conversations c
        join customers customer on customer.id = c.customer_id
        join integration_accounts account on account.id = c.integration_account_id
        join integration_providers provider on provider.id = account.provider_id
        where customer.public_id = 'cus_0123456789abcdef01234567'
          and account.public_id = 'iac_whatsapp_main'
          and provider.key = c.channel
      `)).toBe("2");
      expect(query(container, "canonical_target", `
        select string_agg(map.source_id, ',' order by m.sent_at, map.source_id)
        from messages m
        join legacy_id_map map on map.target_table = 'messages' and map.target_id = m.public_id
        where map.run_id = '${runId}'
      `)).toBe(`${messageOneId},${messageTwoId},${messageThreeId},${messageFourId}`);
      expect(query(container, "canonical_target", `
        select raw_payload->>'medya_url'
        from messages m
        join legacy_id_map map on map.target_id = m.public_id
        where map.run_id = '${runId}' and map.source_id = '${messageTwoId}'
      `)).toBe("https://cdn.example.test/a.jpg");
      expect(query(container, "canonical_target", `
        select concat_ws(':', f.bucket, f.object_key, f.mime_type, f.byte_size, f.checksum, f.upload_status, f.scan_status)
        from message_attachments attachment
        join files f on f.id = attachment.file_id
        join messages m on m.id = attachment.message_id
        join legacy_id_map map on map.target_id = m.public_id
        where map.run_id = '${runId}' and map.source_id = '${messageThreeId}'
      `)).toBe("migration-media:legacy/hello.png:image/png:5:sha256:inline-test:available:skipped");
      expect(query(container, "canonical_target", `
        select raw_payload->'media_storage'->>'checksum'
        from messages m
        join legacy_id_map map on map.target_id = m.public_id
        where map.run_id = '${runId}' and map.source_id = '${messageThreeId}'
      `)).toBe("sha256:inline-test");

      executeSql(container, "canonical_target", `
        update integration_accounts
        set provider_id = (select id from integration_providers where key = 'instagram')
        where public_id = 'iac_whatsapp_main';
      `);
      await target.registerMigrationRun({ ...registration, runId: "p4_conversation_provider_mismatch" });
      seedAppliedCustomerMap(container, "p4_conversation_provider_mismatch");
      await expect(applyConversationMigrationBatchWithState({
        runId: "p4_conversation_provider_mismatch",
        source: new MemorySource([conversationRecord(conversationOneId)]),
        target,
        batch: firstConversationBatch,
        integrationAccounts: accountSnapshot,
      })).rejects.toThrow(
        "Conversation channel whatsapp does not match integration account iac_whatsapp_main provider instagram",
      );
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

class FakeMediaStorage implements MigratorMediaStorage {
  readonly uploads: Array<{ readonly sourceTable: string; readonly sourceId: string }> = [];
  readonly heads: string[] = [];

  async headObject(input: { readonly bucket: string; readonly objectKey: string }) {
    this.heads.push(`${input.bucket}/${input.objectKey}`);
    return input.bucket === "gk-legacy-media" && input.objectKey === legacyMediaKey ? { size: 4096 } : null;
  }

  async storeInlineDataUrl(input: {
    readonly dataUrl: string;
    readonly sourceTable: string;
    readonly sourceId: string;
  }): Promise<InlineMediaObject> {
    expect(input.dataUrl).toBe("data:image/png;base64,aGVsbG8=");
    this.uploads.push({ sourceTable: input.sourceTable, sourceId: input.sourceId });
    return {
      checksum: "sha256:inline-test",
      mimeType: "image/png",
      size: 5,
      bucket: "migration-media",
      objectKey: "legacy/hello.png",
    };
  }
}

function conversationRecord(id: string): LegacyRecord {
  const payload = {
    id,
    musteri_id: customerId,
    kanal: "whatsapp",
    kanal_konusma_id: `wa-thread-${id}`,
    atanan_kullanici_id: null,
    durum: "acik",
    son_mesaj_tarihi: "2024-03-04T05:06:07Z",
    okunmamis_sayisi: 1,
    olusturma_tarihi: "2024-03-04T05:00:00Z",
    guncelleme_tarihi: null,
    son_mesaj_text: "Merhaba",
    son_mesaj_gonderici: "musteri",
    ig_account_id: null,
    human_agent: false,
  };
  return legacyRow("public.konusmalar", id, payload);
}

function messageRecord(id: string, overrides: Record<string, unknown> = {}): LegacyRecord {
  const payload = {
    id,
    konusma_id: conversationOneId,
    gonderici_tipi: "musteri",
    gonderici_id: null,
    icerik: `body-${id}`,
    medya_url: null,
    medya_tipi: null,
    kanal_mesaj_id: `wamid.${id}`,
    okundu: false,
    olusturma_tarihi: "2024-03-04T05:06:07Z",
    ...overrides,
  };
  return legacyRow("public.mesajlar", id, payload);
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

function batch(entity: MigrationEntity, batchNumber: number, offset: number, expectedRows: number) {
  return { entity, batchNumber, limit: expectedRows, offset, expectedRows };
}

function seedPrerequisites(container: string): void {
  executeSql(container, "canonical_target", `
    insert into integration_providers (public_id, key, name, is_active)
    values ('prv_whatsapp', 'whatsapp', 'WhatsApp Cloud API', true)
    on conflict (key) do nothing;

    insert into integration_providers (public_id, key, name, is_active)
    values ('prv_instagram', 'instagram', 'Instagram Graph API', true)
    on conflict (key) do nothing;

    insert into customers (public_id, full_name, phone, email)
    values ('cus_0123456789abcdef01234567', 'Ada Lovelace', '+90 555 000 00 00', 'ada@example.test')
    on conflict (public_id) do nothing;

    insert into integration_accounts (public_id, provider_id, display_name, external_account_id, status, metadata)
    select 'iac_whatsapp_main', id, 'WhatsApp Main', 'wa-main', 'active', '{}'::jsonb
    from integration_providers where key = 'whatsapp'
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

function targetCounts(container: string): string {
  return query(container, "canonical_target", `
    select concat_ws(':',
      (select count(*) from conversations),
      (select count(*) from messages),
      (select count(*) from legacy_id_map)
    )
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
