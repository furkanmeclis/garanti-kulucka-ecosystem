import { describe, expect, it, vi } from "vitest";
import { migrationApplyDisabledMessage } from "../src/errors.js";
import { legacyMappingCatalog } from "../src/mapping-catalog.js";
import {
  canonicalSourceTableMap,
  executePostgresMigration,
  parseSafePostgresInt8,
} from "../src/postgres-runtime.js";
import {
  withReadonlyRepeatableReadTransaction,
  type PostgresSourceClient,
} from "../src/source-transaction.js";

const { postgresClientConstructor } = vi.hoisted(() => ({
  postgresClientConstructor: vi.fn(),
}));

const { typeParserOverrides, typeOverridesConstructor } = vi.hoisted(() => ({
  typeParserOverrides: new Map<number, (value: string) => unknown>(),
  typeOverridesConstructor: vi.fn(function TypeOverridesFixture(this: unknown) {
    return {
      setTypeParser: (oid: number, parser: (value: string) => unknown) => typeParserOverrides.set(oid, parser),
      getTypeParser: vi.fn(),
    };
  }),
}));

vi.mock("pg", () => ({
  Client: postgresClientConstructor,
  Pool: vi.fn(),
  TypeOverrides: typeOverridesConstructor,
}));

class FixturePostgresClient implements PostgresSourceClient {
  readonly queries: string[] = [];
  connected = false;
  ended = false;

  constructor(
    private readonly countError?: Error,
    private readonly introspectionRows: Readonly<Record<string, Record<string, unknown>[]>> = {},
  ) {}

