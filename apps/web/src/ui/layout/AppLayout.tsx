import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Languages, LogOut, Wifi, WifiOff } from "lucide-react";
import type { LoginResponse } from "../../api/auth-client.js";
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
  tr: { online: "Çevrimiçi", offline: "Çevrimdışı", changing: "Değişiyor", logout: "Çıkış", language: "Dil", nav: "Ana gezinme" },
  en: { online: "Online", offline: "Offline", changing: "Updating", logout: "Sign out", language: "Language", nav: "Main navigation" },
} satisfies Record<UiLanguage, Record<string, string>>;

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

export interface AppLayoutProps {
  user: LoginResponse["user"] | null;
  navigation: NavigationItem[];
  activeFlow: string;
  canTogglePresence: boolean;
  presenceUpdating: boolean;
  status: string;
  onTogglePresence: () => void;
  onLogout: () => void;
  children: ReactNode;
}

export function AppLayout(props: AppLayoutProps) {
  const [language, setLanguage] = useState<UiLanguage>(() => readStoredLanguage());
  const navRef = useRef<HTMLElement>(null);
  const text = headerText[language];
  const { user } = props;
  const fullName = user ? `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() : "";
  const roleLabel = user ? roleLabels[language][user.role] ?? user.role : "";

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

  function chooseLanguage(next: UiLanguage) {
    setLanguage(next);
    storeLanguage(next);
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
          <div className="user-chip" data-testid="app-profile">
            <span className="profile-avatar" aria-hidden="true">
              {userInitials(user)}
              {user && navigationRole(user.role) !== "admin" && (
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
            <span className="lang-switch" role="group" aria-label={text.language} data-testid="language-switch">
              <Languages size={14} aria-hidden="true" />
              {(["tr", "en"] as const).map((option) => (
                <button
                  aria-pressed={language === option}
                  className={cx("lang-option", language === option && "selected")}
                  key={option}
                  onClick={() => chooseLanguage(option)}
                  type="button"
                >
                  {option.toUpperCase()}
                </button>
              ))}
            </span>
            <button className="logout-button" type="button" onClick={props.onLogout}>
              <LogOut size={14} aria-hidden="true" />
              <span>{text.logout}</span>
            </button>
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
