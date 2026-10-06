import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, MessageCircle, Settings, ShoppingCart, Truck, Users } from "lucide-react";
import { panelRoleOf, type PanelRole } from "@garanti-kulucka/shared";

export type NavKey = "dashboard" | "orders" | "messages" | "customers" | "shipments" | "settings";

export interface NavItem {
  key: NavKey;
  path: string;
  icon: LucideIcon;
  roles: readonly PanelRole[];
  /** Shown in the mobile bottom bar (frequently used pages). */
  bottomBar: boolean;
}

const everyone: readonly PanelRole[] = ["manager", "calisan", "kargo_operatoru"];
const office: readonly PanelRole[] = ["manager", "calisan"];

export const navItems: readonly NavItem[] = [
  { key: "dashboard", path: "/", icon: LayoutDashboard, roles: office, bottomBar: true },
  { key: "orders", path: "/siparisler", icon: ShoppingCart, roles: everyone, bottomBar: true },
  { key: "messages", path: "/mesajlar", icon: MessageCircle, roles: everyone, bottomBar: true },
  { key: "customers", path: "/musteriler", icon: Users, roles: office, bottomBar: false },
  { key: "shipments", path: "/kargolar", icon: Truck, roles: everyone, bottomBar: true },
  { key: "settings", path: "/ayarlar", icon: Settings, roles: everyone, bottomBar: false },
];

/** Menu for a backend role (owner/admin → manager); unknown roles only get settings/profile. */
export function navigationFor(role: string | null | undefined): NavItem[] {
  const panelRole = panelRoleOf(role);
  if (!panelRole) return navItems.filter((item) => item.key === "settings");
  return navItems.filter((item) => item.roles.includes(panelRole));
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
