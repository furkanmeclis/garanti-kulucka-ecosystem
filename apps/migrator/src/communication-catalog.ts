import type { LegacyColumnContract, LegacyTableMapping } from "./mapping-catalog.js";

/** Exact schema of the read-only legacy snapshot (2026-10-17). */
export const communicationTableMappings: readonly LegacyTableMapping[] = [
  {
    sourceTable: "public.kisayollar",
    idColumn: "id",
    targetEntities: [
      { entity: "message_shortcuts", mapping: "direct", readiness: "dry-run" },
      { entity: "message_shortcut_attachments", mapping: "synthetic", readiness: "apply-ready" },
    ],
    columns: [
      column("id", "uuid", "uuid", false),
      column("kod", "text", "text", false),
      column("mesaj", "text", "text", true),
      column("medyalar", "jsonb", "jsonb", true),
      column("tip", "text", "text", false),
      column("aktif", "boolean", "bool", false),
      column("sira", "integer", "int4", true),
      column("olusturma_tarihi", "timestamp with time zone", "timestamptz", true),
      column("guncelleme_tarihi", "timestamp with time zone", "timestamptz", true),
    ],
  },
  {
    sourceTable: "public.sms_gonderimler",
    idColumn: "id",
    targetEntities: [
      { entity: "sms_messages", mapping: "direct", readiness: "dry-run" },
    ],
    columns: [
      column("id", "uuid", "uuid", false),
      column("telefon", "text", "text", false),
      column("musteri_adi", "text", "text", true),
      column("mesaj", "text", "text", false),
      column("bulk_id", "text", "text", true),
      column("durum", "text", "text", false),
      column("hata_mesaji", "text", "text", true),
      column("kargo_id", "uuid", "uuid", true),
      column("kargo_takip_no", "text", "text", true),
      column("otomatik", "boolean", "bool", true),
      column("olusturma_tarihi", "timestamp with time zone", "timestamptz", true),
    ],
  },
  {
    sourceTable: "public.vapi_aramalar",
    idColumn: "id",
    targetEntities: [
      { entity: "vapi_calls", mapping: "direct", readiness: "dry-run" },
    ],
    columns: [
      column("id", "uuid", "uuid", false),
      column("vapi_call_id", "character varying", "varchar", true),
      column("kargo_id", "uuid", "uuid", true),
      column("musteri_telefon", "character varying", "varchar", false),
      column("musteri_adi", "character varying", "varchar", true),
      column("kargo_firmasi", "character varying", "varchar", true),
      column("takip_no", "character varying", "varchar", true),
      column("son_hareket", "text", "text", true),
      column("durum", "character varying", "varchar", true),
      column("arama_ozeti", "text", "text", true),
      column("transkript", "jsonb", "jsonb", true),
      column("sure_sn", "integer", "int4", true),
      column("maliyet", "numeric", "numeric", true),
      column("baslangic", "timestamp with time zone", "timestamptz", true),
      column("bitis", "timestamp with time zone", "timestamptz", true),
      column("olusturma_tarihi", "timestamp with time zone", "timestamptz", true),
    ],
  },
];

function column(name: string, dataType: string, udtName: string, nullable: boolean): LegacyColumnContract {
  return { name, dataType, udtName, nullable, required: true };
}
