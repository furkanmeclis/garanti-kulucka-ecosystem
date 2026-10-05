import { createHash } from "node:crypto";
import { normalizeLegacyTimestamp } from "./customer-mapping.js";
import type { LegacyRowRejection } from "./customer-mapping.js";
import { calculateSourcePayloadChecksum } from "./legacy-source.js";
import type { SourcePayloadChecksum } from "./legacy-source.js";
import { legacyMappingCatalog } from "./mapping-catalog.js";
import type { LegacyRecord } from "./types.js";

export const legacyProductTable = "public.urunler";
const legacyProductFields = catalogColumnNames(legacyProductTable);
const legacyProductRequiredFields = catalogRequiredColumnNames(legacyProductTable);
const checksumPattern = /^sha256:[0-9a-f]{64}$/;
const postgresIntegerMax = 2_147_483_647;

const productCategories: ReadonlyMap<string, ProductCategory> = new Map([
  ["diger", "other"],
  ["kulucka", "incubator"],
  ["yedek_parca", "spare_part"],
]);

export type ProductCategory = "other" | "incubator" | "spare_part";

interface LegacyTimestamps {
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface LegacyProductDraft {
  readonly kind: "legacy_product_draft";
  readonly targetTable: "products";
  readonly publicId: string;
  readonly mappingRole: "primary";
  readonly name: string;
  readonly sku: string | null;
  readonly category: ProductCategory;
  readonly unitPrice: string;
  readonly stockQuantity: number;
  readonly isActive: boolean;
  readonly externalProductId: string | null;
  readonly unit: string | null;
  readonly reorderLevel: number | null;
  readonly description: string | null;
  readonly legacyTimestamps: LegacyTimestamps;
}

export interface ProductTransformationResult {
  readonly sourcePayloadChecksum: SourcePayloadChecksum;
  readonly product: LegacyProductDraft;
}

interface ParsedLegacyProduct {
  readonly sourcePayloadChecksum: SourcePayloadChecksum;
  readonly sourceSystem: string;
  readonly sourceTable: string;
  readonly sourceId: string;
  readonly payload: Record<string, unknown>;
}

export function transformLegacyProduct(record: LegacyRecord): ProductTransformationResult {
  const rejectRow: LegacyRowRejection = failProduct;
  const row = parseLegacyProduct(record, rejectRow);
  const { payload } = row;

  const product: LegacyProductDraft = Object.freeze({
    kind: "legacy_product_draft" as const,
    targetTable: "products" as const,
    publicId: stablePublicId(row),
    mappingRole: "primary" as const,
    name: requiredName(payload.ad, "ad", rejectRow),
    sku: optionalTrimmedString(payload.kod, "kod", rejectRow),
    category: mapCategory(payload.kategori, rejectRow),
    unitPrice: unitPrice(payload.satis_fiyati, "satis_fiyati", rejectRow),
    stockQuantity: optionalNonNegativeInteger(payload.stok_miktari, "stok_miktari", rejectRow) ?? 0,
    isActive: optionalBoolean(payload.aktif, "aktif", rejectRow) ?? true,
    externalProductId: optionalTrimmedString(payload.kolaybi_product_id, "kolaybi_product_id", rejectRow),
    unit: optionalTrimmedString(payload.birim, "birim", rejectRow),
    reorderLevel: optionalNonNegativeInteger(payload.kritik_seviye, "kritik_seviye", rejectRow),
    description: optionalTrimmedString(payload.aciklama, "aciklama", rejectRow),
    legacyTimestamps: Object.freeze({
      createdAt: normalizeLegacyTimestamp(payload.olusturma_tarihi, "olusturma_tarihi", rejectRow),
      updatedAt: normalizeLegacyTimestamp(payload.guncelleme_tarihi, "guncelleme_tarihi", rejectRow),
    }),
  });

  return Object.freeze({
    sourcePayloadChecksum: row.sourcePayloadChecksum,
    product,
  });
}

function parseLegacyProduct(record: LegacyRecord, reject: LegacyRowRejection): ParsedLegacyProduct {
  if (record.sourceTable !== legacyProductTable) reject(`source table must be ${legacyProductTable}`);
  if (typeof record.sourceSystem !== "string" || !record.sourceSystem.trim()) {
    reject("source system must be a nonblank string");
  }
  const payload = inspectPayload(record.payload, reject);

  const keys = Object.keys(payload);
  const missing = legacyProductRequiredFields.filter((field) => !Object.hasOwn(payload, field));
  if (missing.length > 0) reject(`payload is missing required fields [${missing.join(", ")}]`);
  if (keys.some((field) => !legacyProductFields.includes(field))) reject("payload contains unknown fields");

  if (typeof record.checksum !== "string" || !checksumPattern.test(record.checksum)) {
    reject("source payload checksum is invalid");
  }
  if (record.checksum !== calculateSourcePayloadChecksum(payload)) {
    reject("source payload checksum does not match payload");
  }

  const payloadId = requiredIntegerId(payload.id, "id", reject);
  if (typeof record.sourceId !== "string" || record.sourceId !== payloadId) {
    reject("sourceId does not match payload id");
  }

  return {
    sourcePayloadChecksum: record.checksum as SourcePayloadChecksum,
    sourceSystem: record.sourceSystem.trim(),
    sourceTable: legacyProductTable,
    sourceId: payloadId,
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
    if (error instanceof LegacyProductRowError) throw error;
    reject("payload could not be inspected");
  }

  const payload = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor) || !descriptor.enumerable) reject("payload fields must be enumerable data properties");
    Object.defineProperty(payload, key, { value: descriptor.value, enumerable: true });
  }
  return payload;
}

function requiredIntegerId(value: unknown, field: string, reject: LegacyRowRejection): string {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > postgresIntegerMax) {
    reject(`field ${field} must be a non-negative PostgreSQL integer`);
  }
  return String(value);
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

function mapCategory(value: unknown, reject: LegacyRowRejection): ProductCategory {
  if (value === null) return "other";
  const mapped = typeof value === "string" ? productCategories.get(value) : undefined;
  if (mapped === undefined) reject("field kategori has an unsupported value");
  return mapped;
}

function unitPrice(value: unknown, field: string, reject: LegacyRowRejection): string {
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

function optionalNonNegativeInteger(value: unknown, field: string, reject: LegacyRowRejection): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > postgresIntegerMax) {
    reject(`field ${field} must be a non-negative integer or null`);
  }
  return value;
}

function optionalBoolean(value: unknown, field: string, reject: LegacyRowRejection): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "boolean") reject(`field ${field} must be a boolean or null`);
  return value;
}

function stablePublicId(row: ParsedLegacyProduct): string {
  const identity = [row.sourceSystem, row.sourceTable, row.sourceId, "primary"].join(":");
  return `prd_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

function catalogColumnNames(sourceTable: string): readonly string[] {
  const mapping = legacyMappingCatalog.tables.find((table) => table.sourceTable === sourceTable);
  if (!mapping) throw new Error(`Legacy mapping catalog does not declare ${sourceTable}`);
  return Object.freeze(mapping.columns.map((column) => column.name));
}

function catalogRequiredColumnNames(sourceTable: string): readonly string[] {
  const mapping = legacyMappingCatalog.tables.find((table) => table.sourceTable === sourceTable);
  if (!mapping) throw new Error(`Legacy mapping catalog does not declare ${sourceTable}`);
  return Object.freeze(mapping.columns.filter((column) => column.required).map((column) => column.name));
}

class LegacyProductRowError extends Error {}

function failProduct(reason: string): never {
  throw new LegacyProductRowError(`Invalid legacy product row: ${reason}`);
}
