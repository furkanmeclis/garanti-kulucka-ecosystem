import { describe, expect, it, vi } from "vitest";
import { assertCanonicalTargetTable, DatabaseMigrationTarget, mapCanonicalRecordToInsert } from "../src/target.js";

describe("database migration target", () => {
  it("maps canonical records to public_id keyed inserts", () => {
    expect(
      mapCanonicalRecordToInsert({
        targetTable: "customers",
        targetId: "cus_1",
        checksum: "sha256:customer",
        payload: {
          full_name: "Ada Lovelace",
          phone: null,
          email: "ada@example.com",
          username: null,
          notes: null,
        },
      }),
    ).toEqual({
      public_id: "cus_1",
      full_name: "Ada Lovelace",
      phone: null,
      email: "ada@example.com",
      username: null,
      notes: null,
    });
  });

  it("rejects unknown target tables before touching the database", () => {
    expect(() => assertCanonicalTargetTable("legacy_musteriler")).toThrow(
      "Unsupported canonical target table",
    );
  });

  it("accepts account-scoped customer identity targets", () => {
    expect(() => assertCanonicalTargetTable("customer_external_identities")).not.toThrow();
  });

  it("rejects reserved canonical columns from migrated payloads", () => {
    expect(() =>
      mapCanonicalRecordToInsert({
        targetTable: "customers",
        targetId: "cus_1",
        checksum: "sha256:customer",
        payload: {
          id: 100,
          full_name: "Ada Lovelace",
        },
      }),
    ).toThrow("reserved columns");

    expect(() =>
      mapCanonicalRecordToInsert({
        targetTable: "customers",
        targetId: "cus_1",
        checksum: "sha256:customer",
        payload: {
          public_id: "legacy-controlled-id",
          full_name: "Ada Lovelace",
        },
      }),
    ).toThrow("reserved columns");
  });

  it("registers migration runs with insert-do-nothing followed by a select", async () => {
    const doNothing = vi.fn();
    const conflict = { column: vi.fn(() => conflict), doNothing: vi.fn(() => conflict) };
    const insert = {
      values: vi.fn(() => insert),
      onConflict: vi.fn((callback: (builder: typeof conflict) => unknown) => {
        callback(conflict);
        return insert;
      }),
      execute: vi.fn().mockResolvedValue(undefined),
    };
    conflict.doNothing = doNothing.mockReturnValue(conflict);
    const createdAt = new Date("2026-09-29T00:00:00.000Z");
    const row = {
      id: 1,
      public_id: "mrn_1",
      run_id: "run_2026_09",
      source_system: "legacy_postgres",
      source_database_identity: { host: "source", port: "5432", database: "legacy" },
      table_snapshot: [],
      row_counts: [],
      batch_size: 500,
      mapping_catalog_version: "p1-foundation-v1",
      plan_fingerprint: "sha256:plan",
      source_manifest_hash: "sha256:manifest",
      created_at: createdAt,
    };
    const select = {
      selectAll: vi.fn(() => select),
      where: vi.fn(() => select),
      executeTakeFirstOrThrow: vi.fn().mockResolvedValue(row),
    };
    const db = {
      insertInto: vi.fn(() => insert),
      selectFrom: vi.fn(() => select),
    };

    const result = await new DatabaseMigrationTarget(db as never).registerMigrationRun({
      runId: "run_2026_09",
      manifest: {
        sourceSystem: "legacy_postgres",
        databaseIdentity: { host: "source", port: "5432", database: "legacy" },
        tables: [],
        rowCounts: [],
        batchSize: 500,
        mappingCatalogVersion: "p1-foundation-v1",
        planFingerprint: "sha256:plan",
        sourceManifestHash: "sha256:manifest",
      },
    });

    expect(conflict.column).toHaveBeenCalledWith("run_id");
    expect(doNothing).toHaveBeenCalledOnce();
    expect(select.where).toHaveBeenCalledWith("run_id", "=", "run_2026_09");
    expect(result).toMatchObject({ runId: "run_2026_09", createdAt });
  });

  it("runs target operations inside a Kysely transaction", async () => {
    const transactionTarget = { marker: "transaction" };
    const execute = vi.fn(async (callback: (transaction: unknown) => Promise<string>) =>
      callback(transactionTarget),
    );
    const db = {
      transaction: vi.fn(() => ({ execute })),
    };

    const result = await new DatabaseMigrationTarget(db as never).runInTransaction(async (target) => {
      expect(target).toBeInstanceOf(DatabaseMigrationTarget);
      return "transaction-result";
    });

    expect(result).toBe("transaction-result");
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects blank migration run ids before touching the database", async () => {
    const db = {
      insertInto: vi.fn(),
      selectFrom: vi.fn(),
    };

    await expect(new DatabaseMigrationTarget(db as never).registerMigrationRun({
      runId: "  ",
      manifest: {
        sourceSystem: "legacy_postgres",
        databaseIdentity: { host: "source", port: "5432", database: "legacy" },
        tables: [],
        rowCounts: [],
        batchSize: 500,
        mappingCatalogVersion: "p1-foundation-v1",
        planFingerprint: "sha256:plan",
        sourceManifestHash: "sha256:manifest",
      },
    })).rejects.toThrow("runId must not be blank");
    expect(db.insertInto).not.toHaveBeenCalled();
    expect(db.selectFrom).not.toHaveBeenCalled();
  });

  it("scopes legacy id map reads and upserts to the migration run", async () => {
    const where = vi.fn();
    const select = {
      selectAll: vi.fn(() => select),
      where: vi.fn((...args: unknown[]) => {
        where(...args);
        return select;
      }),
      executeTakeFirst: vi.fn().mockResolvedValue(undefined),
    };
    const conflict = {
      columns: vi.fn(() => conflict),
      doUpdateSet: vi.fn(() => conflict),
    };
    const insert = {
      values: vi.fn(() => insert),
      onConflict: vi.fn((callback: (builder: typeof conflict) => unknown) => {
        callback(conflict);
        return insert;
      }),
      returningAll: vi.fn(() => insert),
      executeTakeFirstOrThrow: vi.fn().mockResolvedValue({
        id: 1,
        run_id: "run_2",
        source_system: "legacy_postgres",
        source_table: "legacy.musteriler",
        source_id: "42",
        target_table: "customers",
        mapping_role: "primary",
        target_id: "cus_42",
        checksum: null,
        migrated_at: new Date("2026-09-29T00:00:00.000Z"),
      }),
    };
    const db = {
      selectFrom: vi.fn(() => select),
      insertInto: vi.fn(() => insert),
    };
    const target = new DatabaseMigrationTarget(db as never);
    const key = {
      runId: "run_2",
      sourceSystem: "legacy_postgres",
      sourceTable: "legacy.musteriler",
      sourceId: "42",
      targetTable: "customers",
      mappingRole: "primary",
    } as const;

    await target.findLegacyIdMap(key);
    expect(where).toHaveBeenCalledWith("run_id", "=", "run_2");

    await expect(target.upsertLegacyIdMap({ ...key, targetId: "cus_42", checksum: null })).resolves.toMatchObject({
      runId: "run_2",
    });
    expect(insert.values).toHaveBeenCalledWith(expect.objectContaining({ run_id: "run_2" }));
    expect(conflict.columns).toHaveBeenCalledWith([
      "run_id",
      "source_system",
      "source_table",
      "source_id",
      "target_table",
      "mapping_role",
    ]);
  });
});
