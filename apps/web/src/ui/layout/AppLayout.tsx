import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Bell, ChevronDown, Languages, LogOut, Settings, Truck, User, MessageCircle, Wifi, WifiOff } from "lucide-react";
import type { LoginResponse } from "../../api/auth-client.js";
import { unreadBadgeLabel, type AppNotification, type NotificationsState } from "../app/notifications.js";
import { cx, navigationRole, type NavigationItem } from "../app/shared.js";

export type UiLanguage = "tr" | "en";

/** Legacy `garanti-lang` key (frontend/src/i18n) so a returning user keeps the same choice. */
const languageStorageKey = "garanti-lang";

const navLabelsEn: Record<string, string> = {
  inbox: "Messages",
  comments: "Comments",
  customers: "Customers",
  orders: "Orders",
  shipments: "Shipments",
  shipmentPipeline: "Pipeline",
  suratDebug: "Sürat Debug",
  cronDebug: "Cron Debug",
  cancellations: "Cancellations",
  inventory: "Inventory",
  balances: "Balances",
  sms: "SMS",
  calls: "Calls",
  vapi: "VAPI AI",
  reports: "Business Analytics",
  instagramPublish: "Create Post",
  instagramAnalytics: "Analytics",
  integrations: "Integrations",
  admin: "Settings",
  files: "Files",
  webphone: "PBX",
};

const headerText = {
  tr: {
    online: "Çevrimiçi",
    offline: "Çevrimdışı",
    changing: "Değişiyor",
    logout: "Çıkış",
    language: "Dil",
    nav: "Ana gezinme",
    profileMenu: "Profil menüsü",
    profile: "Profil",
    settings: "Ayarlar",
    notifications: "Bildirimler",
    noNotifications: "Bildirim yok",
    markAllRead: "Tümünü okundu işaretle",
    unread: "okunmamış",
    newMessage: "Yeni müşteri mesajı",
    shipmentUpdated: "Kargo güncellendi",
    justNow: "az önce",
  },
  en: {
    online: "Online",
    offline: "Offline",
    changing: "Updating",
    logout: "Sign out",
    language: "Language",
    nav: "Main navigation",
    profileMenu: "Profile menu",
    profile: "Profile",
    settings: "Settings",
    notifications: "Notifications",
    noNotifications: "No notifications",
    markAllRead: "Mark all as read",
    unread: "unread",
    newMessage: "New customer message",
    shipmentUpdated: "Shipment updated",
    justNow: "just now",
  },
} satisfies Record<UiLanguage, Record<string, string>>;

type HeaderText = (typeof headerText)[UiLanguage];

const roleLabels: Record<UiLanguage, Record<string, string>> = {
  tr: { owner: "Admin", admin: "Admin", calisan: "Personel", kargo_operatoru: "Kargo" },
  en: { owner: "Admin", admin: "Admin", calisan: "Personnel", kargo_operatoru: "Cargo" },
};

function readStoredLanguage(): UiLanguage {
  try {
    return window.localStorage.getItem(languageStorageKey) === "en" ? "en" : "tr";
  } catch {
    return "tr";
  }
}

function storeLanguage(language: UiLanguage) {
  try {
    window.localStorage.setItem(languageStorageKey, language);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for the session only.
  }
}

/** Legacy `basHarflerAl(ad, soyad)`: first letters of first/last name, falling back to the e-mail. */
export function userInitials(user: Pick<LoginResponse["user"], "first_name" | "last_name" | "email"> | null) {
  if (!user) return "?";
  const initials = `${user.first_name?.trim().charAt(0) ?? ""}${user.last_name?.trim().charAt(0) ?? ""}`;
  return (initials || user.email.charAt(0) || "?").toLocaleUpperCase("tr-TR");
}

/** Legacy HomeRedirect: kargo operatörü → /siparisler, everyone else → /mesajlar. */
export function homePathForRole(role: string | null | undefined) {
  return role === "kargo_operatoru" ? "/siparisler" : "/mesajlar";
}

/** Legacy `goreceliTarih`: "az önce", "5 dk önce", "2 sa önce", then the date. */
export function relativeTime(iso: string, language: UiLanguage, now = Date.now()) {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const seconds = Math.round((now - time) / 1000);
  if (seconds < 60) return headerText[language].justNow;
  const format = new Intl.RelativeTimeFormat(language === "en" ? "en" : "tr", { numeric: "always", style: "short" });
  if (seconds < 3600) return format.format(-Math.floor(seconds / 60), "minute");
  if (seconds < 86_400) return format.format(-Math.floor(seconds / 3600), "hour");
  return new Date(time).toLocaleDateString(language === "en" ? "en-GB" : "tr-TR");
}

function notificationTitle(notification: AppNotification, text: HeaderText) {
  return notification.kind === "message" ? text.newMessage : text.shipmentUpdated;
}

function notificationDetail(notification: AppNotification) {
  if (notification.kind === "message") return notification.conversationPublicId;
  return [notification.trackingNumber ?? notification.shipmentPublicId, notification.status].filter(Boolean).join(" · ");
}

