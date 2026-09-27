import { describe, expect, it } from "vitest";
import { LegacyDatabaseSource, resolveTableMap, type LegacyQueryDatabase } from "../src/legacy-source.js";

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
