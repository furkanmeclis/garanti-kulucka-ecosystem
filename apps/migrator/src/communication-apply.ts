import { runExclusiveSuccessfulBatchApply, type ApplyMigrationBatchInput } from "./apply.js";
import { toSafeMigratorError } from "./errors.js";
import { upsertLegacyIdMap } from "./id-map.js";
import { communicationPublicId, isCommunicationEntity, transformLegacyCommunication } from "./communication-mapping.js";
import { prepareShortcutMedia } from "./shortcut-media.js";
import type { MigratorMediaStorage } from "./media-storage.js";
import type { MigrationBatchApplyResult } from "./types.js";

type Input = ApplyMigrationBatchInput & { readonly mediaStorage?: MigratorMediaStorage; readonly userPublicIds?: ReadonlyMap<string, string> };
export async function applyCommunicationMigrationBatchWithState(input: Input): Promise<MigrationBatchApplyResult> {
  if (!isCommunicationEntity(input.batch.entity)) throw new Error("Unsupported communication batch entity");
  const existing = await input.target.findMigrationBatchState({ runId: input.runId, batch: input.batch });
  if (existing?.status === "succeeded") {
    const { entity, batchNumber, readRows, writtenRows, skippedRows, idMapCreated, idMapUpdated, idMapUnchanged, warnings } = existing;
    return { entity, batchNumber, readRows, writtenRows, skippedRows, idMapCreated, idMapUpdated, idMapUnchanged, warnings };
  }
  try { return await runExclusiveSuccessfulBatchApply(input, applyBatch); }
  catch (error) {
    const safeError = toSafeMigratorError(error);
    await input.target.recordMigrationBatchFailed({ runId: input.runId, batch: input.batch, error: safeError });
    throw safeError;
  }
}
async function applyBatch(input: Input): Promise<MigrationBatchApplyResult> {
  const entity = input.batch.entity;
  if (!isCommunicationEntity(entity)) throw new Error("Unsupported communication batch entity");
  if (!input.target.writeCommunicationRecord) throw new Error("Communication apply requires a target with FK-resolving writers");
  const records = await input.source.readBatch(entity, { limit: input.batch.limit, offset: input.batch.offset });
  if (records.length !== input.batch.expectedRows) throw new Error(`Migration batch short read for ${entity}`);
  const drafts = records.map((row) => transformLegacyCommunication(row, entity));
  if (drafts.some((d) => d.media.length > 0) && (!input.mediaStorage?.storeObject || !input.target.writeFileRecord || !input.target.writeShortcutAttachmentRecord)) {
    throw new Error("Shortcut media apply requires MIGRATION_MEDIA_S3_* storage configuration and file/attachment writers");
  }
  // Preflight every object before the batch writes any canonical row. Object keys survive a DB rollback.
  const prepared = [];
  for (const [rowIndex, draft] of drafts.entries()) {
    const media = [];
    for (const [index, item] of draft.media.entries()) {
      media.push(await prepareShortcutMedia({ media: item, index,
        sourceIdentity: `${records[rowIndex]!.sourceSystem}:${records[rowIndex]!.sourceTable}:${records[rowIndex]!.sourceId}`,
        createdAt: draft.createdAt, storage: input.mediaStorage! }));
    }
    prepared.push(media);
  }
  const result = { entity, batchNumber: input.batch.batchNumber, readRows: records.length,
    writtenRows: 0, skippedRows: 0, idMapCreated: 0, idMapUpdated: 0, idMapUnchanged: 0,
    warnings: [] as MigrationBatchApplyResult["warnings"] };
  for (const [rowIndex, draft] of drafts.entries()) {
    const row = records[rowIndex]!;
    let shipmentPublicId: string | null = null;
    if (draft.shipmentSourceId !== null) {
      const map = await input.target.findLegacyIdMap({ runId: input.runId, sourceSystem: row.sourceSystem,
        sourceTable: "public.kargo_gonderimleri", sourceId: draft.shipmentSourceId, targetTable: "shipments", mappingRole: "primary" });
      shipmentPublicId = map?.targetId ?? null;
      if (!shipmentPublicId) result.warnings.push({ entity, code: "unresolved_optional_shipment",
        message: "Optional legacy shipment link unresolved; retained history with null shipment" });
    }
    const userPublicId = draft.userSourceId ? input.userPublicIds?.get(draft.userSourceId) ?? null : null;
    let orderPublicId: string | null = null;
    if (draft.orderSourceId) {
      orderPublicId = (await input.target.findLegacyIdMap({ runId: input.runId, sourceSystem: row.sourceSystem,
        sourceTable: "public.siparisler", sourceId: draft.orderSourceId, targetTable: "orders", mappingRole: "primary" }))?.targetId ?? null;
      if (!orderPublicId) result.warnings.push({ entity, code: "unresolved_optional_order", message: "Optional legacy order link unresolved; retained call with null order" });
    }
    if (draft.userSourceId && !userPublicId) result.warnings.push({ entity, code: "unresolved_optional_user", message: "Optional legacy user link unresolved; retained call with null user" });
    const written = await input.target.writeCommunicationRecord({ ...draft, shipmentPublicId,
      ...(entity === "call_logs" ? { userPublicId, orderPublicId } : {}) });
    if (entity === "call_logs" && written.record.payload.customer_id === null) result.warnings.push({
      entity, code: "unresolved_optional_customer", message: "Optional customer phone link unresolved or ambiguous; retained call with null customer" });
    const shortcutPublicId = written.record.targetId;
    result.writtenRows += 1;
    async function mapId(targetTable: string, targetId: string, mappingRole: string) {
      const mapped = await upsertLegacyIdMap(input.target, { runId: input.runId,
        sourceSystem: row.sourceSystem, sourceTable: row.sourceTable, sourceId: row.sourceId,
        targetTable, targetId, mappingRole, checksum: row.checksum });
      if (mapped.status === "created") result.idMapCreated++;
      if (mapped.status === "updated") result.idMapUpdated++;
      if (mapped.status === "unchanged") result.idMapUnchanged++;
    }
    await mapId(entity, shortcutPublicId, "primary");
    for (const [index, media] of prepared[rowIndex]!.entries()) {
      const item = draft.media[index]!;
      const { object, filePublicId } = media;
      await input.target.writeFileRecord!({ targetTable: "files", targetId: filePublicId, checksum: row.checksum,
        payload: { bucket: object.bucket, object_key: object.objectKey, original_name: item.fileName,
          mime_type: item.mimeType, byte_size: object.size, checksum: object.checksum, upload_status: "available",
          scan_status: "skipped", upload_type: "singlepart", completed_at: draft.createdAt ?? "1970-01-01T00:00:00.000Z" } });
      const attachmentId = communicationPublicId("msa", `${shortcutPublicId}:${filePublicId}`);
      await input.target.writeShortcutAttachmentRecord!({ targetTable: "message_shortcut_attachments", targetId: attachmentId,
        shortcutPublicId, filePublicId, checksum: row.checksum, payload: { attachment_type: item.mediaType, sort_order: index } });
      await mapId("files", filePublicId, `media:${index}`);
      await mapId("message_shortcut_attachments", attachmentId, `attachment:${index}`);
      result.writtenRows += 2;
    }
  }
  return result;
}
