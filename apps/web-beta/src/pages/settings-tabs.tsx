import { BellOff, BellRing, Bot, CheckCircle2, Copy, ExternalLink, Hand, KeyRound, Loader2, PhoneCall, RefreshCw, RotateCcw, Save, ScrollText, Server, Settings2, ShieldX, Unplug, UserCog, UserSearch, Wallet, Webhook, XCircle, Zap, type LucideIcon } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "@/app/auth";
import { BrandIcon, type Brand } from "@/components/brand-icons";
import { ErrorState } from "@/components/data-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/format";
import {
  defaultSipConfig,
  integrationLiveMode,
  integrationSettingExists,
  integrationTokenExists,
  isRecord,
  plainIntegrationSetting,
  sipConfigFrom,
  type AdminSetting,
  type IntegrationAccount,
  type IntegrationAccountSnapshot,
  type MessagingProvider,
  type NetgsmBalance,
  type SipConfig,
} from "@/lib/settings";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { Hint } from "@/components/hint";
import { useConfirm } from "@/components/confirm-dialog";
import { Textarea } from "@/components/ui/textarea";
import { errorText, FeedbackLine, Field, idempotencyKey, type Feedback } from "./accounting-shared";

/**
 * Manager-only "Ayarlar" tabs (web AyarlarPage parity): AI auto reply + system prompt, the
 * integrations overview and the WhatsApp / Instagram / Messenger / NetGSM / Santral provider forms.
 * Secrets are write-only: the backend only reports whether they exist, and a secret is sent only
 * when the manager typed a new value. Live provider gates are shown, never flipped from here.
 */

const mask = "••••••••";

export type ProviderTab = MessagingProvider | "santral";

function StatusBadge({ ok, okText, badText, testId, neutral }: { ok: boolean; okText: string; badText: string; testId?: string | undefined; neutral?: boolean | undefined }) {
  return (
    <Badge tone={ok ? "success" : neutral ? "neutral" : "danger"} data-testid={testId}>
      {ok ? <CheckCircle2 className="size-3" aria-hidden="true" /> : <XCircle className="size-3" aria-hidden="true" />}
      {ok ? okText : badText}
    </Badge>
  );
}

function SectionHeading({ icon: Icon, brand, title, description, action }: { icon?: LucideIcon; brand?: Brand; title: string; description?: string | undefined; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", brand ? "bg-muted" : "bg-primary/10 text-primary")}>
          {brand ? <BrandIcon brand={brand} title="" className="size-5" /> : Icon ? <Icon className="size-5" aria-hidden="true" /> : null}
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
  );
}

function RefreshButton({ loading, onClick, testId }: { loading: boolean; onClick: () => void; testId?: string }) {
  const { t } = useTranslation();
  return (
    <Button variant="outline" className="min-h-11" onClick={onClick} disabled={loading} data-testid={testId}>
      <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" />
      {t("settingsTabs.refresh")}
    </Button>
  );
}

function SaveButton({ saving, testId, label }: { saving: boolean; testId: string; label?: string }) {
  const { t } = useTranslation();
  return (
    <Button type="submit" className="min-h-11" disabled={saving} data-testid={testId}>
      {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
      {saving ? t("settingsTabs.saving") : (label ?? t("settingsTabs.save"))}
    </Button>
  );
}

/** Webhook callback on the API origin (the beta talks to the backend through `api.baseUrl`). */
export function webhookCallbackUrl(baseUrl: string, provider: MessagingProvider) {
  const base = new URL(baseUrl.replace(/\/+$/, "") + "/", window.location.origin);
  return new URL(`webhooks/${provider}`, base).toString();
}

function CopyField({ label, value, testId, notify }: { label: string; value: string; testId: string; notify: (feedback: Feedback) => void }) {
  const { t } = useTranslation();
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      notify({ tone: "success", text: t("settingsTabs.copied") });
    } catch {
      notify({ tone: "error", text: t("settingsTabs.copyFailed") });
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
      <span>{label}</span>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 rounded-md border bg-muted/40 px-3 py-2.5 font-mono text-xs break-all" data-testid={testId}>
          {value}
        </code>
        <Button type="button" variant="outline" className="min-h-11 self-start sm:self-auto" onClick={() => void copy()} data-testid={`${testId}-copy`}>
          <Copy className="size-4" aria-hidden="true" />
          {t("settingsTabs.copy")}
        </Button>
      </div>
    </div>
  );
}

function SecretInput({ label, name, value, configured, onChange, testId }: { label: string; name: string; value: string; configured: boolean; onChange: (value: string) => void; testId: string }) {
  const { t } = useTranslation();
  return (
    <Field label={label}>
      <Input
        name={name}
        type="password"
        autoComplete="off"
        value={value}
        placeholder={configured ? `${mask} · ${t("settingsTabs.replacePlaceholder")}` : ""}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 md:h-9"
        data-testid={testId}
      />
    </Field>
  );
}

function LiveGateNote({ gate }: { gate: string }) {
  const { t } = useTranslation();
  return <p className="text-xs text-muted-foreground">{t("settingsTabs.liveGateNote", { gate })}</p>;
}

// ─── Integration account loading ─────────────────────────────────────────────

interface ProviderState {
  account: IntegrationAccount | null;
  snapshot: IntegrationAccountSnapshot | null;
}

function useIntegrationAccount(provider: MessagingProvider) {
  const { api } = useAuth();
  return useQuery<ProviderState>(`settings:integration:${provider}`, async () => {
    const { data } = await api.listIntegrationAccounts();
    const account = data.find((item) => item.provider_key === provider) ?? null;
    return { account, snapshot: account ? await api.getIntegrationAccount(account.public_id) : null };
  });
}

