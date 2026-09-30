import { createHash } from "node:crypto";
import { normalizeLegacyTimestamp } from "./customer-mapping.js";
import type { LegacyRowRejection } from "./customer-mapping.js";
import { calculateSourcePayloadChecksum } from "./legacy-source.js";
import type { SourcePayloadChecksum } from "./legacy-source.js";
import { legacyMappingCatalog } from "./mapping-catalog.js";
import type { LegacyColumnContract } from "./mapping-catalog.js";
import type { LegacyRecord } from "./types.js";

export const legacyOrderTable = "public.siparisler";
const legacyOrderColumns = catalogColumns(legacyOrderTable);
const legacyOrderFields = Object.freeze(legacyOrderColumns.map((column) => column.name));
const mappedCatalogColumns = new Set<string>([
  "musteri_id",
  "olusturan_id",
  "konusma_id",
  "musteri_ad",
  "musteri_telefon",
  "musteri_adres",
  "musteri_il",
  "musteri_ilce",
  "musteri_posta_kodu",
  "siparis_no",
  "siparis_tipi",
  "durum",
  "ara_toplam",
  "kdv_toplam",
  "kargo_ucreti",
  "genel_toplam",
  "teyit_durumu",
  "notlar",
  "olusturma_tarihi",
  "guncelleme_tarihi",
  "kolaybi_siparis_id",
  "kaynak",
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const checksumPattern = /^sha256:[0-9a-f]{64}$/;
const customerPublicIdPattern = /^cus_[0-9a-f]{24}$/;
const conversationPublicIdPattern = /^conv_[0-9a-f]{24}$/;
const postgresIntegerMin = -2_147_483_648;
const postgresIntegerMax = 2_147_483_647;
const postgresSmallintMin = -32_768;
const postgresSmallintMax = 32_767;

const orderStatuses: ReadonlyMap<string, OrderStatus> = new Map([
  ["olusturuldu", "created"],
  ["teyit_bekliyor", "awaiting_confirmation"],
  ["teyit_edildi", "confirmed"],
  ["hazirlaniyor", "preparing"],
  ["kargoya_verildi", "shipped"],
  ["sevk_edildi", "dispatched"],
  ["teslim_edildi", "delivered"],
  ["iptal", "cancelled"],
  ["iade", "returned"],
]);
const orderSources: ReadonlyMap<string, OrderSource> = new Map([
  ["manuel", "manual"],
  ["panel", "manual"],
  ["ai", "ai"],
  ["webhook", "webhook"],
]);
const orderTypes: ReadonlyMap<string, OrderType> = new Map([
  ["normal", "standard"],
  ["yedek_parca", "spare_part"],
]);
const confirmationStatuses: ReadonlyMap<string, OrderConfirmationStatus> = new Map([
  ["bekliyor", "pending"],
  ["teyit_edildi", "confirmed"],
  ["ulasilamadi", "unreachable"],
  ["iptal_istegi", "cancellation_requested"],
  ["gecersiz_numara", "invalid_number"],
]);

export type OrderStatus =
  | "created"
  | "awaiting_confirmation"
  | "confirmed"
  | "preparing"
  | "shipped"
  | "dispatched"
  | "delivered"
  | "cancelled"
  | "returned";
export type OrderSource = "manual" | "ai" | "webhook";
export type OrderType = "standard" | "spare_part";
export type OrderConfirmationStatus =
  | "pending"
  | "confirmed"
  | "unreachable"
  | "cancellation_requested"
  | "invalid_number";

export interface OrderTransformContext {
  readonly customerPublicIds: ReadonlyMap<string, string>;
  readonly conversationPublicIds: ReadonlyMap<string, string>;
  readonly userPublicIds: ReadonlyMap<string, string>;
}

export type OrderReconciliation =
  | { readonly code: "unresolved_conversation"; readonly legacyConversationId: string }
  | { readonly code: "unresolved_created_by"; readonly legacyUserId: string };

interface LegacyTimestamps {
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface LegacyOrderDraft {
  readonly kind: "legacy_order_draft";
  readonly targetTable: "orders";
  readonly publicId: string;
  readonly mappingRole: "primary";
  readonly customerPublicId: string;
  readonly conversationPublicId: string | null;
  readonly createdByUserPublicId: string | null;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly source: OrderSource;
  readonly orderType: OrderType;
  readonly totalAmount: string;
  readonly subtotal: string;
  readonly taxTotal: string;
  readonly shippingAmount: string;
  readonly currency: "TRY";
  readonly confirmationStatus: OrderConfirmationStatus | null;
  readonly customerName: string;
  readonly customerPhone: string;
  readonly customerAddress: string | null;
  readonly customerCity: string | null;
  readonly customerDistrict: string | null;
  readonly customerPostalCode: string | null;
  readonly externalOrderId: string | null;
  readonly notes: string | null;
  readonly legacyTimestamps: LegacyTimestamps;
  readonly sourceRemainder: LegacyOrderSourceRemainder;
}

export type LegacyOrderRemainderValue = string | number | boolean | null;

export type LegacyOrderSourceRemainder = Readonly<Record<string, LegacyOrderRemainderValue>>;

export interface OrderTransformationResult {
  readonly sourcePayloadChecksum: SourcePayloadChecksum;
  readonly order: LegacyOrderDraft;
  readonly reconciliation: readonly OrderReconciliation[];
}

interface ParsedLegacyOrder {
  readonly sourcePayloadChecksum: SourcePayloadChecksum;
  readonly sourceSystem: string;
  readonly sourceTable: string;
  readonly sourceId: string;
  readonly payload: Record<string, unknown>;
}

export function transformLegacyOrder(
  record: LegacyRecord,
  context: OrderTransformContext,
): OrderTransformationResult {
  const rejectRow: LegacyRowRejection = failOrder;
  const row = parseLegacyOrder(record, rejectRow);
  const { payload } = row;

  const legacyCustomerId = requiredUuid(payload.musteri_id, "musteri_id", rejectRow);
  const customerPublicId = context.customerPublicIds.get(legacyCustomerId);
  if (customerPublicId === undefined) rejectRow("field musteri_id does not resolve to a migrated customer");
  if (typeof customerPublicId !== "string" || !customerPublicIdPattern.test(customerPublicId)) {
    failContext("customer public id map contains an illegal public id");
  }

  const reconciliation: OrderReconciliation[] = [];
  let conversationPublicId: string | null = null;
  const legacyConversationId = optionalUuid(payload.konusma_id, "konusma_id", rejectRow);
  if (legacyConversationId !== null) {
    const mappedConversationId = context.conversationPublicIds.get(legacyConversationId);
    if (mappedConversationId === undefined) {
      reconciliation.push(Object.freeze({
        code: "unresolved_conversation" as const,
        legacyConversationId,
      }));
    } else {
      if (typeof mappedConversationId !== "string" || !conversationPublicIdPattern.test(mappedConversationId)) {
        failContext("conversation public id map contains an illegal public id");
      }
      conversationPublicId = mappedConversationId;
    }
  }

  let createdByUserPublicId: string | null = null;
  const legacyUserId = requiredUuid(payload.olusturan_id, "olusturan_id", rejectRow);
  const mappedUserId = context.userPublicIds.get(legacyUserId);
  if (mappedUserId === undefined) {
    reconciliation.push(Object.freeze({
      code: "unresolved_created_by" as const,
      legacyUserId,
    }));
  } else {
    if (typeof mappedUserId !== "string" || !mappedUserId.trim()) {
      failContext("user public id map contains a blank public id");
    }
    createdByUserPublicId = mappedUserId;
  }

  const order: LegacyOrderDraft = Object.freeze({
    kind: "legacy_order_draft" as const,
    targetTable: "orders" as const,
    publicId: stablePublicId(row),
    mappingRole: "primary" as const,
    customerPublicId,
    conversationPublicId,
    createdByUserPublicId,
    orderNumber: requiredName(payload.siparis_no, "siparis_no", rejectRow),
    status: payload.durum === null
      ? "created"
      : requiredEnum(payload.durum, "durum", orderStatuses, rejectRow),
    source: requiredEnum(payload.kaynak, "kaynak", orderSources, rejectRow),
    orderType: payload.siparis_tipi === null
      ? "standard"
      : requiredEnum(payload.siparis_tipi, "siparis_tipi", orderTypes, rejectRow),
    totalAmount: moneyAmount(payload.genel_toplam, "genel_toplam", rejectRow),
    subtotal: moneyAmount(payload.ara_toplam, "ara_toplam", rejectRow),
    taxTotal: moneyAmount(payload.kdv_toplam, "kdv_toplam", rejectRow),
    shippingAmount: moneyAmount(payload.kargo_ucreti, "kargo_ucreti", rejectRow),
    currency: "TRY" as const,
    confirmationStatus: payload.teyit_durumu === null
      ? null
      : requiredEnum(payload.teyit_durumu, "teyit_durumu", confirmationStatuses, rejectRow),
    customerName: requiredName(payload.musteri_ad, "musteri_ad", rejectRow),
    customerPhone: requiredName(payload.musteri_telefon, "musteri_telefon", rejectRow),
    customerAddress: optionalTrimmedString(payload.musteri_adres, "musteri_adres", rejectRow),
    customerCity: optionalTrimmedString(payload.musteri_il, "musteri_il", rejectRow),
    customerDistrict: optionalTrimmedString(payload.musteri_ilce, "musteri_ilce", rejectRow),
    customerPostalCode: optionalTrimmedString(payload.musteri_posta_kodu, "musteri_posta_kodu", rejectRow),
    externalOrderId: optionalTrimmedString(payload.kolaybi_siparis_id, "kolaybi_siparis_id", rejectRow),
    notes: optionalTrimmedString(payload.notlar, "notlar", rejectRow),
    legacyTimestamps: Object.freeze({
      createdAt: normalizeLegacyTimestamp(payload.olusturma_tarihi, "olusturma_tarihi", rejectRow),
      updatedAt: normalizeLegacyTimestamp(payload.guncelleme_tarihi, "guncelleme_tarihi", rejectRow),
    }),
    sourceRemainder: remainderFromPayload(payload, rejectRow),
  });

  return Object.freeze({
    sourcePayloadChecksum: row.sourcePayloadChecksum,
    order,
    reconciliation: Object.freeze(reconciliation),
  });
}

function parseLegacyOrder(record: LegacyRecord, reject: LegacyRowRejection): ParsedLegacyOrder {
  if (record.sourceTable !== legacyOrderTable) reject(`source table must be ${legacyOrderTable}`);
  if (typeof record.sourceSystem !== "string" || !record.sourceSystem.trim()) {
    reject("source system must be a nonblank string");
  }
  const payload = inspectPayload(record.payload, reject);

  const keys = Object.keys(payload);
  const missing = legacyOrderFields.filter((field) => !Object.hasOwn(payload, field));
  if (missing.length > 0) reject(`payload is missing required fields [${missing.join(", ")}]`);
  if (keys.some((field) => !legacyOrderFields.includes(field))) reject("payload contains unknown fields");
  if (keys.length !== legacyOrderFields.length) reject("payload field set is invalid");

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
    sourceTable: legacyOrderTable,
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
    if (error instanceof LegacyOrderRowError) throw error;
    reject("payload could not be inspected");
  }

  const payload = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor) || !descriptor.enumerable) reject("payload fields must be enumerable data properties");
    Object.defineProperty(payload, key, { value: descriptor.value, enumerable: true });
  }
  return payload;
}

