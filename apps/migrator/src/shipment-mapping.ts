import { createHash } from "node:crypto";
import { normalizeLegacyTimestamp } from "./customer-mapping.js";
import type { LegacyRowRejection } from "./customer-mapping.js";
import { calculateSourcePayloadChecksum } from "./legacy-source.js";
import type { SourcePayloadChecksum } from "./legacy-source.js";
import { legacyMappingCatalog } from "./mapping-catalog.js";
import type { LegacyColumnContract } from "./mapping-catalog.js";
import type { LegacyRecord } from "./types.js";

export const legacyShipmentTable = "public.kargo_gonderimleri";
const legacyShipmentColumns = catalogColumns(legacyShipmentTable);
const legacyShipmentFields = Object.freeze(legacyShipmentColumns.map((column) => column.name));
const legacyShipmentRequiredFields = Object.freeze(legacyShipmentColumns.filter((column) => column.required).map((column) => column.name));
const checksumPattern = /^sha256:[0-9a-f]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const customerPublicIdPattern = /^cus_[0-9a-f]{24}$/;

const providerValues: ReadonlyMap<string, ShipmentProvider> = new Map([
  ["manual", "manual"],
  ["manuel", "manual"],
  ["ptt", "ptt"],
  ["ptt_kargo", "ptt"],
  ["surat", "surat"],
  ["sürat", "surat"],
  ["surat_kargo", "surat"],
  ["sürat_kargo", "surat"],
  ["surat kargo", "surat"],
  ["sürat kargo", "surat"],
]);

const statusValues: ReadonlyMap<string, ShipmentStatus> = new Map([
  ["beklemede", "created"],
  ["olusturuldu", "created"],
  ["hazirlaniyor", "preparing"],
  ["kargoya_verildi", "shipped"],
  ["sevk_edildi", "shipped"],
  ["yolda", "in_transit"],
  ["dagitimda", "out_for_delivery"],
  ["teslim_edildi", "delivered"],
  ["iptal", "cancelled"],
  ["iade", "returned"],
]);

export type ShipmentProvider = "manual" | "ptt" | "surat";
export type ShipmentStatus =
  | "created"
  | "preparing"
  | "shipped"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "returned";

export interface ShipmentTransformContext {
  readonly customerPublicIds: ReadonlyMap<string, string>;
  readonly orderPublicIdsByTracking?: ReadonlyMap<string, readonly string[]>;
  readonly customerPublicIdsByOrderPublicId?: ReadonlyMap<string, string>;
}

export type ShipmentReconciliation = {
  readonly code: "unresolved_customer";
  readonly legacyCustomerId: string;
};

interface LegacyTimestamps {
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly lastEventAt: string | null;
}

export interface LegacyShipmentDraft {
  readonly kind: "legacy_shipment_draft";
  readonly targetTable: "shipments";
  readonly publicId: string;
  readonly mappingRole: "primary";
  readonly orderPublicId: string | null;
  readonly customerPublicId: string | null;
  readonly provider: ShipmentProvider;
  readonly trackingNumber: string | null;
  readonly barcodeNumber: string | null;
  readonly status: ShipmentStatus;
  readonly recipientName: string;
  readonly recipientPhone: string | null;
  readonly recipientAddress: string;
  readonly recipientCity: string | null;
  readonly recipientDistrict: string | null;
  readonly lastEventText: string | null;
  readonly shippedAt: null;
  readonly deliveredAt: null;
  readonly rawPayload: LegacyShipmentRawPayload;
  readonly legacyTimestamps: LegacyTimestamps;
}

export type LegacyShipmentRawValue = string | number | boolean | null;
export type LegacyShipmentRawPayload = Readonly<Record<string, LegacyShipmentRawValue>>;

export interface ShipmentTransformationResult {
  readonly sourcePayloadChecksum: SourcePayloadChecksum;
  readonly shipment: LegacyShipmentDraft;
  readonly reconciliation: readonly ShipmentReconciliation[];
}

interface ParsedLegacyShipment {
  readonly sourcePayloadChecksum: SourcePayloadChecksum;
  readonly sourceSystem: string;
  readonly sourceTable: string;
  readonly sourceId: string;
  readonly payload: Record<string, unknown>;
}

