import { createHash } from "node:crypto";
import { normalizeLegacyTimestamp } from "./customer-mapping.js";
import type { LegacyRowRejection } from "./customer-mapping.js";
import { calculateSourcePayloadChecksum } from "./legacy-source.js";
import { legacyMappingCatalog } from "./mapping-catalog.js";
import type { LegacyColumnContract } from "./mapping-catalog.js";
import type { SourcePayloadChecksum } from "./legacy-source.js";
import type { LegacyRecord } from "./types.js";

export const legacyOrderItemTable = "public.siparis_kalemleri";
const legacyOrderItemColumns = catalogColumns(legacyOrderItemTable);
const legacyOrderItemFields = Object.freeze(legacyOrderItemColumns.map((column) => column.name));
const legacyOrderItemRequiredFields = Object.freeze(legacyOrderItemColumns.filter((column) => column.required).map((column) => column.name));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const checksumPattern = /^sha256:[0-9a-f]{64}$/;
const orderPublicIdPattern = /^ord_[0-9a-f]{24}$/;
const productPublicIdPattern = /^prd_[0-9a-f]{24}$/;
const postgresIntegerMax = 2_147_483_647;

export interface OrderItemTransformContext {
  readonly orderPublicIds: ReadonlyMap<string, string>;
  readonly productPublicIdsBySku: ReadonlyMap<string, string>;
  readonly productPublicIdsByExternalId: ReadonlyMap<string, string>;
}

export type OrderItemReconciliation = {
  readonly code: "unresolved_product";
  readonly lookup: "sku" | "external_product_id";
};

interface LegacyTimestamps {
  readonly createdAt: string | null;
}

export interface LegacyOrderItemDraft {
  readonly kind: "legacy_order_item_draft";
  readonly targetTable: "order_items";
  readonly publicId: string;
  readonly mappingRole: "primary";
  readonly orderPublicId: string;
  readonly productPublicId: string | null;
  readonly productLookup: "sku" | "external_product_id" | null;
  readonly name: string;
  readonly quantity: number;
  readonly unitPrice: string;
  readonly totalAmount: string;
  readonly externalProductId: string | null;
  readonly unit: string | null;
  readonly taxRate: string | null;
  readonly legacyTimestamps: LegacyTimestamps;
}

export interface OrderItemTransformationResult {
  readonly sourcePayloadChecksum: SourcePayloadChecksum;
  readonly orderItem: LegacyOrderItemDraft;
  readonly reconciliation: readonly OrderItemReconciliation[];
}

interface ParsedLegacyOrderItem {
  readonly sourcePayloadChecksum: SourcePayloadChecksum;
  readonly sourceSystem: string;
  readonly sourceTable: string;
  readonly sourceId: string;
  readonly payload: Record<string, unknown>;
}

export function transformLegacyOrderItem(
  record: LegacyRecord,
  context: OrderItemTransformContext,
): OrderItemTransformationResult {
  const rejectRow: LegacyRowRejection = failOrderItem;
  const row = parseLegacyOrderItem(record, rejectRow);
  const { payload } = row;

  const legacyOrderId = requiredUuid(payload.siparis_id, "siparis_id", rejectRow);
  const orderPublicId = context.orderPublicIds.get(legacyOrderId);
  if (orderPublicId === undefined) rejectRow("field siparis_id does not resolve to a migrated order");
  if (typeof orderPublicId !== "string" || !orderPublicIdPattern.test(orderPublicId)) {
    failContext("order public id map contains an illegal public id");
  }

  const sku = optionalTrimmedString(payload.urun_kodu, "urun_kodu", rejectRow);
  const externalProductId = optionalTrimmedString(payload.kolaybi_product_id, "kolaybi_product_id", rejectRow);
  const productResolution = resolveProductPublicId(sku, externalProductId, context);

  const orderItem: LegacyOrderItemDraft = Object.freeze({
    kind: "legacy_order_item_draft" as const,
    targetTable: "order_items" as const,
    publicId: stablePublicId(row),
    mappingRole: "primary" as const,
    orderPublicId,
    productPublicId: productResolution.productPublicId,
    productLookup: productResolution.lookup,
    name: requiredName(payload.urun_adi, "urun_adi", rejectRow),
    quantity: requiredPositiveInteger(payload.miktar, "miktar", rejectRow),
    unitPrice: moneyAmount(payload.birim_fiyat, "birim_fiyat", rejectRow),
    totalAmount: moneyAmount(payload.toplam_fiyat, "toplam_fiyat", rejectRow),
    externalProductId,
    unit: optionalTrimmedString(payload.birim, "birim", rejectRow),
    taxRate: decimalAmount(payload.kdv_orani, "kdv_orani", rejectRow),
    legacyTimestamps: Object.freeze({
      createdAt: normalizeLegacyTimestamp(payload.olusturma_tarihi, "olusturma_tarihi", rejectRow),
    }),
  });

  return Object.freeze({
    sourcePayloadChecksum: row.sourcePayloadChecksum,
    orderItem,
    reconciliation: Object.freeze(productResolution.reconciliation),
  });
}

