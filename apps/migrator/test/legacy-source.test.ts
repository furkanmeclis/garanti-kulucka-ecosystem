import { describe, expect, it } from "vitest";
import {
  calculateSourcePayloadChecksum,
  LegacyDatabaseSource,
  resolveTableMap,
  type LegacyQueryDatabase,
} from "../src/legacy-source.js";
import { legacyMappingCatalog } from "../src/mapping-catalog.js";

class FakeDatabase implements LegacyQueryDatabase {
  readonly queries: { sql: string; parameters: readonly unknown[] }[] = [];
  private readonly responses: Record<string, unknown>[][];

  constructor(...responses: Record<string, unknown>[][]) {
    this.responses = responses;
  }

  async query(sql: string, parameters: readonly unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
    this.queries.push({ sql, parameters });
    return { rows: this.responses.shift() ?? [] };
  }
}

describe("LegacyDatabaseSource", () => {
  it("includes an own enumerable __proto__ key in stable checksum normalization", () => {
    const plain = { id: "customer-1" };
    const withDangerousKey = { id: "customer-1" };
    Object.defineProperty(withDangerousKey, "__proto__", {
      value: "owned-data",
      enumerable: true,
    });

    expect(calculateSourcePayloadChecksum(withDangerousKey)).not.toBe(calculateSourcePayloadChecksum(plain));
  });

  it("rejects checksum accessors without invoking them", () => {
    const payload: Record<string, unknown> = { id: "customer-1" };
    let invoked = false;
    Object.defineProperty(payload, "secret", {
      enumerable: true,
      get() {
        invoked = true;
        throw new Error("ayse@example.test");
      },
    });

    expect(() => calculateSourcePayloadChecksum(payload)).toThrow(
      "Source payload checksum requires strict JSON-like data",
    );
    expect(invoked).toBe(false);
  });

  it("canonicalizes JSON-like data deterministically without invoking toJSON", () => {
    const date = new Date("2026-01-02T03:04:05.678Z");
    const first = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(first, "z", { value: [null, true, 1.25, date], enumerable: true });
    Object.defineProperty(first, "a", { value: { nested: "value" }, enumerable: true });
    const second = { a: { nested: "value" }, z: [null, true, 1.25, date] };

    expect(calculateSourcePayloadChecksum(first)).toBe(calculateSourcePayloadChecksum(second));
    expect(calculateSourcePayloadChecksum({ value: -0 })).toBe(calculateSourcePayloadChecksum({ value: 0 }));
  });

  it("rejects symbol data and keys with a generic PII-safe error", () => {
    const pii = "ayse@example.test";
    const cases: Record<string, unknown>[] = [
      { value: Symbol(pii) },
      Object.assign({ value: "safe" }, { [Symbol(pii)]: "secret" }),
    ];

    for (const payload of cases) {
      expectChecksumRejection(payload, pii);
    }
  });

  it("never invokes toJSON or array accessors while rejecting them", () => {
    const pii = "ayse@example.test";
    let toJsonInvoked = false;
    const withToJson = {
      value: "safe",
      toJSON() {
        toJsonInvoked = true;
        throw new Error(pii);
      },
    };
    let getterInvoked = false;
    const withArrayGetter = { values: ["safe"] };
    Object.defineProperty(withArrayGetter.values, "0", {
      enumerable: true,
      get() {
        getterInvoked = true;
        throw new Error(pii);
      },
    });

    expectChecksumRejection(withToJson, pii);
    expectChecksumRejection(withArrayGetter, pii);
    expect(toJsonInvoked).toBe(false);
    expect(getterInvoked).toBe(false);
  });

  it("rejects cycles, shared objects, sparse arrays, custom array properties, and unsupported values", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const shared = { value: "same" };
    const sparse = new Array(2);
    sparse[1] = "present";
    const custom = ["value"] as unknown[] & { extra?: string };
    custom.extra = "not-an-index";

    for (const payload of [
      cycle,
      { first: shared, second: shared },
      { sparse },
      { custom },
      { value: undefined },
      { value: 1n },
      { value: Number.NaN },
      { value: Number.POSITIVE_INFINITY },
      { value: /not-plain/u },
    ]) {
      expectChecksumRejection(payload, "ayse@example.test");
    }
  });

  it("counts rows from the configured legacy table", async () => {
    const db = new FakeDatabase([{ count: "42" }]);
    const source = new LegacyDatabaseSource({
      db,
      sourceSystem: "legacy_supabase",
      tables: {
        customers: "public.eski_musteriler",
      },
    });

    await expect(source.count("customers")).resolves.toBe(42);
    expect(db.queries).toEqual([
      {
        sql: 'select count(*) as count from "public"."eski_musteriler"',
        parameters: [],
      },
    ]);
  });

  it("reads a stable id ordered batch and turns rows into legacy records", async () => {
    const createdAt = new Date("2026-01-02T03:04:05.000Z");
    const db = new FakeDatabase(
      [
        { legacy_id: 7, name: "Ada", meta: { z: 1, a: "first" }, created_at: createdAt },
        { legacy_id: 9, name: "Grace", meta: null, created_at: createdAt },
      ],
    );
    const source = new LegacyDatabaseSource({
      db,
      sourceSystem: "legacy_supabase",
      tables: {
        customers: { tableName: "legacy.musteriler", idColumn: "legacy_id" },
      },
    });

    const records = await source.readBatch("customers", { limit: 2, afterSourceId: "5" });

    expect(db.queries).toEqual([
      {
        sql: 'select * from "legacy"."musteriler" where "legacy_id"::text > $2 order by "legacy_id" asc limit $1',
        parameters: [2, "5"],
      },
    ]);
    expect(records).toEqual([
      {
        sourceSystem: "legacy_supabase",
        sourceTable: "legacy.musteriler",
        sourceId: "7",
        payload: {
          created_at: "2026-01-02T03:04:05.000Z",
          legacy_id: 7,
          meta: { a: "first", z: 1 },
          name: "Ada",
        },
        checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
      {
        sourceSystem: "legacy_supabase",
        sourceTable: "legacy.musteriler",
        sourceId: "9",
        payload: {
          created_at: "2026-01-02T03:04:05.000Z",
          legacy_id: 9,
          meta: null,
          name: "Grace",
        },
        checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    ]);
  });

  it("captures a deterministic table and column snapshot from information_schema", async () => {
    const db = new FakeDatabase([
      { column_name: "id", ordinal_position: 1, data_type: "bigint", udt_name: "int8", is_nullable: "NO" },
      { column_name: "ad", ordinal_position: "2", data_type: "text", udt_name: "text", is_nullable: "YES" },
    ]);
    const source = new LegacyDatabaseSource({
      db,
      sourceSystem: "legacy_postgres",
      tables: { customers: { tableName: "legacy.musteriler", idColumn: "id" } },
    });

    await expect(source.describeTables(["customers"])).resolves.toEqual([{
      entity: "customers",
      schema: "legacy",
      table: "musteriler",
      idColumn: "id",
      columns: [
        { name: "id", ordinalPosition: 1, dataType: "bigint", udtName: "int8", nullable: false },
        { name: "ad", ordinalPosition: 2, dataType: "text", udtName: "text", nullable: true },
      ],
    }]);
    expect(db.queries[0]).toMatchObject({ parameters: ["legacy", "musteriler"] });
  });

  it("rejects a missing table during introspection", async () => {
    const source = new LegacyDatabaseSource({
      db: new FakeDatabase([]),
      sourceSystem: "legacy_postgres",
      tables: { customers: "legacy.musteriler" },
    });

    await expect(source.describeTables(["customers"])).rejects.toThrow(
      "Legacy source table introspection returned no columns for legacy.musteriler",
    );
  });

  it("rejects a configured id column missing from the introspected table", async () => {
    const source = new LegacyDatabaseSource({
      db: new FakeDatabase([
        { column_name: "name", ordinal_position: 1, data_type: "text", udt_name: "text", is_nullable: "NO" },
      ]),
      sourceSystem: "legacy_postgres",
      tables: { customers: { tableName: "legacy.musteriler", idColumn: "legacy_id" } },
    });

    await expect(source.describeTables(["customers"])).rejects.toThrow(
      "Legacy source table legacy.musteriler is missing configured id column legacy_id",
    );
  });

  it("introspects and validates the dry-run-ready mapping", async () => {
    const db = new FakeDatabase(...legacyMappingCatalog.tables.map((table) => table.columns.map((column, index) => ({
      column_name: column.name,
      ordinal_position: index + 1,
      data_type: column.dataType,
      udt_name: column.udtName,
      is_nullable: column.nullable ? "YES" : "NO",
    }))));
    const source = new LegacyDatabaseSource({
      db,
      sourceSystem: "legacy_postgres",
      tables: {
        customers: "public.musteriler",
        conversations: "public.konusmalar",
        messages: "public.mesajlar",
      },
      mappingCatalog: legacyMappingCatalog,
    });

    const snapshots = await source.describeTables(["customers", "conversations", "messages"]);

    expect(db.queries.map((query) => query.parameters)).toEqual([
      ["public", "musteriler"],
      ["public", "konusmalar"],
      ["public", "mesajlar"],
    ]);
    expect(snapshots.map(({ entity, schema, table }) => ({ entity, schema, table }))).toEqual([
      { entity: "customers", schema: "public", table: "musteriler" },
      { entity: "conversations", schema: "public", table: "konusmalar" },
      { entity: "messages", schema: "public", table: "mesajlar" },
    ]);
  });

  it("rejects catalog routing that omits the conversation and message targets", () => {
    const db = new FakeDatabase();
    expect(() => new LegacyDatabaseSource({
      db,
      sourceSystem: "legacy_postgres",
      tables: { customers: "public.musteriler" },
      mappingCatalog: legacyMappingCatalog,
    })).toThrow("routing is missing dry-run-ready target conversations");
    expect(db.queries).toHaveLength(0);
  });

  it("rejects an invalid catalog before querying", () => {
    expect(() => new LegacyDatabaseSource({
      db: new FakeDatabase(),
      sourceSystem: "legacy_postgres",
      tables: { customers: "public.musteriler" },
      mappingCatalog: {
        version: "test-v1",
        tables: [{
          sourceTable: "public.musteriler",
          idColumn: "id",
          targetEntities: [{ entity: "customers", mapping: "direct", readiness: "dry-run" }],
          columns: [],
        }],
      },
    })).toThrow("id column public.musteriler.id is not declared");
  });

  it("rejects catalog routing to another table before querying", () => {
    const db = new FakeDatabase();
    expect(() => new LegacyDatabaseSource({
      db,
      sourceSystem: "legacy_postgres",
      tables: { customers: "public.other_customers" },
      mappingCatalog: legacyMappingCatalog,
    })).toThrow("routing for customers must be public.musteriler.id");
    expect(db.queries).toHaveLength(0);
  });

  it("rejects catalog routing with the wrong id column before querying", () => {
    const db = new FakeDatabase();
    expect(() => new LegacyDatabaseSource({
      db,
      sourceSystem: "legacy_postgres",
      tables: { customers: { tableName: "public.musteriler", idColumn: "legacy_id" } },
      mappingCatalog: legacyMappingCatalog,
    })).toThrow("routing for customers must be public.musteriler.id");
    expect(db.queries).toHaveLength(0);
  });

  it("rejects missing and catalog-unready routing before querying", () => {
    const missingDb = new FakeDatabase();
    expect(() => new LegacyDatabaseSource({
      db: missingDb,
      sourceSystem: "legacy_postgres",
      tables: {},
      mappingCatalog: legacyMappingCatalog,
    })).toThrow("routing is missing dry-run-ready target customers");
    expect(missingDb.queries).toHaveLength(0);

    const extraDb = new FakeDatabase();
    expect(() => new LegacyDatabaseSource({
      db: extraDb,
      sourceSystem: "legacy_postgres",
      tables: { customers: "public.musteriler", customer_addresses: "public.musteriler" },
      mappingCatalog: legacyMappingCatalog,
    })).toThrow("routing contains catalog-unready target customer_addresses");
    expect(extraDb.queries).toHaveLength(0);
  });

  it("reads planned offset batches without treating offsets as source ids", async () => {
    const db = new FakeDatabase([{ legacy_id: 9, name: "Grace" }]);
    const source = new LegacyDatabaseSource({
      db,
      sourceSystem: "legacy_supabase",
      tables: {
        customers: { tableName: "legacy.musteriler", idColumn: "legacy_id" },
      },
    });

    const records = await source.readBatch("customers", { limit: 2, offset: 2 });

    expect(db.queries).toEqual([
      {
        sql: 'select * from "legacy"."musteriler" order by "legacy_id" asc limit $1 offset $2',
        parameters: [2, 2],
      },
    ]);
    expect(records).toEqual([
      {
        sourceSystem: "legacy_supabase",
        sourceTable: "legacy.musteriler",
        sourceId: "9",
        payload: {
          legacy_id: 9,
          name: "Grace",
        },
        checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    ]);
  });

  it("rejects invalid batch read windows", async () => {
    const source = new LegacyDatabaseSource({
      db: new FakeDatabase(),
      sourceSystem: "legacy_supabase",
      tables: {
        customers: { tableName: "legacy.musteriler", idColumn: "legacy_id" },
      },
    });

    await expect(source.readBatch("customers", { limit: 2, offset: -1 })).rejects.toThrow(
      "offset must be a non-negative integer",
    );
    await expect(
      source.readBatch("customers", { limit: 2, offset: 1, afterSourceId: "10" }),
    ).rejects.toThrow("offset and afterSourceId cannot be combined");
  });

  it("supports table maps with a default source id column", () => {
    expect(
      resolveTableMap(
        {
          orders: "legacy.orders",
          messages: { tableName: "legacy.inbox_messages", idColumn: "message_id" },
        },
        "source_id",
      ),
    ).toEqual({
      orders: { tableName: "legacy.orders", idColumn: "source_id" },
      messages: { tableName: "legacy.inbox_messages", idColumn: "message_id" },
    });
  });

  it("rejects unsafe table or column identifiers before querying", () => {
    expect(
      () =>
        new LegacyDatabaseSource({
          db: new FakeDatabase(),
          sourceSystem: "legacy_supabase",
          tables: {
            customers: "legacy.customers;drop_table_users",
          },
        }),
    ).toThrow("Invalid SQL identifier");

    expect(
      () =>
        new LegacyDatabaseSource({
          db: new FakeDatabase(),
          sourceSystem: "legacy_supabase",
          tables: {
            customers: { tableName: "legacy.customers", idColumn: "id desc" },
          },
        }),
    ).toThrow("Invalid SQL identifier");
  });

  it("fails fast when an entity has no source table mapping", async () => {
    const source = new LegacyDatabaseSource({
      db: new FakeDatabase(),
      sourceSystem: "legacy_supabase",
      tables: {},
    });

    await expect(source.count("customers")).rejects.toThrow("No legacy source table configured for customers");
  });
});

function expectChecksumRejection(payload: Record<string, unknown>, pii: string): void {
  try {
    calculateSourcePayloadChecksum(payload);
    throw new Error("Expected checksum calculation to fail");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    expect(message).toBe("Source payload checksum requires strict JSON-like data");
    expect(message).not.toContain(pii);
  }
}