  async connect(): Promise<void> {
    this.connected = true;
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<{ rows: Row[] }> {
    this.queries.push(sql);
    if (/select count\(\*\)/i.test(sql)) {
      if (this.countError) throw this.countError;
      return { rows: [{ count: "0" }] as Row[] };
    }
    if (/information_schema\.columns/i.test(sql)) {
      const [schema, table] = parameters;
      return { rows: (this.introspectionRows[`${String(schema)}.${String(table)}`] ?? []) as Row[] };
    }
    return { rows: [] };
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

describe("PostgreSQL migration runtime", () => {
  it("maps only dry-run-ready entities from the explicit catalog", () => {
    expect(canonicalSourceTableMap(legacyMappingCatalog)).toEqual({
      customers: { tableName: "public.musteriler", idColumn: "id" },
      conversations: { tableName: "public.konusmalar", idColumn: "id" },
      messages: { tableName: "public.mesajlar", idColumn: "id" },
      orders: { tableName: "public.siparisler", idColumn: "id" },
    });
  });

  it("uses the same safe int8 runtime policy as the database package", () => {
    expect(parseSafePostgresInt8(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => parseSafePostgresInt8("9007199254740992")).toThrow(RangeError);
    expect(() => parseSafePostgresInt8("42.1")).toThrow(TypeError);
  });

  it("scopes lossless timestamp parsers to each legacy source client", async () => {
    const client = new FixturePostgresClient(undefined, catalogIntrospectionRows());
    postgresClientConstructor.mockImplementationOnce(function fixtureClientConstructor() {
      return client;
    });

    await executePostgresMigration({
      mode: "dry-run",
      sourceDatabaseUrl: "postgres://source/legacy",
      sourceSystem: "legacy_postgres",
      batchSize: 500,
    });

    expect(typeOverridesConstructor).toHaveBeenCalled();
    expect(typeParserOverrides.get(20)?.("42")).toBe(42);
    expect(typeParserOverrides.get(1114)?.("2024-01-02 03:04:05.123456")).toBe(
      "2024-01-02 03:04:05.123456",
    );
    expect(typeParserOverrides.get(1184)?.("2024-01-02 03:04:05.123456+00")).toBe(
      "2024-01-02 03:04:05.123456+00",
    );
    expect(postgresClientConstructor.mock.calls.at(-1)?.[0]).toMatchObject({
      connectionString: "postgres://source/legacy",
      types: expect.any(Object),
    });
  });

  it("rejects apply before constructing a source or target connection", async () => {
    await expect(
      executePostgresMigration({
        mode: "apply",
        sourceDatabaseUrl: "postgres://source/legacy",
        targetDatabaseUrl: "postgres://target/canonical",
        sourceSystem: "legacy_postgres",
        runId: "legacy-import-2026-09",
        batchSize: 500,
      }),
    ).rejects.toThrow(migrationApplyDisabledMessage);
    expect(postgresClientConstructor).not.toHaveBeenCalled();
  });

  it("dry-runs only the dry-run-ready catalog entities", async () => {
    const client = new FixturePostgresClient(undefined, catalogIntrospectionRows());
    postgresClientConstructor.mockImplementationOnce(function fixtureClientConstructor() {
      return client;
    });

    const result = await executePostgresMigration({
      mode: "dry-run",
      sourceDatabaseUrl: "postgres://source/legacy",
      sourceSystem: "legacy_postgres",
      batchSize: 500,
    });

    expect(result.plan.entities).toEqual([
      { entity: "customers", totalRows: 0, batches: 0 },
      { entity: "conversations", totalRows: 0, batches: 0 },
      { entity: "messages", totalRows: 0, batches: 0 },
      { entity: "orders", totalRows: 0, batches: 0 },
    ]);
    expect(client.queries.filter((sql) => /select count\(\*\)/i.test(sql))).toEqual([
      'select count(*) as count from "public"."musteriler"',
      'select count(*) as count from "public"."konusmalar"',
      'select count(*) as count from "public"."mesajlar"',
      'select count(*) as count from "public"."siparisler"',
    ]);
  });

  it("fails a dry-run closed when konusmalar lacks human_agent", async () => {
    const rows = catalogIntrospectionRows();
    const client = new FixturePostgresClient(undefined, {
      ...rows,
      "public.konusmalar": rows["public.konusmalar"]!.filter((row) => row.column_name !== "human_agent"),
    });
    postgresClientConstructor.mockImplementationOnce(function fixtureClientConstructor() {
      return client;
    });

    await expect(executePostgresMigration({
      mode: "dry-run",
      sourceDatabaseUrl: "postgres://source/legacy",
      sourceSystem: "legacy_postgres",
      batchSize: 500,
    })).rejects.toThrow("Legacy source schema mismatch for public.konusmalar: missing required columns [human_agent]");
    expect(client.queries.filter((sql) => /select count\(\*\)/i.test(sql))).toEqual([]);
  });

  it("fails a dry-run closed when siparisler lacks mukerrer", async () => {
    const rows = catalogIntrospectionRows();
    const client = new FixturePostgresClient(undefined, {
      ...rows,
      "public.siparisler": (rows["public.siparisler"] ?? []).filter((row) => row.column_name !== "mukerrer"),
    });
    postgresClientConstructor.mockImplementationOnce(function fixtureClientConstructor() {
      return client;
    });

    await expect(executePostgresMigration({
      mode: "dry-run",
      sourceDatabaseUrl: "postgres://source/legacy",
      sourceSystem: "legacy_postgres",
      batchSize: 500,
    })).rejects.toThrow("Legacy source schema mismatch for public.siparisler: missing required columns [mukerrer]");
    expect(client.queries.filter((sql) => /select count\(\*\)/i.test(sql))).toEqual([]);
  });

  it("commits a successful dry-run read-only repeatable-read transaction and closes the client", async () => {
    const client = new FixturePostgresClient();
    const operation = vi.fn().mockResolvedValue({ mode: "dry-run" });

    await expect(
      withReadonlyRepeatableReadTransaction(client, operation),
    ).resolves.toEqual({ mode: "dry-run" });

    expect(client.connected).toBe(true);
    expect(client.queries[0]).toBe("begin transaction isolation level repeatable read read only");
    expect(client.queries.at(-1)).toBe("commit");
    expect(client.queries).not.toContain("rollback");
    expect(client.ended).toBe(true);
    expect(operation).toHaveBeenCalledOnce();
  });

  it("pins the source session time zone and date style before the operation runs", async () => {
    const client = new FixturePostgresClient();
    let queriesBeforeOperation: string[] = [];
    const operation = vi.fn(async () => {
      queriesBeforeOperation = [...client.queries];
      return { mode: "dry-run" };
    });

    await withReadonlyRepeatableReadTransaction(client, operation);

    expect(queriesBeforeOperation).toEqual([
      "begin transaction isolation level repeatable read read only",
      "set local timezone = 'UTC'",
      "set local datestyle = 'ISO, MDY'",
    ]);
    expect(client.queries).toEqual([...queriesBeforeOperation, "commit"]);
  });

  it("rolls back a failed dry-run, closes the client, and redacts database URLs", async () => {
    const client = new FixturePostgresClient(
      new Error("driver rejected postgres://reader:secret@source/legacy?sslmode=require"),
    );
    const operation = vi.fn(async () => client.query("select count(*) from customers"));

    await expect(
      withReadonlyRepeatableReadTransaction(client, operation),
    ).rejects.toThrow("driver rejected [REDACTED_DATABASE_URL]");

    expect(client.queries.at(-1)).toBe("rollback");
    expect(client.ended).toBe(true);
    expect(operation).toHaveBeenCalledOnce();
  });
});

function catalogIntrospectionRows(): Record<string, Record<string, unknown>[]> {
  return Object.fromEntries(legacyMappingCatalog.tables.map((table) => [
    table.sourceTable,
    table.columns.map((column, index) => ({
      column_name: column.name,
      ordinal_position: index + 1,
      data_type: column.dataType,
      udt_name: column.udtName,
      is_nullable: column.nullable ? "YES" : "NO",
    })),
  ]));
}
