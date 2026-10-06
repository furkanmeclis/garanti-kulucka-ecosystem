import { type ReactNode } from "react";
import { BarChart3, BookUser, Bot, Bug, FileText, FileUp, MessageCircle, MessageSquare, MessageSquareText, Package, Phone, Settings, Send, ShoppingCart, Truck, Users, Wallet, XCircle, Zap, type LucideIcon } from "lucide-react";
import { type AdminAuditLog, type AdminSetting, type IntegrationAccount, type InstagramAnalyticsSummary as BackendInstagramAnalyticsSummary, type ProviderCatalogItem, type ProviderDebugSummary, type ProviderAttemptViewModel } from "../../api/admin-client.js";
import { type BalanceSummary as BackendBalanceSummary, type CommentModerationSummary as BackendCommentModerationSummary, type ConversationSummary, type ConversationSummaryStats, type CustomerSummary, type CustomerSummaryStats, type MessageSummary, type OrderSummaryStats, type OrderSummary, type ProductSummaryStats, type ProductSummary, type ReportSummary as BackendReportSummary, type ShipmentPipelineSummary, type ShipmentPipelineStep, type ShipmentSummaryStats, type ShipmentSummary } from "../../api/domain-client.js";
import { type FileMetadata } from "../../api/file-client.js";
import { type WebphoneConfig } from "../../api/webphone-client.js";
import { localeFor, translate, type UiLanguage } from "../i18n/index.js";
import { commonMessages, type CommonKey } from "../i18n/messages/common.js";

export const backendBaseUrl = import.meta.env.VITE_BACKEND_BASE_URL ?? "/backend";

export const tokenStorageKey = "garanti.web.access_token";

export interface DashboardData {
  conversations: ConversationSummary[];
  customers: CustomerSummary[];
  messages: MessageSummary[];
  orders: OrderSummary[];
  products: ProductSummary[];
  shipments: ShipmentSummary[];
  settings: AdminSetting[];
  integrationAccounts: IntegrationAccount[];
  settingsAudit: AdminAuditLog[];
  settingsAuditSummary: { total_count: number };
  integrationAudit: AdminAuditLog[];
  integrationAuditSummary: { total_count: number };
  providerCatalog: ProviderCatalogItem[];
  providerAttempts: ProviderAttemptViewModel[];
  providerDebugSummary: ProviderDebugSummary;
  fileOrphans: FileMetadata[];
  fileOrphanSummary: { total_count: number };
  instagramAnalytics: BackendInstagramAnalyticsSummary;
  conversationSummary: ConversationSummaryStats;
  customerSummary: CustomerSummaryStats;
  orderSummary: OrderSummaryStats;
  productSummary: ProductSummaryStats;
  reportSummary: BackendReportSummary;
  balanceSummary: BackendBalanceSummary;
  shipmentSummary: ShipmentSummaryStats;
  shipmentPipeline: ShipmentPipelineSummary;
  commentModeration: BackendCommentModerationSummary;
  webphone: WebphoneConfig | null;
}

export interface PendingAttachment {
  file: File;
  attachment_type: "image" | "video" | "document" | "file";
  preview_url: string;
  file_public_id?: string;
}

export interface ShortcutDraft {
  code: string;
  message: string;
  attachments: PendingAttachment[];
}

export interface SipServerSettings {
  ws_url: string;
  domain: string;
  stun: string;
}

export interface OperationalPolicySettings {
  max_attempts: number;
  retry_delay_ms: number;
  request_timeout_ms: number;
  webhook_timeout_ms: number;
  provider_rate_limit_per_minute: number;
  queue_concurrency: number;
  storage_bucket: string;
  lifecycle_days: number;
  orphan_cleanup_enabled: boolean;
}

export interface CommentModerationViewSummary {
  manualQueue: number;
  automaticQueue: number;
  answered: number;
  instagram: number;
  facebook: number;
}

