import { BrainCircuit, CheckCircle, Copy, Download, Loader2, RefreshCw, Send, XCircle } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { DataList, type Column } from "@/components/data-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/layout/page-header";
import { buildUrl } from "@/lib/api";
import { countTrainingRecords, type AiDebug, type AiTrainingFormat, type ChannelStats, type DebugProviderAttempt, type DebugWebhookEvent } from "@/lib/debug";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { errorText, FeedbackLine, Field, idempotencyKey, NativeSelect, type Feedback } from "./accounting-shared";

/**
 * Admin debug pages (web DebugPages.tsx: WhatsApp, Instagram, AI debug and AI training export).
 * Data comes from the `/api/debug/*` read models; nothing here calls a provider directly.
 */

const autoRefreshMs = 10_000;

export function RefreshActions({ loading, onRefresh, auto, onAuto }: { loading: boolean; onRefresh: () => void; auto?: boolean; onAuto?: (value: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <>
      {onAuto && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="h-11 w-5 accent-primary md:size-5" checked={auto ?? false} onChange={(event) => onAuto(event.target.checked)} data-testid="debug-auto-refresh" />
          {t("debugPages.autoRefresh")}
        </label>
      )}
      <Button variant="outline" className="min-h-11" onClick={onRefresh} disabled={loading} data-testid="debug-refresh">
        <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" />
        {t("debugPages.refresh")}
      </Button>
    </>
  );
}

export function LoadError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <p role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" data-testid="debug-load-error">
      {t("debugPages.loadFailed", { error: errorText(error) })}
    </p>
  );
}

function Flag({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <Badge tone={ok ? "success" : "danger"}>
      {ok ? <CheckCircle className="size-3.5" aria-hidden="true" /> : <XCircle className="size-3.5" aria-hidden="true" />}
      {ok ? okText : badText}
    </Badge>
  );
}

function KeyValues({ rows, testId }: { rows: Array<[string, ReactNode]>; testId?: string }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]" {...(testId ? { "data-testid": testId } : {})}>
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StatTile({ label, value, tone, testId }: { label: string; value: string; tone?: "success" | "danger" | "warning" | "info"; testId?: string }) {
  const color = tone === "success" ? "text-emerald-700 dark:text-emerald-300" : tone === "danger" ? "text-red-700 dark:text-red-300" : tone === "warning" ? "text-amber-700 dark:text-amber-300" : tone === "info" ? "text-sky-700 dark:text-sky-300" : "";
  return (
    <Card className="p-3" {...(testId ? { "data-testid": testId } : {})}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-xl font-semibold tabular-nums", color)}>{value}</p>
    </Card>
  );
}