function requiredEnum<T>(
  value: unknown,
  field: string,
  values: ReadonlyMap<string, T>,
  reject: LegacyRowRejection,
): T {
  const mapped = typeof value === "string" ? values.get(value) : undefined;
  if (mapped === undefined) reject(`field ${field} has an unsupported value`);
  return mapped;
}

function requiredUuid(value: unknown, field: string, reject: LegacyRowRejection): string {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    reject(`field ${field} is required`);
  }
  if (typeof value !== "string" || !uuidPattern.test(value)) reject(`field ${field} must be a UUID`);
  return value.toLowerCase();
}

function optionalUuid(value: unknown, field: string, reject: LegacyRowRejection): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !uuidPattern.test(value)) reject(`field ${field} must be a UUID or null`);
  return value.toLowerCase();
}

function requiredName(value: unknown, field: string, reject: LegacyRowRejection): string {
  if (typeof value !== "string") reject(`field ${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) reject(`field ${field} must not be blank`);
  return trimmed;
}

function optionalTrimmedString(value: unknown, field: string, reject: LegacyRowRejection): string | null {
  if (value === null) return null;
  if (typeof value !== "string") reject(`field ${field} must be a string or null`);
  const trimmed = value.trim();
  return trimmed || null;
}

function moneyAmount(value: unknown, field: string, reject: LegacyRowRejection): string {
  if (value === null) return "0.00";
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) reject(`field ${field} must be a non-negative decimal or null`);
    return formatTwoDecimal(String(value), field, reject);
  }
  if (typeof value !== "string") reject(`field ${field} must be a non-negative decimal or null`);
  return formatTwoDecimal(value, field, reject);
}

function formatTwoDecimal(raw: string, field: string, reject: LegacyRowRejection): string {
  if (raw.startsWith("-")) reject(`field ${field} must be a non-negative decimal or null`);
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(raw);
  if (!match) reject(`field ${field} must be a non-negative decimal or null`);
  const fraction = match[2] ?? "";
  if (fraction.length > 2 && !/^0+$/.test(fraction.slice(2))) {
    reject(`field ${field} must be a non-negative decimal or null`);
  }
  return `${match[1]}.${fraction.slice(0, 2).padEnd(2, "0")}`;
}

function remainderFromPayload(
  payload: Record<string, unknown>,
  reject: LegacyRowRejection,
): LegacyOrderSourceRemainder {
  const remainder = Object.create(null) as Record<string, LegacyOrderRemainderValue>;
  for (const column of legacyOrderColumns) {
    if (mappedCatalogColumns.has(column.name)) continue;
    remainder[column.name] = remainderValue(payload[column.name], column, reject);
  }
  return Object.freeze(remainder);
}

function remainderValue(
  value: unknown,
  column: LegacyColumnContract,
  reject: LegacyRowRejection,
): LegacyOrderRemainderValue {
  switch (column.udtName) {
    case "uuid":
      return column.nullable
        ? optionalUuid(value, column.name, reject)
        : requiredUuid(value, column.name, reject);
    case "timestamptz":
      return normalizeLegacyTimestamp(value, column.name, reject);
    case "bool":
      return remainderBoolean(value, column, reject);
    case "int4":
      return remainderInteger(value, column, postgresIntegerMin, postgresIntegerMax, reject);
    case "int2":
      return remainderInteger(value, column, postgresSmallintMin, postgresSmallintMax, reject);
    case "varchar":
    case "text":
      return optionalTrimmedString(value, column.name, reject);
    default:
      reject(`field ${column.name} has an unsupported remainder type`);
  }
}

function remainderBoolean(
  value: unknown,
  column: LegacyColumnContract,
  reject: LegacyRowRejection,
): boolean | null {
  if (value === null) {
    if (!column.nullable) reject(`field ${column.name} is required`);
    return null;
  }
  if (typeof value !== "boolean") {
    reject(column.nullable ? `field ${column.name} must be a boolean or null` : `field ${column.name} must be a boolean`);
  }
  return value;
}

function remainderInteger(
  value: unknown,
  column: LegacyColumnContract,
  min: number,
  max: number,
  reject: LegacyRowRejection,
): number | null {
  if (value === null) {
    if (!column.nullable) reject(`field ${column.name} is required`);
    return null;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    reject(column.nullable ? `field ${column.name} must be an integer or null` : `field ${column.name} must be an integer`);
  }
  return value;
}

function stablePublicId(row: ParsedLegacyOrder): string {
  const identity = [row.sourceSystem, row.sourceTable, row.sourceId, "primary"].join(":");
  return `ord_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

function catalogColumns(sourceTable: string): readonly LegacyColumnContract[] {
  const mapping = legacyMappingCatalog.tables.find((table) => table.sourceTable === sourceTable);
  if (!mapping) throw new Error(`Legacy mapping catalog does not declare ${sourceTable}`);
  return mapping.columns;
}

class LegacyOrderRowError extends Error {}

function failOrder(reason: string): never {
  throw new LegacyOrderRowError(`Invalid legacy order row: ${reason}`);
}

class OrderTransformContextError extends Error {}

function failContext(reason: string): never {
  throw new OrderTransformContextError(`Invalid order transform context: ${reason}`);
}
