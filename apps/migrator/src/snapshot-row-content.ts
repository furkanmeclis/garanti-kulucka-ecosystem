import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { LegacyRecord, LegacySource, MigrationEntity, MigrationPlan, SourceEntityRowContentChecksum } from "./types.js";

type DigestRow = { sourceId: string; checksum: string; sourceKey: string };

/** Bounded external merge preserves the old JS string sort, including integer IDs and unordered test sources. */
export class StreamingRowContentChecksum {
  private runCount = 0;
  private result?: SourceEntityRowContentChecksum;
  private ordered = true;
  private lastId: string | undefined;
  private lastKey: string | undefined;
  private rowCount = 0;
  private readonly hash;

  constructor(private readonly directory: string, private readonly entity: MigrationEntity) {
    this.hash = createHash("sha256").update(`{"entity":${JSON.stringify(entity)},"rows":[`);
  }

  async add(records: readonly LegacyRecord[]): Promise<void> {
    if (this.result) throw new Error("Row content checksum already finalized");
    const rows = records.map(({ sourceId, checksum, sourceTable }) => {
      if (!sourceId.trim()) throw new Error(`Source row content checksum for ${this.entity} received a blank source id`);
      return { sourceId: sourceId.trim(), checksum, sourceKey: `${sourceTable}:${sourceId}` };
    }).sort((a, b) => compare(a.sourceId, b.sourceId));
    for (const row of rows) {
      if (this.lastId !== undefined && compare(this.lastId, row.sourceId) > 0) this.ordered = false;
      if (this.ordered && this.lastId === row.sourceId && this.lastKey !== row.sourceKey) {
        throw new Error(`Source row content checksum for ${this.entity} received duplicate source id`);
      }
      if (this.ordered && this.lastId !== row.sourceId) {
        this.hash.update((this.rowCount ? "," : "") + JSON.stringify({ checksum: row.checksum, sourceId: row.sourceId }));
        this.rowCount++;
      }
      this.lastId = row.sourceId;
      this.lastKey = row.sourceKey;
    }
    if (!rows.length) return;
    const path = this.file(0, this.runCount++);
    await writeFile(path, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", { mode: 0o600 });
  }

  async finish(): Promise<SourceEntityRowContentChecksum> {
    if (this.result) return this.result;
    if (this.ordered) {
      this.hash.update("]}");
      return this.result = Object.freeze({ entity: this.entity, rows: this.rowCount, checksum: `sha256:${this.hash.digest("hex")}` });
    }
    // Derive run names from counters: neither live rows, descriptors nor run metadata grow with N.
    let level = 0;
    let runCount = this.runCount;
    while (runCount > 1) {
      for (let i = 0; i < runCount; i += 2) {
        const left = this.file(level, i);
        const path = this.file(level + 1, i / 2);
        if (i + 1 === runCount) { await rename(left, path); continue; }
        const right = this.file(level, i + 1);
        const output = await open(path, "w", 0o600);
        try {
          let buffer = "";
          for await (const row of merge(left, right)) {
            buffer += JSON.stringify(row) + "\n";
            if (buffer.length >= 65536) { await output.write(buffer); buffer = ""; }
          }
          if (buffer) await output.write(buffer);
        } finally { await output.close(); }
        await Promise.all([rm(left), rm(right)]);
      }
      runCount = Math.ceil(runCount / 2);
      level++;
    }
    const hash = createHash("sha256").update(`{"entity":${JSON.stringify(this.entity)},"rows":[`);
    let rows = 0;
    let previous: string | undefined;
    let previousKey: string | undefined;
    if (runCount > 0) for await (const row of readRows(this.file(level, 0))) {
      // The old orchestrator deduplicated repeated source reads, retaining the first record.
      if (row.sourceId === previous) {
        if (row.sourceKey !== previousKey) throw new Error(`Source row content checksum for ${this.entity} received duplicate source id`);
        continue;
      }
      hash.update((rows ? "," : "") + JSON.stringify({ checksum: row.checksum, sourceId: row.sourceId }));
      previous = row.sourceId;
      previousKey = row.sourceKey;
      rows++;
    }
    hash.update("]}");
    return this.result = Object.freeze({ entity: this.entity, rows, checksum: `sha256:${hash.digest("hex")}` });
  }
  private file(level: number, index: number): string {
    return join(this.directory, `${this.entity}-digest-${level}-${index}.jsonl`);
  }
}
function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
async function* readRows(path: string): AsyncGenerator<DigestRow> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try { for await (const line of lines) yield JSON.parse(line) as DigestRow; }
  finally { lines.close(); stream.destroy(); }
}
async function* merge(left: string, right: string): AsyncGenerator<DigestRow> {
  const a = readRows(left); const b = readRows(right);
  try {
    let x = await a.next(); let y = await b.next();
    while (!x.done || !y.done) {
      if (y.done || (!x.done && compare(x.value.sourceId, y.value.sourceId) <= 0)) {
        yield x.value!; x = await a.next();
      } else { yield y.value; y = await b.next(); }
    }
  } finally { await a.return(undefined); await b.return(undefined); }
}

