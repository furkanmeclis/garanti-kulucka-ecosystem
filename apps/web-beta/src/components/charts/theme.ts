import type { Brand } from "@/components/brand-icons";

/** Fixed-order categorical slots (charts.css). Assign in order, never cycle: a 9th series folds into "Other". */
export const seriesColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)", "var(--chart-7)", "var(--chart-8)"] as const;

export function seriesColor(index: number) {
  return seriesColors[Math.min(index, seriesColors.length - 1)]!;
}

export const chartTokens = {
  grid: "var(--chart-grid)",
  axis: "var(--chart-axis)",
  muted: "var(--chart-muted)",
  surface: "var(--chart-surface)",
  seq: "var(--chart-seq)",
  good: "var(--chart-good)",
  warning: "var(--chart-warning)",
  serious: "var(--chart-serious)",
  critical: "var(--chart-critical)",
} as const;

/** Series that *are* a brand keep the brand colour. */
export const brandColor: Partial<Record<Brand | "manual" | "phone", string>> = {
  whatsapp: "var(--brand-whatsapp)",
  instagram: "var(--brand-instagram)",
  messenger: "var(--brand-messenger)",
  facebook: "var(--brand-messenger)",
  ptt: "var(--brand-ptt)",
  surat: "var(--brand-surat)",
  manual: "var(--brand-manual)",
  phone: "var(--chart-4)",
};

export function channelColor(channel: string) {
  return brandColor[channel as keyof typeof brandColor] ?? seriesColor(0);
}

export function providerColor(provider: string) {
  return brandColor[provider as keyof typeof brandColor] ?? "var(--brand-manual)";
}
