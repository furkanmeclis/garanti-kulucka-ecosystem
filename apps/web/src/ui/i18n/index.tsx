import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Dictionary-based TR/EN i18n (legacy `frontend/src/i18n` + `garanti-lang`). Each screen owns a message
 * namespace defined with `defineMessages`; Turkish is the source language and the default.
 */
export type UiLanguage = "tr" | "en";

export const uiLanguages = ["tr", "en"] as const satisfies readonly UiLanguage[];

/** Legacy `garanti-lang` key (frontend/src/i18n) so a returning user keeps the same choice. */
export const languageStorageKey = "garanti-lang";

export type MessageParams = Record<string, string | number>;

export interface MessageNamespace<K extends string = string> {
  readonly tr: Readonly<Record<K, string>>;
  readonly en: Readonly<Record<K, string>>;
}

/** Declares a namespace; `en` must define exactly the keys of `tr` (enforced by the type checker). */
export function defineMessages<const T extends Record<string, string>>(messages: {
  tr: T;
  en: { [K in keyof T]: string };
}): MessageNamespace<Extract<keyof T, string>> {
  return messages as MessageNamespace<Extract<keyof T, string>>;
}

/** Replaces `{name}` placeholders; unknown placeholders are left as-is so missing params are visible. */
export function formatMessage(template: string, params?: MessageParams) {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

export function translate<K extends string>(namespace: MessageNamespace<K>, language: UiLanguage, key: K, params?: MessageParams) {
  return formatMessage(namespace[language][key] ?? namespace.tr[key] ?? key, params);
}

/** `Intl` locale for dates, numbers and money. */
export function localeFor(language: UiLanguage) {
  return language === "en" ? "en-GB" : "tr-TR";
}

export function readStoredLanguage(): UiLanguage {
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

interface LanguageContextValue {
  language: UiLanguage;
  setLanguage: (language: UiLanguage) => void;
}

const LanguageContext = createContext<LanguageContextValue>({ language: "tr", setLanguage: () => undefined });

export function LanguageProvider(props: { children: ReactNode; initialLanguage?: UiLanguage }) {
  const [language, setLanguageState] = useState<UiLanguage>(() => props.initialLanguage ?? readStoredLanguage());
  const setLanguage = useCallback((next: UiLanguage) => {
    setLanguageState(next);
    storeLanguage(next);
  }, []);
  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);
  return <LanguageContext.Provider value={value}>{props.children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}

export type Translator<K extends string> = (key: K, params?: MessageParams) => string;

/** `const t = useT(ordersMessages); t("title"); t("count", { count: 3 })`. */
export function useT<K extends string>(namespace: MessageNamespace<K>): Translator<K> {
  const { language } = useLanguage();
  return useCallback((key: K, params?: MessageParams) => translate(namespace, language, key, params), [namespace, language]);
}
