import { Settings } from "lucide-react";
import { instagramDraftImageUrl, instagramDraftCaption, instagramCaptionLimit, compactJson, FlowPanel, DetailPanel, DataRows } from "../../app/shared.js";
import type { DashboardController } from "../../app/useDashboardController.js";
import { useT } from "../../i18n/index.js";
import { integrationsMessages } from "../../i18n/messages/integrations.js";

export function IntegrationsFlow({ ctx }: { ctx: DashboardController }) {
  const {
    activeSettings,
    data,
    handleCreateInstagramPublishPreview,
    handleOpenIntegrationAccount,
    handleSaveIntegrationSetting,
    handleSaveIntegrationToken,
    handleSaveOperationalPolicy,
    handleSaveProviderLiveGate,
    handleUpsertIntegrationAccount,
    instagramAnalytics,
    instagramPublishPreviewing,
    integrationSnapshot,
    lastInstagramPublishPreview,
    latestIntegrationAudit,
    latestSettingsAudit,
    operationalPolicy,
    providerAttemptTotal,
    selectedProviderAttempt,
    selectedProviderCatalogItem,
    selectedProviderPreview,
  } = ctx;
  const t = useT(integrationsMessages);

  return (
    <FlowPanel title={t("title")} icon={<Settings size={18} />} testId="integrations-flow">
            <div className="system-settings" data-testid="system-settings">
              <button className="primary-action" type="button" onClick={handleSaveProviderLiveGate}>
                {t("savePttLiveGateClosed")}
              </button>
              <button className="secondary-action" type="button" onClick={handleSaveOperationalPolicy}>
                {t("saveOperationalPolicy")}
              </button>
              <DataRows rows={activeSettings.map((setting) => [setting.key, setting.scope, JSON.stringify(setting.value)])} />
              <DetailPanel title={t("policiesTitle")} testId="operation-policy-detail">
                <DataRows
                  rows={[
                    ["Retry", t("attempts", { count: operationalPolicy.max_attempts }), t("waitMs", { ms: operationalPolicy.retry_delay_ms })],
                    [
                      "Timeout",
                      `${operationalPolicy.request_timeout_ms} ms provider`,
                      `${operationalPolicy.webhook_timeout_ms} ms webhook`,
                    ],
                    [
                      "Rate Limit",
                      t("perMinute", { count: operationalPolicy.provider_rate_limit_per_minute }),
                      `queue concurrency ${operationalPolicy.queue_concurrency}`,
                    ],
                    [
                      "Storage",
                      operationalPolicy.storage_bucket,
                      t("lifecycleDays", {
                        days: operationalPolicy.lifecycle_days,
                        state: operationalPolicy.orphan_cleanup_enabled ? t("enabled") : t("disabled"),
                      }),
                    ],
                  ]}
                />
              </DetailPanel>
              <DetailPanel title={t("settingsAuditTitle")} testId="settings-audit-detail">
                <DataRows
                  rows={[
                    [t("record"), String(data.settingsAuditSummary.total_count), "settings audit summary"],
                    [
                      t("lastAction"),
                      latestSettingsAudit ? `${latestSettingsAudit.action} / ${latestSettingsAudit.entity_type}` : t("noAudit"),
                      latestSettingsAudit?.entity_id ?? "-",
                    ],
                    [
                      t("actor"),
                      latestSettingsAudit?.actor_user_id === null || latestSettingsAudit?.actor_user_id === undefined
                        ? t("system")
                        : String(latestSettingsAudit.actor_user_id),
                      latestSettingsAudit?.created_at ?? "-",
                    ],
                    [t("oldValue"), compactJson(latestSettingsAudit?.old_value), "redacted"],
                    [t("newValue"), compactJson(latestSettingsAudit?.new_value), "redacted"],
                  ]}
                />
              </DetailPanel>
            </div>
            <button className="primary-action" type="button" onClick={handleUpsertIntegrationAccount}>
              {t("saveInstagramAccount")}
            </button>
            <DataRows rows={data.integrationAccounts.map((account) => [account.provider_name, account.display_name, account.status])} />
            <DetailPanel title={t("providerLiveLimitsTitle")} testId="provider-catalog-detail">
              <DataRows
                rows={[
                  [t("catalog"), String(data.providerCatalog.length), "backend provider catalog"],
                  [
                    t("firstProvider"),
                    selectedProviderCatalogItem?.provider ?? "-",
                    selectedProviderCatalogItem?.contract_mode ?? "-",
                  ],
                  [
                    t("liveCall"),
                    selectedProviderCatalogItem?.live_call_permitted === false ? t("disabled") : "-",
                    selectedProviderCatalogItem?.live_feature_flag_key ?? "-",
                  ],
                  [
                    t("blockReason"),
                    selectedProviderCatalogItem?.live_block_reason ?? "-",
                    selectedProviderCatalogItem?.supported_operations.join(", ") ?? "-",
                  ],
                  [t("channels"), data.providerCatalog.map((item) => item.channels.join("+")).join(" / "), t("adapterLimits")],
                  [t("providers"), data.providerCatalog.map((item) => item.provider).join(", "), t("liveHttpDisabled")],
                ]}
              />
            </DetailPanel>
            <DetailPanel title={t("instagramPreviewTitle")} testId="instagram-publish-preview">
              <DataRows
                rows={[
                  [t("photoUrl"), instagramDraftImageUrl, "Graph publish"],
                  ["Caption", instagramDraftCaption, t("characterCount", { length: instagramDraftCaption.length, limit: instagramCaptionLimit })],
                  [t("previewAccount"), integrationSnapshot?.account.display_name ?? "garantikulucka", "Instagram"],
                  [t("publishMode"), t("draft"), t("liveProviderDisabled")],
                  [t("lastBackendRequest"), lastInstagramPublishPreview ?? "-", "provider attempt dry-run"],
                ]}
              />
              <button
                className="primary-action"
                type="button"
                disabled={instagramPublishPreviewing}
                onClick={() => void handleCreateInstagramPublishPreview()}
              >
                {instagramPublishPreviewing ? t("publishDryRunPreparing") : t("publishDryRunPrepare")}
              </button>
            </DetailPanel>
            <DetailPanel title={t("instagramAnalyticsTitle")} testId="instagram-analytics-summary">
              <DataRows
                rows={[
                  [t("followers"), String(instagramAnalytics.followers), "backend snapshot"],
                  [t("reach"), String(instagramAnalytics.reach), t("legacyAnalytics")],
                  [t("impressions"), String(instagramAnalytics.impressions), t("legacyAnalytics")],
                  [t("profileViews"), String(instagramAnalytics.profileViews), t("engagement", { rate: instagramAnalytics.engagementRate })],
                ]}
              />
            </DetailPanel>
            <DetailPanel title={t("providerAttemptsTitle")} testId="provider-attempts-detail">
              <DataRows
                rows={[
                  [t("record"), String(providerAttemptTotal), "provider debug summary API"],
                  [
                    t("lastAttempt"),
                    selectedProviderAttempt
                      ? `${selectedProviderAttempt.provider_key} / ${selectedProviderAttempt.operation}`
                      : t("noAttempt"),
                    selectedProviderAttempt?.status ?? "-",
                  ],
                  [
                    "HTTP",
                    selectedProviderAttempt?.status_code === null || selectedProviderAttempt?.status_code === undefined
                      ? "-"
                      : String(selectedProviderAttempt.status_code),
                    selectedProviderAttempt ? `${selectedProviderAttempt.duration_ms} ms` : "-",
                  ],
                  [
                    "Retry",
                    selectedProviderAttempt?.retry_decision ?? "-",
                    selectedProviderAttempt?.next_retry_at ?? t("noRetry"),
                  ],
                  [
                    t("request"),
                    selectedProviderAttempt?.request_id ?? "-",
                    selectedProviderAttempt?.idempotency_key ?? t("noIdempotency"),
                  ],
                  [
                    t("preview"),
                    selectedProviderPreview
                      ? `${selectedProviderPreview.method} ${selectedProviderPreview.path}`
                      : t("noDryRunPreview"),
                    selectedProviderPreview?.live_call_performed === false ? t("noLiveCall") : "-",
                  ],
                  [
                    "Header",
                    compactJson(selectedProviderPreview?.headers),
                    "redacted",
                  ],
                  [
                    "Body",
                    compactJson(selectedProviderPreview?.body),
                    "redacted",
                  ],
                ]}
              />
            </DetailPanel>
            <DetailPanel title={t("integrationAuditTitle")} testId="integration-audit-detail">
              <DataRows
                rows={[
                  [t("record"), String(data.integrationAuditSummary.total_count), "integration audit summary"],
                  [
                    t("lastAction"),
                    latestIntegrationAudit
                      ? `${latestIntegrationAudit.action} / ${latestIntegrationAudit.entity_type}`
                      : t("noAudit"),
                    latestIntegrationAudit?.entity_id ?? "-",
                  ],
                  [
                    t("actor"),
                    latestIntegrationAudit?.actor_user_id === null || latestIntegrationAudit?.actor_user_id === undefined
                      ? t("system")
                      : String(latestIntegrationAudit.actor_user_id),
                    latestIntegrationAudit?.created_at ?? "-",
                  ],
                  [t("oldValue"), compactJson(latestIntegrationAudit?.old_value), "redacted"],
                  [t("newValue"), compactJson(latestIntegrationAudit?.new_value), "redacted"],
                ]}
              />
            </DetailPanel>
            <div className="integration-actions">
              {data.integrationAccounts.map((account) => (
                <button
                  className="secondary-action"
                  key={account.public_id}
                  type="button"
                  onClick={() => handleOpenIntegrationAccount(account.public_id)}
                >
                  {t("accountDetail", { name: account.display_name })}
                </button>
              ))}
              <button className="secondary-action" type="button" onClick={handleSaveIntegrationToken}>
                {t("saveAccessToken")}
              </button>
              <button className="secondary-action" type="button" onClick={handleSaveIntegrationSetting}>
                {t("saveWebhookSetting")}
              </button>
            </div>
            {integrationSnapshot && (
              <div className="integration-detail" data-testid="integration-detail">
                <div>
                  <h2>{integrationSnapshot.account.display_name}</h2>
                  <p>{integrationSnapshot.account.external_account_id ?? t("noExternalAccount")}</p>
                </div>
                <DataRows
                  rows={[
                    ["Provider", integrationSnapshot.account.provider_name, integrationSnapshot.account.status],
                    [t("setting"), String(integrationSnapshot.settings.length), "backend snapshot"],
                    ["Token", String(integrationSnapshot.tokens.length), "value masked"],
                  ]}
                />
                <DataRows
                  rows={integrationSnapshot.settings.map((setting) => [
                    setting.key,
                    setting.is_secret ? "secret" : JSON.stringify(setting.value),
                    "backend setting",
                  ])}
                />
                <DataRows
                  rows={integrationSnapshot.tokens.map((token) => [
                    token.token_type,
                    token.expires_at ?? t("noExpiry"),
                    token.value === null ? t("masked") : t("secretNotShown"),
                  ])}
                />
              </div>
            )}
          </FlowPanel>
  );
}

