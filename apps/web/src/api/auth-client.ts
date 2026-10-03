import type { BackendHttpClient } from "./http-client.js";

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  user: {
    public_id: string;
    email: string;
    first_name: string;
    last_name: string;
    role: string;
    permissions: string[];
    is_online: boolean;
    sip_username?: string | null;
  };
}

export interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
}

export function createAuthClient(http: BackendHttpClient) {
  return {
    login: (email: string, password: string) =>
      http.request<LoginResponse>("/auth/login", {
        method: "POST",
        body: { email, password },
      }),
    refresh: (refreshToken: string) =>
      http.request<RefreshResponse>("/auth/refresh", {
        method: "POST",
        body: { refresh_token: refreshToken },
      }),
    logout: () =>
      http.request<{ status: "ok" }>("/auth/logout", {
        method: "POST",
      }),
    setPresence: (online: boolean) =>
      http.request<LoginResponse["user"]>("/auth/presence", {
        method: "PATCH",
        body: { online },
      }),
    me: () => http.request<LoginResponse["user"]>("/auth/me"),
  };
}
