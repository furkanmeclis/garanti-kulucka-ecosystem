import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import tr from "./locales/tr.json";

export const supportedLanguages = ["tr", "en"] as const;
export type Language = (typeof supportedLanguages)[number];
export const defaultLanguage: Language = "tr";
/** Separate from the legacy panel's `garanti-lang` so the two apps can be used side by side. */
export const languageStorageKey = "garanti-beta-lang";

export const resources = { tr: { translation: tr }, en: { translation: en } } as const;

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (supportedLanguages as readonly string[]).includes(value);
}

export function readStoredLanguage(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): Language {
  try {
    const stored = storage?.getItem(languageStorageKey);
    return isLanguage(stored) ? stored : defaultLanguage;
  } catch {
    return defaultLanguage;
  }
}

export function storeLanguage(language: Language, storage: Pick<Storage, "setItem"> | undefined = safeStorage()) {
  try {
    storage?.setItem(languageStorageKey, language);
  } catch {
    // Private mode: the choice lasts for this session only.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** Locale for Intl formatting (dates, numbers, money). */
export function localeFor(language: string) {
  return language === "en" ? "en-GB" : "tr-TR";
}

export function setDocumentLanguage(language: Language) {
  if (typeof document !== "undefined") document.documentElement.lang = language;
}

export async function initI18n(language: Language = readStoredLanguage()) {
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources,
      lng: language,
      fallbackLng: defaultLanguage,
      supportedLngs: [...supportedLanguages],
      interpolation: { escapeValue: false },
      returnNull: false,
      // Development only: report keys that have no translation so raw keys never ship unnoticed.
      saveMissing: import.meta.env?.DEV === true,
      missingKeyHandler: (languages, _namespace, key) => {
        console.warn(`[i18n] missing key "${key}" for ${languages.join(", ")}`);
      },
    });
    i18n.on("languageChanged", (next) => {
      if (isLanguage(next)) {
        storeLanguage(next);
        setDocumentLanguage(next);
      }
    });
  }
  setDocumentLanguage(language);
  return i18n;
}

export { i18n };
