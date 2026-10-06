import type { AppDatabase } from "@garanti-kulucka/database";

/** Seller / sender block printed on invoices and cargo labels (global settings `gonderici_*`). */
export interface DocumentSender {
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
}

export const senderSettingKeys = ["gonderici_adi", "gonderici_telefon", "gonderici_adres", "gonderici_il", "gonderici_ilce"] as const;

export async function loadDocumentSender(db: AppDatabase): Promise<DocumentSender> {
  const rows = await db
    .selectFrom("settings")
    .select(["key", "value"])
    .where("scope", "=", "global")
    .where("is_secret", "=", false)
    .where("key", "in", [...senderSettingKeys])
    .execute();
  const value = (key: (typeof senderSettingKeys)[number]) => {
    const raw = rows.find((row) => row.key === key)?.value;
    return typeof raw === "string" && raw.trim() ? raw.trim() : null;
  };
  return {
    name: value("gonderici_adi") ?? "Garanti Kuluçka",
    phone: value("gonderici_telefon"),
    address: value("gonderici_adres"),
    city: value("gonderici_il"),
    district: value("gonderici_ilce"),
  };
}
