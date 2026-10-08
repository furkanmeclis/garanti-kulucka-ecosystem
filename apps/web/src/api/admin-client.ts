import type { BackendHttpClient } from "./http-client.js";

export interface AdminSetting {
  key: string;
  scope: string;
  value: unknown;
  is_secret: boolean;
  updated_at: string;
}

export interface AdminSettingVersion {
  public_id: string;
  key: string;
  scope: string;
  version: number;
  value: unknown;
  is_secret: boolean;
  created_by_user_id: number | null;
  created_at: string;
}

export interface AdminAuditLog {
  id: number;
  actor_user_id: number | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_value: unknown;
  new_value: unknown;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AdminAuditSummary {
  total_count: number;
}

export interface IntegrationProvider {
  key: string;
  name: string;
  is_active: boolean;
}

export interface ProviderCatalogItem {
  provider: string;
  channels: string[];
  supported_operations: string[];
  contract_mode: "fixture_only";
  live_feature_flag_key: string;
  live_call_permitted: false;
  live_block_reason: "fixture_replay_contract_required";
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

export interface InstagramAnalyticsSummary {
  followers: number;
  reach: number;
  impressions: number;
  profile_views: number;
  engagement_rate: number;
}

export interface ProviderAttempt {
  public_id: string;
  provider_key: string;
  account_public_id: string | null;
  request_id: string;
  operation: string;
  direction: string;
  status: string;
  status_code: number | null;
  duration_ms: number;
  retry_decision: string;
  next_retry_at: string | null;
  idempotency_key: string | null;
  request_metadata: unknown;
  provider_request_preview: unknown | null;
  response_metadata: unknown;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  updated_at: string;
}

export interface ProviderRequestPreview {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  live_call_performed: false;
}

export interface ProviderAttemptViewModel extends Omit<ProviderAttempt, "provider_request_preview"> {
  provider_request_preview: ProviderRequestPreview | null;
}

export interface ProviderDebugProviderSummary {
  provider_key: string;
  total_attempts: number;
  success_count: number;
  failure_count: number;
  retry_count: number;
  average_duration_ms: number;
  latest_attempt: ProviderAttempt | null;
}

export interface ProviderDebugCronSummary {
  provider_keys: Array<"ptt" | "surat">;
  operation: "shipment.track";
  total_attempts: number;
  success_count: number;
  failure_count: number;
  retry_count: number;
  total_duration_ms: number;
  latest_attempt: ProviderAttempt | null;
}

export interface ProviderDebugSummary {
  providers: ProviderDebugProviderSummary[];
  cron: ProviderDebugCronSummary;
}

export interface AuditListOptions {
  entity_id?: string;
  limit?: number;
}

export interface ProviderAttemptListOptions {
  provider_key?: string;
  account_public_id?: string;
  limit?: number;
}

function auditQuery(options: AuditListOptions = {}) {
  const params = new URLSearchParams();
  if (options.entity_id) {
    params.set("entity_id", options.entity_id);
  }
  if (typeof options.limit === "number") {
    params.set("limit", String(options.limit));
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

function providerAttemptDeleteQuery(providerKey: string, operation?: string) {
  const params = new URLSearchParams();
  params.set("provider_key", providerKey);
  if (operation) {
    params.set("operation", operation);
  }
  return `?${params.toString()}`;
}

function providerAttemptQuery(options: ProviderAttemptListOptions = {}) {
  const params = new URLSearchParams();
  if (options.provider_key) {
    params.set("provider_key", options.provider_key);
  }
  if (options.account_public_id) {
    params.set("account_public_id", options.account_public_id);
  }
  if (typeof options.limit === "number") {
    params.set("limit", String(options.limit));
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

export interface ProviderAttemptsDeleted {
  provider_key: string;
  operation: string | null;
  deleted: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePreviewHeaders(value: unknown) {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

export function normalizeProviderRequestPreview(value: unknown): ProviderRequestPreview | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.method !== "string" ||
    typeof value.path !== "string" ||
    value.live_call_performed !== false
  ) {
    return null;
  }

  return {
    method: value.method,
    path: value.path,
    headers: normalizePreviewHeaders(value.headers),
    body: value.body ?? null,
    live_call_performed: false,
  };
}

export function toProviderAttemptViewModel(attempt: ProviderAttempt): ProviderAttemptViewModel {
  return {
    ...attempt,
    provider_request_preview: normalizeProviderRequestPreview(attempt.provider_request_preview),
  };
}

export function createAdminClient(http: BackendHttpClient) {
  return {
    listSettings: (scope = "global") =>
      http.request<{ data: AdminSetting[] }>(`/admin/settings?scope=${encodeURIComponent(scope)}`),
    listSettingsAudit: (options?: AuditListOptions) =>
      http.request<{ data: AdminAuditLog[]; summary: AdminAuditSummary }>(
        `/admin/settings/audit${auditQuery(options)}`,
      ),
    upsertSetting: (key: string, value: unknown, isSecret = false, scope = "global") =>
      http.request<AdminSetting>(`/admin/settings/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: {
          value,
          scope,
          is_secret: isSecret,
        },
      }),
    listSettingVersions: (key: string, scope = "global") =>
      http.request<{ data: AdminSettingVersion[] }>(
        `/admin/settings/${encodeURIComponent(key)}/versions?scope=${encodeURIComponent(scope)}`,
      ),
    rollbackSetting: (key: string, version: number, scope = "global") =>
      http.request<AdminSetting>(`/admin/settings/${encodeURIComponent(key)}/rollback`, {
        method: "POST",
        body: {
          version,
          scope,
        },
      }),
    listIntegrationProviders: () =>
      http.request<{ data: IntegrationProvider[] }>("/admin/integrations/providers"),
    listProviderCatalog: () =>
      http.request<{ data: ProviderCatalogItem[] }>("/admin/integrations/provider-catalog"),
    listIntegrationAccounts: () =>
      http.request<{ data: IntegrationAccount[] }>("/admin/integrations/accounts"),
    listIntegrationAudit: (options?: AuditListOptions) =>
      http.request<{ data: AdminAuditLog[]; summary: AdminAuditSummary }>(
        `/admin/integrations/audit${auditQuery(options)}`,
      ),
    listProviderAttempts: (options?: ProviderAttemptListOptions) =>
      http.request<{ data: ProviderAttempt[] }>(
        `/admin/integrations/provider-attempts${providerAttemptQuery(options)}`,
      ),
    getProviderDebugSummary: () =>
      http.request<ProviderDebugSummary>("/admin/integrations/provider-debug-summary"),
    /** Legacy cron-debug "Temizle": clears persisted attempts for a provider (optionally one operation) server side. */
    deleteProviderAttempts: (providerKey: string, operation?: string) =>
      http.request<ProviderAttemptsDeleted>(
        `/admin/integrations/provider-attempts${providerAttemptDeleteQuery(providerKey, operation)}`,
        { method: "DELETE" },
      ),
    triggerProviderCronDebug: (providerKey: "ptt" | "surat", input: { idempotency_key: string }) =>
      http.request<ProviderAttempt>(
        `/admin/integrations/provider-cron-triggers/${encodeURIComponent(providerKey)}`,
        {
          method: "POST",
          body: input,
        },
      ),
    createInstagramPublishPreview: (input: {
      account_public_id?: string | null;
      image_url: string;
      caption: string;
      idempotency_key: string;
    }) =>
      http.request<ProviderAttempt>("/admin/integrations/instagram-publish-previews", {
        method: "POST",
        body: {
          account_public_id: input.account_public_id ?? null,
          image_url: input.image_url,
          caption: input.caption,
          idempotency_key: input.idempotency_key,
        },
      }),
    queueWebhookSubscription: (accountPublicId: string, input: { action: "subscribe" | "unsubscribe"; idempotency_key: string }) =>
      http.request<MetaPageJobQueued>(`/admin/integrations/accounts/${encodeURIComponent(accountPublicId)}/webhook-subscription`, {
        method: "POST",
        body: input,
      }),
    queueThreadControl: (
      accountPublicId: string,
      input: { action: "owner" | "take" | "release"; recipient_id: string; metadata?: string; idempotency_key: string },
    ) =>
      http.request<MetaPageJobQueued>(`/admin/integrations/accounts/${encodeURIComponent(accountPublicId)}/thread-control`, {
        method: "POST",
        body: input,
      }),
    disconnectIntegrationAccount: (accountPublicId: string, input: { idempotency_key: string }) =>
      http.request<IntegrationAccountDisconnected>(`/admin/integrations/accounts/${encodeURIComponent(accountPublicId)}/disconnect`, {
        method: "POST",
        body: input,
      }),
    getIntegrationAccount: (accountPublicId: string) =>
      http.request<IntegrationAccountSnapshot>(
        `/admin/integrations/accounts/${encodeURIComponent(accountPublicId)}`,
      ),
    getInstagramAnalyticsSummary: (accountPublicId: string) =>
      http.request<InstagramAnalyticsSummary>(
        `/admin/integrations/accounts/${encodeURIComponent(accountPublicId)}/analytics-summary`,
      ),
    upsertIntegrationAccount: (input: {
      provider_key: string;
      display_name: string;
      external_account_id?: string | null;
      metadata?: Record<string, unknown>;
    }) =>
      http.request<IntegrationAccount>("/admin/integrations/accounts", {
        method: "POST",
        body: {
          provider_key: input.provider_key,
          display_name: input.display_name,
          external_account_id: input.external_account_id ?? null,
          metadata: input.metadata ?? {},
        },
      }),
    upsertIntegrationSetting: (accountPublicId: string, key: string, value: unknown, isSecret = false) =>
      http.request<IntegrationSetting>(
        `/admin/integrations/accounts/${encodeURIComponent(accountPublicId)}/settings/${encodeURIComponent(key)}`,
        {
          method: "PUT",
          body: {
            value,
            is_secret: isSecret,
          },
        },
      ),
    upsertIntegrationToken: (accountPublicId: string, tokenType: string, value: unknown, expiresAt: string | null = null) =>
      http.request<{ public_id: string; token_type: string; value: null }>(
        `/admin/integrations/accounts/${encodeURIComponent(accountPublicId)}/tokens/${encodeURIComponent(tokenType)}`,
        {
          method: "PUT",
          body: {
            value,
            expires_at: expiresAt,
          },
        },
      ),
  };
}
