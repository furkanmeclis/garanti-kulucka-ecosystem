import { describe, expect, it } from "vitest";
import { panelRoleOf } from "@garanti-kulucka/shared";
import { bottomBarFor, canAccessPath, homePathFor, mainNavigationFor, navGroupsFor, navigationFor, navItems, navOwnerOf, settingsNavFor } from "../src/app/navigation";

const keys = (role: string | null) => mainNavigationFor(role).map((item) => item.key);
const groups = (role: string | null) => Object.fromEntries(navGroupsFor(role).map((group) => [group.key, group.items.map((item) => item.key)]));
const settings = (role: string | null) => Object.fromEntries(settingsNavFor(role).map((section) => [section.key, section.items.map((item) => item.key)]));

describe("role-based menu", () => {
  it("maps owner and admin to the manager group", () => {
    expect(panelRoleOf("owner")).toBe("manager");
    expect(panelRoleOf("admin")).toBe("manager");
    expect(panelRoleOf("calisan")).toBe("calisan");
    expect(panelRoleOf("kargo_operatoru")).toBe("kargo_operatoru");
    expect(panelRoleOf("misafir")).toBeNull();
  });

  it("gives managers and staff the full menu", () => {
    const full = ["dashboard", "orders", "messages", "customers", "shipments"];
    expect(keys("owner")).toEqual(full);
    expect(keys("admin")).toEqual(full);
    expect(keys("calisan")).toEqual(full);
  });

  it("groups the extra pages into the top bar dropdowns with their legacy roles", () => {
    const managerGroups = {
      operations: ["cargoPipeline", "cancellations", "inventory", "comments", "sms"],
      accounting: ["balances", "invoices", "accounts", "reports"],
      instagram: ["instagramAnalytics", "instagramPublish"],
      voice: ["calls", "voiceMessages", "vapi", "phonebook"],
    };
    expect(groups("admin")).toEqual(managerGroups);
    expect(groups("owner")).toEqual(managerGroups);
    expect(navGroupsFor("admin").map((group) => group.key)).toEqual(["operations", "accounting", "instagram", "voice"]);
    // Staff miss the manager-only accounting pages and the whole voice group.
    expect(groups("calisan")).toEqual({ operations: ["cargoPipeline", "cancellations", "inventory", "comments", "sms"], accounting: ["balances"], instagram: ["instagramAnalytics", "instagramPublish"] });
    expect(groups("kargo_operatoru")).toEqual({ operations: ["cargoPipeline", "sms"] });
    expect(groups("unknown-role")).toEqual({});
    expect(canAccessPath("calisan", "/iptaller")).toBe(true);
    expect(canAccessPath("kargo_operatoru", "/iptaller")).toBe(false);
    expect(canAccessPath("calisan", "/faturalar")).toBe(false);
    expect(canAccessPath("admin", "/cari-hesaplar")).toBe(true);
    expect(navigationFor("admin").map((item) => item.key)).toContain("cancellations");
  });

  it("puts settings, management and developer pages in the settings sub-nav", () => {
    expect(settings("admin")).toEqual({
      general: ["settings"],
      management: ["users", "activityLogs", "dataDeletionRequests"],
      developer: ["suratDebug", "cronDebug", "whatsappDebug", "instagramDebug", "aiDebug", "aiTraining"],
    });
    expect(settings("owner")).toEqual(settings("admin"));
    // Settings itself stays for every role, even unknown ones.
    for (const role of ["calisan", "kargo_operatoru", "unknown-role", null]) expect(settings(role)).toEqual({ general: ["settings"] });
  });

  it("places every menu entry in exactly one group", () => {
    const placed = [...mainNavigationFor("admin"), ...navGroupsFor("admin").flatMap((group) => group.items), ...settingsNavFor("admin").flatMap((section) => section.items)];
    expect(placed.map((item) => item.key).sort()).toEqual(navItems.map((item) => item.key).sort());
    for (const item of navItems) expect(Boolean(item.settingsSection), item.key).toBe(item.group === "settings");
  });

  it("resolves the most specific owner of a path for active styling", () => {
    expect(navOwnerOf("/kargolar")?.key).toBe("shipments");
    expect(navOwnerOf("/kargolar/cron-debug")?.group).toBe("settings");
    expect(navOwnerOf("/kargolar/pipeline")?.group).toBe("operations");
    expect(navOwnerOf("/ayarlar/ai-egitim")?.key).toBe("aiTraining");
    expect(navOwnerOf("/ayarlar")?.key).toBe("settings");
    expect(navOwnerOf("/sesli-asistan/rehber")?.group).toBe("voice");
    expect(navOwnerOf("/siparisler/ord_1")?.key).toBe("orders");
    expect(navOwnerOf("/bilinmeyen")).toBeUndefined();
  });

  it("limits cargo operators to orders, messages, shipments and settings", () => {
    expect(keys("kargo_operatoru")).toEqual(["orders", "messages", "shipments"]);
    expect(canAccessPath("kargo_operatoru", "/musteriler")).toBe(false);
    expect(canAccessPath("kargo_operatoru", "/")).toBe(false);
    expect(canAccessPath("kargo_operatoru", "/kargolar")).toBe(true);
  });

  it("uses legacy home pages per role", () => {
    expect(homePathFor("admin")).toBe("/");
    expect(homePathFor("owner")).toBe("/");
    expect(homePathFor("calisan")).toBe("/");
    expect(homePathFor("kargo_operatoru")).toBe("/siparisler");
    expect(homePathFor("unknown-role")).toBe("/ayarlar");
    expect(keys("unknown-role")).toEqual([]);
    expect(navigationFor("unknown-role").map((item) => item.key)).toEqual(["settings"]);
  });

  it("keeps the debug pages manager-only even under /ayarlar and /kargolar", () => {
    for (const path of ["/ayarlar/whatsapp-debug", "/ayarlar/instagram-debug", "/ayarlar/ai-debug", "/ayarlar/ai-egitim", "/kargolar/surat-debug", "/kargolar/cron-debug"]) {
      expect(canAccessPath("admin", path), path).toBe(true);
      expect(canAccessPath("calisan", path), path).toBe(false);
      expect(canAccessPath("kargo_operatoru", path), path).toBe(false);
    }
    expect(canAccessPath("calisan", "/ayarlar")).toBe(true);
    expect(canAccessPath("kargo_operatoru", "/kargolar/pipeline")).toBe(true);
  });

  it("matches nested paths but never treats / as a prefix", () => {
    expect(canAccessPath("calisan", "/siparisler/ord_1")).toBe(true);
    expect(canAccessPath("calisan", "/bilinmeyen")).toBe(false);
  });

  it("keeps at most four frequent pages in the mobile bottom bar", () => {
    expect(bottomBarFor("admin").map((item) => item.key)).toEqual(["dashboard", "orders", "messages", "shipments"]);
    expect(bottomBarFor("kargo_operatoru").map((item) => item.key)).toEqual(["orders", "messages", "shipments"]);
    for (const role of ["admin", "calisan", "kargo_operatoru"]) expect(bottomBarFor(role).length).toBeLessThanOrEqual(4);
  });
});