/** Closes a header popover on outside pointer-down or Escape (legacy: full-screen click-catcher overlay). */
function useDismiss(open: boolean, containerRef: RefObject<HTMLElement>, triggerRef: RefObject<HTMLElement>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      close();
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, containerRef, triggerRef, close]);
}

/** Arrow/Home/End roving focus over the menu's items (WAI-ARIA menu button pattern). */
function handleMenuKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
  if (items.length === 0) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === "ArrowDown" ? (index + 1) % items.length
    : event.key === "ArrowUp" ? (index - 1 + items.length) % items.length
    : event.key === "Home" ? 0
    : event.key === "End" ? items.length - 1
    : null;
  if (next === null) return;
  event.preventDefault();
  items[next]?.focus();
}

interface NotificationBellProps {
  notifications: NotificationsState;
  language: UiLanguage;
  text: HeaderText;
  onOpen: (notification: AppNotification) => void;
}

/** Legacy Header bell: unread badge ("9+"), last 5 notifications, "mark all read". */
function NotificationBell({ notifications, language, text, onOpen }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useDismiss(open, containerRef, triggerRef, () => setOpen(false));
  const unread = notifications.unreadCount;
  const label = unread > 0 ? `${text.notifications} (${unread} ${text.unread})` : text.notifications;

  return (
    <div className="header-menu" data-testid="notification-bell" ref={containerRef}>
      <button
        aria-controls="notification-panel"
        aria-expanded={open}
        aria-label={label}
        className="icon-trigger"
        data-testid="notification-trigger"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        title={text.notifications}
        type="button"
      >
        <Bell size={18} aria-hidden="true" />
        {unread > 0 && (
          <span className="notification-badge" data-testid="notification-badge" aria-hidden="true">
            {unreadBadgeLabel(unread)}
          </span>
        )}
      </button>
      {open && (
        <div aria-label={text.notifications} className="header-dropdown notification-panel" data-testid="notification-panel" id="notification-panel" role="region">
          <div className="header-dropdown-title">
            <h3>{text.notifications}</h3>
          </div>
          {notifications.items.length === 0 ? (
            <p className="notification-empty">{text.noNotifications}</p>
          ) : (
            <ul className="notification-list">
              {notifications.items.slice(0, 5).map((notification) => {
                const Icon = notification.kind === "message" ? MessageCircle : Truck;
                return (
                  <li key={notification.id}>
                    <button
                      className={cx("notification-item", !notification.read && "unread")}
                      data-testid="notification-item"
                      onClick={() => {
                        notifications.markRead(notification.id);
                        setOpen(false);
                        onOpen(notification);
                      }}
                      type="button"
                    >
                      <Icon size={15} aria-hidden="true" />
                      <span className="notification-text">
                        <strong>{notificationTitle(notification, text)}</strong>
                        <span>{notificationDetail(notification)}</span>
                        <time dateTime={notification.occurredAt}>{relativeTime(notification.occurredAt, language)}</time>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {notifications.items.length > 0 && (
            <div className="header-dropdown-footer">
              <button
                className="link-action"
                disabled={unread === 0}
                onClick={() => {
                  notifications.markAllRead();
                  setOpen(false);
                }}
                type="button"
              >
                {text.markAllRead}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export interface AppLayoutProps {
  user: LoginResponse["user"] | null;
  navigation: NavigationItem[];
  activeFlow: string;
  canTogglePresence: boolean;
  presenceUpdating: boolean;
  status: string;
  notifications: NotificationsState;
  onOpenNotification: (notification: AppNotification) => void;
  onTogglePresence: () => void;
  onLogout: () => void;
  children: ReactNode;
}

export function AppLayout(props: AppLayoutProps) {
  const [language, setLanguage] = useState<UiLanguage>(() => readStoredLanguage());
  const [profileOpen, setProfileOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const profileTriggerRef = useRef<HTMLButtonElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const text = headerText[language];
  const { user } = props;
  const fullName = user ? `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() : "";
  const roleLabel = user ? roleLabels[language][user.role] ?? user.role : "";
  const settingsPath = props.navigation.find((item) => item.key === "admin" && !item.hidden)?.path ?? null;
  const isAdmin = user ? navigationRole(user.role) === "admin" : false;
  useDismiss(profileOpen, profileRef, profileTriggerRef, () => setProfileOpen(false));

  // Keep the active item visible in the horizontally scrolling nav (mobile / narrow screens).
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>(`[data-nav-key="${props.activeFlow}"]`);
    if (!nav || !active) return;
    const left = active.offsetLeft - nav.offsetLeft;
    if (left < nav.scrollLeft || left + active.offsetWidth > nav.scrollLeft + nav.clientWidth) {
      nav.scrollLeft = Math.max(0, left - (nav.clientWidth - active.offsetWidth) / 2);
    }
  }, [props.activeFlow, language]);

  // Menu button pattern: focus moves to the first item when the menu opens.
  useEffect(() => {
    if (profileOpen) profileMenuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
  }, [profileOpen]);

  function closeProfileMenu() {
    setProfileOpen(false);
    profileTriggerRef.current?.focus();
  }

  function chooseLanguage(next: UiLanguage) {
    setLanguage(next);
    storeLanguage(next);
    closeProfileMenu();
  }

  function openSettings() {
    closeProfileMenu();
    if (settingsPath) navigate(settingsPath);
  }

  return (
    <div className="app-shell" lang={language}>
      <header className="topbar" data-testid="app-topbar">
        <div className="brand" data-testid="app-brand">
          <span className="brand-mark">G</span>
          <span className="brand-name">Garanti Kuluçka</span>
        </div>
        <nav aria-label={text.nav} data-testid="app-nav" ref={navRef}>
          {props.navigation
            .filter((item) => !item.hidden)
            .map((item) => {
              const Icon = item.icon;
              const label = language === "en" ? navLabelsEn[item.key] ?? item.label : item.label;
              const active = props.activeFlow === item.key;
              return (
                <NavLink
                  key={item.key}
                  aria-current={active ? "page" : undefined}
                  className={cx("nav-button", active && "active")}
                  data-nav-key={item.key}
                  end
                  to={item.path}
                >
                  <Icon aria-hidden="true" size={16} />
                  <span>{label}</span>
                </NavLink>
              );
            })}
        </nav>
        <div className="topbar-actions" data-testid="app-header-actions">
          {props.canTogglePresence && (
            <button
              className={cx("presence-toggle", user?.is_online && "online")}
              data-testid="presence-toggle"
              disabled={props.presenceUpdating}
              onClick={props.onTogglePresence}
              type="button"
            >
              {user?.is_online ? <Wifi size={15} aria-hidden="true" /> : <WifiOff size={15} aria-hidden="true" />}
              <span>{props.presenceUpdating ? text.changing : user?.is_online ? text.online : text.offline}</span>
            </button>
          )}
          <NotificationBell language={language} notifications={props.notifications} onOpen={props.onOpenNotification} text={text} />
          <div className="header-menu user-chip" data-testid="app-profile" ref={profileRef}>
            <button
              aria-controls="profile-menu"
              aria-expanded={profileOpen}
              aria-haspopup="menu"
              aria-label={text.profileMenu}
              className="profile-trigger"
              data-testid="profile-menu-trigger"
              onClick={() => setProfileOpen((current) => !current)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && !profileOpen) {
                  event.preventDefault();
                  setProfileOpen(true);
                }
              }}
              ref={profileTriggerRef}
              type="button"
            >
              <span className="profile-avatar" aria-hidden="true">
                {userInitials(user)}
                {user && !isAdmin && (
                  <span className={cx("profile-presence-dot", user.is_online && "online")} data-testid="profile-presence-dot" />
                )}
              </span>
              <span className="profile-text">
                <strong className="profile-name" title={fullName || undefined}>
                  {fullName || "Backend session"}
                </strong>
                {user && (
                  <span className="profile-meta">
                    <span className="profile-role">{roleLabel}</span>
                    <span className="profile-email" title={user.email}>
                      {user.email}
                    </span>
                  </span>
                )}
              </span>
              <ChevronDown className={cx("profile-chevron", profileOpen && "open")} size={15} aria-hidden="true" />
            </button>
            {profileOpen && (
              <div
                aria-label={text.profileMenu}
                className="header-dropdown profile-dropdown"
                data-testid="profile-menu"
                id="profile-menu"
                onKeyDown={handleMenuKeyDown}
                ref={profileMenuRef}
                role="menu"
              >
                <div className="profile-dropdown-head" role="presentation">
                  <strong>{fullName || "Backend session"}</strong>
                  {user && <span>{user.email}</span>}
                </div>
                {settingsPath && (
                  <button className="menu-item" onClick={openSettings} role="menuitem" tabIndex={-1} type="button">
                    <User size={15} aria-hidden="true" />
                    {text.profile}
                  </button>
                )}
                {settingsPath && isAdmin && (
                  <button className="menu-item" onClick={openSettings} role="menuitem" tabIndex={-1} type="button">
                    <Settings size={15} aria-hidden="true" />
                    {text.settings}
                  </button>
                )}
                <div className="menu-separator" role="separator" />
                <div aria-label={text.language} className="lang-switch" data-testid="language-switch" role="group">
                  <Languages size={14} aria-hidden="true" />
                  {(["tr", "en"] as const).map((option) => (
                    <button
                      aria-checked={language === option}
                      className={cx("lang-option", language === option && "selected")}
                      key={option}
                      onClick={() => chooseLanguage(option)}
                      role="menuitemradio"
                      tabIndex={-1}
                      type="button"
                    >
                      {option.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div className="menu-separator" role="separator" />
                <button
                  className="menu-item logout-button"
                  onClick={() => {
                    setProfileOpen(false);
                    props.onLogout();
                  }}
                  role="menuitem"
                  tabIndex={-1}
                  type="button"
                >
                  <LogOut size={15} aria-hidden="true" />
                  <span>{text.logout}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="workspace">
        <section className="status-row" aria-live="polite">
          <span>{props.status}</span>
          <span>Supabase kullanılmıyor</span>
          <span>Socket.IO backend sınırı hazır</span>
        </section>
        {props.children}
      </main>
    </div>
  );
}
