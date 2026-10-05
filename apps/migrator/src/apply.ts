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
import { transformLegacyOrder } from "./order-mapping.js";
import { transformLegacyOrderItem } from "./order-item-mapping.js";
import { transformLegacyProduct } from "./product-mapping.js";
import { transformLegacyShipment } from "./shipment-mapping.js";
import type { MigratorMediaStorage } from "./media-storage.js";
import type {
  BatchReadOptions,
  CanonicalRecord,
  ConversationCanonicalRecord,
  CustomerAddressCanonicalRecord,
  CustomerExternalIdentityCanonicalRecord,
  DeferredReconciliationResult,
  LegacyIdMapEntry,
  LegacyRecord,
  MessageCanonicalRecord,
  FileCanonicalRecord,
  MessageAttachmentCanonicalRecord,
  MigrationBatch,
  MigrationBatchApplyResult,
  MigrationTarget,
  LegacySource,
  MigrationEntity,
  OrderCanonicalRecord,
  OrderItemCanonicalRecord,
  ShipmentCanonicalRecord,
  ShipmentTrackingEventCanonicalRecord,
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
  readonly mediaStorage?: MigratorMediaStorage;
}

export interface ApplyProductMigrationBatchInput {
  readonly source: LegacySource;
  readonly target: MigrationTarget;
  readonly runId: string;
  readonly batch: MigrationBatch;
}

export interface ApplyOrderMigrationBatchInput {
  readonly source: LegacySource;
  readonly target: MigrationTarget;
  readonly runId: string;
  readonly batch: MigrationBatch;
  readonly userPublicIds?: ReadonlyMap<string, string>;
}

export interface ApplyOrderItemMigrationBatchInput {
  readonly source: LegacySource;
  readonly target: MigrationTarget;
  readonly runId: string;
  readonly batch: MigrationBatch;
}

export interface ApplyShipmentMigrationBatchInput {
  readonly source: LegacySource;
  readonly target: MigrationTarget;
  readonly runId: string;
  readonly batch: MigrationBatch;
}

