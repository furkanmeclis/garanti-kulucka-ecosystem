/**
 * Shapes of the manager-only settings endpoints the beta "Ayarlar" tabs use:
 * `/admin/settings` (zod registry, secrets come back as `value: null`), `/admin/integrations/accounts/*`
 * (provider accounts; tokens never echo their value) and the NetGSM dry-run balance boundary.
 */

export interface AdminSetting {
  key: string;
  scope: string;
  value: unknown;
  is_secret: boolean;
  updated_at: string;
}

export interface IntegrationAccount {
  public_id: string;
  provider_key: string;
  provider_name: string;
  display_name: string;
  external_account_id: string | null;
  status: string;
  metadata: unknown;
  updated_at: string;
}

export interface IntegrationSetting {
  public_id: string;
  key: string;
  value: unknown;
  is_secret: boolean;
  updated_at: string;
}

export interface IntegrationToken {
  public_id: string;
  token_type: string;
  value: null;
  expires_at: string | null;
  last_refreshed_at: string | null;
  updated_at: string;
}

export interface IntegrationAccountSnapshot {
  account: IntegrationAccount;
  settings: IntegrationSetting[];
  tokens: IntegrationToken[];
}

export interface MetaPageJobQueued {
  queued: boolean;
  job_id: string | null;
  request_id: string;
  account_public_id: string;
  provider_key: string;
  operation: string;
  live_gate: string;
}

export interface IntegrationAccountDisconnected {
  account: IntegrationAccount;
  removed_tokens: number;
  unsubscribe_job_id: string | null;
}

export interface UpsertIntegrationAccountInput {
  provider_key: string;
  display_name: string;
  external_account_id: string | null;
  metadata?: Record<string, unknown>;
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

export type MessagingProvider = "whatsapp" | "instagram" | "messenger" | "netgsm";

export interface SipConfig {
  ws_url: string;
  domain: string;
  stun: string;
}

export const defaultSipConfig: SipConfig = { ws_url: "", domain: "", stun: "stun:stun.l.google.com:19302" };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Plain (non-secret) string value of an integration setting; secrets are never read back. */
export function plainIntegrationSetting(snapshot: IntegrationAccountSnapshot | null | undefined, key: string) {
  const setting = snapshot?.settings.find((item) => item.key === key);
  return setting && !setting.is_secret && typeof setting.value === "string" ? setting.value : "";
}

export function integrationSettingExists(snapshot: IntegrationAccountSnapshot | null | undefined, key: string) {
  return Boolean(snapshot?.settings.some((item) => item.key === key));
}

export function integrationTokenExists(snapshot: IntegrationAccountSnapshot | null | undefined, tokenType: string) {
  return Boolean(snapshot?.tokens.some((token) => token.token_type === tokenType));
}

export function integrationLiveMode(snapshot: IntegrationAccountSnapshot | null | undefined) {
  const value = snapshot?.settings.find((item) => item.key === "live_mode")?.value;
  return value === true || value === "true";
}

export function sipConfigFrom(value: unknown): SipConfig {
  if (!isRecord(value)) return defaultSipConfig;
  return {
    ws_url: typeof value.ws_url === "string" ? value.ws_url : defaultSipConfig.ws_url,
    domain: typeof value.domain === "string" ? value.domain : defaultSipConfig.domain,
    stun: typeof value.stun === "string" ? value.stun : defaultSipConfig.stun,
  };
}
