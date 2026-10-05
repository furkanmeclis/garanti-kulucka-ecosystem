import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  Boxes,
  BarChart3,
  Bot,
  Bug,
  Calendar,
  CheckCircle,
  CheckCheck,
  CheckSquare,
  Download,
  FileUp,
  FileText,
  Headphones,
  Eye,
  Image,
  LogIn,
  MessageCircle,
  MessageSquare,
  MessageSquareText,
  Package,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Settings,
  Search,
  Send,
  Shield,
  ShoppingCart,
  Square,
  Trash2,
  Truck,
  Users,
  Wallet,
  Wifi,
  WifiOff,
  X,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  createAdminClient,
  type AdminAuditLog,
  type AdminSetting,
  type IntegrationAccount,
  type IntegrationAccountSnapshot,
  type InstagramAnalyticsSummary as BackendInstagramAnalyticsSummary,
  type ProviderCatalogItem,
  type ProviderDebugSummary,
  type ProviderAttemptViewModel,
  toProviderAttemptViewModel,
} from "../api/admin-client.js";
import { createAuthClient, type LoginResponse } from "../api/auth-client.js";
import {
  createDomainClient,
  type BalanceSummary as BackendBalanceSummary,
  type CommentModerationSummary as BackendCommentModerationSummary,
  type ConversationSummary,
  type ConversationSummaryStats,
  type CustomerSummary,
  type CustomerSummaryStats,
  type MessageSummary,
  type MessageShortcutSummary,
  type OrderSummaryStats,
  type OrderSummary,
  type ProductSummaryStats,
  type ProductSummary,
  type ReportSummary as BackendReportSummary,
  type ShipmentPipelineSummary,
  type ShipmentPipelineStep,
  type ShipmentSummaryStats,
  type ShipmentSummary,
} from "../api/domain-client.js";
import { createFileClient, type DownloadInstruction, type FileMetadata, type FileOrphanCleanupDryRun } from "../api/file-client.js";
import { createBackendHttpClient } from "../api/http-client.js";
import { createRealtimeClient, type RealtimeClient } from "../api/realtime-client.js";
import { createWebphoneClient, type WebphoneConfig } from "../api/webphone-client.js";

const backendBaseUrl = import.meta.env.VITE_BACKEND_BASE_URL ?? "/backend";
const tokenStorageKey = "garanti.web.access_token";

interface DashboardData {
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

interface PendingAttachment {
  file: File;
  attachment_type: "image" | "video" | "document" | "file";
  preview_url: string;
  file_public_id?: string;
}

interface ShortcutDraft {
  code: string;
  message: string;
  attachments: PendingAttachment[];
}

interface NetgsmConfirmationSettings {
  aktif: boolean;
  ilk_arama_dakika: number;
  max_deneme: number;
  deneme_arasi_dakika: number;
}

interface SipServerSettings {
  ws_url: string;
  domain: string;
  stun: string;
}

interface OperationalPolicySettings {
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

interface BalanceSummary {
  totalCommission: number;
  totalDeduction: number;
  pendingPayment: number;
  availableBalance: number;
  pendingRequestCount: number;
}

interface CommentModerationViewSummary {
  manualQueue: number;
  automaticQueue: number;
  answered: number;
  instagram: number;
  facebook: number;
}

interface InstagramAnalyticsSummary {
  followers: number;
  reach: number;
  impressions: number;
  profileViews: number;
  engagementRate: number;
}

type ShipmentPipelineFilter = "all" | ShipmentPipelineStep;
type ShipmentFilter = "all" | "ptt" | "surat" | "other" | "in_transit" | "delivered" | "tracking_missing";
type OrderSortBy = "created_at" | "order_number" | "status" | "total_amount";
type SortDirection = "asc" | "desc";

interface NavigationItem {
  key: string;
  label: string;
  icon: LucideIcon;
  roles: string[];
  path: string;
}

const navigationItems: NavigationItem[] = [
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
  { key: "integrations", label: "Entegrasyonlar", icon: Settings, roles: ["admin"], path: "/ayarlar/entegrasyonlar" },
  { key: "admin", label: "Ayarlar", icon: Settings, roles: ["admin"], path: "/ayarlar" },
  { key: "files", label: "Dosya", icon: FileUp, roles: ["admin", "calisan"], path: "/dosya" },
  { key: "webphone", label: "Santral", icon: Phone, roles: ["admin"], path: "/santral" },
];

const defaultNetgsmSettings: NetgsmConfirmationSettings = {
  aktif: false,
  ilk_arama_dakika: 5,
  max_deneme: 3,
  deneme_arasi_dakika: 10,
};

const defaultSipServerSettings: SipServerSettings = {
  ws_url: "",
  domain: "",
  stun: "stun:stun.l.google.com:19302",
};

const defaultOperationalPolicy: OperationalPolicySettings = {
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

const smsTemplate = "{musteri_adi}, {takip_no} takip numarali kargonuz {kargo_firmasi} ile yoldadir.";
const smsTemplateVariables = ["{musteri_adi}", "{takip_no}", "{kargo_firmasi}"] as const;
const instagramDraftImageUrl = "https://example.com/garanti-kulucka.jpg";
const instagramDraftCaption = "Kuluçka makineleri ve yedek parça operasyonundan güncel ürün duyurusu.";
const instagramCaptionLimit = 2200;
const shipmentPageSize = 20;

type SmsTemplateVariable = typeof smsTemplateVariables[number];

function flowFromPath(pathname: string) {
  return [...navigationItems]
    .sort((first, second) => second.path.length - first.path.length)
    .find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))?.key ?? "inbox";
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function shipmentFilterParams(filter: string): { provider?: string; status?: string; tracking_missing?: boolean } {
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

function shipmentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    created: "Oluşturuldu",
    olusturuldu: "Oluşturuldu",
    preparing: "Hazırlanıyor",
    hazirlaniyor: "Hazırlanıyor",
    shipped: "Kargoya Verildi",
    kargoya_verildi: "Kargoya Verildi",
    in_transit: "Kargoda",
    dagitimda: "Dağıtımda",
    delivered: "Teslim Edildi",
    teslim_edildi: "Teslim Edildi",
    returned: "İade",
    iade: "İade",
    cancelled: "İptal",
    iptal: "İptal",
  };
  return labels[status] ?? status;
}

function shipmentMatchesFilter(shipment: ShipmentSummary, filter: ShipmentFilter) {
  const provider = shipment.provider.toLocaleLowerCase("tr-TR");
  if (filter === "all") return true;
  if (filter === "ptt") return provider.includes("ptt");
  if (filter === "surat") return provider.includes("sürat") || provider.includes("surat");
  if (filter === "other") return !provider.includes("ptt") && !provider.includes("sürat") && !provider.includes("surat");
  if (filter === "tracking_missing") return !shipment.tracking_number && !shipment.barcode_number;
  return shipment.status === filter;
}

function orderStatusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "Oluşturuldu",
    created: "Oluşturuldu",
    olusturuldu: "Oluşturuldu",
    pending_confirmation: "Teyit Bekliyor",
    teyit_bekliyor: "Teyit Bekliyor",
    confirmed: "Teyit Edildi",
    teyit_edildi: "Teyit Edildi",
    preparing: "Hazırlanıyor",
    hazirlaniyor: "Hazırlanıyor",
    shipped: "Sevk Edildi",
    sevk_edildi: "Sevk Edildi",
    delivered: "Teslim Edildi",
    teslim_edildi: "Teslim Edildi",
    cancelled: "İptal",
    iptal: "İptal",
    returned: "İade",
    iade: "İade",
  };
  return labels[status] ?? status;
}

function cargoProviderLabel(provider: string | null) {
  if (!provider) return "-";
  const normalized = provider.toLocaleLowerCase("tr-TR");
  if (normalized.includes("ptt")) return "PTT";
  if (normalized.includes("sürat") || normalized.includes("surat")) return "Sürat";
  return provider;
}

function readStoredToken() {
  return window.localStorage.getItem(tokenStorageKey);
}

