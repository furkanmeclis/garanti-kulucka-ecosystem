import { describe, expect, it } from "vitest";
import en from "../src/i18n/locales/en.json";
import tr from "../src/i18n/locales/tr.json";
import { defaultLanguage, initI18n, isLanguage, languageStorageKey, localeFor, readStoredLanguage, storeLanguage } from "../src/i18n";

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
