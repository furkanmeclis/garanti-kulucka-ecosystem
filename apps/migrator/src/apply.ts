import { createHash } from "node:crypto";
import { upsertLegacyIdMap } from "./id-map.js";
import { toSafeMigratorError } from "./errors.js";
import {
  resolveCustomerExternalIdentities,
  transformLegacyCustomer,
  type VerifiedIntegrationAccount,
} from "./customer-mapping.js";
import type {
  BatchReadOptions,
  CanonicalRecord,
  CustomerAddressCanonicalRecord,
  CustomerExternalIdentityCanonicalRecord,
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

export interface ApplyCustomerMigrationBatchInput {
  readonly source: LegacySource;
  readonly target: MigrationTarget;
  readonly runId: string;
  readonly batch: MigrationBatch;
  readonly integrationAccounts: readonly VerifiedIntegrationAccount[];
}

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

  try {
    return await runExclusiveSuccessfulBatchApply(input);
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

export async function applyCustomerMigrationBatchWithState(
  input: ApplyCustomerMigrationBatchInput,
): Promise<MigrationBatchApplyResult> {
  if (input.batch.entity !== "customers") {
    throw new Error(`Customer fan-out writer cannot apply ${input.batch.entity} batches`);
  }

  const existing = await input.target.findMigrationBatchState({
    runId: input.runId,
    batch: input.batch,
  });
  if (existing?.status === "succeeded") {
    return migrationBatchResultFromState(existing);
  }

  try {
    return await runExclusiveSuccessfulBatchApply(input, applyCustomerMigrationBatch);
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

async function runExclusiveSuccessfulBatchApply<TInput extends ApplyMigrationBatchWithStateInput>(
  input: TInput,
  apply: (input: TInput) => Promise<MigrationBatchApplyResult> = applyMigrationBatch,
): Promise<MigrationBatchApplyResult> {
  return input.target.runWithMigrationRunLock
    ? input.target.runWithMigrationRunLock(input.runId, async (target) => {
      const existing = await target.findMigrationBatchState({
        runId: input.runId,
        batch: input.batch,
      });
      if (existing?.status === "succeeded") {
        return migrationBatchResultFromState(existing);
      }
      return runSuccessfulBatchApply({ ...input, target }, apply);
    })
    : runSuccessfulBatchApply(input, apply);
}

async function runSuccessfulBatchApply<TInput extends ApplyMigrationBatchWithStateInput>(
  input: TInput,
  apply: (input: TInput) => Promise<MigrationBatchApplyResult>,
): Promise<MigrationBatchApplyResult> {
  const operation = async (target: MigrationTarget) => {
    await target.recordMigrationBatchStarted({
      runId: input.runId,
      batch: input.batch,
    });

    const result = await apply({ ...input, target });
    await target.recordMigrationBatchSucceeded({
      runId: input.runId,
      batch: input.batch,
      result,
    });
    return result;
  };

  return input.target.runInTransaction
    ? input.target.runInTransaction(operation)
    : operation(input.target);
}

async function applyCustomerMigrationBatch(
  input: ApplyCustomerMigrationBatchInput,
): Promise<MigrationBatchApplyResult> {
  assertCustomerFanOutTarget(input.target);
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
    const customerResult = transformLegacyCustomer(legacyRecord);
    const resolution = resolveCustomerExternalIdentities(
      customerResult.externalIdentityCandidates,
      input.integrationAccounts,
    );
    if (resolution.unresolved.length > 0) {
      const providers = [...new Set(resolution.unresolved.map((identity) => identity.providerKey))].sort();
      throw new Error(
        `Customer external identity apply requires resolved integration accounts for providers: ${providers.join(", ")}`,
      );
    }

    const customerRecord: CanonicalRecord = {
      targetTable: "customers",
      targetId: customerResult.customer.publicId,
      checksum: customerResult.sourcePayloadChecksum,
      payload: {
        full_name: customerResult.customer.full_name,
        phone: customerResult.customer.phone,
        email: customerResult.customer.email,
        username: customerResult.customer.username,
        notes: customerResult.customer.notes,
      },
    };

    await input.target.writeCanonicalRecord(customerRecord);
    result.writtenRows += 1;
    countIdMapResult(result, await upsertLegacyIdMap(input.target, {
      runId: input.runId,
      sourceSystem: legacyRecord.sourceSystem,
      sourceTable: legacyRecord.sourceTable,
      sourceId: legacyRecord.sourceId,
      targetTable: customerRecord.targetTable,
      mappingRole: customerResult.customer.mappingRole,
      targetId: customerRecord.targetId,
      checksum: customerRecord.checksum,
    }));

    if (customerResult.address) {
      const addressRecord: CustomerAddressCanonicalRecord = {
        targetTable: customerResult.address.targetTable,
        targetId: customerResult.address.publicId,
        customerPublicId: customerResult.address.customerPublicId,
        checksum: customerResult.sourcePayloadChecksum,
        payload: {
          label: customerResult.address.label,
          address_line: customerResult.address.address_line,
          district: customerResult.address.district,
          city: customerResult.address.city,
          country: customerResult.address.country,
          postal_code: customerResult.address.postal_code,
          is_default: customerResult.address.is_default,
        },
      };
      await input.target.writeCustomerAddressRecord(addressRecord);
      result.writtenRows += 1;
      countIdMapResult(result, await upsertLegacyIdMap(input.target, {
        runId: input.runId,
        sourceSystem: legacyRecord.sourceSystem,
        sourceTable: legacyRecord.sourceTable,
        sourceId: legacyRecord.sourceId,
        targetTable: addressRecord.targetTable,
        mappingRole: customerResult.address.mappingRole,
        targetId: addressRecord.targetId,
        checksum: addressRecord.checksum,
      }));
    }

    for (const identity of resolution.resolved) {
      const identityRecord: CustomerExternalIdentityCanonicalRecord = {
        targetTable: identity.targetTable,
        targetId: identity.publicId,
        customerPublicId: identity.customerPublicId,
        integrationAccountPublicId: identity.integrationAccountPublicId,
        checksum: customerResult.sourcePayloadChecksum,
        payload: {
          external_id: identity.externalId,
          metadata: {
            source_table: legacyRecord.sourceTable,
            source_field: customerResult.externalIdentityCandidates.find((candidate) =>
              candidate.providerKey === identity.mappingRole.slice("external_identity:".length)
              && candidate.externalId === identity.externalId
            )?.source.field ?? null,
          },
        },
      };
      await input.target.writeCustomerExternalIdentityRecord(identityRecord);
      result.writtenRows += 1;
      countIdMapResult(result, await upsertLegacyIdMap(input.target, {
        runId: input.runId,
        sourceSystem: legacyRecord.sourceSystem,
        sourceTable: legacyRecord.sourceTable,
        sourceId: legacyRecord.sourceId,
        targetTable: identityRecord.targetTable,
        mappingRole: identity.mappingRole,
        targetId: identityRecord.targetId,
        checksum: identityRecord.checksum,
      }));
    }
  }

  return result;
}

function assertCustomerFanOutTarget(
  target: MigrationTarget,
): asserts target is MigrationTarget & Required<Pick<
  MigrationTarget,
  "writeCustomerAddressRecord" | "writeCustomerExternalIdentityRecord"
>> {
  if (!target.writeCustomerAddressRecord || !target.writeCustomerExternalIdentityRecord) {
    throw new Error("Customer fan-out apply requires a target with FK-resolving customer fan-out writers");
  }
}

function countIdMapResult(
  result: MutableMigrationBatchApplyResult,
  idMapResult: Awaited<ReturnType<typeof upsertLegacyIdMap>>,
): void {
  if (idMapResult.status === "created") result.idMapCreated += 1;
  if (idMapResult.status === "updated") result.idMapUpdated += 1;
  if (idMapResult.status === "unchanged") result.idMapUnchanged += 1;
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
