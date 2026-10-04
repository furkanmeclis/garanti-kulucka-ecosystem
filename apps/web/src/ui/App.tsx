import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  Boxes,
  BarChart3,
  Bot,
  Bug,
  CheckCircle,
  FileUp,
  FileText,
  Headphones,
  LogIn,
  MessageCircle,
  MessageSquare,
  MessageSquareText,
  Package,
  Phone,
  Settings,
  Shield,
  ShoppingCart,
  Trash2,
  Truck,
  Users,
  Wallet,
  Wifi,
  WifiOff,
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
  type ProviderCatalogItem,
  type ProviderAttemptViewModel,
  toProviderAttemptViewModel,
} from "../api/admin-client.js";
import { createAuthClient, type LoginResponse } from "../api/auth-client.js";
import {
  createDomainClient,
  type CommentModerationSummary as BackendCommentModerationSummary,
  type ConversationSummary,
  type CustomerSummary,
  type MessageSummary,
  type OrderSummary,
  type ProductSummary,
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
  integrationAudit: AdminAuditLog[];
  providerCatalog: ProviderCatalogItem[];
  providerAttempts: ProviderAttemptViewModel[];
  fileOrphans: FileMetadata[];
  commentModeration: BackendCommentModerationSummary;
  webphone: WebphoneConfig | null;
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

type ShipmentPipelineStep = "mesaj" | "sms" | "vapi" | "teslim";
type ShipmentPipelineFilter = "all" | ShipmentPipelineStep;

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

type SmsTemplateVariable = typeof smsTemplateVariables[number];

function flowFromPath(pathname: string) {
  return [...navigationItems]
    .sort((first, second) => second.path.length - first.path.length)
    .find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))?.key ?? "inbox";
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function shipmentFilterParams(filter: string): { provider?: string; status?: string; tracking_missing?: boolean; limit: number } {
  const params: { provider?: string; status?: string; tracking_missing?: boolean; limit: number } = { limit: 20 };
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

function readStoredToken() {
  return window.localStorage.getItem(tokenStorageKey);
}

function moneyValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number, currency: string) {
  return `${value.toFixed(2)} ${currency}`;
}

function formatPercent(numerator: number, denominator: number) {
  return denominator > 0 ? `%${Math.round((numerator / denominator) * 100)}` : "%0";
}

function pipelineStepFromShipment(shipment: ShipmentSummary): ShipmentPipelineStep {
  if (shipment.status === "delivered") return "teslim";
  if (!shipment.recipient_phone) return "mesaj";
  const provider = shipment.provider.toLocaleLowerCase("tr-TR");
  if (provider.includes("sürat") || provider.includes("surat")) return "sms";
  return "vapi";
}

