import { createHash } from "node:crypto";
import { normalizeLegacyTimestamp } from "./customer-mapping.js";
import type { LegacyRowRejection } from "./customer-mapping.js";
import { calculateSourcePayloadChecksum } from "./legacy-source.js";
import type { SourcePayloadChecksum } from "./legacy-source.js";
import { legacyMappingCatalog } from "./mapping-catalog.js";
import type { LegacyRecord } from "./types.js";

export const legacyConversationTable = "public.konusmalar";
export const legacyMessageTable = "public.mesajlar";

const legacyConversationFields = catalogColumnNames(legacyConversationTable);
const legacyMessageFields = catalogColumnNames(legacyMessageTable);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const checksumPattern = /^sha256:[0-9a-f]{64}$/;
const integrationAccountPublicIdPattern = /^iac_[a-z0-9_]{1,64}$/;
const customerPublicIdPattern = /^cus_[0-9a-f]{24}$/;
const conversationPublicIdPattern = /^conv_[0-9a-f]{24}$/;

const conversationChannels: ReadonlyMap<string, ConversationChannel> = new Map([
  ["whatsapp", "whatsapp"],
  ["messenger", "messenger"],
  ["instagram", "instagram"],
  ["panel", "manual"],
]);
const conversationStatuses: ReadonlyMap<string, ConversationStatus> = new Map([
  ["acik", "open"],
  ["beklemede", "pending"],
  ["kapali", "closed"],
]);
const messageSenders: ReadonlyMap<string, MessageSenderType> = new Map([
  ["musteri", "customer"],
  ["calisan", "user"],
  ["ai", "ai"],
]);
const conversationAccountProviders = new Set<string>(["whatsapp", "instagram", "messenger"]);

export type ConversationChannel = "whatsapp" | "messenger" | "instagram" | "manual";
export type ConversationStatus = "open" | "pending" | "closed";
export type MessageSenderType = "customer" | "user" | "ai";
export type ConversationAccountProvider = "whatsapp" | "instagram" | "messenger";

export interface VerifiedConversationAccount {
  readonly publicId: string;
  readonly providerKey: ConversationAccountProvider;
  readonly status: "active" | "inactive";
  readonly externalAccountId: string | null;
}

export interface ConversationTransformContext {
  readonly customerPublicIds: ReadonlyMap<string, string>;
  readonly userPublicIds: ReadonlyMap<string, string>;
  readonly accounts: readonly VerifiedConversationAccount[];
}

export interface MessageTransformContext {
  readonly conversationPublicIds: ReadonlyMap<string, string>;
}

export interface ConversationReconciliation {
  readonly code: "unresolved_assigned_user";
  readonly legacyUserId: string;
}