function AccountStatusBadge({ account, testId }: { account: IntegrationAccount | null; testId?: string }) {
  const { t } = useTranslation();
  return <StatusBadge ok={account?.status === "active"} okText={t("settingsTabs.accountActive")} badText={account ? t("settingsTabs.accountInactive") : t("settingsTabs.accountMissing")} testId={testId} />;
}

function LiveBadge({ live, testId }: { live: boolean; testId: string }) {
  const { t } = useTranslation();
  return (
    <Hint content={t("hints.liveMode")}>
      <Badge tone={live ? "success" : "neutral"} data-testid={testId}>
        {live ? t("settingsTabs.liveOn") : t("settingsTabs.liveOff")}
      </Badge>
    </Hint>
  );
}

// ─── Genel AI ────────────────────────────────────────────────────────────────

export function AiSettingsTab() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const status = useQuery("settings:ai-status", () => api.aiStatus());
  const settings = useQuery("settings:global", () => api.listAdminSettings());
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [toggling, setToggling] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [promptSource, setPromptSource] = useState<"custom" | "default" | null>(null);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    if (status.data) setEnabled(status.data.ai_enabled);
  }, [status.data]);

  useEffect(() => {
    if (!settings.data) return;
    const value = settings.data.data.find((setting) => setting.key === "ai.system_prompt")?.value;
    const text = typeof value === "string" ? value : "";
    setPrompt(text);
    setPromptSource(text.trim() ? "custom" : "default");
  }, [settings.data]);

  async function toggle() {
    if (enabled === null) return;
    const next = !enabled;
    setToggling(true);
    setFeedback(null);
    try {
      await api.upsertAdminSetting("ai.auto_reply_enabled", next);
      setEnabled(next);
      setFeedback({ tone: "success", text: next ? t("settingsTabs.aiTurnedOn") : t("settingsTabs.aiTurnedOff") });
    } catch (error) {
      setFeedback({ tone: "error", text: t("settingsTabs.saveFailed", { error: errorText(error) }) });
    } finally {
      setToggling(false);
    }
  }

  async function savePrompt(event: FormEvent) {
    event.preventDefault();
    if (prompt.trim().length < 10) return setFeedback({ tone: "error", text: t("settingsTabs.promptMinLength") });
    setSavingPrompt(true);
    setFeedback(null);
    try {
      await api.upsertAdminSetting("ai.system_prompt", prompt.trim());
      setPromptSource("custom");
      setFeedback({ tone: "success", text: t("settingsTabs.promptSaved") });
    } catch (error) {
      setFeedback({ tone: "error", text: t("settingsTabs.saveFailed", { error: errorText(error) }) });
    } finally {
      setSavingPrompt(false);
    }
  }

  async function resetPrompt() {
    setSavingPrompt(true);
    setFeedback(null);
    try {
      await api.upsertAdminSetting("ai.system_prompt", "");
      setPrompt("");
      setPromptSource("default");
      setFeedback({ tone: "success", text: t("settingsTabs.promptReset") });
    } catch (error) {
      setFeedback({ tone: "error", text: t("settingsTabs.saveFailed", { error: errorText(error) }) });
    } finally {
      setSavingPrompt(false);
    }
  }

  return (
    <div className="flex flex-col gap-6" data-testid="settings-tab-panel-ai">
      <Card data-testid="settings-ai-toggle-card">
        <CardContent className="flex flex-col gap-4 pt-4 sm:pt-6">
          <SectionHeading icon={Bot} title={t("settingsTabs.aiAutoReply")} description={enabled ? t("settingsTabs.aiAutoReplyOn") : t("settingsTabs.aiAutoReplyOff")} />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(enabled)}
              aria-label={t("settingsTabs.aiAutoReply")}
              disabled={enabled === null || toggling}
              onClick={() => void toggle()}
              className={cn(
                "relative inline-flex h-11 w-16 shrink-0 items-center rounded-full border-2 border-transparent transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
                enabled ? "bg-emerald-600" : "bg-muted-foreground/30",
              )}
              data-testid="settings-ai-toggle"
            >
              <span className={cn("inline-block size-9 rounded-full bg-background shadow transition-transform", enabled ? "translate-x-5" : "translate-x-0")} />
            </button>
            <Badge tone={enabled ? "success" : "neutral"} data-testid="settings-ai-badge">
              <Zap className="size-3" aria-hidden="true" />
              {enabled ? t("settingsTabs.aiOnBadge") : t("settingsTabs.aiOffBadge")}
            </Badge>
          </div>
          {status.error != null && !status.data && <p className="text-sm text-destructive">{t("settingsTabs.loadFailed", { error: errorText(status.error) })}</p>}
        </CardContent>
      </Card>

      <Card data-testid="settings-ai-prompt">
        <CardHeader>
          <CardTitle>{t("settingsTabs.aiPromptTitle")}</CardTitle>
          <CardDescription>{t("settingsTabs.aiPromptDescription")}</CardDescription>
          {promptSource && (
            <span>
              <Badge tone={promptSource === "custom" ? "info" : "neutral"} data-testid="settings-ai-prompt-source">
                {promptSource === "custom" ? t("settingsTabs.customPrompt") : t("settingsTabs.defaultPrompt")}
              </Badge>
            </span>
          )}
        </CardHeader>
        <CardContent>
          {settings.loading && !settings.data ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {t("settingsTabs.loading")}
            </p>
          ) : (
            <form className="flex flex-col gap-3" onSubmit={(event) => void savePrompt(event)}>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <span className="sr-only">{t("settingsTabs.aiPromptTitle")}</span>
                <Textarea
                  className="min-h-64 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                  value={prompt}
                  rows={14}
                  placeholder={t("settingsTabs.aiPromptPlaceholder")}
                  onChange={(event) => setPrompt(event.target.value)}
                  data-testid="settings-ai-prompt-input"
                />
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">{t("settingsTabs.characterCount", { count: prompt.length })}</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" className="min-h-11" onClick={() => void resetPrompt()} disabled={savingPrompt} data-testid="settings-ai-prompt-reset">
                    <RotateCcw className="size-4" aria-hidden="true" />
                    {t("settingsTabs.resetToDefault")}
                  </Button>
                  <SaveButton saving={savingPrompt} testId="settings-ai-prompt-save" />
                </div>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
      <FeedbackLine feedback={feedback} testId="settings-ai-feedback" />
    </div>
  );
}

