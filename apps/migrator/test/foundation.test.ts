import { describe, expect, it } from "vitest";
import { createDryRunReport } from "../src/reports.js";
import { createMigrationPlan } from "../src/plan.js";
import { legacyIdMapKey, upsertLegacyIdMap } from "../src/id-map.js";
import type { LegacyIdMapEntry, LegacyIdMapKey, LegacyIdMapWrite, LegacySource, MigrationTarget } from "../src/types.js";

class FixtureSource implements LegacySource {
  constructor(private readonly counts: Record<string, number>) {}

  async count(entity: keyof FixtureSource["counts"]): Promise<number> {
    return this.counts[entity] ?? 0;
  }

  async readBatch(): Promise<[]> {
    return [];
  }
}

class MemoryTarget implements MigrationTarget {
  private readonly entries = new Map<string, LegacyIdMapEntry>();

  async findLegacyIdMap(input: LegacyIdMapKey): Promise<LegacyIdMapEntry | null> {
    return this.entries.get(legacyIdMapKey(input)) ?? null;
  }

  async upsertLegacyIdMap(input: LegacyIdMapWrite): Promise<LegacyIdMapEntry> {
    const entry = {
      ...input,
      migratedAt: new Date("2026-01-02T03:04:05.000Z"),
    };
    this.entries.set(legacyIdMapKey(input), entry);
    return entry;
  }
}

describe("migration foundation", () => {
  it("creates a deterministic dry-run batch plan from source counts", async () => {
    const source = new FixtureSource({
      customers: 5,
      messages: 1,
      orders: 0,
    });

    const plan = await createMigrationPlan({
      source,
      mode: "dry-run",
      batchSize: 2,
      entities: ["customers", "messages", "orders"],
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(plan).toMatchObject({
      mode: "dry-run",
      batchSize: 2,
      totalRows: 6,
      createdAt: "2026-01-01T00:00:00.000Z",
      entities: [
        { entity: "customers", totalRows: 5, batches: 3 },
        { entity: "messages", totalRows: 1, batches: 1 },
        { entity: "orders", totalRows: 0, batches: 0 },
      ],
    });
    expect(plan.batches).toEqual([
      { entity: "customers", batchNumber: 1, limit: 2, offset: 0, expectedRows: 2 },
      { entity: "customers", batchNumber: 2, limit: 2, offset: 2, expectedRows: 2 },
      { entity: "customers", batchNumber: 3, limit: 2, offset: 4, expectedRows: 1 },
      { entity: "messages", batchNumber: 1, limit: 2, offset: 0, expectedRows: 1 },
    ]);
  });

  it("builds dry-run reports without mutating the target", async () => {
    const plan = await createMigrationPlan({
      source: new FixtureSource({ customers: 3 }),
      mode: "dry-run",
      batchSize: 2,
      entities: ["customers"],
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    const report = createDryRunReport({
      plan,
      warnings: [{ entity: "customers", code: "unknown_field", message: "Legacy field ignored: musteri_notu" }],
      now: new Date("2026-01-01T00:00:01.000Z"),
    });

    expect(report.totals).toEqual({ plannedRows: 3, plannedBatches: 2, blockedRows: 1 });
    expect(report.entities).toEqual([
      { entity: "customers", plannedRows: 3, plannedBatches: 2, blockedRows: 1 },
    ]);
    expect(report.generatedAt).toBe("2026-01-01T00:00:01.000Z");
  });

  it("upserts legacy id map entries idempotently", async () => {
    const target = new MemoryTarget();
    const write: LegacyIdMapWrite = {
      sourceSystem: "legacy_supabase",
      sourceTable: "customers",
      sourceId: "42",
      targetTable: "customers",
      targetId: "1001",
      checksum: "sha256:first",
    };

    await expect(upsertLegacyIdMap(target, write)).resolves.toMatchObject({ status: "created" });
    await expect(upsertLegacyIdMap(target, write)).resolves.toMatchObject({ status: "unchanged" });
    await expect(upsertLegacyIdMap(target, { ...write, checksum: "sha256:changed" })).resolves.toMatchObject({
      status: "updated",
      entry: { checksum: "sha256:changed" },
    });
  });
});
