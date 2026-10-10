import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import en from "../src/i18n/locales/en.json";
import tr from "../src/i18n/locales/tr.json";
import { defaultLanguage, initI18n, isLanguage, languageStorageKey, localeFor, readStoredLanguage, storeLanguage } from "../src/i18n";
import { cargoPipelineStatuses } from "../src/lib/cargo-pipeline";
import { enumGroups, enumLabel, statusAliases, statusLabel, statusText } from "../src/lib/status";

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((out, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? { ...out, [path]: value } : { ...out, ...flatten(value, path) };
  }, {});
}

const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

describe("i18n dictionaries", () => {
  const flatTr = flatten(tr as Tree);
  const flatEn = flatten(en as Tree);

  it("TR and EN define exactly the same keys", () => {
    expect(Object.keys(flatEn).sort()).toEqual(Object.keys(flatTr).sort());
  });

  it("every value is non-empty and keeps the same placeholders", () => {
    for (const key of Object.keys(flatTr)) {
      expect(flatTr[key]!.trim(), `tr ${key}`).not.toBe("");
      expect(flatEn[key]!.trim(), `en ${key}`).not.toBe("");
      expect(placeholders(flatEn[key]!), key).toEqual(placeholders(flatTr[key]!));
    }
  });

  it("has Turkish as the default and stores the choice under its own key", () => {
    expect(defaultLanguage).toBe("tr");
    expect(readStoredLanguage(memoryStorage())).toBe("tr");
    expect(readStoredLanguage(memoryStorage({ [languageStorageKey]: "en" }))).toBe("en");
    expect(readStoredLanguage(memoryStorage({ [languageStorageKey]: "de" }))).toBe("tr");
    const storage = memoryStorage();
    storeLanguage("en", storage);
    expect(storage.data.get(languageStorageKey)).toBe("en");
    expect(languageStorageKey).not.toBe("garanti-lang");
    expect(isLanguage("en")).toBe(true);
    expect(isLanguage("fr")).toBe(false);
    expect(localeFor("en")).toBe("en-GB");
    expect(localeFor("tr")).toBe("tr-TR");
  });

  it("translates, pluralises and switches language at runtime", async () => {
    const i18n = await initI18n("tr");
    expect(i18n.t("nav.orders")).toBe("Siparişler");
    expect(i18n.t("header.unreadMessages", { count: 3 })).toBe("3 okunmamış mesaj");
    await i18n.changeLanguage("en");
    expect(i18n.t("nav.orders")).toBe("Orders");
    expect(i18n.t("header.unreadMessages", { count: 1 })).toBe("1 unread message");
    expect(i18n.t("header.unreadMessages", { count: 2 })).toBe("2 unread messages");
    await i18n.changeLanguage("tr");
  });
});

describe("i18n coverage of the source", () => {
  const flatTr = flatten(tr as Tree);
  const has = (key: string) => key in flatTr || `${key}_one` in flatTr || `${key}_other` in flatTr;
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
    });
  const files = sourceFiles(fileURLToPath(new URL("../src", import.meta.url))).map((path) => ({ path, text: readFileSync(path, "utf8") }));

  /**
   * Dynamic keys (`t(\`orders.${key}\`)`) are checked by prefix: each prefix must be one of these explicitly
   * allowed groups, whose concrete values are covered by the helpers/tests below or by typed unions.
   */
  const dynamicPrefixes = [
    "status.", "statusHint.", "enums.", "nav.", "roles.", "orders.", "orderActions.", "sms.", "comments.", "accounting.", "balances.", "inventory.",
    "cargoPipeline.", "dataDeletion.", "voiceMessages.", "calls.", "vapi.", "users.", "shipments.", "reports.", "settingsTabs.", "debugPages.", "orderEdit.",
    "instagramAnalytics.", "instagramPublish.", "datePicker.", "dashboard.", "chat.", "inbox.", "messages.", "customerDetail.", "cancellations.", "settings.", "header.", "common.", "cargoCreate.", "login.", "passwordReset.", "analytics.",
  ];

  it("every literal t(\"…\") key exists in tr.json", () => {
    const missing: string[] = [];
    for (const { path, text } of files) {
      for (const match of text.matchAll(/\bt\(\s*["']([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)["']/g)) {
        if (!has(match[1]!)) missing.push(`${path.split("/src/")[1]}: ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("dynamic t(`…${}`) keys only use whitelisted prefixes that exist in tr.json", () => {
    const unknown: string[] = [];
    for (const { path, text } of files) {
      for (const match of text.matchAll(/\bt\(\s*`([A-Za-z0-9_.]*)\$\{/g)) {
        const prefix = match[1]!;
        const allowed = dynamicPrefixes.some((item) => prefix.startsWith(item));
        const exists = Object.keys(flatTr).some((key) => key.startsWith(prefix));
        if (!allowed || !exists) unknown.push(`${path.split("/src/")[1]}: ${prefix}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("every status/enum value known to the helpers has a Turkish label", () => {
    const trStatus = (tr as unknown as { status: Record<string, string>; statusHint: Record<string, string> }).status;
    const trHint = (tr as unknown as { statusHint: Record<string, string> }).statusHint;
    for (const [raw, key] of Object.entries(statusAliases)) {
      expect(trStatus[key], `status.${key} (${raw})`).toBeTruthy();
      expect(trHint[key], `statusHint.${key} (${raw})`).toBeTruthy();
    }
    const enums = (tr as unknown as { enums: Record<string, Record<string, string>> }).enums;
    const enEnums = (en as unknown as { enums: Record<string, Record<string, string>> }).enums;
    for (const group of enumGroups) {
      expect(Object.keys(enums[group] ?? {}).length, `enums.${group}`).toBeGreaterThan(0);
      expect(Object.keys(enEnums[group] ?? {}).sort(), `en enums.${group}`).toEqual(Object.keys(enums[group] ?? {}).sort());
    }
    for (const value of cargoPipelineStatuses) expect(has(`cargoPipeline.status_${value}`), value).toBe(true);
    for (const value of ["mesaj", "sms", "vapi", "tamamlandi", "teslim"]) expect(has(`cargoPipeline.step_${value}`), value).toBe(true);
  });

  it("translates enums and falls back to a humanized Turkish 'unknown' label", async () => {
    const i18n = await initI18n("tr");
    const t = i18n.t.bind(i18n);
    expect(enumLabel(t, "kolaybiStatus", "contact_lookup")).toBe("Cari aranıyor");
    expect(enumLabel(t, "operation", "contact.find")).toBe("Cari arama");
    expect(enumLabel(t, "eDocumentStatus", "sent")).toBe("Gönderildi");
    expect(enumLabel(t, "jobStatus", "weird_state")).toBe("Bilinmiyor (weird state)");
    expect(enumLabel(t, "jobStatus", null)).toBe("—");
    expect(statusLabel(t, "in_transit")).toBe("Yolda");
    expect(statusLabel(t, "lost_parcel")).toBe("Bilinmiyor (lost parcel)");
    expect(statusText(t, "Şubede bekliyor")).toBe("Şubede bekliyor");
    expect(statusText(t, "teslim_edildi")).toBe("Teslim edildi");
  });
});
