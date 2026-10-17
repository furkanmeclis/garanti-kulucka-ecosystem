import { createHash } from "node:crypto";
import { normalizeLegacyTimestamp } from "./customer-mapping.js";
import { calculateSourcePayloadChecksum } from "./legacy-source.js";
import { communicationTableMappings } from "./communication-catalog.js";
import type { CanonicalRecord, LegacyRecord, MigrationEntity } from "./types.js";

export const communicationEntities = ["message_shortcuts", "sms_messages", "vapi_calls"] as const;
export type CommunicationEntity = typeof communicationEntities[number];
export const smsStatusMap: Readonly<Record<string, string>> = Object.freeze({ basarili: "sent" });
export const vapiStatusMap: Readonly<Record<string, string>> = Object.freeze({ basladi: "basladi" });
export interface ShortcutMedia {
  readonly mimeType: string;
  readonly mediaType: "image" | "video" | "document";
  readonly fileName: string;
  readonly dataUrl: string | null;
  readonly previewUrl: string | null;
  readonly inlineBytes: number;
}
export interface CommunicationDraft {
  readonly record: CanonicalRecord;
  readonly shipmentSourceId: string | null;
  readonly media: readonly ShortcutMedia[];
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}
export interface CommunicationSummary {
  sourceRows: number;
  transformedRows: number;
  inactiveRows: number;
  mediaItems: number;
  inlineMediaItems: number;
  inlineMediaBytes: number;
  remoteMediaUrls: number;
  linkedShipments: number;
  unresolvedShipments: number;
  byStatus: Record<string, number>;
}
export type CommunicationSummaries = Partial<Record<CommunicationEntity, CommunicationSummary>>;
export function emptyCommunicationSummary(): CommunicationSummary {
  return { sourceRows: 0, transformedRows: 0, inactiveRows: 0, mediaItems: 0, inlineMediaItems: 0,
    inlineMediaBytes: 0, remoteMediaUrls: 0, linkedShipments: 0, unresolvedShipments: 0, byStatus: {} };
}
export function isCommunicationEntity(entity: MigrationEntity): entity is CommunicationEntity {
  return (communicationEntities as readonly string[]).includes(entity);
}
export function communicationPublicId(prefix: string, identity: string): string {
  return `${prefix}_${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}
function fail(reason: string): never { throw new Error(`Invalid legacy communication row: ${reason}`); }
function text(value: unknown, field: string, required = false): string | null {
  if (value === null && !required) return null;
  if (typeof value !== "string" || (required && !value.trim())) fail(`field ${field} must be ${required ? "nonblank text" : "text or null"}`);
  return value;
}
function uuid(value: unknown, field: string, required = false): string | null {
  const result = text(value, field, required);
  if (result !== null && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(result)) fail(`field ${field} must be UUID`);
  return result?.toLowerCase() ?? null;
}
function bool(value: unknown, field: string, fallback: boolean): boolean {
  if (value === null) return fallback;
  if (typeof value !== "boolean") fail(`field ${field} must be boolean`);
  return value;
}
function integer(value: unknown, field: string, nonnegative = false): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value > 2147483647 || value < (nonnegative ? 0 : -2147483648)) fail(`field ${field} must be a valid integer`);
  return value;
}
function enumValue(value: unknown, map: Readonly<Record<string, string>>, field: string): string {
  if (typeof value !== "string" || !Object.hasOwn(map, value)) fail(`field ${field} has an unsupported value`);
  return map[value]!;
}
export function transformLegacyCommunication(record: LegacyRecord, entity: CommunicationEntity): CommunicationDraft {
  const mapping = communicationTableMappings.find((t) => t.targetEntities[0]?.entity === entity)!;
  if (record.sourceTable !== mapping.sourceTable || !record.sourceSystem.trim()) fail("source identity is invalid");
  // The shared checksum validator also rejects accessors, symbols, cycles and non-JSON values.
  if (calculateSourcePayloadChecksum(record.payload) !== record.checksum) fail("source payload checksum mismatch");
  const p = record.payload;
  if (mapping.columns.some((c) => c.required && !Object.hasOwn(p, c.name))) fail("payload is missing required fields");
  if (Object.keys(p).some((key) => !mapping.columns.some((c) => c.name === key))) fail("payload contains unknown fields");
  const id = uuid(p.id, "id", true)!;
  if (record.sourceId !== id) fail("sourceId does not match payload id");
  const createdAt = normalizeLegacyTimestamp(p.olusturma_tarihi, "olusturma_tarihi", fail);
  const updatedAt = entity === "message_shortcuts"
    ? normalizeLegacyTimestamp(p.guncelleme_tarihi, "guncelleme_tarihi", fail) : createdAt;
  const prefix = { message_shortcuts: "msc", sms_messages: "sms", vapi_calls: "vcl" }[entity];
  const publicId = communicationPublicId(prefix, `${record.sourceSystem}:${record.sourceTable}:${id}:primary`);
  let payload: Record<string, unknown>;
  let media: readonly ShortcutMedia[] = [];
  let shipmentSourceId: string | null = null;
  if (entity === "message_shortcuts") {
    payload = { code: text(p.kod, "kod", true), message: text(p.mesaj, "mesaj"),
      type: enumValue(p.tip, { varsayilan: "default", custom: "custom" }, "tip"),
      is_active: bool(p.aktif, "aktif", true), sort_order: integer(p.sira, "sira") ?? 999 };
    if (p.medyalar !== null && !Array.isArray(p.medyalar)) fail("field medyalar must be an array or null");
    media = ((p.medyalar ?? []) as unknown[]).map(parseShortcutMedia);
  } else if (entity === "sms_messages") {
    shipmentSourceId = uuid(p.kargo_id, "kargo_id");
    payload = { recipient_phone: text(p.telefon, "telefon", true), customer_name: text(p.musteri_adi, "musteri_adi"),
      message: text(p.mesaj, "mesaj", true), is_automatic: bool(p.otomatik, "otomatik", false),
      status: enumValue(p.durum, smsStatusMap, "durum"), error_message: text(p.hata_mesaji, "hata_mesaji"),
      provider_bulk_id: text(p.bulk_id, "bulk_id"), tracking_number: text(p.kargo_takip_no, "kargo_takip_no"),
      idempotency_key: `migration:${publicId}`, request_id: `migration:${publicId}`, queued: false };
  } else {
    shipmentSourceId = uuid(p.kargo_id, "kargo_id");
    const cost = p.maliyet;
    if (cost !== null && (typeof cost !== "string" && typeof cost !== "number" || !/^\d{1,8}(?:\.\d{1,4})?$/.test(String(cost)))) fail("field maliyet must fit numeric(12,4)");
    payload = { vapi_call_id: text(p.vapi_call_id, "vapi_call_id"), customer_phone: text(p.musteri_telefon, "musteri_telefon", true),
      customer_name: text(p.musteri_adi, "musteri_adi"), cargo_provider: text(p.kargo_firmasi, "kargo_firmasi"),
      tracking_number: text(p.takip_no, "takip_no"), last_event_text: text(p.son_hareket, "son_hareket"),
      status: enumValue(p.durum, vapiStatusMap, "durum"), summary: text(p.arama_ozeti, "arama_ozeti"), transcript: p.transkript,
      duration_seconds: integer(p.sure_sn, "sure_sn", true), cost,
      started_at: normalizeLegacyTimestamp(p.baslangic, "baslangic", fail) ?? createdAt ?? "1970-01-01T00:00:00.000Z",
      ended_at: normalizeLegacyTimestamp(p.bitis, "bitis", fail),
      idempotency_key: `migration:${publicId}`, request_id: `migration:${publicId}`, queued: false };
  }
  return { record: { targetTable: entity, targetId: publicId, checksum: record.checksum, payload },
    shipmentSourceId, media, createdAt, updatedAt };
}
function parseShortcutMedia(value: unknown): ShortcutMedia {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid shortcut media item");
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some((key) => !["mimetype", "mediatype", "fileName", "base64", "storage_path", "previewUrl"].includes(key))) fail("unknown shortcut media fields");
  const mimeType = text(p.mimetype, "mimetype", true)!;
  if (!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(mimeType)) fail("invalid shortcut MIME type");
  const mediaType = enumValue(p.mediatype, { image: "image", video: "video", document: "document" }, "mediatype") as ShortcutMedia["mediaType"];
  if ((mediaType === "image" || mediaType === "video") && !mimeType.startsWith(`${mediaType}/`)) fail("shortcut MIME/type mismatch");
  const fileName = text(p.fileName, "fileName", true)!;
  const hasInline = Object.hasOwn(p, "base64");
  const hasRemote = Object.hasOwn(p, "previewUrl") || Object.hasOwn(p, "storage_path");
  if (hasInline === hasRemote) fail("shortcut media requires exactly one content source");
  if (hasInline) {
    const raw = text(p.base64, "base64", true)!;
    const data = raw.startsWith("data:") ? raw.match(/^data:([^;,]+);base64,([\s\S]*)$/) : null;
    if (raw.startsWith("data:") && (!data || data[1]?.toLowerCase() !== mimeType.toLowerCase())) fail("invalid shortcut data URL MIME");
    const base64 = (data ? data[2]! : raw).replace(/\s/g, "");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64) || !base64.length) fail("invalid shortcut base64");
    const inlineBytes = base64.length / 4 * 3 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
    return { mimeType, mediaType, fileName, inlineBytes, dataUrl: `data:${mimeType};base64,${base64}`, previewUrl: null };
  }
  const previewUrl = text(p.previewUrl, "previewUrl", true)!;
  const storagePath = text(p.storage_path, "storage_path", true)!;
  let url: URL;
  try { url = new URL(previewUrl); } catch { fail("invalid shortcut public storage URL"); }
  if (url.protocol !== "https:" || url.hostname !== "db.garantikulucka.com" || url.port || url.username || url.password || url.search || url.hash
    || !url.pathname.startsWith("/storage/v1/object/public/") || !decodeURIComponent(url.pathname).endsWith(`/${storagePath}`)) fail("invalid shortcut public storage URL");
  return { mimeType, mediaType, fileName, inlineBytes: 0, dataUrl: null, previewUrl };
}
