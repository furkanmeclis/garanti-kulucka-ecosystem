import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { LegacyDatabaseSource, type LegacyQueryDatabase } from "../../apps/migrator/src/legacy-source.js";
import { assertShipmentTrackingEventRowAccounting } from "../../apps/migrator/src/orchestrator.js";
import { createMigrationPlan } from "../../apps/migrator/src/plan.js";
import { createLegacyPostgresTypeOverrides } from "../../apps/migrator/src/postgres-runtime.js";
import { withReadonlyRepeatableReadTransaction } from "../../apps/migrator/src/source-transaction.js";
import type { LegacyRecord, LegacySource, MigrationEntity } from "../../apps/migrator/src/types.js";

const shipmentA = "c1000000-0000-4000-8000-00000000000a";
const shipmentB = "c1000000-0000-4000-8000-00000000000b";
const shipmentC = "c1000000-0000-4000-8000-00000000000c";

describe("PostgreSQL legacy source paging", () => {
  it("reads identical tracking events and plain rows through the snapshot cursor/keyset path as through OFFSET", async () => {
    const container = `gk-migrator-paging-${randomUUID().slice(0, 8)}`;
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
      executeSql(container, fixtureSql());

      const tables = {
        customers: { tableName: "public.musteriler", idColumn: "id" },
        shipment_tracking_events: { tableName: "public.kargo_takip", idColumn: "id" },
      } as const;
      const entities: MigrationEntity[] = ["customers", "shipment_tracking_events"];

      const offsetRun = await inSourceTransaction(container, (db) => readEverything(new LegacyDatabaseSource({
        db,
        sourceSystem: "legacy_postgres",
        tables,
      }), entities, 7));
      const snapshotRun = await inSourceTransaction(container, (db) => readEverything(new LegacyDatabaseSource({
        db,
        sourceSystem: "legacy_postgres",
        tables,
        repeatableReadSnapshot: true,
      }), entities, 7));

      // Regression: the cursor/keyset path yields exactly the same records (ids, payloads, checksums) and plan.
      expect(snapshotRun.counts).toEqual(offsetRun.counts);
      expect(snapshotRun.records).toEqual(offsetRun.records);
      expect(snapshotRun.accounting).toEqual(offsetRun.accounting);
      expect(snapshotRun.counts.customers).toBe(50);
      expect(new Set(snapshotRun.records.customers?.map((record) => record.sourceId)).size).toBe(50);
      expect(snapshotRun.sql.filter((sql) => sql.includes("offset $2"))).toEqual([]);
      expect(snapshotRun.sql.filter((sql) => sql.startsWith("declare "))).toHaveLength(1);
      expect(snapshotRun.sql.some((sql) => sql.includes("insert_time_row_count") && !sql.startsWith("declare ")))
        .toBe(false);

      // Hand-built fixture: every raw row is in exactly one bucket.
      const events = snapshotRun.records.shipment_tracking_events ?? [];
      const transformedRows = events.reduce((sum, record) => sum + Number(record.payload.raw_row_count), 0);
      const accounting = snapshotRun.accounting!;
      expect(accounting).toEqual({ sourceRows: 15 + 500, supersededInsertTimeRows: 4 + 200, undatedRows: 1 });
      expect(transformedRows).toBe(10 + 300);
      expect(() => assertShipmentTrackingEventRowAccounting(transformedRows, accounting)).not.toThrow();
      const byTimeSource = countBy(events, (record) => String(record.payload.time_source));
      expect(byTimeSource).toEqual({ provider: 4 + 100, first_seen: 1 + 100, future_excluded: 2 });
      expect(events.find((record) => record.payload.time_source === "first_seen" && record.payload.kargo_id === shipmentB)
        ?.payload.raw_row_count).toBe(3);
    } finally {
      docker(["rm", "--force", container], true);
    }
  }, 180_000);
});

interface ReadEverythingResult {
  readonly counts: Partial<Record<MigrationEntity, number>>;
  readonly records: Partial<Record<MigrationEntity, LegacyRecord[]>>;
  readonly accounting: Awaited<ReturnType<NonNullable<LegacySource["describeShipmentTrackingEventSourceRows"]>>> | null;
  readonly sql: string[];
}

async function readEverything(
  source: LegacyDatabaseSource,
  entities: MigrationEntity[],
  batchSize: number,
): Promise<Omit<ReadEverythingResult, "sql">> {
  const plan = await createMigrationPlan({ source, mode: "dry-run", batchSize, entities });
  const records: Partial<Record<MigrationEntity, LegacyRecord[]>> = {};
  // Two passes, as apply does (row-content checksum pass, then the batch pass).
  for (let pass = 0; pass < 2; pass += 1) {
    for (const batch of plan.batches) {
      const rows = await source.readBatch(batch.entity, { limit: batch.limit, offset: batch.offset });
      expect(rows).toHaveLength(batch.expectedRows);
      if (pass === 0) (records[batch.entity] ??= []).push(...rows);
    }
  }
  return {
    counts: Object.fromEntries(plan.entities.map((entity) => [entity.entity, entity.totalRows])),
    records,
    accounting: await source.describeShipmentTrackingEventSourceRows(),
  };
}

