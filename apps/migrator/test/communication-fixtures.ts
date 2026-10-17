import { communicationTableMappings } from "../src/communication-catalog.js";
import { calculateSourcePayloadChecksum } from "../src/legacy-source.js";
import type { CommunicationEntity } from "../src/communication-mapping.js";
import type { LegacyRecord } from "../src/types.js";

export function communicationFixture(entity: CommunicationEntity, overrides: Record<string, unknown> = {}): LegacyRecord {
  const mapping = communicationTableMappings.find((t) => t.targetEntities[0]?.entity === entity)!;
  const defaults = { id: "a1000000-0000-4000-8000-000000000001", kod: "ss", mesaj: "Legacy text",
    tip: "varsayilan", aktif: false, sira: 7, telefon: "+90 555 111 22 33", durum: entity === "sms_messages" ? "basarili" : entity === "call_logs" ? "cevaplandi" : "basladi", yon: "giden",
    musteri_telefon: "+90 555 111 22 33", otomatik: true, olusturma_tarihi: "2024-01-02T03:04:05.123456Z",
    guncelleme_tarihi: "2024-02-03T03:04:05Z", baslangic: "2024-01-02T03:04:05Z" };
  const payload = { ...Object.fromEntries(mapping.columns.map((c) => [c.name, (defaults as Record<string, unknown>)[c.name] ?? null])), ...overrides };
  return { sourceSystem: "legacy_postgres", sourceTable: mapping.sourceTable, sourceId: String(payload.id),
    payload, checksum: calculateSourcePayloadChecksum(payload) };
}
export const inlineShortcutMedia = { mimetype: "image/png", mediatype: "image", fileName: "Türkçe Foto.png", base64: "aGVsbG8=" };
export const remoteShortcutMedia = { mimetype: "application/pdf", mediatype: "document", fileName: "guide.pdf",
  storage_path: "guide.pdf", previewUrl: "https://db.garantikulucka.com/storage/v1/object/public/shortcuts/guide.pdf" };