interface LegacyConversationTimestamps {
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface LegacyConversationDraft {
  readonly kind: "legacy_conversation_draft";
  readonly targetTable: "conversations";
  readonly publicId: string;
  readonly mappingRole: "primary";
  readonly customerPublicId: string;
  readonly assignedUserPublicId: string | null;
  readonly integrationAccountPublicId: string | null;
  readonly channel: ConversationChannel;
  readonly external_thread_id: string | null;
  readonly status: ConversationStatus;
  readonly is_in_pool: boolean;
  readonly human_agent_enabled: boolean;
  readonly unread_count: number;
  readonly last_message_text: string | null;
  readonly last_message_sender_type: MessageSenderType | null;
  readonly last_message_at: string | null;
  readonly legacyTimestamps: LegacyConversationTimestamps;
}

export interface ConversationTransformationResult {
  readonly sourcePayloadChecksum: SourcePayloadChecksum;
  readonly conversation: LegacyConversationDraft;
  readonly reconciliation: readonly ConversationReconciliation[];
}

export interface LegacyMessageRawPayload {
  readonly media_url?: string;
  readonly media_type?: string;
  readonly gonderici_adi?: string;
  readonly medya_url?: string;
  readonly medya_tipi?: string;
  readonly gonderici_id?: string;
}

export interface LegacyMessageDraft {
  readonly kind: "legacy_message_draft";
  readonly targetTable: "messages";
  readonly publicId: string;
  readonly mappingRole: "primary";
  readonly conversationPublicId: string;
  readonly sender_type: MessageSenderType;
  readonly body: string;
  readonly external_message_id: string | null;
  readonly is_read: boolean;
  readonly sentAt: string;
  readonly rawPayload: LegacyMessageRawPayload | null;
}

export interface MessageTransformationResult {
  readonly sourcePayloadChecksum: SourcePayloadChecksum;
  readonly message: LegacyMessageDraft;
  readonly warnings: readonly MessageTransformWarning[];
}

export type MessageTransformWarning =
  | { readonly code: "media_field_conflict"; readonly fields: readonly ["media_url", "medya_url"] | readonly ["media_type", "medya_tipi"] };

interface ParsedLegacyRow {
  readonly sourcePayloadChecksum: SourcePayloadChecksum;
  readonly sourceSystem: string;
  readonly sourceTable: string;
  readonly sourceId: string;
  readonly payload: Record<string, unknown>;
}

export function transformLegacyConversation(
  record: LegacyRecord,
  context: ConversationTransformContext,
): ConversationTransformationResult {
  const rejectRow: LegacyRowRejection = failConversation;
  const accounts = validateConversationAccounts(context.accounts);
  const row = parseLegacyRow(record, legacyConversationTable, legacyConversationFields, rejectRow);
  const { payload } = row;

  const legacyCustomerId = requiredUuid(payload.musteri_id, "musteri_id", rejectRow);
  const customerPublicId = context.customerPublicIds.get(legacyCustomerId);
  if (customerPublicId === undefined) rejectRow("field musteri_id does not resolve to a migrated customer");
  if (typeof customerPublicId !== "string" || !customerPublicIdPattern.test(customerPublicId)) {
    failContext("customer public id map contains an illegal public id");
  }

  const channel = requiredEnum(payload.kanal, "kanal", conversationChannels, rejectRow);
  const status = payload.durum === null
    ? "open"
    : requiredEnum(payload.durum, "durum", conversationStatuses, rejectRow);
  const lastMessageSender = payload.son_mesaj_gonderici === null
    ? null
    : requiredEnum(payload.son_mesaj_gonderici, "son_mesaj_gonderici", messageSenders, rejectRow);
  const igAccountId = optionalString(payload.ig_account_id, "ig_account_id", rejectRow);
  if (channel !== "instagram" && igAccountId !== null) {
    rejectRow("field ig_account_id is only allowed for instagram conversations");
  }
  const integrationAccountPublicId = resolveIntegrationAccount(channel, igAccountId, accounts);

  const reconciliation: ConversationReconciliation[] = [];
  let assignedUserPublicId: string | null = null;
  const legacyUserId = optionalUuid(payload.atanan_kullanici_id, "atanan_kullanici_id", rejectRow);
  if (legacyUserId !== null) {
    const userPublicId = context.userPublicIds.get(legacyUserId);
    if (userPublicId === undefined) {
      reconciliation.push(Object.freeze({ code: "unresolved_assigned_user" as const, legacyUserId }));
    } else {
      if (typeof userPublicId !== "string" || !userPublicId.trim()) {
        failContext("user public id map contains a blank public id");
      }
      assignedUserPublicId = userPublicId;
    }
  }

  const conversation: LegacyConversationDraft = Object.freeze({
    kind: "legacy_conversation_draft" as const,
    targetTable: "conversations" as const,
    publicId: stablePublicId("conv", row),
    mappingRole: "primary" as const,
    customerPublicId,
    assignedUserPublicId,
    integrationAccountPublicId,
    channel,
    external_thread_id: optionalExternalId(payload.kanal_konusma_id, "kanal_konusma_id", rejectRow),
    status,
    is_in_pool: legacyUserId === null,
    human_agent_enabled: optionalBoolean(payload.human_agent, "human_agent", rejectRow) ?? false,
    unread_count: optionalCount(payload.okunmamis_sayisi, "okunmamis_sayisi", rejectRow),
    last_message_text: optionalString(payload.son_mesaj_text, "son_mesaj_text", rejectRow),
    last_message_sender_type: lastMessageSender,
    last_message_at: normalizeLegacyTimestamp(payload.son_mesaj_tarihi, "son_mesaj_tarihi", rejectRow),
    legacyTimestamps: Object.freeze({
      createdAt: normalizeLegacyTimestamp(payload.olusturma_tarihi, "olusturma_tarihi", rejectRow),
      updatedAt: normalizeLegacyTimestamp(payload.guncelleme_tarihi, "guncelleme_tarihi", rejectRow),
    }),
  });

  return Object.freeze({
    sourcePayloadChecksum: row.sourcePayloadChecksum,
    conversation,
    reconciliation: Object.freeze(reconciliation),
  });
}

export function transformLegacyMessage(
  record: LegacyRecord,
  context: MessageTransformContext,
): MessageTransformationResult {
  const rejectRow: LegacyRowRejection = failMessage;
  const row = parseLegacyRow(record, legacyMessageTable, legacyMessageFields, rejectRow);
  const { payload } = row;

  const legacyConversationId = requiredUuid(payload.konusma_id, "konusma_id", rejectRow);
  const conversationPublicId = context.conversationPublicIds.get(legacyConversationId);
  if (conversationPublicId === undefined) rejectRow("field konusma_id does not resolve to a migrated conversation");
  if (typeof conversationPublicId !== "string" || !conversationPublicIdPattern.test(conversationPublicId)) {
    failContext("conversation public id map contains an illegal public id");
  }

  const senderType = requiredEnum(payload.gonderici_tipi, "gonderici_tipi", messageSenders, rejectRow);
  const body = payload.icerik;
  if (typeof body !== "string") rejectRow("field icerik must be a string");
  const sentAt = normalizeLegacyTimestamp(payload.olusturma_tarihi, "olusturma_tarihi", rejectRow);
  if (sentAt === null) rejectRow("field olusturma_tarihi is required");

  const preferredMediaUrl = optionalString(payload.media_url, "media_url", rejectRow);
  const fallbackMediaUrl = optionalString(payload.medya_url, "medya_url", rejectRow);
  const preferredMediaType = optionalString(payload.media_type, "media_type", rejectRow);
  const fallbackMediaType = optionalString(payload.medya_tipi, "medya_tipi", rejectRow);
  const senderName = optionalString(payload.gonderici_adi, "gonderici_adi", rejectRow);
  const mediaUrl = preferredMediaUrl ?? fallbackMediaUrl;
  const mediaType = preferredMediaType ?? fallbackMediaType;
  const senderId = optionalUuid(payload.gonderici_id, "gonderici_id", rejectRow);
  const warnings: MessageTransformWarning[] = [];
  if (preferredMediaUrl !== null && fallbackMediaUrl !== null && preferredMediaUrl !== fallbackMediaUrl) {
    warnings.push(Object.freeze({ code: "media_field_conflict" as const, fields: ["media_url", "medya_url"] as const }));
  }
  if (preferredMediaType !== null && fallbackMediaType !== null && preferredMediaType !== fallbackMediaType) {
    warnings.push(Object.freeze({ code: "media_field_conflict" as const, fields: ["media_type", "medya_tipi"] as const }));
  }
  const rawPayload = mediaUrl === null && mediaType === null && senderId === null && senderName === null
    ? null
    : Object.freeze({
      ...(mediaUrl === null ? {} : { media_url: mediaUrl }),
      ...(mediaType === null ? {} : { media_type: mediaType }),
      ...(fallbackMediaUrl === null ? {} : { medya_url: fallbackMediaUrl }),
      ...(fallbackMediaType === null ? {} : { medya_tipi: fallbackMediaType }),
      ...(senderName === null ? {} : { gonderici_adi: senderName }),
      ...(senderId === null ? {} : { gonderici_id: senderId }),
    });

  const message: LegacyMessageDraft = Object.freeze({
    kind: "legacy_message_draft" as const,
    targetTable: "messages" as const,
    publicId: stablePublicId("msg", row),
    mappingRole: "primary" as const,
    conversationPublicId,
    sender_type: senderType,
    body,
    external_message_id: optionalExternalId(payload.kanal_mesaj_id, "kanal_mesaj_id", rejectRow),
    is_read: optionalBoolean(payload.okundu, "okundu", rejectRow) ?? false,
    sentAt,
    rawPayload,
  });

  return Object.freeze({ sourcePayloadChecksum: row.sourcePayloadChecksum, message, warnings: Object.freeze(warnings) });
}

export function assertVerifiedConversationAccounts(
  accounts: unknown,
): asserts accounts is readonly VerifiedConversationAccount[] {
  validateConversationAccounts(accounts);
}

function validateConversationAccounts(accounts: unknown): readonly VerifiedConversationAccount[] {
  if (!Array.isArray(accounts)) failAccountSnapshot("accounts must be an array");
  const seenPublicIds = new Set<string>();
  const verified: VerifiedConversationAccount[] = [];

  for (let index = 0; index < accounts.length; index += 1) {
    const account: unknown = accounts[index];
    if (account === null || typeof account !== "object") {
      failAccountSnapshot(`account at index ${index} must be an object`);
    }
    const { publicId, providerKey, status, externalAccountId } = account as Record<string, unknown>;
    if (typeof publicId !== "string" || !integrationAccountPublicIdPattern.test(publicId)) {
      failAccountSnapshot(`account at index ${index} has a blank or illegal public id`);
    }
    if (typeof providerKey !== "string" || !conversationAccountProviders.has(providerKey)) {
      failAccountSnapshot(`account at index ${index} has an unknown provider`);
    }
    if (status !== "active" && status !== "inactive") {
      failAccountSnapshot(`account at index ${index} has an unknown status`);
    }
    if (externalAccountId !== null && typeof externalAccountId !== "string") {
      failAccountSnapshot(`account at index ${index} has an illegal external account id`);
    }
    if (seenPublicIds.has(publicId)) failAccountSnapshot(`account at index ${index} duplicates a public id`);
    seenPublicIds.add(publicId);
    verified.push({
      publicId,
      providerKey: providerKey as ConversationAccountProvider,
      status,
      externalAccountId,
    });
  }
  return verified;
}

function resolveIntegrationAccount(
  channel: ConversationChannel,
  igAccountId: string | null,
  accounts: readonly VerifiedConversationAccount[],
): string | null {
  if (channel === "manual") return null;
  const candidates = accounts.filter((account) => account.status === "active" && account.providerKey === channel);
  if (candidates.length === 0) {
    failConversation(`no active ${channel} integration account was supplied in MIGRATION_CONVERSATION_ACCOUNTS_FILE`);
  }
  const matches = channel === "instagram"
    ? candidates.filter((account) => igAccountId !== null && account.externalAccountId === igAccountId)
    : candidates;
  if (matches.length === 0) failConversation(`no active ${channel} integration account matches the conversation`);
  if (matches.length > 1) failConversation(`several active ${channel} integration accounts match the conversation`);
  return matches[0]!.publicId;
}

function parseLegacyRow(
  record: LegacyRecord,
  table: string,
  fields: readonly string[],
  reject: LegacyRowRejection,
): ParsedLegacyRow {
  if (record.sourceTable !== table) reject(`source table must be ${table}`);
  if (typeof record.sourceSystem !== "string" || !record.sourceSystem.trim()) {
    reject("source system must be a nonblank string");
  }
  const payload = inspectPayload(record.payload, reject);

  const keys = Object.keys(payload);
  const requiredFields = catalogRequiredColumnNames(table);
  const missing = requiredFields.filter((field) => !Object.hasOwn(payload, field));
  if (missing.length > 0) reject(`payload is missing required fields [${missing.join(", ")}]`);
  if (keys.some((field) => !fields.includes(field))) reject("payload contains unknown fields");

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
    sourceTable: table,
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
    if (error instanceof LegacyRowError) throw error;
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
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !uuidPattern.test(value)) reject(`field ${field} must be a UUID or null`);
  return value.toLowerCase();
}

