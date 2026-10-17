import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createDatabase } from "../../packages/database/src/index.js";
import { applyCommunicationMigrationBatchWithState } from "../../apps/migrator/src/communication-apply.js";
import { communicationFixture, inlineShortcutMedia, remoteShortcutMedia } from "../../apps/migrator/test/communication-fixtures.js";
import { startShortcutMediaServer } from "../../apps/migrator/test/shortcut-media-fixtures.js";
import { S3MigratorMediaStorage } from "../../apps/migrator/src/media-storage.js";
import { DatabaseMigrationTarget } from "../../apps/migrator/src/target.js";
import { communicationTableMappings } from "../../apps/migrator/src/communication-catalog.js";
import { createLegacyMappingCatalog } from "../../apps/migrator/src/mapping-catalog.js";
import { runMigration } from "../../apps/migrator/src/orchestrator.js";
import { createMigrationApplyApproval } from "../../apps/migrator/src/apply-approval.js";
import { createTargetVerificationSnapshot } from "../../apps/migrator/src/target-snapshot.js";
import { createMigrationVerificationReport } from "../../apps/migrator/src/verify.js";
import { Client } from "pg";
import type { LegacyRecord, LegacySource, MigrationEntity } from "../../apps/migrator/src/types.js";
const migrationsDirectory = fileURLToPath(new URL("../../packages/database/migrations/", import.meta.url));

class Source implements LegacySource {
  readCalls = 0;
  constructor(private readonly rows: Partial<Record<MigrationEntity, LegacyRecord[]>>) {}
  async count(entity: MigrationEntity) { return this.rows[entity]?.length ?? 0; }
  async readBatch(entity: MigrationEntity, options: { limit: number; offset?: number }) {
    this.readCalls++;
    return (this.rows[entity] ?? []).slice(options.offset ?? 0, (options.offset ?? 0) + options.limit);
  }
  async describeTables(entities: readonly MigrationEntity[]) {
    return entities.map((entity) => {
      const mapping = communicationTableMappings.find((m) => m.targetEntities[0]?.entity === entity)!;
      return { entity, schema: "public", table: mapping.sourceTable.split(".")[1]!, idColumn: "id",
        columns: mapping.columns.map((c, i) => ({ ...c, ordinalPosition: i + 1 })) };
    });
  }
}

