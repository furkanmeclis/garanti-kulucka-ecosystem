/** Order create, actions and cargo-transfer shapes used by the beta Siparişler page (legacy SiparislerPage). */
export type CargoProviderKey = "ptt" | "surat";
export type ShipmentPaymentStatus = "karsi_odemeli" | "odeme_alindi";

export interface CreateOrderInput {
  customer_public_id?: string | null;
  conversation_public_id?: string | null;
  customer: { full_name: string; phone: string };
  address: { address_line: string; city: string; district: string; country?: string };
  status?: string;
  source?: string;
  cargo_provider: CargoProviderKey;
  notes?: string | null;
  currency?: string;
  items: Array<{ product_public_id?: string | null; name: string; quantity: number; unit_price: string; external_product_id?: string | null }>;
  force_duplicate?: boolean;
  force_surat_at?: boolean;
}

export interface ProductOption {
  public_id: string;
  name: string;
  unit_price: string;
  stock_quantity: number;
  external_product_id: string | null;
}

export interface CustomerLookup {
  customer: { public_id: string; full_name: string | null; phone: string | null } | null;
  default_address: { address_line: string | null; city: string | null; district: string | null; country: string | null } | null;
}

export interface OrderProviderStep {
  public_id: string;
  action: string;
  provider: "kolaybi" | "netgsm";
  operation: string;
  attempt: number;
  status: "queued" | "succeeded" | "failed";
  error_message: string | null;
  created_at: string;
}

export interface OrderActionDetail {
  public_id: string;
  order_number: string;
  status: string;
  notes: string | null;
  total_amount: string;
  currency: string;
  customer_full_name: string | null;
  customer_phone: string | null;
  deleted_at: string | null;
  confirmation_status: string | null;
  kolaybi: { contact_id: string | null; address_id: string | null; invoice_id: string | null; status: string | null; error: string | null; e_document_status: string | null };
  confirmation_call: { status: string | null; bulk_id: string | null; pressed_key: string | null; listen_seconds: number | null; call_count: number };
  created_at: string;
  updated_at: string;
}

export interface OrderProviderStepResponse {
  replayed: boolean;
  invoice_id?: string;
  step: OrderProviderStep;
}

export interface OrderBulkActionResponse {
  requested_count: number;
  queued_count: number;
  results: Array<{ order_public_id: string; queued: boolean; skipped_reason: string | null }>;
}

export interface ShipmentDraft {
  order_public_id: string;
  order_number: string;
  total_amount: string;
  currency: string;
  recipient: { name: string | null; phone: string | null; address: string | null; city: string | null; district: string | null };
  items: Array<{ name: string; quantity: number; unit_price: string; total_amount: string }>;
  existing_shipment: { public_id: string; provider: string; status: string; tracking_number: string | null; barcode_number: string | null } | null;
}

export interface CreateShipmentResponse {
  provider: CargoProviderKey;
  barcode_number: string | null;
  queued: boolean;
  live_call_permitted: boolean;
  message: string;
}

export interface BulkCreateShipmentsResponse {
  provider: CargoProviderKey;
  created_count: number;
  skipped_count: number;
  failed_count: number;
  message: string;
}

/** Legacy teyit badge order: 9'a Bastı → Teyitli → Aranıyor... → Geçersiz Numara → Ulaşılamadı → Bekliyor. */
export function confirmationBadge(order: Pick<OrderActionDetail, "confirmation_status" | "confirmation_call">) {
  const call = order.confirmation_call;
  if (call.pressed_key === "9" || order.confirmation_status === "iptal_istegi") return { key: "badgePressed9", tone: "danger" } as const;
  if (order.confirmation_status === "teyit_edildi") return { key: "badgeConfirmed", tone: "success" } as const;
  if (call.status === "araniyor") return { key: "badgeCalling", tone: "info" } as const;
  if (order.confirmation_status === "gecersiz_numara" || call.status === "gecersiz_numara") return { key: "badgeInvalidNumber", tone: "danger" } as const;
  if (order.confirmation_status === "ulasilamadi" || ["cevaplanmadi", "ulasilamadi", "mesgul"].includes(call.status ?? "")) return { key: "badgeUnreachable", tone: "warning" } as const;
  return { key: "badgePending", tone: "neutral" } as const;
}

/** Legacy KolayBi badge: KB İptal Edildi / Aktarıldı / Aktarılıyor / Cari Hazır / Bekliyor. */
export function kolaybiBadge(order: Pick<OrderActionDetail, "status" | "kolaybi">) {
  const kb = order.kolaybi;
  if (kb.invoice_id && (order.status === "cancelled" || kb.status === "cancelled")) return { key: "kbCancelled", sub: "kbInvoiceDeleted", tone: "danger" } as const;
  if (kb.invoice_id) return { key: "kbTransferred", sub: "kbReadyToSend", tone: "success" } as const;
  if (kb.status && ["contact_lookup", "contact_create", "invoice_create"].includes(kb.status)) return { key: "kbTransferring", sub: null, tone: "info" } as const;
  if (kb.contact_id) return { key: "kbContactReady", sub: null, tone: "info" } as const;
  return { key: "badgePending", sub: null, tone: "neutral" } as const;
}

/** Legacy order totals: prices include 20% VAT. */
export function orderTotals(items: Array<{ quantity: number | string; unit_price: string }>) {
  const grand = items.reduce((sum, item) => sum + Math.max(Number(item.quantity) || 0, 0) * parseMoney(item.unit_price), 0);
  const subtotal = Math.round((grand / 1.2) * 100) / 100;
  return { subtotal, vat: Math.round((grand - subtotal) * 100) / 100, grand: Math.round(grand * 100) / 100 };
}

export function parseMoney(value: string) {
  const normalized = value.trim().replace(/\s/g, "");
  const decimal = normalized.includes(",") ? normalized.replace(/\./g, "").replace(",", ".") : normalized;
  const parsed = Number.parseFloat(decimal);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface ShipmentPrintData {
  shipment_public_id: string;
  provider: string;
  provider_label: string;
  status: string;
  tracking_number: string | null;
  barcode_number: string | null;
  barcode_value: string | null;
  label_printed_at: string | null;
  invoice_title: string;
  recipient: { name: string | null; phone: string | null; address: string | null; city: string | null; district: string | null };
  items: Array<{ name: string; quantity: number; unit_price: string; total_amount: string }>;
}
