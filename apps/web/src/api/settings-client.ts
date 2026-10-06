import type { BackendHttpClient } from "./http-client.js";

export type ManagedRole = "admin" | "calisan" | "kargo_operatoru";

export interface ManagedUser {
  public_id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  role: string;
  is_active: boolean;
  is_online: boolean;
  last_seen_at: string | null;
  sip_username: string | null;
  sip_password_configured: boolean;
  created_at: string;
}

export interface CreateManagedUserInput {
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  password: string;
  role: ManagedRole;
}

export interface UpdateManagedUserInput {
  first_name?: string;
  last_name?: string;
  phone?: string | null;
  role?: ManagedRole;
  is_active?: boolean;
  password?: string;
  sip_username?: string | null;
  sip_password?: string | null;
}

export interface AdminLogEntry {
  id: number;
  actor_name: string | null;
  action: string;
  module: string;
  entity_id: string | null;
  created_at: string;
}

export interface NetgsmBalance {
  provider: "netgsm";
  operation: "account.balance";
  balance: number | null;
  currency: string;
  sms_credit: number | null;
  status: "dry_run" | "live";
  live_call_permitted: boolean;
  live_gate: string;
  block_reason: string | null;
  checked_at: string;
}

function userPath(publicId: string) {
  return `/admin/users/${encodeURIComponent(publicId)}`;
}

export function createSettingsClient(http: BackendHttpClient) {
  return {
    listUsers: () => http.request<{ data: ManagedUser[]; roles: ManagedRole[] }>("/admin/users"),
    createUser: (input: CreateManagedUserInput) =>
      http.request<{ user: ManagedUser }>("/admin/users", { method: "POST", body: input }),
    updateUser: (publicId: string, input: UpdateManagedUserInput) =>
      http.request<{ user: ManagedUser }>(userPath(publicId), { method: "PATCH", body: input }),
    deactivateUser: (publicId: string) =>
      http.request<{ user: ManagedUser; deactivated: boolean }>(userPath(publicId), { method: "DELETE" }),
    listLogs: (limit = 100) => http.request<{ data: AdminLogEntry[] }>(`/admin/logs?limit=${limit}`),
    getNetgsmBalance: () => http.request<NetgsmBalance>("/admin/integrations/netgsm/balance"),
    updateProfile: (input: { first_name: string; last_name: string }) =>
      http.request<{ first_name: string; last_name: string }>("/auth/account/profile", { method: "PATCH", body: input }),
    changePassword: (password: string, passwordConfirmation: string) =>
      http.request<{ updated: boolean }>("/auth/account/password", {
        method: "POST",
        body: { password, password_confirmation: passwordConfirmation },
      }),
    getAiStatus: () => http.request<{ ai_enabled: boolean }>("/api/app-settings/ai-status"),
  };
}

export type SettingsClient = ReturnType<typeof createSettingsClient>;
