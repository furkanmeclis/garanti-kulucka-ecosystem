import { calculateSourcePayloadChecksum } from "./legacy-source.js";
import { transformLegacyCustomer } from "./customer-mapping.js";
import {
  normalizePhoneLast10,
  syntheticOrderCustomerDraft,
  transformLegacyOrder,
  type SyntheticOrderCustomerDraft,
} from "./order-mapping.js";
import type { LegacyRecord } from "./types.js";

export interface SyntheticOrderCustomer extends SyntheticOrderCustomerDraft {
  readonly sourceSystem: string;
  readonly sourceId: string;
  readonly checksum: string;
  readonly notes: string | null;
}

export interface OrderCustomerPlan {
  readonly customerPublicIds: ReadonlyMap<string, string>;
  readonly customerPublicIdsByPhone: ReadonlyMap<string, readonly string[]>;
  readonly syntheticCustomers: ReadonlyMap<string, SyntheticOrderCustomer>;
}

/** Snapshot-wide grouping: names and default addresses must not depend on batch size or UUID order. */
export function buildOrderCustomerPlan(
  customers: readonly LegacyRecord[],
  orders: readonly LegacyRecord[],
): OrderCustomerPlan {
  const customerPublicIds = new Map<string, string>();
  const customerPublicIdsByPhone = new Map<string, string[]>();
  for (const row of customers) {
    const customer = transformLegacyCustomer(row).customer;
    customerPublicIds.set(row.sourceId.toLowerCase(), customer.publicId);
    const phone = normalizePhoneLast10(typeof row.payload.telefon === "string" ? row.payload.telefon : null);
    if (phone !== null) customerPublicIdsByPhone.set(phone, [...(customerPublicIdsByPhone.get(phone) ?? []), customer.publicId]);
  }
  const groups = new Map<string, { record: LegacyRecord; draft: SyntheticOrderCustomerDraft; createdAt: string }[]>();
  for (const record of orders) {
    const result = transformLegacyOrder(record, {
      customerPublicIds,
      customerPublicIdsByPhone,
      conversationPublicIds: new Map(),
      userPublicIds: new Map(),
    });
    const draft = syntheticOrderCustomerDraft(record, result);
    if (draft === null) continue;
    const group = groups.get(draft.publicId) ?? [];
    group.push({ record, draft, createdAt: result.order.legacyTimestamps.createdAt ?? "" });
    groups.set(draft.publicId, group);
  }
  const syntheticCustomers = new Map<string, SyntheticOrderCustomer>();
  for (const [publicId, members] of groups) {
    members.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.record.sourceId.localeCompare(a.record.sourceId));
    const latest = members[0]!;
    const names = new Map<string, string>();
    const fold = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("tr-TR");
    for (const { draft } of members) {
      const key = fold(draft.fullName);
      if (!names.has(key)) names.set(key, draft.fullName);
    }
    names.delete(fold(latest.draft.fullName));
    const phone = normalizePhoneLast10(latest.draft.phone);
    const draft = {
      ...latest.draft,
      phone: phone ?? latest.draft.phone,
      address: members.find(({ draft }) => draft.address !== null)?.draft.address ?? null,
      notes: names.size > 0 ? `Eski siparişlerde geçen adlar: ${[...names.values()].join(", ")}` : null,
      sourceSystem: latest.record.sourceSystem,
      sourceId: phone === null ? latest.record.sourceId : `phone:${phone}`,
    };
    syntheticCustomers.set(publicId, { ...draft, checksum: calculateSourcePayloadChecksum(draft) });
  }
  return { customerPublicIds, customerPublicIdsByPhone, syntheticCustomers };
}
