import type { TFunction } from "i18next";
import { enumLabel } from "@/lib/status";

/** Product categories: canonical keys get the inventory labels; free-text categories are shown as entered. */
export function categoryLabel(t: TFunction, value: string | null | undefined) {
  if (!value) return t("analytics.uncategorized");
  if (value === "incubator") return t("inventory.categoryIncubatorTitle");
  if (value === "spare_part") return t("inventory.categorySparePartTitle");
  if (value === "other") return t("inventory.categoryOtherTitle");
  return value;
}

export function channelName(t: TFunction, channel: string) {
  return t(`analytics.channel.${channel}` as "analytics.channel.whatsapp", { defaultValue: channel });
}

export function legacyStatusName(t: TFunction, status: string) {
  return t(`analytics.status.${status}` as "analytics.status.iptal", { defaultValue: status });
}

export function callStatusName(t: TFunction, status: string) {
  return status === "not_called" ? t("analytics.callNotCalled") : enumLabel(t, "callStatus", status);
}

export function outcomeName(t: TFunction, outcome: string) {
  return enumLabel(t, "confirmationStatus", outcome);
}

export function reasonName(t: TFunction, reason: string) {
  return reason ? reason : t("analytics.unspecifiedReason");
}
