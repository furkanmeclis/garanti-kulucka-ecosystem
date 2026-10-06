/**
 * Browser-facing HTTP contract types for panel clients (mirrors contracts/openapi/backend-api.json).
 * Type-only additions; nothing here changes runtime behavior of existing consumers.
 */

export type BackendUserRole = "owner" | "admin" | "calisan" | "kargo_operatoru";

/** Panel role groups: owner and admin share the manager experience. */
export type PanelRole = "manager" | "calisan" | "kargo_operatoru";

export function panelRoleOf(role: string | null | undefined): PanelRole | null {
  if (role === "owner" || role === "admin") return "manager";
  if (role === "calisan") return "calisan";
  if (role === "kargo_operatoru") return "kargo_operatoru";
  return null;
}

export interface AuthUser {
  public_id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  role: BackendUserRole | (string & {});
  permissions: string[];
  sip_username?: string | null;
  is_online?: boolean;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface AuthSession extends TokenPair {
  user: AuthUser;
}

export interface ListMeta {
  total_count: number;
  limit: number;
  offset: number;
}

export interface ListEnvelope<T> {
  data: T[];
  meta?: ListMeta;
}

export interface OrderSummary {
  public_id: string;
  order_number: string;
  status: string;
  source: string;
  cargo_provider?: string | null;
  total_amount: string;
  currency: string;
  confirmation_status?: string | null;
  notes?: string | null;
  customer_full_name?: string | null;
  created_by_user_public_id?: string | null;
  created_by_user_email?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface OrderSummaryStats {
  total_count: number;
  active_count: number;
  delivered_count: number;
  pending_confirmation_count: number;
  total_revenue: number;
  currency: string;
}

export interface ConversationCustomerRef {
  public_id?: string;
  full_name?: string | null;
  phone?: string | null;
  username?: string | null;
}

export interface ConversationSummary {
  public_id: string;
  channel: string;
  status: string;
  is_in_pool: boolean;
  human_agent_enabled: boolean;
  unread_count: number;
  last_message_text?: string | null;
  last_message_sender_type?: string | null;
  last_message_at?: string | null;
  customer?: ConversationCustomerRef | null;
  assigned_user_email?: string | null;
  notes?: string | null;
  updated_at: string;
}

export interface ConversationSummaryStats {
  total_count: number;
  unread_count: number;
  pool_count: number;
  human_agent_count: number;
  channel_counts: Record<string, number>;
  status_counts: Record<string, number>;
}

export interface CustomerSummary {
  public_id: string;
  full_name: string;
  phone?: string | null;
  email?: string | null;
  username?: string | null;
  notes?: string | null;
  updated_at: string;
}

export interface CustomerSummaryStats {
  total_count: number;
  with_phone_count: number;
  with_email_count: number;
  with_notes_count: number;
}

export interface ShipmentSummary {
  public_id: string;
  provider: string;
  tracking_number?: string | null;
  barcode_number?: string | null;
  status: string;
  recipient_name?: string | null;
  recipient_phone?: string | null;
  recipient_city?: string | null;
  recipient_district?: string | null;
  last_event_text?: string | null;
  order_number?: string | null;
  customer_full_name?: string | null;
  updated_at?: string;
}

export interface ShipmentSummaryStats {
  total_count: number;
  active_count: number;
  delivered_count: number;
  recipient_phone_count: number;
  provider_counts: Record<string, number>;
  exception_counts: Record<string, number>;
}

export interface BackendErrorBody {
  error?: { code?: string; message?: string };
}
