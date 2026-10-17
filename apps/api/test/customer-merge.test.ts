import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, sql, type AppDatabase } from "@garanti-kulucka/database";
import { CustomerMergeRepository, customerMergeRelations } from "../src/domain/customer-merge.js";

const migrations = fileURLToPath(new URL("../../../packages/database/migrations/", import.meta.url));
const files = readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort();

it("handles every FK to customers declared in canonical migrations", () => {
  const relations: string[] = [];
  for (const file of files) {
    const up = readFileSync(`${migrations}/${file}`, "utf8").split(/-- Down Migration/i)[0]!;
    const statements = up.replace(/--[^\n]*/g, "").split(";");
    for (const statement of statements) {
      if (!/REFERENCES\s+(?:public\.)?customers\s*\(/i.test(statement)) continue;
      const table = statement.match(/(?:CREATE|ALTER)\s+TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?(\w+)/i)?.[1];
      expect(table, `Unrecognized customer FK in ${file}`).toBeTruthy();
      for (const _reference of statement.matchAll(/REFERENCES\s+(?:public\.)?customers\s*\(/gi)) relations.push(table!);
    }
  }
  expect(relations.sort()).toEqual([...customerMergeRelations].sort());
});

// Like call-logs-postgres.test.ts, only an explicitly selected local test server is allowed.
const externalUrl = process.env.CUSTOMER_MERGE_TEST_DATABASE_URL;
const localPostgres = externalUrl && ["127.0.0.1", "localhost"].includes(new URL(externalUrl).hostname) ? describe : describe.skip;
localPostgres("customer merge on local PostgreSQL", () => {
  let db: AppDatabase;
  let client: Client;
  const databaseName = `merge_${randomUUID().replaceAll("-", "")}`;
  let admin: Client | undefined;
  beforeAll(async () => {
    admin = new Client({ connectionString: externalUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${databaseName}`);
    const testUrl = new URL(externalUrl!);
    testUrl.pathname = `/${databaseName}`;
    client = new Client({ connectionString: testUrl.toString() });
    await client.connect();
    for (const file of files) await client.query(readFileSync(`${migrations}/${file}`, "utf8").split(/-- Down Migration/i)[0]!);
    db = createDatabase(testUrl.toString());
  }, 90_000);
  afterAll(async () => {
    await db?.destroy();
    await client?.end();
    try { await admin?.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`); } finally { await admin?.end(); }
  }, 60_000);
  beforeEach(async () => {
    await client.query("TRUNCATE customers CASCADE; TRUNCATE audit_logs; TRUNCATE legacy_id_map;");
    await client.query(`INSERT INTO customers(public_id,full_name,phone,email,notes) VALUES
      ('cus_target','Ayşe Yılmaz',NULL,'target@example.com','Target note'),
      ('cus_source','Ayşe Yılmaz','+90 (555) 111-2233','source@example.com','Source note')`);
  });

  it("covers each live FK column, including additional customer columns on existing tables", async () => {
    const result = await client.query(`select t.relname as table_name, a.attname as column_name
      from pg_constraint c join pg_class t on t.oid=c.conrelid
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
      where c.contype='f' and c.confrelid='customers'::regclass`);
    expect(result.rows.map((row) => `${row.table_name}.${row.column_name}`).sort())
      .toEqual(customerMergeRelations.map((table) => `${table}.customer_id`).sort());
  });

  it("fills blank name and email and retains a source default when target has none", async () => {
    await client.query(`UPDATE customers SET full_name=' ', email=' ' WHERE public_id='cus_target';
      INSERT INTO customer_addresses(public_id,customer_id,address_line,is_default)
        SELECT 'adr_source_default',id,'Street',true FROM customers WHERE public_id='cus_source';`);
    await new CustomerMergeRepository(db).merge("cus_target", "cus_source", null);
    expect(await db.selectFrom("customers").select(["full_name", "email"]).executeTakeFirstOrThrow())
      .toEqual({ full_name: "Ayşe Yılmaz", email: "source@example.com" });
    expect((await db.selectFrom("customer_addresses").selectAll().executeTakeFirstOrThrow()).is_default).toBe(true);
  });

  it("serializes simultaneous attempts and appends notes only once", async () => {
    const repo = new CustomerMergeRepository(db);
    const results = await Promise.allSettled([repo.merge("cus_target", "cus_source", null), repo.merge("cus_target", "cus_source", null)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await db.selectFrom("audit_logs").selectAll().execute()).toHaveLength(1);
  });

  it("moves every FK, preserves identity aliases and history, deduplicates addresses, fills blanks, audits and repoints all legacy roles", async () => {
    await client.query(`
      INSERT INTO integration_providers(public_id,key,name) VALUES ('ipr_merge','meta_merge','Meta') ON CONFLICT DO NOTHING;
      INSERT INTO integration_accounts(public_id,provider_id,display_name) SELECT 'iac_merge',id,'Meta' FROM integration_providers WHERE key='meta_merge' ON CONFLICT DO NOTHING;
      INSERT INTO customer_external_identities(public_id,customer_id,integration_account_id,external_id)
        SELECT 'cei_'||c.public_id,c.id,a.id,c.public_id FROM customers c CROSS JOIN integration_accounts a WHERE a.public_id='iac_merge';
      INSERT INTO customer_addresses(public_id,customer_id,address_line,city,is_default)
        SELECT 'adr_'||public_id,id,'Atatürk Cd. No:1','Konya',true FROM customers;
      INSERT INTO customer_addresses(public_id,customer_id,address_line,city,is_default)
        SELECT 'adr_other',id,'Other street','Ankara',true FROM customers WHERE public_id='cus_source';
      INSERT INTO conversations(public_id,customer_id,channel) SELECT 'cnv_merge',id,'messenger' FROM customers WHERE public_id='cus_source';
      INSERT INTO orders(public_id,customer_id,order_number,total_amount,source) SELECT 'ord_merge',id,'MERGE-1',100,'manual' FROM customers WHERE public_id='cus_source';
      INSERT INTO shipments(public_id,customer_id,order_id,provider,recipient_name,recipient_phone,recipient_address)
        SELECT 'shp_merge',c.id,o.id,'manual','Original recipient','555','Street' FROM customers c CROSS JOIN orders o WHERE c.public_id='cus_source';
      INSERT INTO accounting_contacts(public_id,customer_id,name) SELECT 'acc_merge',id,'Contact' FROM customers WHERE public_id='cus_source';
      INSERT INTO call_logs(public_id,customer_id,source) SELECT 'cal_merge',id,'legacy' FROM customers WHERE public_id='cus_source';
      INSERT INTO sms_messages(public_id,shipment_id,recipient_phone,message,idempotency_key,request_id) SELECT 'sms_merge',id,'555','Hello','sms_merge','request' FROM shipments;
      INSERT INTO vapi_calls(public_id,shipment_id,customer_phone,idempotency_key,request_id) SELECT 'vcl_merge',id,'555','vcl_merge','request' FROM shipments;
      INSERT INTO vapi_call_queue(public_id,shipment_id,customer_phone) SELECT 'vcq_merge',id,'555' FROM shipments;
      INSERT INTO migration_runs(public_id,run_id,source_system,source_database_identity,table_snapshot,row_counts,batch_size,mapping_catalog_version,plan_fingerprint,source_manifest_hash)
        VALUES ('mig_merge','merge','legacy','{}','[]','[]',1,'v1','fp','hash') ON CONFLICT DO NOTHING;
      INSERT INTO legacy_id_map(run_id,source_system,source_table,source_id,target_table,mapping_role,target_id) VALUES
        ('merge','legacy','people','1','customers','primary','cus_source'),
        ('merge','legacy','people','2','customers','primary','cus_target'),
        ('merge','legacy','orders','3','customers','order_customer','cus_source'),
        ('merge','legacy','address','1','customer_addresses','primary','adr_cus_source');
    `);
    const repo = new CustomerMergeRepository(db);
    expect(await repo.counts("cus_source")).toMatchObject({ orders: 1, conversations: 1, sms_messages: 1, vapi_calls: 1, vapi_call_queue: 1, notes: 1 });
    const result = await repo.merge("cus_target", "cus_source", null);
    expect(result.counts.customer_addresses).toBe(2);
    const target = await db.selectFrom("customers").selectAll().executeTakeFirstOrThrow();
    expect(target).toMatchObject({ public_id: "cus_target", phone: "+90 (555) 111-2233", email: "target@example.com", full_name: "Ayşe Yılmaz",
      notes: "Target note\n\nBirleştirilen müşteri (Ayşe Yılmaz)\nSource note" });
    for (const table of customerMergeRelations) {
      const rows = await sql<{ customer_id: number }>`select customer_id from ${sql.table(table)}`.execute(db);
      expect(rows.rows.length, table).toBeGreaterThan(0);
      expect(rows.rows.every((row) => row.customer_id === target.id), table).toBe(true);
    }
    expect(await db.selectFrom("customer_external_identities").selectAll().execute()).toHaveLength(2);
    const addresses = await db.selectFrom("customer_addresses").selectAll().execute();
    expect(addresses).toHaveLength(2);
    expect(addresses.filter((row) => row.is_default).map((row) => row.public_id)).toEqual(["adr_cus_target"]);
    const maps = await db.selectFrom("legacy_id_map").selectAll().execute();
    expect(maps.filter((row) => row.target_table === "customers").map((row) => [row.target_id,row.mapping_role]))
      .toEqual([["cus_target","primary"],["cus_target","primary"],["cus_target","order_customer"]]);
    expect(maps.find((row) => row.target_table === "customer_addresses")?.target_id).toBe("adr_cus_target");
    const audit = await db.selectFrom("audit_logs").selectAll().executeTakeFirstOrThrow();
    expect(audit).toMatchObject({ action: "customer.merge", entity_id: "cus_target", new_value: { source_public_id: "cus_source", target_public_id: "cus_target", addresses_deduplicated: 1, legacy_mappings: 2 } });
    expect(await db.selectFrom("shipments").select("recipient_name").executeTakeFirstOrThrow()).toEqual({ recipient_name: "Original recipient" });
    expect(await db.selectFrom("sms_messages").selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom("vapi_calls").selectAll().execute()).toHaveLength(1);
    await expect(repo.merge("cus_target", "cus_source", null)).rejects.toMatchObject({ status: 404 });
    await expect(repo.merge("cus_source", "cus_target", null)).rejects.toMatchObject({ status: 404 });
    expect(await db.selectFrom("audit_logs").selectAll().execute()).toHaveLength(1);
    // The account + external identity constraint still rejects duplicate external IDs.
    await expect(sql`insert into customer_external_identities(public_id,customer_id,integration_account_id,external_id)
      select 'cei_conflict',customer_id,integration_account_id,external_id from customer_external_identities limit 1`.execute(db)).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects self and unknown IDs without changing data", async () => {
    const repo = new CustomerMergeRepository(db);
    await expect(repo.merge("cus_target", "cus_target", null)).rejects.toMatchObject({ status: 400 });
    await expect(repo.merge("cus_target", "cus_missing", null)).rejects.toMatchObject({ status: 404 });
    expect(await db.selectFrom("customers").selectAll().execute()).toHaveLength(2);
    expect(await db.selectFrom("audit_logs").selectAll().execute()).toHaveLength(0);
  });

  it("rolls back all moves if a late write fails", async () => {
    await client.query(`CREATE FUNCTION reject_merge_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failed'; END $$;
      CREATE TRIGGER reject_merge_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_merge_audit();`);
    try {
      await expect(new CustomerMergeRepository(db).merge("cus_target", "cus_source", null)).rejects.toThrow("audit failed");
      expect(await db.selectFrom("customers").selectAll().execute()).toHaveLength(2);
      expect((await db.selectFrom("customers").select("phone").where("public_id", "=", "cus_target").executeTakeFirstOrThrow()).phone).toBeNull();
    } finally { await client.query("DROP TRIGGER reject_merge_audit ON audit_logs; DROP FUNCTION reject_merge_audit();"); }
  });

  it("suggests normalized phone, email and close names, excludes self and caps results", async () => {
    await client.query(`INSERT INTO customers(public_id,full_name,phone,email) VALUES
      ('cus_phone','Different Person','05551112233',NULL), ('cus_email','Email Person',NULL,'SOURCE@example.com'),
      ('cus_typo','Ayşe Yılma',NULL,NULL), ('cus_unrelated','Unrelated',NULL,NULL);
      INSERT INTO customers(public_id,full_name) SELECT 'cus_extra_'||n,'Ayşe Yılmaz' FROM generate_series(1,12) n;`);
    const candidates = await new CustomerMergeRepository(db).candidates("cus_source");
    expect(candidates).toHaveLength(10);
    expect(candidates.map((row) => row.public_id)).toContain("cus_phone");
    expect(candidates.map((row) => row.public_id)).toContain("cus_email");
    expect(candidates.map((row) => row.public_id)).not.toContain("cus_source");
    expect(candidates.map((row) => row.public_id)).not.toContain("cus_unrelated");
    await db.deleteFrom("customers").where("public_id", "like", "cus_extra_%").execute();
    expect((await new CustomerMergeRepository(db).candidates("cus_source")).map((row) => row.public_id)).toContain("cus_typo");
  });
});
