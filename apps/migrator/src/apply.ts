import { createHash } from "node:crypto";
import { upsertLegacyIdMap } from "./id-map.js";
import { toSafeMigratorError } from "./errors.js";
import {
  transformLegacyConversation,
  transformLegacyMessage,
  type VerifiedConversationAccount,
  type MessageTransformationResult,
} from "./conversation-mapping.js";
import {
  resolveCustomerExternalIdentities,
  transformLegacyCustomer,
  type VerifiedIntegrationAccount,
} from "./customer-mapping.js";
import type {
  BatchReadOptions,
  CanonicalRecord,
  ConversationCanonicalRecord,
  CustomerAddressCanonicalRecord,
  CustomerExternalIdentityCanonicalRecord,
  LegacyRecord,
  MessageCanonicalRecord,
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

export interface ApplyConversationMigrationBatchInput {
  readonly source: LegacySource;
  readonly target: MigrationTarget;
  readonly runId: string;
  readonly batch: MigrationBatch;
  readonly integrationAccounts: readonly VerifiedConversationAccount[];
  readonly userPublicIds?: ReadonlyMap<string, string>;
}

export interface ApplyMessageMigrationBatchInput {
  readonly source: LegacySource;
  readonly target: MigrationTarget;
  readonly runId: string;
  readonly batch: MigrationBatch;
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

export async function applyConversationMigrationBatchWithState(
  input: ApplyConversationMigrationBatchInput,
): Promise<MigrationBatchApplyResult> {
  if (input.batch.entity !== "conversations") {
    throw new Error(`Conversation writer cannot apply ${input.batch.entity} batches`);
  }

  const existing = await input.target.findMigrationBatchState({
    runId: input.runId,
    batch: input.batch,
  });
  if (existing?.status === "succeeded") {
    return migrationBatchResultFromState(existing);
  }

  try {
    return await runExclusiveSuccessfulBatchApply(input, applyConversationMigrationBatch);
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

export async function applyMessageMigrationBatchWithState(
  input: ApplyMessageMigrationBatchInput,
): Promise<MigrationBatchApplyResult> {
  if (input.batch.entity !== "messages") {
    throw new Error(`Message writer cannot apply ${input.batch.entity} batches`);
  }

  const existing = await input.target.findMigrationBatchState({
    runId: input.runId,
    batch: input.batch,
  });
  if (existing?.status === "succeeded") {
    return migrationBatchResultFromState(existing);
  }

  try {
    return await runExclusiveSuccessfulBatchApply(input, applyMessageMigrationBatch);
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

async function applyConversationMigrationBatch(
  input: ApplyConversationMigrationBatchInput,
): Promise<MigrationBatchApplyResult> {
  assertConversationTarget(input.target);
  const records = await readExpectedBatch(input);
  const result = newApplyResult(input.batch, records.length);

  for (const legacyRecord of records) {
    const customerPublicIds = await resolveRequiredLegacyMap(input.target, {
      runId: input.runId,
      sourceSystem: legacyRecord.sourceSystem,
      sourceTable: "public.musteriler",
      sourceId: requiredPayloadString(legacyRecord, "musteri_id").toLowerCase(),
      targetTable: "customers",
      mappingRole: "primary",
      errorLabel: "customer",
    });
    const conversationResult = transformLegacyConversation(legacyRecord, {
      customerPublicIds: new Map([[requiredPayloadString(legacyRecord, "musteri_id").toLowerCase(), customerPublicIds]]),
      userPublicIds: input.userPublicIds ?? new Map(),
      accounts: input.integrationAccounts,
    });
    const conversation = conversationResult.conversation;
    const conversationRecord: ConversationCanonicalRecord = {
      targetTable: "conversations",
      targetId: conversation.publicId,
      customerPublicId: conversation.customerPublicId,
      assignedUserPublicId: conversation.assignedUserPublicId,
      integrationAccountPublicId: conversation.integrationAccountPublicId,
      checksum: conversationResult.sourcePayloadChecksum,
      payload: {
        channel: conversation.channel,
        external_thread_id: conversation.external_thread_id,
        status: conversation.status,
        is_in_pool: conversation.is_in_pool,
        human_agent_enabled: conversation.human_agent_enabled,
        unread_count: conversation.unread_count,
        last_message_text: conversation.last_message_text,
        last_message_sender_type: conversation.last_message_sender_type,
        last_message_at: conversation.last_message_at,
      },
    };

    await input.target.writeConversationRecord(conversationRecord);
    result.writtenRows += 1;
    countIdMapResult(result, await upsertLegacyIdMap(input.target, {
      runId: input.runId,
      sourceSystem: legacyRecord.sourceSystem,
      sourceTable: legacyRecord.sourceTable,
      sourceId: legacyRecord.sourceId,
      targetTable: conversationRecord.targetTable,
      mappingRole: conversation.mappingRole,
      targetId: conversationRecord.targetId,
      checksum: conversationRecord.checksum,
    }));
  }

  return result;
}

async function applyMessageMigrationBatch(
  input: ApplyMessageMigrationBatchInput,
): Promise<MigrationBatchApplyResult> {
  assertMessageTarget(input.target);
  const records = await readExpectedBatch(input);
  const result = newApplyResult(input.batch, records.length);
  const transformed: {
    readonly legacyRecord: LegacyRecord;
    readonly result: MessageTransformationResult;
  }[] = [];

  for (const legacyRecord of records) {
    const legacyConversationId = requiredPayloadString(legacyRecord, "konusma_id").toLowerCase();
    const conversationPublicId = await resolveRequiredLegacyMap(input.target, {
      runId: input.runId,
      sourceSystem: legacyRecord.sourceSystem,
      sourceTable: "public.konusmalar",
      sourceId: legacyConversationId,
      targetTable: "conversations",
      mappingRole: "primary",
      errorLabel: "conversation",
    });
    transformed.push({
      legacyRecord,
      result: transformLegacyMessage(legacyRecord, {
        conversationPublicIds: new Map([[legacyConversationId, conversationPublicId]]),
      }),
    });
  }

  transformed.sort((left, right) =>
    left.result.message.sentAt.localeCompare(right.result.message.sentAt)
    || left.legacyRecord.sourceId.localeCompare(right.legacyRecord.sourceId),
  );

  for (const item of transformed) {
    const message = item.result.message;
    const rawPayload = message.rawPayload === null ? null : { ...message.rawPayload };
    assertMappedLegacyMessageRawPayload(rawPayload);
    const messageRecord: MessageCanonicalRecord = {
      targetTable: "messages",
      targetId: message.publicId,
      conversationPublicId: message.conversationPublicId,
      checksum: item.result.sourcePayloadChecksum,
      payload: {
        sender_type: message.sender_type,
        body: message.body,
        external_message_id: message.external_message_id,
        is_read: message.is_read,
        sent_at: message.sentAt,
        raw_payload: rawPayload,
      },
    };

    await input.target.writeMessageRecord(messageRecord);
    result.writtenRows += 1;
    countIdMapResult(result, await upsertLegacyIdMap(input.target, {
      runId: input.runId,
      sourceSystem: item.legacyRecord.sourceSystem,
      sourceTable: item.legacyRecord.sourceTable,
      sourceId: item.legacyRecord.sourceId,
      targetTable: messageRecord.targetTable,
      mappingRole: message.mappingRole,
      targetId: messageRecord.targetId,
      checksum: messageRecord.checksum,
    }));
  }

  return result;
}

async function readExpectedBatch(input: ApplyMigrationBatchInput): Promise<LegacyRecord[]> {
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
  return records;
}

function newApplyResult(batch: MigrationBatch, readRows: number): MutableMigrationBatchApplyResult {
  return {
    entity: batch.entity,
    batchNumber: batch.batchNumber,
    readRows,
    writtenRows: 0,
    skippedRows: 0,
    idMapCreated: 0,
    idMapUpdated: 0,
    idMapUnchanged: 0,
    warnings: [],
  };
}

async function resolveRequiredLegacyMap(
  target: MigrationTarget,
  input: {
    readonly runId: string;
    readonly sourceSystem: string;
    readonly sourceTable: string;
    readonly sourceId: string;
    readonly targetTable: string;
    readonly mappingRole: string;
    readonly errorLabel: string;
  },
): Promise<string> {
  const entry = await target.findLegacyIdMap(input);
  if (!entry) {
    throw new Error(
      `Cannot resolve ${input.errorLabel} legacy id ${input.sourceTable}.${input.sourceId} from legacy_id_map`,
    );
  }
  return entry.targetId;
}

function requiredPayloadString(record: LegacyRecord, field: string): string {
  const value = record.payload[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Cannot resolve apply prerequisite from non-string legacy field ${field}`);
  }
  return value;
}

function assertConversationTarget(
  target: MigrationTarget,
): asserts target is MigrationTarget & Required<Pick<MigrationTarget, "writeConversationRecord">> {
  if (!target.writeConversationRecord) {
    throw new Error("Conversation apply requires a target with FK-resolving conversation writer");
  }
}

function assertMessageTarget(
  target: MigrationTarget,
): asserts target is MigrationTarget & Required<Pick<MigrationTarget, "writeMessageRecord">> {
  if (!target.writeMessageRecord) {
    throw new Error("Message apply requires a target with FK-resolving message writer");
  }
}

function assertMappedLegacyMessageRawPayload(rawPayload: Record<string, unknown> | null): void {
  if (rawPayload === null) return;
  const allowed = new Set(["medya_url", "medya_tipi", "gonderici_id"]);
  const unmapped = Object.keys(rawPayload).filter((key) => !allowed.has(key)).sort();
  if (unmapped.length > 0) {
    throw new Error(`Message apply found unmapped legacy media/raw payload fields: ${unmapped.join(", ")}`);
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