function resolveProductPublicId(
  sku: string | null,
  externalProductId: string | null,
  context: OrderItemTransformContext,
): {
  readonly productPublicId: string | null;
  readonly lookup: "sku" | "external_product_id" | null;
  readonly reconciliation: readonly OrderItemReconciliation[];
} {
  const skuProductPublicId = sku === null ? undefined : context.productPublicIdsBySku.get(sku);
  const externalProductPublicId = externalProductId === null
    ? undefined
    : context.productPublicIdsByExternalId.get(externalProductId);
  if (
    skuProductPublicId !== undefined
    && externalProductPublicId !== undefined
    && skuProductPublicId !== externalProductPublicId
  ) {
    failContext("sku and external product id resolve to different products");
  }
  if (sku !== null) {
    if (skuProductPublicId !== undefined) {
      return { productPublicId: assertProductPublicId(skuProductPublicId), lookup: "sku", reconciliation: [] };
    }
  }
  if (externalProductId !== null) {
    if (externalProductPublicId !== undefined) {
      return {
        productPublicId: assertProductPublicId(externalProductPublicId),
        lookup: "external_product_id",
        reconciliation: [],
      };
    }
  }

  const reconciliation: OrderItemReconciliation[] = [];
  if (sku !== null) reconciliation.push(Object.freeze({ code: "unresolved_product" as const, lookup: "sku" as const }));
  if (sku === null && externalProductId !== null) {
    reconciliation.push(Object.freeze({ code: "unresolved_product" as const, lookup: "external_product_id" as const }));
  }
  return { productPublicId: null, lookup: null, reconciliation };
}

function assertProductPublicId(value: string): string {
  if (typeof value !== "string" || !productPublicIdPattern.test(value)) {
    failContext("product public id map contains an illegal public id");
  }
  return value;
}

function parseLegacyOrderItem(record: LegacyRecord, reject: LegacyRowRejection): ParsedLegacyOrderItem {
  if (record.sourceTable !== legacyOrderItemTable) reject(`source table must be ${legacyOrderItemTable}`);
  if (typeof record.sourceSystem !== "string" || !record.sourceSystem.trim()) {
    reject("source system must be a nonblank string");
  }
  const payload = inspectPayload(record.payload, reject);

  const keys = Object.keys(payload);
  const missing = legacyOrderItemRequiredFields.filter((field) => !Object.hasOwn(payload, field));
  if (missing.length > 0) reject(`payload is missing required fields [${missing.join(", ")}]`);
  if (keys.some((field) => !legacyOrderItemFields.includes(field))) reject("payload contains unknown fields");

  if (typeof record.checksum !== "string" || !checksumPattern.test(record.checksum)) {
    reject("source payload checksum is invalid");
  }
  if (record.checksum !== calculateSourcePayloadChecksum(payload)) {
    reject("source payload checksum does not match payload");
  }

  const payloadId = requiredUuid(payload.id, "id", reject);
  const sourceId = requiredUuid(record.sourceId, "sourceId", reject);
  if (payloadId !== sourceId) reject("sourceId does not match payload id");

  return {
    sourcePayloadChecksum: record.checksum as SourcePayloadChecksum,
    sourceSystem: record.sourceSystem.trim(),
    sourceTable: legacyOrderItemTable,
    sourceId,
    payload,
  };
}