// ─── Entegrasyonlar overview ─────────────────────────────────────────────────

/** Every provider tab maps to its brand; Santral is the NetGSM SIP santral (sip.netgsm.com.tr). */
export const providerTabBrand: Record<ProviderTab, Brand> = {
  whatsapp: "whatsapp",
  instagram: "instagram",
  messenger: "messenger",
  netgsm: "netgsm",
  santral: "netgsm",
};

const providerLabel: Record<ProviderTab, string> = { whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger", netgsm: "NetGSM", santral: "Santral" };

const credentialToken: Record<MessagingProvider, string> = { whatsapp: "access_token", instagram: "access_token", messenger: "access_token", netgsm: "sms_password" };

interface OverviewData {
  snapshots: Record<MessagingProvider, ProviderState>;
  settings: AdminSetting[];
}

function settingValue(settings: AdminSetting[], key: string) {
  return settings.find((setting) => setting.key === key)?.value;
}

export function IntegrationsOverviewTab({ onOpen }: { onOpen: (tab: ProviderTab) => void }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const overview = useQuery<OverviewData>("settings:overview", async () => {
    const [{ data: accounts }, { data: settings }] = await Promise.all([api.listIntegrationAccounts(), api.listAdminSettings()]);
    const providers: MessagingProvider[] = ["whatsapp", "instagram", "messenger", "netgsm"];
    const entries = await Promise.all(
      providers.map(async (provider) => {
        const account = accounts.find((item) => item.provider_key === provider) ?? null;
        return [provider, { account, snapshot: account ? await api.getIntegrationAccount(account.public_id) : null }] as const;
      }),
    );
    return { snapshots: Object.fromEntries(entries) as Record<MessagingProvider, ProviderState>, settings };
  });

  const data = overview.data;
  const sip = data ? sipConfigFrom(settingValue(data.settings, "sip_config")) : defaultSipConfig;
  const vapi = data ? settingValue(data.settings, "vapi_ayarlar") : undefined;
  const pipeline = data ? settingValue(data.settings, "kargo_pipeline_ayarlar") : undefined;

  const links: Array<{ to: string; icon: LucideIcon; title: string; description: string; testId: string; badge?: ReactNode }> = [
    {
      to: "/sesli-asistan/vapi",
      icon: Bot,
      title: t("settingsTabs.linkVapi"),
      description: t("settingsTabs.linkVapiDescription"),
      testId: "settings-link-vapi",
      badge: data ? <StatusBadge neutral ok={isRecord(vapi) && vapi.enabled === true} okText={t("settingsTabs.enabled")} badText={t("settingsTabs.disabled")} /> : null,
    },
    {
      to: "/kargolar/pipeline",
      icon: Zap,
      title: t("settingsTabs.linkCargoPipeline"),
      description: t("settingsTabs.linkCargoPipelineDescription"),
      testId: "settings-link-pipeline",
      badge: data ? <StatusBadge neutral ok={isRecord(pipeline) && pipeline.aktif === true} okText={t("settingsTabs.enabled")} badText={t("settingsTabs.disabled")} /> : null,
    },
    { to: "/sesli-asistan", icon: PhoneCall, title: t("settingsTabs.linkAutoConfirm"), description: t("settingsTabs.linkAutoConfirmDescription"), testId: "settings-link-calls" },
    { to: "/kullanicilar", icon: UserCog, title: t("settingsTabs.linkUsers"), description: t("settingsTabs.linkUsersDescription"), testId: "settings-link-users" },
    { to: "/islem-loglari", icon: ScrollText, title: t("settingsTabs.linkLogs"), description: t("settingsTabs.linkLogsDescription"), testId: "settings-link-logs" },
    { to: "/veri-silme-talepleri", icon: ShieldX, title: t("settingsTabs.linkDataDeletion"), description: t("settingsTabs.linkDataDeletionDescription"), testId: "settings-link-data-deletion" },
  ];

  return (
    <div className="flex flex-col gap-6" data-testid="settings-tab-panel-integrations">
      <SectionHeading icon={Server} title={t("settingsTabs.integrationsTitle")} description={t("settingsTabs.integrationsSubtitle")} action={<RefreshButton loading={overview.loading} onClick={overview.reload} />} />
      {overview.error != null && !data ? (
        <ErrorState onRetry={overview.reload} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="settings-integration-cards">
          {(["whatsapp", "instagram", "messenger", "netgsm"] as const).map((provider) => {
            const state = data?.snapshots[provider];
            const credential = integrationTokenExists(state?.snapshot, credentialToken[provider]);
            return (
              <Card key={provider} className="flex flex-col gap-3 p-4" data-testid={`settings-integration-card-${provider}`}>
                <div className="flex items-center gap-2 font-medium">
                  <BrandIcon brand={providerTabBrand[provider]} title="" />
                  {providerLabel[provider]}
                </div>
                {data ? (
                  <div className="flex flex-wrap gap-1.5">
                    <AccountStatusBadge account={state?.account ?? null} testId={`settings-integration-account-${provider}`} />
                    <StatusBadge ok={credential} okText={t("settingsTabs.credentialConfigured")} badText={t("settingsTabs.credentialMissing")} testId={`settings-integration-credential-${provider}`} />
                    <LiveBadge live={integrationLiveMode(state?.snapshot)} testId={`settings-integration-live-${provider}`} />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("settingsTabs.loading")}</p>
                )}
                {state?.account?.external_account_id && <p className="truncate text-xs text-muted-foreground">{t("settingsTabs.externalId", { id: state.account.external_account_id })}</p>}
                <Button variant="outline" className="mt-auto min-h-11 self-start" onClick={() => onOpen(provider)} data-testid={`settings-integration-open-${provider}`}>
                  <Settings2 className="size-4" aria-hidden="true" />
                  {t("settingsTabs.manage")}
                </Button>
              </Card>
            );
          })}
          <Card className="flex flex-col gap-3 p-4" data-testid="settings-integration-card-santral">
            <div className="flex items-center gap-2 font-medium">
              <BrandIcon brand="netgsm" title="" />
              {t("settingsTabs.tabSantral")}
            </div>
            {data ? (
              <div className="flex flex-wrap gap-1.5">
                <StatusBadge ok={Boolean(sip.ws_url && sip.domain)} okText={t("settingsTabs.sipConfigured")} badText={t("settingsTabs.sipMissing")} testId="settings-integration-sip" />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("settingsTabs.loading")}</p>
            )}
            <Button variant="outline" className="mt-auto min-h-11 self-start" onClick={() => onOpen("santral")} data-testid="settings-integration-open-santral">
              <Settings2 className="size-4" aria-hidden="true" />
              {t("settingsTabs.manage")}
            </Button>
          </Card>
        </div>
      )}

      <Card data-testid="settings-related-links">
        <CardHeader>
          <CardTitle>{t("settingsTabs.relatedTitle")}</CardTitle>
          <CardDescription>{t("settingsTabs.relatedDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2">
            {links.map((link) => (
              <li key={link.to}>
                <Link to={link.to} className="flex min-h-11 items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent" data-testid={link.testId}>
                  <link.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {link.title}
                      {link.badge}
                    </span>
                    <span className="block text-xs text-muted-foreground">{link.description}</span>
                  </span>
                  <ExternalLink className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── WhatsApp ────────────────────────────────────────────────────────────────

/** wa.me link for a business number (TR numbers normalised to 90XXXXXXXXXX). */
export function whatsappLink(phone: string) {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `90${digits.slice(1)}`;
  if (digits.length === 10) digits = `90${digits}`;
  return digits.length < 11 ? null : `https://wa.me/${digits}`;
}

export function WhatsAppTab() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const state = useIntegrationAccount("whatsapp");
  const [form, setForm] = useState({ phoneNumberId: "", wabaId: "", displayPhone: "", accessToken: "", verifyToken: "" });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const snapshot = state.data?.snapshot ?? null;
  const account = state.data?.account ?? null;

  useEffect(() => {
    if (!state.data) return;
    const { account: loaded, snapshot: details } = state.data;
    setForm((current) => ({
      ...current,
      phoneNumberId: loaded?.external_account_id ?? plainIntegrationSetting(details, "phone_number_id"),
      wabaId: plainIntegrationSetting(details, "waba_id"),
      displayPhone: plainIntegrationSetting(details, "display_phone_number"),
    }));
  }, [state.data]);

  const tokenSet = integrationTokenExists(snapshot, "access_token");
  const verifySet = integrationSettingExists(snapshot, "webhook.verify_token");
  const link = form.displayPhone ? whatsappLink(form.displayPhone) : null;
  const callback = webhookCallbackUrl(api.baseUrl, "whatsapp");

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form.phoneNumberId.trim()) return setFeedback({ tone: "error", text: t("settingsTabs.phoneNumberIdRequired") });
    setSaving(true);
    setFeedback(null);
    try {
      const saved = await api.upsertIntegrationAccount({ provider_key: "whatsapp", display_name: account?.display_name ?? "WhatsApp", external_account_id: form.phoneNumberId.trim() });
      await api.upsertIntegrationSetting(saved.public_id, "phone_number_id", form.phoneNumberId.trim());
      await api.upsertIntegrationSetting(saved.public_id, "waba_id", form.wabaId.trim());
      await api.upsertIntegrationSetting(saved.public_id, "display_phone_number", form.displayPhone.trim());
      if (form.accessToken.trim()) await api.upsertIntegrationToken(saved.public_id, "access_token", form.accessToken.trim());
      if (form.verifyToken.trim()) await api.upsertIntegrationSetting(saved.public_id, "webhook.verify_token", form.verifyToken.trim(), true);
      setForm((current) => ({ ...current, accessToken: "", verifyToken: "" }));
      setFeedback({ tone: "success", text: t("settingsTabs.saved") });
      state.reload();
    } catch (error) {
      setFeedback({ tone: "error", text: t("settingsTabs.saveFailed", { error: errorText(error) }) });
    } finally {
      setSaving(false);
    }
  }

  const set = (field: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [field]: value }));

  return (
    <div className="flex flex-col gap-6" data-testid="settings-tab-panel-whatsapp">
      <Card className="flex flex-col gap-3 p-4 sm:p-6">
        <SectionHeading brand="whatsapp" title={t("settingsTabs.whatsappTitle")} description={t("settingsTabs.whatsappSubtitle")} action={<RefreshButton loading={state.loading} onClick={state.reload} />} />
        {state.error != null && !state.data && <p className="text-sm text-destructive">{t("settingsTabs.loadFailed", { error: errorText(state.error) })}</p>}
        <div className="flex flex-wrap gap-1.5" data-testid="whatsapp-status">
          <AccountStatusBadge account={account} />
          <StatusBadge ok={tokenSet} okText={t("settingsTabs.tokenConfigured")} badText={t("settingsTabs.tokenMissing")} testId="whatsapp-token-status" />
          <StatusBadge ok={verifySet} okText={t("settingsTabs.verifyConfigured")} badText={t("settingsTabs.verifyMissing")} testId="whatsapp-verify-status" />
          <LiveBadge live={integrationLiveMode(snapshot)} testId="whatsapp-live" />
        </div>
        <LiveGateNote gate="providers.whatsapp.live_mode" />
      </Card>

      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => void save(event)} data-testid="whatsapp-form">
            <Field label={t("settingsTabs.phoneNumberId")}>
              <Input name="phone_number_id" className="h-11 md:h-9" value={form.phoneNumberId} onChange={(event) => set("phoneNumberId")(event.target.value)} data-testid="whatsapp-phone-number-id" />
            </Field>
            <Field label={t("settingsTabs.wabaId")}>
              <Input name="waba_id" className="h-11 md:h-9" value={form.wabaId} onChange={(event) => set("wabaId")(event.target.value)} data-testid="whatsapp-waba-id" />
            </Field>
            <Field label={t("settingsTabs.displayPhone")}>
              <Input name="display_phone_number" type="tel" className="h-11 md:h-9" value={form.displayPhone} onChange={(event) => set("displayPhone")(event.target.value)} data-testid="whatsapp-display-phone" />
            </Field>
            <SecretInput label={t("settingsTabs.accessToken")} name="access_token" value={form.accessToken} configured={tokenSet} onChange={set("accessToken")} testId="whatsapp-access-token" />
            <div className="sm:col-span-2">
              <CopyField label={t("settingsTabs.callbackUrl")} value={callback} testId="whatsapp-callback" notify={setFeedback} />
            </div>
            <SecretInput label={t("settingsTabs.verifyToken")} name="verify_token" value={form.verifyToken} configured={verifySet} onChange={set("verifyToken")} testId="whatsapp-verify-token" />
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <SaveButton saving={saving} testId="whatsapp-save" />
              <FeedbackLine feedback={feedback} testId="whatsapp-feedback" />
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="p-4 sm:p-6" data-testid="whatsapp-link">
        <h3 className="font-semibold">{t("settingsTabs.waLinkTitle")}</h3>
        {link ? (
          <p className="mt-2 text-sm">
            <span className="text-muted-foreground">{t("settingsTabs.waLinkHint")} </span>
            <a href={link} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center font-medium break-all text-primary underline-offset-4 hover:underline md:min-h-0" data-testid="whatsapp-wa-link">
              {link}
            </a>
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">{t("settingsTabs.waLinkMissing")}</p>
        )}
      </Card>
    </div>
  );
}

