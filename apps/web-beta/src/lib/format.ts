import { localeFor } from "@/i18n";

export function formatMoney(value: number | string | null | undefined, currency: string, language: string) {
  const amount = typeof value === "string" ? Number(value) : value ?? 0;
  if (!Number.isFinite(amount)) return String(value ?? "");
  try {
    return new Intl.NumberFormat(localeFor(language), { style: "currency", currency: currency || "TRY", currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function formatNumber(value: number | null | undefined, language: string) {
  return new Intl.NumberFormat(localeFor(language)).format(value ?? 0);
}

export function formatDateTime(value: string | null | undefined, language: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(localeFor(language), { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatDate(value: string | null | undefined, language: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(localeFor(language), { dateStyle: "medium" }).format(date);
}

/** Carrier names are brands: PTT / Sürat stay as-is in every language. */
export function carrierLabel(provider: string | null | undefined, otherLabel: string) {
  const value = (provider ?? "").toLocaleLowerCase("tr-TR");
  if (!value) return "";
  if (value.includes("ptt")) return "PTT";
  if (value.includes("surat") || value.includes("sürat")) return "Sürat";
  return value === "other" ? otherLabel : (provider ?? "");
}

export function channelLabel(channel: string | null | undefined) {
  const value = (channel ?? "").toLowerCase();
  if (value === "instagram") return "Instagram";
  if (value === "facebook" || value === "messenger") return "Facebook";
  if (value === "whatsapp") return "WhatsApp";
  return channel ?? "";
}