export interface InstagramAnalyticsSummary {
  followers: number;
  reach: number;
  impressions: number;
  profileViews: number;
  engagementRate: number;
}

export type ShipmentPipelineFilter = "all" | ShipmentPipelineStep;

export type ShipmentFilter = "all" | "ptt" | "surat" | "other" | "in_transit" | "delivered" | "tracking_missing";

export type OrderSortBy = "created_at" | "order_number" | "status" | "total_amount";

export type SortDirection = "asc" | "desc";

export type OrderCargoProvider = "ptt" | "surat";

export interface OrderFormItem {
  product_public_id: string;
  name: string;
  quantity: number;
  unit_price: string;
  external_product_id: string | null;
}

export interface OrderFormState {
  customer_public_id: string | null;
  customer_name: string;
  customer_phone: string;
  address_line: string;
  city: string;
  district: string;
  country: string;
  notes: string;
  cargo_provider: OrderCargoProvider | "";
  items: OrderFormItem[];
  force_duplicate: boolean;
  force_surat_at: boolean;
  conversation_public_id: string | null;
}

export interface NavigationItem {
  key: string;
  label: string;
  icon: LucideIcon;
  roles: string[];
  path: string;
  /** Routed but not in the sidebar (legacy NAV_MENU omits the Instagram Meta review pages). */
  hidden?: boolean;
}

export const navigationItems: NavigationItem[] = [
  { key: "inbox", label: "Mesajlar", icon: MessageCircle, roles: ["admin", "calisan", "kargo_operatoru"], path: "/mesajlar" },
  { key: "comments", label: "Yorumlar", icon: MessageSquareText, roles: ["admin", "calisan"], path: "/yorumlar" },
  { key: "customers", label: "Müşteriler", icon: Users, roles: ["admin", "calisan"], path: "/musteriler" },
  { key: "orders", label: "Siparişler", icon: ShoppingCart, roles: ["admin", "calisan", "kargo_operatoru"], path: "/siparisler" },
  { key: "shipments", label: "Kargo", icon: Truck, roles: ["admin", "calisan", "kargo_operatoru"], path: "/kargo" },
  { key: "shipmentPipeline", label: "Pipeline", icon: Zap, roles: ["admin", "calisan", "kargo_operatoru"], path: "/kargo/pipeline" },
  { key: "suratDebug", label: "Sürat Debug", icon: Bug, roles: ["admin"], path: "/kargo/surat-debug" },
  { key: "cronDebug", label: "Cron Debug", icon: Bug, roles: ["admin"], path: "/kargo/cron-debug" },
  { key: "cancellations", label: "İptaller", icon: XCircle, roles: ["admin", "calisan"], path: "/iptaller" },
  { key: "inventory", label: "Stoklar", icon: Package, roles: ["admin", "calisan"], path: "/stok" },
  { key: "balances", label: "Bakiyeler", icon: Wallet, roles: ["admin", "calisan"], path: "/bakiye" },
  { key: "sms", label: "SMS", icon: MessageSquare, roles: ["admin", "calisan", "kargo_operatoru"], path: "/sms" },
  { key: "calls", label: "Arama", icon: Phone, roles: ["admin"], path: "/sesli-asistan" },
  { key: "vapi", label: "VAPI AI", icon: Bot, roles: ["admin"], path: "/sesli-asistan/vapi" },
  { key: "reports", label: "İş Analizi", icon: BarChart3, roles: ["admin"], path: "/raporlar" },
  { key: "invoices", label: "Faturalar", icon: FileText, roles: ["admin"], path: "/faturalar" },
  { key: "accounts", label: "Cari Hesaplar", icon: BookUser, roles: ["admin"], path: "/cari-hesaplar" },
  { key: "instagramPublish", label: "Yayın Oluştur", icon: Send, roles: ["admin", "calisan"], path: "/instagram/yayinla", hidden: true },
  { key: "instagramAnalytics", label: "Analitik", icon: BarChart3, roles: ["admin", "calisan"], path: "/instagram/analitik", hidden: true },
  { key: "integrations", label: "Entegrasyonlar", icon: Settings, roles: ["admin"], path: "/ayarlar/entegrasyonlar" },
  { key: "admin", label: "Ayarlar", icon: Settings, roles: ["admin", "calisan", "kargo_operatoru"], path: "/ayarlar" },
  { key: "files", label: "Dosya", icon: FileUp, roles: ["admin", "calisan"], path: "/dosya" },
  { key: "webphone", label: "Santral", icon: Phone, roles: ["admin"], path: "/santral" },
];

