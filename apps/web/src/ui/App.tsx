import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Boxes,
  FileUp,
  Headphones,
  LogIn,
  MessageCircle,
  Phone,
  Settings,
  ShoppingCart,
  Truck,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { createAdminClient, type AdminSetting } from "../api/admin-client.js";
import { createAuthClient, type LoginResponse } from "../api/auth-client.js";
import {
  createDomainClient,
  type ConversationSummary,
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
  orders: OrderSummary[];
  shipments: ShipmentSummary[];
  settings: AdminSetting[];
  webphone: WebphoneConfig | null;
}

interface NavigationItem {
  key: string;
  label: string;
  icon: LucideIcon;
  roles: string[];
}

const navigationItems: NavigationItem[] = [
  { key: "inbox", label: "Mesajlar", icon: MessageCircle, roles: ["admin", "calisan", "kargo_operatoru"] },
  { key: "orders", label: "Siparişler", icon: ShoppingCart, roles: ["admin", "calisan", "kargo_operatoru"] },
  { key: "shipments", label: "Kargo", icon: Truck, roles: ["admin", "calisan", "kargo_operatoru"] },
  { key: "admin", label: "Ayarlar", icon: Settings, roles: ["admin"] },
  { key: "files", label: "Dosya", icon: FileUp, roles: ["admin", "calisan"] },
  { key: "webphone", label: "Santral", icon: Phone, roles: ["admin"] },
];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function readStoredToken() {
  return window.localStorage.getItem(tokenStorageKey);
}

export function App() {
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [user, setUser] = useState<LoginResponse["user"] | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [data, setData] = useState<DashboardData>({
    conversations: [],
    orders: [],
    shipments: [],
    settings: [],
    webphone: null,
  });
  const [activeFlow, setActiveFlow] = useState("inbox");
  const [status, setStatus] = useState("Hazır");
  const [uploadedFile, setUploadedFile] = useState<FileMetadata | null>(null);

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
    if (!token || !authChecked) return;
    void loadDashboard();
  }, [authChecked, token]);

  async function loadDashboard() {
    setStatus("Backend API akışları yükleniyor");
    const [conversations, orders, shipments, settings, webphoneConfig] = await Promise.all([
      domain.listConversations({ limit: 20 }),
      domain.listOrders(20),
      domain.listShipments(20),
      admin.listSettings("global"),
      webphone.getConfig(),
    ]);

    setData({
      conversations: conversations.data,
      orders: orders.data,
      shipments: shipments.data,
      settings: settings.data,
      webphone: webphoneConfig,
    });
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
        orders: [],
        shipments: [],
        settings: [],
        webphone: null,
      });
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
              <button
                key={item.key}
                className={cx("nav-button", activeFlow === item.key && "active")}
                onClick={() => setActiveFlow(item.key)}
                type="button"
              >
                <Icon aria-hidden="true" size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
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
                    <strong>{conversation.customer?.full_name ?? conversation.public_id}</strong>
                    <span>{conversation.last_message_text ?? "Mesaj yok"}</span>
                  </li>
                ))}
              </List>
              <Metric title="Okunmamış" value={String(data.conversations.reduce((sum, item) => sum + item.unread_count, 0))} />
            </div>
          </FlowPanel>
        )}

        {activeFlow === "orders" && (
          <FlowPanel title="Siparişler" icon={<ShoppingCart size={18} />} testId="orders-flow">
            <DataRows rows={data.orders.map((order) => [order.order_number, order.status, `${order.total_amount} ${order.currency}`])} />
          </FlowPanel>
        )}

        {activeFlow === "shipments" && (
          <FlowPanel title="Kargo" icon={<Truck size={18} />} testId="shipments-flow">
            <DataRows rows={data.shipments.map((shipment) => [shipment.provider, shipment.tracking_number ?? "-", shipment.status])} />
          </FlowPanel>
        )}

        {activeFlow === "admin" && (
          <FlowPanel title="Admin Ayarları" icon={<Settings size={18} />} testId="admin-flow">
            <DataRows rows={activeSettings.map((setting) => [setting.key, setting.scope, JSON.stringify(setting.value)])} />
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
