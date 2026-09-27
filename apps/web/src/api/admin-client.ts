import type { BackendHttpClient } from "./http-client.js";

export interface AdminSetting {
  key: string;
  scope: string;
  value: unknown;
  is_secret: boolean;
  updated_at: string;
}

export interface IntegrationProvider {
  key: string;
  name: string;
  is_active: boolean;
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

export function createAdminClient(http: BackendHttpClient) {
  return {
    listSettings: (scope = "global") =>
      http.request<{ data: AdminSetting[] }>(`/admin/settings?scope=${encodeURIComponent(scope)}`),
    upsertSetting: (key: string, value: unknown, isSecret = false, scope = "global") =>
      http.request<AdminSetting>(`/admin/settings/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: {
          value,
          scope,
          is_secret: isSecret,
        },
      }),
    listIntegrationProviders: () =>
      http.request<{ data: IntegrationProvider[] }>("/admin/integrations/providers"),
    listIntegrationAccounts: () =>
      http.request<{ data: IntegrationAccount[] }>("/admin/integrations/accounts"),
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
