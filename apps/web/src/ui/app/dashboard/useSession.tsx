import { useEffect, useState, type FormEvent } from "react";
import { type LoginResponse } from "../../../api/auth-client.js";
import { tokenStorageKey, navigationRole, readStoredToken } from "../shared.js";
import { uiMessage } from "../../i18n/messages/status.js";
import type { DashboardCore } from "./types.js";

/** Auth session: stored token, current user, session restore, login and presence toggle. */
export function useSession(auth: DashboardCore["auth"], setStatus: DashboardCore["setStatus"]) {
  const [token, setToken] = useState<string | null>(() => readStoredToken());
  const [user, setUser] = useState<LoginResponse["user"] | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [presenceUpdating, setPresenceUpdating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      if (!token) {
        setAuthChecked(true);
        return;
      }

      try {
        const currentUser = await auth.me();
        if (!cancelled) {
          setUser(currentUser);
          setAuthChecked(true);
        }
      } catch {
        window.localStorage.removeItem(tokenStorageKey);
        if (!cancelled) {
          setToken(null);
          setUser(null);
          setAuthChecked(true);
        }
      }
    }

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, [auth, token]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setStatus(uiMessage("signingIn"));
    const response = await auth.login(email, password);
    window.localStorage.setItem(tokenStorageKey, response.access_token);
    setToken(response.access_token);
    setUser(response.user);
    setStatus(uiMessage("signedIn"));
  }

  async function handleTogglePresence() {
    if (!user || user.role === "admin") return;

    const nextPresence = !user.is_online;
    setPresenceUpdating(true);
    setStatus(uiMessage(nextPresence ? "presenceGoingOnline" : "presenceGoingOffline"));
    try {
      const updatedUser = await auth.setPresence(nextPresence);
      setUser(updatedUser);
      setStatus(uiMessage(updatedUser.is_online ? "presenceOnlineUpdated" : "presenceOfflineUpdated"));
    } finally {
      setPresenceUpdating(false);
    }
  }

  const canTogglePresence = Boolean(user && navigationRole(user.role) !== "admin");

  return {
    token,
    setToken,
    user,
    setUser,
    authChecked,
    setAuthChecked,
    presenceUpdating,
    setPresenceUpdating,
    handleLogin,
    handleTogglePresence,
    canTogglePresence,
  };
}