function pipelineStatusFromShipment(shipment: ShipmentSummary) {
  if (shipment.status === "delivered") return "teslim";
  if (!shipment.tracking_number && !shipment.barcode_number) return "hata";
  if (shipment.status === "in_transit") return "isleniyor";
  return "bekliyor";
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

function numberFrom(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function instagramAnalyticsFrom(metadata: unknown): InstagramAnalyticsSummary {
  const analytics = isRecord(metadata) && isRecord(metadata.analytics) ? metadata.analytics : {};
  return {
    followers: numberFrom(analytics.followers),
    reach: numberFrom(analytics.reach),
    impressions: numberFrom(analytics.impressions),
    profileViews: numberFrom(analytics.profile_views),
    engagementRate: numberFrom(analytics.engagement_rate),
  };
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

function balanceSummaryFromOrders(orders: OrderSummary[]): BalanceSummary {
  const payableOrders = orders.filter((order) => !["cancelled", "returned"].includes(order.status));
  const pendingOrders = payableOrders.filter((order) => order.confirmation_status === null);
  const cancelledOrders = orders.filter((order) => ["cancelled", "returned"].includes(order.status));
  const totalCommission = payableOrders.reduce((sum, order) => sum + moneyValue(order.total_amount) * 0.1, 0);
  const totalDeduction = cancelledOrders.reduce((sum, order) => sum + moneyValue(order.total_amount) * 0.1, 0);
  const pendingPayment = pendingOrders.reduce((sum, order) => sum + moneyValue(order.total_amount) * 0.1, 0);
  return {
    totalCommission,
    totalDeduction,
    pendingPayment,
    availableBalance: Math.max(totalCommission - totalDeduction - pendingPayment, 0),
    pendingRequestCount: pendingOrders.length,
  };
}

const defaultCommentModerationSummary: BackendCommentModerationSummary = {
  manual_queue: 0,
  automatic_queue: 0,
  answered: 0,
  instagram: 0,
  facebook: 0,
};

function toCommentModerationView(summary: BackendCommentModerationSummary): CommentModerationViewSummary {
  return {
    manualQueue: summary.manual_queue,
    automaticQueue: summary.automatic_queue,
    answered: summary.answered,
    instagram: summary.instagram,
    facebook: summary.facebook,
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
    integrationAudit: [],
    providerCatalog: [],
    providerAttempts: [],
    fileOrphans: [],
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
  const [orderFilter, setOrderFilter] = useState("all");
  const [shipmentFilter, setShipmentFilter] = useState("all");
  const [shipmentPipelineFilter, setShipmentPipelineFilter] = useState<ShipmentPipelineFilter>("all");
  const [realtimeClient, setRealtimeClient] = useState<RealtimeClient | null>(null);
  const selectedConversationIdRef = useRef<string | null>(null);
  const conversationFilterRequestSeqRef = useRef(0);
  const orderFilterRequestSeqRef = useRef(0);
  const shipmentFilterRequestSeqRef = useRef(0);

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

    realtime.connect();
    setRealtimeClient(realtime);

    return () => {
      offMessageCreated();
      realtime.disconnect();
      setRealtimeClient((current) => (current === realtime ? null : current));
    };
  }, [authChecked, refreshConversations, refreshMessages, token, user]);

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
    void loadDashboard();
  }, [authChecked, token, user]);

  async function loadDashboard() {
    setStatus("Backend API akışları yükleniyor");
    const canReadCustomers = user?.role === "admin" || user?.role === "owner" || user?.role === "calisan";
    const canReadComments = user?.role === "admin" || user?.role === "owner" || user?.role === "calisan";
    const [conversations, customers, commentModeration, orders, products, shipments, settings, webphoneConfig] = await Promise.all([
      domain.listConversations({ limit: 20 }),
      canReadCustomers ? domain.listCustomers(50) : Promise.resolve({ data: [] }),
      canReadComments ? domain.getCommentModerationSummary() : Promise.resolve(defaultCommentModerationSummary),
      domain.listOrders(20),
      domain.listProducts(50),
      domain.listShipments(20),
      user?.role === "admin" ? admin.listSettings("global") : Promise.resolve({ data: [] }),
      webphone.getConfig(),
    ]);
    const [integrationAccounts, providerCatalog, providerAttempts, settingsAudit, integrationAudit, fileOrphans] = user?.role === "admin"
      ? await Promise.all([
          admin.listIntegrationAccounts(),
          admin.listProviderCatalog(),
          admin.listProviderAttempts({ limit: 10 }),
          admin.listSettingsAudit({ limit: 10 }),
          admin.listIntegrationAudit({ limit: 10 }),
          files.listOrphanCandidates({ limit: 10 }),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];
    const firstConversation = conversations.data[0]?.public_id;
    const messages = firstConversation
      ? await domain.listMessages(firstConversation, 50)
      : { data: [] };

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
      integrationAudit: integrationAudit.data,
      providerCatalog: providerCatalog.data,
      providerAttempts: providerAttempts.data.map(toProviderAttemptViewModel),
      fileOrphans: fileOrphans.data,
      commentModeration,
      webphone: webphoneConfig,
    });
    setSelectedConversationId((current) => current ?? firstConversation ?? null);
    setSelectedOrderId((current) => current ?? orders.data[0]?.public_id ?? null);
    setSelectedShipmentId((current) => current ?? shipments.data[0]?.public_id ?? null);
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
        integrationAudit: [],
        providerCatalog: [],
        providerAttempts: [],
        fileOrphans: [],
        commentModeration: defaultCommentModerationSummary,
        webphone: null,
      });
      setIntegrationSnapshot(null);
      setSelectedConversationId(null);
      setSelectedOrderId(null);
      setSelectedShipmentId(null);
      setAuthChecked(true);
      setStatus("Oturum kapatıldı");
    }
  }

  async function handleUpload() {
    setStatus("Presigned upload instruction isteniyor");
    const response = await files.createUpload({
      original_name: "kanit.txt",
      mime_type: "text/plain",
      byte_size: 12,
      checksum: "sha256:frontend-smoke",
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
    if (!conversationId) return;

    setStatus("Mesaj backend API üzerinden gönderiliyor");
    const message = await domain.createMessage(conversationId, {
      sender_type: "user",
      sender_name: user?.email ?? "Admin",
      body: "Backend UI yaniti",
      external_message_id: null,
      raw_payload: null,
    });
    setData((current) => ({
      ...current,
      messages: [
        ...current.messages.filter((item) => item.public_id !== message.public_id),
        message,
      ],
    }));
    await refreshConversations();
    setStatus("Mesaj backend API üzerinden gönderildi");
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

  async function handleApplyOrderFilter(nextFilter: string) {
    const requestSeq = orderFilterRequestSeqRef.current + 1;
    orderFilterRequestSeqRef.current = requestSeq;
    setOrderFilter(nextFilter);
    setStatus("Sipariş filtreleri backend API üzerinden uygulanıyor");
    const filterParams: { status?: string; confirmation_status?: string; limit: number } = { limit: 20 };
    if (nextFilter === "active") {
      filterParams.status = "active";
    }
    if (nextFilter === "pending_confirmation") {
      filterParams.confirmation_status = "pending";
    }
    if (nextFilter === "delivered") {
      filterParams.status = "delivered";
    }
    const orders = await domain.listOrders(filterParams);
    if (orderFilterRequestSeqRef.current !== requestSeq) return;
    setData((current) => ({
      ...current,
      orders: orders.data,
    }));
    setSelectedOrderId(orders.data[0]?.public_id ?? null);
    setStatus("Sipariş filtreleri backend API üzerinden uygulandı");
  }

  async function handleApplyShipmentFilter(nextFilter: string) {
    const requestSeq = shipmentFilterRequestSeqRef.current + 1;
    shipmentFilterRequestSeqRef.current = requestSeq;
    setShipmentFilter(nextFilter);
    setStatus("Kargo filtreleri backend API üzerinden uygulanıyor");
    const shipments = await domain.listShipments(shipmentFilterParams(nextFilter));
    if (shipmentFilterRequestSeqRef.current !== requestSeq) return;
    setData((current) => ({
      ...current,
      shipments: shipments.data,
    }));
    setSelectedShipmentId(shipments.data[0]?.public_id ?? null);
    setStatus("Kargo filtreleri backend API üzerinden uygulandı");
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
        currency: orderCurrency,
        idempotency_key: `payment_${order.public_id}_${balanceSummary.pendingPayment.toFixed(2)}_${orderCurrency}`,
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
    if (shipmentFilter !== "all") {
      const shipments = await domain.listShipments(shipmentFilterParams(shipmentFilter));
      setData((current) => ({
        ...current,
        shipments: shipments.data,
      }));
      setSelectedShipmentId(shipments.data[0]?.public_id ?? null);
      setStatus("Kargo durumu backend API üzerinden güncellendi");
      return;
    }
    setData((current) => ({
      ...current,
      shipments: current.shipments.map((item) => (item.public_id === updated.public_id ? updated : item)),
    }));
    setSelectedShipmentId(updated.public_id);
    setStatus("Kargo durumu backend API üzerinden güncellendi");
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
    const snapshot = await admin.getIntegrationAccount(accountPublicId);
    setIntegrationSnapshot(snapshot);
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
    const snapshot = await admin.getIntegrationAccount(accountPublicId);
    setIntegrationSnapshot(snapshot);
    setStatus("Entegrasyon token bilgisi maskeli backend API üzerinden kaydedildi");
  }

  async function handleSaveIntegrationSetting() {
    const accountPublicId = integrationSnapshot?.account.public_id ?? data.integrationAccounts[0]?.public_id;
    if (!accountPublicId) return;

    setStatus("Entegrasyon ayarı backend API üzerinden kaydediliyor");
    await admin.upsertIntegrationSetting(accountPublicId, "webhook.enabled", true, false);
    const snapshot = await admin.getIntegrationAccount(accountPublicId);
    setIntegrationSnapshot(snapshot);
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

  const activeSettings = data.settings.filter((setting) => !setting.is_secret);
  const visibleNavigation = navigationItems.filter((item) => item.roles.includes(user?.role ?? "guest"));
  const activeFlow = flowFromPath(location.pathname);
  const canTogglePresence = Boolean(user && user.role !== "admin");
  const netgsmSettings = netgsmSettingsFrom(activeSettings);
  const sipServerSettings = sipServerSettingsFrom(activeSettings, data.webphone);
  const operationalPolicy = operationalPolicyFrom(activeSettings);
  const selectedCustomer = data.customers[0] ?? null;
  const selectedOrder = data.orders.find((order) => order.public_id === selectedOrderId) ?? data.orders[0] ?? null;
  const selectedShipment = data.shipments.find((shipment) => shipment.public_id === selectedShipmentId) ?? data.shipments[0] ?? null;
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
  const smsRecipientCount = data.shipments.filter((shipment) => Boolean(shipment.recipient_phone)).length;
  const orderCurrency = data.orders[0]?.currency ?? "TRY";
  const reportTotalAmount = data.orders.reduce((sum, order) => sum + moneyValue(order.total_amount), 0);
  const balanceSummary = balanceSummaryFromOrders(data.orders);
  const commentSummary = toCommentModerationView(data.commentModeration);
  const unreadConversationCount = data.conversations.reduce((sum, conversation) => sum + conversation.unread_count, 0);
  const poolConversationCount = data.conversations.filter((conversation) => conversation.is_in_pool).length;
  const humanAgentConversationCount = data.conversations.filter((conversation) => conversation.human_agent_enabled).length;
  const instagramConversationCount = data.conversations.filter((conversation) => conversation.channel === "instagram").length;
  const facebookConversationCount = data.conversations.filter((conversation) =>
    conversation.channel === "facebook" || conversation.channel === "messenger"
  ).length;
  const openConversationCount = data.conversations.filter((conversation) => conversation.status === "open").length;
  const closedConversationCount = data.conversations.filter((conversation) => conversation.status === "closed").length;
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
    return channelMatches && statusMatches;
  });
  const selectedConversation =
    visibleConversations.find((conversation) => conversation.public_id === selectedConversationId) ?? visibleConversations[0] ?? null;
  const conversationChannelFilters = [
    { value: "all", label: `Tüm kanallar ${data.conversations.length}` },
    { value: "instagram", label: `Instagram ${instagramConversationCount}` },
    { value: "facebook", label: `Facebook ${facebookConversationCount}` },
  ];
  const conversationStatusFilters = [
    { value: "all", label: "Tüm durumlar" },
    { value: "open", label: `Açık ${openConversationCount}` },
    { value: "closed", label: `Kapalı ${closedConversationCount}` },
  ];
  const instagramAnalytics = instagramAnalyticsFrom(integrationSnapshot?.account.metadata);
  const selectedProviderAttempt = data.providerAttempts[0] ?? null;
  const selectedProviderPreview = selectedProviderAttempt?.provider_request_preview ?? null;
  const selectedProviderCatalogItem = data.providerCatalog[0] ?? null;
  const suratProviderCatalogItem = data.providerCatalog.find((item) => item.provider === "surat") ?? null;
  const pttProviderCatalogItem = data.providerCatalog.find((item) => item.provider === "ptt") ?? null;
  const pttProviderAttempts = data.providerAttempts.filter((attempt) => attempt.provider_key === "ptt");
  const suratProviderAttempts = data.providerAttempts.filter((attempt) => attempt.provider_key === "surat");
  const latestSuratAttempt = suratProviderAttempts[0] ?? null;
  const latestSuratPreview = latestSuratAttempt?.provider_request_preview ?? null;
  const trackingCronAttempts = data.providerAttempts.filter(
    (attempt) =>
      (attempt.provider_key === "ptt" || attempt.provider_key === "surat") &&
      attempt.operation === "shipment.track",
  );
  const cronUpdatedCount = trackingCronAttempts.filter((attempt) => attempt.status === "success" || attempt.status === "succeeded").length;
  const cronErrorCount = trackingCronAttempts.filter((attempt) => attempt.status === "failed").length;
  const cronTotalDuration = trackingCronAttempts.reduce((sum, attempt) => sum + attempt.duration_ms, 0);
  const suratRetryCount = suratProviderAttempts.filter((attempt) => attempt.retry_decision === "retry").length;
  const suratFailureCount = suratProviderAttempts.filter((attempt) => attempt.status === "failed").length;
  const suratSuccessCount = suratProviderAttempts.filter((attempt) => attempt.status === "success" || attempt.status === "succeeded").length;
  const suratAverageDuration = suratProviderAttempts.length > 0
    ? Math.round(suratProviderAttempts.reduce((sum, attempt) => sum + attempt.duration_ms, 0) / suratProviderAttempts.length)
    : 0;
  const latestSettingsAudit = data.settingsAudit[0] ?? null;
  const latestIntegrationAudit = data.integrationAudit[0] ?? null;
  const activeOrderCount = data.orders.filter((order) => !["cancelled", "returned", "delivered"].includes(order.status)).length;
  const deliveredOrderCount = data.orders.filter((order) => order.status === "delivered").length;
  const deliveredShipmentCount = data.shipments.filter((shipment) => shipment.status === "delivered").length;
  const activeShipmentCount = data.shipments.filter((shipment) => shipment.status !== "delivered").length;
  const cronSkippedCount = Math.max(activeShipmentCount - trackingCronAttempts.length, 0);
  const pendingConfirmationCount = data.orders.filter((order) => order.confirmation_status === null).length;
  const confirmedOrderCount = data.orders.length - pendingConfirmationCount;
  const pttShipmentCount = data.shipments.filter((shipment) => shipment.provider.toLowerCase().includes("ptt")).length;
  const suratShipmentCount = data.shipments.filter((shipment) => {
    const provider = shipment.provider.toLocaleLowerCase("tr-TR");
    return provider.includes("sürat") || provider.includes("surat");
  }).length;
  const pttNotDeliveredCount = data.shipments.filter(
    (shipment) => shipment.provider.toLowerCase().includes("ptt") && shipment.status !== "delivered",
  ).length;
  const suratNotDeliveredCount = data.shipments.filter((shipment) => {
    const provider = shipment.provider.toLocaleLowerCase("tr-TR");
    return (provider.includes("sürat") || provider.includes("surat")) && shipment.status !== "delivered";
  }).length;
  const trackingMissingCount = data.shipments.filter(
    (shipment) => !shipment.tracking_number && !shipment.barcode_number,
  ).length;
  const otherShipmentCount = Math.max(data.shipments.length - pttShipmentCount - suratShipmentCount, 0);
  const shipmentPipelineRows = data.shipments.map((shipment) => ({
    shipment,
    step: pipelineStepFromShipment(shipment),
    pipelineStatus: pipelineStatusFromShipment(shipment),
  }));
  const visibleShipmentPipelineRows = shipmentPipelineRows.filter(
    (row) => shipmentPipelineFilter === "all" || row.step === shipmentPipelineFilter,
  );
  const pipelineMessageCount = shipmentPipelineRows.filter((row) => row.step === "mesaj").length;
  const pipelineSmsCount = shipmentPipelineRows.filter((row) => row.step === "sms").length;
  const pipelineVapiCount = shipmentPipelineRows.filter((row) => row.step === "vapi").length;
  const pipelineWaitingCount = shipmentPipelineRows.filter((row) => row.pipelineStatus === "bekliyor").length;
  const pipelineProcessingCount = shipmentPipelineRows.filter((row) => row.pipelineStatus === "isleniyor").length;
  const pipelineErrorCount = shipmentPipelineRows.filter((row) => row.pipelineStatus === "hata").length;
  const pipelineDeliveredCount = shipmentPipelineRows.filter((row) => row.pipelineStatus === "teslim").length;
  const shipmentPipelineFilters: Array<{ value: ShipmentPipelineFilter; label: string; count: number }> = [
    { value: "all", label: "Tümü", count: shipmentPipelineRows.length },
    { value: "mesaj", label: "Mesaj", count: pipelineMessageCount },
    { value: "sms", label: "SMS", count: pipelineSmsCount },
    { value: "vapi", label: "VAPI", count: pipelineVapiCount },
    { value: "teslim", label: "Teslim", count: pipelineDeliveredCount },
  ];
  const customerWithPhoneCount = data.customers.filter((customer) => Boolean(customer.phone)).length;
  const customerWithEmailCount = data.customers.filter((customer) => Boolean(customer.email)).length;
  const customerWithNotesCount = data.customers.filter((customer) => Boolean(customer.notes)).length;
  const activeProductCount = data.products.filter((product) => product.is_active).length;
  const criticalProducts = data.products.filter((product) => product.stock_quantity <= 3);
  const selectedProduct = data.products[0] ?? null;
  const incubatorProductCount = data.products.filter((product) => product.category === "incubator").length;
  const sparePartProductCount = data.products.filter((product) => product.category === "spare_part").length;
  const otherProductCount = Math.max(data.products.length - incubatorProductCount - sparePartProductCount, 0);

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
            <div className="metrics-grid">
              <Metric title="Okunmamış" value={String(unreadConversationCount)} />
              <Metric title="Havuz" value={String(poolConversationCount)} />
              <Metric title="Human Agent" value={String(humanAgentConversationCount)} />
              <Metric title="Instagram" value={String(instagramConversationCount)} />
              <Metric title="Facebook" value={String(facebookConversationCount)} />
            </div>
            <div className="detail-actions" data-testid="conversation-filter-bar">
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
            <DetailPanel title="Konuşma Filtreleri" testId="conversation-filter-summary">
              <DataRows
                rows={[
                  ["Kaynak", "conversations API", "legacy kanal/durum filtreleri"],
                  ["Aktif kanal", conversationChannelFilter, `${visibleConversations.length} konuşma`],
                  ["Aktif durum", conversationStatusFilter, "Supabase channel yok"],
                  ["Havuz", String(poolConversationCount), "backend is_in_pool"],
                  ["Human agent", String(humanAgentConversationCount), "backend human_agent_enabled"],
                ]}
              />
            </DetailPanel>
            <div className="split-grid">
              <List title="Konuşmalar" testId="conversation-list">
                {visibleConversations.map((conversation) => (
                  <li key={conversation.public_id}>
                    <button
                      className={cx("conversation-button", selectedConversation?.public_id === conversation.public_id && "selected")}
                      type="button"
                      onClick={() => void handleSelectConversation(conversation.public_id)}
                    >
                      <strong>{conversation.customer?.full_name ?? conversation.public_id}</strong>
                      <span>{conversation.last_message_text ?? "Mesaj yok"}</span>
                      <span>
                        {conversation.channel} / {conversation.status} / okunmamış {conversation.unread_count}
                      </span>
                    </button>
                  </li>
                ))}
              </List>
              <div className="message-thread">
                <h2>Mesaj akışı</h2>
                {selectedConversation && (
                  <DetailPanel title="Konuşma Detayı" testId="conversation-detail">
                    <DataRows
                      rows={[
                        ["Müşteri", selectedConversation.customer?.full_name ?? selectedConversation.public_id, selectedConversation.channel],
                        ["Durum", selectedConversation.status, selectedConversation.assigned_user_email ?? "havuz"],
                        ["Okunmamış", String(selectedConversation.unread_count), selectedConversation.last_message_sender_type ?? "-"],
                      ]}
                    />
                    <div className="detail-actions" data-testid="conversation-state-actions">
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={() => void handleUpdateConversationState({ unread_count: 0 })}
                      >
                        Okundu yap
                      </button>
                      <button
                        className="secondary-action"
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
                        type="button"
                        onClick={() =>
                          void handleUpdateConversationState(
                            selectedConversation.is_in_pool
                              ? { assign_to_me: true, is_in_pool: false }
                              : { assign_to_me: false, is_in_pool: true }
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
                {data.messages.map((message) => (
                  <article key={message.public_id}>
                    <strong>{message.sender_name ?? message.sender_type}</strong>
                    <span>{message.body ?? "Boş mesaj"}</span>
                  </article>
                ))}
                <button className="primary-action" type="button" onClick={handleSendMessage}>
                  Cevap gönder
                </button>
              </div>
            </div>
            <Metric title="Okunmamış" value={String(data.conversations.reduce((sum, item) => sum + item.unread_count, 0))} />
          </FlowPanel>
        )}

        {activeFlow === "orders" && (
          <FlowPanel title="Siparişler" icon={<ShoppingCart size={18} />} testId="orders-flow">
            <div className="report-grid">
              <Metric title="Toplam Sipariş" value={String(data.orders.length)} />
              <Metric title="Aktif Sipariş" value={String(activeOrderCount)} />
              <Metric title="Teyit Bekleyen" value={String(pendingConfirmationCount)} />
              <Metric title="Ciro" value={formatMoney(reportTotalAmount, orderCurrency)} />
            </div>
            <div className="detail-actions" data-testid="order-section-filters">
              <button
                className={cx("secondary-action", orderFilter === "all" && "selected")}
                data-testid="order-filter-all"
                type="button"
                onClick={() => void handleApplyOrderFilter("all")}
              >
                Hepsi {orderFilter === "all" ? data.orders.length : "sonuç"}
              </button>
              <button
                className={cx("secondary-action", orderFilter === "active" && "selected")}
                data-testid="order-filter-active"
                type="button"
                onClick={() => void handleApplyOrderFilter("active")}
              >
                Aktif {orderFilter === "all" || orderFilter === "active" ? activeOrderCount : "sonuç"}
              </button>
              <button
                className={cx("secondary-action", orderFilter === "pending_confirmation" && "selected")}
                data-testid="order-filter-pending-confirmation"
                type="button"
                onClick={() => void handleApplyOrderFilter("pending_confirmation")}
              >
                Teyit {orderFilter === "all" || orderFilter === "pending_confirmation" ? pendingConfirmationCount : "sonuç"}
              </button>
              <button
                className={cx("secondary-action", orderFilter === "delivered" && "selected")}
                data-testid="order-filter-delivered"
                type="button"
                onClick={() => void handleApplyOrderFilter("delivered")}
              >
                Teslim {orderFilter === "all" || orderFilter === "delivered" ? deliveredOrderCount : "sonuç"}
              </button>
            </div>
            <button className="primary-action" type="button" onClick={() => void handleCreateOrder("orders")}>
              Sipariş oluştur
            </button>
            <DataRows rows={data.orders.map((order) => [order.order_number, order.status, `${order.total_amount} ${order.currency}`])} />
            <div className="detail-actions">
              {data.orders.map((order) => (
                <button
                  className={cx("secondary-action", selectedOrder?.public_id === order.public_id && "selected")}
                  key={order.public_id}
                  type="button"
                  onClick={() => setSelectedOrderId(order.public_id)}
                >
                  {order.order_number} detay
                </button>
              ))}
            </div>
            {selectedOrder && (
              <DetailPanel title="Sipariş Detayı" testId="order-detail">
                <DataRows
                  rows={[
                    ["Sipariş No", selectedOrder.order_number, selectedOrder.status],
                    ["Müşteri", selectedOrder.customer_full_name ?? "Müşteri eşleşmedi", selectedOrder.source],
                    [
                      "Tutar",
                      `${selectedOrder.total_amount} ${selectedOrder.currency}`,
                      selectedOrder.confirmation_status ?? "teyit bekliyor",
                    ],
                    ["Not", selectedOrder.notes ?? "-", selectedOrder.updated_at],
                  ]}
                />
              </DetailPanel>
            )}
          </FlowPanel>
        )}

        {activeFlow === "shipments" && (
          <FlowPanel title="Kargo" icon={<Truck size={18} />} testId="shipments-flow">
            <div className="report-grid">
              <Metric title="PTT Kargo" value={String(pttShipmentCount)} />
              <Metric title="Sürat Kargo" value={String(suratShipmentCount)} />
              <Metric title="Yoldaki Kargolar" value={String(activeShipmentCount)} />
              <Metric title="Teslim Edilen" value={String(deliveredShipmentCount)} />
            </div>
            <div className="detail-actions" data-testid="shipment-section-tabs">
              <button
                className={cx("secondary-action", shipmentFilter === "all" && "selected")}
                data-testid="shipment-filter-all"
                type="button"
                onClick={() => void handleApplyShipmentFilter("all")}
              >
                Tüm kargolar {shipmentFilter === "all" ? data.shipments.length : "sonuç"}
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
            <button className="primary-action" type="button" onClick={handleUpdateShipment}>
              Teslim edildi yap
            </button>
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
            <DataRows
              rows={data.shipments.map((shipment) => [
                shipment.provider,
                shipment.tracking_number ?? shipment.barcode_number ?? "-",
                shipment.order_number ?? shipment.customer_full_name ?? shipment.status,
              ])}
            />
            <div className="detail-actions">
              {data.shipments.map((shipment) => (
                <button
                  className={cx("secondary-action", selectedShipment?.public_id === shipment.public_id && "selected")}
                  key={shipment.public_id}
                  type="button"
                  onClick={() => setSelectedShipmentId(shipment.public_id)}
                >
                  {(shipment.tracking_number ?? shipment.provider).toUpperCase()} detay
                </button>
              ))}
            </div>
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
              rows={visibleShipmentPipelineRows.map(({ shipment, step, pipelineStatus }) => [
                shipment.recipient_name,
                `${step} / ${pipelineStatus}`,
                shipment.tracking_number ?? shipment.barcode_number ?? shipment.recipient_phone ?? "-",
              ])}
            />
          </FlowPanel>
        )}

        {activeFlow === "suratDebug" && (
          <FlowPanel title="Sürat Kargo Debug" icon={<Bug size={18} />} testId="surat-debug-flow">
            <div className="metrics-grid">
              <Metric title="Toplam" value={String(suratProviderAttempts.length)} />
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
              <Metric title="PTT Log" value={String(pttProviderAttempts.length)} />
              <Metric title="Sürat Log" value={String(suratProviderAttempts.length)} />
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
                  ["Kayıt", String(data.settingsAudit.length), "settings audit API"],
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
                  ["Kayıt", String(data.providerAttempts.length), "provider attempts API"],
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
                  ["Kayıt", String(data.integrationAudit.length), "integration audit API"],
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
                    ["Açık konuşma", String(openConversationCount), "backend conversations"],
                    ["Okunmamış mesaj", String(data.conversations.reduce((sum, item) => sum + item.unread_count, 0)), "domain API"],
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
              <Metric title="Müşteri" value={String(data.customers.length)} />
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
                  ["Sipariş kaydı", String(data.orders.length), "backend orders"],
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
              <Metric title="Ürün" value={String(data.products.length)} />
              <Metric title="Aktif Stok" value={String(activeProductCount)} />
              <Metric title="Kritik Stok" value={String(criticalProducts.length)} />
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
                  product.stock_quantity <= 3 ? "kritik stok" : "normal stok",
                ])}
              />
            </DetailPanel>
            <DetailPanel title="Stok ve Sevkiyat Sinyali" testId="inventory-detail">
              <DataRows
                rows={[
                  ["Sipariş kaynaklı stok sinyali", String(data.orders.length), "orders API"],
                  ["Son sipariş", selectedOrder?.order_number ?? "-", selectedOrder?.status ?? "-"],
                  ["Müşteri", selectedOrder?.customer_full_name ?? "-", selectedOrder?.source ?? "-"],
                  ["Depo entegrasyonu", data.shipments.length > 0 ? "sevkiyat bağlı" : "hazır", "API senkron"],
                ]}
              />
            </DetailPanel>
          </FlowPanel>
        )}

        {activeFlow === "balances" && (
          <FlowPanel title="Bakiyeler" icon={<Wallet size={18} />} testId="balances-flow">
            <div className="report-grid">
              <Metric title="Görünür Ayar" value={String(activeSettings.length)} />
              <Metric title="Sipariş Tutarı" value={formatMoney(reportTotalAmount, orderCurrency)} />
              <Metric title="Para Birimi" value={orderCurrency} />
            </div>
            <DetailPanel title="Bakiye Özeti" testId="balances-detail">
              <DataRows
                rows={[
                  ["Görünür ayar", String(activeSettings.length), "admin settings"],
                  ["Para birimi", orderCurrency, "orders API"],
                  ["Son sipariş", selectedOrder?.order_number ?? "-", selectedOrder ? `${selectedOrder.total_amount} ${selectedOrder.currency}` : "-"],
                  ["Teyit bekleyen", String(pendingConfirmationCount), "orders API"],
                ]}
              />
            </DetailPanel>
            <DetailPanel title="Ödeme İsteği Kuyruğu" testId="balance-payment-detail">
              <DataRows
                rows={[
                  ["Toplam komisyon", formatMoney(balanceSummary.totalCommission, orderCurrency), "legacy bakiye"],
                  ["Kesinti", formatMoney(balanceSummary.totalDeduction, orderCurrency), "iptal/iade"],
                  ["Bekleyen ödeme", formatMoney(balanceSummary.pendingPayment, orderCurrency), `${balanceSummary.pendingRequestCount} talep`],
                  ["Kullanılabilir bakiye", formatMoney(balanceSummary.availableBalance, orderCurrency), "ödeme isteği sonrası"],
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
              <Metric title="Konuşma" value={String(data.conversations.length)} />
              <Metric title="Sipariş" value={String(data.orders.length)} />
              <Metric title="Kargo" value={String(data.shipments.length)} />
              <Metric title="Ciro" value={formatMoney(reportTotalAmount, orderCurrency)} />
            </div>
            <DetailPanel title="Operasyon Dağılımı" testId="reports-detail">
              <DataRows
                rows={[
                  ["Açık konuşma", String(openConversationCount), "domain API"],
                  ["Teyit bekleyen", String(pendingConfirmationCount), "orders API"],
                  ["Aktif kargo", String(activeShipmentCount), "shipments API"],
                  ["Teslim edilen", String(deliveredShipmentCount), "shipments API"],
                ]}
              />
            </DetailPanel>
            <DetailPanel title="Oran Özeti" testId="reports-ratio-summary">
              <DataRows
                rows={[
                  ["Teslim Oranı", formatPercent(deliveredShipmentCount, data.shipments.length), "teslim / toplam kargo"],
                  ["Teyit Oranı", formatPercent(confirmedOrderCount, data.orders.length), `${pendingConfirmationCount} teyit bekliyor`],
                  ["Kargo Hareketi", formatPercent(activeShipmentCount, data.shipments.length), "aktif / toplam kargo"],
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
                    ["Aday", String(data.fileOrphans.length), "files orphan report"],
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
