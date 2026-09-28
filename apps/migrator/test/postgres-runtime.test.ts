import { describe, expect, it, vi } from "vitest";
import { migrationApplyDisabledMessage } from "../src/errors.js";
import { executePostgresMigration, parseSafePostgresInt8 } from "../src/postgres-runtime.js";
import {
  withReadonlyRepeatableReadTransaction,
  type PostgresSourceClient,
} from "../src/source-transaction.js";

const { postgresClientConstructor } = vi.hoisted(() => ({
  postgresClientConstructor: vi.fn(),
}));

vi.mock("pg", () => ({
  Client: postgresClientConstructor,
  Pool: vi.fn(),
  types: {
    setTypeParser: vi.fn(),
  },
}));

class FixturePostgresClient implements PostgresSourceClient {
  readonly queries: string[] = [];
  connected = false;
  ended = false;

  constructor(private readonly countError?: Error) {}

  async connect(): Promise<void> {
    this.connected = true;
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
  ): Promise<{ rows: Row[] }> {
    this.queries.push(sql);
    if (/select count\(\*\)/i.test(sql)) {
      if (this.countError) throw this.countError;
      return { rows: [{ count: "0" }] as Row[] };
    }
    return { rows: [] };
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

describe("PostgreSQL migration runtime", () => {
  it("uses the same safe int8 runtime policy as the database package", () => {
    expect(parseSafePostgresInt8(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => parseSafePostgresInt8("9007199254740992")).toThrow(RangeError);
    expect(() => parseSafePostgresInt8("42.1")).toThrow(TypeError);
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
