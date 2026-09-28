import { createHash } from "node:crypto";
import { upsertLegacyIdMap } from "./id-map.js";
import { toSafeMigratorError } from "./errors.js";
import type {
  BatchReadOptions,
  CanonicalRecord,
  LegacyRecord,
  MigrationBatch,
  MigrationBatchApplyResult,
  MigrationTarget,
  LegacySource,
  MigrationEntity,
} from "./types.js";

export interface ApplyMigrationBatchInput {
  readonly source: LegacySource;
  readonly target: MigrationTarget;
  readonly runId: string;
  readonly batch: MigrationBatch;
  readonly transform?: LegacyRecordTransformer;
}

export type ApplyMigrationBatchWithStateInput = ApplyMigrationBatchInput;

export type LegacyRecordTransformer = (record: LegacyRecord) => CanonicalRecord | null;

const canonicalReservedColumns = new Set(["id", "public_id", "created_at", "updated_at"]);

type MutableMigrationBatchApplyResult = {
  -readonly [Key in keyof MigrationBatchApplyResult]: MigrationBatchApplyResult[Key];
};

export async function applyMigrationBatch(
  input: ApplyMigrationBatchInput,
): Promise<MigrationBatchApplyResult> {
  const readOptions: BatchReadOptions = {
    limit: input.batch.limit,
    ...(input.batch.offset > 0 ? { offset: input.batch.offset } : {}),
  };
  const records = await input.source.readBatch(input.batch.entity, readOptions);
  if (records.length !== input.batch.expectedRows) {
    throw new Error(
      `Migration batch short read for ${input.batch.entity} batch ${input.batch.batchNumber}: expected ${input.batch.expectedRows}, received ${records.length}`,
    );
  }
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
      runId: input.runId,
      sourceSystem: legacyRecord.sourceSystem,
      sourceTable: legacyRecord.sourceTable,
      sourceId: legacyRecord.sourceId,
      targetTable: canonicalRecord.targetTable,
      mappingRole: "primary",
      targetId: canonicalRecord.targetId,
      checksum: canonicalRecord.checksum,
    });

    if (idMapResult.status === "created") result.idMapCreated += 1;
    if (idMapResult.status === "updated") result.idMapUpdated += 1;
    if (idMapResult.status === "unchanged") result.idMapUnchanged += 1;
  }

  return result;
}

export async function applyMigrationBatchWithState(
  input: ApplyMigrationBatchWithStateInput,
): Promise<MigrationBatchApplyResult> {
  const existing = await input.target.findMigrationBatchState({
    runId: input.runId,
    batch: input.batch,
  });
  if (existing?.status === "succeeded") {
    return migrationBatchResultFromState(existing);
  }

  await input.target.recordMigrationBatchStarted({
    runId: input.runId,
    batch: input.batch,
  });

  try {
    const result = await applyMigrationBatch(input);
    await input.target.recordMigrationBatchSucceeded({
      runId: input.runId,
      batch: input.batch,
      result,
    });
    return result;
  } catch (error) {
    const safeError = toSafeMigratorError(error);
    await input.target.recordMigrationBatchFailed({
      runId: input.runId,
      batch: input.batch,
      error: safeError,
    });
    throw safeError;
  }
}

function migrationBatchResultFromState(state: {
  readonly entity: MigrationBatch["entity"];
  readonly batchNumber: number;
  readonly readRows: number;
  readonly writtenRows: number;
  readonly skippedRows: number;
  readonly idMapCreated: number;
  readonly idMapUpdated: number;
  readonly idMapUnchanged: number;
  readonly warnings: MigrationBatchApplyResult["warnings"];
}): MigrationBatchApplyResult {
  return {
    entity: state.entity,
    batchNumber: state.batchNumber,
    readRows: state.readRows,
    writtenRows: state.writtenRows,
    skippedRows: state.skippedRows,
    idMapCreated: state.idMapCreated,
    idMapUpdated: state.idMapUpdated,
    idMapUnchanged: state.idMapUnchanged,
    warnings: state.warnings,
  };
}

export function defaultLegacyRecordTransformer(record: LegacyRecord): CanonicalRecord {
  return {
    targetTable: record.sourceTable,
    targetId: stableTargetId(record),
    payload: record.payload,
    checksum: record.checksum,
  };
}

export function createCanonicalEntityTransformer(entity: MigrationEntity): LegacyRecordTransformer {
  return (record) => {
    const canonical = defaultLegacyRecordTransformer(record);
    const payload = Object.fromEntries(
      Object.entries(canonical.payload).filter(([column]) => !canonicalReservedColumns.has(column)),
    );

    return {
      ...canonical,
      targetTable: entity,
      payload,
    };
  };
}

function stableTargetId(record: LegacyRecord): string {
  return createHash("sha256")
    .update(`${record.sourceSystem}:${record.sourceTable}:${record.sourceId}`)
    .digest("hex")
    .slice(0, 24);
}