async function inSourceTransaction(
  container: string,
  read: (db: LegacyQueryDatabase) => Promise<Omit<ReadEverythingResult, "sql">>,
): Promise<ReadEverythingResult> {
  const client = new Client({ connectionString: postgresUrl(container), types: createLegacyPostgresTypeOverrides() });
  const sql: string[] = [];
  const db: LegacyQueryDatabase = {
    async query(text, parameters = []) {
      sql.push(text.trim());
      const result = await client.query(text, [...parameters]);
      return { rows: result.rows };
    },
  };
  const result = await withReadonlyRepeatableReadTransaction(client, () => read(db));
  return { ...result, sql };
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1;
  return counts;
}

function fixtureSql(): string {
  return `
    create table public.musteriler (id uuid primary key, ad text);
    insert into public.musteriler (id, ad)
    select md5('customer-' || n)::uuid, 'Musteri ' || n from generate_series(1, 50) n;

    create table public.kargo_takip (
      id uuid primary key,
      kargo_id uuid,
      durum varchar(100) not null,
      aciklama text,
      lokasyon varchar(200),
      tarih timestamptz
    );

    insert into public.kargo_takip (id, kargo_id, durum, aciklama, lokasyon, tarih) values
      -- Group A1: one provider-time row and four insert-time copies (superseded).
      (md5('a1-p')::uuid, '${shipmentA}', 'Yolda', null, 'Ankara', '2024-01-03T03:04:05Z'),
      (md5('a1-c1')::uuid, '${shipmentA}', 'Yolda', null, 'Ankara', '2024-01-03T04:00:00.123Z'),
      (md5('a1-c2')::uuid, '${shipmentA}', 'Yolda', null, 'Ankara', '2024-01-03T05:00:00.456Z'),
      (md5('a1-c3')::uuid, '${shipmentA}', 'Yolda', null, 'Ankara', '2024-01-03T06:00:00.789Z'),
      (md5('a1-c4')::uuid, '${shipmentA}', 'Yolda', null, 'Ankara', '2024-01-03T07:00:00.001Z'),
      -- Group A2: two provider-time rows in the same second (one event, raw 2) and one in another second.
      (md5('a2-p1')::uuid, '${shipmentA}', 'Teslim edildi', 'Imza', 'Istanbul', '2024-01-04T03:04:05Z'),
      (md5('a2-p2')::uuid, '${shipmentA}', 'Teslim edildi', 'Imza', 'Istanbul', '2024-01-04T03:04:05Z'),
      (md5('a2-p3')::uuid, '${shipmentA}', 'Teslim edildi', 'Imza', 'Istanbul', '2024-01-05T03:04:05Z'),
      -- Group B: insert-time copies only (first_seen, raw 3).
      (md5('b-c1')::uuid, '${shipmentB}', 'Kabul', null, null, '2024-02-01T01:00:00.500Z'),
      (md5('b-c2')::uuid, '${shipmentB}', 'Kabul', null, null, '2024-02-01T02:00:00.500Z'),
      (md5('b-c3')::uuid, '${shipmentB}', 'Kabul', null, null, '2024-02-01T03:00:00.500Z'),
      -- Future rows are markers, one per row.
      (md5('c-f1')::uuid, '${shipmentC}', 'Yolda', null, null, now() + interval '2 days'),
      (md5('c-f2')::uuid, '${shipmentC}', 'Yolda', null, null, now() + interval '3 days 0.5 seconds'),
      -- Group without a shipment, provider time.
      (md5('n-p')::uuid, null, 'Bilinmiyor', null, null, '2024-03-01T00:00:00Z'),
      -- Undated row: no event.
      (md5('u-1')::uuid, '${shipmentC}', 'Yolda', null, null, null);

    -- Bulk: 100 groups with one provider-time row and two superseded copies, 100 first_seen groups with two copies.
    insert into public.kargo_takip (id, kargo_id, durum, aciklama, lokasyon, tarih)
    select md5('bulk-p-' || n || '-' || copy)::uuid, md5('ship-' || n)::uuid, 'Dagitimda', 'Kurye ' || n, 'Izmir',
      timestamptz '2024-05-01T00:00:00Z' + n * interval '1 minute'
        + case when copy = 0 then interval '0' else copy * interval '1 hour' + interval '0.25 seconds' end
    from generate_series(1, 100) n, generate_series(0, 2) copy;
    insert into public.kargo_takip (id, kargo_id, durum, aciklama, lokasyon, tarih)
    select md5('bulk-f-' || n || '-' || copy)::uuid, md5('ship-' || n)::uuid, 'Subede', null, 'Bursa',
      timestamptz '2024-06-01T00:00:00Z' + n * interval '1 minute' + copy * interval '1 hour' + interval '0.75 seconds'
    from generate_series(1, 100) n, generate_series(1, 2) copy;
  `;
}

async function waitForPostgres(container: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      docker(["exec", container, "psql", "--username", "postgres", "--dbname", "garanti_kulucka", "--command", "SELECT 1"]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("PostgreSQL test container did not become ready");
}

function postgresUrl(container: string): string {
  const port = docker(["port", container, "5432/tcp"]).trim().split(":").pop();
  if (!port) throw new Error("PostgreSQL test container did not publish a host port");
  return `postgres://postgres:postgres@127.0.0.1:${port}/garanti_kulucka`;
}

function executeSql(container: string, sql: string): string {
  return docker([
    "exec",
    "--interactive",
    container,
    "psql",
    "--username",
    "postgres",
    "--dbname",
    "garanti_kulucka",
    "--set",
    "ON_ERROR_STOP=1",
    "--no-psqlrc",
  ], false, sql);
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
