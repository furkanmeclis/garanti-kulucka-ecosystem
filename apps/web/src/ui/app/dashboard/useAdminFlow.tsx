import { useState } from "react";
import { type IntegrationAccountSnapshot, toProviderAttemptViewModel } from "../../../api/admin-client.js";
import { type DownloadInstruction, type FileMetadata, type FileOrphanCleanupDryRun } from "../../../api/file-client.js";
import { instagramDraftImageUrl, instagramDraftCaption, toInstagramAnalyticsView, sipServerSettingsFrom, operationalPolicyFrom } from "../shared.js";
import { uiMessage } from "../../i18n/messages/status.js";
import type { DashboardCore } from "./types.js";

/** Admin flows: settings, integrations, Instagram preview, provider debug data and file boundary checks. */
export function useAdminFlow(core: DashboardCore) {
  const { files, admin, data, setData, setStatus } = core;
  const [uploadedFile, setUploadedFile] = useState<FileMetadata | null>(null);
  const [downloadInstruction, setDownloadInstruction] = useState<DownloadInstruction | null>(null);
  const [orphanCleanupPreview, setOrphanCleanupPreview] = useState<FileOrphanCleanupDryRun | null>(null);
  const [lastInstagramPublishPreview, setLastInstagramPublishPreview] = useState<string | null>(null);
  const [instagramPublishPreviewing, setInstagramPublishPreviewing] = useState(false);
  const [orphanCleanupPreviewing, setOrphanCleanupPreviewing] = useState(false);
  const [integrationSnapshot, setIntegrationSnapshot] = useState<IntegrationAccountSnapshot | null>(null);

  async function handleUpload() {
    setStatus(uiMessage("uploadRequesting"));
    const response = await files.createUpload({
      original_name: "kanit.txt",
      mime_type: "text/plain",
      byte_size: 11,
      checksum: "niECqdXA95O1DqUepmPprCpbQW93H7pd34A88B3v5xU=",
    });

    if (response.upload.presigned_url) {
      await fetch(response.upload.presigned_url, {
        method: response.upload.method,
        headers: response.upload.headers,
        body: "frontend-ok",
      });
    }

    const verifiedFile = await files.getFile(response.file.public_id);
    setUploadedFile(verifiedFile);
    const download = await files.createDownload(verifiedFile.public_id);
    if (download.download.presigned_url) {
      await fetch(download.download.presigned_url, {
        method: download.download.method,
        headers: download.download.headers,
      });
    }
    setDownloadInstruction(download.download);
    setStatus(uiMessage("fileFlowPassed"));
  }

  async function handlePrepareOrphanCleanupDryRun() {
    const orphan = data.fileOrphans[0];
    if (!orphan || orphanCleanupPreviewing) return;

    setStatus(uiMessage("orphanPreparing"));
    setOrphanCleanupPreviewing(true);
    try {
      const preview = await files.createOrphanCleanupDryRun(orphan.public_id);
      setOrphanCleanupPreview(preview);
      setStatus(uiMessage("orphanPrepared"));
    } finally {
      setOrphanCleanupPreviewing(false);
    }
  }

  const activeSettings = data.settings.filter((setting) => !setting.is_secret);
  const sipServerSettings = sipServerSettingsFrom(activeSettings, data.webphone);
  const operationalPolicy = operationalPolicyFrom(activeSettings);

  async function handleSaveProviderLiveGate() {
    setStatus(uiMessage("liveGateSaving"));
    const setting = await admin.upsertSetting("providers.ptt.live_mode", false, false, "global");
    setData((current) => ({
      ...current,
      settings: [setting, ...current.settings.filter((item) => item.key !== setting.key)],
    }));
    setStatus(uiMessage("liveGateSaved"));
  }

  async function handleSaveSipConfig() {
    const setting = await admin.upsertSetting(
      "sip_config",
      {
        ws_url: sipServerSettings.ws_url,
        domain: sipServerSettings.domain,
        stun: sipServerSettings.stun,
      },
      false,
      "global",
    );
    setData((current) => ({
      ...current,
      settings: [setting, ...current.settings.filter((item) => item.key !== setting.key)],
    }));
    setStatus(uiMessage("sipSaved"));
  }

  async function handleSaveOperationalPolicy() {
    setStatus(uiMessage("policySaving"));
    const setting = await admin.upsertSetting(
      "operations.policy",
      {
        max_attempts: 5,
        retry_delay_ms: 45000,
        request_timeout_ms: 12000,
        webhook_timeout_ms: 6000,
        provider_rate_limit_per_minute: 90,
        queue_concurrency: 6,
        storage_bucket: "garage-media",
        lifecycle_days: 120,
        orphan_cleanup_enabled: true,
      },
      false,
      "global",
    );
    setData((current) => ({
      ...current,
      settings: [setting, ...current.settings.filter((item) => item.key !== setting.key)],
    }));
    setStatus(uiMessage("policySaved"));
  }

  async function handleUpsertIntegrationAccount() {
    setStatus(uiMessage("integrationAccountSaving"));
    const account = await admin.upsertIntegrationAccount({
      provider_key: "instagram",
      display_name: "Instagram Playwright",
      external_account_id: "ig_playwright",
      metadata: { source: "frontend" },
    });
    setData((current) => ({
      ...current,
      integrationAccounts: [
        account,
        ...current.integrationAccounts.filter((item) => item.public_id !== account.public_id),
      ],
    }));
    setStatus(uiMessage("integrationAccountSaved"));
  }

  async function handleOpenIntegrationAccount(accountPublicId: string) {
    setStatus(uiMessage("integrationAccountLoading"));
    const [snapshot, instagramAnalytics] = await Promise.all([
      admin.getIntegrationAccount(accountPublicId),
      admin.getInstagramAnalyticsSummary(accountPublicId),
    ]);
    setIntegrationSnapshot(snapshot);
    setData((current) => ({ ...current, instagramAnalytics }));
    setStatus(uiMessage("integrationAccountLoaded"));
  }

  async function handleCreateInstagramPublishPreview() {
    if (instagramPublishPreviewing) return;

    const accountPublicId = integrationSnapshot?.account.public_id ?? data.integrationAccounts[0]?.public_id ?? null;
    setStatus(uiMessage("instagramPreviewPreparing"));
    setInstagramPublishPreviewing(true);
    try {
      const attempt = await admin.createInstagramPublishPreview({
        account_public_id: accountPublicId,
        image_url: instagramDraftImageUrl,
        caption: instagramDraftCaption,
        idempotency_key: `instagram_publish_${accountPublicId ?? "preview"}`,
      });
      setData((current) => ({
        ...current,
        providerAttempts: [
          toProviderAttemptViewModel(attempt),
          ...current.providerAttempts.filter((item) => item.public_id !== attempt.public_id),
        ],
      }));
      setLastInstagramPublishPreview(`${attempt.operation} ${attempt.request_id}`);
      setStatus(uiMessage("instagramPreviewSaved"));
    } finally {
      setInstagramPublishPreviewing(false);
    }
  }

  async function handleSaveIntegrationToken() {
    const accountPublicId = integrationSnapshot?.account.public_id ?? data.integrationAccounts[0]?.public_id;
    if (!accountPublicId) return;

    setStatus(uiMessage("integrationTokenSaving"));
    await admin.upsertIntegrationToken(accountPublicId, "access_token", {
      secret: "frontend-playwright-token",
      source: "admin-ui",
    });
    const [snapshot, instagramAnalytics] = await Promise.all([
      admin.getIntegrationAccount(accountPublicId),
      admin.getInstagramAnalyticsSummary(accountPublicId),
    ]);
    setIntegrationSnapshot(snapshot);
    setData((current) => ({ ...current, instagramAnalytics }));
    setStatus(uiMessage("integrationTokenSaved"));
  }

  async function handleSaveIntegrationSetting() {
    const accountPublicId = integrationSnapshot?.account.public_id ?? data.integrationAccounts[0]?.public_id;
    if (!accountPublicId) return;

    setStatus(uiMessage("integrationSettingSaving"));
    await admin.upsertIntegrationSetting(accountPublicId, "webhook.enabled", true, false);
    const [snapshot, instagramAnalytics] = await Promise.all([
      admin.getIntegrationAccount(accountPublicId),
      admin.getInstagramAnalyticsSummary(accountPublicId),
    ]);
    setIntegrationSnapshot(snapshot);
    setData((current) => ({ ...current, instagramAnalytics }));
    setStatus(uiMessage("integrationSettingSaved"));
  }

  const instagramAnalytics = toInstagramAnalyticsView(data.instagramAnalytics);
  const selectedProviderAttempt = data.providerAttempts[0] ?? null;
  const selectedProviderPreview = selectedProviderAttempt?.provider_request_preview ?? null;
  const selectedProviderCatalogItem = data.providerCatalog[0] ?? null;
  const providerAttemptTotal = data.providerDebugSummary.providers.reduce(
    (total, summary) => total + summary.total_attempts,
    0,
  );
  const pttProviderAttempts = data.providerAttempts.filter((attempt) => attempt.provider_key === "ptt");
  const latestSettingsAudit = data.settingsAudit[0] ?? null;
  const latestIntegrationAudit = data.integrationAudit[0] ?? null;

  return {
    uploadedFile,
    setUploadedFile,
    downloadInstruction,
    setDownloadInstruction,
    orphanCleanupPreview,
    setOrphanCleanupPreview,
    lastInstagramPublishPreview,
    setLastInstagramPublishPreview,
    instagramPublishPreviewing,
    setInstagramPublishPreviewing,
    orphanCleanupPreviewing,
    setOrphanCleanupPreviewing,
    integrationSnapshot,
    setIntegrationSnapshot,
    handleUpload,
    handlePrepareOrphanCleanupDryRun,
    handleSaveProviderLiveGate,
    handleSaveSipConfig,
    handleSaveOperationalPolicy,
    handleUpsertIntegrationAccount,
    handleOpenIntegrationAccount,
    handleCreateInstagramPublishPreview,
    handleSaveIntegrationToken,
    handleSaveIntegrationSetting,
    activeSettings,
    sipServerSettings,
    operationalPolicy,
    instagramAnalytics,
    selectedProviderAttempt,
    selectedProviderPreview,
    selectedProviderCatalogItem,
    providerAttemptTotal,
    pttProviderAttempts,
    latestSettingsAudit,
    latestIntegrationAudit,
  };
}
