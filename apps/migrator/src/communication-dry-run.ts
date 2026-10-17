import { emptyCommunicationSummary, isCommunicationEntity, transformLegacyCommunication, type CommunicationSummaries } from "./communication-mapping.js";
import { normalizePhoneLast10 } from "./order-mapping.js";
import type { LegacySource, MigrationPlan } from "./types.js";

/** Pure mapping and accounting: never opens storage or downloads a URL. */
export async function validateCommunicationBatches(source: LegacySource, plan: MigrationPlan,
  shipmentPublicIds: ReadonlyMap<string, string>, links: {
    userPublicIds?: ReadonlyMap<string, string>; orderPublicIds?: ReadonlyMap<string, string>;
    customerPublicIdsByPhone?: ReadonlyMap<string, readonly string[]>;
  } = {}): Promise<CommunicationSummaries> {
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
      if (entity === "call_logs") {
        for (const key of ["linkedUsers", "unresolvedUsers", "linkedOrders", "unresolvedOrders", "linkedCustomers", "unresolvedCustomers"] as const) summary[key] ??= 0;
        if (draft.userSourceId) summary[links.userPublicIds?.has(draft.userSourceId) ? "linkedUsers" : "unresolvedUsers"]!++;
        if (draft.orderSourceId) summary[links.orderPublicIds?.has(draft.orderSourceId) ? "linkedOrders" : "unresolvedOrders"]!++;
        const phone = normalizePhoneLast10(String(draft.record.payload.customer_number ?? ""));
        summary[phone && links.customerPublicIdsByPhone?.get(phone)?.length === 1 ? "linkedCustomers" : "unresolvedCustomers"]!++;
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
