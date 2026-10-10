import type { TFunction } from "i18next";
import { i18n } from "@/i18n";

/** Canonical status keys (i18n `status.*`) for the English and legacy Turkish values the backend may return. */
export const statusAliases: Record<string, string> = {
  draft: "draft",
  created: "created",
  olusturuldu: "created",
  pending_confirmation: "pending_confirmation",
  teyit_bekliyor: "pending_confirmation",
  bekliyor: "pending",
  pending: "pending",
  confirmed: "confirmed",
  teyit_edildi: "confirmed",
  ulasilamadi: "unreachable",
  preparing: "preparing",
  hazirlaniyor: "preparing",
  shipped: "shipped",
  sevk_edildi: "shipped",
  kargoya_verildi: "shipped",
  in_transit: "in_transit",
  dagitimda: "out_for_delivery",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
  teslim_edildi: "delivered",
  returned: "returned",
  iade: "returned",
  cancelled: "cancelled",
  iptal: "cancelled",
  open: "open",
  closed: "closed",
  active: "active",
  exception: "exception",
  subede: "at_branch",
  at_branch: "at_branch",
  failed: "failed",
  hata: "failed",
  inactive: "inactive",
  disabled: "inactive",
  pasif: "inactive",
};

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export function statusKey(value: string | null | undefined) {
  if (!value) return null;
  return statusAliases[value.toLowerCase()] ?? null;
}

export function statusTone(value: string | null | undefined): StatusTone {
  switch (statusKey(value)) {
    case "delivered":
    case "confirmed":
      return "success";
    case "pending_confirmation":
    case "pending":
    case "preparing":
    case "unreachable":
      return "warning";
    case "cancelled":
    case "returned":
    case "exception":
      return "danger";
    case "shipped":
    case "in_transit":
    case "out_for_delivery":
    case "open":
      return "info";
    default:
      return "neutral";
  }
}

/** Enum groups translated under `enums.<group>.<value>` (dots in values become underscores). */
export const enumGroups = ["kolaybiStatus", "eDocumentStatus", "confirmationStatus", "callStatus", "jobStatus", "retryDecision", "direction", "provider", "operation", "logModule", "logAction", "cdrDirection"] as const;
export type EnumGroup = (typeof enumGroups)[number];

/** "contact_lookup" → "contact lookup": only used inside the "Bilinmiyor (…)" fallback, never as a label on its own. */
export function humanizeValue(value: string) {
  return value.replace(/[._-]+/g, " ").trim();
}

export function enumKey(value: string) {
  return value.trim().toLowerCase().replace(/[.\s-]+/g, "_");
}

/** Translated label for a backend enum value; unknown values read "Bilinmiyor (<value>)", empty ones "—". */
export function enumLabel(t: TFunction, group: EnumGroup, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return t("common.none");
  const key = `enums.${group}.${enumKey(String(value))}`;
  if (i18n.exists(key)) return t(key as never) as unknown as string;
  return t("common.unknownValue", { value: humanizeValue(String(value)) });
}

/** Order/shipment status label (status.* via the alias table), with the same unknown fallback. */
export function statusLabel(t: TFunction, value: string | null | undefined): string {
  if (!value) return t("common.none");
  const key = statusKey(value);
  return key ? (t(`status.${key}` as "status.delivered") as string) : t("common.unknownValue", { value: humanizeValue(value) });
}

/** One-line meaning of a status for badge tooltips; null when the status is unknown. */
export function statusHint(t: TFunction, value: string | null | undefined): string | null {
  const key = statusKey(value);
  return key && i18n.exists(`statusHint.${key}`) ? (t(`statusHint.${key}` as never) as unknown as string) : null;
}

/**
 * Status text that may come either as an enum ("in_transit") or as a carrier's own sentence ("Şubede bekliyor").
 * Known enums are translated, other snake_case codes get the unknown fallback, human text is shown as-is.
 */
export function statusText(t: TFunction, value: string | null | undefined): string {
  if (!value) return t("common.none");
  if (statusKey(value)) return statusLabel(t, value);
  return /^[a-z0-9]+([._-][a-z0-9]+)*$/.test(value.trim()) ? t("common.unknownValue", { value: humanizeValue(value) }) : value;
}
