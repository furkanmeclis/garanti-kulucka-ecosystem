import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { StreamingRowContentChecksum, SnapshotRowContent } from "../src/snapshot-row-content.js";
import { createSourceManifest, createSourceRowContentChecksum } from "../src/source-manifest.js";
import { calculateSourcePayloadChecksum } from "../src/legacy-source.js";
import { createMigrationPlan } from "../src/plan.js";
import type { LegacyRecord, LegacySource, MigrationEntity } from "../src/types.js";

const row = (sourceId: string, payload = {}): LegacyRecord => ({ sourceId, payload,
  sourceTable: "public.fixture", sourceSystem: "legacy", checksum: calculateSourcePayloadChecksum(payload) });

describe("streaming row content", () => {
  it.each([
    [], ["a", "b", "c"], ["1", "2", "10", "11", "100"],
    ["z", "a", "😀", "\uffff", "quote\"\\\n", "b"],
  ].map((ids) => [ids]))("matches the old sorted checksum, plan fingerprint and manifest bytes for %j", async (ids) => {
    const rows = ids.map((id) => row(id, { text: id }));
    const source: LegacySource = { count: async () => rows.length, describeTables: async () => [],
      readBatch: async (_, { offset = 0, limit }) => rows.slice(offset, offset + limit) };
    const plan = await createMigrationPlan({ source, mode: "dry-run", batchSize: 2, entities: ["messages"] });
    const directory = await mkdtemp(join(tmpdir(), "checksum-regression-"));
    try {
      const stream = new StreamingRowContentChecksum(directory, "messages");
      for (let i = 0; i < rows.length; i += 2) await stream.add(rows.slice(i, i + 2));
      const previous = createSourceRowContentChecksum("messages", rows);
      const current = await stream.finish();
      expect(current).toEqual(previous);
      const input = { sourceSystem: "legacy", databaseIdentity: { host: "localhost", port: "5440", database: "fixture" },
        tables: [{ entity: "messages" as MigrationEntity, schema: "public", table: "fixture", idColumn: "id", columns: [] }],
        plan, mappingCatalogVersion: "unchanged" };
      const oldManifest = createSourceManifest({ ...input, rowContentChecksums: [previous] });
      const newManifest = createSourceManifest({ ...input, rowContentChecksums: [current] });
      expect(Buffer.from(JSON.stringify(newManifest))).toEqual(Buffer.from(JSON.stringify(oldManifest)));
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("deduplicates repeated reads with the first checksum, matching the old orchestrator", async () => {
    const directory = await mkdtemp(join(tmpdir(), "checksum-dedupe-"));
    try {
      const stream = new StreamingRowContentChecksum(directory, "messages");
      const first = row("a", { text: "first" });
      await stream.add([row("z"), first]);
      await stream.add([row("a", { text: "later" }), row("b")]);
      expect(await stream.finish()).toEqual(createSourceRowContentChecksum("messages", [row("z"), first, row("b")]));
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("reads each source batch once, replays snapshot batches, and removes cached files when closed", async () => {
    const rows = [row("a"), row("b"), row("c")];
    const readBatch = vi.fn<LegacySource["readBatch"]>(async (_, { offset = 0, limit }) => rows.slice(offset, offset + limit));
    const source: LegacySource = { count: async () => 3, describeTables: async () => [], readBatch };
    const snapshot = await SnapshotRowContent.create(source, ["messages"], true);
    try {
      const plan = await createMigrationPlan({ source, mode: "apply", batchSize: 2, entities: ["messages"] });
      expect(await snapshot.readPlan(plan)).toEqual([createSourceRowContentChecksum("messages", rows)]);
      for (const batch of plan.batches) expect(await snapshot.source.readBatch("messages", { offset: batch.offset, limit: batch.limit }))
        .toEqual(rows.slice(batch.offset, batch.offset + batch.limit));
      expect(readBatch).toHaveBeenCalledTimes(2);
      expect(snapshot.planningRecords.has("messages")).toBe(false);
    } finally { await snapshot.close(); }
    await expect(snapshot.source.readBatch("messages", { offset: 0, limit: 2 })).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("uses explicit batch cursors without changing numeric order or persisted plan fingerprints", async () => {
    const rows = ["1", "2", "10", "11"].map((id) => row(id));
    const readBatch = vi.fn<LegacySource["readBatch"]>(async (_, options) => {
      const selected = options.afterSourceId === undefined ? rows.slice(options.offset ?? 0)
        : rows.filter((row) => Number(row.sourceId) > Number(options.afterSourceId));
      return selected.slice(0, options.limit);
    });
    const source: LegacySource = { supportsKeysetPagination: true, count: async () => rows.length,
      describeTables: async () => [], readBatch };
    const plan = await createMigrationPlan({ source, mode: "apply", batchSize: 2, entities: ["messages"] });
    const serializedPlan = JSON.stringify(plan);
    const snapshot = await SnapshotRowContent.create(source, ["messages"], true);
    try {
      expect(await snapshot.readPlan(plan)).toEqual([createSourceRowContentChecksum("messages", rows)]);
      expect(readBatch.mock.calls.map(([, options]) => options)).toEqual([
        { limit: 2, offset: 0 }, { limit: 2, afterSourceId: "2" },
      ]);
      expect(JSON.stringify(plan)).toBe(serializedPlan);
    } finally { await snapshot.close(); }
  });

});