function formatMoney(value: number, currency: string) {
  return `${value.toFixed(2)} ${currency}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function attachmentTypeFromFile(file: File): PendingAttachment["attachment_type"] {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type === "application/pdf") return "document";
  return "file";
}

function attachmentLabel(type: string) {
  if (type === "image") return "Görsel";
  if (type === "video") return "Video";
  if (type === "document") return "PDF";
  return "Dosya";
}

function formatPercent(numerator: number, denominator: number) {
  return denominator > 0 ? `%${Math.round((numerator / denominator) * 100)}` : "%0";
}

const sensitivePreviewKeyPattern = /authorization|token|secret|password|credential|api[_-]?key/i;

function redactedPreviewValue(value: unknown): unknown {
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

function compactJson(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  const serialized = JSON.stringify(redactedPreviewValue(value));
  return serialized.length > 140 ? `${serialized.slice(0, 137)}...` : serialized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inventoryCategoryLabel(category: string | null) {
  switch (category) {
    case "incubator":
      return "Kuluçka Makineleri";
    case "spare_part":
      return "Yedek Parçalar";
    default:
      return "Diğer Malzemeler";
  }
}

const defaultBalanceSummary: BackendBalanceSummary = {
  total_commission: 0,
  total_deduction: 0,
  pending_payment: 0,
  available_balance: 0,
  pending_request_count: 0,
};

const defaultConversationSummary: ConversationSummaryStats = {
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

const defaultCustomerSummary: CustomerSummaryStats = {
  total_count: 0,
  with_phone_count: 0,
  with_email_count: 0,
  with_notes_count: 0,
};

const defaultOrderSummary: OrderSummaryStats = {
  total_count: 0,
  active_count: 0,
  delivered_count: 0,
  pending_confirmation_count: 0,
  total_revenue: 0,
  currency: "TRY",
};

const defaultProductSummary: ProductSummaryStats = {
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

const defaultProviderDebugSummary: ProviderDebugSummary = {
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

function emptyProviderDebug(providerKey: string) {
  return {
    provider_key: providerKey,
    total_attempts: 0,
    success_count: 0,
    failure_count: 0,
    retry_count: 0,
    average_duration_ms: 0,
    latest_attempt: null,
  };
}

const defaultShipmentPipelineSummary: ShipmentPipelineSummary = {
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

const defaultShipmentSummary: ShipmentSummaryStats = {
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

const defaultCommentModerationSummary: BackendCommentModerationSummary = {
  manual_queue: 0,
  automatic_queue: 0,
  answered: 0,
  instagram: 0,
  facebook: 0,
};

const defaultInstagramAnalyticsSummary: BackendInstagramAnalyticsSummary = {
  followers: 0,
  reach: 0,
  impressions: 0,
  profile_views: 0,
  engagement_rate: 0,
};

const defaultReportSummary: BackendReportSummary = {
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

function toInstagramAnalyticsView(summary: BackendInstagramAnalyticsSummary): InstagramAnalyticsSummary {
  return {
    followers: summary.followers,
    reach: summary.reach,
    impressions: summary.impressions,
    profileViews: summary.profile_views,
    engagementRate: summary.engagement_rate,
  };
}

function toCommentModerationView(summary: BackendCommentModerationSummary): CommentModerationViewSummary {
  return {
    manualQueue: summary.manual_queue,
    automaticQueue: summary.automatic_queue,
    answered: summary.answered,
    instagram: summary.instagram,
    facebook: summary.facebook,
  };
}

function toBalanceView(summary: BackendBalanceSummary): BalanceSummary {
  return {
    totalCommission: summary.total_commission,
    totalDeduction: summary.total_deduction,
    pendingPayment: summary.pending_payment,
    availableBalance: summary.available_balance,
    pendingRequestCount: summary.pending_request_count,
  };
}

function smsSegmentInfo(message: string) {
  const usesUnicode = /[şıİŞĞğ]/.test(message);
  const singleLimit = usesUnicode ? 70 : 160;
  const multiLimit = usesUnicode ? 67 : 153;
  const length = message.length;
  const segmentCount = length <= singleLimit ? 1 : Math.ceil(length / multiLimit);
  return { length, segmentCount, usesUnicode };
}

function readNumberSetting(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function netgsmSettingsFrom(settings: AdminSetting[]): NetgsmConfirmationSettings {
  const value = settings.find((setting) => setting.key === "netgsm_teyit_ayarlar")?.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return defaultNetgsmSettings;
  }
  const record = value as Record<string, unknown>;
  return {
    aktif: typeof record.aktif === "boolean" ? record.aktif : defaultNetgsmSettings.aktif,
    ilk_arama_dakika: readNumberSetting(record.ilk_arama_dakika, defaultNetgsmSettings.ilk_arama_dakika),
    max_deneme: readNumberSetting(record.max_deneme, defaultNetgsmSettings.max_deneme),
    deneme_arasi_dakika: readNumberSetting(record.deneme_arasi_dakika, defaultNetgsmSettings.deneme_arasi_dakika),
  };
}

function sipServerSettingsFrom(settings: AdminSetting[], webphoneConfig: WebphoneConfig | null): SipServerSettings {
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

function operationalPolicyFrom(settings: AdminSetting[]): OperationalPolicySettings {
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

export function App() {
  const location = useLocation();
  const publicPage = publicPageFromPath(location.pathname);
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [user, setUser] = useState<LoginResponse["user"] | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [data, setData] = useState<DashboardData>({
    conversations: [],
    customers: [],
    messages: [],
    orders: [],
    products: [],
    shipments: [],
    settings: [],
    integrationAccounts: [],
    settingsAudit: [],
    settingsAuditSummary: { total_count: 0 },
    integrationAudit: [],
    integrationAuditSummary: { total_count: 0 },
    providerCatalog: [],
    providerAttempts: [],
    providerDebugSummary: defaultProviderDebugSummary,
    fileOrphans: [],
    fileOrphanSummary: { total_count: 0 },
    instagramAnalytics: defaultInstagramAnalyticsSummary,
    conversationSummary: defaultConversationSummary,
    customerSummary: defaultCustomerSummary,
    orderSummary: defaultOrderSummary,
    productSummary: defaultProductSummary,
    reportSummary: defaultReportSummary,
    balanceSummary: defaultBalanceSummary,
    shipmentSummary: defaultShipmentSummary,
    shipmentPipeline: defaultShipmentPipelineSummary,
    commentModeration: defaultCommentModerationSummary,
    webphone: null,
  });
  const [status, setStatus] = useState("Hazır");
  const [uploadedFile, setUploadedFile] = useState<FileMetadata | null>(null);
  const [downloadInstruction, setDownloadInstruction] = useState<DownloadInstruction | null>(null);
  const [orphanCleanupPreview, setOrphanCleanupPreview] = useState<FileOrphanCleanupDryRun | null>(null);
  const [lastSmsSend, setLastSmsSend] = useState<string | null>(null);
  const [lastPaymentRequest, setLastPaymentRequest] = useState<string | null>(null);
  const [lastInstagramPublishPreview, setLastInstagramPublishPreview] = useState<string | null>(null);
  const [lastVapiTestCall, setLastVapiTestCall] = useState<string | null>(null);
  const [paymentRequesting, setPaymentRequesting] = useState(false);
  const [instagramPublishPreviewing, setInstagramPublishPreviewing] = useState(false);
  const [vapiTestCalling, setVapiTestCalling] = useState(false);
  const [orphanCleanupPreviewing, setOrphanCleanupPreviewing] = useState(false);
  const [vapiTestCustomerName, setVapiTestCustomerName] = useState("Test Müşteri");
  const [vapiTestPhone, setVapiTestPhone] = useState("05051234567");
  const [cronTriggeringProvider, setCronTriggeringProvider] = useState<"ptt" | "surat" | null>(null);
  const [activeSmsTemplateVariable, setActiveSmsTemplateVariable] = useState<SmsTemplateVariable>("{musteri_adi}");
  const [presenceUpdating, setPresenceUpdating] = useState(false);
  const [integrationSnapshot, setIntegrationSnapshot] = useState<IntegrationAccountSnapshot | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
  const [conversationChannelFilter, setConversationChannelFilter] = useState("all");
  const [conversationStatusFilter, setConversationStatusFilter] = useState("all");
  const [conversationSearch, setConversationSearch] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [messageShortcuts, setMessageShortcuts] = useState<MessageShortcutSummary[]>([]);
  const [shortcutMenuOpen, setShortcutMenuOpen] = useState(false);
  const [shortcutDraft, setShortcutDraft] = useState<ShortcutDraft>({ code: "", message: "", attachments: [] });
  const [editingShortcutId, setEditingShortcutId] = useState<string | null>(null);
  const [conversationNoteDraft, setConversationNoteDraft] = useState("");
  const [customerNoteDraft, setCustomerNoteDraft] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [orderFilter, setOrderFilter] = useState("all");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [orderSourceFilter, setOrderSourceFilter] = useState("all");
  const [orderCargoFilter, setOrderCargoFilter] = useState("all");
  const [orderPersonnelFilter, setOrderPersonnelFilter] = useState("all");
  const [orderCreatedFrom, setOrderCreatedFrom] = useState("");
  const [orderCreatedTo, setOrderCreatedTo] = useState("");
  const [orderSortBy, setOrderSortBy] = useState<OrderSortBy>("created_at");
  const [orderSortDirection, setOrderSortDirection] = useState<SortDirection>("desc");
  const [orderPage, setOrderPage] = useState(0);
  const [orderTotalCount, setOrderTotalCount] = useState(0);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(() => new Set());
  const [shipmentFilter, setShipmentFilter] = useState<ShipmentFilter>("all");
  const [shipmentSearch, setShipmentSearch] = useState("");
  const [shipmentPage, setShipmentPage] = useState(0);
  const [shipmentTotalCount, setShipmentTotalCount] = useState(0);
  const [trackingShipmentId, setTrackingShipmentId] = useState<string | null>(null);
  const [lastShipmentTrack, setLastShipmentTrack] = useState<string | null>(null);
  const [shipmentPipelineFilter, setShipmentPipelineFilter] = useState<ShipmentPipelineFilter>("all");
  const [realtimeClient, setRealtimeClient] = useState<RealtimeClient | null>(null);
  const selectedConversationIdRef = useRef<string | null>(null);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const shortcutMediaInputRef = useRef<HTMLInputElement | null>(null);
  const conversationNoteSaveRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const customerNoteSaveRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const conversationFilterRequestSeqRef = useRef(0);
  const orderFilterRequestSeqRef = useRef(0);
  const shipmentFilterRequestSeqRef = useRef(0);
  const dashboardLoadKeyRef = useRef<string | null>(null);

  const http = useMemo(
    () =>
      createBackendHttpClient({
        baseUrl: backendBaseUrl,
        getAccessToken: () => readStoredToken(),
      }),
    [],
  );
  const auth = useMemo(() => createAuthClient(http), [http]);
  const domain = useMemo(() => createDomainClient(http), [http]);
  const admin = useMemo(() => createAdminClient(http), [http]);
  const files = useMemo(() => createFileClient(http), [http]);
  const webphone = useMemo(() => createWebphoneClient(http), [http]);

  const refreshConversations = useCallback(async () => {
    const conversations = await domain.listConversations({ limit: 20 });
    setData((current) => ({
      ...current,
      conversations: conversations.data,
    }));
  }, [domain]);

  const refreshMessages = useCallback(async (conversationPublicId: string) => {
    const messages = await domain.listMessages(conversationPublicId, 50);
    setData((current) => ({
      ...current,
      messages: selectedConversationIdRef.current === conversationPublicId ? messages.data : current.messages,
    }));
  }, [domain]);

  const refreshShipments = useCallback(async (options: { page?: number; filter?: ShipmentFilter; search?: string } = {}) => {
    const nextPage = options.page ?? shipmentPage;
    const nextFilter = options.filter ?? shipmentFilter;
    const nextSearch = options.search ?? shipmentSearch;
    const trimmedSearch = nextSearch.trim();
    const shipments = await domain.listShipments({
      ...shipmentFilterParams(nextFilter),
      ...(trimmedSearch ? { search: trimmedSearch } : {}),
      limit: shipmentPageSize,
      offset: nextPage * shipmentPageSize,
    });
    setData((current) => ({
      ...current,
      shipments: shipments.data,
    }));
    setShipmentTotalCount(shipments.meta?.total_count ?? shipments.data.length);
    setSelectedShipmentId((current) => shipments.data.some((shipment) => shipment.public_id === current)
      ? current
      : shipments.data[0]?.public_id ?? null);
    return shipments;
  }, [domain, shipmentFilter, shipmentPage, shipmentSearch]);

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  useEffect(() => {
    if (!token || !authChecked || !user) {
      setRealtimeClient(null);
      return;
    }

    const realtime = createRealtimeClient({
      baseUrl: backendBaseUrl,
      getAccessToken: () => readStoredToken(),
    });
    const offMessageCreated = realtime.on("message.created", (envelope) => {
      const conversationPublicId = String(envelope.payload.conversation_public_id ?? "");
      if (!conversationPublicId) return;

      void (async () => {
        await refreshConversations();
        if (selectedConversationIdRef.current === conversationPublicId) {
          await refreshMessages(conversationPublicId);
          setStatus("Yeni mesaj Socket.IO üzerinden alındı");
        } else {
          setStatus("Yeni konuşma bildirimi Socket.IO üzerinden alındı");
        }
      })();
    });
    const offConversationUpdated = realtime.on("conversation.updated", (envelope) => {
      const conversationPublicId = String(envelope.payload.conversation_public_id ?? "");
      if (!conversationPublicId) return;

      void (async () => {
        await refreshConversations();
        if (selectedConversationIdRef.current === conversationPublicId) {
          setStatus("Konuşma durumu Socket.IO üzerinden yenilendi");
        }
      })();
    });
    const offShipmentUpdated = realtime.on("shipment.updated", () => {
      void (async () => {
        await refreshShipments();
        setStatus("Kargo güncellemesi Socket.IO üzerinden yenilendi");
      })();
    });

    realtime.connect();
    setRealtimeClient(realtime);

    return () => {
      offMessageCreated();
      offConversationUpdated();
      offShipmentUpdated();
      realtime.disconnect();
      setRealtimeClient((current) => (current === realtime ? null : current));
    };
  }, [authChecked, refreshConversations, refreshMessages, refreshShipments, token, user]);

  useEffect(() => {
    if (!realtimeClient || !selectedConversationId) return;

    realtimeClient.joinConversation(selectedConversationId);
    return () => realtimeClient.leaveConversation(selectedConversationId);
  }, [realtimeClient, selectedConversationId]);

  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      if (!token) {
        setAuthChecked(true);
        return;
      }

      try {
        const currentUser = await auth.me();
        if (!cancelled) {
          setUser(currentUser);
          setAuthChecked(true);
        }
      } catch {
        window.localStorage.removeItem(tokenStorageKey);
        if (!cancelled) {
          setToken(null);
          setUser(null);
          setAuthChecked(true);
        }
      }
    }

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, [auth, token]);

  useEffect(() => {
    if (!token || !authChecked || !user) return;
    const loadKey = `${token}:${user.public_id}`;
    if (dashboardLoadKeyRef.current === loadKey) return;
    dashboardLoadKeyRef.current = loadKey;
    void loadDashboard();
  }, [authChecked, token, user]);

  async function loadDashboard() {
    setStatus("Backend API akışları yükleniyor");
    const canReadCustomers = user?.role === "admin" || user?.role === "owner" || user?.role === "calisan";
    const canReadComments = user?.role === "admin" || user?.role === "owner" || user?.role === "calisan";
    const canReadBalances = user?.role === "admin" || user?.role === "owner" || user?.role === "calisan";
    const canReadShipmentPipeline = ["admin", "owner", "calisan", "kargo_operatoru"].includes(user?.role ?? "");
    const optional = async <T,>(label: string, request: Promise<T>, fallback: T): Promise<T> => {
      try {
        return await request;
      } catch (error) {
        console.warn(`[Dashboard] Optional ${label} request failed`, error);
        return fallback;
      }
    };
    const [conversations, conversationSummary, customers, customerSummary, commentModeration, balanceSummary, orderSummary, productSummary, shipmentSummary, shipmentPipeline, reportSummary, orders, products, shipments, shortcuts, settings, webphoneConfig] = await Promise.all([
      domain.listConversations({ limit: 20 }),
      domain.getConversationSummary(),
      canReadCustomers ? domain.listCustomers(50) : Promise.resolve({ data: [] }),
      canReadCustomers ? domain.getCustomerSummary() : Promise.resolve(defaultCustomerSummary),
      canReadComments ? domain.getCommentModerationSummary() : Promise.resolve(defaultCommentModerationSummary),
      canReadBalances ? domain.getBalanceSummary() : Promise.resolve(defaultBalanceSummary),
      domain.getOrderSummary(),
      domain.getProductSummary(),
      domain.getShipmentSummary(),
      canReadShipmentPipeline ? domain.getShipmentPipelineSummary() : Promise.resolve(defaultShipmentPipelineSummary),
      user?.role === "admin" ? domain.getReportSummary() : Promise.resolve(defaultReportSummary),
      domain.listOrders(20),
      domain.listProducts(50),
      domain.listShipments(20),
      canReadCustomers ? optional("message shortcuts", domain.listMessageShortcuts(), { data: [] }) : Promise.resolve({ data: [] }),
      user?.role === "admin" ? admin.listSettings("global") : Promise.resolve({ data: [] }),
      webphone.getConfig(),
    ]);
    const [integrationAccounts, providerCatalog, providerAttempts, providerDebugSummary, settingsAudit, integrationAudit, fileOrphans] = user?.role === "admin"
      ? await Promise.all([
          admin.listIntegrationAccounts(),
          admin.listProviderCatalog(),
          admin.listProviderAttempts({ limit: 10 }),
          admin.getProviderDebugSummary(),
          admin.listSettingsAudit({ limit: 10 }),
          admin.listIntegrationAudit({ limit: 10 }),
          files.listOrphanCandidates({ limit: 10 }),
        ])
      : [
          { data: [] },
          { data: [] },
          { data: [] },
          defaultProviderDebugSummary,
          { data: [], summary: { total_count: 0 } },
          { data: [], summary: { total_count: 0 } },
          { data: [], summary: { total_count: 0 } },
        ];
    const firstConversation = conversations.data[0]?.public_id;
    const messages = firstConversation
      ? await domain.listMessages(firstConversation, 50)
      : { data: [] };
    const firstIntegrationAccountPublicId = integrationAccounts.data[0]?.public_id;
    const instagramAnalytics = user?.role === "admin" && firstIntegrationAccountPublicId
      ? await admin.getInstagramAnalyticsSummary(firstIntegrationAccountPublicId)
      : defaultInstagramAnalyticsSummary;

    setData({
      conversations: conversations.data,
      customers: customers.data,
      messages: messages.data,
      orders: orders.data,
      products: products.data,
      shipments: shipments.data,
      settings: settings.data,
      integrationAccounts: integrationAccounts.data,
      settingsAudit: settingsAudit.data,
      settingsAuditSummary: settingsAudit.summary ?? { total_count: settingsAudit.data.length },
      integrationAudit: integrationAudit.data,
      integrationAuditSummary: integrationAudit.summary ?? { total_count: integrationAudit.data.length },
      providerCatalog: providerCatalog.data,
      providerAttempts: providerAttempts.data.map(toProviderAttemptViewModel),
      providerDebugSummary,
      fileOrphans: fileOrphans.data,
      fileOrphanSummary: fileOrphans.summary ?? { total_count: fileOrphans.data.length },
      instagramAnalytics,
      conversationSummary,
      customerSummary,
      orderSummary,
      productSummary,
      reportSummary,
      balanceSummary,
      shipmentSummary,
      shipmentPipeline,
      commentModeration,
      webphone: webphoneConfig,
    });
    setMessageShortcuts(shortcuts.data);
    setSelectedConversationId((current) => current ?? firstConversation ?? null);
    setSelectedOrderId((current) => current ?? orders.data[0]?.public_id ?? null);
    setSelectedShipmentId((current) => current ?? shipments.data[0]?.public_id ?? null);
    setOrderTotalCount(orders.meta?.total_count ?? orders.data.length);
    setShipmentTotalCount(shipments.meta?.total_count ?? shipments.data.length);
    setStatus("Backend API, presigned dosya ve Socket.IO sınırları aktif");
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setStatus("Giriş yapılıyor");
    const response = await auth.login(email, password);
    window.localStorage.setItem(tokenStorageKey, response.access_token);
    setToken(response.access_token);
    setUser(response.user);
    setStatus("Oturum backend auth üzerinden açıldı");
  }

  async function handleLogout() {
    setStatus("Çıkış yapılıyor");
    try {
      await auth.logout();
    } finally {
      window.localStorage.removeItem(tokenStorageKey);
      dashboardLoadKeyRef.current = null;
      setToken(null);
      setUser(null);
      setData({
        conversations: [],
        customers: [],
        messages: [],
        orders: [],
        products: [],
        shipments: [],
        settings: [],
        integrationAccounts: [],
        settingsAudit: [],
        settingsAuditSummary: { total_count: 0 },
        integrationAudit: [],
        integrationAuditSummary: { total_count: 0 },
        providerCatalog: [],
        providerAttempts: [],
        providerDebugSummary: defaultProviderDebugSummary,
        fileOrphans: [],
        fileOrphanSummary: { total_count: 0 },
        instagramAnalytics: defaultInstagramAnalyticsSummary,
        conversationSummary: defaultConversationSummary,
        customerSummary: defaultCustomerSummary,
        orderSummary: defaultOrderSummary,
        productSummary: defaultProductSummary,
        reportSummary: defaultReportSummary,
        balanceSummary: defaultBalanceSummary,
        shipmentSummary: defaultShipmentSummary,
        shipmentPipeline: defaultShipmentPipelineSummary,
        commentModeration: defaultCommentModerationSummary,
        webphone: null,
      });
      setIntegrationSnapshot(null);
      setSelectedConversationId(null);
      setSelectedOrderId(null);
      setSelectedShipmentId(null);
      setShipmentFilter("all");
      setShipmentSearch("");
      setShipmentPage(0);
      setShipmentTotalCount(0);
      setTrackingShipmentId(null);
      setLastShipmentTrack(null);
      setMessageShortcuts([]);
      setPendingAttachments([]);
      setShortcutMenuOpen(false);
      setShortcutDraft({ code: "", message: "", attachments: [] });
      setEditingShortcutId(null);
      setAiSuggestion(null);
      setAuthChecked(true);
      setStatus("Oturum kapatıldı");
    }
  }

  async function handleUpload() {
    setStatus("Presigned upload instruction isteniyor");
    const response = await files.createUpload({
      original_name: "kanit.txt",
      mime_type: "text/plain",
      byte_size: 11,
      checksum: "niECqdXA95O1DqUepmPprCpbQW93H7pd34A88B3v5xU=",
    });

    if (response.upload.presigned_url) {
      await fetch(response.upload.presigned_url, {
        method: response.upload.method,
        headers: response.upload.headers,
        body: "frontend-ok",
      });
    }

    const verifiedFile = await files.getFile(response.file.public_id);
    setUploadedFile(verifiedFile);
    const download = await files.createDownload(verifiedFile.public_id);
    if (download.download.presigned_url) {
      await fetch(download.download.presigned_url, {
        method: download.download.method,
        headers: download.download.headers,
      });
    }
    setDownloadInstruction(download.download);
    setStatus("Dosya akışı presigned S3 sınırından geçti");
  }

  async function handlePrepareOrphanCleanupDryRun() {
    const orphan = data.fileOrphans[0];
    if (!orphan || orphanCleanupPreviewing) return;

    setStatus("Orphan dosya lifecycle dry-run backend API üzerinden hazırlanıyor");
    setOrphanCleanupPreviewing(true);
    try {
      const preview = await files.createOrphanCleanupDryRun(orphan.public_id);
      setOrphanCleanupPreview(preview);
      setStatus("Orphan cleanup dry-run canlı silme yapmadan hazırlandı");
    } finally {
      setOrphanCleanupPreviewing(false);
    }
  }

  async function handleSendMessage() {
    const conversationId = selectedConversation?.public_id ?? data.conversations[0]?.public_id;
    const body = messageDraft.trim();
    if (!conversationId || (!body && pendingAttachments.length === 0)) return;

    setStatus("Mesaj backend API üzerinden gönderiliyor");
    const uploadedAttachments = await Promise.all(
      pendingAttachments.map(async (attachment) => {
        if (attachment.file_public_id) {
          return {
            file_public_id: attachment.file_public_id,
            attachment_type: attachment.attachment_type,
          };
        }
        const file = await files.uploadBrowserFile(attachment.file);
        return {
          file_public_id: file.public_id,
          attachment_type: attachment.attachment_type,
        };
      }),
    );
    const message = await domain.createMessage(conversationId, {
      sender_type: "user",
      sender_name: user?.email ?? "Admin",
      body: body || null,
      external_message_id: null,
      raw_payload: null,
      attachments: uploadedAttachments,
    });
    setMessageDraft("");
    for (const attachment of pendingAttachments) {
      URL.revokeObjectURL(attachment.preview_url);
    }
    setPendingAttachments([]);
    setData((current) => ({
      ...current,
      messages: [
        ...current.messages.filter((item) => item.public_id !== message.public_id),
        message,
      ],
    }));
    await refreshConversations();
    await refreshMessages(conversationId);
    setStatus("Mesaj backend API üzerinden gönderildi");
  }

  function handlePickMessageFiles(filesList: FileList | null) {
    const picked = Array.from(filesList ?? []).map((file) => ({
      file,
      attachment_type: attachmentTypeFromFile(file),
      preview_url: URL.createObjectURL(file),
    }));
    setPendingAttachments((current) => [...current, ...picked].slice(0, 10));
  }

  function handlePickShortcutFiles(filesList: FileList | null) {
    const picked = Array.from(filesList ?? []).map((file) => ({
      file,
      attachment_type: attachmentTypeFromFile(file),
      preview_url: URL.createObjectURL(file),
    }));
    setShortcutDraft((current) => ({
      ...current,
      attachments: [...current.attachments, ...picked].slice(0, 10),
    }));
  }

  async function handleSaveShortcut() {
    const code = shortcutDraft.code.trim();
    const message = shortcutDraft.message.trim();
    if (!code || (!message && shortcutDraft.attachments.length === 0)) return;

    setStatus("Kısayol backend API üzerinden kaydediliyor");
    const attachments = await Promise.all(
      shortcutDraft.attachments.map(async (attachment) => {
        if (attachment.file_public_id) {
          return {
            file_public_id: attachment.file_public_id,
            attachment_type: attachment.attachment_type,
          };
        }
        const file = await files.uploadBrowserFile(attachment.file);
        return {
          file_public_id: file.public_id,
          attachment_type: attachment.attachment_type,
        };
      }),
    );
    const shortcut = editingShortcutId
      ? await domain.updateMessageShortcut(editingShortcutId, {
          code,
          message: message || null,
          attachments,
        })
      : await domain.createMessageShortcut({
          code,
          message: message || null,
          type: "custom",
          attachments,
        });
    const shortcutWithLocalAttachmentNames = {
      ...shortcut,
      attachments: shortcut.attachments.map((attachment, index) => {
        const localAttachment = shortcutDraft.attachments[index];
        return {
          ...attachment,
          original_name: attachment.original_name ?? localAttachment?.file.name ?? null,
          mime_type: attachment.mime_type ?? localAttachment?.file.type ?? null,
          byte_size: attachment.byte_size ?? localAttachment?.file.size ?? null,
        };
      }),
    };
    for (const attachment of shortcutDraft.attachments) {
      URL.revokeObjectURL(attachment.preview_url);
    }
    setMessageShortcuts((current) => [
      shortcutWithLocalAttachmentNames,
      ...current.filter((item) => item.public_id !== shortcutWithLocalAttachmentNames.public_id),
    ].sort((first, second) => first.sort_order - second.sort_order || first.code.localeCompare(second.code, "tr")));
    setShortcutDraft({ code: "", message: "", attachments: [] });
    setEditingShortcutId(null);
    setStatus("Kısayol kaydedildi");
  }

  async function handleDeleteShortcut(shortcutPublicId: string) {
    setStatus("Kısayol backend API üzerinden siliniyor");
    await domain.deleteMessageShortcut(shortcutPublicId);
    setMessageShortcuts((current) => current.filter((shortcut) => shortcut.public_id !== shortcutPublicId));
    setStatus("Kısayol silindi");
  }

  function handleUseShortcut(shortcut: MessageShortcutSummary) {
    setMessageDraft(shortcut.message ?? "");
    setPendingAttachments((current) => {
      for (const attachment of current) {
        URL.revokeObjectURL(attachment.preview_url);
      }
      return shortcut.attachments.map((attachment) => ({
        file: new File([], attachment.original_name ?? attachment.file_public_id, {
          type: attachment.mime_type ?? "application/octet-stream",
        }),
        file_public_id: attachment.file_public_id,
        attachment_type: attachment.attachment_type,
        preview_url: "",
      }));
    });
    setShortcutMenuOpen(false);
  }

  function handleEditShortcut(shortcut: MessageShortcutSummary) {
    setEditingShortcutId(shortcut.public_id);
    setShortcutDraft({
      code: shortcut.code,
      message: shortcut.message ?? "",
      attachments: shortcut.attachments.map((attachment) => ({
        file: new File([], attachment.original_name ?? attachment.file_public_id, {
          type: attachment.mime_type ?? "application/octet-stream",
        }),
        file_public_id: attachment.file_public_id,
        attachment_type: attachment.attachment_type,
        preview_url: "",
      })),
    });
  }

  async function handleDownloadShortcutAttachment(shortcut: MessageShortcutSummary) {
    const first = shortcut.attachments[0];
    if (!first) return;
    setStatus("Kısayol medyası indiriliyor");
    try {
      const response = await files.createDownload(first.file_public_id);
      if (response.download.presigned_url) {
        const link = document.createElement("a");
        link.href = response.download.presigned_url;
        link.download = first.original_name ?? `${shortcut.code}.${first.attachment_type}`;
        link.click();
      }
    } catch (error) {
      console.warn("[Messages] Shortcut download request failed", error);
    }
  }

  function handleConversationNoteChange(value: string) {
    setConversationNoteDraft(value);
    if (!selectedConversation?.public_id) return;
    if (conversationNoteSaveRef.current) {
      window.clearTimeout(conversationNoteSaveRef.current);
    }
    const conversationPublicId = selectedConversation.public_id;
    conversationNoteSaveRef.current = window.setTimeout(() => {
      void (async () => {
        const conversation = await domain.updateConversationNotes(conversationPublicId, value.trim() || null);
        setData((current) => ({
          ...current,
          conversations: current.conversations.map((item) =>
            item.public_id === conversation.public_id ? conversation : item
          ),
        }));
        setStatus("Konuşma notu otomatik kaydedildi");
      })();
    }, 500);
  }

  function handleCustomerNoteChange(value: string) {
    setCustomerNoteDraft(value);
    if (!selectedConversation?.public_id) return;
    if (customerNoteSaveRef.current) {
      window.clearTimeout(customerNoteSaveRef.current);
    }
    const conversationPublicId = selectedConversation.public_id;
    customerNoteSaveRef.current = window.setTimeout(() => {
      void (async () => {
        const customer = await domain.updateCustomerNotes(conversationPublicId, value.trim() || null);
        setData((current) => ({
          ...current,
          customers: [
            customer,
            ...current.customers.filter((item) => item.public_id !== customer.public_id),
          ],
        }));
        setStatus("Müşteri notu otomatik kaydedildi");
      })();
    }, 500);
  }

  async function handleAiSuggestion() {
    const conversationId = selectedConversation?.public_id;
    if (!conversationId) return;
    setStatus("AI yanıt önerisi backend dry-run sınırında hazırlanıyor");
    const response = await domain.createAiReplySuggestion(conversationId);
    setAiSuggestion(response.suggestion);
    setStatus("AI yanıt önerisi dry-run olarak hazırlandı");
  }

  async function handleUpdateConversationState(input: {
    status?: string;
    unread_count?: number;
    human_agent_enabled?: boolean;
    is_in_pool?: boolean;
    assign_to_me?: boolean;
  }) {
    const conversationId = selectedConversation?.public_id;
    if (!conversationId) return;

    setStatus("Konuşma durumu backend API üzerinden güncelleniyor");
    const conversation = await domain.updateConversationState(conversationId, input);
    setData((current) => ({
      ...current,
      conversations: current.conversations.map((item) =>
        item.public_id === conversation.public_id ? conversation : item
      ),
    }));
    setSelectedConversationId(conversation.public_id);
    selectedConversationIdRef.current = conversation.public_id;
    setStatus("Konuşma durumu backend API üzerinden güncellendi");
  }

  async function handleApplyConversationFilters(nextChannel: string, nextStatus: string) {
    const requestSeq = conversationFilterRequestSeqRef.current + 1;
    conversationFilterRequestSeqRef.current = requestSeq;
    setConversationChannelFilter(nextChannel);
    setConversationStatusFilter(nextStatus);
    setStatus("Konuşma filtreleri backend API üzerinden uygulanıyor");
    const filterParams: { channel?: string; status?: string; limit: number } = { limit: 20 };
    if (nextChannel !== "all") {
      filterParams.channel = nextChannel === "facebook" ? "facebook,messenger" : nextChannel;
    }
    if (nextStatus !== "all") {
      filterParams.status = nextStatus;
    }
    const conversations = await domain.listConversations(filterParams);
    if (conversationFilterRequestSeqRef.current !== requestSeq) return;
    setData((current) => ({
      ...current,
      conversations: conversations.data,
    }));
    setSelectedConversationId(conversations.data[0]?.public_id ?? null);
    selectedConversationIdRef.current = conversations.data[0]?.public_id ?? null;
    if (conversations.data[0]) {
      await refreshMessages(conversations.data[0].public_id);
      if (conversationFilterRequestSeqRef.current !== requestSeq) return;
    } else {
      setData((current) => ({ ...current, messages: [] }));
    }
    setStatus("Konuşma filtreleri backend API üzerinden uygulandı");
  }

  function orderListParams(overrides: Partial<{
    status: string;
    confirmation_status: string;
    search: string;
    source: string;
    cargo_provider: string;
    created_by_user_public_id: string;
    created_from: string;
    created_to: string;
    sort_by: OrderSortBy;
    sort_direction: SortDirection;
    page: number;
    limit: number;
  }> = {}) {
    const status = overrides.status ?? orderStatusFilter;
    const source = overrides.source ?? orderSourceFilter;
    const cargoProvider = overrides.cargo_provider ?? orderCargoFilter;
    const personnel = overrides.created_by_user_public_id ?? orderPersonnelFilter;
    const search = overrides.search ?? orderSearch;
    const createdFrom = overrides.created_from ?? orderCreatedFrom;
    const createdTo = overrides.created_to ?? orderCreatedTo;
    const sortBy = overrides.sort_by ?? orderSortBy;
    const sortDirection = overrides.sort_direction ?? orderSortDirection;
    const page = overrides.page ?? orderPage;
    const limit = overrides.limit ?? 20;
    const params: Parameters<typeof domain.listOrders>[0] = {
      limit,
      offset: page * limit,
      sort_by: sortBy,
      sort_direction: sortDirection,
    };
    if (status !== "all") params.status = status;
    if (overrides.confirmation_status) params.confirmation_status = overrides.confirmation_status;
    if (source !== "all") params.source = source;
    if (cargoProvider !== "all") params.cargo_provider = cargoProvider;
    if (personnel !== "all") params.created_by_user_public_id = personnel;
    if (search.trim()) params.search = search.trim();
    if (createdFrom) params.created_from = createdFrom;
    if (createdTo) params.created_to = createdTo;
    return params;
  }

  async function refreshOrders(overrides: Parameters<typeof orderListParams>[0] = {}) {
    await refreshOrdersWithParams(orderListParams(overrides));
  }

  async function refreshOrdersWithParams(params: Parameters<typeof domain.listOrders>[0]) {
    const requestSeq = orderFilterRequestSeqRef.current + 1;
    orderFilterRequestSeqRef.current = requestSeq;
    setStatus("Sipariş filtreleri backend API üzerinden uygulanıyor");
    const orders = await domain.listOrders(params);
    if (orderFilterRequestSeqRef.current !== requestSeq) return;
    setData((current) => ({
      ...current,
      orders: orders.data,
    }));
    setOrderTotalCount(orders.meta?.total_count ?? orders.data.length);
    setSelectedOrderId(orders.data[0]?.public_id ?? null);
    setSelectedOrderIds(new Set());
    setStatus("Sipariş filtreleri backend API üzerinden uygulandı");
  }

  async function handleApplyOrderFilter(nextFilter: string) {
    setOrderFilter(nextFilter);
    setOrderPage(0);
    setOrderStatusFilter("all");
    let params: Parameters<typeof domain.listOrders>[0] = { limit: 20 };
    if (nextFilter === "active") {
      setOrderStatusFilter("active");
      params = { status: "active", limit: 20 };
    }
    if (nextFilter === "pending_confirmation") {
      params = { confirmation_status: "pending", limit: 20 };
    }
    if (nextFilter === "delivered") {
      setOrderStatusFilter("delivered");
      params = { status: "delivered", limit: 20 };
    }
    await refreshOrdersWithParams(params);
  }

  async function handleApplyOrderAdvancedFilters() {
    setOrderFilter("custom");
    setOrderPage(0);
    await refreshOrders({ page: 0, confirmation_status: "" });
  }

  async function handleOrderPage(nextPage: number) {
    const boundedPage = Math.max(0, nextPage);
    setOrderPage(boundedPage);
    await refreshOrders({ page: boundedPage, confirmation_status: orderFilter === "pending_confirmation" ? "pending" : "" });
  }

  async function handleOrderSort(nextSortBy: OrderSortBy) {
    const nextDirection: SortDirection = orderSortBy === nextSortBy && orderSortDirection === "desc" ? "asc" : "desc";
    setOrderSortBy(nextSortBy);
    setOrderSortDirection(nextDirection);
    setOrderPage(0);
    await refreshOrders({
      page: 0,
      sort_by: nextSortBy,
      sort_direction: nextDirection,
      confirmation_status: orderFilter === "pending_confirmation" ? "pending" : "",
    });
  }

  async function handleApplyShipmentFilter(nextFilter: ShipmentFilter) {
    const requestSeq = shipmentFilterRequestSeqRef.current + 1;
    shipmentFilterRequestSeqRef.current = requestSeq;
    setShipmentFilter(nextFilter);
    setShipmentPage(0);
    setStatus("Kargo filtreleri backend API üzerinden uygulanıyor");
    const trimmedSearch = shipmentSearch.trim();
    const shipments = await domain.listShipments({
      ...shipmentFilterParams(nextFilter),
      ...(trimmedSearch ? { search: trimmedSearch } : {}),
      limit: shipmentPageSize,
      offset: 0,
    });
    if (shipmentFilterRequestSeqRef.current !== requestSeq) return;
    setData((current) => ({
      ...current,
      shipments: shipments.data,
    }));
    setShipmentTotalCount(shipments.meta?.total_count ?? shipments.data.length);
    setSelectedShipmentId(shipments.data[0]?.public_id ?? null);
    setStatus("Kargo filtreleri backend API üzerinden uygulandı");
  }

  async function handleSearchShipments(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestSeq = shipmentFilterRequestSeqRef.current + 1;
    shipmentFilterRequestSeqRef.current = requestSeq;
    setShipmentPage(0);
    setStatus("Kargo araması backend API üzerinden uygulanıyor");
    const shipments = await refreshShipments({ page: 0 });
    if (shipmentFilterRequestSeqRef.current !== requestSeq) return;
    setSelectedShipmentId(shipments.data[0]?.public_id ?? null);
    setStatus("Kargo araması backend API üzerinden uygulandı");
  }

  async function handleShipmentPage(nextPage: number) {
    const boundedPage = Math.max(0, nextPage);
    const requestSeq = shipmentFilterRequestSeqRef.current + 1;
    shipmentFilterRequestSeqRef.current = requestSeq;
    setShipmentPage(boundedPage);
    setStatus("Kargo sayfası backend API üzerinden yükleniyor");
    const shipments = await refreshShipments({ page: boundedPage });
    if (shipmentFilterRequestSeqRef.current !== requestSeq) return;
    setSelectedShipmentId(shipments.data[0]?.public_id ?? null);
    setStatus("Kargo sayfası backend API üzerinden yüklendi");
  }

  async function handleOpenShipmentDetail(shipmentPublicId: string) {
    setSelectedShipmentId(shipmentPublicId);
    setStatus("Kargo detayı backend API üzerinden yükleniyor");
    try {
      const shipment = await domain.getShipment(shipmentPublicId);
      setData((current) => ({
        ...current,
        shipments: current.shipments.map((item) => (item.public_id === shipment.public_id ? shipment : item)),
      }));
      setStatus("Kargo detayı ve hareket geçmişi backend API üzerinden yüklendi");
    } catch {
      setStatus("Kargo detayı listeden açıldı; backend detay yanıtı bekleniyor");
    }
  }

  function handleApplyShipmentPipelineFilter(nextFilter: ShipmentPipelineFilter) {
    setShipmentPipelineFilter(nextFilter);
    setStatus("Kargo pipeline legacy sekmesi backend shipments verisiyle uygulandı");
  }

  async function handleSelectConversation(conversationPublicId: string) {
    selectedConversationIdRef.current = conversationPublicId;
    setSelectedConversationId(conversationPublicId);
    setStatus("Konuşma mesajları backend API üzerinden yükleniyor");
    await refreshMessages(conversationPublicId);
    setStatus("Konuşma detayı backend API üzerinden yüklendi");
  }

  async function handleCreateOrder(source: "orders" | "conversation" = "orders") {
    setStatus("Sipariş backend API üzerinden oluşturuluyor");
    const order = await domain.createOrder({
      customer_public_id: null,
      conversation_public_id: selectedConversation?.public_id ?? data.conversations[0]?.public_id ?? null,
      order_number: source === "conversation" ? "ORD-WEB-CHAT" : "ORD-WEB-NEW",
      status: "draft",
      source: "manual",
      total_amount: "250.00",
      currency: "TRY",
      notes: source === "conversation" ? "Frontend conversation order smoke" : "Frontend backend create smoke",
    });
    setData((current) => ({
      ...current,
      orders: [order, ...current.orders],
    }));
    setSelectedOrderId(order.public_id);
    setStatus("Sipariş backend API üzerinden oluşturuldu");
  }

  function toggleOrderSelection(orderPublicId: string) {
    setSelectedOrderIds((current) => {
      const next = new Set(current);
      if (next.has(orderPublicId)) next.delete(orderPublicId);
      else next.add(orderPublicId);
      return next;
    });
  }

  function toggleAllVisibleOrders() {
    setSelectedOrderIds((current) => {
      const visibleIds = data.orders.map((order) => order.public_id);
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => current.has(id));
      if (allSelected) return new Set([...current].filter((id) => !visibleIds.includes(id)));
      return new Set([...current, ...visibleIds]);
    });
  }

  function downloadOrderExcel(rows: OrderSummary[], format: "liste" | "telefon") {
    const headers = format === "telefon"
      ? ["İsim", "Telefon"]
      : ["Sipariş No", "Müşteri", "Durum", "Kaynak", "Kargo", "Personel", "Tutar", "Tarih"];
    const bodyRows = rows.map((order) => format === "telefon"
      ? [order.customer_full_name ?? order.order_number, ""]
      : [
          order.order_number,
          order.customer_full_name ?? "",
          orderStatusLabel(order.status),
          order.source,
          cargoProviderLabel(order.cargo_provider),
          order.created_by_user_email ?? "",
          `${order.total_amount} ${order.currency}`,
          new Date(order.created_at).toLocaleDateString("tr-TR"),
        ]);
    const escapeCell = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const tableRows = [headers, ...bodyRows]
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeCell(String(cell))}</td>`).join("")}</tr>`)
      .join("");
    const blob = new Blob(
      [`<html><head><meta charset="utf-8" /></head><body><table>${tableRows}</table></body></html>`],
      { type: "application/vnd.ms-excel;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `siparisler-${format}-${new Date().toISOString().slice(0, 10)}.xls`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportOrders(scope: "current" | "selected" | "all") {
    const selectedRows = data.orders.filter((order) => selectedOrderIds.has(order.public_id));
    if (scope === "selected") {
      downloadOrderExcel(selectedRows, "liste");
      setStatus(`${selectedRows.length} seçili sipariş Excel olarak indirildi`);
      return;
    }
    if (scope === "current") {
      downloadOrderExcel(data.orders, "liste");
      setStatus(`${data.orders.length} görünür sipariş Excel olarak indirildi`);
      return;
    }
    const orders = await domain.listOrders(orderListParams({ page: 0, limit: 200, confirmation_status: orderFilter === "pending_confirmation" ? "pending" : "" }));
    downloadOrderExcel(orders.data, "liste");
    setStatus(`${orders.data.length} filtrelenmiş sipariş Excel olarak indirildi`);
  }

  async function handleCancelSelectedOrder() {
    const order = selectedOrder;
    if (!order) return;

    setStatus("İptal durumu backend API üzerinden güncelleniyor");
    const updated = await domain.updateOrderStatus(order.public_id, {
      status: "cancelled",
      notes: "Frontend iptal inceleme onayi",
    });
    setData((current) => ({
      ...current,
      orders: current.orders.map((item) => (item.public_id === updated.public_id ? updated : item)),
    }));
    setSelectedOrderId(updated.public_id);
    setStatus("İptal durumu backend API üzerinden güncellendi");
  }

  async function handleRequestPayment() {
    const order = selectedOrder;
    if (!order || paymentRequesting) return;

    setStatus("Ödeme isteği backend API üzerinden hazırlanıyor");
    setPaymentRequesting(true);
    try {
      const result = await domain.requestPayment(order.public_id, {
        amount: balanceSummary.pendingPayment.toFixed(2),
        currency: data.orderSummary.currency,
        idempotency_key: `payment_${order.public_id}_${balanceSummary.pendingPayment.toFixed(2)}_${data.orderSummary.currency}`,
      });
      setData((current) => ({
        ...current,
        orders: current.orders.map((item) => (item.public_id === result.order.public_id ? result.order : item)),
      }));
      setSelectedOrderId(result.order.public_id);
      setLastPaymentRequest(`${result.operation} ${result.request_id}${result.replayed ? " replay" : ""}`);
      setStatus("Ödeme isteği backend API sınırında hazırlandı");
    } finally {
      setPaymentRequesting(false);
    }
  }

  async function handleTriggerProviderCron(providerKey: "ptt" | "surat") {
    if (cronTriggeringProvider) return;

    setStatus(`${providerKey.toUpperCase()} cron debug backend API üzerinden hazırlanıyor`);
    setCronTriggeringProvider(providerKey);
    try {
      const attempt = await admin.triggerProviderCronDebug(providerKey, {
        idempotency_key: `cron_debug_${providerKey}_manual`,
      });
      setData((current) => ({
        ...current,
        providerAttempts: [
          toProviderAttemptViewModel(attempt),
          ...current.providerAttempts.filter((item) => item.public_id !== attempt.public_id),
        ],
      }));
      setStatus(`${providerKey.toUpperCase()} cron debug canlı provider kapalıyken kaydedildi`);
    } finally {
      setCronTriggeringProvider(null);
    }
  }

  async function handleSendSms() {
    const shipment = selectedShipment;
    if (!shipment?.recipient_phone) return;

    setStatus("SMS backend provider-delivery kuyruğuna gönderiliyor");
    const result = await domain.sendSms({
      recipient_phone: shipment.recipient_phone,
      message: smsPreview,
      shipment_public_id: shipment.public_id,
      idempotency_key: `manual_sms_${shipment.public_id}`,
    });
    setLastSmsSend(`${result.provider} ${result.operation} ${result.queued ? "queued" : "dry-run"} ${result.request_id}`);
    setStatus("SMS backend provider-delivery sınırında hazırlandı");
  }

  async function handleUpdateShipment() {
    const shipment = selectedShipment;
    if (!shipment) return;

    setStatus("Kargo durumu backend API üzerinden güncelleniyor");
    const updated = await domain.updateShipmentStatus(shipment.public_id, {
      status: "delivered",
      last_event_text: "Frontend teslim kaniti",
      raw_payload: null,
    });
    const shipmentPipeline = await domain.getShipmentPipelineSummary();
    if (shipmentFilter !== "all") {
      const trimmedSearch = shipmentSearch.trim();
      const shipments = await domain.listShipments({
        ...shipmentFilterParams(shipmentFilter),
        ...(trimmedSearch ? { search: trimmedSearch } : {}),
        limit: shipmentPageSize,
        offset: shipmentPage * shipmentPageSize,
      });
      const updatedStillVisible = shipmentMatchesFilter(updated, shipmentFilter);
      const refreshedRows = updatedStillVisible
        ? [updated, ...shipments.data.filter((item) => item.public_id !== updated.public_id)]
        : shipments.data;
      setData((current) => ({
        ...current,
        shipments: refreshedRows,
        shipmentPipeline,
      }));
      setShipmentTotalCount(shipments.meta?.total_count ?? refreshedRows.length);
      setSelectedShipmentId(updatedStillVisible ? updated.public_id : refreshedRows[0]?.public_id ?? null);
      setStatus("Kargo durumu backend API üzerinden güncellendi");
      return;
    }
    setData((current) => ({
      ...current,
      shipments: current.shipments.map((item) => (item.public_id === updated.public_id ? updated : item)),
      shipmentPipeline,
    }));
    setSelectedShipmentId(updated.public_id);
    setStatus("Kargo durumu backend API üzerinden güncellendi");
  }

  async function handleTrackShipment(shipment: ShipmentSummary) {
    if (trackingShipmentId) return;

    setStatus("Takip güncelleme backend provider-delivery kuyruğuna gönderiliyor");
    setTrackingShipmentId(shipment.public_id);
    try {
      const result = await domain.trackShipment(shipment.public_id, {
        idempotency_key: `track_${shipment.public_id}_${Date.now()}`,
      });
      setLastShipmentTrack(`${result.provider} ${result.operation} ${result.queued ? "queued" : "dry-run"} ${result.request_id}`);
      setStatus(`Takip güncelleme ${result.live_gate} kapısına bağlı olarak kuyruğa alındı`);
    } finally {
      setTrackingShipmentId(null);
    }
  }

  async function handleSaveProviderLiveGate() {
    setStatus("Provider live gate backend API üzerinden kapalı kaydediliyor");
    const setting = await admin.upsertSetting("providers.ptt.live_mode", false, false, "global");
    setData((current) => ({
      ...current,
      settings: [setting, ...current.settings.filter((item) => item.key !== setting.key)],
    }));
    setStatus("Provider live gate kapalı olarak kaydedildi");
  }

  async function handleSaveNetgsmSettings() {
    const setting = await admin.upsertSetting(
      "netgsm_teyit_ayarlar",
      {
        aktif: true,
        ilk_arama_dakika: 5,
        max_deneme: 3,
        deneme_arasi_dakika: 10,
      },
      false,
      "global",
    );
    setData((current) => ({
      ...current,
      settings: [setting, ...current.settings.filter((item) => item.key !== setting.key)],
    }));
    setStatus("NetGSM teyit ayarı backend admin settings üzerinden kaydedildi");
  }

  async function handleSaveSipConfig() {
    const setting = await admin.upsertSetting(
      "sip_config",
      {
        ws_url: sipServerSettings.ws_url,
        domain: sipServerSettings.domain,
        stun: sipServerSettings.stun,
      },
      false,
      "global",
    );
    setData((current) => ({
      ...current,
      settings: [setting, ...current.settings.filter((item) => item.key !== setting.key)],
    }));
    setStatus("Santral SIP ayarı backend admin settings üzerinden kaydedildi");
  }

  async function handleSaveOperationalPolicy() {
    setStatus("Operasyon politikaları backend admin settings üzerinden kaydediliyor");
    const setting = await admin.upsertSetting(
      "operations.policy",
      {
        max_attempts: 5,
        retry_delay_ms: 45000,
        request_timeout_ms: 12000,
        webhook_timeout_ms: 6000,
        provider_rate_limit_per_minute: 90,
        queue_concurrency: 6,
        storage_bucket: "garage-media",
        lifecycle_days: 120,
        orphan_cleanup_enabled: true,
      },
      false,
      "global",
    );
    setData((current) => ({
      ...current,
      settings: [setting, ...current.settings.filter((item) => item.key !== setting.key)],
    }));
    setStatus("Operasyon politikaları backend admin settings üzerinden kaydedildi");
  }

  async function handleUpsertIntegrationAccount() {
    setStatus("Entegrasyon hesabı backend API üzerinden kaydediliyor");
    const account = await admin.upsertIntegrationAccount({
      provider_key: "instagram",
      display_name: "Instagram Playwright",
      external_account_id: "ig_playwright",
      metadata: { source: "frontend" },
    });
    setData((current) => ({
      ...current,
      integrationAccounts: [
        account,
        ...current.integrationAccounts.filter((item) => item.public_id !== account.public_id),
      ],
    }));
    setStatus("Entegrasyon hesabı backend API üzerinden kaydedildi");
  }

  async function handleOpenIntegrationAccount(accountPublicId: string) {
    setStatus("Entegrasyon hesabı detayları backend API üzerinden yükleniyor");
    const [snapshot, instagramAnalytics] = await Promise.all([
      admin.getIntegrationAccount(accountPublicId),
      admin.getInstagramAnalyticsSummary(accountPublicId),
    ]);
    setIntegrationSnapshot(snapshot);
    setData((current) => ({ ...current, instagramAnalytics }));
    setStatus("Entegrasyon hesabı detayları backend API üzerinden yüklendi");
  }

  async function handleCreateInstagramPublishPreview() {
    if (instagramPublishPreviewing) return;

    const accountPublicId = integrationSnapshot?.account.public_id ?? data.integrationAccounts[0]?.public_id ?? null;
    setStatus("Instagram yayın önizlemesi backend API üzerinden hazırlanıyor");
    setInstagramPublishPreviewing(true);
    try {
      const attempt = await admin.createInstagramPublishPreview({
        account_public_id: accountPublicId,
        image_url: instagramDraftImageUrl,
        caption: instagramDraftCaption,
        idempotency_key: `instagram_publish_${accountPublicId ?? "preview"}`,
      });
      setData((current) => ({
        ...current,
        providerAttempts: [
          toProviderAttemptViewModel(attempt),
          ...current.providerAttempts.filter((item) => item.public_id !== attempt.public_id),
        ],
      }));
      setLastInstagramPublishPreview(`${attempt.operation} ${attempt.request_id}`);
      setStatus("Instagram yayın önizlemesi canlı provider kapalıyken kaydedildi");
    } finally {
      setInstagramPublishPreviewing(false);
    }
  }

  async function handleCreateVapiTestCall() {
    if (vapiTestCalling || !vapiTestPhone.trim()) return;

    setStatus("VAPI test araması backend dry-run üzerinden hazırlanıyor");
    setVapiTestCalling(true);
    try {
      const attempt = await webphone.createTestCall({
        customer_name: vapiTestCustomerName.trim() || "Test Müşteri",
        customer_phone: vapiTestPhone.trim(),
        cargo_provider: "PTT",
        tracking_number: selectedShipment?.tracking_number ?? "279172790012",
        last_event_text: selectedShipment?.last_event_text ?? "şubede bekliyor",
        idempotency_key: `vapi_test_${vapiTestPhone.trim().replace(/[^0-9a-zA-Z_-]+/g, "_")}`,
      });
      setData((current) => ({
        ...current,
        providerAttempts: [
          toProviderAttemptViewModel(attempt),
          ...current.providerAttempts.filter((item) => item.public_id !== attempt.public_id),
        ],
      }));
      setLastVapiTestCall(`${attempt.operation} ${attempt.request_id}`);
      setStatus("VAPI test araması canlı çağrı kapalıyken kaydedildi");
    } finally {
      setVapiTestCalling(false);
    }
  }

  async function handleSaveIntegrationToken() {
    const accountPublicId = integrationSnapshot?.account.public_id ?? data.integrationAccounts[0]?.public_id;
    if (!accountPublicId) return;

    setStatus("Entegrasyon token bilgisi backend API üzerinden kaydediliyor");
    await admin.upsertIntegrationToken(accountPublicId, "access_token", {
      secret: "frontend-playwright-token",
      source: "admin-ui",
    });
    const [snapshot, instagramAnalytics] = await Promise.all([
      admin.getIntegrationAccount(accountPublicId),
      admin.getInstagramAnalyticsSummary(accountPublicId),
    ]);
    setIntegrationSnapshot(snapshot);
    setData((current) => ({ ...current, instagramAnalytics }));
    setStatus("Entegrasyon token bilgisi maskeli backend API üzerinden kaydedildi");
  }

  async function handleSaveIntegrationSetting() {
    const accountPublicId = integrationSnapshot?.account.public_id ?? data.integrationAccounts[0]?.public_id;
    if (!accountPublicId) return;

    setStatus("Entegrasyon ayarı backend API üzerinden kaydediliyor");
    await admin.upsertIntegrationSetting(accountPublicId, "webhook.enabled", true, false);
    const [snapshot, instagramAnalytics] = await Promise.all([
      admin.getIntegrationAccount(accountPublicId),
      admin.getInstagramAnalyticsSummary(accountPublicId),
    ]);
    setIntegrationSnapshot(snapshot);
    setData((current) => ({ ...current, instagramAnalytics }));
    setStatus("Entegrasyon ayarı backend API üzerinden kaydedildi");
  }

  async function handleTogglePresence() {
    if (!user || user.role === "admin") return;

    const nextPresence = !user.is_online;
    setPresenceUpdating(true);
    setStatus(nextPresence ? "Çevrimiçi duruma geçiliyor" : "Çevrimdışı duruma geçiliyor");
    try {
      const updatedUser = await auth.setPresence(nextPresence);
      setUser(updatedUser);
      setStatus(updatedUser.is_online ? "Çevrimiçi durum backend auth üzerinden güncellendi" : "Çevrimdışı durum backend auth üzerinden güncellendi");
    } finally {
      setPresenceUpdating(false);
    }
  }

  const activeSettings = data.settings.filter((setting) => !setting.is_secret);
  const visibleNavigation = navigationItems.filter((item) => item.roles.includes(user?.role ?? "guest"));
  const requestedFlow = flowFromPath(location.pathname);
  const activeFlow = visibleNavigation.some((item) => item.key === requestedFlow)
    ? requestedFlow
    : visibleNavigation[0]?.key ?? "inbox";
  const canTogglePresence = Boolean(user && user.role !== "admin");
  const netgsmSettings = netgsmSettingsFrom(activeSettings);
  const sipServerSettings = sipServerSettingsFrom(activeSettings, data.webphone);
  const operationalPolicy = operationalPolicyFrom(activeSettings);
  const selectedCustomer = data.customers[0] ?? null;
  const selectedOrder = data.orders.find((order) => order.public_id === selectedOrderId) ?? data.orders[0] ?? null;
  const selectedShipment = data.shipments.find((shipment) => shipment.public_id === selectedShipmentId) ?? data.shipments[0] ?? null;
  const visibleOrderIds = data.orders.map((order) => order.public_id);
  const allVisibleOrdersSelected = visibleOrderIds.length > 0 && visibleOrderIds.every((id) => selectedOrderIds.has(id));
  const orderPageCount = Math.max(1, Math.ceil(orderTotalCount / 20));
  const shipmentPageCount = Math.max(1, Math.ceil(shipmentTotalCount / shipmentPageSize));
  const shipmentOffsetStart = shipmentTotalCount === 0 ? 0 : shipmentPage * shipmentPageSize + 1;
  const shipmentOffsetEnd = Math.min((shipmentPage + 1) * shipmentPageSize, shipmentTotalCount);
  const orderSources = [...new Set(data.orders.map((order) => order.source).filter(Boolean))].sort();
  const orderPersonnel = [...new Map(data.orders
    .filter((order) => order.created_by_user_public_id && order.created_by_user_email)
    .map((order) => [order.created_by_user_public_id as string, order.created_by_user_email as string])).entries()];
  const smsVariableValues: Record<SmsTemplateVariable, string> = {
    "{musteri_adi}": selectedShipment?.recipient_name ?? selectedOrder?.customer_full_name ?? "Müşteri",
    "{takip_no}": selectedShipment?.tracking_number ?? selectedShipment?.barcode_number ?? "takip bekliyor",
    "{kargo_firmasi}": selectedShipment?.provider ?? "Kargo",
  };
  const smsPreview = smsTemplateVariables.reduce(
    (message, variable) => message.replace(variable, smsVariableValues[variable]),
    smsTemplate,
  );
  const activeSmsTemplateValue = smsVariableValues[activeSmsTemplateVariable];
  const smsInfo = smsSegmentInfo(smsPreview);
  const smsRecipientCount = data.shipmentSummary.recipient_phone_count;
  const balanceSummary = toBalanceView(data.balanceSummary);
  const commentSummary = toCommentModerationView(data.commentModeration);
  const unreadConversationCount = data.conversationSummary.unread_count;
  const poolConversationCount = data.conversationSummary.pool_count;
  const humanAgentConversationCount = data.conversationSummary.human_agent_count;
  const instagramConversationCount = data.conversationSummary.channel_counts.instagram;
  const facebookConversationCount = data.conversationSummary.channel_counts.facebook;
  const openConversationCount = data.conversationSummary.status_counts.open;
  const closedConversationCount = data.conversationSummary.status_counts.closed;
  const conversationMatchesChannelFilter = (conversation: ConversationSummary, filter: string) => {
    if (filter === "all") {
      return true;
    }
    if (filter === "facebook") {
      return conversation.channel === "facebook" || conversation.channel === "messenger";
    }
    return conversation.channel === filter;
  };
  const visibleConversations = data.conversations.filter((conversation) => {
    const channelMatches = conversationMatchesChannelFilter(conversation, conversationChannelFilter);
    const statusMatches = conversationStatusFilter === "all" || conversation.status === conversationStatusFilter;
    const normalizedSearch = conversationSearch.trim().toLocaleLowerCase("tr-TR");
    const searchMatches =
      !normalizedSearch ||
      [
        conversation.customer?.full_name,
        conversation.customer?.phone,
        conversation.last_message_text,
        conversation.channel,
        conversation.assigned_user_email,
      ].some((value) => value?.toLocaleLowerCase("tr-TR").includes(normalizedSearch));
    return channelMatches && statusMatches && searchMatches;
  });
  const selectedConversation =
    visibleConversations.find((conversation) => conversation.public_id === selectedConversationId) ?? visibleConversations[0] ?? null;
  const selectedConversationCustomer =
    data.customers.find((customer) =>
      customer.phone && customer.phone === selectedConversation?.customer?.phone
    ) ??
    data.customers.find((customer) =>
      customer.full_name === selectedConversation?.customer?.full_name
    ) ??
    null;

  useEffect(() => {
    setConversationNoteDraft(selectedConversation?.notes ?? "");
    setCustomerNoteDraft(selectedConversationCustomer?.notes ?? "");
    setAiSuggestion(null);
  }, [selectedConversation?.public_id, selectedConversation?.notes, selectedConversationCustomer?.notes]);

  useEffect(() => () => {
    for (const attachment of pendingAttachments) {
      if (attachment.preview_url) URL.revokeObjectURL(attachment.preview_url);
    }
    for (const attachment of shortcutDraft.attachments) {
      if (attachment.preview_url) URL.revokeObjectURL(attachment.preview_url);
    }
  }, [pendingAttachments, shortcutDraft.attachments]);

  if (publicPage) {
    return <PublicPage page={publicPage} />;
  }

  if (location.pathname === "/sifre-sifirla") {
    return <ResetPasswordScreen />;
  }

  if (token && !authChecked) {
    return (
      <main className="login-screen">
        <div className="login-card">
          <div className="brand large">
            <span className="brand-mark">G</span>
            <span>Garanti Kuluçka</span>
          </div>
          <p>Oturum backend üzerinden doğrulanıyor</p>
        </div>
      </main>
    );
  }

  if (!token) {
    return <LoginScreen onLogin={handleLogin} status={status} />;
  }

  const conversationChannelFilters = [
    { value: "all", label: `Tüm kanallar ${data.conversationSummary.total_count}` },
    { value: "instagram", label: `Instagram ${instagramConversationCount}` },
    { value: "facebook", label: `Facebook ${facebookConversationCount}` },
  ];
  const conversationStatusFilters = [
    { value: "all", label: "Tüm durumlar" },
    { value: "open", label: `Açık ${openConversationCount}` },
    { value: "closed", label: `Kapalı ${closedConversationCount}` },
  ];
  const instagramAnalytics = toInstagramAnalyticsView(data.instagramAnalytics);
  const selectedProviderAttempt = data.providerAttempts[0] ?? null;
  const selectedProviderPreview = selectedProviderAttempt?.provider_request_preview ?? null;
  const selectedProviderCatalogItem = data.providerCatalog[0] ?? null;
  const suratProviderCatalogItem = data.providerCatalog.find((item) => item.provider === "surat") ?? null;
  const pttProviderCatalogItem = data.providerCatalog.find((item) => item.provider === "ptt") ?? null;
  const providerDebugSummaries = new Map(data.providerDebugSummary.providers.map((summary) => [summary.provider_key, summary]));
  const pttProviderDebug = providerDebugSummaries.get("ptt") ?? emptyProviderDebug("ptt");
  const suratProviderDebug = providerDebugSummaries.get("surat") ?? emptyProviderDebug("surat");
  const providerAttemptTotal = data.providerDebugSummary.providers.reduce(
    (total, summary) => total + summary.total_attempts,
    0,
  );
  const pttProviderAttempts = data.providerAttempts.filter((attempt) => attempt.provider_key === "ptt");
  const suratProviderAttempts = data.providerAttempts.filter((attempt) => attempt.provider_key === "surat");
  const latestSuratAttempt = suratProviderAttempts[0] ?? null;
  const latestSuratPreview = latestSuratAttempt?.provider_request_preview ?? null;
  const trackingCronAttempts = data.providerAttempts.filter(
    (attempt) =>
      (attempt.provider_key === "ptt" || attempt.provider_key === "surat") &&
      attempt.operation === "shipment.track",
  );
  const cronUpdatedCount = data.providerDebugSummary.cron.success_count;
  const cronErrorCount = data.providerDebugSummary.cron.failure_count;
  const cronTotalDuration = data.providerDebugSummary.cron.total_duration_ms;
  const suratRetryCount = suratProviderDebug.retry_count;
  const suratFailureCount = suratProviderDebug.failure_count;
  const suratSuccessCount = suratProviderDebug.success_count;
  const suratAverageDuration = suratProviderDebug.average_duration_ms;
  const latestSettingsAudit = data.settingsAudit[0] ?? null;
  const latestIntegrationAudit = data.integrationAudit[0] ?? null;
  const deliveredShipmentCount = data.shipmentSummary.delivered_count;
  const activeShipmentCount = data.shipmentSummary.active_count;
  const cronSkippedCount = Math.max(activeShipmentCount - data.providerDebugSummary.cron.total_attempts, 0);
  const pttShipmentCount = data.shipmentSummary.provider_counts.ptt;
  const suratShipmentCount = data.shipmentSummary.provider_counts.surat;
  const pttNotDeliveredCount = data.shipmentSummary.exception_counts.ptt_not_delivered;
  const suratNotDeliveredCount = data.shipmentSummary.exception_counts.surat_not_delivered;
  const trackingMissingCount = data.shipmentSummary.exception_counts.tracking_missing;
  const otherShipmentCount = data.shipmentSummary.provider_counts.other;
  const visibleShipmentPipelineRows = data.shipmentPipeline.rows.filter(
    (row) => shipmentPipelineFilter === "all" || row.step === shipmentPipelineFilter,
  );
  const pipelineMessageCount = data.shipmentPipeline.counts.mesaj;
  const pipelineSmsCount = data.shipmentPipeline.counts.sms;
  const pipelineVapiCount = data.shipmentPipeline.counts.vapi;
  const pipelineWaitingCount = data.shipmentPipeline.counts.bekliyor;
  const pipelineProcessingCount = data.shipmentPipeline.counts.isleniyor;
  const pipelineErrorCount = data.shipmentPipeline.counts.hata;
  const pipelineDeliveredCount = data.shipmentPipeline.counts.teslim;
  const shipmentPipelineFilters: Array<{ value: ShipmentPipelineFilter; label: string; count: number }> = [
    { value: "all", label: "Tümü", count: data.shipmentPipeline.counts.all },
    { value: "mesaj", label: "Mesaj", count: pipelineMessageCount },
    { value: "sms", label: "SMS", count: pipelineSmsCount },
    { value: "vapi", label: "VAPI", count: pipelineVapiCount },
    { value: "teslim", label: "Teslim", count: pipelineDeliveredCount },
  ];
  const customerWithPhoneCount = data.customerSummary.with_phone_count;
  const customerWithEmailCount = data.customerSummary.with_email_count;
  const customerWithNotesCount = data.customerSummary.with_notes_count;
  const activeProductCount = data.productSummary.active_count;
  const criticalProducts = data.products.filter((product) => product.stock_quantity <= data.productSummary.critical_threshold);
  const selectedProduct = data.products[0] ?? null;
  const incubatorProductCount = data.productSummary.category_counts.incubator;
  const sparePartProductCount = data.productSummary.category_counts.spare_part;
  const otherProductCount = data.productSummary.category_counts.other;
  const messageAttachments = data.messages.flatMap((message) => message.attachments ?? []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">G</span>
          <span>Garanti Kuluçka</span>
        </div>
        <nav aria-label="Ana gezinme">
          {visibleNavigation.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.key}
                className={({ isActive }) => cx("nav-button", (isActive || activeFlow === item.key) && "active")}
                to={item.path}
              >
                <Icon aria-hidden="true" size={16} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        {canTogglePresence && (
          <button
            className={cx("presence-toggle", user?.is_online && "online")}
            disabled={presenceUpdating}
            onClick={handleTogglePresence}
            type="button"
          >
            {user?.is_online ? <Wifi size={15} aria-hidden="true" /> : <WifiOff size={15} aria-hidden="true" />}
            <span>{presenceUpdating ? "Değişiyor" : user?.is_online ? "Çevrimiçi" : "Çevrimdışı"}</span>
          </button>
        )}
        <div className="user-chip">
          <Wifi size={15} aria-hidden="true" />
          <span>{user?.email ?? "Backend session"}</span>
          <button type="button" onClick={handleLogout}>
            Çıkış
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="status-row" aria-live="polite">
          <span>{status}</span>
          <span>Supabase kullanılmıyor</span>
          <span>Socket.IO backend sınırı hazır</span>
        </section>

        {activeFlow === "inbox" && (
          <FlowPanel title="Mesajlar" icon={<MessageCircle size={18} />} testId="inbox-flow">
            <div className="messages-layout">
              <aside className="messages-sidebar" data-testid="conversation-filter-summary">
                <div className="messages-toolbar" data-testid="conversation-filter-bar">
                  <label className="messages-select-label">
                    <span>Kanal</span>
                    <select
                      className="inline-input"
                      data-testid="channel-filter"
                      value={conversationChannelFilter}
                      onChange={(event) => void handleApplyConversationFilters(event.target.value, conversationStatusFilter)}
                    >
                      {conversationChannelFilters.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="messages-select-label">
                    <span>Durum</span>
                    <select
                      className="inline-input"
                      data-testid="status-filter"
                      value={conversationStatusFilter}
                      onChange={(event) => void handleApplyConversationFilters(conversationChannelFilter, event.target.value)}
                    >
                      {conversationStatusFilters.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="detail-actions compact" aria-hidden="true">
                  {conversationChannelFilters.map(({ value, label }) => (
                    <button
                      className={cx("secondary-action", conversationChannelFilter === value && "selected")}
                      data-testid={`conversation-channel-filter-${value}`}
                      key={value}
                      type="button"
                      onClick={() => void handleApplyConversationFilters(value, conversationStatusFilter)}
                    >
                      {label}
                    </button>
                  ))}
                  {conversationStatusFilters.map(({ value, label }) => (
                    <button
                      className={cx("secondary-action", conversationStatusFilter === value && "selected")}
                      data-testid={`conversation-status-filter-${value}`}
                      key={value}
                      type="button"
                      onClick={() => void handleApplyConversationFilters(conversationChannelFilter, value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="messages-search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    data-testid="conversation-search"
                    value={conversationSearch}
                    onChange={(event) => setConversationSearch(event.target.value)}
                    placeholder="Konuşma ara"
                    type="search"
                  />
                </label>
                <div className="messages-counts">
                  <span>Okunmamış {unreadConversationCount}</span>
                  <span>Havuz {poolConversationCount}</span>
                  <span>Human Agent {humanAgentConversationCount}</span>
                  <span>legacy kanal/durum filtreleri</span>
                  <span>backend is_in_pool</span>
                  <span>backend human_agent_enabled</span>
                  <span>Aktif kanal {conversationChannelFilter}</span>
                  <span>Aktif durum {conversationStatusFilter}</span>
                </div>
                <List title="Konuşmalar" testId="conversation-list">
                  {visibleConversations.map((conversation) => (
                    <li key={conversation.public_id}>
                      <button
                        className={cx("conversation-button", selectedConversation?.public_id === conversation.public_id && "selected")}
                        data-channel={conversation.channel}
                        data-testid="conversation-row"
                        type="button"
                        onClick={() => void handleSelectConversation(conversation.public_id)}
                      >
                        <span className="conversation-row-top">
                          <strong>{conversation.customer?.full_name ?? conversation.public_id}</strong>
                          <em>{conversation.channel}</em>
                        </span>
                        <span>{conversation.last_message_text ?? "Mesaj yok"}</span>
                        <span>
                          {conversation.status} / okunmamış {conversation.unread_count}
                          {conversation.is_in_pool ? " / havuzda" : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </List>
              </aside>

              <section className="message-thread">
                <header className="message-thread-header">
                  <div>
                    <h2>{selectedConversation?.customer?.full_name ?? "Konuşma seçin"}</h2>
                    <span>{selectedConversation?.channel ?? "Kanal yok"}</span>
                  </div>
                  {selectedConversation && selectedConversation.unread_count > 0 && (
                    <button
                      className="secondary-action icon-action"
                      data-testid="mark-read-button"
                      type="button"
                      onClick={() => void handleUpdateConversationState({ unread_count: 0 })}
                    >
                      <CheckCheck size={16} aria-hidden="true" />
                      <span>Okundu yap</span>
                    </button>
                  )}
                </header>
                <div className="message-scroll-area" data-testid="message-scroll-area">
                  {messageAttachments.length > 0 && (
                    <div className="message-attachments" data-testid="message-attachments">
                      {messageAttachments.map((attachment) => (
                        <span key={`${attachment.file_public_id}-${attachment.attachment_type}`}>
                          <FileText size={13} aria-hidden="true" />
                          {attachmentLabel(attachment.attachment_type)} {attachment.original_name ?? attachment.file_public_id}
                        </span>
                      ))}
                    </div>
                  )}
                  {data.messages.map((message) => {
                    const mine = message.sender_type === "user" || message.sender_type === "ai";
                    const attachments = message.attachments ?? [];
                    return (
                      <article className={cx("message-bubble", mine && "mine")} key={message.public_id}>
                        <strong>{message.sender_name ?? (mine ? "Temsilci" : "Müşteri")}</strong>
                        <span>{message.body ?? (attachments.length > 0 ? "Medya" : "Boş mesaj")}</span>
                        {attachments.length > 0 && (
                          <div className="message-attachments">
                            {attachments.map((attachment) => (
                              <span key={attachment.file_public_id}>
                                <FileText size={13} aria-hidden="true" />
                                {attachmentLabel(attachment.attachment_type)} {attachment.original_name ?? attachment.file_public_id}
                              </span>
                            ))}
                          </div>
                        )}
                        <small>{formatDate(message.sent_at)}</small>
                      </article>
                    );
                  })}
                </div>
                <div className="message-composer" data-testid="message-composer">
                  <input
                    ref={mediaInputRef}
                    accept="image/*,video/*"
                    className="hidden-file-input"
                    data-testid="message-media-input"
                    multiple
                    type="file"
                    onChange={(event) => {
                      handlePickMessageFiles(event.currentTarget.files);
                      event.currentTarget.value = "";
                    }}
                  />
                  <input
                    ref={pdfInputRef}
                    accept="application/pdf"
                    className="hidden-file-input"
                    data-testid="message-pdf-input"
                    type="file"
                    onChange={(event) => {
                      handlePickMessageFiles(event.currentTarget.files);
                      event.currentTarget.value = "";
                    }}
                  />
                  <div className="message-composer-tools">
                    <button
                      className="secondary-action icon-only"
                      title="Görsel / video ekle"
                      type="button"
                      onClick={() => mediaInputRef.current?.click()}
                    >
                      <Image size={16} aria-hidden="true" />
                    </button>
                    <button
                      className="secondary-action icon-only"
                      title="PDF ekle"
                      type="button"
                      onClick={() => pdfInputRef.current?.click()}
                    >
                      <FileText size={16} aria-hidden="true" />
                    </button>
                    <button
                      className={cx("secondary-action icon-only", shortcutMenuOpen && "selected")}
                      data-testid="shortcut-menu-button"
                      title="Hızlı cevaplar"
                      type="button"
                      onClick={() => setShortcutMenuOpen((current) => !current)}
                    >
                      <Zap size={16} aria-hidden="true" />
                    </button>
                    <button
                      className="secondary-action icon-only"
                      data-testid="ai-suggestion-button"
                      title="AI yanıt öner"
                      type="button"
                      onClick={() => void handleAiSuggestion()}
                    >
                      <Bot size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="message-composer-main">
                    {pendingAttachments.length > 0 && (
                      <div className="attachment-strip" data-testid="pending-attachments">
                        {pendingAttachments.map((attachment, index) => (
                          <span key={`${attachment.file.name}-${index}`}>
                            {attachmentLabel(attachment.attachment_type)}: {attachment.file.name}
                            <button
                              title="Medyayı kaldır"
                              type="button"
                              onClick={() => {
                                setPendingAttachments((current) => {
                                  const removed = current[index];
                                  if (removed?.preview_url) URL.revokeObjectURL(removed.preview_url);
                                  return current.filter((_, itemIndex) => itemIndex !== index);
                                });
                              }}
                            >
                              <X size={12} aria-hidden="true" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {shortcutMenuOpen && (
                      <div className="shortcut-popover" data-testid="shortcut-popover">
                        <div className="shortcut-form">
                          <input
                            ref={shortcutMediaInputRef}
                            accept="image/*,video/*,application/pdf"
                            className="hidden-file-input"
                            data-testid="shortcut-media-input"
                            multiple
                            type="file"
                            onChange={(event) => {
                              handlePickShortcutFiles(event.currentTarget.files);
                              event.currentTarget.value = "";
                            }}
                          />
                          <input
                            className="inline-input"
                            data-testid="shortcut-code-input"
                            placeholder="Kısayol kodu"
                            value={shortcutDraft.code}
                            onChange={(event) => setShortcutDraft((current) => ({ ...current, code: event.target.value }))}
                          />
                          <textarea
                            data-testid="shortcut-message-input"
                            placeholder={shortcutDraft.attachments.length > 0 ? "Medya başlığı" : "Kısayol mesajı"}
                            value={shortcutDraft.message}
                            onChange={(event) => setShortcutDraft((current) => ({ ...current, message: event.target.value }))}
                          />
                          {shortcutDraft.attachments.length > 0 && (
                            <div className="attachment-strip">
                              {shortcutDraft.attachments.map((attachment, index) => (
                                <span key={`${attachment.file.name}-${index}`}>
                                  {attachmentLabel(attachment.attachment_type)}: {attachment.file.name}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="detail-actions compact">
                            <button
                              className="secondary-action"
                              type="button"
                              onClick={() => shortcutMediaInputRef.current?.click()}
                            >
                              <Image size={14} aria-hidden="true" />
                              Medya ekle
                            </button>
                            <button
                              className="primary-action"
                              data-testid="shortcut-save-button"
                              disabled={!shortcutDraft.code.trim() || (!shortcutDraft.message.trim() && shortcutDraft.attachments.length === 0)}
                              type="button"
                              onClick={() => void handleSaveShortcut()}
                            >
                              {editingShortcutId ? "Güncelle" : "Ekle"}
                            </button>
                            <button
                              className="secondary-action"
                              type="button"
                              onClick={() => {
                                setEditingShortcutId(null);
                                setShortcutDraft({ code: "", message: "", attachments: [] });
                              }}
                            >
                              İptal
                            </button>
                          </div>
                        </div>
                        <div className="shortcut-list">
                          {messageShortcuts.filter((shortcut) => shortcut.is_active).map((shortcut) => (
                            <div className="shortcut-row" key={shortcut.public_id}>
                              <button data-testid="shortcut-row" type="button" onClick={() => handleUseShortcut(shortcut)}>
                                <code>/{shortcut.code}</code>
                                <span>{shortcut.message ?? shortcut.attachments[0]?.original_name ?? "Medya"}</span>
                                {shortcut.attachments.length > 0 && <em>{shortcut.attachments.length} medya</em>}
                              </button>
                              {shortcut.attachments.length > 0 && (
                                <button
                                  className="secondary-action icon-only"
                                  data-testid="shortcut-download-button"
                                  title="Dosyayı indir"
                                  type="button"
                                  onClick={() => void handleDownloadShortcutAttachment(shortcut)}
                                >
                                  <Download size={14} aria-hidden="true" />
                                </button>
                              )}
                              <button
                                className="secondary-action icon-only"
                                data-testid="shortcut-edit-button"
                                title="Kısayolu düzenle"
                                type="button"
                                onClick={() => handleEditShortcut(shortcut)}
                              >
                                <Pencil size={14} aria-hidden="true" />
                              </button>
                              <button
                                className="secondary-action icon-only"
                                data-testid="shortcut-delete-button"
                                title="Kısayolu sil"
                                type="button"
                                onClick={() => void handleDeleteShortcut(shortcut.public_id)}
                              >
                                <Trash2 size={14} aria-hidden="true" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <textarea
                      data-testid="message-input"
                      disabled={!selectedConversation}
                      onChange={(event) => setMessageDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void handleSendMessage();
                        }
                      }}
                      placeholder={pendingAttachments.length > 0 ? "Medya başlığı yazın..." : "Mesajınızı yazın..."}
                      value={messageDraft}
                    />
                    {aiSuggestion && (
                      <div className="ai-suggestion" data-testid="ai-suggestion">
                        <span>{aiSuggestion}</span>
                        <button type="button" onClick={() => setMessageDraft(aiSuggestion)}>
                          Kullan
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    className="primary-action icon-action"
                    data-testid="message-send-button"
                    disabled={!selectedConversation || (!messageDraft.trim() && pendingAttachments.length === 0)}
                    type="button"
                    onClick={() => void handleSendMessage()}
                  >
                    <Send size={16} aria-hidden="true" />
                    <span>Cevap gönder</span>
                  </button>
                </div>
              </section>

              <aside className="messages-detail">
                {selectedConversation && (
                  <DetailPanel title="Konuşma Detayı" testId="conversation-detail">
                    <DataRows
                      rows={[
                        ["Müşteri", selectedConversation.customer?.full_name ?? selectedConversation.public_id, selectedConversation.channel],
                        ["Durum", selectedConversation.status, selectedConversation.assigned_user_email ?? "havuz"],
                        ["Okunmamış", String(selectedConversation.unread_count), selectedConversation.last_message_sender_type ?? "-"],
                      ]}
                    />
                    <label className="note-editor">
                      <span>Konuşma notu</span>
                      <textarea
                        data-testid="conversation-note-input"
                        placeholder="Konuşma için not"
                        value={conversationNoteDraft}
                        onChange={(event) => handleConversationNoteChange(event.target.value)}
                      />
                    </label>
                    <label className="note-editor">
                      <span>Müşteri notu</span>
                      <textarea
                        data-testid="customer-note-input"
                        placeholder="Müşteri için not"
                        value={customerNoteDraft}
                        onChange={(event) => handleCustomerNoteChange(event.target.value)}
                      />
                    </label>
                    <div className="detail-actions" data-testid="conversation-state-actions">
                      <button
                        className="secondary-action"
                        data-testid="human-agent-toggle"
                        type="button"
                        onClick={() =>
                          void handleUpdateConversationState({
                            human_agent_enabled: !selectedConversation.human_agent_enabled,
                          })
                        }
                      >
                        {selectedConversation.human_agent_enabled ? "Human agent kapat" : "Human agent aç"}
                      </button>
                      <button
                        className="secondary-action"
                        data-testid="pool-toggle"
                        type="button"
                        onClick={() =>
                          void handleUpdateConversationState(
                            selectedConversation.is_in_pool
                              ? { assign_to_me: true, is_in_pool: false }
                              : { assign_to_me: false, is_in_pool: true },
                          )
                        }
                      >
                        {selectedConversation.is_in_pool ? "Havuzdan al" : "Havuza bırak"}
                      </button>
                    </div>
                    <button
                      className="primary-action"
                      type="button"
                      onClick={() => void handleCreateOrder("conversation")}
                    >
                      Konuşmadan sipariş aç
                    </button>
                  </DetailPanel>
                )}
              </aside>
            </div>
          </FlowPanel>
        )}

        {activeFlow === "orders" && (
          <FlowPanel title="Siparişler" icon={<ShoppingCart size={18} />} testId="orders-flow">
            <div className="report-grid">
              <Metric title="Toplam Sipariş" value={String(data.orderSummary.total_count)} />
              <Metric title="Aktif Sipariş" value={String(data.orderSummary.active_count)} />
              <Metric title="Teyit Bekleyen" value={String(data.orderSummary.pending_confirmation_count)} />
              <Metric title="Ciro" value={formatMoney(data.orderSummary.total_revenue, data.orderSummary.currency)} />
            </div>
            <div className="orders-toolbar" data-testid="order-section-filters">
              <button
                className={cx("secondary-action", orderFilter === "all" && "selected")}
                data-testid="order-filter-all"
                type="button"
                onClick={() => void handleApplyOrderFilter("all")}
              >
                Hepsi {orderFilter === "all" ? data.orderSummary.total_count : "sonuç"}
              </button>
              <button
                className={cx("secondary-action", orderFilter === "active" && "selected")}
                data-testid="order-filter-active"
                type="button"
                onClick={() => void handleApplyOrderFilter("active")}
              >
                Aktif {orderFilter === "all" || orderFilter === "active" ? data.orderSummary.active_count : "sonuç"}
              </button>
              <button
                className={cx("secondary-action", orderFilter === "pending_confirmation" && "selected")}
                data-testid="order-filter-pending-confirmation"
                type="button"
                onClick={() => void handleApplyOrderFilter("pending_confirmation")}
              >
                Teyit {orderFilter === "all" || orderFilter === "pending_confirmation" ? data.orderSummary.pending_confirmation_count : "sonuç"}
              </button>
              <button
                className={cx("secondary-action", orderFilter === "delivered" && "selected")}
                data-testid="order-filter-delivered"
                type="button"
                onClick={() => void handleApplyOrderFilter("delivered")}
              >
                Teslim {orderFilter === "all" || orderFilter === "delivered" ? data.orderSummary.delivered_count : "sonuç"}
              </button>
            </div>
            <div className="orders-filter-grid" data-testid="orders-advanced-filters">
              <label>
                <span>Arama</span>
                <input
                  className="inline-input"
                  data-testid="orders-search-input"
                  placeholder="Sipariş, müşteri, not"
                  value={orderSearch}
                  onChange={(event) => setOrderSearch(event.target.value)}
                />
              </label>
              <label>
                <span>Durum</span>
                <select className="inline-input" data-testid="orders-status-filter" value={orderStatusFilter} onChange={(event) => setOrderStatusFilter(event.target.value)}>
                  <option value="all">Tüm durumlar</option>
                  <option value="active">Aktif</option>
                  <option value="draft">Oluşturuldu</option>
                  <option value="delivered">Teslim Edildi</option>
                  <option value="cancelled">İptal</option>
                  <option value="returned">İade</option>
                </select>
              </label>
              <label>
                <span>Kaynak</span>
                <select className="inline-input" data-testid="orders-source-filter" value={orderSourceFilter} onChange={(event) => setOrderSourceFilter(event.target.value)}>
                  <option value="all">Tüm kaynaklar</option>
                  <option value="manual">manual</option>
                  {orderSources.filter((source) => source !== "manual").map((source) => (
                    <option key={source} value={source}>{source}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Kargo</span>
                <select className="inline-input" data-testid="orders-cargo-filter" value={orderCargoFilter} onChange={(event) => setOrderCargoFilter(event.target.value)}>
                  <option value="all">Tüm kargolar</option>
                  <option value="ptt">PTT</option>
                  <option value="surat">Sürat</option>
                  <option value="other">Diğer</option>
                </select>
              </label>
              <label>
                <span>Personel</span>
                <select className="inline-input" data-testid="orders-person-filter" value={orderPersonnelFilter} onChange={(event) => setOrderPersonnelFilter(event.target.value)}>
                  <option value="all">Tüm personel</option>
                  {orderPersonnel.map(([publicId, email]) => (
                    <option key={publicId} value={publicId}>{email}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Başlangıç</span>
                <input className="inline-input" data-testid="orders-date-from" type="date" value={orderCreatedFrom} onChange={(event) => setOrderCreatedFrom(event.target.value)} />
              </label>
              <label>
                <span>Bitiş</span>
                <input className="inline-input" data-testid="orders-date-to" type="date" value={orderCreatedTo} onChange={(event) => setOrderCreatedTo(event.target.value)} />
              </label>
              <button className="primary-action icon-action" data-testid="orders-apply-filters" type="button" onClick={() => void handleApplyOrderAdvancedFilters()}>
                <Search size={16} aria-hidden="true" />
                <span>Filtrele</span>
              </button>
            </div>
            <div className="orders-toolbar">
              <button className="primary-action" type="button" onClick={() => void handleCreateOrder("orders")}>
                Sipariş oluştur
              </button>
              <button className="secondary-action icon-action" data-testid="orders-export-current" type="button" onClick={() => void handleExportOrders("current")}>
                <Download size={16} aria-hidden="true" />
                <span>Excel indir</span>
              </button>
              <button className="secondary-action icon-action" data-testid="orders-export-all" type="button" onClick={() => void handleExportOrders("all")}>
                <Download size={16} aria-hidden="true" />
                <span>Filtreli Excel</span>
              </button>
              <button className="secondary-action" data-testid="orders-export-selected" disabled={selectedOrderIds.size === 0} type="button" onClick={() => void handleExportOrders("selected")}>
                Seçilenleri indir ({selectedOrderIds.size})
              </button>
              <button className="secondary-action" disabled type="button" title="P5 slice 5 provider boundary ile açılacak">
                Toplu teyit ara
              </button>
              <button className="secondary-action" disabled type="button" title="P5 slice 5 KolayBi boundary ile açılacak">
                Toplu KolayBi aktar
              </button>
            </div>
            <div className="orders-list" data-testid="orders-list">
              <div className="orders-list-header">
                <button className="secondary-action icon-only" data-testid="orders-select-all" type="button" onClick={toggleAllVisibleOrders} aria-label="Tümünü seç">
                  {allVisibleOrdersSelected ? <CheckSquare size={16} aria-hidden="true" /> : <Square size={16} aria-hidden="true" />}
                </button>
                <button className="orders-sort-button" type="button" onClick={() => void handleOrderSort("order_number")}>Sipariş No</button>
                <span>Müşteri</span>
                <button className="orders-sort-button" type="button" onClick={() => void handleOrderSort("status")}>Durum</button>
                <span>Kaynak</span>
                <span>Kargo</span>
                <span>Personel</span>
                <button className="orders-sort-button" type="button" onClick={() => void handleOrderSort("total_amount")}>Tutar</button>
                <button className="orders-sort-button" type="button" onClick={() => void handleOrderSort("created_at")}>Tarih</button>
              </div>
              {data.orders.map((order) => (
                <button
                  className={cx("orders-list-row", selectedOrder?.public_id === order.public_id && "selected")}
                  data-testid={`order-row-${order.public_id}`}
                  key={order.public_id}
                  type="button"
                  onClick={() => setSelectedOrderId(order.public_id)}
                >
                  <span
                    className="orders-row-checkbox"
                    role="checkbox"
                    aria-checked={selectedOrderIds.has(order.public_id)}
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleOrderSelection(order.public_id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleOrderSelection(order.public_id);
                      }
                    }}
                  >
                    {selectedOrderIds.has(order.public_id) ? <CheckSquare size={16} aria-hidden="true" /> : <Square size={16} aria-hidden="true" />}
                  </span>
                  <strong>{order.order_number}</strong>
                  <span>{order.customer_full_name ?? "Müşteri eşleşmedi"}</span>
                  <span>{orderStatusLabel(order.status)}</span>
                  <span>{order.source}</span>
                  <span>{cargoProviderLabel(order.cargo_provider)}</span>
                  <span>{order.created_by_user_email ?? "-"}</span>
                  <span>{order.total_amount} {order.currency}</span>
                  <span><Calendar size={14} aria-hidden="true" /> {new Date(order.created_at).toLocaleDateString("tr-TR")}</span>
                </button>
              ))}
            </div>
            <div className="orders-pagination" data-testid="orders-pagination">
              <span>{orderTotalCount.toLocaleString("tr-TR")} kayıt, sayfa {orderPage + 1}/{orderPageCount}</span>
              <button className="secondary-action" disabled={orderPage === 0} type="button" onClick={() => void handleOrderPage(orderPage - 1)}>Önceki</button>
              <button className="secondary-action" disabled={orderPage + 1 >= orderPageCount} type="button" onClick={() => void handleOrderPage(orderPage + 1)}>Sonraki</button>
            </div>
            {selectedOrder && (
              <DetailPanel title="Sipariş Detayı" testId="order-detail">
                <DataRows
                  rows={[
                    ["Sipariş No", selectedOrder.order_number, orderStatusLabel(selectedOrder.status)],
                    ["Müşteri", selectedOrder.customer_full_name ?? "Müşteri eşleşmedi", selectedOrder.source],
                    [
                      "Tutar",
                      `${selectedOrder.total_amount} ${selectedOrder.currency}`,
                      selectedOrder.confirmation_status ?? "teyit bekliyor",
                    ],
                    ["Kargo", cargoProviderLabel(selectedOrder.cargo_provider), selectedOrder.created_by_user_email ?? "personel yok"],
                    ["Not", selectedOrder.notes ?? "-", selectedOrder.updated_at],
                  ]}
                />
              </DetailPanel>
            )}
          </FlowPanel>
        )}

        {activeFlow === "shipments" && (
          <FlowPanel title="Kargo Gönderileri" icon={<Truck size={18} />} testId="shipments-flow">
            <div className="report-grid">
              <Metric title="PTT Kargo" value={String(pttShipmentCount)} />
              <Metric title="Sürat Kargo" value={String(suratShipmentCount)} />
              <Metric title="Yoldaki Kargolar" value={String(activeShipmentCount)} />
              <Metric title="Teslim Edilen" value={String(deliveredShipmentCount)} />
            </div>
            <form className="filter-grid" onSubmit={(event) => void handleSearchShipments(event)}>
              <label className="field-label" htmlFor="shipment-search">
                Arama
              </label>
              <div className="search-row">
                <Search size={16} />
                <input
                  data-testid="shipment-search"
                  id="shipment-search"
                  placeholder="Takip no, müşteri veya sipariş ara..."
                  type="search"
                  value={shipmentSearch}
                  onChange={(event) => setShipmentSearch(event.target.value)}
                />
                <button className="secondary-action" type="submit">
                  Ara
                </button>
              </div>
            </form>
            <div className="detail-actions" data-testid="shipment-section-tabs">
              <button
                className={cx("secondary-action", shipmentFilter === "all" && "selected")}
                data-testid="shipment-filter-all"
                type="button"
                onClick={() => void handleApplyShipmentFilter("all")}
              >
                Tüm kargolar {shipmentFilter === "all" ? data.shipmentSummary.total_count : "sonuç"}
              </button>
              <button
                className={cx("secondary-action", shipmentFilter === "ptt" && "selected")}
                data-testid="shipment-filter-ptt"
                type="button"
                onClick={() => void handleApplyShipmentFilter("ptt")}
              >
                PTT {shipmentFilter === "all" || shipmentFilter === "ptt" ? pttShipmentCount : "sonuç"}
              </button>
              <button
                className={cx("secondary-action", shipmentFilter === "surat" && "selected")}
                data-testid="shipment-filter-surat"
                type="button"
                onClick={() => void handleApplyShipmentFilter("surat")}
              >
                Sürat {shipmentFilter === "all" || shipmentFilter === "surat" ? suratShipmentCount : "sonuç"}
              </button>
              <button
                className={cx("secondary-action", shipmentFilter === "other" && "selected")}
                data-testid="shipment-filter-other"
                type="button"
                onClick={() => void handleApplyShipmentFilter("other")}
              >
                Diğer {shipmentFilter === "all" || shipmentFilter === "other" ? otherShipmentCount : "sonuç"}
              </button>
              <button
                className={cx("secondary-action", shipmentFilter === "in_transit" && "selected")}
                data-testid="shipment-filter-in-transit"
                type="button"
                onClick={() => void handleApplyShipmentFilter("in_transit")}
              >
                Yoldaki {shipmentFilter === "all" || shipmentFilter === "in_transit" ? activeShipmentCount : "sonuç"}
              </button>
              <button
                className={cx("secondary-action", shipmentFilter === "delivered" && "selected")}
                data-testid="shipment-filter-delivered"
                type="button"
                onClick={() => void handleApplyShipmentFilter("delivered")}
              >
                Teslim {shipmentFilter === "all" || shipmentFilter === "delivered" ? deliveredShipmentCount : "sonuç"}
              </button>
              <button
                className={cx("secondary-action", shipmentFilter === "tracking_missing" && "selected")}
                data-testid="shipment-filter-tracking-missing"
                type="button"
                onClick={() => void handleApplyShipmentFilter("tracking_missing")}
              >
                Takipsiz {shipmentFilter === "all" || shipmentFilter === "tracking_missing" ? trackingMissingCount : "sonuç"}
              </button>
            </div>
            <DetailPanel title="Kargo Filtre Özeti" testId="shipment-filter-summary">
              <DataRows
                rows={[
                  ["Yeni", String(activeShipmentCount), "sevk/teslim bekliyor"],
                  ["PTT Almayan", String(pttNotDeliveredCount), "legacy filtre"],
                  ["Sürat Almayan", String(suratNotDeliveredCount), "legacy filtre"],
                  ["Takip No Yok", String(trackingMissingCount), "barkod kontrol"],
                ]}
              />
            </DetailPanel>
            <div className="table-wrap">
              <table className="data-table" data-testid="shipment-table">
                <thead>
                  <tr>
                    <th>Kargo Firma</th>
                    <th>Takip No / Aktar</th>
                    <th>Müşteri</th>
                    <th>Sipariş</th>
                    <th>Kargo Durumu</th>
                    <th>Aktarılma Tarihi</th>
                    <th>İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {data.shipments.length === 0 ? (
                    <tr>
                      <td colSpan={7}>Henüz kargoya aktarılmış sipariş bulunmuyor</td>
                    </tr>
                  ) : data.shipments.map((shipment) => (
                    <tr data-testid="shipment-row" key={shipment.public_id}>
                      <td>
                        <span className="status-pill">{cargoProviderLabel(shipment.provider)} Kargo</span>
                      </td>
                      <td>
                        <button
                          className="link-button"
                          data-testid="shipment-open-tracking"
                          type="button"
                          onClick={() => void handleOpenShipmentDetail(shipment.public_id)}
                        >
                          {shipment.tracking_number ?? shipment.barcode_number ?? "Takip No Yok"} detay
                        </button>
                        <span className="muted-line">{shipment.last_event_text ?? "Kargoya aktarıldı - hareket bekleniyor"}</span>
                      </td>
                      <td>
                        <strong>{shipment.recipient_name}</strong>
                        <span className="muted-line">
                          {[shipment.recipient_district, shipment.recipient_city].filter(Boolean).join(" / ") || shipment.customer_full_name || "-"}
                        </span>
                      </td>
                      <td>{shipment.order_number ?? shipment.customer_full_name ?? "-"}</td>
                      <td>{shipmentStatusLabel(shipment.status)}</td>
                      <td>{new Date(shipment.updated_at).toLocaleString("tr-TR")}</td>
                      <td>
                        <div className="icon-actions">
                          <button
                            aria-label="Detay"
                            className={cx("icon-button", selectedShipment?.public_id === shipment.public_id && "selected")}
                            data-testid="shipment-detail-action"
                            title="Detay"
                            type="button"
                            onClick={() => void handleOpenShipmentDetail(shipment.public_id)}
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            aria-label="Takip Güncelle"
                            className="icon-button"
                            data-testid="shipment-track-action"
                            disabled={trackingShipmentId === shipment.public_id || !shipment.tracking_number}
                            title="Takip Güncelle"
                            type="button"
                            onClick={() => void handleTrackShipment(shipment)}
                          >
                            <RefreshCw className={trackingShipmentId === shipment.public_id ? "spin" : undefined} size={16} />
                          </button>
                          <button
                            aria-label={selectedShipment?.public_id === shipment.public_id ? "Teslim edildi yap" : "Önce detay seç"}
                            className="icon-button"
                            data-testid="shipment-status-action"
                            disabled={selectedShipment?.public_id !== shipment.public_id}
                            title={selectedShipment?.public_id === shipment.public_id ? "Teslim edildi yap" : "Önce detay seç"}
                            type="button"
                            onClick={() => void handleUpdateShipment()}
                          >
                            <CheckCircle size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination-row" data-testid="shipment-pagination">
              <span>
                {shipmentOffsetStart}-{shipmentOffsetEnd} / {shipmentTotalCount}
              </span>
              <div className="detail-actions">
                <button
                  className="secondary-action"
                  data-testid="shipment-prev-page"
                  disabled={shipmentPage === 0}
                  type="button"
                  onClick={() => void handleShipmentPage(shipmentPage - 1)}
                >
                  Önceki
                </button>
                <span>Sayfa {shipmentPage + 1} / {shipmentPageCount}</span>
                <button
                  className="secondary-action"
                  data-testid="shipment-next-page"
                  disabled={shipmentPage + 1 >= shipmentPageCount}
                  type="button"
                  onClick={() => void handleShipmentPage(shipmentPage + 1)}
                >
                  Sonraki
                </button>
              </div>
            </div>
            {lastShipmentTrack && <p className="status-copy" data-testid="shipment-track-result">{lastShipmentTrack}</p>}
            {selectedShipment && (
              <DetailPanel title="Kargo Detayı" testId="shipment-detail">
                <DataRows
                  rows={[
                    ["Takip No", selectedShipment.tracking_number ?? "-", selectedShipment.provider],
                    ["Alıcı", selectedShipment.recipient_name, selectedShipment.recipient_phone ?? "-"],
                    [
                      "Adres",
                      [selectedShipment.recipient_district, selectedShipment.recipient_city].filter(Boolean).join(" / ") || "-",
                      selectedShipment.barcode_number ?? "-",
                    ],
                    ["Son Hareket", selectedShipment.last_event_text ?? "-", selectedShipment.status],
                    ["Sipariş", selectedShipment.order_number ?? "-", selectedShipment.customer_full_name ?? "-"],
                    ["Barkod", selectedShipment.barcode_number ?? "barkod bekliyor", "shipments API"],
                  ]}
                />
                <div className="timeline" data-testid="shipment-tracking-history">
                  <h3>Hareket Geçmişi</h3>
                  {(selectedShipment.tracking_events ?? []).length === 0 ? (
                    <p>Henüz hareket yok</p>
                  ) : (
                    selectedShipment.tracking_events.map((event) => (
                      <div className="timeline-item" key={event.public_id}>
                        <strong>{event.description ?? shipmentStatusLabel(event.status)}</strong>
                        <span>{event.location ?? "-"}</span>
                        <span>{new Date(event.occurred_at).toLocaleString("tr-TR")}</span>
                      </div>
                    ))
                  )}
                </div>
              </DetailPanel>
            )}
          </FlowPanel>
        )}

        {activeFlow === "shipmentPipeline" && (
          <FlowPanel title="Teslim Alınmayan Kargo Pipeline" icon={<Zap size={18} />} testId="shipment-pipeline-flow">
            <div className="report-grid">
              <Metric title="Bekliyor" value={String(pipelineWaitingCount)} />
              <Metric title="İşleniyor" value={String(pipelineProcessingCount)} />
              <Metric title="Hata" value={String(pipelineErrorCount)} />
              <Metric title="Teslim" value={String(pipelineDeliveredCount)} />
            </div>
            <div className="detail-actions" data-testid="shipment-pipeline-tabs">
              {shipmentPipelineFilters.map(({ value, label, count }) => (
                <button
                  key={value}
                  aria-pressed={shipmentPipelineFilter === value}
                  className={cx("secondary-action", shipmentPipelineFilter === value && "selected")}
                  data-testid={`shipment-pipeline-filter-${value}`}
                  type="button"
                  onClick={() => handleApplyShipmentPipelineFilter(value)}
                >
                  {label} {count}
                </button>
              ))}
            </div>
            <DetailPanel title="Mesaj SMS VAPI Akışı" testId="shipment-pipeline-detail">
              <DataRows
                rows={[
                  ["Kaynak", "shipments API", "legacy /kargo/pipeline"],
                  ["Akış", "Mesaj -> SMS -> VAPI", "backend verisi"],
                  ["Aktif sekme", shipmentPipelineFilter, `${visibleShipmentPipelineRows.length} kargo`],
                  ["Otomatik yenileme", "Socket.IO sonrası domain refresh", "Supabase channel yok"],
                  ["Canlı provider", "kapalı", "fixture/live gate kontrollü"],
                ]}
              />
            </DetailPanel>
            <DataRows
              rows={visibleShipmentPipelineRows.map((row) => [
                row.recipient_name,
                `${row.step} / ${row.pipeline_status}`,
                row.tracking_number ?? row.barcode_number ?? row.recipient_phone ?? "-",
              ])}
            />
          </FlowPanel>
        )}

        {activeFlow === "suratDebug" && (
          <FlowPanel title="Sürat Kargo Debug" icon={<Bug size={18} />} testId="surat-debug-flow">
            <div className="metrics-grid">
              <Metric title="Toplam" value={String(suratProviderDebug.total_attempts)} />
              <Metric title="Başarılı" value={String(suratSuccessCount)} />
              <Metric title="Hata" value={String(suratFailureCount)} />
              <Metric title="Retry" value={String(suratRetryCount)} />
              <Metric title="Ort. Süre" value={`${suratAverageDuration}ms`} />
            </div>
            <DetailPanel title="Sürat Kargo Debug Akışı" testId="surat-debug-detail">
              <DataRows
                rows={[
                  ["Kaynak", "provider attempts API", "legacy /api/surat-kargo/debug"],
                  [
                    "Canlı gate",
                    suratProviderCatalogItem?.live_call_permitted === false ? "kapalı" : "-",
                    suratProviderCatalogItem?.live_feature_flag_key ?? "-",
                  ],
                  [
                    "Sözleşme modu",
                    suratProviderCatalogItem?.contract_mode ?? "-",
                    suratProviderCatalogItem?.live_block_reason ?? "-",
                  ],
                  [
                    "Son endpoint",
                    latestSuratPreview ? `${latestSuratPreview.method} ${latestSuratPreview.path}` : "-",
                    latestSuratPreview?.live_call_performed === false ? "canlı çağrı yok" : "-",
                  ],
                  [
                    "Son durum",
                    latestSuratAttempt ? `${latestSuratAttempt.status} / ${latestSuratAttempt.retry_decision}` : "deneme yok",
                    latestSuratAttempt ? `${latestSuratAttempt.duration_ms}ms` : "-",
                  ],
                  ["Header", compactJson(latestSuratPreview?.headers), "redacted"],
                  ["Body", compactJson(latestSuratPreview?.body), "redacted"],
                ]}
              />
            </DetailPanel>
            <DataRows
              rows={suratProviderAttempts.map((attempt) => [
                `${attempt.operation} / ${attempt.direction}`,
                `${attempt.status} / ${attempt.retry_decision}`,
                `${attempt.provider_request_preview?.path ?? "-"} / ${attempt.duration_ms}ms`,
              ])}
            />
          </FlowPanel>
        )}

        {activeFlow === "cronDebug" && (
          <FlowPanel title="Kargo Takip Cron Debug" icon={<Bug size={18} />} testId="cron-debug-flow">
            <div className="metrics-grid">
              <Metric title="PTT Log" value={String(pttProviderDebug.total_attempts)} />
              <Metric title="Sürat Log" value={String(suratProviderDebug.total_attempts)} />
              <Metric title="Güncellenen" value={String(cronUpdatedCount)} />
              <Metric title="Hata" value={String(cronErrorCount)} />
              <Metric title="Atlanan" value={String(cronSkippedCount)} />
              <Metric title="Toplam Süre" value={`${cronTotalDuration}ms`} />
            </div>
            <div className="detail-actions" data-testid="cron-debug-actions">
              <button
                className="secondary-action"
                type="button"
                disabled={cronTriggeringProvider !== null}
                onClick={() => void handleTriggerProviderCron("ptt")}
              >
                {cronTriggeringProvider === "ptt" ? "PTT dry-run hazırlanıyor" : "PTT cron dry-run tetikle"}
              </button>
              <button
                className="secondary-action"
                type="button"
                disabled={cronTriggeringProvider !== null}
                onClick={() => void handleTriggerProviderCron("surat")}
              >
                {cronTriggeringProvider === "surat" ? "Sürat dry-run hazırlanıyor" : "Sürat cron dry-run tetikle"}
              </button>
            </div>
            <DetailPanel title="PTT + Sürat Cron Akışı" testId="cron-debug-detail">
              <DataRows
                rows={[
                  ["Kaynak", "provider attempts API", "legacy /api/ptt/cron-debug + /api/surat/cron-debug"],
                  [
                    "PTT gate",
                    pttProviderCatalogItem?.live_call_permitted === false ? "kapalı" : "-",
                    pttProviderCatalogItem?.live_feature_flag_key ?? "-",
                  ],
                  [
                    "Sürat gate",
                    suratProviderCatalogItem?.live_call_permitted === false ? "kapalı" : "-",
                    suratProviderCatalogItem?.live_feature_flag_key ?? "-",
                  ],
                  ["İşlem", "shipment.track", "cron-takip-guncelle canlı çağrı yok"],
                  ["Durum", `${cronUpdatedCount} güncellendi`, `${cronErrorCount} hata / ${cronSkippedCount} atlanan`],
                  ["Blok nedeni", "fixture_replay_contract_required", "live HTTP adapter kapalı"],
                ]}
              />
            </DetailPanel>
            <DataRows
              rows={trackingCronAttempts.map((attempt) => [
                `${attempt.provider_key.toUpperCase()} / ${attempt.request_id}`,
                `${attempt.status} / ${attempt.retry_decision}`,
                `${attempt.provider_request_preview?.path ?? "-"} / ${attempt.duration_ms}ms`,
              ])}
            />
          </FlowPanel>
        )}

        {activeFlow === "admin" && (
          <FlowPanel title="Admin Ayarları" icon={<Settings size={18} />} testId="admin-flow">
            <button className="primary-action" type="button" onClick={handleSaveProviderLiveGate}>
              PTT live gate kapalı kaydet
            </button>
            <button className="secondary-action" type="button" onClick={handleSaveOperationalPolicy}>
              Operasyon politikasını kaydet
            </button>
            <DataRows rows={activeSettings.map((setting) => [setting.key, setting.scope, JSON.stringify(setting.value)])} />
            <DetailPanel title="Operasyon Politikaları" testId="operation-policy-detail">
              <DataRows
                rows={[
                  ["Retry", `${operationalPolicy.max_attempts} deneme`, `${operationalPolicy.retry_delay_ms} ms bekleme`],
                  [
                    "Timeout",
                    `${operationalPolicy.request_timeout_ms} ms provider`,
                    `${operationalPolicy.webhook_timeout_ms} ms webhook`,
                  ],
                  [
                    "Rate Limit",
                    `${operationalPolicy.provider_rate_limit_per_minute}/dk`,
                    `queue concurrency ${operationalPolicy.queue_concurrency}`,
                  ],
                  [
                    "Storage",
                    operationalPolicy.storage_bucket,
                    `${operationalPolicy.lifecycle_days} gün / orphan cleanup ${
                      operationalPolicy.orphan_cleanup_enabled ? "açık" : "kapalı"
                    }`,
                  ],
                ]}
              />
            </DetailPanel>
            <DetailPanel title="Ayar Denetim Kayıtları" testId="settings-audit-detail">
              <DataRows
                rows={[
                  ["Kayıt", String(data.settingsAuditSummary.total_count), "settings audit summary"],
                  [
                    "Son işlem",
                    latestSettingsAudit ? `${latestSettingsAudit.action} / ${latestSettingsAudit.entity_type}` : "denetim yok",
                    latestSettingsAudit?.entity_id ?? "-",
                  ],
                  [
                    "Aktör",
                    latestSettingsAudit?.actor_user_id === null || latestSettingsAudit?.actor_user_id === undefined
                      ? "sistem"
                      : String(latestSettingsAudit.actor_user_id),
                    latestSettingsAudit?.created_at ?? "-",
                  ],
                  ["Eski", compactJson(latestSettingsAudit?.old_value), "redacted"],
                  ["Yeni", compactJson(latestSettingsAudit?.new_value), "redacted"],
                ]}
              />
            </DetailPanel>
          </FlowPanel>
        )}

        {activeFlow === "integrations" && (
          <FlowPanel title="Entegrasyon Hesapları" icon={<Settings size={18} />} testId="integrations-flow">
            <button className="primary-action" type="button" onClick={handleUpsertIntegrationAccount}>
              Instagram hesabı kaydet
            </button>
            <DataRows rows={data.integrationAccounts.map((account) => [account.provider_name, account.display_name, account.status])} />
            <DetailPanel title="Provider Canlı Mod Sınırları" testId="provider-catalog-detail">
              <DataRows
                rows={[
                  ["Katalog", String(data.providerCatalog.length), "backend provider catalog"],
                  [
                    "İlk provider",
                    selectedProviderCatalogItem?.provider ?? "-",
                    selectedProviderCatalogItem?.contract_mode ?? "-",
                  ],
                  [
                    "Canlı çağrı",
                    selectedProviderCatalogItem?.live_call_permitted === false ? "kapalı" : "-",
                    selectedProviderCatalogItem?.live_feature_flag_key ?? "-",
                  ],
                  [
                    "Blok nedeni",
                    selectedProviderCatalogItem?.live_block_reason ?? "-",
                    selectedProviderCatalogItem?.supported_operations.join(", ") ?? "-",
                  ],
                  ["Kanallar", data.providerCatalog.map((item) => item.channels.join("+")).join(" / "), "adapter sınırları"],
                  ["Providerlar", data.providerCatalog.map((item) => item.provider).join(", "), "canlı HTTP kapalı"],
                ]}
              />
            </DetailPanel>
            <DetailPanel title="Instagram Yayın Önizleme" testId="instagram-publish-preview">
              <DataRows
                rows={[
                  ["Fotoğraf URL", instagramDraftImageUrl, "Graph publish"],
                  ["Caption", instagramDraftCaption, `${instagramDraftCaption.length} / ${instagramCaptionLimit} karakter`],
                  ["Önizleme hesabı", integrationSnapshot?.account.display_name ?? "garantikulucka", "Instagram"],
                  ["Yayın modu", "taslak", "canlı provider kapalı"],
                  ["Son backend isteği", lastInstagramPublishPreview ?? "-", "provider attempt dry-run"],
                ]}
              />
              <button
                className="primary-action"
                type="button"
                disabled={instagramPublishPreviewing}
                onClick={() => void handleCreateInstagramPublishPreview()}
              >
                {instagramPublishPreviewing ? "Yayın dry-run hazırlanıyor" : "Instagram yayın dry-run hazırla"}
              </button>
            </DetailPanel>
            <DetailPanel title="Instagram Analitik Özeti" testId="instagram-analytics-summary">
              <DataRows
                rows={[
                  ["Takipçi", String(instagramAnalytics.followers), "backend snapshot"],
                  ["Erişim", String(instagramAnalytics.reach), "legacy analitik"],
                  ["Gösterim", String(instagramAnalytics.impressions), "legacy analitik"],
                  ["Profil Görüntüleme", String(instagramAnalytics.profileViews), `${instagramAnalytics.engagementRate}% etkileşim`],
                ]}
              />
            </DetailPanel>
            <DetailPanel title="Provider Deneme Kayıtları" testId="provider-attempts-detail">
              <DataRows
                rows={[
                  ["Kayıt", String(providerAttemptTotal), "provider debug summary API"],
                  [
                    "Son deneme",
                    selectedProviderAttempt
                      ? `${selectedProviderAttempt.provider_key} / ${selectedProviderAttempt.operation}`
                      : "deneme yok",
                    selectedProviderAttempt?.status ?? "-",
                  ],
                  [
                    "HTTP",
                    selectedProviderAttempt?.status_code === null || selectedProviderAttempt?.status_code === undefined
                      ? "-"
                      : String(selectedProviderAttempt.status_code),
                    selectedProviderAttempt ? `${selectedProviderAttempt.duration_ms} ms` : "-",
                  ],
                  [
                    "Retry",
                    selectedProviderAttempt?.retry_decision ?? "-",
                    selectedProviderAttempt?.next_retry_at ?? "yeniden deneme yok",
                  ],
                  [
                    "İstek",
                    selectedProviderAttempt?.request_id ?? "-",
                    selectedProviderAttempt?.idempotency_key ?? "idempotency yok",
                  ],
                  [
                    "Önizleme",
                    selectedProviderPreview
                      ? `${selectedProviderPreview.method} ${selectedProviderPreview.path}`
                      : "dry-run preview yok",
                    selectedProviderPreview?.live_call_performed === false ? "canlı çağrı yok" : "-",
                  ],
                  [
                    "Header",
                    compactJson(selectedProviderPreview?.headers),
                    "redacted",
                  ],
                  [
                    "Body",
                    compactJson(selectedProviderPreview?.body),
                    "redacted",
                  ],
                ]}
              />
            </DetailPanel>
            <DetailPanel title="Entegrasyon Denetim Kayıtları" testId="integration-audit-detail">
              <DataRows
                rows={[
                  ["Kayıt", String(data.integrationAuditSummary.total_count), "integration audit summary"],
                  [
                    "Son işlem",
                    latestIntegrationAudit
                      ? `${latestIntegrationAudit.action} / ${latestIntegrationAudit.entity_type}`
                      : "denetim yok",
                    latestIntegrationAudit?.entity_id ?? "-",
                  ],
                  [
                    "Aktör",
                    latestIntegrationAudit?.actor_user_id === null || latestIntegrationAudit?.actor_user_id === undefined
                      ? "sistem"
                      : String(latestIntegrationAudit.actor_user_id),
                    latestIntegrationAudit?.created_at ?? "-",
                  ],
                  ["Eski", compactJson(latestIntegrationAudit?.old_value), "redacted"],
                  ["Yeni", compactJson(latestIntegrationAudit?.new_value), "redacted"],
                ]}
              />
            </DetailPanel>
            <div className="integration-actions">
              {data.integrationAccounts.map((account) => (
                <button
                  className="secondary-action"
                  key={account.public_id}
                  type="button"
                  onClick={() => handleOpenIntegrationAccount(account.public_id)}
                >
                  {account.display_name} detay
                </button>
              ))}
              <button className="secondary-action" type="button" onClick={handleSaveIntegrationToken}>
                Access token kaydet
              </button>
              <button className="secondary-action" type="button" onClick={handleSaveIntegrationSetting}>
                Webhook ayarını kaydet
              </button>
            </div>
            {integrationSnapshot && (
              <div className="integration-detail" data-testid="integration-detail">
                <div>
                  <h2>{integrationSnapshot.account.display_name}</h2>
                  <p>{integrationSnapshot.account.external_account_id ?? "Harici hesap yok"}</p>
                </div>
                <DataRows
                  rows={[
                    ["Provider", integrationSnapshot.account.provider_name, integrationSnapshot.account.status],
                    ["Ayar", String(integrationSnapshot.settings.length), "backend snapshot"],
                    ["Token", String(integrationSnapshot.tokens.length), "value masked"],
                  ]}
                />
                <DataRows
                  rows={integrationSnapshot.settings.map((setting) => [
                    setting.key,
                    setting.is_secret ? "secret" : JSON.stringify(setting.value),
                    "backend setting",
                  ])}
                />
                <DataRows
                  rows={integrationSnapshot.tokens.map((token) => [
                    token.token_type,
                    token.expires_at ?? "süresiz",
                    token.value === null ? "maskeli" : "gizli veri gösterilmedi",
                  ])}
                />
              </div>
            )}
          </FlowPanel>
        )}

        {activeFlow === "comments" && (
          <FlowPanel title="Yorumlar" icon={<MessageSquareText size={18} />} testId="comments-flow">
            <div className="split-grid">
              <List title="Yorum Kuyruğu">
                {data.conversations.map((conversation) => (
                  <li key={conversation.public_id}>
                    <button
                      className={cx("conversation-button", selectedConversation?.public_id === conversation.public_id && "selected")}
                      type="button"
                      onClick={() => void handleSelectConversation(conversation.public_id)}
                    >
                      <strong>{conversation.customer?.full_name ?? conversation.public_id}</strong>
                      <span>{conversation.channel} / {conversation.status}</span>
                    </button>
                  </li>
                ))}
              </List>
              <DetailPanel title="Yorum AI Kuyruğu" testId="comments-ai-summary">
                <DataRows
                  rows={[
                    ["Manuel bekleyen", String(commentSummary.manualQueue), "legacy durum filtresi"],
                    ["Otomatik", String(commentSummary.automaticQueue), "AI pipeline"],
                    ["Cevaplı", String(commentSummary.answered), "moderasyon durumu"],
                    ["Instagram", String(commentSummary.instagram), "platform filtresi"],
                    ["Facebook", String(commentSummary.facebook), "platform filtresi"],
                    ["AI cevap tipi", "public", "admin ayarı"],
                  ]}
                />
              </DetailPanel>
              <DetailPanel title="Yorum Moderasyonu" testId="comments-detail">
                <DataRows
                  rows={[
                    ["Açık konuşma", String(openConversationCount), "conversation summary API"],
                    ["Okunmamış mesaj", String(unreadConversationCount), "conversation summary API"],
                    [
                      "Müşteri",
                      selectedConversation?.customer?.full_name ?? selectedConversation?.public_id ?? "-",
                      selectedConversation?.customer?.phone ?? "-",
                    ],
                    ["Son yorum", selectedConversation?.last_message_text ?? "-", selectedConversation?.channel ?? "-"],
                  ]}
                />
                {data.messages.map((message) => (
                  <article key={message.public_id}>
                    <strong>{message.sender_name ?? message.sender_type}</strong>
                    <span>{message.body ?? "Boş mesaj"}</span>
                  </article>
                ))}
              </DetailPanel>
            </div>
          </FlowPanel>
        )}

        {activeFlow === "customers" && (
          <FlowPanel title="Müşteriler" icon={<Users size={18} />} testId="customers-flow">
            <div className="report-grid">
              <Metric title="Müşteri" value={String(data.customerSummary.total_count)} />
              <Metric title="Telefon" value={String(customerWithPhoneCount)} />
              <Metric title="E-posta" value={String(customerWithEmailCount)} />
            </div>
            <DetailPanel title="Müşteri Listesi" testId="customers-list-detail">
              <DataRows
                rows={data.customers.map((customer) => [
                  customer.full_name,
                  customer.phone ?? customer.email ?? customer.username ?? "-",
                  customer.notes ?? "customers API",
                ])}
              />
            </DetailPanel>
            <DetailPanel title="Müşteri Kartı" testId="customer-card-detail">
              <DataRows
                rows={[
                  ["Seçili müşteri", selectedCustomer?.full_name ?? "-", selectedCustomer?.username ?? "-"],
                  ["Telefon", selectedCustomer?.phone ?? "-", "customers API"],
                  ["E-posta", selectedCustomer?.email ?? "-", selectedCustomer?.updated_at ?? "-"],
                  ["Notlu müşteri", String(customerWithNotesCount), "legacy müşteri notu"],
                ]}
              />
            </DetailPanel>
          </FlowPanel>
        )}

        {activeFlow === "cancellations" && (
          <FlowPanel title="İptaller" icon={<XCircle size={18} />} testId="cancellations-flow">
            <DataRows rows={data.orders.map((order) => [order.order_number, order.status, order.customer_full_name ?? "-"])} />
            <div className="detail-actions">
              {data.orders.map((order) => (
                <button
                  className={cx("secondary-action", selectedOrder?.public_id === order.public_id && "selected")}
                  key={order.public_id}
                  type="button"
                  onClick={() => setSelectedOrderId(order.public_id)}
                >
                  {order.order_number} incele
                </button>
              ))}
            </div>
            <DetailPanel title="İptal İncelemesi" testId="cancellation-detail">
              <DataRows
                rows={[
                  ["Sipariş kaydı", String(data.orderSummary.total_count), "orders summary API"],
                  ["Seçili sipariş", selectedOrder?.order_number ?? "-", selectedOrder?.customer_full_name ?? "-"],
                  ["Durum", selectedOrder?.status ?? "-", selectedOrder?.confirmation_status ?? "teyit bekliyor"],
                  ["Tutar", selectedOrder ? `${selectedOrder.total_amount} ${selectedOrder.currency}` : "-", selectedOrder?.source ?? "-"],
                  ["Not", selectedOrder?.notes ?? "-", "orders API"],
                ]}
              />
            </DetailPanel>
            <button className="primary-action" type="button" onClick={() => void handleCancelSelectedOrder()}>
              İptali onayla
            </button>
          </FlowPanel>
        )}

        {activeFlow === "inventory" && (
          <FlowPanel title="Stoklar" icon={<Package size={18} />} testId="inventory-flow">
            <div className="report-grid">
              <Metric title="Ürün" value={String(data.productSummary.total_count)} />
              <Metric title="Aktif Stok" value={String(activeProductCount)} />
              <Metric title="Kritik Stok" value={String(data.productSummary.critical_count)} />
            </div>
            <DetailPanel title="Stok Kategorileri" testId="inventory-categories">
              <DataRows
                rows={[
                  ["Kuluçka Makineleri", String(incubatorProductCount), "products API"],
                  ["Yedek Parçalar", String(sparePartProductCount), "products API"],
                  ["Diğer Malzemeler", String(otherProductCount), "products API"],
                ]}
              />
            </DetailPanel>
            <DetailPanel title="Ürün Stok Özeti" testId="inventory-products-detail">
              <DataRows
                rows={data.products.map((product) => [
                  product.name,
                  product.sku ?? "SKU yok",
                  `${product.stock_quantity} adet`,
                ])}
              />
              <DataRows
                rows={[
                  [
                    "Seçili ürün",
                    selectedProduct?.name ?? "-",
                    selectedProduct ? `${selectedProduct.unit_price} TRY` : "products API",
                  ],
                  [
                    "Kategori",
                    selectedProduct ? inventoryCategoryLabel(selectedProduct.category) : "-",
                    selectedProduct?.is_active ? "aktif" : "pasif",
                  ],
                  [
                    "Harici ürün",
                    selectedProduct?.external_product_id ?? "-",
                    selectedProduct?.updated_at ?? "-",
                  ],
                ]}
              />
            </DetailPanel>
            <DetailPanel title="Kritik Stok Takibi" testId="inventory-critical-stock">
              <DataRows
                rows={(criticalProducts.length > 0 ? criticalProducts : data.products.slice(0, 1)).map((product) => [
                  product.name,
                  `${product.stock_quantity} adet`,
                  product.stock_quantity <= data.productSummary.critical_threshold ? "kritik stok" : "normal stok",
                ])}
              />
            </DetailPanel>
            <DetailPanel title="Stok ve Sevkiyat Sinyali" testId="inventory-detail">
              <DataRows
                rows={[
                  ["Sipariş kaynaklı stok sinyali", String(data.orderSummary.total_count), "orders summary API"],
                  ["Son sipariş", selectedOrder?.order_number ?? "-", selectedOrder?.status ?? "-"],
                  ["Müşteri", selectedOrder?.customer_full_name ?? "-", selectedOrder?.source ?? "-"],
                  ["Depo entegrasyonu", data.shipmentSummary.total_count > 0 ? "sevkiyat bağlı" : "hazır", "shipments summary API"],
                ]}
              />
            </DetailPanel>
          </FlowPanel>
        )}

        {activeFlow === "balances" && (
          <FlowPanel title="Bakiyeler" icon={<Wallet size={18} />} testId="balances-flow">
            <div className="report-grid">
              <Metric title="Görünür Ayar" value={String(activeSettings.length)} />
              <Metric title="Sipariş Tutarı" value={formatMoney(data.orderSummary.total_revenue, data.orderSummary.currency)} />
              <Metric title="Para Birimi" value={data.orderSummary.currency} />
            </div>
            <DetailPanel title="Bakiye Özeti" testId="balances-detail">
              <DataRows
                rows={[
                  ["Görünür ayar", String(activeSettings.length), "admin settings"],
                  ["Para birimi", data.orderSummary.currency, "orders summary API"],
                  ["Son sipariş", selectedOrder?.order_number ?? "-", selectedOrder ? `${selectedOrder.total_amount} ${selectedOrder.currency}` : "-"],
                  ["Teyit bekleyen", String(data.orderSummary.pending_confirmation_count), "orders summary API"],
                ]}
              />
            </DetailPanel>
            <DetailPanel title="Ödeme İsteği Kuyruğu" testId="balance-payment-detail">
              <DataRows
                rows={[
                  ["Toplam komisyon", formatMoney(balanceSummary.totalCommission, data.orderSummary.currency), "legacy bakiye"],
                  ["Kesinti", formatMoney(balanceSummary.totalDeduction, data.orderSummary.currency), "iptal/iade"],
                  ["Bekleyen ödeme", formatMoney(balanceSummary.pendingPayment, data.orderSummary.currency), `${balanceSummary.pendingRequestCount} talep`],
                  ["Kullanılabilir bakiye", formatMoney(balanceSummary.availableBalance, data.orderSummary.currency), "ödeme isteği sonrası"],
                  ["Son ödeme isteği", selectedOrder?.order_number ?? "-", selectedOrder?.customer_full_name ?? "-"],
                  ["Son backend isteği", lastPaymentRequest ?? "-", "canlı ödeme provider kapalı"],
                ]}
              />
              <button className="primary-action" type="button" disabled={paymentRequesting} onClick={() => void handleRequestPayment()}>
                {paymentRequesting ? "Ödeme isteği hazırlanıyor" : "Ödeme isteği oluştur"}
              </button>
            </DetailPanel>
          </FlowPanel>
        )}

        {activeFlow === "sms" && (
          <FlowPanel title="SMS" icon={<MessageSquare size={18} />} testId="sms-flow">
            <DetailPanel title="Manuel SMS Şablonu" testId="sms-template-detail">
              <DataRows
                rows={[
                  ["Şablon", smsTemplate, "değişkenli mesaj"],
                  ["Önizleme", smsPreview, smsInfo.usesUnicode ? "Türkçe karakter" : "GSM karakter"],
                  ["Seçili değişken", activeSmsTemplateVariable, activeSmsTemplateValue],
                  ["Sayaç", `${smsInfo.length} karakter`, `${smsInfo.segmentCount} SMS`],
                ]}
              />
              <p className="detail-note" data-testid="sms-template-selected-variable">
                {activeSmsTemplateVariable}: {activeSmsTemplateValue}
              </p>
              <div className="detail-actions">
                {smsTemplateVariables.map((variable) => (
                  <button
                    aria-pressed={activeSmsTemplateVariable === variable}
                    className={cx("secondary-action", activeSmsTemplateVariable === variable && "selected")}
                    data-testid={`sms-template-variable-${variable.slice(1, -1).replaceAll("_", "-")}`}
                    key={variable}
                    type="button"
                    onClick={() => setActiveSmsTemplateVariable(variable)}
                  >
                    {variable}
                  </button>
                ))}
                <button className="primary-action" type="button" onClick={() => void handleSendSms()}>
                  SMS gönder
                </button>
              </div>
            </DetailPanel>
            <DetailPanel title="SMS Gönderim Kayıtları" testId="sms-history-detail">
              <DataRows
                rows={[
                  ["Alıcı listesi", `${smsRecipientCount} alıcı`, "shipments API"],
                  ["Seçili alıcı", selectedShipment?.recipient_phone ?? "-", selectedShipment?.recipient_name ?? "-"],
                  ["Son taslak", smsPreview, `${smsInfo.segmentCount} SMS`],
                  ["Şablon durumu", "aktif", "manuel gönderim"],
                  ["Son gönderim", lastSmsSend ?? "-", "provider-delivery API"],
                ]}
              />
            </DetailPanel>
            <DetailPanel title="Otomatik Teyit Araması" testId="sms-confirmation-detail">
              <DataRows
                rows={[
                  ["Durum", netgsmSettings.aktif ? "aktif" : "kapalı", "admin settings"],
                  ["İlk arama", `${netgsmSettings.ilk_arama_dakika} dakika`, "sipariş sonrası"],
                  ["Maksimum deneme", `${netgsmSettings.max_deneme} kez`, `${netgsmSettings.deneme_arasi_dakika} dakika arayla`],
                  ["Müşteri telefonu", selectedShipment?.recipient_phone ?? "-", "shipments API"],
                ]}
              />
              {netgsmSettings.aktif && (
                <p className="detail-note">
                  Sipariş oluşturulduktan {netgsmSettings.ilk_arama_dakika} dakika sonra aranacak.
                </p>
              )}
              {user?.role === "admin" && (
                <button className="primary-action" type="button" onClick={handleSaveNetgsmSettings}>
                  NetGSM teyit ayarını kaydet
                </button>
              )}
            </DetailPanel>
          </FlowPanel>
        )}

        {activeFlow === "calls" && (
          <FlowPanel title="Arama" icon={<Phone size={18} />} testId="calls-flow">
            <DetailPanel title="Santral Sunucu Bilgileri" testId="sip-config-detail">
              <DataRows
                rows={[
                  ["WebSocket", sipServerSettings.ws_url || "-", "admin settings"],
                  ["Domain", sipServerSettings.domain || "-", "webphone API"],
                  ["STUN", sipServerSettings.stun, "browser WebRTC"],
                  ["Transport", data.webphone?.transport ?? "-", data.webphone?.enabled ? "aktif" : "kapalı"],
                ]}
              />
              <button className="primary-action" type="button" onClick={handleSaveSipConfig}>
                Santral ayarını kaydet
              </button>
            </DetailPanel>
          </FlowPanel>
        )}

        {activeFlow === "vapi" && (
          <FlowPanel title="VAPI AI" icon={<Bot size={18} />} testId="vapi-flow">
            <DetailPanel title="AI ve SIP Sınırı" testId="vapi-detail">
              <DataRows
                rows={[
                  ["SIP sınırı", data.webphone?.enabled ? "aktif" : "kapalı", "webphone API"],
                  ["SIP domain", data.webphone?.sip_domain ?? "-", data.webphone?.transport ?? "-"],
                  ["Kullanıcı", data.webphone?.sip_username ?? user?.sip_username ?? "-", "webphone API"],
                  ["Model ayarı", activeSettings.find((setting) => setting.key.includes("ai"))?.key ?? "AI model ayarı tanımlı değil", "settings API"],
                ]}
              />
            </DetailPanel>
            <DetailPanel title="Hızlı Test Araması" testId="vapi-test-call-detail">
              <div className="detail-actions">
                <input
                  aria-label="VAPI test müşteri adı"
                  className="inline-input"
                  value={vapiTestCustomerName}
                  onChange={(event) => setVapiTestCustomerName(event.currentTarget.value)}
                />
                <input
                  aria-label="VAPI test telefon"
                  className="inline-input"
                  value={vapiTestPhone}
                  onChange={(event) => setVapiTestPhone(event.currentTarget.value)}
                />
                <button
                  className="primary-action"
                  type="button"
                  disabled={vapiTestCalling || !vapiTestPhone.trim()}
                  onClick={() => void handleCreateVapiTestCall()}
                >
                  {vapiTestCalling ? "Test araması hazırlanıyor" : "VAPI test araması hazırla"}
                </button>
              </div>
              <DataRows
                rows={[
                  ["Senaryo", "PTT / şubede bekliyor", selectedShipment?.tracking_number ?? "279172790012"],
                  ["Son backend isteği", lastVapiTestCall ?? "-", "provider attempt dry-run"],
                  ["Canlı çağrı", "kapalı", "fixture replay gerekli"],
                ]}
              />
            </DetailPanel>
          </FlowPanel>
        )}

        {activeFlow === "reports" && (
          <FlowPanel title="İş Analizi" icon={<BarChart3 size={18} />} testId="reports-flow">
            <div className="report-grid">
              <Metric title="Konuşma" value={String(data.reportSummary.conversation_count)} />
              <Metric title="Sipariş" value={String(data.reportSummary.order_count)} />
              <Metric title="Kargo" value={String(data.reportSummary.shipment_count)} />
              <Metric title="Ciro" value={formatMoney(data.reportSummary.total_revenue, data.reportSummary.currency)} />
            </div>
            <DetailPanel title="Operasyon Dağılımı" testId="reports-detail">
              <DataRows
                rows={[
                  ["Açık konuşma", String(data.reportSummary.open_conversation_count), "reports API"],
                  ["Teyit bekleyen", String(data.reportSummary.pending_confirmation_count), "reports API"],
                  ["Aktif kargo", String(data.reportSummary.active_shipment_count), "reports API"],
                  ["Teslim edilen", String(data.reportSummary.delivered_shipment_count), "reports API"],
                ]}
              />
            </DetailPanel>
            <DetailPanel title="Oran Özeti" testId="reports-ratio-summary">
              <DataRows
                rows={[
                  ["Teslim Oranı", `%${data.reportSummary.delivered_shipment_rate}`, "teslim / toplam kargo"],
                  ["Teyit Oranı", `%${data.reportSummary.confirmation_rate}`, `${data.reportSummary.pending_confirmation_count} teyit bekliyor`],
                  ["Kargo Hareketi", `%${data.reportSummary.active_shipment_rate}`, "aktif / toplam kargo"],
                ]}
              />
            </DetailPanel>
          </FlowPanel>
        )}

        {activeFlow === "files" && (
          <FlowPanel title="Dosya Upload" icon={<FileUp size={18} />} testId="file-upload-flow">
            <button className="primary-action" type="button" onClick={handleUpload}>
              Presigned Upload Testi
            </button>
            {uploadedFile && <p className="result-line">{uploadedFile.original_name} kaydedildi</p>}
            {uploadedFile && (
              <DetailPanel title="Dosya Doğrulama" testId="file-metadata-detail">
                <DataRows
                  rows={[
                    ["Bucket", uploadedFile.bucket, "files API"],
                    ["Object key", uploadedFile.object_key, uploadedFile.mime_type ?? "-"],
                    ["Boyut", uploadedFile.byte_size === null ? "-" : `${uploadedFile.byte_size} byte`, uploadedFile.checksum ?? "-"],
                    ["Kayıt", uploadedFile.public_id, uploadedFile.updated_at],
                  ]}
                />
              </DetailPanel>
            )}
            {downloadInstruction && (
              <DetailPanel title="Dosya İndirme" testId="file-download-detail">
                <DataRows
                  rows={[
                    ["Method", downloadInstruction.method, "presigned download"],
                    ["Bucket", downloadInstruction.bucket, downloadInstruction.object_key],
                    ["URL", downloadInstruction.presigned_url ? "hazır" : "kapalı", downloadInstruction.expires_at ?? "-"],
                  ]}
                />
              </DetailPanel>
            )}
            {user?.role === "admin" && (
              <DetailPanel title="Orphan Dosya Adayları" testId="file-orphans-detail">
                <button
                  className="primary-action"
                  type="button"
                  disabled={orphanCleanupPreviewing || data.fileOrphans.length === 0}
                  onClick={() => void handlePrepareOrphanCleanupDryRun()}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {orphanCleanupPreviewing ? "Lifecycle dry-run hazırlanıyor" : "Orphan cleanup dry-run hazırla"}
                </button>
                <DataRows
                  rows={[
                    ["Aday", String(data.fileOrphanSummary.total_count), "files orphan summary"],
                    ...data.fileOrphans.map((file) => [
                      file.original_name ?? file.public_id,
                      file.object_key,
                      file.byte_size === null ? "boyut yok" : `${file.byte_size} byte`,
                    ]),
                  ]}
                />
                {orphanCleanupPreview && (
                  <DataRows
                    rows={[
                      ["Son dry-run", orphanCleanupPreview.request_id, orphanCleanupPreview.mode],
                      ["Silme", orphanCleanupPreview.deletion_performed ? "yapıldı" : "yapılmadı", orphanCleanupPreview.reason ?? "-"],
                      [
                        "Storage",
                        orphanCleanupPreview.storage_action.bucket,
                        `${orphanCleanupPreview.storage_action.operation} ${orphanCleanupPreview.storage_action.object_key}`,
                      ],
                    ]}
                  />
                )}
              </DetailPanel>
            )}
          </FlowPanel>
        )}

        {activeFlow === "webphone" && (
          <FlowPanel title="Webphone" icon={<Headphones size={18} />} testId="webphone-flow">
            <div className="webphone-card">
              <Boxes size={22} aria-hidden="true" />
              <div>
                <strong>{data.webphone?.enabled ? "Santral aktif" : "Santral kapalı"}</strong>
                <span>{data.webphone?.sip_domain ?? "SIP domain yok"}</span>
              </div>
            </div>
          </FlowPanel>
        )}
      </main>
    </div>
  );
}

function publicPageFromPath(pathname: string) {
  if (pathname === "/gizlilik-politikasi") return "privacy";
  if (pathname === "/kullanim-kosullari") return "terms";
  if (pathname === "/veri-silme") return "deletion";
  return null;
}

function PublicPage(props: { page: "privacy" | "terms" | "deletion" }) {
  const content = {
    privacy: {
      title: "Gizlilik Politikası",
      subtitle: "Privacy Policy",
      icon: <Shield size={20} aria-hidden="true" />,
      rows: [
        ["Veri kapsamı", "Müşteri iletişimi, sipariş, kargo ve destek kayıtları"],
        ["Altyapı", "Backend API, production object storage ve provider adapter sınırları"],
        ["Erişim", "Rol bazlı panel oturumu ve denetlenebilir admin ayarları"],
      ],
    },
    terms: {
      title: "Kullanım Koşulları",
      subtitle: "Terms of Service",
      icon: <FileText size={20} aria-hidden="true" />,
      rows: [
        ["Hizmet", "Mesaj, sipariş, kargo, dosya ve santral operasyon paneli"],
        ["Kullanım", "Yetkili kullanıcılar yalnızca iş süreçleri için erişebilir"],
        ["Sağlayıcılar", "PTT, Sürat, KolayBi, Meta, NetGSM ve SIP/Vapi sınırları"],
      ],
    },
    deletion: {
      title: "Veri Silme Talebi",
      subtitle: "Data Deletion",
      icon: <Trash2 size={20} aria-hidden="true" />,
      rows: [
        ["Talep", "Müşteri kimliği ve iletişim kanalıyla operasyon ekibine iletilir"],
        ["Süreç", "Kayıtlar yasal saklama ve provider zorunluluklarına göre incelenir"],
        ["Durum", "Talep sonucu kayıtlı iletişim kanalı üzerinden bildirilir"],
      ],
    },
  }[props.page];

  return (
    <main className="public-page" data-testid={`${props.page}-public-page`}>
      <section className="public-card">
        <NavLink className="back-link" to="/giris">
          <ArrowLeft size={16} aria-hidden="true" />
          Giriş sayfasına dön
        </NavLink>
        <div className="public-title">
          <span className="public-icon">{content.icon}</span>
          <div>
            <h1>{content.title}</h1>
            <p>{content.subtitle}</p>
          </div>
        </div>
        <DataRows rows={content.rows} />
      </section>
    </main>
  );
}

function ResetPasswordScreen() {
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={handleSubmit} data-testid="reset-password-flow">
        <NavLink className="back-link" to="/giris">
          <ArrowLeft size={16} aria-hidden="true" />
          Giriş sayfasına dön
        </NavLink>
        <div className="brand large">
          <span className="brand-mark">G</span>
          <span>Şifre sıfırlama</span>
        </div>
        {submitted ? (
          <p className="success-line">
            <CheckCircle size={16} aria-hidden="true" />
            Sıfırlama talebi backend auth akışına kaydedildi.
          </p>
        ) : (
          <>
            <label>
              E-posta
              <input name="email" type="email" defaultValue="admin@example.com" />
            </label>
            <button className="primary-action" type="submit">
              Sıfırlama bağlantısı gönder
            </button>
          </>
        )}
      </form>
    </main>
  );
}

function LoginScreen(props: { onLogin: (event: FormEvent<HTMLFormElement>) => void; status: string }) {
  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={props.onLogin}>
        <div className="brand large">
          <span className="brand-mark">G</span>
          <span>Garanti Kuluçka</span>
        </div>
        <label>
          E-posta
          <input name="email" defaultValue="admin@example.com" type="email" />
        </label>
        <label>
          Şifre
          <input name="password" defaultValue="password" type="password" />
        </label>
        <button className="primary-action" type="submit">
          <LogIn size={16} aria-hidden="true" />
          Giriş yap
        </button>
        <div className="auth-links">
          <NavLink to="/sifre-sifirla">Şifremi unuttum</NavLink>
          <NavLink to="/gizlilik-politikasi">Gizlilik Politikası</NavLink>
          <NavLink to="/kullanim-kosullari">Kullanım Koşulları</NavLink>
          <NavLink to="/veri-silme">Veri Silme Talebi</NavLink>
        </div>
        <p aria-live="polite">{props.status}</p>
      </form>
    </main>
  );
}

function FlowPanel(props: { title: string; icon: ReactNode; testId: string; children: ReactNode }) {
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

function DetailPanel(props: { title: string; testId: string; children: ReactNode }) {
  return (
    <section className="detail-panel" data-testid={props.testId}>
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}

function List(props: { title: string; children: ReactNode; testId?: string }) {
  return (
    <div className="list-panel" data-testid={props.testId}>
      <h2>{props.title}</h2>
      <ul>{props.children}</ul>
    </div>
  );
}

function Metric(props: { title: string; value: string }) {
  return (
    <div className="metric">
      <span>{props.title}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function DataRows(props: { rows: string[][] }) {
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
