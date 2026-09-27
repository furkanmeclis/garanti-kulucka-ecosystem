import { describe, expect, it } from "vitest";
import { applyMigrationBatch } from "../src/apply.js";
import { createDryRunReport } from "../src/reports.js";
import { createMigrationPlan } from "../src/plan.js";
import { legacyIdMapKey, upsertLegacyIdMap } from "../src/id-map.js";
import type {
  CanonicalRecord,
  CanonicalWriteResult,
  LegacyIdMapEntry,
  LegacyIdMapKey,
  LegacyIdMapWrite,
  LegacyRecord,
  LegacySource,
  MigrationEntity,
  MigrationTarget,
} from "../src/types.js";

class FixtureSource implements LegacySource {
  constructor(
    private readonly counts: Record<string, number>,
    private readonly records: Partial<Record<MigrationEntity, LegacyRecord[]>> = {},
  ) {}

  async count(entity: keyof FixtureSource["counts"]): Promise<number> {
    return this.counts[entity] ?? 0;
  }

  async readBatch(entity: MigrationEntity, options: { limit: number; afterSourceId?: string }): Promise<LegacyRecord[]> {
    const offset = options.afterSourceId ? Number.parseInt(options.afterSourceId, 10) : 0;
    return (this.records[entity] ?? []).slice(offset, offset + options.limit);
  }
}

class MemoryTarget implements MigrationTarget {
  private readonly entries = new Map<string, LegacyIdMapEntry>();
  private readonly records = new Map<string, CanonicalRecord>();

  get writtenRecords(): CanonicalRecord[] {
    return [...this.records.values()];
  }

  async writeCanonicalRecord(input: CanonicalRecord): Promise<CanonicalWriteResult> {
    const key = `${input.targetTable}:${input.targetId}`;
    const existing = this.records.get(key);
    this.records.set(key, input);

    return {
      status: existing ? (existing.checksum === input.checksum ? "unchanged" : "updated") : "created",
      record: input,
    };
  }

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

  it("applies batches through source and target ports idempotently", async () => {
    const source = new FixtureSource(
      { customers: 2 },
      {
        customers: [
          {
            sourceSystem: "legacy_supabase",
            sourceTable: "customers",
            sourceId: "1",
            payload: { full_name: "Ada Lovelace" },
            checksum: "sha256:ada",
          },
          {
            sourceSystem: "legacy_supabase",
            sourceTable: "customers",
            sourceId: "2",
            payload: { full_name: "Grace Hopper" },
            checksum: "sha256:grace",
          },
        ],
      },
    );
    const target = new MemoryTarget();
    const batch = {
      entity: "customers",
      batchNumber: 1,
      limit: 10,
      offset: 0,
      expectedRows: 2,
    } as const;

    await expect(applyMigrationBatch({ source, target, batch })).resolves.toMatchObject({
      readRows: 2,
      writtenRows: 2,
      skippedRows: 0,
      idMapCreated: 2,
      idMapUpdated: 0,
      idMapUnchanged: 0,
    });

    await expect(applyMigrationBatch({ source, target, batch })).resolves.toMatchObject({
      readRows: 2,
      writtenRows: 2,
      skippedRows: 0,
      idMapCreated: 0,
      idMapUpdated: 0,
      idMapUnchanged: 2,
    });
    expect(target.writtenRecords).toHaveLength(2);
  });
});