export function transformLegacyShipment(
  record: LegacyRecord,
  context: ShipmentTransformContext,
): ShipmentTransformationResult {
  const rejectRow: LegacyRowRejection = failShipment;
  const row = parseLegacyShipment(record, rejectRow);
  const { payload } = row;

  const reconciliation: ShipmentReconciliation[] = [];
  const trackingCandidates = shipmentTrackingCandidates(payload, rejectRow);
  const orderResolution = resolveShipmentOrder(trackingCandidates, context);
  let customerPublicId: string | null = null;
  if (orderResolution.orderPublicId !== null) {
    customerPublicId = context.customerPublicIdsByOrderPublicId?.get(orderResolution.orderPublicId) ?? null;
  }
  const legacyCustomerId = optionalUuid(payload.musteri_id, "musteri_id", rejectRow);
  if (customerPublicId === null && legacyCustomerId !== null) {
    const mappedCustomerId = context.customerPublicIds.get(legacyCustomerId);
    if (mappedCustomerId === undefined) {
      reconciliation.push(Object.freeze({ code: "unresolved_customer" as const, legacyCustomerId }));
    } else {
      if (typeof mappedCustomerId !== "string" || !customerPublicIdPattern.test(mappedCustomerId)) {
        failContext("customer public id map contains an illegal public id");
      }
      customerPublicId = mappedCustomerId;
    }
  }

  const shipment: LegacyShipmentDraft = Object.freeze({
    kind: "legacy_shipment_draft" as const,
    targetTable: "shipments" as const,
    publicId: stablePublicId(row),
    mappingRole: "primary" as const,
    orderPublicId: orderResolution.orderPublicId,
    customerPublicId,
    provider: requiredProvider(payload.kargo_firmasi, rejectRow),
    trackingNumber: firstNonblank([
      optionalTrimmedString(payload.takip_no, "takip_no", rejectRow),
      optionalTrimmedString(payload.surat_kargo_takip_no, "surat_kargo_takip_no", rejectRow),
    ]),
    barcodeNumber: optionalTrimmedString(payload.surat_barkod_no, "surat_barkod_no", rejectRow),
    status: payload.durum === null ? "created" : requiredStatus(payload.durum, rejectRow),
    recipientName: requiredName(payload.alici_ad, "alici_ad", rejectRow),
    recipientPhone: optionalTrimmedString(payload.alici_telefon, "alici_telefon", rejectRow),
    recipientAddress: requiredName(payload.alici_adres, "alici_adres", rejectRow),
    recipientCity: optionalTrimmedString(payload.alici_il, "alici_il", rejectRow),
    recipientDistrict: optionalTrimmedString(payload.alici_ilce, "alici_ilce", rejectRow),
    lastEventText: optionalTrimmedString(payload.son_hareket, "son_hareket", rejectRow),
    shippedAt: null,
    deliveredAt: null,
    rawPayload: rawPayloadFromSource(payload, rejectRow),
    legacyTimestamps: Object.freeze({
      createdAt: normalizeLegacyTimestamp(payload.olusturma_tarihi, "olusturma_tarihi", rejectRow),
      updatedAt: normalizeLegacyTimestamp(payload.guncelleme_tarihi, "guncelleme_tarihi", rejectRow),
      lastEventAt: normalizeLegacyTimestamp(payload.son_hareket_tarihi, "son_hareket_tarihi", rejectRow),
    }),
  });

  return Object.freeze({
    sourcePayloadChecksum: row.sourcePayloadChecksum,
    shipment,
    reconciliation: Object.freeze(reconciliation),
  });
}

