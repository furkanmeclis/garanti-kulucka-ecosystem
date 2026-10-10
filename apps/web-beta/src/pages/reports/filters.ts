import type { AnalyticsQueryParams } from "@/lib/api";

/** Date presets shared by Pano and İş Analizi (calendar days in the browser's zone, which is Europe/Istanbul in practice). */
export const rangePresets = ["today", "yesterday", "last7", "last30", "last90", "thisMonth", "lastMonth", "thisYear", "custom"] as const;
export type RangePreset = (typeof rangePresets)[number];

export const granularities = ["auto", "day", "week", "month"] as const;
export type GranularityChoice = (typeof granularities)[number];

export interface ReportFilterState {
  preset: RangePreset;
  from: string;
  to: string;
  compare: boolean;
  granularity: GranularityChoice;
  cargo: "" | "ptt" | "surat";
  personnel: string;
  channel: string;
  status: string;
  product: string;
  category: string;
  city: string;
}

export const dimensionKeys = ["cargo", "personnel", "channel", "status", "product", "category", "city"] as const;
export type DimensionKey = (typeof dimensionKeys)[number];

const pad = (value: number) => String(value).padStart(2, "0");
export const isoDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const isIsoDay = (value: string | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));

export function presetRange(preset: Exclude<RangePreset, "custom">, now: Date = new Date()): { from: string; to: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const shift = (days: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  switch (preset) {
    case "today":
      return { from: isoDay(today), to: isoDay(today) };
    case "yesterday":
      return { from: isoDay(shift(-1)), to: isoDay(shift(-1)) };
    case "last7":
      return { from: isoDay(shift(-6)), to: isoDay(today) };
    case "last30":
      return { from: isoDay(shift(-29)), to: isoDay(today) };
    case "last90":
      return { from: isoDay(shift(-89)), to: isoDay(today) };
    case "thisMonth":
      return { from: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDay(today) };
    case "lastMonth":
      return { from: isoDay(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: isoDay(new Date(today.getFullYear(), today.getMonth(), 0)) };
    case "thisYear":
      return { from: isoDay(new Date(today.getFullYear(), 0, 1)), to: isoDay(today) };
  }
}

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Same rule as the API default: daily ≤ 62 days, weekly ≤ 200, monthly beyond. */
export function autoGranularity(days: number): "day" | "week" | "month" {
  if (days <= 62) return "day";
  if (days <= 200) return "week";
  return "month";
}

export function resolvedGranularity(state: Pick<ReportFilterState, "granularity" | "from" | "to">) {
  return state.granularity === "auto" ? autoGranularity(daysBetween(state.from, state.to)) : state.granularity;
}

export const defaultPreset = "last30" as const satisfies RangePreset;

/** URL → state. Unknown/invalid values fall back to defaults; a custom range needs valid from ≤ to. */
export function parseReportFilters(params: URLSearchParams, now: Date = new Date()): ReportFilterState {
  const presetParam = params.get("range") as RangePreset | null;
  const from = params.get("from");
  const to = params.get("to");
  let preset: RangePreset = presetParam && (rangePresets as readonly string[]).includes(presetParam) ? presetParam : defaultPreset;
  let range: { from: string; to: string };
  if (preset === "custom" || (!presetParam && (from || to))) {
    if (isIsoDay(from) && isIsoDay(to) && from <= to && daysBetween(from, to) <= 731) {
      preset = "custom";
      range = { from, to };
    } else {
      preset = defaultPreset;
      range = presetRange(defaultPreset, now);
    }
  } else {
    range = presetRange(preset as Exclude<RangePreset, "custom">, now);
  }
  const granularity = params.get("granularity") as GranularityChoice | null;
  const cargo = params.get("cargo");
  return {
    preset,
    ...range,
    compare: params.get("compare") !== "0",
    granularity: granularity && (granularities as readonly string[]).includes(granularity) ? granularity : "auto",
    cargo: cargo === "ptt" || cargo === "surat" ? cargo : "",
    personnel: params.get("personnel") ?? "",
    channel: params.get("channel") ?? "",
    status: params.get("status") ?? "",
    product: params.get("product") ?? "",
    category: params.get("category") ?? "",
    city: params.get("city") ?? "",
  };
}

/** State → URL (defaults omitted so a clean URL means "last 30 days, compare on, everything"). */
export function serializeReportFilters(state: ReportFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.preset !== defaultPreset) params.set("range", state.preset);
  if (state.preset === "custom") {
    params.set("from", state.from);
    params.set("to", state.to);
  }
  if (!state.compare) params.set("compare", "0");
  if (state.granularity !== "auto") params.set("granularity", state.granularity);
  for (const key of dimensionKeys) {
    if (state[key]) params.set(key, state[key]);
  }
  return params;
}

export function activeDimensionCount(state: ReportFilterState) {
  return dimensionKeys.filter((key) => Boolean(state[key])).length;
}

/** State → API query string. */
export function toAnalyticsQuery(state: ReportFilterState): AnalyticsQueryParams {
  return {
    from: state.from,
    to: state.to,
    granularity: resolvedGranularity(state),
    compare: state.compare ? "1" : "0",
    ...(state.cargo ? { cargo_provider: state.cargo } : {}),
    ...(state.personnel ? { personnel_public_id: state.personnel } : {}),
    ...(state.channel ? { channel: state.channel } : {}),
    ...(state.status ? { status: state.status } : {}),
    ...(state.product ? { product_public_id: state.product } : {}),
    ...(state.category ? { category: state.category } : {}),
    ...(state.city ? { city: state.city } : {}),
  };
}

/** Pano range choices (a subset of the presets, kept in `?range=`). */
export const dashboardPresets = ["last7", "last30", "last90", "thisMonth"] as const;
export type DashboardPreset = (typeof dashboardPresets)[number];

export function parseDashboardPreset(params: URLSearchParams): DashboardPreset {
  const value = params.get("range");
  return value && (dashboardPresets as readonly string[]).includes(value) ? (value as DashboardPreset) : "last30";
}

/** First day of the day / ISO week (Monday) / month bucket containing `date` (same rule as the API). */
export function bucketOf(date: string, granularity: "day" | "week" | "month") {
  if (granularity === "day") return date;
  if (granularity === "month") return `${date.slice(0, 7)}-01`;
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - ((parsed.getUTCDay() + 6) % 7));
  return parsed.toISOString().slice(0, 10);
}

/** Re-buckets daily rows (sums every numeric field) for week/month views. */
export function rebucket<T extends { date: string }>(rows: readonly T[], granularity: "day" | "week" | "month", numericKeys: ReadonlyArray<keyof T>): Array<T & { bucket: string }> {
  const buckets = new Map<string, T & { bucket: string }>();
  for (const row of rows) {
    const bucket = bucketOf(row.date, granularity);
    const current = buckets.get(bucket);
    if (!current) {
      buckets.set(bucket, { ...row, date: bucket, bucket });
      continue;
    }
    for (const key of numericKeys) (current as Record<keyof T, unknown>)[key] = Number(current[key]) + Number(row[key]);
  }
  return [...buckets.values()].sort((first, second) => first.bucket.localeCompare(second.bucket));
}