// ─── Instagram / Messenger ───────────────────────────────────────────────────

export function MetaProviderTab({ provider }: { provider: "instagram" | "messenger" }) {
  const confirm = useConfirm();
  const { t } = useTranslation();
  const { api } = useAuth();
  const state = useIntegrationAccount(provider);
  const [form, setForm] = useState({ pageAccessToken: "", pageId: "", verifyToken: "" });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const [recipientId, setRecipientId] = useState("");
  const [actionFeedback, setActionFeedback] = useState<Feedback>(null);
  const snapshot = state.data?.snapshot ?? null;
  const account = state.data?.account ?? null;
  const label = provider === "instagram" ? "Instagram" : "Messenger";
  const liveGate = `providers.${provider}.live_mode`;

  useEffect(() => {
    if (state.data) setForm((current) => ({ ...current, pageId: state.data?.account?.external_account_id ?? "" }));
  }, [state.data]);

  const tokenSet = integrationTokenExists(snapshot, "access_token");
  const verifySet = integrationSettingExists(snapshot, "webhook.verify_token");
  const callback = webhookCallbackUrl(api.baseUrl, provider);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form.pageId.trim()) return setFeedback({ tone: "error", text: t("settingsTabs.pageIdRequired") });
    setSaving(true);
    setFeedback(null);
    try {
      const saved = await api.upsertIntegrationAccount({ provider_key: provider, display_name: account?.display_name ?? label, external_account_id: form.pageId.trim() });
      if (form.pageAccessToken.trim()) await api.upsertIntegrationToken(saved.public_id, "access_token", form.pageAccessToken.trim());
      if (form.verifyToken.trim()) await api.upsertIntegrationSetting(saved.public_id, "webhook.verify_token", form.verifyToken.trim(), true);
      setForm((current) => ({ ...current, pageAccessToken: "", verifyToken: "" }));
      setFeedback({ tone: "success", text: t("settingsTabs.saved") });
      state.reload();
    } catch (error) {
      setFeedback({ tone: "error", text: t("settingsTabs.saveFailed", { error: errorText(error) }) });
    } finally {
      setSaving(false);
    }
  }

  // Legacy parity: "Webhook'a Abone Ol" / "Bağlantıyı Kes" and the Lab thread owner/take/release;
  // the backend queues the Graph call and only runs it live behind the provider gate.
  async function queued(run: (accountPublicId: string) => Promise<{ job_id: string | null }>) {
    if (!account) return;
    setBusy(true);
    setActionFeedback(null);
    try {
      const result = await run(account.public_id);
      setActionFeedback({ tone: "success", text: t("settingsTabs.jobQueued", { jobId: result.job_id ?? "-", gate: liveGate }) });
    } catch (error) {
      setActionFeedback({ tone: "error", text: t("settingsTabs.actionFailed", { error: errorText(error) }) });
    } finally {
      setBusy(false);
    }
  }

  function webhookSubscription(action: "subscribe" | "unsubscribe") {
    return queued((id) => api.queueWebhookSubscription(id, { action, idempotency_key: idempotencyKey(`${provider}_webhook`) }));
  }

  function threadControl(action: "owner" | "take" | "release") {
    const recipient = recipientId.trim();
    if (!recipient) return setActionFeedback({ tone: "error", text: t("settingsTabs.threadRecipientRequired") });
    return queued((id) => api.queueThreadControl(id, { action, recipient_id: recipient, idempotency_key: idempotencyKey(`${provider}_thread`) }));
  }

  async function disconnect() {
    if (!account) return;
    if (!(await confirm(t("settingsTabs.disconnectConfirm", { provider: account.display_name }), { tone: "danger" }))) return;
    setBusy(true);
    setActionFeedback(null);
    try {
      const result = await api.disconnectIntegrationAccount(account.public_id, { idempotency_key: idempotencyKey(`${provider}_disconnect`) });
      setActionFeedback({ tone: "success", text: t("settingsTabs.disconnected", { count: result.removed_tokens }) });
      state.reload();
    } catch (error) {
      setActionFeedback({ tone: "error", text: t("settingsTabs.actionFailed", { error: errorText(error) }) });
    } finally {
      setBusy(false);
    }
  }

  const actionsDisabled = !account || busy || state.loading;

  return (
    <div className="flex flex-col gap-6" data-testid={`settings-tab-panel-${provider}`}>
      <Card className="flex flex-col gap-3 p-4 sm:p-6">
        <SectionHeading
          brand={provider}
          title={t(provider === "instagram" ? "settingsTabs.instagramTitle" : "settingsTabs.messengerTitle")}
          description={t(provider === "instagram" ? "settingsTabs.instagramSubtitle" : "settingsTabs.messengerSubtitle")}
          action={<RefreshButton loading={state.loading} onClick={state.reload} />}
        />
        {state.error != null && !state.data && <p className="text-sm text-destructive">{t("settingsTabs.loadFailed", { error: errorText(state.error) })}</p>}
        <div className="flex flex-wrap gap-1.5" data-testid={`${provider}-status`}>
          <StatusBadge ok={tokenSet} okText={t("settingsTabs.tokenConfigured")} badText={t("settingsTabs.tokenMissing")} testId={`${provider}-token-status`} />
          <StatusBadge ok={Boolean(account?.external_account_id)} okText={t("settingsTabs.pageIdValue", { id: account?.external_account_id ?? "" })} badText={t("settingsTabs.pageIdMissing")} />
          <StatusBadge neutral ok={account?.status === "active"} okText={t("settingsTabs.connectionActive", { provider: label })} badText={t("settingsTabs.connectionInactive", { provider: label })} />
          <LiveBadge live={integrationLiveMode(snapshot)} testId={`${provider}-live`} />
        </div>
        <LiveGateNote gate={`providers.${provider}.live_mode`} />
      </Card>

      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => void save(event)} data-testid={`${provider}-form`}>
            <SecretInput label={t("settingsTabs.pageAccessToken")} name="page_access_token" value={form.pageAccessToken} configured={tokenSet} onChange={(value) => setForm((current) => ({ ...current, pageAccessToken: value }))} testId={`${provider}-access-token`} />
            <Field label={t("settingsTabs.pageId")}>
              <Input name="page_id" className="h-11 md:h-9" value={form.pageId} onChange={(event) => setForm((current) => ({ ...current, pageId: event.target.value }))} data-testid={`${provider}-page-id`} />
            </Field>
            <div className="sm:col-span-2">
              <CopyField label={t("settingsTabs.callbackUrl")} value={callback} testId={`${provider}-callback`} notify={setFeedback} />
            </div>
            <SecretInput label={t("settingsTabs.verifyToken")} name="verify_token" value={form.verifyToken} configured={verifySet} onChange={(value) => setForm((current) => ({ ...current, verifyToken: value }))} testId={`${provider}-verify-token`} />
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <SaveButton saving={saving} testId={`${provider}-save`} />
              <FeedbackLine feedback={feedback} testId={`${provider}-feedback`} />
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="flex flex-col gap-4 p-4 sm:p-6" data-testid={`${provider}-webhook-card`}>
        <SectionHeading icon={Webhook} title={t("settingsTabs.webhookConnection")} description={t("settingsTabs.webhookConnectionHint", { gate: liveGate })} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="h-11 md:h-9" disabled={actionsDisabled} onClick={() => void webhookSubscription("subscribe")} data-testid={`${provider}-webhook-subscribe`}>
            <BellRing className="size-4" aria-hidden="true" />
            {t("settingsTabs.webhookSubscribe")}
          </Button>
          <Button type="button" variant="outline" className="h-11 md:h-9" disabled={actionsDisabled} onClick={() => void webhookSubscription("unsubscribe")} data-testid={`${provider}-webhook-unsubscribe`}>
            <BellOff className="size-4" aria-hidden="true" />
            {t("settingsTabs.webhookUnsubscribe")}
          </Button>
          <Button type="button" variant="destructive" className="h-11 md:h-9" disabled={actionsDisabled} onClick={() => void disconnect()} data-testid={`${provider}-disconnect`}>
            <Unplug aria-hidden="true" />
            {t("settingsTabs.disconnect")}
          </Button>
        </div>
        <Field label={t("settingsTabs.handover")}>
          <Input name="thread_recipient" className="h-11 md:h-9" placeholder={t("settingsTabs.threadRecipient")} value={recipientId} onChange={(event) => setRecipientId(event.target.value)} data-testid={`${provider}-thread-recipient`} />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" className="h-11 md:h-9" disabled={actionsDisabled} onClick={() => void threadControl("owner")} data-testid={`${provider}-thread-owner`}>
            <UserSearch className="size-4" aria-hidden="true" />
            {t("settingsTabs.threadOwner")}
          </Button>
          <Button type="button" variant="outline" className="h-11 md:h-9" disabled={actionsDisabled} onClick={() => void threadControl("take")} data-testid={`${provider}-thread-take`}>
            <Hand className="size-4" aria-hidden="true" />
            {t("settingsTabs.threadTake")}
          </Button>
          <Button type="button" variant="outline" className="h-11 md:h-9" disabled={actionsDisabled} onClick={() => void threadControl("release")} data-testid={`${provider}-thread-release`}>
            <RotateCcw className="size-4" aria-hidden="true" />
            {t("settingsTabs.threadRelease")}
          </Button>
        </div>
        <FeedbackLine feedback={actionFeedback} testId={`${provider}-action-feedback`} />
      </Card>
    </div>
  );
}

