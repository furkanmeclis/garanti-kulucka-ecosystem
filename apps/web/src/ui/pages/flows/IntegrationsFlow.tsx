import { Settings } from "lucide-react";
import { instagramDraftImageUrl, instagramDraftCaption, instagramCaptionLimit, compactJson, FlowPanel, DetailPanel, DataRows } from "../../app/shared.js";
import type { DashboardController } from "../../app/useDashboardController.js";

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

  return (
    <FlowPanel title="Entegrasyon Hesapları" icon={<Settings size={18} />} testId="integrations-flow">
            <div className="system-settings" data-testid="system-settings">
              <button className="primary-action" type="button" onClick={handleSaveProviderLiveGate}>
                PTT live gate kapalı kaydet
              </button>
              <button className="secondary-action" type="button" onClick={handleSaveOperationalPolicy}>
                Operasyon politikasını kaydet
              </button>
              <DataRows rows={activeSettings.map((setting) => [setting.key, setting.scope, JSON.stringify(setting.value)])} />
              <DetailPanel title="Operasyon Politikaları" testId="operation-policy-detail">
                <DataRows
                  rows={[
                    ["Retry", `${operationalPolicy.max_attempts} deneme`, `${operationalPolicy.retry_delay_ms} ms bekleme`],
                    [
                      "Timeout",
                      `${operationalPolicy.request_timeout_ms} ms provider`,
                      `${operationalPolicy.webhook_timeout_ms} ms webhook`,
                    ],
                    [
                      "Rate Limit",
                      `${operationalPolicy.provider_rate_limit_per_minute}/dk`,
                      `queue concurrency ${operationalPolicy.queue_concurrency}`,
                    ],
                    [
                      "Storage",
                      operationalPolicy.storage_bucket,
                      `${operationalPolicy.lifecycle_days} gün / orphan cleanup ${
                        operationalPolicy.orphan_cleanup_enabled ? "açık" : "kapalı"
                      }`,
                    ],
                  ]}
                />
              </DetailPanel>
              <DetailPanel title="Ayar Denetim Kayıtları" testId="settings-audit-detail">
                <DataRows
                  rows={[
                    ["Kayıt", String(data.settingsAuditSummary.total_count), "settings audit summary"],
                    [
                      "Son işlem",
                      latestSettingsAudit ? `${latestSettingsAudit.action} / ${latestSettingsAudit.entity_type}` : "denetim yok",
                      latestSettingsAudit?.entity_id ?? "-",
                    ],
                    [
                      "Aktör",
                      latestSettingsAudit?.actor_user_id === null || latestSettingsAudit?.actor_user_id === undefined
                        ? "sistem"
                        : String(latestSettingsAudit.actor_user_id),
                      latestSettingsAudit?.created_at ?? "-",
                    ],
                    ["Eski", compactJson(latestSettingsAudit?.old_value), "redacted"],
                    ["Yeni", compactJson(latestSettingsAudit?.new_value), "redacted"],
                  ]}
                />
              </DetailPanel>
            </div>
            <button className="primary-action" type="button" onClick={handleUpsertIntegrationAccount}>
              Instagram hesabı kaydet
            </button>
            <DataRows rows={data.integrationAccounts.map((account) => [account.provider_name, account.display_name, account.status])} />
            <DetailPanel title="Provider Canlı Mod Sınırları" testId="provider-catalog-detail">
              <DataRows
                rows={[
                  ["Katalog", String(data.providerCatalog.length), "backend provider catalog"],
                  [
                    "İlk provider",
                    selectedProviderCatalogItem?.provider ?? "-",
                    selectedProviderCatalogItem?.contract_mode ?? "-",
                  ],
                  [
                    "Canlı çağrı",
                    selectedProviderCatalogItem?.live_call_permitted === false ? "kapalı" : "-",
                    selectedProviderCatalogItem?.live_feature_flag_key ?? "-",
                  ],
                  [
                    "Blok nedeni",
                    selectedProviderCatalogItem?.live_block_reason ?? "-",
                    selectedProviderCatalogItem?.supported_operations.join(", ") ?? "-",
                  ],
                  ["Kanallar", data.providerCatalog.map((item) => item.channels.join("+")).join(" / "), "adapter sınırları"],
                  ["Providerlar", data.providerCatalog.map((item) => item.provider).join(", "), "canlı HTTP kapalı"],
                ]}
              />
            </DetailPanel>
            <DetailPanel title="Instagram Yayın Önizleme" testId="instagram-publish-preview">
              <DataRows
                rows={[
                  ["Fotoğraf URL", instagramDraftImageUrl, "Graph publish"],
                  ["Caption", instagramDraftCaption, `${instagramDraftCaption.length} / ${instagramCaptionLimit} karakter`],
                  ["Önizleme hesabı", integrationSnapshot?.account.display_name ?? "garantikulucka", "Instagram"],
                  ["Yayın modu", "taslak", "canlı provider kapalı"],
                  ["Son backend isteği", lastInstagramPublishPreview ?? "-", "provider attempt dry-run"],
                ]}
              />
              <button
                className="primary-action"
                type="button"
                disabled={instagramPublishPreviewing}
                onClick={() => void handleCreateInstagramPublishPreview()}
              >
                {instagramPublishPreviewing ? "Yayın dry-run hazırlanıyor" : "Instagram yayın dry-run hazırla"}
              </button>
            </DetailPanel>
            <DetailPanel title="Instagram Analitik Özeti" testId="instagram-analytics-summary">
              <DataRows
                rows={[
                  ["Takipçi", String(instagramAnalytics.followers), "backend snapshot"],
                  ["Erişim", String(instagramAnalytics.reach), "legacy analitik"],
                  ["Gösterim", String(instagramAnalytics.impressions), "legacy analitik"],
                  ["Profil Görüntüleme", String(instagramAnalytics.profileViews), `${instagramAnalytics.engagementRate}% etkileşim`],
                ]}
              />
            </DetailPanel>
            <DetailPanel title="Provider Deneme Kayıtları" testId="provider-attempts-detail">
              <DataRows
                rows={[
                  ["Kayıt", String(providerAttemptTotal), "provider debug summary API"],
                  [
                    "Son deneme",
                    selectedProviderAttempt
                      ? `${selectedProviderAttempt.provider_key} / ${selectedProviderAttempt.operation}`
                      : "deneme yok",
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
                    selectedProviderAttempt?.next_retry_at ?? "yeniden deneme yok",
                  ],
                  [
                    "İstek",
                    selectedProviderAttempt?.request_id ?? "-",
                    selectedProviderAttempt?.idempotency_key ?? "idempotency yok",
                  ],
                  [
                    "Önizleme",
                    selectedProviderPreview
                      ? `${selectedProviderPreview.method} ${selectedProviderPreview.path}`
                      : "dry-run preview yok",
                    selectedProviderPreview?.live_call_performed === false ? "canlı çağrı yok" : "-",
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
            <DetailPanel title="Entegrasyon Denetim Kayıtları" testId="integration-audit-detail">
              <DataRows
                rows={[
                  ["Kayıt", String(data.integrationAuditSummary.total_count), "integration audit summary"],
                  [
                    "Son işlem",
                    latestIntegrationAudit
                      ? `${latestIntegrationAudit.action} / ${latestIntegrationAudit.entity_type}`
                      : "denetim yok",
                    latestIntegrationAudit?.entity_id ?? "-",
                  ],
                  [
                    "Aktör",
                    latestIntegrationAudit?.actor_user_id === null || latestIntegrationAudit?.actor_user_id === undefined
                      ? "sistem"
                      : String(latestIntegrationAudit.actor_user_id),
                    latestIntegrationAudit?.created_at ?? "-",
                  ],
                  ["Eski", compactJson(latestIntegrationAudit?.old_value), "redacted"],
                  ["Yeni", compactJson(latestIntegrationAudit?.new_value), "redacted"],
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
                  {account.display_name} detay
                </button>
              ))}
              <button className="secondary-action" type="button" onClick={handleSaveIntegrationToken}>
                Access token kaydet
              </button>
              <button className="secondary-action" type="button" onClick={handleSaveIntegrationSetting}>
                Webhook ayarını kaydet
              </button>
            </div>
            {integrationSnapshot && (
              <div className="integration-detail" data-testid="integration-detail">
                <div>
                  <h2>{integrationSnapshot.account.display_name}</h2>
                  <p>{integrationSnapshot.account.external_account_id ?? "Harici hesap yok"}</p>
                </div>
                <DataRows
                  rows={[
                    ["Provider", integrationSnapshot.account.provider_name, integrationSnapshot.account.status],
                    ["Ayar", String(integrationSnapshot.settings.length), "backend snapshot"],
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
                    token.expires_at ?? "süresiz",
                    token.value === null ? "maskeli" : "gizli veri gösterilmedi",
                  ])}
                />
              </div>
            )}
          </FlowPanel>
  );
}

