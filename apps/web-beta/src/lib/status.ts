/** Canonical status keys (i18n `status.*`) for the English and legacy Turkish values the backend may return. */
const statusAliases: Record<string, string> = {
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
