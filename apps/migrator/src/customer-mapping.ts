import { createHash } from "node:crypto";
import { calculateSourcePayloadChecksum } from "./legacy-source.js";
import type { SourcePayloadChecksum } from "./legacy-source.js";
import type { LegacyRecord } from "./types.js";

const legacyCustomerTable = "public.musteriler";
const legacyCustomerFields = [
  "id",
  "ad",
  "soyad",
  "email",
  "telefon",
  "adres",
  "il",
  "ilce",
  "posta_kodu",
  "notlar",
  "woocommerce_id",
  "kolaybi_id",
  "olusturma_tarihi",
  "guncelleme_tarihi",
  "username",
] as const;

const legacyCustomerFieldSet = new Set<string>(legacyCustomerFields);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const checksumPattern = /^sha256:[0-9a-f]{64}$/;
// Canonical legacy timestamps are UTC with fixed microsecond precision, preserving all source fractional digits.
const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|([+-])(\d{2})(?::?(\d{2}))?)$/;
const boundaryIgnorablePattern = /^[\s\u200B\uFEFF]+|[\s\u200B\uFEFF]+$/gu;
const identifierIgnorablePattern = /[\u200B\u2060\uFEFF]/gu;
const visibilityIgnorablePattern = /[\s\u200B\u200C\u200D\u2060\uFEFF]/gu;
const forbiddenExternalIdentityPattern = /[\u200B\u2060\uFEFF]/u;
const externalIdentityBlankPattern = /[\s\u200C\u200D]/gu;
const integrationAccountPublicIdPattern = /^iac_[a-z0-9_]{1,64}$/;
const customerIdentityProviders = new Set<string>(["woocommerce", "kolaybi", "instagram", "messenger"]);

export type CustomerIdentityProvider = "woocommerce" | "kolaybi" | "instagram" | "messenger";

export interface CustomerMappingWarning {
  readonly code: "customer_name_fallback";
  readonly message: string;
}