/** Private temporary snapshot: apply hashes before any write, then replays batches without querying legacy twice. */
export class SnapshotRowContent {
  readonly source: LegacySource;
  readonly planningRecords = new Map<MigrationEntity, LegacyRecord[]>();
  private readonly digests: Map<MigrationEntity, StreamingRowContentChecksum>;
  private readonly cached = new Map<string, string>();
  private readonly continuations = new Map<MigrationEntity, { offset: number; afterSourceId: string }>();
  private constructor(private readonly directory: string, source: LegacySource,
    entities: readonly MigrationEntity[], cache: boolean) {
    this.digests = new Map(entities.map((entity) => [entity, new StreamingRowContentChecksum(directory, entity)]));
    this.source = {
      count: (entity) => source.count(entity),
      describeTables: (selected) => source.describeTables(selected),
      ...(source.describeShipmentTrackingEventSourceRows
        ? { describeShipmentTrackingEventSourceRows: () => source.describeShipmentTrackingEventSourceRows!() } : {}),
      readBatch: async (entity, options) => {
        const key = `${entity}:${options.offset ?? 0}:${options.limit}`;
        const path = this.cached.get(key);
        if (path) return JSON.parse(await readFile(path, "utf8")) as LegacyRecord[];
        const next = this.continuations.get(entity);
        const readOptions = source.supportsKeysetPagination && entity !== "shipment_tracking_events" && next !== undefined && next.offset === options.offset
          ? { limit: options.limit, afterSourceId: next.afterSourceId } : options;
        const records = await source.readBatch(entity, readOptions);
        if (records.length) this.continuations.set(entity, {
          offset: (options.offset ?? 0) + records.length, afterSourceId: records.at(-1)!.sourceId,
        });
        await this.digests.get(entity)?.add(records);
        // Business plans need three entities; tracking accounting needs shipment IDs only.
        if (cache && ["customers", "conversations", "orders", "shipments"].includes(entity)) {
          const retained = this.planningRecords.get(entity) ?? [];
          retained.push(...records.map((row) => entity === "shipments" ? { ...row, payload: {} } : row));
          this.planningRecords.set(entity, retained);
        }
        if (cache) {
          const file = join(directory, `batch-${this.cached.size}.json`);
          await writeFile(file, JSON.stringify(records), { mode: 0o600 });
          this.cached.set(key, file);
        }
        return records;
      },
    };
  }
  static async create(source: LegacySource, entities: readonly MigrationEntity[], cache: boolean): Promise<SnapshotRowContent> {
    return new SnapshotRowContent(await mkdtemp(join(tmpdir(), "migrator-snapshot-")), source, entities, cache);
  }
  async readPlan(plan: MigrationPlan): Promise<SourceEntityRowContentChecksum[]> {
    for (const batch of plan.batches) await this.source.readBatch(batch.entity, { limit: batch.limit, offset: batch.offset });
    return this.checksums();
  }
  async checksums(): Promise<SourceEntityRowContentChecksum[]> {
    const results = [];
    for (const digest of this.digests.values()) results.push(await digest.finish());
    return results;
  }
  async close(): Promise<void> { await rm(this.directory, { recursive: true, force: true }); }
}