// ─── NetGSM ──────────────────────────────────────────────────────────────────

function BalanceCard({ testId, autoLoad = false }: { testId: string; autoLoad?: boolean }) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [balance, setBalance] = useState<NetgsmBalance | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setChecking(true);
    setError(null);
    try {
      setBalance(await api.netgsmBalance());
    } catch (reason) {
      setError(t("settingsTabs.balanceFailed", { error: errorText(reason) }));
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    // Only the first render triggers the automatic query (web Santral parity).
    if (autoLoad) void check();
  }, []);

  const amount = balance?.balance == null ? "-" : `${balance.balance.toLocaleString(i18n.language === "en" ? "en-US" : "tr-TR", { minimumFractionDigits: 2 })} ${balance.currency}`;

  return (
    <Card className="flex flex-col gap-3 p-4 sm:p-6" data-testid={testId}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="flex items-center gap-2 font-semibold">
          <Wallet className="size-4 text-muted-foreground" aria-hidden="true" />
          {t("settingsTabs.balance")}
        </h3>
        <Button variant="outline" className="min-h-11 self-start" onClick={() => void check()} disabled={checking} data-testid={`${testId}-check`}>
          {checking ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
          {t("settingsTabs.checkBalance")}
        </Button>
      </div>
      {balance && (
        <div className="text-sm" data-testid={`${testId}-result`}>
          <p className="text-xl font-semibold">{amount}</p>
          {balance.status === "dry_run" || !balance.live_call_permitted ? (
            <p className="text-amber-700 dark:text-amber-300">{t("settingsTabs.balanceDryRun", { gate: balance.live_gate })}</p>
          ) : (
            <p className="text-muted-foreground">
              {t("settingsTabs.balanceValue", { credit: balance.sms_credit ?? "-" })} · {t("settingsTabs.lastChecked", { date: formatDateTime(balance.checked_at, i18n.language) })}
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </Card>
  );
}

export function NetgsmTab() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const state = useIntegrationAccount("netgsm");
  const [form, setForm] = useState({ usercode: "", password: "", msgheader: "" });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const snapshot = state.data?.snapshot ?? null;
  const account = state.data?.account ?? null;

  useEffect(() => {
    if (!state.data) return;
    const { account: loaded, snapshot: details } = state.data;
    setForm((current) => ({ ...current, usercode: loaded?.external_account_id ?? plainIntegrationSetting(details, "sms_usercode"), msgheader: plainIntegrationSetting(details, "msgheader") }));
  }, [state.data]);

  const passwordSet = integrationTokenExists(snapshot, "sms_password");
  const callback = webhookCallbackUrl(api.baseUrl, "netgsm");

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form.usercode.trim()) return setFeedback({ tone: "error", text: t("settingsTabs.usercodeRequired") });
    setSaving(true);
    setFeedback(null);
    try {
      const saved = await api.upsertIntegrationAccount({ provider_key: "netgsm", display_name: account?.display_name ?? "NetGSM", external_account_id: form.usercode.trim() });
      await api.upsertIntegrationSetting(saved.public_id, "sms_usercode", form.usercode.trim());
      await api.upsertIntegrationSetting(saved.public_id, "msgheader", form.msgheader.trim());
      if (form.password.trim()) await api.upsertIntegrationToken(saved.public_id, "sms_password", form.password.trim());
      setForm((current) => ({ ...current, password: "" }));
      setFeedback({ tone: "success", text: t("settingsTabs.saved") });
      state.reload();
    } catch (error) {
      setFeedback({ tone: "error", text: t("settingsTabs.saveFailed", { error: errorText(error) }) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6" data-testid="settings-tab-panel-netgsm">
      <Card className="flex flex-col gap-3 p-4 sm:p-6">
        <SectionHeading brand="netgsm" title={t("settingsTabs.netgsmTitle")} description={t("settingsTabs.netgsmSubtitle")} action={<RefreshButton loading={state.loading} onClick={state.reload} />} />
        {state.error != null && !state.data && <p className="text-sm text-destructive">{t("settingsTabs.loadFailed", { error: errorText(state.error) })}</p>}
        <div className="flex flex-wrap gap-1.5" data-testid="netgsm-status">
          <AccountStatusBadge account={account} />
          <StatusBadge ok={passwordSet} okText={t("settingsTabs.passwordConfigured")} badText={t("settingsTabs.passwordMissing")} testId="netgsm-password-status" />
          <LiveBadge live={integrationLiveMode(snapshot)} testId="netgsm-live" />
        </div>
        <LiveGateNote gate="providers.netgsm.live_mode" />
      </Card>

      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => void save(event)} data-testid="netgsm-form">
            <Field label={t("settingsTabs.usercode")}>
              <Input name="usercode" className="h-11 md:h-9" value={form.usercode} onChange={(event) => setForm((current) => ({ ...current, usercode: event.target.value }))} data-testid="netgsm-usercode" />
            </Field>
            <SecretInput label={t("settingsTabs.password")} name="password" value={form.password} configured={passwordSet} onChange={(value) => setForm((current) => ({ ...current, password: value }))} testId="netgsm-password" />
            <Field label={t("settingsTabs.msgheader")}>
              <Input name="msgheader" className="h-11 md:h-9" value={form.msgheader} onChange={(event) => setForm((current) => ({ ...current, msgheader: event.target.value }))} data-testid="netgsm-msgheader" />
            </Field>
            <div className="sm:col-span-2">
              <CopyField label={t("settingsTabs.callbackUrl")} value={callback} testId="netgsm-callback" notify={setFeedback} />
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <SaveButton saving={saving} testId="netgsm-save" />
              <FeedbackLine feedback={feedback} testId="netgsm-feedback" />
            </div>
          </form>
        </CardContent>
      </Card>

      <BalanceCard testId="netgsm-balance" />
    </div>
  );
}

// ─── Santral (SIP/PBX) ───────────────────────────────────────────────────────

export function SantralTab() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const settings = useQuery("settings:global", () => api.listAdminSettings());
  const [config, setConfig] = useState<SipConfig>(defaultSipConfig);
  const [callerId, setCallerId] = useState("");
  const [callerPassword, setCallerPassword] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingCaller, setSavingCaller] = useState(false);
  const [configFeedback, setConfigFeedback] = useState<Feedback>(null);
  const [callerFeedback, setCallerFeedback] = useState<Feedback>(null);
  const [callerPasswordSet, setCallerPasswordSet] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    const rows = settings.data.data;
    setConfig(sipConfigFrom(settingValue(rows, "sip_config")));
    const usercode = settingValue(rows, "netgsm.teyit_voice_usercode");
    setCallerId(typeof usercode === "string" ? usercode : "");
    setCallerPasswordSet(rows.some((setting) => setting.key === "netgsm.teyit_voice_password" && setting.is_secret));
  }, [settings.data]);

  async function saveConfig(event: FormEvent) {
    event.preventDefault();
    setSavingConfig(true);
    setConfigFeedback(null);
    try {
      await api.upsertAdminSetting("sip_config", { ws_url: config.ws_url.trim(), domain: config.domain.trim(), stun: config.stun.trim() });
      setConfigFeedback({ tone: "success", text: t("settingsTabs.pbxSaved") });
    } catch (error) {
      setConfigFeedback({ tone: "error", text: t("settingsTabs.saveFailed", { error: errorText(error) }) });
    } finally {
      setSavingConfig(false);
    }
  }

  async function saveCaller(event: FormEvent) {
    event.preventDefault();
    setSavingCaller(true);
    setCallerFeedback(null);
    try {
      await api.upsertAdminSetting("netgsm.teyit_voice_usercode", callerId.trim());
      if (callerPassword.trim()) {
        await api.upsertAdminSetting("netgsm.teyit_voice_password", callerPassword.trim(), true);
        setCallerPasswordSet(true);
      }
      setCallerPassword("");
      setCallerFeedback({ tone: "success", text: t("settingsTabs.callerIdSaved") });
    } catch (error) {
      setCallerFeedback({ tone: "error", text: t("settingsTabs.saveFailed", { error: errorText(error) }) });
    } finally {
      setSavingCaller(false);
    }
  }

  return (
    <div className="flex flex-col gap-6" data-testid="settings-tab-panel-santral">
      <SectionHeading brand="netgsm" title={t("settingsTabs.pbxTitle")} description={t("settingsTabs.pbxSubtitle")} action={<RefreshButton loading={settings.loading} onClick={settings.reload} />} />
      {settings.error != null && !settings.data && <p className="text-sm text-destructive">{t("settingsTabs.loadFailed", { error: errorText(settings.error) })}</p>}

      <Card>
        <CardHeader>
          <CardTitle>{t("settingsTabs.serverInfo")}</CardTitle>
          <CardDescription>{t("settingsTabs.serverInfoDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => void saveConfig(event)} data-testid="santral-config-form">
            <Field label={t("settingsTabs.wsUrl")} className="sm:col-span-2">
              <Input className="h-11 md:h-9" value={config.ws_url} placeholder="wss://sip.netgsm.com.tr:8089/ws" onChange={(event) => setConfig({ ...config, ws_url: event.target.value })} data-testid="santral-ws-url" />
            </Field>
            <Field label={t("settingsTabs.domain")}>
              <Input className="h-11 md:h-9" value={config.domain} placeholder="sip.netgsm.com.tr" onChange={(event) => setConfig({ ...config, domain: event.target.value })} data-testid="santral-domain" />
            </Field>
            <Field label={t("settingsTabs.stunServer")}>
              <Input className="h-11 md:h-9" value={config.stun} placeholder="stun:stun.l.google.com:19302" onChange={(event) => setConfig({ ...config, stun: event.target.value })} data-testid="santral-stun" />
            </Field>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <SaveButton saving={savingConfig} testId="santral-config-save" />
              <FeedbackLine feedback={configFeedback} testId="santral-config-feedback" />
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settingsTabs.callerIdTitle")}</CardTitle>
          <CardDescription>{t("settingsTabs.callerIdDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => void saveCaller(event)} data-testid="santral-caller-form">
            <Field label={t("settingsTabs.callerIdLabel")}>
              <Input className="h-11 md:h-9" value={callerId} inputMode="numeric" placeholder="3229110370" onChange={(event) => setCallerId(event.target.value)} data-testid="santral-caller-id" />
            </Field>
            <SecretInput label={t("settingsTabs.password")} name="teyit_voice_password" value={callerPassword} configured={callerPasswordSet} onChange={setCallerPassword} testId="santral-caller-password" />
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <SaveButton saving={savingCaller} testId="santral-caller-save" />
              <FeedbackLine feedback={callerFeedback} testId="santral-caller-feedback" />
            </div>
          </form>
        </CardContent>
      </Card>

      <BalanceCard testId="santral-balance" autoLoad />

      <Card className="flex flex-col gap-2 p-4 sm:p-6" data-testid="santral-links">
        <h3 className="flex items-center gap-2 font-semibold">
          <KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />
          {t("settingsTabs.santralMoreTitle")}
        </h3>
        <p className="text-sm text-muted-foreground">{t("settingsTabs.santralMoreDescription")}</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="min-h-11">
            <Link to="/kullanicilar" data-testid="santral-link-users">
              <UserCog className="size-4" aria-hidden="true" />
              {t("settingsTabs.linkUsers")}
            </Link>
          </Button>
          <Button asChild variant="outline" className="min-h-11">
            <Link to="/sesli-asistan" data-testid="santral-link-calls">
              <PhoneCall className="size-4" aria-hidden="true" />
              {t("settingsTabs.linkAutoConfirm")}
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