interface LegacyTimestamps {
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface LegacyCustomerDraft {
  readonly kind: "legacy_customer_draft";
  readonly targetTable: "customers";
  readonly publicId: string;
  readonly mappingRole: "primary";
  readonly full_name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly username: string | null;
  readonly notes: string | null;
  readonly legacyTimestamps: LegacyTimestamps;
}

export interface LegacyCustomerAddressDraft {
  readonly kind: "legacy_customer_address_draft";
  readonly targetTable: "customer_addresses";
  readonly publicId: string;
  readonly mappingRole: "address:default";
  readonly customerPublicId: string;
  readonly label: "Default";
  readonly address_line: string;
  readonly district: string | null;
  readonly city: string | null;
  readonly country: "TR";
  readonly postal_code: string | null;
  readonly is_default: true;
  readonly legacyTimestamps: LegacyTimestamps;
}

export interface UnresolvedCustomerExternalIdentity {
  readonly kind: "unresolved_customer_external_identity";
  readonly customerPublicId: string;
  readonly providerKey: CustomerIdentityProvider;
  readonly externalId: string;
  readonly source: Readonly<{
    table: typeof legacyCustomerTable;
    field: "woocommerce_id" | "kolaybi_id" | "telefon";
  }>;
  readonly legacyTimestamps: LegacyTimestamps;
}

export interface VerifiedIntegrationAccount {
  readonly publicId: string;
  readonly providerKey: CustomerIdentityProvider;
  readonly status: "active" | "inactive";
}

export type CustomerExternalIdentityMappingRole = `external_identity:${CustomerIdentityProvider}`;

export interface LegacyCustomerExternalIdentityDraft {
  readonly kind: "legacy_customer_external_identity_draft";
  readonly targetTable: "customer_external_identities";
  readonly publicId: string;
  readonly mappingRole: CustomerExternalIdentityMappingRole;
  readonly customerPublicId: string;
  readonly integrationAccountPublicId: string;
  readonly externalId: string;
  readonly legacyTimestamps: LegacyTimestamps;
}

export interface CustomerExternalIdentityResolution {
  readonly resolved: readonly LegacyCustomerExternalIdentityDraft[];
  readonly unresolved: readonly UnresolvedCustomerExternalIdentity[];
}

export interface CustomerTransformationResult {
  readonly sourcePayloadChecksum: SourcePayloadChecksum;
  readonly customer: LegacyCustomerDraft;
  readonly address: LegacyCustomerAddressDraft | null;
  readonly externalIdentityCandidates: readonly UnresolvedCustomerExternalIdentity[];
  readonly warnings: readonly CustomerMappingWarning[];
}

interface ParsedLegacyCustomer {
  readonly sourcePayloadChecksum: SourcePayloadChecksum;
  readonly sourceSystem: string;
  readonly sourceId: string;
  readonly ad: string;
  readonly soyad: string | null;
  readonly email: string | null;
  readonly telefon: string;
  readonly adres: string | null;
  readonly il: string | null;
  readonly ilce: string | null;
  readonly postaKodu: string | null;
  readonly notlar: string | null;
  readonly woocommerceId: number | null;
  readonly kolaybiId: string | null;
  readonly legacyTimestamps: LegacyTimestamps;
  readonly username: string | null;
}

export function transformLegacyCustomer(record: LegacyRecord): CustomerTransformationResult {
  const legacy = parseLegacyCustomer(record);
  const customerPublicId = stablePublicId("cus", legacy);
  const warnings: CustomerMappingWarning[] = [];
  const composedName = [normalizeOptionalString(legacy.ad), legacy.soyad].filter(isNonNull).join(" ");
  let fullName = composedName || legacy.username;
  if (!fullName) {
    fullName = `Legacy Customer ${stableDigest(`name:${legacy.sourceId}`).slice(0, 10)}`;
    warnings.push({
      code: "customer_name_fallback",
      message: "Customer name and username were blank; a deterministic non-PII fallback was used",
    });
  }

  const socialIdentity = extractSocialIdentity(legacy.telefon);
  const customer = Object.freeze({
    kind: "legacy_customer_draft" as const,
    targetTable: "customers" as const,
    publicId: customerPublicId,
    mappingRole: "primary" as const,
    full_name: fullName,
    phone: socialIdentity ? null : normalizeOptionalString(legacy.telefon),
    email: legacy.email,
    username: legacy.username,
    notes: legacy.notlar,
    legacyTimestamps: Object.freeze({ ...legacy.legacyTimestamps }),
  });
  const address = createAddressDraft(legacy, customerPublicId);
  const externalIdentityCandidates = createIdentityCandidates(legacy, customerPublicId, socialIdentity);

  return Object.freeze({
    sourcePayloadChecksum: legacy.sourcePayloadChecksum,
    customer,
    address: address ? Object.freeze(address) : null,
    externalIdentityCandidates: Object.freeze(externalIdentityCandidates.map((candidate) => Object.freeze(candidate))),
    warnings: Object.freeze(warnings.map((warning) => Object.freeze(warning))),
  });
}

export function resolveCustomerExternalIdentities(
  candidates: readonly UnresolvedCustomerExternalIdentity[],
  accounts: readonly VerifiedIntegrationAccount[],
): CustomerExternalIdentityResolution {
  const activeAccountByProvider = indexActiveAccounts(accounts);
  const resolved: LegacyCustomerExternalIdentityDraft[] = [];
  const unresolved: UnresolvedCustomerExternalIdentity[] = [];

  for (const candidate of candidates) {
    const account = activeAccountByProvider.get(candidate.providerKey);
    if (!account) {
      unresolved.push(Object.freeze({
        ...candidate,
        source: Object.freeze({ ...candidate.source }),
        legacyTimestamps: Object.freeze({ ...candidate.legacyTimestamps }),
      }));
      continue;
    }
    const mappingRole: CustomerExternalIdentityMappingRole = `external_identity:${account.providerKey}`;
    resolved.push(Object.freeze({
      kind: "legacy_customer_external_identity_draft" as const,
      targetTable: "customer_external_identities" as const,
      publicId: stablePublicIdFromParts("cext", [
        candidate.source.table,
        candidate.customerPublicId,
        mappingRole,
        account.publicId,
      ]),
      mappingRole,
      customerPublicId: candidate.customerPublicId,
      integrationAccountPublicId: account.publicId,
      externalId: candidate.externalId,
      legacyTimestamps: Object.freeze({ ...candidate.legacyTimestamps }),
    }));
  }

  return Object.freeze({
    resolved: Object.freeze(resolved),
    unresolved: Object.freeze(unresolved),
  });
}

function indexActiveAccounts(
  accounts: readonly VerifiedIntegrationAccount[],
): ReadonlyMap<CustomerIdentityProvider, VerifiedIntegrationAccount> {
  if (!Array.isArray(accounts)) failAccountSnapshot("accounts must be an array");
  const seenPublicIds = new Set<string>();
  const activeByProvider = new Map<CustomerIdentityProvider, VerifiedIntegrationAccount>();

  for (let index = 0; index < accounts.length; index += 1) {
    const account: unknown = accounts[index];
    if (account === null || typeof account !== "object") {
      failAccountSnapshot(`account at index ${index} must be an object`);
    }
    const { publicId, providerKey, status } = account as Record<string, unknown>;
    if (typeof publicId !== "string" || !integrationAccountPublicIdPattern.test(publicId)) {
      failAccountSnapshot(`account at index ${index} has a blank or illegal public id`);
    }
    if (typeof providerKey !== "string" || !customerIdentityProviders.has(providerKey)) {
      failAccountSnapshot(`account at index ${index} has an unknown provider`);
    }
    if (status !== "active" && status !== "inactive") {
      failAccountSnapshot(`account at index ${index} has an unknown status`);
    }
    if (seenPublicIds.has(publicId)) failAccountSnapshot(`account at index ${index} duplicates a public id`);
    seenPublicIds.add(publicId);
    if (status !== "active") continue;

    const provider = providerKey as CustomerIdentityProvider;
    if (activeByProvider.has(provider)) {
      failAccountSnapshot(`provider ${provider} has more than one active account`);
    }
    activeByProvider.set(provider, { publicId, providerKey: provider, status });
  }

  return activeByProvider;
}

function parseLegacyCustomer(record: LegacyRecord): ParsedLegacyCustomer {
  if (record.sourceTable !== legacyCustomerTable) fail("source table must be public.musteriler");
  const sourceSystem = requiredNonblankIdentifier(record.sourceSystem, "source system");
  const payload = inspectPayload(record.payload);

  const keys = Object.keys(payload);
  const missing = legacyCustomerFields.filter((field) => !Object.hasOwn(payload, field));
  if (missing.length > 0) fail(`payload is missing required fields [${missing.join(", ")}]`);
  const unknown = keys.filter((field) => !legacyCustomerFieldSet.has(field)).sort(compareStrings);
  if (unknown.length > 0) fail("payload contains unknown fields");
  if (keys.length !== legacyCustomerFields.length) fail("payload field set is invalid");

  const payloadId = requiredUuid(payload.id, "id");
  const sourceId = requiredUuid(record.sourceId, "sourceId");
  if (payloadId !== sourceId) fail("sourceId does not match payload id");

  const ad = requiredString(payload.ad, "ad");
  const soyad = optionalString(payload.soyad, "soyad");
  const email = optionalIdentifierString(payload.email, "email");
  const telefon = requiredPhoneString(payload.telefon);
  const adres = optionalString(payload.adres, "adres");
  const il = optionalString(payload.il, "il");
  const ilce = optionalString(payload.ilce, "ilce");
  const postaKodu = optionalString(payload.posta_kodu, "posta_kodu");
  const notlar = optionalString(payload.notlar, "notlar");
  const woocommerceId = optionalSafeInteger(payload.woocommerce_id, "woocommerce_id");
  const kolaybiId = optionalOpaqueExternalId(payload.kolaybi_id, "kolaybi_id");
  const legacyTimestamps = Object.freeze({
    createdAt: optionalTimestamp(payload.olusturma_tarihi, "olusturma_tarihi"),
    updatedAt: optionalTimestamp(payload.guncelleme_tarihi, "guncelleme_tarihi"),
  });
  const username = optionalIdentifierString(payload.username, "username");
  const sourcePayloadChecksum = validateSourcePayloadChecksum(record.checksum, payload);

  return {
    sourcePayloadChecksum,
    sourceSystem,
    sourceId,
    ad,
    soyad,
    email,
    telefon,
    adres,
    il,
    ilce,
    postaKodu,
    notlar,
    woocommerceId,
    kolaybiId,
    legacyTimestamps,
    username,
  };
}

function createAddressDraft(
  legacy: ParsedLegacyCustomer,
  customerPublicId: string,
): LegacyCustomerAddressDraft | null {
  if (![legacy.adres, legacy.il, legacy.ilce, legacy.postaKodu].some(isNonNull)) return null;
  return {
    kind: "legacy_customer_address_draft",
    targetTable: "customer_addresses",
    publicId: stablePublicId("caddr", legacy, "default"),
    mappingRole: "address:default",
    customerPublicId,
    label: "Default",
    address_line: legacy.adres ?? [legacy.ilce, legacy.il, legacy.postaKodu].filter(isNonNull).join(", "),
    district: legacy.ilce,
    city: legacy.il,
    country: "TR",
    postal_code: legacy.postaKodu,
    is_default: true,
    legacyTimestamps: Object.freeze({ ...legacy.legacyTimestamps }),
  };
}

function createIdentityCandidates(
  legacy: ParsedLegacyCustomer,
  customerPublicId: string,
  socialIdentity: { providerKey: "instagram" | "messenger"; externalId: string } | null,
): UnresolvedCustomerExternalIdentity[] {
  const inputs: {
    providerKey: CustomerIdentityProvider;
    externalId: string;
    sourceField: UnresolvedCustomerExternalIdentity["source"]["field"];
  }[] = [];
  if (legacy.woocommerceId !== null) {
    inputs.push({ providerKey: "woocommerce", externalId: String(legacy.woocommerceId), sourceField: "woocommerce_id" });
  }
  if (legacy.kolaybiId !== null) {
    inputs.push({ providerKey: "kolaybi", externalId: legacy.kolaybiId, sourceField: "kolaybi_id" });
  }
  if (socialIdentity) inputs.push({ ...socialIdentity, sourceField: "telefon" });

  const seen = new Set<string>();
  return inputs.flatMap((input) => {
    const key = `${input.providerKey}\u0000${input.externalId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      kind: "unresolved_customer_external_identity" as const,
      customerPublicId,
      providerKey: input.providerKey,
      externalId: input.externalId,
      source: Object.freeze({ table: legacyCustomerTable, field: input.sourceField }),
      legacyTimestamps: Object.freeze({ ...legacy.legacyTimestamps }),
    }];
  });
}

function extractSocialIdentity(phone: string): {
  providerKey: "instagram" | "messenger";
  externalId: string;
} | null {
  const match = /^(ig|fb)_(.*)$/s.exec(phone);
  if (!match) return null;
  const suffix = validateOpaqueExternalId(match[2] ?? "", "telefon social placeholder suffix");
  return { providerKey: match[1] === "ig" ? "instagram" : "messenger", externalId: suffix };
}

function inspectPayload(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object") fail("payload must be an object");
  const { isArray, prototype, symbolCount, descriptors } = inspectUntrusted(() => ({
    isArray: Array.isArray(value),
    prototype: Object.getPrototypeOf(value),
    symbolCount: Object.getOwnPropertySymbols(value).length,
    descriptors: Object.getOwnPropertyDescriptors(value),
  }), "payload could not be inspected");
  if (isArray) fail("payload must be an object");
  if (prototype !== Object.prototype && prototype !== null) fail("payload must be a plain object");
  if (symbolCount > 0) fail("payload must contain only named data fields");

  const payload = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor) || !descriptor.enumerable) {
      fail("payload fields must be enumerable data properties");
    }
    Object.defineProperty(payload, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return payload;
}

function validateSourcePayloadChecksum(
  value: unknown,
  payload: Record<string, unknown>,
): SourcePayloadChecksum {
  if (typeof value !== "string" || !checksumPattern.test(value)) fail("source payload checksum is invalid");
  if (value !== calculateSourcePayloadChecksum(payload)) fail("source payload checksum does not match payload");
  return value as SourcePayloadChecksum;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") fail(`field ${field} must be a string`);
  return normalizeText(value);
}

function requiredPhoneString(value: unknown): string {
  if (typeof value !== "string") fail("field telefon must be a string");
  const trimmed = value.trim();
  const withoutForbidden = value.replace(/[\u200B\u2060\uFEFF]/gu, "").trim();
  const resemblesSocialIdentity = /^(?:ig|fb)_/s.test(trimmed) || /^(?:ig|fb)_/s.test(withoutForbidden);
  if (!resemblesSocialIdentity) return normalizeText(value);
  if (trimmed !== value) fail("telefon social placeholder must not contain boundary whitespace");
  if (!/^(?:ig|fb)_/s.test(value)) fail("telefon social placeholder contains forbidden invisible characters");
  return value;
}

function requiredNonblankIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string") fail(`${field} must be a string`);
  const normalized = normalizeIdentifier(value);
  if (!normalized) fail(`${field} must not be blank`);
  return normalized;
}

function optionalString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") fail(`field ${field} must be a string or null`);
  return normalizeOptionalString(value);
}

function optionalIdentifierString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") fail(`field ${field} must be a string or null`);
  return normalizeIdentifier(value) || null;
}

function optionalOpaqueExternalId(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") fail(`field ${field} must be a string or null`);
  if (value.length === 0) return null;
  return validateOpaqueExternalId(value, field);
}

function validateOpaqueExternalId(value: string, field: string): string {
  if (value.length === 0 || value.replace(externalIdentityBlankPattern, "").length === 0) {
    fail(`${field} must not be blank`);
  }
  if (value.trim() !== value) fail(`${field} must not contain boundary whitespace`);
  if (forbiddenExternalIdentityPattern.test(value)) fail(`${field} contains forbidden invisible characters`);
  return value;
}

function normalizeOptionalString(value: string): string | null {
  return normalizeText(value) || null;
}

function normalizeText(value: string): string {
  const normalized = value.normalize("NFC").replace(boundaryIgnorablePattern, "");
  return normalized.replace(visibilityIgnorablePattern, "") ? normalized : "";
}

function normalizeIdentifier(value: string): string {
  return normalizeText(value).replace(identifierIgnorablePattern, "").trim();
}

function optionalSafeInteger(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    fail(`field ${field} must be a non-negative PostgreSQL integer or null`);
  }
  return value;
}

function optionalTimestamp(value: unknown, field: string): string | null {
  if (value === null) return null;
  const invalidTimestamp = `field ${field} must be a valid timestamp or null`;
  if (inspectUntrusted(() => value instanceof Date, invalidTimestamp)) {
    const date = new Date(inspectUntrusted(() => Date.prototype.getTime.call(value), invalidTimestamp));
    if (!Number.isFinite(date.getTime())) fail(invalidTimestamp);
    const year = date.getUTCFullYear();
    if (year < 1 || year > 9999) fail(invalidTimestamp);
    return formatUtcTimestamp(date, `${date.getUTCMilliseconds()}`.padStart(3, "0").padEnd(6, "0"));
  }
  if (typeof value !== "string") fail(`field ${field} must be a valid timestamp or null`);
  const parts = timestampPattern.exec(value);
  if (!parts || !hasValidTimestampParts(parts)) fail(`field ${field} must be a valid timestamp or null`);
  return normalizeTimestampParts(parts, field);
}

function hasValidTimestampParts(parts: RegExpExecArray): boolean {
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const hour = Number(parts[4]);
  const minute = Number(parts[5]);
  const second = Number(parts[6]);
  const offsetHour = parts[9] === undefined ? 0 : Number(parts[9]);
  const offsetMinute = parts[10] === undefined ? 0 : Number(parts[10]);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return false;
  const daysInMonth = month === 2
    ? (isLeapYear(year) ? 29 : 28)
    : ([4, 6, 9, 11].includes(month) ? 30 : 31);
  return day >= 1 && day <= daysInMonth;
}

function normalizeTimestampParts(parts: RegExpExecArray, field: string): string {
  const local = new Date(0);
  local.setUTCFullYear(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  local.setUTCHours(Number(parts[4]), Number(parts[5]), Number(parts[6]), 0);

  const offsetMinutes = Number(parts[9] ?? 0) * 60 + Number(parts[10] ?? 0);
  const direction = parts[8] === "-" ? -1 : 1;
  const utc = new Date(local.getTime() - direction * offsetMinutes * 60_000);
  const utcYear = utc.getUTCFullYear();
  if (utcYear < 1 || utcYear > 9999) fail(`field ${field} must be a valid timestamp or null`);
  const fractional = (parts[7] ?? "").padEnd(6, "0");
  return formatUtcTimestamp(utc, fractional);
}

function formatUtcTimestamp(value: Date, fractional: string): string {
  const date = [
    `${value.getUTCFullYear()}`.padStart(4, "0"),
    `${value.getUTCMonth() + 1}`.padStart(2, "0"),
    `${value.getUTCDate()}`.padStart(2, "0"),
  ].join("-");
  const time = [
    `${value.getUTCHours()}`.padStart(2, "0"),
    `${value.getUTCMinutes()}`.padStart(2, "0"),
    `${value.getUTCSeconds()}`.padStart(2, "0"),
  ].join(":");
  return `${date}T${time}.${fractional}Z`;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function requiredUuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) fail(`field ${field} must be a UUID`);
  return value.toLowerCase();
}

function stablePublicId(prefix: string, legacy: ParsedLegacyCustomer, discriminator = "primary"): string {
  return stablePublicIdFromParts(prefix, [
    legacy.sourceSystem,
    legacyCustomerTable,
    legacy.sourceId,
    discriminator,
  ]);
}

function stablePublicIdFromParts(prefix: string, parts: readonly string[]): string {
  return `${prefix}_${stableDigest(parts.join(":")).slice(0, 24)}`;
}

function stableDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isNonNull<T>(value: T | null): value is T {
  return value !== null;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

class LegacyCustomerRowError extends Error {}

// Reflection on row values can run proxy traps whose errors may carry row data; only wrap those calls.
function inspectUntrusted<T>(operation: () => T, reason: string): T {
  try {
    return operation();
  } catch {
    fail(reason);
  }
}

function fail(reason: string): never {
  throw new LegacyCustomerRowError(`Invalid legacy customer row: ${reason}`);
}

class IntegrationAccountSnapshotError extends Error {}

function failAccountSnapshot(reason: string): never {
  throw new IntegrationAccountSnapshotError(`Invalid integration account snapshot: ${reason}`);
}
