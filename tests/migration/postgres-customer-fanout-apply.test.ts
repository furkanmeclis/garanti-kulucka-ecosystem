import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { applyCustomerMigrationBatchWithState } from "../../apps/migrator/src/apply.js";
import { calculateSourcePayloadChecksum, LegacyDatabaseSource } from "../../apps/migrator/src/legacy-source.js";
import { createLegacyMappingCatalog, legacyMappingCatalog } from "../../apps/migrator/src/mapping-catalog.js";
import { canonicalSourceTableMap, createLegacyPostgresTypeOverrides } from "../../apps/migrator/src/postgres-runtime.js";
import { runMigration } from "../../apps/migrator/src/orchestrator.js";
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

const customerOneId = "0a32ce63-4c3b-4fd4-917d-726d540a7216";
const customerTwoId = "1b42ce63-4c3b-4fd4-917d-726d540a7216";

describe("PostgreSQL customer fan-out apply", () => {
  it("writes customer fan-out rows idempotently, resumes a partial run, preserves FKs, and keeps dry-run empty", async () => {
    const container = `gk-customer-fanout-${randomUUID().slice(0, 8)}`;
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
    let sourceClient: Client | undefined;
    try {
      await waitForPostgres(container, "canonical_target");
      executeSql(container, "postgres", "create database legacy_source");
      for (const migration of await allCanonicalMigrations()) {
        executeSql(container, "canonical_target", await migrationSection(migration, "up"));
      }
      seedIntegrationAccounts(container);
      executeSql(container, "legacy_source", legacyCustomerSchemaSql());
      executeSql(container, "legacy_source", legacyCustomerFixtureSql());

      const customerOnlyCatalog = createLegacyMappingCatalog({
        ...legacyMappingCatalog,
        tables: [legacyMappingCatalog.tables[0]!],
      });
      sourceClient = new Client({
        connectionString: postgresUrl(container, "legacy_source"),
        types: createLegacyPostgresTypeOverrides(),
      });
      await sourceClient.connect();
      await expect(runMigration({
        mode: "dry-run",
        source: new LegacyDatabaseSource({
          db: {
            query: async (sql, parameters = []) => {
              const result = await sourceClient!.query(sql, [...parameters]);
              return { rows: result.rows };
            },
          },
          sourceSystem: "legacy_postgres",
          tables: canonicalSourceTableMap(customerOnlyCatalog),
          mappingCatalog: customerOnlyCatalog,
        }),
        mappingCatalog: customerOnlyCatalog,
        sourceSystem: "legacy_postgres",
        sourceDatabaseIdentity: { host: "127.0.0.1", port: "5432", database: "legacy_source" },
        batchSize: 1,
        entities: ["customers"],
        integrationAccounts: [
          { publicId: "iac_woocommerce_main", providerKey: "woocommerce", status: "active" },
          { publicId: "iac_kolaybi_main", providerKey: "kolaybi", status: "active" },
        ],
      })).resolves.toMatchObject({
        mode: "dry-run",
        dryRunReport: {
          customerTransform: {
            transformedRows: 2,
            addressDrafts: 2,
            resolvedIdentities: 4,
            unresolvedIdentities: 0,
          },
        },
      });
      expect(targetCounts(container)).toBe("0:0:0:0");

      db = createDatabase(postgresUrl(container, "canonical_target"));
      const target = new DatabaseMigrationTarget(db);
      const source = new CustomerSource([
        customerRecord(customerOneId, "Ada", "Lovelace", "kb-1", 1001),
        customerRecord(customerTwoId, "Grace", "Hopper", "kb-2", 1002),
      ]);
      const runId = "p4_customer_fanout";

      await target.registerMigrationRun({
        runId,
        manifest: {
          sourceSystem: "legacy_postgres",
          databaseIdentity: { host: "127.0.0.1", port: "5432", database: "legacy_source" },
          tables: [],
          rowCounts: [{ entity: "customers", rows: 2 }],
          rowContentChecksums: [{ entity: "customers", rows: 2, checksum: "sha256:rows" }],
          batchSize: 1,
          mappingCatalogVersion: "p4-customer-fanout-test",
          planFingerprint: "sha256:plan",
          sourceManifestHash: "sha256:manifest",
        },
      });

      const accountSnapshot = [
        { publicId: "iac_woocommerce_main", providerKey: "woocommerce" as const, status: "active" as const },
        { publicId: "iac_kolaybi_main", providerKey: "kolaybi" as const, status: "active" as const },
      ];
      const firstBatch = {
        entity: "customers" as const,
        batchNumber: 1,
        limit: 1,
        offset: 0,
        expectedRows: 1,
      };
      const secondBatch = { ...firstBatch, batchNumber: 2, offset: 1 };

      await expect(applyCustomerMigrationBatchWithState({
        runId,
        source,
        target,
        batch: firstBatch,
        integrationAccounts: accountSnapshot,
      })).resolves.toMatchObject({
        writtenRows: 4,
        idMapCreated: 4,
      });
      expect(targetCounts(container)).toBe("1:1:2:4");

      await expect(applyCustomerMigrationBatchWithState({
        runId,
        source,
        target,
        batch: firstBatch,
        integrationAccounts: accountSnapshot,
      })).resolves.toMatchObject({
        writtenRows: 4,
        idMapCreated: 4,
      });
      expect(targetCounts(container)).toBe("1:1:2:4");

      await expect(applyCustomerMigrationBatchWithState({
        runId,
        source,
        target,
        batch: secondBatch,
        integrationAccounts: accountSnapshot,
      })).resolves.toMatchObject({
        writtenRows: 4,
        idMapCreated: 4,
      });
      expect(targetCounts(container)).toBe("2:2:4:8");

      expect(query(container, "canonical_target", `
        select count(*)
        from customer_addresses a
        join customers c on c.id = a.customer_id
        where c.public_id like 'cus_%'
      `)).toBe("2");
      expect(query(container, "canonical_target", `
        select count(*)
        from customer_external_identities e
        join customers c on c.id = e.customer_id
        join integration_accounts i on i.id = e.integration_account_id
        where c.public_id like 'cus_%' and i.public_id in ('iac_woocommerce_main', 'iac_kolaybi_main')
      `)).toBe("4");
      expect(query(container, "canonical_target", `
        select string_agg(mapping_role, ',' order by mapping_role)
        from legacy_id_map
        where run_id = 'p4_customer_fanout' and source_id = '${customerOneId}'
      `)).toBe("address:default,external_identity:kolaybi,external_identity:woocommerce,primary");
    } finally {
      await db?.destroy();
      await sourceClient?.end();
      docker(["rm", "--force", container], true);
    }
  }, 180_000);
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

function customerRecord(
  id: string,
  firstName: string,
  lastName: string,
  kolaybiId: string,
  woocommerceId: number,
): LegacyRecord {
  const payload = {
    id,
    ad: firstName,
    soyad: lastName,
    email: `${firstName.toLowerCase()}@example.test`,
    telefon: "+90 555 000 00 00",
    adres: `${firstName} Sokak 1`,
    il: "Istanbul",
    ilce: "Kadikoy",
    posta_kodu: "34710",
    notlar: null,
    woocommerce_id: woocommerceId,
    kolaybi_id: kolaybiId,
    olusturma_tarihi: "2024-01-02T03:04:05Z",
    guncelleme_tarihi: null,
    username: firstName.toLowerCase(),
  };
  return {
    sourceSystem: "legacy_postgres",
    sourceTable: "public.musteriler",
    sourceId: id,
    payload,
    checksum: calculateSourcePayloadChecksum(payload),
  };
}

function seedIntegrationAccounts(container: string): void {
  executeSql(container, "canonical_target", `
    insert into integration_providers (public_id, key, name, is_active)
    values ('ipr_kolaybi', 'kolaybi', 'KolayBi', true)
    on conflict (key) do nothing;

    insert into integration_accounts (public_id, provider_id, display_name, external_account_id, status, metadata)
    select 'iac_woocommerce_main', id, 'WooCommerce Main', 'woo-main', 'active', '{}'::jsonb
    from integration_providers where key = 'woocommerce';

    insert into integration_accounts (public_id, provider_id, display_name, external_account_id, status, metadata)
    select 'iac_kolaybi_main', id, 'KolayBi Main', 'kb-main', 'active', '{}'::jsonb
    from integration_providers where key = 'kolaybi';
  `);
}

function legacyCustomerSchemaSql(): string {
  return `
    create table public.musteriler (
      id uuid not null,
      ad varchar not null,
      soyad varchar,
      email varchar,
      telefon varchar not null,
      adres text,
      il varchar,
      ilce varchar,
      posta_kodu varchar,
      notlar text,
      woocommerce_id integer,
      kolaybi_id varchar,
      olusturma_tarihi timestamptz,
      guncelleme_tarihi timestamptz,
      username text
    );
  `;
}

function legacyCustomerFixtureSql(): string {
  return `
    insert into public.musteriler (
      id, ad, soyad, email, telefon, adres, il, ilce, posta_kodu, notlar,
      woocommerce_id, kolaybi_id, olusturma_tarihi, guncelleme_tarihi, username
    ) values
      ('${customerOneId}', 'Ada', 'Lovelace', 'ada@example.test', '+90 555 000 00 00',
       'Ada Sokak 1', 'Istanbul', 'Kadikoy', '34710', null, 1001, 'kb-1',
       '2024-01-02T03:04:05Z', null, 'ada'),
      ('${customerTwoId}', 'Grace', 'Hopper', 'grace@example.test', '+90 555 000 00 02',
       'Grace Sokak 2', 'Istanbul', 'Kadikoy', '34710', null, 1002, 'kb-2',
       '2024-01-02T03:04:05Z', null, 'grace');
  `;
}

function targetCounts(container: string): string {
  return query(container, "canonical_target", `
    select concat_ws(':',
      (select count(*) from customers),
      (select count(*) from customer_addresses),
      (select count(*) from customer_external_identities),
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