export const defaultSipServerSettings: SipServerSettings = {
  ws_url: "",
  domain: "",
  stun: "stun:stun.l.google.com:19302",
};

export const defaultOperationalPolicy: OperationalPolicySettings = {
  max_attempts: 3,
  retry_delay_ms: 30000,
  request_timeout_ms: 10000,
  webhook_timeout_ms: 5000,
  provider_rate_limit_per_minute: 60,
  queue_concurrency: 4,
  storage_bucket: "garage-media",
  lifecycle_days: 90,
  orphan_cleanup_enabled: true,
};

export const instagramDraftImageUrl = "https://example.com/garanti-kulucka.jpg";

export const instagramDraftCaption = "Kuluçka makineleri ve yedek parça operasyonundan güncel ürün duyurusu.";

export const instagramCaptionLimit = 2200;

export const shipmentPageSize = 20;

/** The bootstrap `owner` account has admin reach in the UI (navigation, observer presence). */
export function navigationRole(role: string | null | undefined) {
  return role === "owner" ? "admin" : role ?? "guest";
}

export function flowFromPath(pathname: string) {
  return [...navigationItems]
    .sort((first, second) => second.path.length - first.path.length)
    .find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))?.key ?? "inbox";
}

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function shipmentFilterParams(filter: string): { provider?: string; status?: string; tracking_missing?: boolean } {
  const params: { provider?: string; status?: string; tracking_missing?: boolean } = {};
  if (filter === "ptt") {
    params.provider = "ptt";
  }
  if (filter === "surat") {
    params.provider = "surat";
  }
  if (filter === "other") {
    params.provider = "other";
  }
  if (filter === "in_transit") {
    params.status = "in_transit";
  }
  if (filter === "delivered") {
    params.status = "delivered";
  }
  if (filter === "tracking_missing") {
    params.tracking_missing = true;
  }
  return params;
}

const shipmentStatusKeys: Record<string, CommonKey> = {
  created: "statusCreated",
  olusturuldu: "statusCreated",
  preparing: "statusPreparing",
  hazirlaniyor: "statusPreparing",
  shipped: "statusShipped",
  kargoya_verildi: "statusShipped",
  in_transit: "statusInTransit",
  dagitimda: "statusOutForDelivery",
  delivered: "statusDelivered",
  teslim_edildi: "statusDelivered",
  returned: "statusReturned",
  iade: "statusReturned",
  cancelled: "statusCancelled",
  iptal: "statusCancelled",
};

export function shipmentStatusLabel(status: string, language: UiLanguage = "tr") {
  const key = shipmentStatusKeys[status];
  return key ? translate(commonMessages, language, key) : status;
}

export function shipmentMatchesFilter(shipment: ShipmentSummary, filter: ShipmentFilter) {
  const provider = shipment.provider.toLocaleLowerCase("tr-TR");
  if (filter === "all") return true;
  if (filter === "ptt") return provider.includes("ptt");
  if (filter === "surat") return provider.includes("sürat") || provider.includes("surat");
  if (filter === "other") return !provider.includes("ptt") && !provider.includes("sürat") && !provider.includes("surat");
  if (filter === "tracking_missing") return !shipment.tracking_number && !shipment.barcode_number;
  return shipment.status === filter;
}