function inspectPayload(value: unknown, reject: LegacyRowRejection): Record<string, unknown> {
  if (value === null || typeof value !== "object") reject("payload must be an object");
  let descriptors: PropertyDescriptorMap;
  try {
    if (Array.isArray(value)) reject("payload must be an object");
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) reject("payload must be a plain object");
    if (Object.getOwnPropertySymbols(value).length > 0) reject("payload must contain only named data fields");
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch (error) {
    if (error instanceof LegacyOrderItemRowError) throw error;
    reject("payload could not be inspected");
  }

  const payload = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor) || !descriptor.enumerable) reject("payload fields must be enumerable data properties");
    Object.defineProperty(payload, key, { value: descriptor.value, enumerable: true });
  }
  return payload;
}

function requiredUuid(value: unknown, field: string, reject: LegacyRowRejection): string {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    reject(`field ${field} is required`);
  }
  if (typeof value !== "string" || !uuidPattern.test(value)) reject(`field ${field} must be a UUID`);
  return value.toLowerCase();
}

function requiredName(value: unknown, field: string, reject: LegacyRowRejection): string {
  if (typeof value !== "string") reject(`field ${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) reject(`field ${field} must not be blank`);
  return trimmed;
}

function optionalTrimmedString(value: unknown, field: string, reject: LegacyRowRejection): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") reject(`field ${field} must be a string or null`);
  const trimmed = value.trim();
  return trimmed || null;
}

function requiredPositiveInteger(value: unknown, field: string, reject: LegacyRowRejection): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 1 || value > postgresIntegerMax) {
      reject(`field ${field} must be a positive integer`);
    }
    return value;
  }
  if (typeof value !== "string") reject(`field ${field} must be a positive integer`);
  if (!/^(0|[1-9]\d*)(?:\.0+)?$/.test(value)) reject(`field ${field} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > postgresIntegerMax) {
    reject(`field ${field} must be a positive integer`);
  }
  return parsed;
}

function moneyAmount(value: unknown, field: string, reject: LegacyRowRejection): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) reject(`field ${field} must be a non-negative decimal`);
    return formatDecimal(value.toString(), field, reject, 2);
  }
  if (typeof value !== "string") reject(`field ${field} must be a non-negative decimal`);
  return formatDecimal(value, field, reject, 2);
}

function decimalAmount(value: unknown, field: string, reject: LegacyRowRejection): string | null {
  if (value === null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) reject(`field ${field} must be a non-negative decimal or null`);
    return formatDecimal(value.toString(), field, reject, 4);
  }
  if (typeof value !== "string") reject(`field ${field} must be a non-negative decimal or null`);
  return formatDecimal(value, field, reject, 4);
}

function formatDecimal(raw: string, field: string, reject: LegacyRowRejection, scale: number): string {
  if (raw.startsWith("-")) reject(`field ${field} must be a non-negative decimal`);
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(raw);
  if (!match) reject(`field ${field} must be a non-negative decimal`);
  const fraction = match[2] ?? "";
  if (fraction.length > scale && !/^0+$/.test(fraction.slice(scale))) {
    reject(`field ${field} must be a non-negative decimal`);
  }
  return `${match[1]}.${fraction.slice(0, scale).padEnd(scale, "0")}`;
}

function stablePublicId(row: ParsedLegacyOrderItem): string {
  const identity = [row.sourceSystem, row.sourceTable, row.sourceId, "primary"].join(":");
  return `oit_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

function catalogColumns(sourceTable: string): readonly LegacyColumnContract[] {
  const mapping = legacyMappingCatalog.tables.find((table) => table.sourceTable === sourceTable);
  if (!mapping) throw new Error(`Legacy mapping catalog does not declare ${sourceTable}`);
  return mapping.columns;
}

class LegacyOrderItemRowError extends Error {}

function failOrderItem(reason: string): never {
  throw new LegacyOrderItemRowError(`Invalid legacy order item row: ${reason}`);
}

class OrderItemTransformContextError extends Error {}

function failContext(reason: string): never {
  throw new OrderItemTransformContextError(`Invalid order item transform context: ${reason}`);
}