export interface ApplyShipmentTrackingEventMigrationBatchInput {
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

export async function applyProductMigrationBatchWithState(
  input: ApplyProductMigrationBatchInput,
): Promise<MigrationBatchApplyResult> {
  if (input.batch.entity !== "products") {
    throw new Error(`Product writer cannot apply ${input.batch.entity} batches`);
  }

  const existing = await input.target.findMigrationBatchState({
    runId: input.runId,
    batch: input.batch,
  });
  if (existing?.status === "succeeded") {
    return migrationBatchResultFromState(existing);
  }

  try {
    return await runExclusiveSuccessfulBatchApply(input, applyProductMigrationBatch);
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

export async function applyOrderMigrationBatchWithState(
  input: ApplyOrderMigrationBatchInput,
): Promise<MigrationBatchApplyResult> {
  if (input.batch.entity !== "orders") {
    throw new Error(`Order writer cannot apply ${input.batch.entity} batches`);
  }

  const existing = await input.target.findMigrationBatchState({
    runId: input.runId,
    batch: input.batch,
  });
  if (existing?.status === "succeeded") {
    return migrationBatchResultFromState(existing);
  }

  try {
    return await runExclusiveSuccessfulBatchApply(input, applyOrderMigrationBatch);
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

export async function applyOrderItemMigrationBatchWithState(
  input: ApplyOrderItemMigrationBatchInput,
): Promise<MigrationBatchApplyResult> {
  if (input.batch.entity !== "order_items") {
    throw new Error(`Order item writer cannot apply ${input.batch.entity} batches`);
  }

  const existing = await input.target.findMigrationBatchState({
    runId: input.runId,
    batch: input.batch,
  });
  if (existing?.status === "succeeded") {
    return migrationBatchResultFromState(existing);
  }

  try {
    return await runExclusiveSuccessfulBatchApply(input, applyOrderItemMigrationBatch);
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

export async function applyShipmentMigrationBatchWithState(
  input: ApplyShipmentMigrationBatchInput,
): Promise<MigrationBatchApplyResult> {
  if (input.batch.entity !== "shipments") {
    throw new Error(`Shipment writer cannot apply ${input.batch.entity} batches`);
  }

  const existing = await input.target.findMigrationBatchState({
    runId: input.runId,
    batch: input.batch,
  });
  if (existing?.status === "succeeded") {
    return migrationBatchResultFromState(existing);
  }

  try {
    return await runExclusiveSuccessfulBatchApply(input, applyShipmentMigrationBatch);
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

export async function applyShipmentTrackingEventMigrationBatchWithState(
  input: ApplyShipmentTrackingEventMigrationBatchInput,
): Promise<MigrationBatchApplyResult> {
  if (input.batch.entity !== "shipment_tracking_events") {
    throw new Error(`Shipment tracking event writer cannot apply ${input.batch.entity} batches`);
  }

  const existing = await input.target.findMigrationBatchState({
    runId: input.runId,
    batch: input.batch,
  });
  if (existing?.status === "succeeded") {
    return migrationBatchResultFromState(existing);
  }

  try {
    return await runExclusiveSuccessfulBatchApply(input, applyShipmentTrackingEventMigrationBatch);
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

export async function reconcileDeferredReconciliations(
  target: MigrationTarget,
  runId: string,
): Promise<DeferredReconciliationResult> {
  assertDeferredReconciliationTarget(target);
  return target.reconcileDeferredReconciliations(runId);
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
  if (transformed.some((item) => messageInlineMediaUrl(toRawPayloadRecord(item.result.message.rawPayload)) !== null)) {
    assertInlineMediaApplyTarget(input.target);
    if (!input.mediaStorage) {
      throw new Error("Message apply requires migrator media storage configuration for inline data URLs");
    }
  }

  transformed.sort((left, right) =>
    left.result.message.sentAt.localeCompare(right.result.message.sentAt)
    || left.legacyRecord.sourceId.localeCompare(right.legacyRecord.sourceId),
  );

  for (const item of transformed) {
    const message = item.result.message;
    const rawPayload = toRawPayloadRecord(message.rawPayload);
    assertMappedLegacyMessageRawPayload(rawPayload);
    const inlineMediaUrl = messageInlineMediaUrl(rawPayload);
    let inlineMedia: Awaited<ReturnType<MigratorMediaStorage["storeInlineDataUrl"]>> | null = null;
    if (inlineMediaUrl !== null) {
      inlineMedia = await input.mediaStorage!.storeInlineDataUrl({
        dataUrl: inlineMediaUrl,
        sourceTable: item.legacyRecord.sourceTable,
        sourceId: item.legacyRecord.sourceId,
      });
      delete rawPayload!.media_url;
      rawPayload!.media_storage = {
        bucket: inlineMedia.bucket,
        object_key: inlineMedia.objectKey,
        checksum: inlineMedia.checksum,
        mime_type: inlineMedia.mimeType,
        byte_size: inlineMedia.size,
      };
    }
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
    if (inlineMedia !== null) {
      const fileRecord: FileCanonicalRecord = {
        targetTable: "files",
        targetId: filePublicId(inlineMedia.checksum),
        checksum: inlineMedia.checksum,
        payload: {
          bucket: inlineMedia.bucket,
          object_key: inlineMedia.objectKey,
          original_name: null,
          mime_type: inlineMedia.mimeType,
          byte_size: inlineMedia.size,
          checksum: inlineMedia.checksum,
          upload_status: "available",
          scan_status: "skipped",
          upload_type: "singlepart",
          completed_at: message.sentAt,
        },
      };
      await input.target.writeFileRecord!(fileRecord);
      const attachmentRecord: MessageAttachmentCanonicalRecord = {
        targetTable: "message_attachments",
        targetId: messageAttachmentPublicId(message.publicId, inlineMedia.checksum),
        messagePublicId: message.publicId,
        filePublicId: fileRecord.targetId,
        checksum: inlineMedia.checksum,
        payload: {
          attachment_type: inlineMedia.mimeType.split("/")[0] || "file",
        },
      };
      await input.target.writeMessageAttachmentRecord!(attachmentRecord);
      result.writtenRows += 2;
    }
  }

  return result;
}

async function applyProductMigrationBatch(
  input: ApplyProductMigrationBatchInput,
): Promise<MigrationBatchApplyResult> {
  const records = await readExpectedBatch(input);
  const result = newApplyResult(input.batch, records.length);

  for (const legacyRecord of records) {
    const productResult = transformLegacyProduct(legacyRecord);
    const product = productResult.product;
    const productRecord: CanonicalRecord = {
      targetTable: product.targetTable,
      targetId: product.publicId,
      checksum: productResult.sourcePayloadChecksum,
      payload: {
        sku: product.sku,
        name: product.name,
        category: product.category,
        unit_price: product.unitPrice,
        stock_quantity: product.stockQuantity,
        is_active: product.isActive,
        external_product_id: product.externalProductId,
      },
    };

    await input.target.writeCanonicalRecord(productRecord);
    result.writtenRows += 1;
    countIdMapResult(result, await upsertLegacyIdMap(input.target, {
      runId: input.runId,
      sourceSystem: legacyRecord.sourceSystem,
      sourceTable: legacyRecord.sourceTable,
      sourceId: legacyRecord.sourceId,
      targetTable: productRecord.targetTable,
      mappingRole: product.mappingRole,
      targetId: productRecord.targetId,
      checksum: productRecord.checksum,
    }));
  }

  return result;
}

async function applyOrderMigrationBatch(
  input: ApplyOrderMigrationBatchInput,
): Promise<MigrationBatchApplyResult> {
  assertOrderTarget(input.target);
  const records = await readExpectedBatch(input);
  const result = newApplyResult(input.batch, records.length);

  for (const legacyRecord of records) {
    const legacyCustomerId = requiredPayloadString(legacyRecord, "musteri_id").toLowerCase();
    const customerPublicId = await resolveRequiredLegacyMap(input.target, {
      runId: input.runId,
      sourceSystem: legacyRecord.sourceSystem,
      sourceTable: "public.musteriler",
      sourceId: legacyCustomerId,
      targetTable: "customers",
      mappingRole: "primary",
      errorLabel: "customer",
    });

    const conversationPublicIds = new Map<string, string>();
    const legacyConversationId = optionalPayloadString(legacyRecord, "konusma_id")?.toLowerCase() ?? null;
    if (legacyConversationId !== null) {
      const conversationEntry = await input.target.findLegacyIdMap({
        runId: input.runId,
        sourceSystem: legacyRecord.sourceSystem,
        sourceTable: "public.konusmalar",
        sourceId: legacyConversationId,
        targetTable: "conversations",
        mappingRole: "primary",
      });
      if (conversationEntry) conversationPublicIds.set(legacyConversationId, conversationEntry.targetId);
    }

    const orderResult = transformLegacyOrder(legacyRecord, {
      customerPublicIds: new Map([[legacyCustomerId, customerPublicId]]),
      conversationPublicIds,
      userPublicIds: input.userPublicIds ?? new Map(),
    });
    const order = orderResult.order;
    const orderRecord: OrderCanonicalRecord = {
      targetTable: order.targetTable,
      targetId: order.publicId,
      customerPublicId: order.customerPublicId,
      conversationPublicId: order.conversationPublicId,
      createdByUserPublicId: order.createdByUserPublicId,
      checksum: orderResult.sourcePayloadChecksum,
      payload: {
        order_number: order.orderNumber,
        status: order.status,
        source: order.source,
        total_amount: order.totalAmount,
        manual_adjustment_amount: "0.00",
        currency: order.currency,
        confirmation_status: order.confirmationStatus,
        notes: order.notes,
        external_order_id: order.externalOrderId,
      },
    };

    await input.target.writeOrderRecord(orderRecord);
    result.writtenRows += 1;
    countIdMapResult(result, await upsertLegacyIdMap(input.target, {
      runId: input.runId,
      sourceSystem: legacyRecord.sourceSystem,
      sourceTable: legacyRecord.sourceTable,
      sourceId: legacyRecord.sourceId,
      targetTable: orderRecord.targetTable,
      mappingRole: order.mappingRole,
      targetId: orderRecord.targetId,
      checksum: orderRecord.checksum,
    }));
    const trackingNumber = normalizedPayloadString(legacyRecord, "kargo_takip_no");
    if (trackingNumber !== null) {
      // Shipments link through legacy tracking numbers, so apply records a role-scoped order lookup.
      countIdMapResult(result, await upsertLegacyIdMap(input.target, {
        runId: input.runId,
        sourceSystem: legacyRecord.sourceSystem,
        sourceTable: legacyRecord.sourceTable,
        sourceId: legacyRecord.sourceId,
        targetTable: orderRecord.targetTable,
        mappingRole: orderTrackingMappingRole(trackingNumber),
        targetId: orderRecord.targetId,
        checksum: orderRecord.checksum,
      }));
    }

    for (const reconciliation of orderResult.reconciliation) {
      if (reconciliation.code === "unresolved_conversation") {
        await input.target.recordDeferredReconciliation({
          runId: input.runId,
          sourceSystem: legacyRecord.sourceSystem,
          sourceTable: legacyRecord.sourceTable,
          sourceId: legacyRecord.sourceId,
          targetTable: orderRecord.targetTable,
          targetId: orderRecord.targetId,
          targetColumn: "conversation_id",
          lookupSourceTable: "public.konusmalar",
          lookupSourceId: reconciliation.legacyConversationId,
          lookupTargetTable: "conversations",
          lookupMappingRole: "primary",
        });
        result.warnings.push({
          entity: input.batch.entity,
          code: "deferred_reconciliation",
          message: `Deferred order conversation FK for ${legacyRecord.sourceTable}.${legacyRecord.sourceId}`,
        });
      }
      if (reconciliation.code === "unresolved_created_by") {
        result.warnings.push({
          entity: input.batch.entity,
          code: "unresolved_optional_user",
          message: `Order creator legacy id ${reconciliation.legacyUserId} was not mapped`,
        });
      }
    }
  }

  return result;
}

async function applyOrderItemMigrationBatch(
  input: ApplyOrderItemMigrationBatchInput,
): Promise<MigrationBatchApplyResult> {
  assertOrderItemTarget(input.target);
  const records = await readExpectedBatch(input);
  const result = newApplyResult(input.batch, records.length);
  const touchedOrders = new Set<string>();

  for (const legacyRecord of records) {
    const legacyOrderId = requiredPayloadString(legacyRecord, "siparis_id").toLowerCase();
    const orderPublicId = await resolveRequiredLegacyMap(input.target, {
      runId: input.runId,
      sourceSystem: legacyRecord.sourceSystem,
      sourceTable: "public.siparisler",
      sourceId: legacyOrderId,
      targetTable: "orders",
      mappingRole: "primary",
      errorLabel: "order",
    });
    const sku = optionalPayloadString(legacyRecord, "urun_kodu");
    const externalProductId = optionalPayloadString(legacyRecord, "kolaybi_product_id");
    const productPublicIdsBySku = new Map<string, string>();
    const productPublicIdsByExternalId = new Map<string, string>();
    if (sku !== null) {
      const productPublicId = await input.target.findProductPublicIdBySku(sku);
      if (productPublicId !== null) productPublicIdsBySku.set(sku, productPublicId);
    }
    if (externalProductId !== null) {
      const productPublicId = await input.target.findProductPublicIdByExternalId(externalProductId);
      if (productPublicId !== null) productPublicIdsByExternalId.set(externalProductId, productPublicId);
    }

    const itemResult = transformLegacyOrderItem(legacyRecord, {
      orderPublicIds: new Map([[legacyOrderId, orderPublicId]]),
      productPublicIdsBySku,
      productPublicIdsByExternalId,
    });
    const item = itemResult.orderItem;
    if (item.productPublicId === null) {
      throw new Error(
        `Cannot resolve product FK for order item ${legacyRecord.sourceTable}.${legacyRecord.sourceId}`,
      );
    }

    const itemRecord: OrderItemCanonicalRecord = {
      targetTable: item.targetTable,
      targetId: item.publicId,
      orderPublicId: item.orderPublicId,
      productPublicId: item.productPublicId,
      checksum: itemResult.sourcePayloadChecksum,
      payload: {
        name: item.name,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        total_amount: item.totalAmount,
        external_product_id: item.externalProductId,
      },
    };

    await input.target.writeOrderItemRecord(itemRecord);
    touchedOrders.add(item.orderPublicId);
    result.writtenRows += 1;
    countIdMapResult(result, await upsertLegacyIdMap(input.target, {
      runId: input.runId,
      sourceSystem: legacyRecord.sourceSystem,
      sourceTable: legacyRecord.sourceTable,
      sourceId: legacyRecord.sourceId,
      targetTable: itemRecord.targetTable,
      mappingRole: item.mappingRole,
      targetId: itemRecord.targetId,
      checksum: itemRecord.checksum,
    }));
  }

  for (const orderPublicId of touchedOrders) {
    const adjustment = input.target.calculateOrderTotalAdjustment
      ? await input.target.calculateOrderTotalAdjustment({ orderPublicId })
      : await legacyOrderAdjustmentFallback(input.target, orderPublicId);
    if (adjustment.itemCount === 0) {
      result.warnings.push({
        entity: input.batch.entity,
        code: "order_total_no_item_check",
        message: `Order has no item total check: ${orderPublicId}`,
      });
      continue;
    }
    if (Math.abs(Number(adjustment.adjustmentAmount)) > 0.01) {
      await input.target.recordOrderManualAdjustment?.({
        orderPublicId,
        manualAdjustmentAmount: adjustment.adjustmentAmount,
      });
      result.warnings.push({
        entity: input.batch.entity,
        code: "order_total_manual_adjustment",
        message: `Order total adjustment recorded for ${orderPublicId}: ${adjustment.adjustmentAmount}`,
      });
    }
  }

  return result;
}

async function applyShipmentMigrationBatch(
  input: ApplyShipmentMigrationBatchInput,
): Promise<MigrationBatchApplyResult> {
  assertShipmentTarget(input.target);
  const records = await readExpectedBatch(input);
  const result = newApplyResult(input.batch, records.length);

  for (const legacyRecord of records) {
    const orderResolution = await resolveShipmentOrderByTracking(input.target, {
      runId: input.runId,
      sourceSystem: legacyRecord.sourceSystem,
      trackingNumbers: shipmentTrackingCandidates(legacyRecord),
    });

    const legacyCustomerId = optionalPayloadString(legacyRecord, "musteri_id")?.toLowerCase() ?? null;
    const customerEntry = legacyCustomerId === null
      ? null
      : await input.target.findLegacyIdMap({
        runId: input.runId,
        sourceSystem: legacyRecord.sourceSystem,
        sourceTable: "public.musteriler",
        sourceId: legacyCustomerId,
        targetTable: "customers",
        mappingRole: "primary",
      });
    const shipmentResult = transformLegacyShipment(legacyRecord, {
      customerPublicIds: customerEntry === null || legacyCustomerId === null
        ? new Map()
        : new Map([[legacyCustomerId, customerEntry.targetId]]),
    });
    const shipment = shipmentResult.shipment;
    const shipmentRecord: ShipmentCanonicalRecord = {
      targetTable: shipment.targetTable,
      targetId: shipment.publicId,
      orderPublicId: orderResolution.order?.targetId ?? null,
      customerPublicId: shipment.customerPublicId,
      checksum: shipmentResult.sourcePayloadChecksum,
      payload: {
        provider: shipment.provider,
        tracking_number: shipment.trackingNumber,
        barcode_number: shipment.barcodeNumber,
        status: shipment.status,
        recipient_name: shipment.recipientName,
        recipient_phone: shipment.recipientPhone,
        recipient_address: shipment.recipientAddress,
        recipient_city: shipment.recipientCity,
        recipient_district: shipment.recipientDistrict,
        last_event_text: shipment.lastEventText,
        shipped_at: shipment.shippedAt,
        delivered_at: shipment.deliveredAt,
        raw_payload: shipment.rawPayload,
      },
    };

    await input.target.writeShipmentRecord(shipmentRecord);
    result.writtenRows += 1;
    countIdMapResult(result, await upsertLegacyIdMap(input.target, {
      runId: input.runId,
      sourceSystem: legacyRecord.sourceSystem,
      sourceTable: legacyRecord.sourceTable,
      sourceId: legacyRecord.sourceId,
      targetTable: shipmentRecord.targetTable,
      mappingRole: shipment.mappingRole,
      targetId: shipmentRecord.targetId,
      checksum: shipmentRecord.checksum,
    }));

    if (orderResolution.order === null) {
      const lookup = orderResolution.deferredTrackingNumber ?? `missing:${legacyRecord.sourceId}`;
      await input.target.recordDeferredReconciliation({
        runId: input.runId,
        sourceSystem: legacyRecord.sourceSystem,
        sourceTable: legacyRecord.sourceTable,
        sourceId: legacyRecord.sourceId,
        targetTable: shipmentRecord.targetTable,
        targetId: shipmentRecord.targetId,
        targetColumn: "order_id",
        lookupSourceTable: "public.siparisler",
        lookupSourceId: lookup,
        lookupTargetTable: "orders",
        lookupMappingRole: orderTrackingMappingRole(lookup),
      });
      result.warnings.push({
        entity: input.batch.entity,
        code: orderResolution.ambiguous ? "ambiguous_tracking_reconciliation" : "deferred_reconciliation",
        message: `Deferred shipment order FK for ${legacyRecord.sourceTable}.${legacyRecord.sourceId}`,
      });
    }
  }

  return result;
}

async function applyShipmentTrackingEventMigrationBatch(
  input: ApplyShipmentTrackingEventMigrationBatchInput,
): Promise<MigrationBatchApplyResult> {
  assertShipmentTrackingEventTarget(input.target);
  const records = await readExpectedBatch(input);
  const result = newApplyResult(input.batch, records.length);

  for (const legacyRecord of records) {
    const rawRowCount = requiredPayloadInteger(legacyRecord, "raw_row_count");
    const timeSource = requiredPayloadString(legacyRecord, "time_source");
    if (timeSource === "future_excluded") {
      result.skippedRows += 1;
      result.warnings.push({
        entity: input.batch.entity,
        code: "future_dated_tracking_event",
        message: `Excluded future-dated shipment tracking event ${legacyRecord.sourceTable}.${legacyRecord.sourceId}`,
      });
      continue;
    }
    if (timeSource !== "provider" && timeSource !== "first_seen") {
      throw new Error(`Shipment tracking event has unsupported time_source ${timeSource}`);
    }

    const legacyShipmentId = optionalPayloadString(legacyRecord, "kargo_id")?.toLowerCase() ?? null;
    const shipmentEntry = legacyShipmentId === null
      ? null
      : await input.target.findLegacyIdMap({
        runId: input.runId,
        sourceSystem: legacyRecord.sourceSystem,
        sourceTable: "public.kargo_gonderimleri",
        sourceId: legacyShipmentId,
        targetTable: "shipments",
        mappingRole: "primary",
      });
    if (shipmentEntry === null) {
      const lookup = legacyShipmentId ?? `missing:${legacyRecord.sourceId}`;
      await input.target.recordDeferredReconciliation({
        runId: input.runId,
        sourceSystem: legacyRecord.sourceSystem,
        sourceTable: legacyRecord.sourceTable,
        sourceId: legacyRecord.sourceId,
        targetTable: "shipment_tracking_events",
        targetId: shipmentTrackingEventPublicId(legacyRecord.sourceId),
        targetColumn: "shipment_id",
        lookupSourceTable: "public.kargo_gonderimleri",
        lookupSourceId: lookup,
        lookupTargetTable: "shipments",
        lookupMappingRole: "primary",
      });
      result.warnings.push({
        entity: input.batch.entity,
        code: "deferred_reconciliation",
        message: `Deferred shipment tracking event FK for ${legacyRecord.sourceTable}.${legacyRecord.sourceId}`,
      });
      continue;
    }

    const eventRecord: ShipmentTrackingEventCanonicalRecord = {
      targetTable: "shipment_tracking_events",
      targetId: shipmentTrackingEventPublicId(legacyRecord.sourceId),
      shipmentPublicId: shipmentEntry.targetId,
      checksum: legacyRecord.checksum,
      payload: {
        status: requiredPayloadString(legacyRecord, "durum"),
        description: optionalPayloadString(legacyRecord, "aciklama"),
        location: optionalPayloadString(legacyRecord, "lokasyon"),
        occurred_at: requiredPayloadString(legacyRecord, "event_time"),
        raw_payload: {
          representative_source_id: optionalPayloadString(legacyRecord, "representative_source_id"),
          kargo_id: legacyShipmentId,
          time_source: timeSource,
          raw_row_count: rawRowCount,
          is_provider_timestamp: timeSource === "provider",
        },
      },
    };
    await input.target.writeShipmentTrackingEventRecord(eventRecord);
    result.writtenRows += 1;
    countIdMapResult(result, await upsertLegacyIdMap(input.target, {
      runId: input.runId,
      sourceSystem: legacyRecord.sourceSystem,
      sourceTable: legacyRecord.sourceTable,
      sourceId: legacyRecord.sourceId,
      targetTable: eventRecord.targetTable,
      mappingRole: timeSource,
      targetId: eventRecord.targetId,
      checksum: eventRecord.checksum,
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

function optionalPayloadString(record: LegacyRecord, field: string): string | null {
  if (!Object.hasOwn(record.payload, field)) return null;
  const value = record.payload[field];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`Cannot resolve apply prerequisite from non-string legacy field ${field}`);
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function requiredPayloadInteger(record: LegacyRecord, field: string): number {
  const value = record.payload[field];
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) return Number(value);
  throw new Error(`Cannot resolve apply prerequisite from non-integer legacy field ${field}`);
}

function normalizedPayloadString(record: LegacyRecord, field: string): string | null {
  const value = optionalPayloadString(record, field);
  return value === null ? null : value.trim().toLocaleUpperCase("tr-TR");
}

function orderTrackingMappingRole(trackingNumber: string): string {
  return `tracking_number:${trackingNumber}`;
}

function shipmentTrackingCandidates(record: LegacyRecord): readonly string[] {
  const candidates = [
    normalizedPayloadString(record, "takip_no"),
    normalizedPayloadString(record, "surat_kargo_takip_no"),
    normalizedPayloadString(record, "surat_barkod_no"),
  ].filter((value): value is string => value !== null);
  return [...new Set(candidates)];
}

async function resolveShipmentOrderByTracking(
  target: MigrationTarget & Required<Pick<MigrationTarget, "findLegacyIdMapsByMappingRole">>,
  input: {
    readonly runId: string;
    readonly sourceSystem: string;
    readonly trackingNumbers: readonly string[];
  },
): Promise<{
  readonly order: LegacyIdMapEntry | null;
  readonly deferredTrackingNumber: string | null;
  readonly ambiguous: boolean;
}> {
  for (const trackingNumber of input.trackingNumbers) {
    const matches = await target.findLegacyIdMapsByMappingRole({
      runId: input.runId,
      sourceSystem: input.sourceSystem,
      sourceTable: "public.siparisler",
      targetTable: "orders",
      mappingRole: orderTrackingMappingRole(trackingNumber),
    });
    if (matches.length > 1) {
      return { order: null, deferredTrackingNumber: trackingNumber, ambiguous: true };
    }
    if (matches.length === 1) {
      return { order: matches[0]!, deferredTrackingNumber: null, ambiguous: false };
    }
  }
  return { order: null, deferredTrackingNumber: input.trackingNumbers[0] ?? null, ambiguous: false };
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

function assertInlineMediaApplyTarget(
  target: MigrationTarget,
): asserts target is MigrationTarget & Required<Pick<
  MigrationTarget,
  "writeFileRecord" | "writeMessageAttachmentRecord"
>> {
  if (!target.writeFileRecord || !target.writeMessageAttachmentRecord) {
    throw new Error("Message inline media apply requires a target with file and attachment writers");
  }
}

function assertOrderTarget(
  target: MigrationTarget,
): asserts target is MigrationTarget & Required<Pick<
  MigrationTarget,
  "writeOrderRecord" | "recordDeferredReconciliation"
>> {
  if (!target.writeOrderRecord || !target.recordDeferredReconciliation) {
    throw new Error("Order apply requires a target with FK-resolving order and deferred reconciliation writers");
  }
}

function assertOrderItemTarget(
  target: MigrationTarget,
): asserts target is MigrationTarget & Required<Pick<
  MigrationTarget,
  "writeOrderItemRecord" | "findProductPublicIdBySku" | "findProductPublicIdByExternalId"
>> {
  if (
    !target.writeOrderItemRecord
    || !target.findProductPublicIdBySku
    || !target.findProductPublicIdByExternalId
  ) {
    throw new Error("Order item apply requires a target with FK-resolving order item writers and product lookup");
  }
}

async function legacyOrderAdjustmentFallback(
  target: MigrationTarget,
  orderPublicId: string,
): Promise<{ readonly itemCount: number; readonly adjustmentAmount: string }> {
  try {
    await target.assertOrderTotalsConsistent?.({ orderPublicId });
    return { itemCount: 1, adjustmentAmount: "0.00" };
  } catch {
    return { itemCount: 1, adjustmentAmount: "0.01" };
  }
}

function assertShipmentTarget(
  target: MigrationTarget,
): asserts target is MigrationTarget & Required<Pick<
  MigrationTarget,
  "writeShipmentRecord" | "recordDeferredReconciliation" | "findLegacyIdMapsByMappingRole"
>> {
  if (!target.writeShipmentRecord || !target.recordDeferredReconciliation || !target.findLegacyIdMapsByMappingRole) {
    throw new Error("Shipment apply requires a target with FK-resolving shipment, tracking lookup, and deferred reconciliation writers");
  }
}

function assertShipmentTrackingEventTarget(
  target: MigrationTarget,
): asserts target is MigrationTarget & Required<Pick<
  MigrationTarget,
  "writeShipmentTrackingEventRecord" | "recordDeferredReconciliation"
>> {
  if (!target.writeShipmentTrackingEventRecord || !target.recordDeferredReconciliation) {
    throw new Error("Shipment tracking event apply requires a target with event writer and deferred reconciliation");
  }
}

function assertDeferredReconciliationTarget(
  target: MigrationTarget,
): asserts target is MigrationTarget & Required<Pick<MigrationTarget, "reconcileDeferredReconciliations">> {
  if (!target.reconcileDeferredReconciliations) {
    throw new Error("Deferred reconciliation requires a target with a reconciliation runner");
  }
}

function assertMappedLegacyMessageRawPayload(rawPayload: Record<string, unknown> | null): void {
  if (rawPayload === null) return;
  const allowed = new Set(["media_url", "media_type", "gonderici_adi", "medya_url", "medya_tipi", "gonderici_id"]);
  const unmapped = Object.keys(rawPayload).filter((key) => !allowed.has(key)).sort();
  if (unmapped.length > 0) {
    throw new Error(`Message apply found unmapped legacy media/raw payload fields: ${unmapped.join(", ")}`);
  }
}

function messageInlineMediaUrl(rawPayload: Record<string, unknown> | null): string | null {
  const mediaUrl = rawPayload?.media_url;
  return typeof mediaUrl === "string" && mediaUrl.startsWith("data:") ? mediaUrl : null;
}

function toRawPayloadRecord(rawPayload: MessageTransformationResult["message"]["rawPayload"]): Record<string, unknown> | null {
  return rawPayload === null ? null : { ...rawPayload };
}

function filePublicId(checksum: string): string {
  return `fil_${createHash("sha256").update(`file:${checksum}`).digest("hex").slice(0, 24)}`;
}

function messageAttachmentPublicId(messagePublicId: string, checksum: string): string {
  return `mat_${createHash("sha256").update(`${messagePublicId}:${checksum}`).digest("hex").slice(0, 24)}`;
}

function shipmentTrackingEventPublicId(sourceId: string): string {
  return `ste_${createHash("sha256").update(`shipment_tracking_event:${sourceId}`).digest("hex").slice(0, 24)}`;
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