const orderStatusKeys: Record<string, CommonKey> = {
  draft: "statusCreated",
  created: "statusCreated",
  olusturuldu: "statusCreated",
  pending_confirmation: "statusPendingConfirmation",
  teyit_bekliyor: "statusPendingConfirmation",
  confirmed: "statusConfirmed",
  teyit_edildi: "statusConfirmed",
  preparing: "statusPreparing",
  hazirlaniyor: "statusPreparing",
  shipped: "statusShippedOrder",
  sevk_edildi: "statusShippedOrder",
  delivered: "statusDelivered",
  teslim_edildi: "statusDelivered",
  cancelled: "statusCancelled",
  iptal: "statusCancelled",
  returned: "statusReturned",
  iade: "statusReturned",
};

export function orderStatusLabel(status: string, language: UiLanguage = "tr") {
  const key = orderStatusKeys[status];
  return key ? translate(commonMessages, language, key) : status;
}

export function cargoProviderLabel(provider: string | null) {
  if (!provider) return "-";
  const normalized = provider.toLocaleLowerCase("tr-TR");
  if (normalized.includes("ptt")) return "PTT";
  if (normalized.includes("sürat") || normalized.includes("surat")) return "Sürat";
  return provider;
}

export function readStoredToken() {
  return window.localStorage.getItem(tokenStorageKey);
}

export function formatMoney(value: number, currency: string) {
  return `${value.toFixed(2)} ${currency}`;
}

export function formatDate(value: string, language: UiLanguage = "tr") {
  return new Date(value).toLocaleTimeString(localeFor(language), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function attachmentTypeFromFile(file: File): PendingAttachment["attachment_type"] {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type === "application/pdf") return "document";
  return "file";
}

export function attachmentLabel(type: string, language: UiLanguage = "tr") {
  const key: CommonKey =
    type === "image" ? "attachmentImage" : type === "video" ? "attachmentVideo" : type === "document" ? "attachmentPdf" : "attachmentFile";
  return translate(commonMessages, language, key);
}

export function formatPercent(numerator: number, denominator: number) {
  return denominator > 0 ? `%${Math.round((numerator / denominator) * 100)}` : "%0";
}

export const sensitivePreviewKeyPattern = /authorization|token|secret|password|credential|api[_-]?key/i;

export function redactedPreviewValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactedPreviewValue);
  }
  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sensitivePreviewKeyPattern.test(key) ? "[redacted]" : redactedPreviewValue(entry),
    ]),
  );
}

