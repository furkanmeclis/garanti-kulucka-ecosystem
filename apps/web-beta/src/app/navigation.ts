import type { LucideIcon } from "lucide-react";
import { AudioLines, BarChart3, BookUser, Bot, Boxes, BrainCircuit, Bug, Calculator, Contact, FileText, GraduationCap, Instagram, LineChart, LayoutDashboard, MessageCircle, MessageSquare, MessageSquareCode, MessageSquareText, Package, PhoneCall, ScrollText, Settings, ShieldX, ShoppingCart, TimerReset, Truck, UserCog, Users, Voicemail, Wallet, Webhook, XCircle, Zap } from "lucide-react";
import { panelRoleOf, type PanelRole } from "@garanti-kulucka/shared";

export type NavKey = "dashboard" | "orders" | "messages" | "customers" | "shipments" | "settings" | "cancellations" | "invoices" | "accounts" | "inventory" | "balances" | "comments" | "sms" | "reports" | "instagramAnalytics" | "instagramPublish" | "calls" | "voiceMessages" | "phonebook" | "vapi" | "users" | "activityLogs" | "dataDeletionRequests" | "cargoPipeline" | "suratDebug" | "cronDebug" | "whatsappDebug" | "instagramDebug" | "aiDebug" | "aiTraining";

/** "main" pages sit in the top bar, the menu groups get a desktop dropdown each, "settings" pages live in the settings sub-nav. */
export type NavGroup = "main" | MenuGroup | "settings";
export type MenuGroup = "operations" | "accounting" | "instagram" | "voice";
export type SettingsSection = "general" | "management" | "developer";

export interface NavItem {
  key: NavKey;
  path: string;
  icon: LucideIcon;
  roles: readonly PanelRole[];
  /** Shown in the mobile bottom bar (frequently used pages). */
  bottomBar: boolean;
  group: NavGroup;
  /** Sub-heading inside the settings sub-nav (only for group "settings"). */
  settingsSection?: SettingsSection;
}

const everyone: readonly PanelRole[] = ["manager", "calisan", "kargo_operatoru"];
const office: readonly PanelRole[] = ["manager", "calisan"];
const managers: readonly PanelRole[] = ["manager"];

// Order matters: the first entry a role sees is its home page, and menus keep this order.
export const navItems: readonly NavItem[] = [
  { key: "dashboard", path: "/", icon: LayoutDashboard, roles: office, bottomBar: true, group: "main" },
  { key: "orders", path: "/siparisler", icon: ShoppingCart, roles: everyone, bottomBar: true, group: "main" },
  { key: "messages", path: "/mesajlar", icon: MessageCircle, roles: everyone, bottomBar: true, group: "main" },
  { key: "customers", path: "/musteriler", icon: Users, roles: office, bottomBar: false, group: "main" },
  { key: "shipments", path: "/kargolar", icon: Truck, roles: everyone, bottomBar: true, group: "main" },
  { key: "cargoPipeline", path: "/kargolar/pipeline", icon: Zap, roles: everyone, bottomBar: false, group: "operations" },
  { key: "cancellations", path: "/iptaller", icon: XCircle, roles: office, bottomBar: false, group: "operations" },
  { key: "inventory", path: "/stok", icon: Package, roles: office, bottomBar: false, group: "operations" },
  { key: "comments", path: "/yorumlar", icon: MessageSquareText, roles: office, bottomBar: false, group: "operations" },
  { key: "sms", path: "/sms", icon: MessageSquare, roles: everyone, bottomBar: false, group: "operations" },
  { key: "balances", path: "/bakiye", icon: Wallet, roles: office, bottomBar: false, group: "accounting" },
  { key: "invoices", path: "/faturalar", icon: FileText, roles: managers, bottomBar: false, group: "accounting" },
  { key: "accounts", path: "/cari-hesaplar", icon: BookUser, roles: managers, bottomBar: false, group: "accounting" },
  { key: "reports", path: "/raporlar", icon: BarChart3, roles: managers, bottomBar: false, group: "accounting" },
  { key: "instagramAnalytics", path: "/instagram/analitik", icon: LineChart, roles: office, bottomBar: false, group: "instagram" },
  { key: "instagramPublish", path: "/instagram/yayinla", icon: Instagram, roles: office, bottomBar: false, group: "instagram" },
  { key: "calls", path: "/sesli-asistan", icon: PhoneCall, roles: managers, bottomBar: false, group: "voice" },
  { key: "voiceMessages", path: "/sesli-asistan/sesli-mesajlar", icon: Voicemail, roles: managers, bottomBar: false, group: "voice" },
  { key: "vapi", path: "/sesli-asistan/vapi", icon: Bot, roles: managers, bottomBar: false, group: "voice" },
  { key: "phonebook", path: "/sesli-asistan/rehber", icon: Contact, roles: managers, bottomBar: false, group: "voice" },
  { key: "settings", path: "/ayarlar", icon: Settings, roles: everyone, bottomBar: false, group: "settings", settingsSection: "general" },
  { key: "users", path: "/kullanicilar", icon: UserCog, roles: managers, bottomBar: false, group: "settings", settingsSection: "management" },
  { key: "activityLogs", path: "/islem-loglari", icon: ScrollText, roles: managers, bottomBar: false, group: "settings", settingsSection: "management" },
  { key: "dataDeletionRequests", path: "/veri-silme-talepleri", icon: ShieldX, roles: managers, bottomBar: false, group: "settings", settingsSection: "management" },
  // Admin debug pages (web: /kargo/surat-debug, /kargo/cron-debug and the /ayarlar/* debug routes).
  { key: "suratDebug", path: "/kargolar/surat-debug", icon: Bug, roles: managers, bottomBar: false, group: "settings", settingsSection: "developer" },
  { key: "cronDebug", path: "/kargolar/cron-debug", icon: TimerReset, roles: managers, bottomBar: false, group: "settings", settingsSection: "developer" },
  { key: "whatsappDebug", path: "/ayarlar/whatsapp-debug", icon: MessageSquareCode, roles: managers, bottomBar: false, group: "settings", settingsSection: "developer" },
  { key: "instagramDebug", path: "/ayarlar/instagram-debug", icon: Webhook, roles: managers, bottomBar: false, group: "settings", settingsSection: "developer" },
  { key: "aiDebug", path: "/ayarlar/ai-debug", icon: BrainCircuit, roles: managers, bottomBar: false, group: "settings", settingsSection: "developer" },
  { key: "aiTraining", path: "/ayarlar/ai-egitim", icon: GraduationCap, roles: managers, bottomBar: false, group: "settings", settingsSection: "developer" },
];

