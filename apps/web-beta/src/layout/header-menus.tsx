import { Bell, Download, Languages, LogOut, Moon, Sun, User, Wifi, WifiOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { displayName, initialsOf, useAuth } from "@/app/auth";
import { navigationFor } from "@/app/navigation";
import { useInstallPrompt } from "@/app/pwa-hooks";
import { useTheme } from "@/app/theme";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isLanguage, supportedLanguages } from "@/i18n";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";

export function roleLabelKey(role: string | undefined) {
  return role === "owner" || role === "admin" || role === "calisan" || role === "kargo_operatoru" ? (`roles.${role}` as const) : ("roles.unknown" as const);
}

export function LanguageMenu() {
  const { t, i18n } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("header.language")} data-testid="language-menu-trigger">
          <Languages />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuLabel>{t("header.language")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={i18n.language} onValueChange={(value) => isLanguage(value) && void i18n.changeLanguage(value)}>
          {supportedLanguages.map((language) => (
            <DropdownMenuRadioItem key={language} value={language} data-testid={`language-option-${language}`}>
              {language === "tr" ? "Türkçe" : "English"}
              <span className="ml-auto text-xs text-muted-foreground uppercase">{language}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One-click light/dark switch; "system" stays available on the settings page. */
export function ThemeToggle() {
  const { t } = useTranslation();
  const { resolved, setTheme } = useTheme();
  const dark = resolved === "dark";
  const Icon = dark ? Moon : Sun;
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("header.theme")}
      aria-pressed={dark}
      title={t(dark ? "header.themeLight" : "header.themeDark")}
      onClick={() => setTheme(dark ? "light" : "dark")}
      data-testid="theme-toggle"
    >
      <Icon />
    </Button>
  );
}

/** Bell fed by backend summaries (unread messages, pending confirmations, missing tracking), refreshed every minute. */
export function NotificationBell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { api, user } = useAuth();
  const allowed = new Set(navigationFor(user?.role).map((item) => item.key));
  const { data } = useQuery(
    `notifications:${user?.public_id ?? ""}`,
    async () => {
      const [conversations, orders, shipments] = await Promise.all([
        allowed.has("messages") ? api.conversationSummary().catch(() => null) : null,
        allowed.has("orders") ? api.orderSummary().catch(() => null) : null,
        allowed.has("shipments") ? api.shipmentSummary().catch(() => null) : null,
      ]);
      return [
        { key: "messages", count: conversations?.unread_count ?? 0, path: "/mesajlar", label: "header.unreadMessages" },
        { key: "orders", count: orders?.pending_confirmation_count ?? 0, path: "/siparisler", label: "header.pendingConfirmations" },
        { key: "shipments", count: shipments?.exception_counts.tracking_missing ?? 0, path: "/kargolar", label: "header.trackingMissing" },
      ] as const;
    },
    { enabled: Boolean(user), refreshMs: 60_000 },
  );
  const items = (data ?? []).filter((item) => item.count > 0);
  const total = items.reduce((sum, item) => sum + item.count, 0);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={total > 0 ? t("header.notificationsUnread", { count: total }) : t("header.notifications")}
          data-testid="notification-trigger"
        >
          <Bell />
          {total > 0 && (
            <span
              className="absolute top-1.5 right-1.5 inline-flex min-w-4.5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4.5 font-bold text-white"
              data-testid="notification-badge"
              aria-hidden="true"
            >
              {total > 99 ? "99+" : total}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80" data-testid="notification-panel">
        <DropdownMenuLabel>{t("header.notifications")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t("header.noNotifications")}</p>
        ) : (
          items.map((item) => (
            <DropdownMenuItem key={item.key} onSelect={() => navigate(item.path)} data-testid={`notification-${item.key}`}>
              <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
              <span className="whitespace-normal">{t(item.label, { count: item.count })}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Admins/owners are ghost observers (legacy Sidebar): no presence state, no toggle, no dot. */
function hasPresence(role: string | undefined) {
  return role !== undefined && role !== "admin" && role !== "owner";
}

export function ProfileMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { api, user, logout, updateUser } = useAuth();
  const { canInstall, install } = useInstallPrompt();
  const [presenceBusy, setPresenceBusy] = useState(false);
  const staff = hasPresence(user?.role);
  const online = Boolean(user?.is_online);

  async function togglePresence() {
    if (presenceBusy) return;
    setPresenceBusy(true);
    try {
      const updated = await api.setPresence(!online);
      updateUser({ is_online: updated.is_online ?? !online });
    } catch {
      // keep the current state; the next /auth/me refresh is authoritative
    } finally {
      setPresenceBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 px-1.5 sm:px-2" aria-label={t("header.profileMenu")} data-testid="profile-menu-trigger">
          <span className="relative">
            <Avatar>
              <AvatarFallback>{initialsOf(user)}</AvatarFallback>
            </Avatar>
            {staff && (
              <span
                className={cn("absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-background", online ? "bg-emerald-500" : "bg-muted-foreground/60")}
                data-testid="profile-presence-dot"
                data-online={online ? "true" : "false"}
                aria-hidden="true"
              />
            )}
          </span>
          <span className="hidden max-w-32 truncate text-left text-sm font-medium 2xl:block">{displayName(user)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64" data-testid="profile-menu">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate" data-testid="profile-name">{displayName(user)}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">{user?.email}</span>
          <span className="text-xs font-normal text-primary" data-testid="profile-role">{t(roleLabelKey(user?.role))}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/ayarlar")} data-testid="profile-menu-profile">
          <User />
          {t("header.profile")}
        </DropdownMenuItem>
        {canInstall && (
          <DropdownMenuItem onSelect={() => void install()} data-testid="profile-menu-install">
            <Download />
            {t("header.install")}
          </DropdownMenuItem>
        )}
        {staff && (
          <DropdownMenuItem onSelect={(event) => { event.preventDefault(); void togglePresence(); }} disabled={presenceBusy} data-testid="profile-presence-toggle" data-online={online ? "true" : "false"}>
            {online ? <Wifi className="text-emerald-500" /> : <WifiOff />}
            {online ? t("header.presenceOnline") : t("header.presenceOffline")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          data-testid="profile-menu-logout"
          onSelect={() => {
            void logout().then(() => navigate("/giris", { replace: true }));
          }}
        >
          <LogOut />
          {t("header.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