describe("PostgreSQL shortcut/SMS/VAPI apply", () => {
  it("applies media and history, adopts seeded shortcuts, verifies, resumes and reruns without duplicates", async () => {
    const container = `gk-communication-${randomUUID().slice(0, 8)}`;
    docker(["run", "--detach", "--rm", "--name", container, "--publish", "127.0.0.1::5432", "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=canonical_target", "postgres:18-alpine"]);
    const server = await startShortcutMediaServer();
    vi.stubEnv("MIGRATION_SHORTCUT_MEDIA_BASE_URL", server.url);
    let db: ReturnType<typeof createDatabase> | undefined;
    let client: Client | undefined;
    try {
      await waitForPostgres(container, "canonical_target");
      for (const migration of await allCanonicalMigrations()) executeSql(container, "canonical_target", await migrationSection(migration, "up"));
      db = createDatabase(postgresUrl(container, "canonical_target"));
      client = new Client({ connectionString: postgresUrl(container, "canonical_target") });
      await client.connect();
      const target = new DatabaseMigrationTarget(db);
      const catalog = createLegacyMappingCatalog({ version: "communication-test", tables: communicationTableMappings });
      const missingShipmentId = "c1000000-0000-4000-8000-000000000099";
      const source = new Source({
        message_shortcuts: [communicationFixture("message_shortcuts", { medyalar: [inlineShortcutMedia, remoteShortcutMedia] }),
          communicationFixture("message_shortcuts", { id: "a1000000-0000-4000-8000-000000000002", kod: "custom_fixture", tip: "custom", aktif: true, sira: 2 })],
        sms_messages: [communicationFixture("sms_messages", { kargo_id: missingShipmentId })],
        vapi_calls: [communicationFixture("vapi_calls", { transkript: [{ role: "user", text: "fixture" }], maliyet: "0.1234", sure_sn: 42 })],
      });
      const base = { source, mappingCatalog: catalog, batchSize: 1, sourceSystem: "legacy_postgres",
        sourceDatabaseIdentity: { host: "127.0.0.1", port: "5440", database: "legacy_fixture" } };
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const dry = await runMigration({ ...base, mode: "dry-run" });
      expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore();
      expect(dry.dryRunReport?.communicationTransforms?.message_shortcuts).toMatchObject({ sourceRows: 2, mediaItems: 2, inlineMediaBytes: 5, remoteMediaUrls: 1, inactiveRows: 1 });
      expect(query(container, "canonical_target", "select count(*) from sms_messages")).toBe("0");
      const runId = "communication_apply";
      const approval = createMigrationApplyApproval({ runId, targetDatabaseIdentity: { host: "127.0.0.1", port: new URL(postgresUrl(container, "canonical_target")).port, database: "canonical_target" }, backupEvidenceCreatedAt: new Date().toISOString() });
      const input = { ...base, mode: "apply" as const, target, runId, applyApproval: approval };
      await expect(runMigration(input)).rejects.toThrow("MIGRATION_MEDIA_S3_*");
      expect(query(container, "canonical_target", "select count(*) from legacy_id_map")).toBe("0");
      expect(query(container, "canonical_target", "select count(*) from migration_batches where status='failed'")).toBe("1");
      const mediaStorage = new S3MigratorMediaStorage({ endpoint: server.url, region: "garage", accessKeyId: "fixture", secretAccessKey: "fixture", bucket: "media", prefix: "legacy-migration" });
      const applied = await runMigration({ ...input, mediaStorage });
      expect(applied.batches.flatMap((b) => b.warnings).filter((w) => w.code === "unresolved_optional_shipment")).toHaveLength(1);
      expect(query(container, "canonical_target", "select concat_ws(':',public_id,type,is_active,sort_order,to_char(created_at,'US')) from message_shortcuts where code='ss'"))
        .toBe("msc_default_ss:default:f:7:123456");
      expect(query(container, "canonical_target", "select concat_ws(':',count(*),sum(byte_size),count(*) filter(where upload_status='available' and scan_status='skipped')) from files"))
        .toBe("2:22:2");
      expect(query(container, "canonical_target", "select string_agg(attachment_type||':'||sort_order,',' order by sort_order) from message_shortcut_attachments"))
        .toBe("image:0,document:1");
      expect(query(container, "canonical_target", "select concat_ws(':',status,queued,shipment_id is null) from sms_messages")).toBe("sent:f:t");
      expect(query(container, "canonical_target", "select concat_ws(':',status,cost,duration_seconds,jsonb_array_length(transcript),queued) from vapi_calls"))
        .toBe("basladi:0.1234:42:1:f");
      const snapshot = await createTargetVerificationSnapshot(client, runId);
      expect(createMigrationVerificationReport(snapshot)).toMatchObject({ status: "passed" });
      const counts = () => query(container, "canonical_target", "select concat_ws(':',(select count(*) from message_shortcuts),(select count(*) from message_shortcut_attachments),(select count(*) from files),(select count(*) from sms_messages),(select count(*) from vapi_calls),(select count(*) from legacy_id_map))");
      const firstCounts = counts();
      await runMigration({ ...input, mediaStorage });
      expect(counts()).toBe(firstCounts);
      expect(server.requests.filter((r) => r.method === "PUT")).toHaveLength(2);
      // Remove successful batch markers to force all writers and storage HEADs through a real rerun.
      executeSql(container, "canonical_target", "delete from migration_batches");
      const rerun = await runMigration({ ...input, mediaStorage });
      expect(counts()).toBe(firstCounts);
      expect(rerun.batches.reduce((n, b) => n + b.idMapUnchanged, 0)).toBe(8);
      expect(server.requests.filter((r) => r.method === "PUT")).toHaveLength(2);
      expect(createMigrationVerificationReport(await createTargetVerificationSnapshot(client, runId)).status).toBe("passed");
      // A resolvable legacy shipment binds to the numeric target FK; no provider job is queued.
      executeSql(container, "canonical_target", `insert into shipments(public_id,provider,status,recipient_name,recipient_phone,recipient_address,recipient_city,recipient_district) values('shp_fixture','ptt','created','Fixture','5551112233','Address','City','District');
        insert into legacy_id_map(run_id,source_system,source_table,source_id,target_table,mapping_role,target_id) values('${runId}','legacy_postgres','public.kargo_gonderimleri','${missingShipmentId}','shipments','primary','shp_fixture')`);
      executeSql(container, "canonical_target", "delete from migration_batches where entity in ('sms_messages','vapi_calls')");
      await applyCommunicationMigrationBatchWithState({ source, target, runId, batch: { entity: "sms_messages", batchNumber: 1, limit: 1, offset: 0, expectedRows: 1 } });
      expect(query(container, "canonical_target", "select s.public_id from sms_messages m join shipments s on s.id=m.shipment_id")).toBe("shp_fixture");
      const vapiSource = new Source({ vapi_calls: [communicationFixture("vapi_calls", { kargo_id: missingShipmentId })] });
      await applyCommunicationMigrationBatchWithState({ source: vapiSource, target, runId, batch: { entity: "vapi_calls", batchNumber: 1, limit: 1, offset: 0, expectedRows: 1 } });
      expect(query(container, "canonical_target", "select s.public_id from vapi_calls m join shipments s on s.id=m.shipment_id")).toBe("shp_fixture");
    } finally {
      await client?.end(); await db?.destroy(); await server.close(); vi.unstubAllEnvs(); docker(["rm", "--force", container], true);
    }
  }, 180_000);
  it("applies legacy call logs with mapped user/order and phone customer, verifies and reruns idempotently", async () => {
    const container = `gk-migrator-calls-${randomUUID().slice(0, 8)}`;
    docker(["run", "--detach", "--rm", "--name", container, "--publish", "127.0.0.1::5432",
      "--env", "POSTGRES_PASSWORD=postgres", "--env", "POSTGRES_DB=canonical_target", "postgres:18-alpine"]);
    let db: ReturnType<typeof createDatabase> | undefined;
    let client: Client | undefined;
    const runId = "legacy_calls_apply";
    const userId = "c1000000-0000-4000-8000-000000000001";
    const orderId = "c1000000-0000-4000-8000-000000000002";
    try {
      await waitForPostgres(container, "canonical_target");
      for (const migration of await allCanonicalMigrations()) executeSql(container, "canonical_target", await migrationSection(migration, "up"));
      executeSql(container, "canonical_target", `
        insert into users(public_id,role_id,email,password_hash,first_name,last_name)
          select 'usr_fixture',id,'fixture@example.test','hash','Fixture','User' from roles where name='agent';
        insert into customers(public_id,full_name,phone) values('cus_fixture','Fixture','0555 111 22 33');
        insert into orders(public_id,order_number,customer_id) select 'ord_fixture','FIXTURE-1',id from customers where public_id='cus_fixture';
      `);
      db = createDatabase(postgresUrl(container, "canonical_target"));
      client = new Client({ connectionString: postgresUrl(container, "canonical_target") }); await client.connect();
      const target = new DatabaseMigrationTarget(db);
      const source = new Source({ call_logs: [
        communicationFixture("call_logs", { kullanici_id: userId, siparis_id: orderId, notlar: "Fixture note", sure_sn: 42, bitis: "2024-01-02T03:04:47Z" }),
        communicationFixture("call_logs", { id: "a1000000-0000-4000-8000-000000000002", kullanici_id: orderId, siparis_id: userId, musteri_telefon: "5559998877", durum: "hata" }),
        communicationFixture("call_logs", { id: "a1000000-0000-4000-8000-000000000003", musteri_telefon: "5558887766", durum: "cevapsiz" }),
      ] });
      const base = { source, target, runId, batchSize: 2, sourceSystem: "legacy_postgres",
        sourceDatabaseIdentity: { host: "127.0.0.1", port: "5440", database: "legacy_fixture" },
        mappingCatalog: createLegacyMappingCatalog({ version: "legacy-calls-test", tables: communicationTableMappings.filter((m) => m.sourceTable === "public.arama_kayitlari") }),
        userPublicIds: new Map([[userId, "usr_fixture"]]) };
      const dry = await runMigration({ ...base, mode: "dry-run" });
      expect(dry.dryRunReport?.communicationTransforms?.call_logs).toMatchObject({ sourceRows: 3, linkedUsers: 1, unresolvedUsers: 1, unresolvedOrders: 2 });
      expect(query(container, "canonical_target", "select count(*) from call_logs")).toBe("0");
      const approval = createMigrationApplyApproval({ runId, targetDatabaseIdentity: { host: "127.0.0.1", port: new URL(postgresUrl(container, "canonical_target")).port, database: "canonical_target" }, backupEvidenceCreatedAt: new Date().toISOString() });
      const input = { ...base, mode: "apply" as const, applyApproval: approval };
      const beforeReads = source.readCalls;
      const applied = await runMigration(input);
      expect(source.readCalls - beforeReads).toBe(2);
      expect(applied.sourceManifest).toEqual(dry.sourceManifest);
      expect(applied.batches.reduce((n, b) => n + b.writtenRows, 0)).toBe(3);
      const warnings = applied.batches.flatMap((b) => b.warnings);
      expect(warnings.filter((w) => w.code === "unresolved_optional_order")).toHaveLength(2);
      expect(warnings.filter((w) => w.code === "unresolved_optional_user")).toHaveLength(1);
      expect(warnings.filter((w) => w.code === "unresolved_optional_customer")).toHaveLength(2);
      expect(query(container, "canonical_target", `select concat_ws(':',h.source,h.direction,h.status,h.talk_seconds,u.public_id,c.public_id,coalesce(o.public_id,'null'),
        h.raw_payload->>'notlar',to_char(h.created_at,'US'),h.raw_payload->>'kullanici_id',jsonb_array_length(h.events))
        from call_logs h left join users u on u.id=h.user_id left join customers c on c.id=h.customer_id left join orders o on o.id=h.order_id
        where h.raw_payload->>'id'='a1000000-0000-4000-8000-000000000001'`))
        .toBe(`legacy:outbound:answered:42:usr_fixture:cus_fixture:null:Fixture note:123456:${userId}:0`);
      expect(query(container, "canonical_target", "select count(*) from call_logs where status='missed'")).toBe("1");
      expect(query(container, "canonical_target", "select count(*) from legacy_id_map where source_table='public.arama_kayitlari' and target_table='call_logs' and mapping_role='primary'")).toBe("3");
      const verify = () => createTargetVerificationSnapshot(client!, runId).then(createMigrationVerificationReport);
      expect((await verify()).checks.filter((check) => check.status === "failed")).toEqual([]);
      await runMigration(input);
      expect(query(container, "canonical_target", "select count(*) from call_logs")).toBe("3");
      executeSql(container, "canonical_target", "delete from migration_batches");
      const rerun = await runMigration(input);
      expect(rerun.batches.reduce((n, b) => n + b.idMapUnchanged, 0)).toBe(3);
      expect(query(container, "canonical_target", "select count(*) from call_logs")).toBe("3");
      expect((await verify()).checks.filter((check) => check.status === "failed")).toEqual([]);
      executeSql(container, "canonical_target", "update call_logs set source='softphone' where status='missed'");
      expect((await verify()).checks.find((c) => c.name === "referential_integrity.call_logs")?.status).toBe("failed");
      executeSql(container, "canonical_target", "update call_logs set source='legacy'");
      // Isolated FK writer check after the complete run's coverage/idempotency verification above.
      executeSql(container, "canonical_target", `insert into legacy_id_map(run_id,source_system,source_table,source_id,target_table,mapping_role,target_id)
        values('${runId}','legacy_postgres','public.siparisler','${orderId}','orders','primary','ord_fixture');
        delete from migration_batches where entity='call_logs'`);
      await applyCommunicationMigrationBatchWithState({ source, target, runId, userPublicIds: base.userPublicIds,
        batch: { entity: "call_logs", batchNumber: 1, limit: 2, offset: 0, expectedRows: 2 } });
      expect(query(container, "canonical_target", "select o.public_id from call_logs h join orders o on o.id=h.order_id")).toBe("ord_fixture");
    } finally { await client?.end(); await db?.destroy(); docker(["rm", "--force", container], true); }
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
