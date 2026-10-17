import { emptyCommunicationSummary, isCommunicationEntity, transformLegacyCommunication, type CommunicationSummaries } from "./communication-mapping.js";
import type { LegacySource, MigrationPlan } from "./types.js";

/** Pure mapping and accounting: never opens storage or downloads a URL. */
export async function validateCommunicationBatches(source: LegacySource, plan: MigrationPlan,
  shipmentPublicIds: ReadonlyMap<string, string>): Promise<CommunicationSummaries> {
  const summaries: CommunicationSummaries = {};
  for (const batch of plan.batches) {
    if (!isCommunicationEntity(batch.entity)) continue;
    const entity = batch.entity;
    const summary = summaries[entity] ??= emptyCommunicationSummary();
    const rows = await source.readBatch(entity, { limit: batch.limit, offset: batch.offset });
    if (rows.length !== batch.expectedRows) throw new Error(`Migration batch short read for ${entity}`);
    for (const row of rows) {
      const draft = transformLegacyCommunication(row, entity);
      summary.sourceRows++; summary.transformedRows++;
      if (draft.record.payload.is_active === false) summary.inactiveRows++;
      if (draft.shipmentSourceId !== null) {
        if (shipmentPublicIds.has(draft.shipmentSourceId)) summary.linkedShipments++;
        else summary.unresolvedShipments++;
      }
      const status = draft.record.payload.status;
      if (typeof status === "string") summary.byStatus[status] = (summary.byStatus[status] ?? 0) + 1;
      for (const item of draft.media) {
        summary.mediaItems++;
        if (item.dataUrl) { summary.inlineMediaItems++; summary.inlineMediaBytes += item.inlineBytes; }
        else summary.remoteMediaUrls++;
      }
    }
  }
  return summaries;
}
