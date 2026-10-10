/**
 * Read-only analytics contracts for the beta panel's Pano (`GET /api/reports/dashboard`) and
 * İş Analizi (`GET /api/reports/timeseries`, `/breakdowns`, `/invoices`) pages.
 * Every date is a calendar day (YYYY-MM-DD) in Europe/Istanbul; money is a TRY number rounded to kuruş.
 */

export type AnalyticsGranularity = "day" | "week" | "month";
export type AnalyticsCargoProvider = "tumu" | "ptt" | "surat";
/** Where an order came from: the linked conversation's channel, or `manual` when it was keyed in the panel. */
export type AnalyticsChannel = "whatsapp" | "instagram" | "messenger" | "phone" | "manual";
/** Legacy `durum` keys (orders.status canonical + legacy spellings normalised). */
export type AnalyticsOrderStatus =
  | "olusturuldu"
  | "teyit_bekliyor"
  | "teyit_edildi"
  | "hazirlaniyor"
  | "kargoya_verildi"
  | "sevk_edildi"
  | "teslim_edildi"
  | "iptal"
  | "iade";

export interface AnalyticsRange {
  from: string;
  to: string;
  /** The equally long period right before `from` (always computed; `compare` decides whether it is returned). */
  previous_from: string;
  previous_to: string;
  granularity: AnalyticsGranularity;
  days: number;
}

export interface AnalyticsFilters {
  cargo_provider: AnalyticsCargoProvider;
  personnel_public_id: string | null;
  channel: AnalyticsChannel | null;
  status: AnalyticsOrderStatus | null;
  product_public_id: string | null;
  category: string | null;
  city: string | null;
}

/** One time bucket (bucket = first day of the day/ISO week/month). */
export interface AnalyticsBucket {
  bucket: string;
  orders: number;
  revenue: number;
  active_orders: number;
  cancelled: number;
  returned: number;
  delivered: number;
  in_cargo: number;
  confirmed: number;
  new_customers: number;
  conversations: number;
  messages_in: number;
}

export type AnalyticsKpiKey =
  | "revenue"
  | "orders"
  | "avg_basket"
  | "confirmation_rate"
  | "in_cargo"
  | "delivered"
  | "cancel_rate"
  | "return_rate"
  | "new_customers"
  | "conversations"
  | "messages_in"
  | "unread_messages";

export interface AnalyticsKpi {
  key: AnalyticsKpiKey;
  value: number;
  /** Same metric over the previous period; null for snapshot metrics or when compare is off. */
  previous: number | null;
  /** Relative change in percent (one decimal); null when previous is null or 0. */
  change_pct: number | null;
  /** Per-bucket values for the sparkline (empty for snapshot metrics). */
  series: number[];
  unit: "money" | "count" | "percent";
}

export interface AnalyticsChannelRow {
  channel: AnalyticsChannel;
  orders: number;
  revenue: number;
  cancelled: number;
}

export interface AnalyticsCargoProviderRow {
  provider: "ptt" | "surat" | "other";
  orders: number;
  revenue: number;
  in_cargo: number;
  delivered: number;
  returned: number;
  at_branch: number;
  tracking_returns: number;
}

export interface AnalyticsFunnelStep {
  key: "created" | "confirmed" | "shipped" | "delivered";
  count: number;
}

export interface AnalyticsProductRow {
  product_public_id: string | null;
  name: string;
  category: string | null;
  quantity: number;
  revenue: number;
  orders: number;
}

export interface AnalyticsPersonnelRow {
  user_public_id: string;
  name: string;
  orders: number;
  revenue: number;
  cancelled: number;
  returned: number;
  delivered: number;
  avg_basket: number;
  confirmation_rate: number;
}

export interface AnalyticsRecentOrder {
  public_id: string;
  order_number: string;
  customer_name: string | null;
  status: string;
  channel: AnalyticsChannel;
  cargo_provider: string | null;
  total_amount: number;
  created_at: string;
}

export interface AnalyticsRecentShipment {
  public_id: string;
  recipient_name: string;
  tracking_number: string | null;
  provider: string;
  status: string;
  order_number: string | null;
  created_at: string;
}

export interface AnalyticsUnreadConversation {
  public_id: string;
  channel: string;
  customer_name: string | null;
  unread_count: number;
  last_message_text: string | null;
  last_message_at: string | null;
}