function Section({ title, children, testId, className }: { title: string; children: ReactNode; testId?: string; className?: string }) {
  return (
    <section className={cn("mb-4", className)} {...(testId ? { "data-testid": testId } : {})}>
      <h2 className="mb-2 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function ChannelStatsGrid({ stats }: { stats: ChannelStats }) {
  const { t, i18n } = useTranslation();
  return (
    <Section title={t("debugPages.statsTitle")} testId="debug-stats">
      <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-3">
        <StatTile label={t("debugPages.todayInbound")} value={formatNumber(stats.today_inbound, i18n.language)} />
        <StatTile label={t("debugPages.todayOutbound")} value={formatNumber(stats.today_outbound, i18n.language)} />
        <StatTile label={t("debugPages.conversations")} value={formatNumber(stats.conversation_count, i18n.language)} />
      </div>
    </Section>
  );
}

/** The URL this panel reaches the backend's public webhook route with (the same one the verify test calls). */
function webhookUrl(baseUrl: string, path: string) {
  return new URL(buildUrl(baseUrl, path), window.location.origin).toString();
}

function CopyLine({ value, testId }: { value: string; testId: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
      <code className="min-w-0 flex-1 rounded-md bg-muted px-2 py-2 font-mono text-xs break-all" data-testid={testId}>
        {value}
      </code>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 md:min-h-9"
          onClick={() =>
            void navigator.clipboard
              .writeText(value)
              .then(() => setState("ok"))
              .catch(() => setState("fail"))
          }
        >
          <Copy className="size-4" aria-hidden="true" />
          {t("debugPages.copy")}
        </Button>
        {state !== "idle" && <span className="text-xs text-muted-foreground">{state === "ok" ? t("debugPages.copied") : t("debugPages.copyFailed")}</span>}
      </div>
    </div>
  );
}

function WebhookVerifyForm({ path }: { path: string }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function run(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    const challenge = `debug_test_${Date.now()}`;
    try {
      const echoed = await api.debugVerifyWebhook(path, token, challenge);
      setFeedback(echoed === challenge ? { tone: "success", text: t("debugPages.webhookOk") } : { tone: "error", text: t("debugPages.webhookFailed", { detail: echoed.slice(0, 120) }) });
    } catch (error) {
      setFeedback({ tone: "error", text: t("debugPages.webhookFailed", { detail: errorText(error) }) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4 p-4">
      <form className="flex flex-col gap-3" onSubmit={(event) => void run(event)} data-testid="debug-webhook-test">
        <div>
          <h2 className="text-base font-semibold">{t("debugPages.webhookTestTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("debugPages.webhookTestHint")}</p>
        </div>
        <Field label={t("debugPages.verifyTokenInput")}>
          <Input type="password" autoComplete="off" className="h-11 md:h-9" value={token} onChange={(event) => setToken(event.target.value)} required data-testid="debug-verify-token" />
        </Field>
        <Button type="submit" className="min-h-11 self-start md:min-h-9" disabled={busy || !token} data-testid="debug-webhook-run">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCircle className="size-4" aria-hidden="true" />}
          {t("debugPages.runTest")}
        </Button>
        <FeedbackLine feedback={feedback} testId="debug-webhook-result" />
      </form>
    </Card>
  );
}

function WebhookList({ events }: { events: DebugWebhookEvent[] }) {
  const { t, i18n } = useTranslation();
  const columns: Column<DebugWebhookEvent>[] = [
    { key: "event", header: t("debugPages.colEvent"), mobile: "title", cell: (row) => <span className="font-medium">{row.event_type}</span> },
    { key: "status", header: t("debugPages.colStatus"), mobile: "badge", cell: (row) => <Badge tone={row.status === "failed" ? "danger" : row.status === "processed" ? "success" : "neutral"}>{row.status}</Badge> },
    { key: "provider", header: t("debugPages.colProvider"), cell: (row) => row.provider },
    { key: "time", header: t("debugPages.colTime"), cell: (row) => formatDateTime(row.received_at, i18n.language) },
    { key: "preview", header: t("debugPages.colPreview"), className: "max-w-96", cell: (row) => <code className="font-mono text-xs break-all whitespace-normal">{row.preview}</code> },
  ];
  return (
    <Section title={t("debugPages.webhooksTitle")} testId="debug-webhooks">
      <DataList testId="debug-webhooks" rows={events} columns={columns} rowKey={(row) => row.public_id} loading={false} />
    </Section>
  );
}

function AttemptList({ attempts }: { attempts: DebugProviderAttempt[] }) {
  const { t, i18n } = useTranslation();
  const columns: Column<DebugProviderAttempt>[] = [
    { key: "operation", header: t("debugPages.colOperation"), mobile: "title", cell: (row) => <span className="font-medium">{row.operation}</span> },
    { key: "status", header: t("debugPages.colStatus"), mobile: "badge", cell: (row) => <Badge tone={row.status === "success" ? "success" : "danger"}>{row.status}</Badge> },
    { key: "code", header: t("debugPages.colCode"), cell: (row) => row.status_code ?? "-" },
    { key: "duration", header: t("debugPages.colDuration"), cell: (row) => t("debugPages.durationMs", { ms: row.duration_ms }) },
    { key: "time", header: t("debugPages.colTime"), cell: (row) => formatDateTime(row.started_at, i18n.language) },
    { key: "error", header: t("debugPages.colError"), className: "max-w-96", cell: (row) => (row.error_message ? <code className="font-mono text-xs break-all whitespace-normal text-destructive">{row.error_message}</code> : "-") },
  ];
  return (
    <Section title={t("debugPages.attemptsTitle")} testId="debug-attempts">
      <DataList testId="debug-attempts" rows={attempts} columns={columns} rowKey={(row) => `${row.request_id}-${row.started_at}`} loading={false} />
    </Section>
  );
}

/** /ayarlar/whatsapp-debug — `GET /api/debug/whatsapp` + dry-run test send (`POST /api/debug/whatsapp/test-send`). */
export function WhatsappDebugPage() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [auto, setAuto] = useState(false);
  const query = useQuery("debug:whatsapp", () => api.debugWhatsapp(), auto ? { refreshMs: autoRefreshMs } : {});
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const data = query.data;
  const config = data?.config;

  async function send(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setFeedback(null);
    try {
      const result = await api.debugWhatsappTestSend(to.trim(), idempotencyKey("wa-debug"));
      setFeedback({ tone: "success", text: t("debugPages.whatsapp.queued", { request: result.request_id }) });
      query.reload();
    } catch (error) {
      setFeedback({ tone: "error", text: t("debugPages.whatsapp.failed", { error: errorText(error) }) });
    } finally {
      setSending(false);
    }
  }

  return (
    <section data-testid="page-whatsapp-debug">
      <PageHeader title={t("debugPages.whatsapp.title")} description={t("debugPages.whatsapp.subtitle")} actions={<RefreshActions loading={query.loading} onRefresh={query.reload} auto={auto} onAuto={setAuto} />} />
      <LoadError error={query.error} />
      {data && (
        <>
          <Card className="mb-4 flex flex-col gap-3 p-4">
            <h2 className="text-base font-semibold">{t("debugPages.configTitle")}</h2>
            {config ? (
              <KeyValues
                testId="whatsapp-debug-config"
                rows={[
                  [t("debugPages.accountStatus"), config.status],
                  [t("debugPages.phoneNumberId"), config.phone_number_id ?? "-"],
                  [t("debugPages.wabaId"), config.waba_id ?? "-"],
                  [t("debugPages.displayPhone"), config.display_phone_number ?? "-"],
                  [t("debugPages.accessToken"), <Flag key="token" ok={config.access_token_configured} okText={t("debugPages.configured")} badText={t("debugPages.missing")} />],
                  [t("debugPages.verifyToken"), <Flag key="verify" ok={config.verify_token_configured} okText={t("debugPages.configured")} badText={t("debugPages.missing")} />],
                  [t("debugPages.liveCalls"), <Flag key="live" ok={config.live_call_permitted} okText={t("debugPages.liveOn")} badText={t("debugPages.liveOff")} />],
                ]}
              />
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="whatsapp-debug-config">
                {t("debugPages.notConfigured")}
              </p>
            )}
            <p className="text-sm text-muted-foreground" data-testid="whatsapp-debug-gate">
              {t("debugPages.liveGate", { gate: data.live_gate })}
            </p>
            <h3 className="text-sm font-semibold">{t("debugPages.callbackTitle")}</h3>
            <CopyLine value={webhookUrl(api.baseUrl, data.callback_path)} testId="whatsapp-debug-callback" />
          </Card>
          <ChannelStatsGrid stats={data.stats} />
          <Card className="mb-4 p-4">
            <form className="flex flex-col gap-3" onSubmit={(event) => void send(event)} data-testid="whatsapp-test-send">
              <div>
                <h2 className="text-base font-semibold">{t("debugPages.whatsapp.testSendTitle")}</h2>
                <p className="text-sm text-muted-foreground">{t("debugPages.whatsapp.testSendHint", { gate: data.live_gate })}</p>
              </div>
              <Field label={t("debugPages.whatsapp.phone")}>
                <Input type="tel" className="h-11 md:h-9" value={to} onChange={(event) => setTo(event.target.value)} required placeholder="905xxxxxxxxx" data-testid="whatsapp-test-to" />
              </Field>
              <Button type="submit" className="min-h-11 self-start md:min-h-9" disabled={sending || !to.trim()} data-testid="whatsapp-test-submit">
                {sending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
                {sending ? t("debugPages.whatsapp.sending") : t("debugPages.whatsapp.send")}
              </Button>
              <FeedbackLine feedback={feedback} testId="whatsapp-test-result" />
            </form>
          </Card>
          <WebhookVerifyForm path={data.callback_path} />
          <WebhookList events={data.webhooks} />
          <AttemptList attempts={data.attempts} />
        </>
      )}
    </section>
  );
}

/** /ayarlar/instagram-debug — `GET /api/debug/instagram` (Instagram + Messenger accounts). */
export function InstagramDebugPage() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [auto, setAuto] = useState(false);
  const query = useQuery("debug:instagram", () => api.debugInstagram(), auto ? { refreshMs: autoRefreshMs } : {});
  const data = query.data;
  return (
    <section data-testid="page-instagram-debug">
      <PageHeader title={t("debugPages.instagram.title")} description={t("debugPages.instagram.subtitle")} actions={<RefreshActions loading={query.loading} onRefresh={query.reload} auto={auto} onAuto={setAuto} />} />
      <LoadError error={query.error} />
      {data && (
        <>
          <Card className="mb-4 flex flex-col gap-3 p-4">
            <h2 className="text-base font-semibold">{t("debugPages.instagram.accountsTitle")}</h2>
            {data.accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("debugPages.notConfigured")}</p>
            ) : (
              data.accounts.map((account) => (
                <div key={account.account_public_id} className="rounded-md border p-3">
                  <KeyValues
                    testId={`instagram-debug-account-${account.provider}`}
                    rows={[
                      [account.provider, `${account.display_name} (${account.external_account_id ?? "-"})`],
                      [t("debugPages.accountStatus"), account.status],
                      [t("debugPages.accessToken"), <Flag key="token" ok={account.access_token_configured} okText={t("debugPages.configured")} badText={t("debugPages.missing")} />],
                      [t("debugPages.verifyToken"), <Flag key="verify" ok={account.verify_token_configured} okText={t("debugPages.configured")} badText={t("debugPages.missing")} />],
                      [t("debugPages.liveCalls"), <Flag key="live" ok={account.live_call_permitted} okText={t("debugPages.liveOn")} badText={t("debugPages.liveOff")} />],
                    ]}
                  />
                  {data.live_gates[account.provider] && <p className="mt-2 text-xs text-muted-foreground">{t("debugPages.liveGate", { gate: data.live_gates[account.provider] })}</p>}
                </div>
              ))
            )}
            {Object.entries(data.callback_paths).map(([provider, path]) => (
              <div key={provider} className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">
                  {t("debugPages.callbackTitle")} · {provider}
                </h3>
                <CopyLine value={webhookUrl(api.baseUrl, path)} testId={`instagram-debug-callback-${provider}`} />
              </div>
            ))}
          </Card>
          <ChannelStatsGrid stats={data.stats} />
          <WebhookVerifyForm path={data.callback_paths.instagram ?? "/webhooks/instagram"} />
          <WebhookList events={data.webhooks} />
          <AttemptList attempts={data.attempts} />
        </>
      )}
    </section>
  );
}

type AiRecent = AiDebug["recent"][number];

/** /ayarlar/ai-debug — `GET /api/debug/ai` + dry-run reply test (`POST /api/debug/ai/test`). */
export function AiDebugPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [auto, setAuto] = useState(false);
  const query = useQuery("debug:ai", () => api.debugAi(), auto ? { refreshMs: autoRefreshMs } : {});
  const [message, setMessage] = useState("");
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const data = query.data;

  async function runTest(event: FormEvent) {
    event.preventDefault();
    setTesting(true);
    setFeedback(null);
    try {
      const result = await api.debugAiTest(message);
      setFeedback({ tone: "success", text: t("debugPages.ai.testResult", { reply: result.reply }) });
    } catch (error) {
      setFeedback({ tone: "error", text: t("debugPages.ai.testFailed", { error: errorText(error) }) });
    } finally {
      setTesting(false);
    }
  }

  const columns: Column<AiRecent>[] = [
    { key: "customer", header: t("debugPages.colCustomer"), mobile: "title", cell: (row) => <span className="font-medium">{row.customer_name ?? row.customer_phone ?? "-"}</span> },
    { key: "channel", header: t("debugPages.colChannel"), mobile: "badge", cell: (row) => <Badge tone="info">{row.channel}</Badge> },
    { key: "time", header: t("debugPages.colTime"), cell: (row) => formatDateTime(row.sent_at, i18n.language) },
    { key: "body", header: t("debugPages.colMessage"), className: "max-w-[28rem]", cell: (row) => <span className="whitespace-pre-wrap break-words">{row.body ?? "-"}</span> },
  ];

  return (
    <section data-testid="page-ai-debug">
      <PageHeader title={t("debugPages.ai.title")} description={t("debugPages.ai.subtitle")} actions={<RefreshActions loading={query.loading} onRefresh={query.reload} auto={auto} onAuto={setAuto} />} />
      <LoadError error={query.error} />
      {data && (
        <>
          <Card className="mb-4 flex flex-col gap-3 p-4">
            <h2 className="text-base font-semibold">{t("debugPages.ai.configTitle")}</h2>
            <KeyValues
              testId="ai-debug-config"
              rows={[
                [t("debugPages.ai.autoReply"), <Flag key="auto" ok={data.config.auto_reply_enabled} okText={t("debugPages.on")} badText={t("debugPages.off")} />],
                [t("debugPages.ai.model"), data.config.model ?? "-"],
                [t("debugPages.ai.promptSource"), data.config.system_prompt_source === "database" ? t("debugPages.ai.promptDatabase", { length: data.config.system_prompt_length }) : t("debugPages.ai.promptDefault")],
              ]}
            />
            <p className="text-sm text-muted-foreground">{t("debugPages.ai.dryRun")}</p>
          </Card>
          <div className="mb-4 grid grid-cols-2 gap-2" data-testid="ai-debug-stats">
            <StatTile label={t("debugPages.ai.statsToday")} value={formatNumber(data.stats.today_ai_replies, i18n.language)} />
            <StatTile label={t("debugPages.ai.statsTotal")} value={formatNumber(data.stats.total_ai_replies, i18n.language)} />
          </div>
          <Card className="mb-4 p-4">
            <form className="flex flex-col gap-3" onSubmit={(event) => void runTest(event)} data-testid="ai-debug-test">
              <h2 className="text-base font-semibold">{t("debugPages.ai.testTitle")}</h2>
              <textarea
                className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
                rows={3}
                aria-label={t("debugPages.ai.testTitle")}
                placeholder={t("debugPages.ai.testPlaceholder")}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                data-testid="ai-debug-message"
              />
              <Button type="submit" className="min-h-11 self-start md:min-h-9" disabled={testing || !message.trim()} data-testid="ai-debug-run">
                {testing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <BrainCircuit className="size-4" aria-hidden="true" />}
                {t("debugPages.ai.testRun")}
              </Button>
              <FeedbackLine feedback={feedback} testId="ai-debug-reply" />
            </form>
          </Card>
          <Section title={t("debugPages.ai.recentTitle")} testId="ai-debug-recent">
            <DataList testId="ai-debug-recent" rows={data.recent} columns={columns} rowKey={(row) => row.public_id} loading={false} />
          </Section>
        </>
      )}
    </section>
  );
}

const trainingChannels = ["whatsapp", "instagram", "messenger"] as const;
const trainingChannelLabel: Record<(typeof trainingChannels)[number], string> = { whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger" };
const batchSizes = [50, 100, 250, 500] as const;

/** /ayarlar/ai-egitim — `GET /api/debug/ai-training/stats` + batch export download (`GET /api/debug/ai-training/export`). */
export function AiTrainingPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [answeredOnly, setAnsweredOnly] = useState(true);
  const [channel, setChannel] = useState("");
  const [format, setFormat] = useState<AiTrainingFormat>("jsonl");
  const [batchSize, setBatchSize] = useState(100);
  const [offset, setOffset] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const query = useQuery(`debug:ai-training:${answeredOnly}`, () => api.aiTrainingStats(answeredOnly));
  const data = query.data;
  const total = data ? (channel ? data.by_channel[channel] ?? 0 : data.total) : 0;

  async function download() {
    setDownloading(true);
    setFeedback(null);
    try {
      const { blob, filename } = await api.aiTrainingExport({ format, channel, answeredOnly, offset, limit: batchSize });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename ?? `ai-egitim-${offset}-${offset + batchSize}.${format === "text" ? "txt" : format}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      const count = countTrainingRecords(format, await blob.text());
      setFeedback({ tone: "success", text: t("debugPages.training.downloaded", { count }) });
    } catch (error) {
      setFeedback({ tone: "error", text: t("debugPages.training.downloadFailed", { error: errorText(error) }) });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section data-testid="page-ai-training">
      <PageHeader title={t("debugPages.training.title")} description={t("debugPages.training.subtitle")} actions={<RefreshActions loading={query.loading} onRefresh={query.reload} />} />
      <LoadError error={query.error} />
      <Card className="flex flex-col gap-3 p-4">
        <p className="text-base font-semibold" data-testid="ai-training-total">
          {t("debugPages.training.stats", { total: formatNumber(total, i18n.language) })}
        </p>
        {data && (
          <p className="text-sm text-muted-foreground" data-testid="ai-training-channels">
            {Object.entries(data.by_channel)
              .map(([name, count]) => `${name}: ${formatNumber(count, i18n.language)}`)
              .join(" · ")}
          </p>
        )}
        <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
          <input
            type="checkbox"
            className="h-11 w-5 accent-primary md:size-5"
            checked={answeredOnly}
            onChange={(event) => {
              setAnsweredOnly(event.target.checked);
              setOffset(0);
            }}
            data-testid="ai-training-answered"
          />
          {t("debugPages.training.answeredOnly")}
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t("debugPages.training.channel")}>
            <NativeSelect
              value={channel}
              onChange={(event) => {
                setChannel(event.target.value);
                setOffset(0);
              }}
              data-testid="ai-training-channel"
            >
              <option value="">{t("debugPages.training.allChannels")}</option>
              {trainingChannels.map((value) => (
                <option key={value} value={value}>
                  {trainingChannelLabel[value]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t("debugPages.training.format")}>
            <NativeSelect value={format} onChange={(event) => setFormat(event.target.value as AiTrainingFormat)} data-testid="ai-training-format">
              <option value="text">{t("debugPages.training.formatText")}</option>
              <option value="jsonl">{t("debugPages.training.formatJsonl")}</option>
              <option value="json">{t("debugPages.training.formatJson")}</option>
            </NativeSelect>
          </Field>
          <Field label={t("debugPages.training.batchSize")}>
            <NativeSelect
              value={batchSize}
              onChange={(event) => {
                setBatchSize(Number(event.target.value));
                setOffset(0);
              }}
              data-testid="ai-training-batch-size"
            >
              {batchSizes.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" className="min-h-11 md:min-h-9" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - batchSize))} data-testid="ai-training-previous">
            {t("debugPages.training.previous")}
          </Button>
          <span className="text-sm tabular-nums" data-testid="ai-training-batch">
            {t("debugPages.training.batch", { from: offset + 1, to: Math.min(offset + batchSize, Math.max(total, offset + 1)) })}
          </span>
          <Button type="button" variant="outline" className="min-h-11 md:min-h-9" disabled={offset + batchSize >= total} onClick={() => setOffset((value) => value + batchSize)} data-testid="ai-training-next">
            {t("debugPages.training.next")}
          </Button>
        </div>
        <Button type="button" className="min-h-11 self-start md:min-h-9" onClick={() => void download()} disabled={downloading || total === 0} data-testid="ai-training-download">
          {downloading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
          {downloading ? t("debugPages.training.downloading") : t("debugPages.training.download")}
        </Button>
        <FeedbackLine feedback={feedback} testId="ai-training-notice" />
      </Card>
    </section>
  );
}