function optionalString(value: unknown, field: string, reject: LegacyRowRejection): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") reject(`field ${field} must be a string or null`);
  return value;
}

function optionalExternalId(value: unknown, field: string, reject: LegacyRowRejection): string | null {
  const text = optionalString(value, field, reject);
  return text === null || !text.trim() ? null : text;
}

function optionalBoolean(value: unknown, field: string, reject: LegacyRowRejection): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "boolean") reject(`field ${field} must be a boolean or null`);
  return value;
}

function optionalCount(value: unknown, field: string, reject: LegacyRowRejection): number {
  if (value === null || value === undefined) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    reject(`field ${field} must be a non-negative integer or null`);
  }
  return value;
}

function stablePublicId(prefix: string, row: ParsedLegacyRow): string {
  const identity = [row.sourceSystem, row.sourceTable, row.sourceId, "primary"].join(":");
  return `${prefix}_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
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

class LegacyRowError extends Error {}

function failConversation(reason: string): never {
  throw new LegacyRowError(`Invalid legacy conversation row: ${reason}`);
}

function failMessage(reason: string): never {
  throw new LegacyRowError(`Invalid legacy message row: ${reason}`);
}

class ConversationAccountSnapshotError extends Error {}

function failAccountSnapshot(reason: string): never {
  throw new ConversationAccountSnapshotError(`Invalid conversation account snapshot: ${reason}`);
}

class ConversationTransformContextError extends Error {}

function failContext(reason: string): never {
  throw new ConversationTransformContextError(`Invalid conversation transform context: ${reason}`);
}
