import type { AuthUser } from "@garanti-kulucka/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createApiClient, defaultBackendBaseUrl, isNetworkError, type ApiClient } from "@/lib/api";
import { readTokens, writeTokens } from "@/lib/session-storage";

export type AuthStatus = "loading" | "anonymous" | "authenticated" | "offline";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  api: ApiClient;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  retry: () => void;
  updateUser: (patch: Partial<AuthUser>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, api: injectedApi }: { children: ReactNode; api?: ApiClient }) {
  const [status, setStatus] = useState<AuthStatus>(() => (readTokens() ? "loading" : "anonymous"));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [attempt, setAttempt] = useState(0);

  const api = useMemo(
    () =>
      injectedApi ??
      createApiClient({
        baseUrl: import.meta.env.VITE_BACKEND_BASE_URL || defaultBackendBaseUrl,
        getTokens: readTokens,
        setTokens: writeTokens,
        onSessionExpired: () => {
          setUser(null);
          setStatus("anonymous");
        },
      }),
    [injectedApi],
  );

  // Restore the session from the stored token (legacy panel: /auth/me on load).
  useEffect(() => {
    if (!readTokens()) {
      setStatus("anonymous");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    api
      .me()
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setStatus("authenticated");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isNetworkError(error)) {
          setStatus("offline");
          return;
        }
        writeTokens(null);
        setUser(null);
        setStatus("anonymous");
      });
    return () => {
      cancelled = true;
    };
  }, [api, attempt]);

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await api.login(email, password);
      setUser(session.user);
      setStatus("authenticated");
      return session.user;
    },
    [api],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Token is cleared locally either way.
    }
    setUser(null);
    setStatus("anonymous");
  }, [api]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const updateUser = useCallback((patch: Partial<AuthUser>) => setUser((current) => (current ? { ...current, ...patch } : current)), []);

  const value = useMemo(() => ({ status, user, api, login, logout, retry, updateUser }), [status, user, api, login, logout, retry, updateUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

export function displayName(user: Pick<AuthUser, "first_name" | "last_name" | "email"> | null) {
  if (!user) return "";
  const name = `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim();
  return name || user.email;
}

export function initialsOf(user: Pick<AuthUser, "first_name" | "last_name" | "email"> | null) {
  if (!user) return "?";
  const initials = `${user.first_name?.trim().charAt(0) ?? ""}${user.last_name?.trim().charAt(0) ?? ""}`;
  return (initials || user.email.charAt(0) || "?").toLocaleUpperCase("tr-TR");
}
