/** `/admin/users` and `/admin/logs` shapes (admin-only RBAC) used by the beta user and activity log pages. */
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