function parseLegacyShipment(record: LegacyRecord, reject: LegacyRowRejection): ParsedLegacyShipment {
  if (record.sourceTable !== legacyShipmentTable) reject(`source table must be ${legacyShipmentTable}`);
  if (typeof record.sourceSystem !== "string" || !record.sourceSystem.trim()) {
    reject("source system must be a nonblank string");
  }
  const payload = inspectPayload(record.payload, reject);

  const keys = Object.keys(payload);
  const missing = legacyShipmentRequiredFields.filter((field) => !Object.hasOwn(payload, field));
  if (missing.length > 0) reject(`payload is missing required fields [${missing.join(", ")}]`);
  if (keys.some((field) => !legacyShipmentFields.includes(field))) reject("payload contains unknown fields");

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
    sourceTable: legacyShipmentTable,
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
    if (error instanceof LegacyShipmentRowError) throw error;
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

function optionalUuid(value: unknown, field: string, reject: LegacyRowRejection): string | null {
  if (value === null || value === undefined) return null;
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
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") reject(`field ${field} must be a string or null`);
  const trimmed = value.trim();
  return trimmed || null;
}

function requiredProvider(value: unknown, reject: LegacyRowRejection): ShipmentProvider {
  const key = typeof value === "string" ? value.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ") : "";
  const mapped = providerValues.get(key) ?? providerValues.get(key.replace(/\s+/g, "_"));
  if (mapped === undefined) reject("field kargo_firmasi has an unsupported value");
  return mapped;
}

function requiredStatus(value: unknown, reject: LegacyRowRejection): ShipmentStatus {
  const key = typeof value === "string" ? value.trim().toLocaleLowerCase("tr-TR") : "";
  const mapped = statusValues.get(key);
  if (mapped === undefined) reject("field durum has an unsupported value");
  return mapped;
}

function firstNonblank(values: readonly (string | null)[]): string | null {
  return values.find((value) => value !== null) ?? null;
}

export function normalizeShipmentTrackingNumber(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().toLocaleUpperCase("tr-TR");
  return normalized || null;
}

function shipmentTrackingCandidates(
  payload: Record<string, unknown>,
  reject: LegacyRowRejection,
): readonly string[] {
  const candidates = [
    optionalTrimmedString(payload.takip_no, "takip_no", reject),
    optionalTrimmedString(payload.surat_kargo_takip_no, "surat_kargo_takip_no", reject),
    optionalTrimmedString(payload.surat_barkod_no, "surat_barkod_no", reject),
  ].map(normalizeShipmentTrackingNumber).filter((value): value is string => value !== null);
  return [...new Set(candidates)];
}

function resolveShipmentOrder(
  candidates: readonly string[],
  context: ShipmentTransformContext,
): { readonly orderPublicId: string | null } {
  for (const candidate of candidates) {
    const matches = context.orderPublicIdsByTracking?.get(candidate) ?? [];
    if (matches.length === 1) return { orderPublicId: matches[0]! };
    if (matches.length > 1) return { orderPublicId: null };
  }
  return { orderPublicId: null };
}

function rawPayloadFromSource(
  payload: Record<string, unknown>,
  reject: LegacyRowRejection,
): LegacyShipmentRawPayload {
  const raw = Object.create(null) as Record<string, LegacyShipmentRawValue>;
  for (const column of legacyShipmentColumns) {
    raw[column.name] = rawValue(payload[column.name], column, reject);
  }
  return Object.freeze(raw);
}

function rawValue(
  value: unknown,
  column: LegacyColumnContract,
  reject: LegacyRowRejection,
): LegacyShipmentRawValue {
  switch (column.udtName) {
    case "uuid":
      return column.nullable
        ? optionalUuid(value, column.name, reject)
        : requiredUuid(value, column.name, reject);
    case "timestamptz":
      return normalizeLegacyTimestamp(value, column.name, reject);
    case "int4":
      return optionalInteger(value, column.name, reject);
    case "numeric":
      return optionalDecimal(value, column.name, reject);
    case "varchar":
    case "text":
      return optionalTrimmedString(value, column.name, reject);
    default:
      reject(`field ${column.name} has an unsupported raw payload type`);
  }
}

function optionalInteger(value: unknown, field: string, reject: LegacyRowRejection): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    reject(`field ${field} must be an integer or null`);
  }
  return value;
}

function optionalDecimal(value: unknown, field: string, reject: LegacyRowRejection): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject(`field ${field} must be a decimal or null`);
    return value.toString();
  }
  if (typeof value !== "string" || !/^-?(0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    reject(`field ${field} must be a decimal or null`);
  }
  return value;
}

function stablePublicId(row: ParsedLegacyShipment): string {
  const identity = [row.sourceSystem, row.sourceTable, row.sourceId, "primary"].join(":");
  return `shp_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

function catalogColumns(sourceTable: string): readonly LegacyColumnContract[] {
  const mapping = legacyMappingCatalog.tables.find((table) => table.sourceTable === sourceTable);
  if (!mapping) throw new Error(`Legacy mapping catalog does not declare ${sourceTable}`);
  return mapping.columns;
}

class LegacyShipmentRowError extends Error {}

function failShipment(reason: string): never {
  throw new LegacyShipmentRowError(`Invalid legacy shipment row: ${reason}`);
}

class ShipmentTransformContextError extends Error {}

function failContext(reason: string): never {
  throw new ShipmentTransformContextError(`Invalid shipment transform context: ${reason}`);
}
