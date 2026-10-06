import type { TokenPair } from "@garanti-kulucka/shared";

/** Beta panel keeps its own session key so it never collides with the legacy panel's token. */
export const sessionStorageKey = "garanti-beta.session";

export type StoredTokens = Pick<TokenPair, "access_token" | "refresh_token">;

export function readTokens(storage: Pick<Storage, "getItem"> | undefined = safeLocalStorage()): StoredTokens | null {
  try {
    const raw = storage?.getItem(sessionStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTokens>;
    return typeof parsed.access_token === "string" && typeof parsed.refresh_token === "string"
      ? { access_token: parsed.access_token, refresh_token: parsed.refresh_token }
      : null;
  } catch {
    return null;
  }
}

export function writeTokens(tokens: StoredTokens | null, storage: Pick<Storage, "setItem" | "removeItem"> | undefined = safeLocalStorage()) {
  try {
    if (tokens) storage?.setItem(sessionStorageKey, JSON.stringify(tokens));
    else storage?.removeItem(sessionStorageKey);
  } catch {
    // Storage may be unavailable (private mode); the session then lasts for this page only.
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