export function compactJson(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  const serialized = JSON.stringify(redactedPreviewValue(value));
  return serialized.length > 140 ? `${serialized.slice(0, 137)}...` : serialized;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function firstOrderFormItem(products: ProductSummary[]): OrderFormItem {
  const defaultProduct =
    products.find((product) => product.name.toLocaleLowerCase("tr-TR").includes("kuluçka")) ??
    products[0];
  return {
    product_public_id: defaultProduct?.public_id ?? "",
    name: defaultProduct?.name ?? "El yapımı kuluçka makinası",
    quantity: 1,
    unit_price: defaultProduct?.unit_price ?? "0.00",
    external_product_id: defaultProduct?.external_product_id ?? null,
  };
}

export function defaultOrderForm(products: ProductSummary[] = []): OrderFormState {
  return {
    customer_public_id: null,
    customer_name: "",
    customer_phone: "",
    address_line: "",
    city: "",
    district: "",
    country: "Türkiye",
    notes: "",
    cargo_provider: "",
    items: [firstOrderFormItem(products)],
    force_duplicate: false,
    force_surat_at: false,
    conversation_public_id: null,
  };
}

export function parseMoneyInput(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function orderFormTotals(items: OrderFormItem[]) {
  const genelToplam = items.reduce(
    (total, item) => total + Math.max(Number(item.quantity) || 0, 0) * parseMoneyInput(item.unit_price),
    0,
  );
  const araToplam = Math.round((genelToplam / 1.2) * 100) / 100;
  const kdvToplam = Math.round((genelToplam - araToplam) * 100) / 100;
  return { araToplam, kdvToplam, genelToplam };
}

export const defaultBalanceSummary: BackendBalanceSummary = {
  total_commission: 0,
  total_deduction: 0,
  pending_payment: 0,
  available_balance: 0,
  pending_request_count: 0,
};

export const defaultConversationSummary: ConversationSummaryStats = {
  total_count: 0,
  unread_count: 0,
  pool_count: 0,
  human_agent_count: 0,
  channel_counts: {
    instagram: 0,
    facebook: 0,
  },
  status_counts: {
    open: 0,
    closed: 0,
  },
};

export const defaultCustomerSummary: CustomerSummaryStats = {
  total_count: 0,
  with_phone_count: 0,
  with_email_count: 0,
  with_notes_count: 0,
};

export const defaultOrderSummary: OrderSummaryStats = {
  total_count: 0,
  active_count: 0,
  delivered_count: 0,
  pending_confirmation_count: 0,
  total_revenue: 0,
  currency: "TRY",
};

export const defaultProductSummary: ProductSummaryStats = {
  total_count: 0,
  active_count: 0,
  critical_count: 0,
  critical_threshold: 3,
  category_counts: {
    incubator: 0,
    spare_part: 0,
    other: 0,
  },
};

export const defaultProviderDebugSummary: ProviderDebugSummary = {
  providers: [
    {
      provider_key: "ptt",
      total_attempts: 0,
      success_count: 0,
      failure_count: 0,
      retry_count: 0,
      average_duration_ms: 0,
      latest_attempt: null,
    },
    {
      provider_key: "surat",
      total_attempts: 0,
      success_count: 0,
      failure_count: 0,
      retry_count: 0,
      average_duration_ms: 0,
      latest_attempt: null,
    },
  ],
  cron: {
    provider_keys: ["ptt", "surat"],
    operation: "shipment.track",
    total_attempts: 0,
    success_count: 0,
    failure_count: 0,
    retry_count: 0,
    total_duration_ms: 0,
    latest_attempt: null,
  },
};

export const defaultShipmentPipelineSummary: ShipmentPipelineSummary = {
  counts: {
    all: 0,
    mesaj: 0,
    sms: 0,
    vapi: 0,
    teslim: 0,
    bekliyor: 0,
    isleniyor: 0,
    hata: 0,
  },
  rows: [],
};

export const defaultShipmentSummary: ShipmentSummaryStats = {
  total_count: 0,
  active_count: 0,
  delivered_count: 0,
  recipient_phone_count: 0,
  provider_counts: {
    ptt: 0,
    surat: 0,
    other: 0,
  },
  exception_counts: {
    ptt_not_delivered: 0,
    surat_not_delivered: 0,
    tracking_missing: 0,
  },
};

export const defaultCommentModerationSummary: BackendCommentModerationSummary = {
  manual_queue: 0,
  automatic_queue: 0,
  answered: 0,
  instagram: 0,
  facebook: 0,
};

export const defaultInstagramAnalyticsSummary: BackendInstagramAnalyticsSummary = {
  followers: 0,
  reach: 0,
  impressions: 0,
  profile_views: 0,
  engagement_rate: 0,
};

export const defaultReportSummary: BackendReportSummary = {
  conversation_count: 0,
  order_count: 0,
  shipment_count: 0,
  total_revenue: 0,
  currency: "TRY",
  open_conversation_count: 0,
  pending_confirmation_count: 0,
  active_shipment_count: 0,
  delivered_shipment_count: 0,
  delivered_shipment_rate: 0,
  confirmation_rate: 0,
  active_shipment_rate: 0,
};

export function toInstagramAnalyticsView(summary: BackendInstagramAnalyticsSummary): InstagramAnalyticsSummary {
  return {
    followers: summary.followers,
    reach: summary.reach,
    impressions: summary.impressions,
    profileViews: summary.profile_views,
    engagementRate: summary.engagement_rate,
  };
}

export function toCommentModerationView(summary: BackendCommentModerationSummary): CommentModerationViewSummary {
  return {
    manualQueue: summary.manual_queue,
    automaticQueue: summary.automatic_queue,
    answered: summary.answered,
    instagram: summary.instagram,
    facebook: summary.facebook,
  };
}

export function readNumberSetting(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function sipServerSettingsFrom(settings: AdminSetting[], webphoneConfig: WebphoneConfig | null): SipServerSettings {
  const value = settings.find((setting) => setting.key === "sip_config")?.value;
  const record = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    ws_url: typeof record.ws_url === "string" ? record.ws_url : webphoneConfig?.sip_websocket_url ?? defaultSipServerSettings.ws_url,
    domain: typeof record.domain === "string" ? record.domain : webphoneConfig?.sip_domain ?? defaultSipServerSettings.domain,
    stun: typeof record.stun === "string" ? record.stun : defaultSipServerSettings.stun,
  };
}

export function operationalPolicyFrom(settings: AdminSetting[]): OperationalPolicySettings {
  const value = settings.find((setting) => setting.key === "operations.policy")?.value;
  const record = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    max_attempts: readNumberSetting(record.max_attempts, defaultOperationalPolicy.max_attempts),
    retry_delay_ms: readNumberSetting(record.retry_delay_ms, defaultOperationalPolicy.retry_delay_ms),
    request_timeout_ms: readNumberSetting(record.request_timeout_ms, defaultOperationalPolicy.request_timeout_ms),
    webhook_timeout_ms: readNumberSetting(record.webhook_timeout_ms, defaultOperationalPolicy.webhook_timeout_ms),
    provider_rate_limit_per_minute: readNumberSetting(
      record.provider_rate_limit_per_minute,
      defaultOperationalPolicy.provider_rate_limit_per_minute,
    ),
    queue_concurrency: readNumberSetting(record.queue_concurrency, defaultOperationalPolicy.queue_concurrency),
    storage_bucket: typeof record.storage_bucket === "string"
      ? record.storage_bucket
      : defaultOperationalPolicy.storage_bucket,
    lifecycle_days: readNumberSetting(record.lifecycle_days, defaultOperationalPolicy.lifecycle_days),
    orphan_cleanup_enabled: typeof record.orphan_cleanup_enabled === "boolean"
      ? record.orphan_cleanup_enabled
      : defaultOperationalPolicy.orphan_cleanup_enabled,
  };
}

export function FlowPanel(props: { title: string; icon: ReactNode; testId: string; children: ReactNode }) {
  return (
    <section className="flow-panel" data-testid={props.testId}>
      <h1>
        {props.icon}
        {props.title}
      </h1>
      {props.children}
    </section>
  );
}

export function DetailPanel(props: { title: string; testId: string; children: ReactNode }) {
  return (
    <section className="detail-panel" data-testid={props.testId}>
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}

export function List(props: { title: string; children: ReactNode; testId?: string }) {
  return (
    <div className="list-panel" data-testid={props.testId}>
      <h2>{props.title}</h2>
      <ul>{props.children}</ul>
    </div>
  );
}

export function Metric(props: { title: string; value: string }) {
  return (
    <div className="metric">
      <span>{props.title}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

export function DataRows(props: { rows: string[][] }) {
  return (
    <div className="data-list">
      {props.rows.map((row) => (
        <div className="data-row" key={row.join(":")}>
          {row.map((cell, index) => (
            <span key={`${cell}:${index}`}>{cell}</span>
          ))}
        </div>
      ))}
    </div>
  );
}