export interface DashboardAnalytics {
  range: AnalyticsRange;
  currency: "TRY";
  generated_at: string;
  kpis: AnalyticsKpi[];
  timeseries: AnalyticsBucket[];
  previous_timeseries: AnalyticsBucket[];
  channels: AnalyticsChannelRow[];
  cargo_providers: AnalyticsCargoProviderRow[];
  funnel: AnalyticsFunnelStep[];
  top_products: AnalyticsProductRow[];
  /** Managers only; null for staff roles. */
  personnel: AnalyticsPersonnelRow[] | null;
  /** Point-in-time counters (not range bound): legacy Pano cards + the attention list. */
  snapshot: {
    pending_shipments: number;
    delivered_today: number;
    total_customers: number | null;
    unread_conversations: number | null;
    unread_messages: number | null;
    awaiting_confirmation: number;
    tracking_missing: number;
    at_branch: number;
  };
  attention: {
    awaiting_confirmation: AnalyticsRecentOrder[];
    tracking_missing: AnalyticsRecentShipment[];
    unread_conversations: AnalyticsUnreadConversation[] | null;
  };
  recent_orders: AnalyticsRecentOrder[];
  recent_shipments: AnalyticsRecentShipment[];
}

export interface TimeseriesAnalytics {
  range: AnalyticsRange;
  filters: AnalyticsFilters;
  compare: boolean;
  currency: "TRY";
  kpis: AnalyticsKpi[];
  timeseries: AnalyticsBucket[];
  previous_timeseries: AnalyticsBucket[] | null;
}

export interface AnalyticsCityRow {
  city: string;
  orders: number;
  revenue: number;
  customers: number;
  cancelled: number;
  returned: number;
}

export interface AnalyticsHeatCell {
  /** 0 = Monday … 6 = Sunday (Europe/Istanbul). */
  weekday: number;
  hour: number;
  orders: number;
  messages: number;
}

export interface AnalyticsConversionRow {
  channel: AnalyticsChannel;
  conversations: number;
  converted: number;
  orders: number;
  rate: number;
}

export interface AnalyticsCohortRow {
  /** First-order month (YYYY-MM). */
  cohort: string;
  customers: number;
  /** Customers of the cohort ordering again in month offset 0..5 (offset 0 = first month itself, so it equals `customers`). */
  retention: number[];
}

/** Legacy RaporlarPage KPI block (same keys/formulas as `/api/reports/analysis`), over the fully filtered order set. */
export interface AnalyticsLegacyMetrics {
  toplam: number;
  aktif: number;
  ciro: number;
  iptal: number;
  iade: number;
  sevk_edildi: number;
  teslim_edildi: number;
  kargoya_giden: number;
  ptt: number;
  surat: number;
  ptt_subede: number;
  surat_subede: number;
  subede_toplam: number;
  teyit_edildi: number;
  teyit_bekliyor: number;
  kargo_iade: number;
  ptt_kargo_iade: number;
  surat_kargo_iade: number;
  kargo_takip_iade: number;
}

export interface AnalyticsLegacyRates {
  teslim: number;
  iptal: number;
  iade: number;
  kargo_iade: number;
  teyit: number;
  sube: number;
}

export interface BreakdownAnalytics {
  range: AnalyticsRange;
  filters: AnalyticsFilters;
  currency: "TRY";
  metrics: AnalyticsLegacyMetrics;
  rates: AnalyticsLegacyRates;
  status_distribution: Array<{ status: AnalyticsOrderStatus; count: number }>;
  channels: AnalyticsChannelRow[];
  cargo_providers: AnalyticsCargoProviderRow[];
  funnel: AnalyticsFunnelStep[];
  cities: AnalyticsCityRow[];
  products: AnalyticsProductRow[];
  categories: Array<{ category: string; quantity: number; revenue: number; orders: number }>;
  personnel: AnalyticsPersonnelRow[];
  heatmap: AnalyticsHeatCell[];
  conversion: { conversations: number; converted: number; orders: number; rate: number; by_channel: AnalyticsConversionRow[] };
  customers: {
    customers_with_orders: number;
    new_customers: number;
    returning_customers: number;
    repeat_rate: number;
    avg_orders_per_customer: number;
    distribution: Array<{ bucket: "1" | "2" | "3" | "4+"; customers: number }>;
    cohorts: AnalyticsCohortRow[];
  };
  confirmation: {
    total_calls: number;
    called_orders: number;
    avg_listen_seconds: number;
    call_statuses: Array<{ status: string; count: number }>;
    outcomes: Array<{ outcome: string; count: number }>;
  };
  cancellation_reasons: Array<{ reason: string; status: "iptal" | "iade"; count: number }>;
  options: {
    personnel: Array<{ public_id: string; name: string }>;
    products: Array<{ public_id: string; name: string; category: string | null }>;
    categories: string[];
    cities: string[];
  };
}

export interface InvoiceAnalyticsTotals {
  count: number;
  total: number;
  vat: number;
  paid: number;
  remaining: number;
}

export interface InvoiceAnalytics {
  range: { from: string; to: string };
  currency: "TRY";
  sale: InvoiceAnalyticsTotals;
  sale_return: InvoiceAnalyticsTotals;
  net_vat: number;
  daily: Array<{ date: string; sale: number; sale_return: number; count: number }>;
}
