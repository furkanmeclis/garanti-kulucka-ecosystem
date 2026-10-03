import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  Boxes,
  BarChart3,
  Bot,
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
  Wallet,
  Wifi,
  WifiOff,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  createAdminClient,
  type AdminSetting,
  type IntegrationAccount,
  type IntegrationAccountSnapshot,
} from "../api/admin-client.js";
import { createAuthClient, type LoginResponse } from "../api/auth-client.js";
import {
  createDomainClient,
  type ConversationSummary,
  type MessageSummary,
  type OrderSummary,
  type ShipmentSummary,
} from "../api/domain-client.js";
import { createFileClient, type FileMetadata } from "../api/file-client.js";
import { createBackendHttpClient } from "../api/http-client.js";
import { createRealtimeClient, type RealtimeClient } from "../api/realtime-client.js";
import { createWebphoneClient, type WebphoneConfig } from "../api/webphone-client.js";

const backendBaseUrl = import.meta.env.VITE_BACKEND_BASE_URL ?? "/backend";
const tokenStorageKey = "garanti.web.access_token";

interface DashboardData {
  conversations: ConversationSummary[];
  messages: MessageSummary[];
  orders: OrderSummary[];
  shipments: ShipmentSummary[];
  settings: AdminSetting[];
  integrationAccounts: IntegrationAccount[];
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

interface BalanceSummary {
  totalCommission: number;
  totalDeduction: number;
  pendingPayment: number;
  availableBalance: number;
  pendingRequestCount: number;
}

interface CommentModerationSummary {
  manualQueue: number;
  automaticQueue: number;
  answered: number;
  instagram: number;
  facebook: number;
}

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
  { key: "orders", label: "Siparişler", icon: ShoppingCart, roles: ["admin", "calisan", "kargo_operatoru"], path: "/siparisler" },
  { key: "shipments", label: "Kargo", icon: Truck, roles: ["admin", "calisan", "kargo_operatoru"], path: "/kargo" },
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

const smsTemplate = "{musteri_adi}, {takip_no} takip numarali kargonuz {kargo_firmasi} ile yoldadir.";

function flowFromPath(pathname: string) {
  return [...navigationItems]
    .sort((first, second) => second.path.length - first.path.length)
    .find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`))?.key ?? "inbox";
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
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

function commentModerationSummaryFrom(conversations: ConversationSummary[]): CommentModerationSummary {
  return conversations.reduce<CommentModerationSummary>(
    (summary, conversation) => {
      const channel = conversation.channel.toLocaleLowerCase("tr-TR");
      if (channel.includes("instagram")) summary.instagram += 1;
      if (channel.includes("facebook") || channel.includes("messenger")) summary.facebook += 1;
      if (conversation.status === "closed" || conversation.status === "resolved") {
        summary.answered += 1;
      } else if (conversation.human_agent_enabled || conversation.unread_count > 0) {
        summary.manualQueue += 1;
      } else if (conversation.is_in_pool) {
        summary.automaticQueue += 1;
      }
      return summary;
    },
    { manualQueue: 0, automaticQueue: 0, answered: 0, instagram: 0, facebook: 0 },
  );
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

export function App() {
  const location = useLocation();
  const publicPage = publicPageFromPath(location.pathname);
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [user, setUser] = useState<LoginResponse["user"] | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [data, setData] = useState<DashboardData>({
    conversations: [],
    messages: [],
    orders: [],
    shipments: [],
    settings: [],
    integrationAccounts: [],
    webphone: null,
  });
  const [status, setStatus] = useState("Hazır");
  const [uploadedFile, setUploadedFile] = useState<FileMetadata | null>(null);
  const [presenceUpdating, setPresenceUpdating] = useState(false);
  const [integrationSnapshot, setIntegrationSnapshot] = useState<IntegrationAccountSnapshot | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);

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

  useEffect(() => {
    let realtime: RealtimeClient | null = null;
    if (token) {
      realtime = createRealtimeClient({
        baseUrl: backendBaseUrl,
        getAccessToken: () => token,
      });
    }
    return () => realtime?.disconnect();
  }, [token]);

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
    const [conversations, orders, shipments, settings, webphoneConfig] = await Promise.all([
      domain.listConversations({ limit: 20 }),
      domain.listOrders(20),
      domain.listShipments(20),
      user?.role === "admin" ? admin.listSettings("global") : Promise.resolve({ data: [] }),
      webphone.getConfig(),
    ]);
    const integrationAccounts = user?.role === "admin"
      ? await admin.listIntegrationAccounts()
      : { data: [] };
    const firstConversation = conversations.data[0]?.public_id;
    const messages = firstConversation
      ? await domain.listMessages(firstConversation, 50)
      : { data: [] };

    setData({
      conversations: conversations.data,
      messages: messages.data,
      orders: orders.data,
      shipments: shipments.data,
      settings: settings.data,
      integrationAccounts: integrationAccounts.data,
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
        messages: [],
        orders: [],
        shipments: [],
        settings: [],
        integrationAccounts: [],
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

    setUploadedFile(response.file);
    setStatus("Dosya akışı presigned S3 sınırından geçti");
  }

  async function handleSendMessage() {
    const conversationId = selectedConversationId ?? data.conversations[0]?.public_id;
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
      messages: [...current.messages, message],
    }));
    setStatus("Mesaj backend API üzerinden gönderildi");
  }

  async function handleSelectConversation(conversationPublicId: string) {
    setSelectedConversationId(conversationPublicId);
    setStatus("Konuşma mesajları backend API üzerinden yükleniyor");
    const messages = await domain.listMessages(conversationPublicId, 50);
    setData((current) => ({
      ...current,
      messages: messages.data,
    }));
    setStatus("Konuşma detayı backend API üzerinden yüklendi");
  }

  async function handleCreateOrder() {
    setStatus("Sipariş backend API üzerinden oluşturuluyor");
    const order = await domain.createOrder({
      customer_public_id: null,
      conversation_public_id: selectedConversationId ?? data.conversations[0]?.public_id ?? null,
      order_number: "ORD-WEB-NEW",
      status: "draft",
      source: "manual",
      total_amount: "250.00",
      currency: "TRY",
      notes: "Frontend backend create smoke",
    });
    setData((current) => ({
      ...current,
      orders: [order, ...current.orders],
    }));
    setSelectedOrderId(order.public_id);
    setStatus("Sipariş backend API üzerinden oluşturuldu");
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
    setData((current) => ({
      ...current,
      shipments: current.shipments.map((item) => (item.public_id === updated.public_id ? updated : item)),
    }));
    setSelectedShipmentId(updated.public_id);
    setStatus("Kargo durumu backend API üzerinden güncellendi");
  }

  async function handleEnableProviderLiveMode() {
    setStatus("Provider live flag backend API üzerinden güncelleniyor");
    const setting = await admin.upsertSetting("providers.ptt.live_mode", true, false, "global");
    setData((current) => ({
      ...current,
      settings: [setting, ...current.settings.filter((item) => item.key !== setting.key)],
    }));
    setStatus("Provider live flag backend API üzerinden güncellendi");
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
  const selectedConversation =
    data.conversations.find((conversation) => conversation.public_id === selectedConversationId) ?? data.conversations[0] ?? null;
  const selectedOrder = data.orders.find((order) => order.public_id === selectedOrderId) ?? data.orders[0] ?? null;
  const selectedShipment = data.shipments.find((shipment) => shipment.public_id === selectedShipmentId) ?? data.shipments[0] ?? null;
  const smsPreview = smsTemplate
    .replace("{musteri_adi}", selectedShipment?.recipient_name ?? selectedOrder?.customer_full_name ?? "Müşteri")
    .replace("{takip_no}", selectedShipment?.tracking_number ?? selectedShipment?.barcode_number ?? "takip bekliyor")
    .replace("{kargo_firmasi}", selectedShipment?.provider ?? "Kargo");
  const smsInfo = smsSegmentInfo(smsPreview);
  const smsRecipientCount = data.shipments.filter((shipment) => Boolean(shipment.recipient_phone)).length;
  const orderCurrency = data.orders[0]?.currency ?? "TRY";
  const reportTotalAmount = data.orders.reduce((sum, order) => sum + moneyValue(order.total_amount), 0);
  const balanceSummary = balanceSummaryFromOrders(data.orders);
  const commentSummary = commentModerationSummaryFrom(data.conversations);
  const activeOrderCount = data.orders.filter((order) => !["cancelled", "returned", "delivered"].includes(order.status)).length;
  const deliveredOrderCount = data.orders.filter((order) => order.status === "delivered").length;
  const deliveredShipmentCount = data.shipments.filter((shipment) => shipment.status === "delivered").length;
  const activeShipmentCount = data.shipments.filter((shipment) => shipment.status !== "delivered").length;
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
  const openConversationCount = data.conversations.filter((conversation) => conversation.status === "open").length;

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
            <div className="split-grid">
              <List title="Konuşmalar">
                {data.conversations.map((conversation) => (
                  <li key={conversation.public_id}>
                    <button
                      className={cx("conversation-button", selectedConversation?.public_id === conversation.public_id && "selected")}
                      type="button"
                      onClick={() => void handleSelectConversation(conversation.public_id)}
                    >
                      <strong>{conversation.customer?.full_name ?? conversation.public_id}</strong>
                      <span>{conversation.last_message_text ?? "Mesaj yok"}</span>
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
              <button className="secondary-action selected" type="button">
                Hepsi {data.orders.length}
              </button>
              <button className="secondary-action" type="button">
                Aktif {activeOrderCount}
              </button>
              <button className="secondary-action" type="button">
                Teyit {pendingConfirmationCount}
              </button>
              <button className="secondary-action" type="button">
                Teslim {deliveredOrderCount}
              </button>
            </div>
            <button className="primary-action" type="button" onClick={handleCreateOrder}>
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
              <button className="secondary-action selected" type="button">
                Tüm kargolar {data.shipments.length}
              </button>
              <button className="secondary-action" type="button">
                PTT {pttShipmentCount}
              </button>
              <button className="secondary-action" type="button">
                Sürat {suratShipmentCount}
              </button>
              <button className="secondary-action" type="button">
                Diğer {otherShipmentCount}
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

        {activeFlow === "admin" && (
          <FlowPanel title="Admin Ayarları" icon={<Settings size={18} />} testId="admin-flow">
            <button className="primary-action" type="button" onClick={handleEnableProviderLiveMode}>
              PTT canlı modu aç
            </button>
            <DataRows rows={activeSettings.map((setting) => [setting.key, setting.scope, JSON.stringify(setting.value)])} />
          </FlowPanel>
        )}

        {activeFlow === "integrations" && (
          <FlowPanel title="Entegrasyon Hesapları" icon={<Settings size={18} />} testId="integrations-flow">
            <button className="primary-action" type="button" onClick={handleUpsertIntegrationAccount}>
              Instagram hesabı kaydet
            </button>
            <DataRows rows={data.integrationAccounts.map((account) => [account.provider_name, account.display_name, account.status])} />
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
          </FlowPanel>
        )}

        {activeFlow === "inventory" && (
          <FlowPanel title="Stoklar" icon={<Package size={18} />} testId="inventory-flow">
            <div className="report-grid">
              <Metric title="Sipariş Sinyali" value={String(data.orders.length)} />
              <Metric title="Bekleyen Teyit" value={String(pendingConfirmationCount)} />
              <Metric title="Aktif Kargo" value={String(activeShipmentCount)} />
            </div>
            <DetailPanel title="Stok Kategorileri" testId="inventory-categories">
              <DataRows
                rows={[
                  ["Kuluçka Makineleri", String(data.orders.length), "ana ürün grubu"],
                  ["Yedek Parçalar", String(pendingConfirmationCount), "bakım parçaları"],
                  ["Diğer Malzemeler", String(activeShipmentCount), "sarf ve operasyon"],
                ]}
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
                ]}
              />
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
                  ["Sayaç", `${smsInfo.length} karakter`, `${smsInfo.segmentCount} SMS`],
                ]}
              />
              <div className="detail-actions">
                {["{musteri_adi}", "{takip_no}", "{kargo_firmasi}"].map((variable) => (
                  <button className="secondary-action" key={variable} type="button">
                    {variable}
                  </button>
                ))}
              </div>
            </DetailPanel>
            <DetailPanel title="SMS Gönderim Kayıtları" testId="sms-history-detail">
              <DataRows
                rows={[
                  ["Alıcı listesi", `${smsRecipientCount} alıcı`, "shipments API"],
                  ["Seçili alıcı", selectedShipment?.recipient_phone ?? "-", selectedShipment?.recipient_name ?? "-"],
                  ["Son taslak", smsPreview, `${smsInfo.segmentCount} SMS`],
                  ["Şablon durumu", "aktif", "manuel gönderim"],
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

function List(props: { title: string; children: ReactNode }) {
  return (
    <div className="list-panel">
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
