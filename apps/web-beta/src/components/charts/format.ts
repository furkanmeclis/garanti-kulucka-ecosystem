import { localeFor } from "@/i18n";

/** Chart/number formatting in the panel language (tr-TR: 1.234,5 · ₺ · dd.MM). */
export type ValueKind = "money" | "count" | "percent" | "decimal" | "seconds";

export function formatValue(value: number | null | undefined, kind: ValueKind, language: string, options: { compact?: boolean } = {}) {
  const amount = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const locale = localeFor(language);
  if (kind === "percent") return `%${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(amount)}`;
  if (kind === "money") {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "TRY",
      currencyDisplay: "narrowSymbol",
      ...(options.compact ? { notation: "compact", maximumFractionDigits: 1 } : { maximumFractionDigits: amount % 1 === 0 ? 0 : 2 }),
    }).format(amount);
  }
  if (kind === "seconds") return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(amount)} sn`;
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: kind === "decimal" ? 2 : 0,
    ...(options.compact ? { notation: "compact" } : {}),
  }).format(amount);
}

/** Axis tick: compact (12,5 B / ₺12 B) so long values never crowd the plot. */
export function formatTick(value: number, kind: ValueKind, language: string) {
  return formatValue(value, kind, language, { compact: Math.abs(value) >= 10_000 });
}

function parseDay(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

/** Bucket label: day "05.10", week "05.10", month "Eki 2026" / "Oct 2026". */
export function formatBucket(bucket: string, granularity: "day" | "week" | "month", language: string, long = false) {
  const date = parseDay(bucket);
  const locale = localeFor(language);
  if (granularity === "month") return new Intl.DateTimeFormat(locale, { month: long ? "long" : "short", year: "numeric", timeZone: "UTC" }).format(date);
  const short = `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  if (!long) return short;
  const full = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "long", year: "numeric", weekday: granularity === "day" ? "short" : undefined, timeZone: "UTC" }).format(date);
  return granularity === "week" ? `${full} +6` : full;
}

/** dd.MM.yyyy for any YYYY-MM-DD value (both languages, as the date pickers show it). */
export function formatDay(value: string) {
  const date = parseDay(value);
  return `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.${date.getUTCFullYear()}`;
}

/** "5 dk önce" / "5 min ago" style relative time. */
export function formatRelative(iso: string, language: string, now: Date = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(localeFor(language), { numeric: "auto", style: "short" });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size || unit === "minute") return formatter.format(Math.round(seconds / size), unit);
  }
  return formatter.format(0, "minute");
}
