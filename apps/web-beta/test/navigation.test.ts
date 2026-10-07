import { describe, expect, it } from "vitest";
import { panelRoleOf } from "@garanti-kulucka/shared";
import { bottomBarFor, canAccessPath, homePathFor, mainNavigationFor, moreNavigationFor, navigationFor } from "../src/app/navigation";

const keys = (role: string | null) => mainNavigationFor(role).map((item) => item.key);
const moreKeys = (role: string | null) => moreNavigationFor(role).map((item) => item.key);

describe("role-based menu", () => {
  it("maps owner and admin to the manager group", () => {
    expect(panelRoleOf("owner")).toBe("manager");
    expect(panelRoleOf("admin")).toBe("manager");
    expect(panelRoleOf("calisan")).toBe("calisan");
    expect(panelRoleOf("kargo_operatoru")).toBe("kargo_operatoru");
    expect(panelRoleOf("misafir")).toBeNull();
  });

  it("gives managers and staff the full menu", () => {
    const full = ["dashboard", "orders", "messages", "customers", "shipments", "settings"];
    expect(keys("owner")).toEqual(full);
    expect(keys("admin")).toEqual(full);
    expect(keys("calisan")).toEqual(full);
  });

  it("puts the extra pages in the More menu with their legacy roles", () => {
    const managerMore = ["cargoPipeline", "cancellations", "inventory", "balances", "comments", "sms", "instagramAnalytics", "instagramPublish", "reports", "invoices", "accounts", "calls", "voiceMessages", "vapi", "phonebook", "users", "activityLogs", "dataDeletionRequests", "suratDebug", "cronDebug", "whatsappDebug", "instagramDebug", "aiDebug", "aiTraining"];
    expect(moreKeys("admin")).toEqual(managerMore);
    expect(moreKeys("owner")).toEqual(managerMore);
    expect(moreKeys("calisan")).toEqual(["cargoPipeline", "cancellations", "inventory", "balances", "comments", "sms", "instagramAnalytics", "instagramPublish"]);
    expect(moreKeys("kargo_operatoru")).toEqual(["cargoPipeline", "sms"]);
    expect(canAccessPath("calisan", "/iptaller")).toBe(true);
    expect(canAccessPath("kargo_operatoru", "/iptaller")).toBe(false);
    expect(canAccessPath("calisan", "/faturalar")).toBe(false);
    expect(canAccessPath("admin", "/cari-hesaplar")).toBe(true);
    expect(navigationFor("admin").map((item) => item.key)).toContain("cancellations");
  });

  it("limits cargo operators to orders, messages, shipments and settings", () => {
    expect(keys("kargo_operatoru")).toEqual(["orders", "messages", "shipments", "settings"]);
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
    expect(keys("unknown-role")).toEqual(["settings"]);
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
