import { describe, expect, it } from "vitest";
import {
  assertResumeManifestMatches,
  calculateSourceManifestHash,
  createSourceManifest,
  registerMigrationRun,
} from "../src/source-manifest.js";
import type { MigrationPlan, MigrationTarget, SourceManifest } from "../src/types.js";

describe("source migration manifest", () => {
  it("creates deterministic plan and source manifest hashes", () => {
    const first = createSourceManifest(manifestInput());
    const second = createSourceManifest(manifestInput({ reverseColumns: true }));

    expect(first).toEqual(second);
    expect(first.planFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.sourceManifestHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.tables[0]?.columns.map((column) => column.name)).toEqual(["id", "full_name"]);
  });

  it.each([
    ["source system identity", { sourceSystem: "another_source" }],
    ["source database identity", { databaseIdentity: { host: "other", port: "5432", database: "legacy" } }],
    ["mapping catalog version", { mappingCatalogVersion: "catalog-v2" }],
    ["batch size", { batchSize: 50 }],
    ["plan fingerprint", { planFingerprint: "sha256:different-plan" }],
    ["source manifest hash", { sourceManifestHash: "sha256:different-manifest" }],
  ])("rejects resume when %s changes", async (expectedMismatch, override) => {
    const persisted = createSourceManifest(manifestInput());
    const requested = { ...persisted, ...override } as SourceManifest;
    const target = {
      registerMigrationRun: async () => ({
        runId: "run_2026_09",
        manifest: persisted,
        createdAt: new Date("2026-09-29T00:00:00.000Z"),
      }),
    } as MigrationTarget;

    await expect(registerMigrationRun(target, "run_2026_09", requested)).rejects.toThrow(
      expectedMismatch,
    );
    expect(() => assertResumeManifestMatches("run_2026_09", persisted, requested)).toThrow(
      "Migration run run_2026_09 cannot resume",
    );
  });

  it("rejects tampered persisted manifests and compares snapshots directly", () => {
    const requested = createSourceManifest(manifestInput());
    const tamperedTables = {
      ...requested,
      tables: requested.tables.map((table) => ({ ...table, idColumn: "legacy_id" })),
    };
    const persisted = {
      ...tamperedTables,
      rowCounts: [{ entity: "customers" as const, rows: 3 }],
      sourceManifestHash: requested.sourceManifestHash,
    };

    expect(() => assertResumeManifestMatches("run_2026_09", persisted, requested)).toThrow(
      /persisted source manifest integrity, table snapshot, row counts changed/,
    );
    expect(calculateSourceManifestHash(requested)).toBe(requested.sourceManifestHash);
  });

  it.each(["", "   ", "\t\n"])("rejects a blank migration run id %j", async (runId) => {
    const target = {
      registerMigrationRun: async () => {
        throw new Error("target must not be called");
      },
    } as unknown as MigrationTarget;

    await expect(registerMigrationRun(target, runId, createSourceManifest(manifestInput()))).rejects.toThrow(
      "runId must not be blank",
    );
  });
});

function manifestInput(options: { reverseColumns?: boolean } = {}) {
  const columns = [
    { name: "id", ordinalPosition: 1, dataType: "bigint", udtName: "int8", nullable: false },
    { name: "full_name", ordinalPosition: 2, dataType: "text", udtName: "text", nullable: false },
  ];
  const plan: MigrationPlan = {
    mode: "apply",
    batchSize: 100,
    totalRows: 2,
    entities: [{ entity: "customers", totalRows: 2, batches: 1 }],
    batches: [{ entity: "customers", batchNumber: 1, limit: 100, offset: 0, expectedRows: 2 }],
    createdAt: "2026-09-29T00:00:00.000Z",
  };

  return {
    sourceSystem: "legacy_postgres",
    databaseIdentity: { host: "source.internal", port: "5432", database: "legacy" },
    tables: [{
      entity: "customers" as const,
      schema: "public",
      table: "musteriler",
      idColumn: "id",
      columns: options.reverseColumns ? columns.reverse() : columns,
    }],
    plan,
    mappingCatalogVersion: "p1-foundation-v1",
  };
}
