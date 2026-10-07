import type { LucideIcon } from "lucide-react";
import { BarChart3, BookUser, Bot, Contact, FileText, Instagram, LineChart, LayoutDashboard, MessageCircle, MessageSquare, MessageSquareText, Package, PhoneCall, ScrollText, Settings, ShieldX, ShoppingCart, Truck, UserCog, Users, Voicemail, Wallet, XCircle } from "lucide-react";
import { panelRoleOf, type PanelRole } from "@garanti-kulucka/shared";

export type NavKey = "dashboard" | "orders" | "messages" | "customers" | "shipments" | "settings" | "cancellations" | "invoices" | "accounts" | "inventory" | "balances" | "comments" | "sms" | "reports" | "instagramAnalytics" | "instagramPublish" | "calls" | "voiceMessages" | "phonebook" | "vapi" | "users" | "activityLogs" | "dataDeletionRequests";

export interface NavItem {
  key: NavKey;
  path: string;
  icon: LucideIcon;
  roles: readonly PanelRole[];
  /** Shown in the mobile bottom bar (frequently used pages). */
  bottomBar: boolean;
  /** "more" pages live in the desktop "More" menu and a separate mobile menu section. */
  section?: "main" | "more";
}

const everyone: readonly PanelRole[] = ["manager", "calisan", "kargo_operatoru"];
const office: readonly PanelRole[] = ["manager", "calisan"];
const managers: readonly PanelRole[] = ["manager"];

export const navItems: readonly NavItem[] = [
  { key: "dashboard", path: "/", icon: LayoutDashboard, roles: office, bottomBar: true },
  { key: "orders", path: "/siparisler", icon: ShoppingCart, roles: everyone, bottomBar: true },
  { key: "messages", path: "/mesajlar", icon: MessageCircle, roles: everyone, bottomBar: true },
  { key: "customers", path: "/musteriler", icon: Users, roles: office, bottomBar: false },
  { key: "shipments", path: "/kargolar", icon: Truck, roles: everyone, bottomBar: true },
  { key: "settings", path: "/ayarlar", icon: Settings, roles: everyone, bottomBar: false },
  { key: "cancellations", path: "/iptaller", icon: XCircle, roles: office, bottomBar: false, section: "more" },
  { key: "inventory", path: "/stok", icon: Package, roles: office, bottomBar: false, section: "more" },
  { key: "balances", path: "/bakiye", icon: Wallet, roles: office, bottomBar: false, section: "more" },
  { key: "comments", path: "/yorumlar", icon: MessageSquareText, roles: office, bottomBar: false, section: "more" },
  { key: "sms", path: "/sms", icon: MessageSquare, roles: everyone, bottomBar: false, section: "more" },
  { key: "instagramAnalytics", path: "/instagram/analitik", icon: LineChart, roles: office, bottomBar: false, section: "more" },
  { key: "instagramPublish", path: "/instagram/yayinla", icon: Instagram, roles: office, bottomBar: false, section: "more" },
  { key: "reports", path: "/raporlar", icon: BarChart3, roles: managers, bottomBar: false, section: "more" },
  { key: "invoices", path: "/faturalar", icon: FileText, roles: managers, bottomBar: false, section: "more" },
  { key: "accounts", path: "/cari-hesaplar", icon: BookUser, roles: managers, bottomBar: false, section: "more" },
  { key: "calls", path: "/sesli-asistan", icon: PhoneCall, roles: managers, bottomBar: false, section: "more" },
  { key: "voiceMessages", path: "/sesli-asistan/sesli-mesajlar", icon: Voicemail, roles: managers, bottomBar: false, section: "more" },
  { key: "vapi", path: "/sesli-asistan/vapi", icon: Bot, roles: managers, bottomBar: false, section: "more" },
  { key: "phonebook", path: "/sesli-asistan/rehber", icon: Contact, roles: managers, bottomBar: false, section: "more" },
  { key: "users", path: "/kullanicilar", icon: UserCog, roles: managers, bottomBar: false, section: "more" },
  { key: "activityLogs", path: "/islem-loglari", icon: ScrollText, roles: managers, bottomBar: false, section: "more" },
  { key: "dataDeletionRequests", path: "/veri-silme-talepleri", icon: ShieldX, roles: managers, bottomBar: false, section: "more" },
];

/** Menu for a backend role (owner/admin → manager); unknown roles only get settings/profile. */
export function navigationFor(role: string | null | undefined): NavItem[] {
  const panelRole = panelRoleOf(role);
  if (!panelRole) return navItems.filter((item) => item.key === "settings");
  return navItems.filter((item) => item.roles.includes(panelRole));
}

export function mainNavigationFor(role: string | null | undefined) {
  return navigationFor(role).filter((item) => item.section !== "more");
}

export function moreNavigationFor(role: string | null | undefined) {
  return navigationFor(role).filter((item) => item.section === "more");
}

/** Legacy HomeRedirect: kargo operatörü starts on orders, everyone else on the dashboard. */
export function homePathFor(role: string | null | undefined) {
  return navigationFor(role)[0]?.path ?? "/ayarlar";
}

export function canAccessPath(role: string | null | undefined, pathname: string) {
  return navigationFor(role).some((item) => (item.path === "/" ? pathname === "/" : pathname === item.path || pathname.startsWith(`${item.path}/`)));
}

/** Bottom bar: at most 4 frequent pages for the role, the rest live in the hamburger sheet. */
export function bottomBarFor(role: string | null | undefined) {
  return navigationFor(role).filter((item) => item.bottomBar).slice(0, 4);
}
