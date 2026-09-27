import { createHash } from "node:crypto";
import { upsertLegacyIdMap } from "./id-map.js";
import type {
  BatchReadOptions,
  CanonicalRecord,
  LegacyRecord,
  MigrationBatch,
  MigrationBatchApplyResult,
  MigrationTarget,
  LegacySource,
} from "./types.js";

export interface ApplyMigrationBatchInput {
  readonly source: LegacySource;
  readonly target: MigrationTarget;
  readonly batch: MigrationBatch;
  readonly transform?: LegacyRecordTransformer;
}

export type LegacyRecordTransformer = (record: LegacyRecord) => CanonicalRecord | null;

type MutableMigrationBatchApplyResult = {
  -readonly [Key in keyof MigrationBatchApplyResult]: MigrationBatchApplyResult[Key];
};

export async function applyMigrationBatch(
  input: ApplyMigrationBatchInput,
): Promise<MigrationBatchApplyResult> {
  const readOptions: BatchReadOptions = {
    limit: input.batch.limit,
    ...(input.batch.offset > 0 ? { afterSourceId: String(input.batch.offset) } : {}),
  };
  const records = await input.source.readBatch(input.batch.entity, readOptions);
  const transform = input.transform ?? defaultLegacyRecordTransformer;
  const result: MutableMigrationBatchApplyResult = {
    entity: input.batch.entity,
    batchNumber: input.batch.batchNumber,
    readRows: records.length,
    writtenRows: 0,
    skippedRows: 0,
    idMapCreated: 0,
    idMapUpdated: 0,
    idMapUnchanged: 0,
    warnings: [],
  };

  for (const legacyRecord of records) {
    const canonicalRecord = transform(legacyRecord);
    if (!canonicalRecord) {
      result.skippedRows += 1;
      result.warnings.push({
        entity: input.batch.entity,
        code: "record_skipped",
        message: `Legacy record skipped: ${legacyRecord.sourceTable}.${legacyRecord.sourceId}`,
      });
      continue;
    }

    await input.target.writeCanonicalRecord(canonicalRecord);
    result.writtenRows += 1;

    const idMapResult = await upsertLegacyIdMap(input.target, {
      sourceSystem: legacyRecord.sourceSystem,
      sourceTable: legacyRecord.sourceTable,
      sourceId: legacyRecord.sourceId,
      targetTable: canonicalRecord.targetTable,
      targetId: canonicalRecord.targetId,
      checksum: canonicalRecord.checksum,
    });

    if (idMapResult.status === "created") result.idMapCreated += 1;
    if (idMapResult.status === "updated") result.idMapUpdated += 1;
    if (idMapResult.status === "unchanged") result.idMapUnchanged += 1;
  }

  return result;
}

export function defaultLegacyRecordTransformer(record: LegacyRecord): CanonicalRecord {
  return {
    targetTable: record.sourceTable,
    targetId: stableTargetId(record),
    payload: record.payload,
    checksum: record.checksum,
  };
}

function stableTargetId(record: LegacyRecord): string {
  return createHash("sha256")
    .update(`${record.sourceSystem}:${record.sourceTable}:${record.sourceId}`)
    .digest("hex")
    .slice(0, 24);
}