/** Desktop dropdowns / mobile sheet sections, in display order. */
export const menuGroups: ReadonlyArray<{ key: MenuGroup; icon: LucideIcon }> = [
  { key: "operations", icon: Boxes },
  { key: "accounting", icon: Calculator },
  { key: "instagram", icon: Instagram },
  { key: "voice", icon: AudioLines },
];

export const settingsSections: readonly SettingsSection[] = ["general", "management", "developer"];

/** Menu for a backend role (owner/admin → manager); unknown roles only get settings/profile. */
export function navigationFor(role: string | null | undefined): NavItem[] {
  const panelRole = panelRoleOf(role);
  if (!panelRole) return navItems.filter((item) => item.key === "settings");
  return navItems.filter((item) => item.roles.includes(panelRole));
}

export function mainNavigationFor(role: string | null | undefined) {
  return navigationFor(role).filter((item) => item.group === "main");
}

/** Dropdown groups with the items the role may open; a group the role sees nothing of is left out. */
export function navGroupsFor(role: string | null | undefined) {
  const items = navigationFor(role);
  return menuGroups
    .map((group) => ({ ...group, items: items.filter((item) => item.group === group.key) }))
    .filter((group) => group.items.length > 0);
}

/** Settings sub-nav sections for the role; "general" (/ayarlar) is there for every role. */
export function settingsNavFor(role: string | null | undefined) {
  const items = navigationFor(role).filter((item) => item.group === "settings");
  return settingsSections
    .map((section) => ({ key: section, items: items.filter((item) => item.settingsSection === section) }))
    .filter((section) => section.items.length > 0);
}

/** Legacy HomeRedirect: kargo operatörü starts on orders, everyone else on the dashboard. */
export function homePathFor(role: string | null | undefined) {
  return navigationFor(role)[0]?.path ?? "/ayarlar";
}

/** The most specific menu entry owns a path, so /ayarlar/ai-debug belongs to the debug page, not /ayarlar. */
export function navOwnerOf(pathname: string) {
  return navItems
    .filter((item) => (item.path === "/" ? pathname === "/" : pathname === item.path || pathname.startsWith(`${item.path}/`)))
    .reduce<NavItem | undefined>((best, item) => (!best || item.path.length > best.path.length ? item : best), undefined);
}

/** Access follows the owning entry's roles, so /ayarlar/ai-debug is manager-only even though /ayarlar is not. */
export function canAccessPath(role: string | null | undefined, pathname: string) {
  const owner = navOwnerOf(pathname);
  return Boolean(owner && navigationFor(role).includes(owner));
}

/** Bottom bar: at most 4 frequent pages for the role, the rest live in the hamburger sheet. */
export function bottomBarFor(role: string | null | undefined) {
  return navigationFor(role).filter((item) => item.bottomBar).slice(0, 4);
}
