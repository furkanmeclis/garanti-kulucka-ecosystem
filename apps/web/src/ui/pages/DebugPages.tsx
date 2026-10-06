import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Bot, Bug, CheckCircle, Copy, Download, GraduationCap, Instagram, Loader2, MessageSquare, RefreshCw, Send, XCircle } from "lucide-react";
import type { BackendHttpClient } from "../../api/http-client.js";
import { BackendRequestError } from "../../api/http-client.js";
import { createDebugClient, type AiDebug, type AiTrainingStats, type DebugProviderAttempt, type DebugWebhookEvent, type InstagramDebug, type WhatsappDebug } from "../../api/debug-client.js";
import { localeFor, useLanguage, useT } from "../i18n/index.js";
import { debugMessages } from "../i18n/messages/debug.js";

/**
 * Legacy admin debug pages (WhatsAppDebugPage, InstagramDebugPage, AIDebugPage, AIEgitimPage). Data comes
 * from `/api/debug/*` read models; nothing here calls a provider directly.
 */

function errorText(error: unknown) {
  if (error instanceof BackendRequestError) {
    const body = error.body as { error?: { message?: string } } | null;
    return body?.error?.message ?? `HTTP ${error.status}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function useDebugData<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(false);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load());
      setError(null);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, [load]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => void reload(), 10_000);
    return () => window.clearInterval(timer);
  }, [auto, reload]);
  return { data, error, loading, reload, auto, setAuto };
}

function useDateTime() {
  const { language } = useLanguage();
  return useCallback((value: string | null) => (value ? new Date(value).toLocaleString(localeFor(language), { dateStyle: "short", timeStyle: "medium" }) : "-"), [language]);
}

function DebugShell(props: {
  title: string;
  icon: ReactNode;
  testId: string;
  loading: boolean;
  error: string | null;
  onRefresh?: () => void;
  auto?: { value: boolean; onChange: (value: boolean) => void };
  children: ReactNode;
}) {
  const t = useT(debugMessages);
  return (
    <section className="flow-panel debug-page" data-testid={props.testId}>
      <Link to="/ayarlar" className="debug-back">
        <ArrowLeft size={16} aria-hidden="true" /> {t("back")}
      </Link>
      <header className="debug-header">
        <h1>
          {props.icon} {props.title}
        </h1>
        <div className="debug-header-actions">
          {props.auto && (
            <label className="debug-check">
              <input type="checkbox" checked={props.auto.value} onChange={(event) => props.auto?.onChange(event.target.checked)} data-testid="debug-auto-refresh" />
              {t("autoRefresh")}
            </label>
          )}
          {props.onRefresh && (
            <button type="button" className="secondary-action debug-button" onClick={props.onRefresh} disabled={props.loading} data-testid="debug-refresh">
              <RefreshCw size={16} className={props.loading ? "acct-spin" : ""} aria-hidden="true" /> {t("refresh")}
            </button>
          )}
        </div>
      </header>
      {props.error && (
        <p className="debug-notice error" role="alert">
          {t("loadFailed", { error: props.error })}
        </p>
      )}
      {props.children}
    </section>
  );
}

function Flag({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <span className={`debug-flag ${ok ? "ok" : "bad"}`}>
      {ok ? <CheckCircle size={14} aria-hidden="true" /> : <XCircle size={14} aria-hidden="true" />} {ok ? okText : badText}
    </span>
  );
}

function KeyValues({ rows, testId }: { rows: Array<[string, ReactNode]>; testId?: string }) {
  return (
    <dl className="debug-kv" data-testid={testId}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function WebhookList({ events }: { events: DebugWebhookEvent[] }) {
  const t = useT(debugMessages);
  const formatDate = useDateTime();
  return (
    <section className="detail-panel" data-testid="debug-webhooks">
      <h2>{t("webhooksTitle")}</h2>
      {events.length === 0 ? (
        <p className="muted-line">{t("empty")}</p>
      ) : (
        <ul className="debug-list">
          {events.map((event) => (
            <li key={event.public_id}>
              <div className="debug-list-head">
                <strong>{event.event_type}</strong>
                <span className="status-pill">{event.status}</span>
                <span className="muted-line">
                  {event.provider} · {formatDate(event.received_at)}
                </span>
              </div>
              <code className="debug-code">{event.preview}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AttemptList({ attempts }: { attempts: DebugProviderAttempt[] }) {
  const t = useT(debugMessages);
  const formatDate = useDateTime();
  return (
    <section className="detail-panel" data-testid="debug-attempts">
      <h2>{t("attemptsTitle")}</h2>
      {attempts.length === 0 ? (
        <p className="muted-line">{t("empty")}</p>
      ) : (
        <ul className="debug-list">
          {attempts.map((attempt) => (
            <li key={`${attempt.request_id}-${attempt.started_at}`}>
              <div className="debug-list-head">
                <strong>{attempt.operation}</strong>
                <span className={`status-pill ${attempt.status === "success" ? "" : "debug-bad"}`}>{attempt.status}</span>
                <span className="muted-line">
                  {attempt.status_code ?? "-"} · {attempt.duration_ms} ms · {formatDate(attempt.started_at)}
                </span>
              </div>
              {attempt.error_message && <code className="debug-code">{attempt.error_message}</code>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatsGrid({ stats }: { stats: { conversation_count: number; today_inbound: number; today_outbound: number } }) {
  const t = useT(debugMessages);
  return (
    <div className="report-grid" data-testid="debug-stats">
      <div className="metric">
        <span>{t("todayInbound")}</span>
        <strong>{stats.today_inbound}</strong>
      </div>
      <div className="metric">
        <span>{t("todayOutbound")}</span>
        <strong>{stats.today_outbound}</strong>
      </div>
      <div className="metric">
        <span>{t("conversations")}</span>
        <strong>{stats.conversation_count}</strong>
      </div>
    </div>
  );
}

function CopyLine({ value, testId }: { value: string; testId: string }) {
  const t = useT(debugMessages);
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <div className="debug-copy">
      <code data-testid={testId}>{value}</code>
      <button
        type="button"
        className="secondary-action debug-button"
        onClick={() =>
          navigator.clipboard
            .writeText(value)
            .then(() => setState("ok"))
            .catch(() => setState("fail"))
        }
      >
        <Copy size={14} aria-hidden="true" /> {t("copy")}
      </button>
      {state !== "idle" && <span className="muted-line">{state === "ok" ? t("copied") : t("copyFailed")}</span>}
    </div>
  );
}

function WebhookVerifyForm({ http, path }: { http: BackendHttpClient; path: string }) {
  const t = useT(debugMessages);
  const client = useMemo(() => createDebugClient(http), [http]);
  const [token, setToken] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const challenge = `debug_test_${Date.now()}`;
    try {
      const echoed = await client.verifyWebhook(path, token, challenge);
      setResult(echoed === challenge ? { ok: true, text: t("webhookOk") } : { ok: false, text: t("webhookFailed", { detail: echoed.slice(0, 120) }) });
    } catch (error) {
      setResult({ ok: false, text: t("webhookFailed", { detail: errorText(error) }) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="detail-panel debug-form" onSubmit={(event) => void run(event)} data-testid="debug-webhook-test">
      <h2>{t("webhookTestTitle")}</h2>
      <p className="muted-line">{t("webhookTestHint")}</p>
      <label>
        <span className="field-label">{t("verifyTokenInput")}</span>
        <input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} required data-testid="debug-verify-token" />
      </label>
      <button type="submit" className="primary-action debug-button" disabled={busy || !token}>
        {busy ? <Loader2 size={16} className="acct-spin" aria-hidden="true" /> : <CheckCircle size={16} aria-hidden="true" />} {t("runTest")}
      </button>
      {result && (
        <p className={`debug-notice ${result.ok ? "success" : "error"}`} role="status" data-testid="debug-webhook-result">
          {result.text}
        </p>
      )}
    </form>
  );
}

export function WhatsAppDebugPage({ http }: { http: BackendHttpClient }) {
  const t = useT(debugMessages);
  const client = useMemo(() => createDebugClient(http), [http]);
  const load = useCallback(() => client.whatsapp(), [client]);
  const { data, error, loading, reload, auto, setAuto } = useDebugData<WhatsappDebug>(load);
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    try {
      const result = await client.whatsappTestSend(to, `wa-debug:${Date.now()}`);
      setSendResult({ ok: true, text: t("queued", { request: result.request_id }) });
      void reload();
    } catch (reason) {
      setSendResult({ ok: false, text: errorText(reason) });
    } finally {
      setSending(false);
    }
  }

  const config = data?.config;
  return (
    <DebugShell title={t("whatsappTitle")} icon={<MessageSquare size={18} />} testId="whatsapp-debug" loading={loading} error={error} onRefresh={() => void reload()} auto={{ value: auto, onChange: setAuto }}>
      {data && (
        <>
          <section className="detail-panel">
            <h2>{t("configTitle")}</h2>
            {config ? (
              <KeyValues
                testId="whatsapp-debug-config"
                rows={[
                  [t("accountStatus"), config.status],
                  [t("phoneNumberId"), config.phone_number_id ?? "-"],
                  [t("wabaId"), config.waba_id ?? "-"],
                  [t("displayPhone"), config.display_phone_number ?? "-"],
                  [t("accessToken"), <Flag key="token" ok={config.access_token_configured} okText={t("configured")} badText={t("missing")} />],
                  [t("verifyToken"), <Flag key="verify" ok={config.verify_token_configured} okText={t("configured")} badText={t("missing")} />],
                  [t("liveCalls"), <Flag key="live" ok={config.live_call_permitted} okText={t("liveOn")} badText={t("liveOff")} />],
                ]}
              />
            ) : (
              <p className="muted-line">{t("notConfigured")}</p>
            )}
            <p className="muted-line">{t("liveGate", { gate: data.live_gate })}</p>
            <h3>{t("callbackTitle")}</h3>
            <CopyLine value={`${window.location.origin}${data.callback_path}`} testId="whatsapp-debug-callback" />
          </section>
          <h2 className="debug-section-title">{t("statsTitle")}</h2>
          <StatsGrid stats={data.stats} />
          <form className="detail-panel debug-form" onSubmit={(event) => void send(event)} data-testid="whatsapp-test-send">
            <h2>{t("testSendTitle")}</h2>
            <p className="muted-line">{t("testSendHint", { gate: data.live_gate })}</p>
            <label>
              <span className="field-label">{t("phone")}</span>
              <input type="tel" value={to} onChange={(event) => setTo(event.target.value)} required placeholder="905xxxxxxxxx" data-testid="whatsapp-test-to" />
            </label>
            <button type="submit" className="primary-action debug-button" disabled={sending || !to.trim()}>
              {sending ? <Loader2 size={16} className="acct-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />} {sending ? t("sending") : t("send")}
            </button>
            {sendResult && (
              <p className={`debug-notice ${sendResult.ok ? "success" : "error"}`} role="status" data-testid="whatsapp-test-result">
                {sendResult.text}
              </p>
            )}
          </form>
          <WebhookVerifyForm http={http} path={data.callback_path} />
          <WebhookList events={data.webhooks} />
          <AttemptList attempts={data.attempts} />
        </>
      )}
    </DebugShell>
  );
}

export function InstagramDebugPage({ http }: { http: BackendHttpClient }) {
  const t = useT(debugMessages);
  const client = useMemo(() => createDebugClient(http), [http]);
  const load = useCallback(() => client.instagram(), [client]);
  const { data, error, loading, reload, auto, setAuto } = useDebugData<InstagramDebug>(load);
  return (
    <DebugShell title={t("instagramTitle")} icon={<Instagram size={18} />} testId="instagram-debug" loading={loading} error={error} onRefresh={() => void reload()} auto={{ value: auto, onChange: setAuto }}>
      {data && (
        <>
          <section className="detail-panel">
            <h2>{t("accountsTitle")}</h2>
            {data.accounts.length === 0 ? (
              <p className="muted-line">{t("notConfigured")}</p>
            ) : (
              data.accounts.map((account) => (
                <KeyValues
                  key={account.account_public_id}
                  testId={`instagram-debug-account-${account.provider}`}
                  rows={[
                    [account.provider, `${account.display_name} (${account.external_account_id ?? "-"})`],
                    [t("accountStatus"), account.status],
                    [t("accessToken"), <Flag key="token" ok={account.access_token_configured} okText={t("configured")} badText={t("missing")} />],
                    [t("verifyToken"), <Flag key="verify" ok={account.verify_token_configured} okText={t("configured")} badText={t("missing")} />],
                    [t("liveCalls"), <Flag key="live" ok={account.live_call_permitted} okText={t("liveOn")} badText={t("liveOff")} />],
                  ]}
                />
              ))
            )}
            {Object.entries(data.callback_paths).map(([provider, path]) => (
              <div key={provider}>
                <h3>
                  {t("callbackTitle")} · {provider}
                </h3>
                <CopyLine value={`${window.location.origin}${path}`} testId={`instagram-debug-callback-${provider}`} />
              </div>
            ))}
          </section>
          <h2 className="debug-section-title">{t("statsTitle")}</h2>
          <StatsGrid stats={data.stats} />
          <WebhookVerifyForm http={http} path={data.callback_paths.instagram ?? "/webhooks/instagram"} />
          <WebhookList events={data.webhooks} />
          <AttemptList attempts={data.attempts} />
        </>
      )}
    </DebugShell>
  );
}

export function AiDebugPage({ http }: { http: BackendHttpClient }) {
  const t = useT(debugMessages);
  const formatDate = useDateTime();
  const client = useMemo(() => createDebugClient(http), [http]);
  const load = useCallback(() => client.ai(), [client]);
  const { data, error, loading, reload, auto, setAuto } = useDebugData<AiDebug>(load);
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  async function runTest(event: FormEvent) {
    event.preventDefault();
    setTesting(true);
    try {
      setReply((await client.aiTest(message)).reply);
    } catch (reason) {
      setReply(errorText(reason));
    } finally {
      setTesting(false);
    }
  }

  return (
    <DebugShell title={t("aiTitle")} icon={<Bot size={18} />} testId="ai-debug" loading={loading} error={error} onRefresh={() => void reload()} auto={{ value: auto, onChange: setAuto }}>
      {data && (
        <>
          <section className="detail-panel">
            <h2>{t("aiConfigTitle")}</h2>
            <KeyValues
              testId="ai-debug-config"
              rows={[
                [t("autoReply"), <Flag key="auto" ok={data.config.auto_reply_enabled} okText={t("on")} badText={t("off")} />],
                [t("model"), data.config.model ?? "-"],
                [t("promptSource"), data.config.system_prompt_source === "database" ? t("promptDatabase", { length: data.config.system_prompt_length }) : t("promptDefault")],
              ]}
            />
            <p className="muted-line">{t("aiDryRun")}</p>
          </section>
          <div className="report-grid" data-testid="ai-debug-stats">
            <div className="metric">
              <span>{t("aiStatsToday")}</span>
              <strong>{data.stats.today_ai_replies}</strong>
            </div>
            <div className="metric">
              <span>{t("aiStatsTotal")}</span>
              <strong>{data.stats.total_ai_replies}</strong>
            </div>
          </div>
          <form className="detail-panel debug-form" onSubmit={(event) => void runTest(event)} data-testid="ai-debug-test">
            <h2>{t("aiTestTitle")}</h2>
            <textarea rows={3} value={message} placeholder={t("aiTestPlaceholder")} onChange={(event) => setMessage(event.target.value)} data-testid="ai-debug-message" />
            <button type="submit" className="primary-action debug-button" disabled={testing || !message.trim()}>
              {testing ? <Loader2 size={16} className="acct-spin" aria-hidden="true" /> : <Bot size={16} aria-hidden="true" />} {t("aiTestRun")}
            </button>
            {reply && (
              <p className="debug-notice success" role="status" data-testid="ai-debug-reply">
                {t("aiTestResult", { reply })}
              </p>
            )}
          </form>
          <section className="detail-panel" data-testid="ai-debug-recent">
            <h2>{t("recentAiTitle")}</h2>
            {data.recent.length === 0 ? (
              <p className="muted-line">{t("empty")}</p>
            ) : (
              <ul className="debug-list">
                {data.recent.map((item) => (
                  <li key={item.public_id}>
                    <div className="debug-list-head">
                      <strong>{item.customer_name ?? item.customer_phone ?? "-"}</strong>
                      <span className="status-pill">{item.channel}</span>
                      <span className="muted-line">{formatDate(item.sent_at)}</span>
                    </div>
                    <p className="debug-text">{item.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </DebugShell>
  );
}

export function AiTrainingPage({ http }: { http: BackendHttpClient }) {
  const t = useT(debugMessages);
  const client = useMemo(() => createDebugClient(http), [http]);
  const [answeredOnly, setAnsweredOnly] = useState(true);
  const [channel, setChannel] = useState("");
  const [format, setFormat] = useState("jsonl");
  const [batchSize, setBatchSize] = useState(100);
  const [offset, setOffset] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => client.trainingStats(answeredOnly), [client, answeredOnly]);
  const { data, error, loading, reload } = useDebugData<AiTrainingStats>(load);
  const total = data ? (channel ? data.by_channel[channel] ?? 0 : data.total) : 0;

  async function download() {
    setDownloading(true);
    setNotice(null);
    try {
      const blob = await client.trainingExport({ format, channel, answeredOnly, offset, limit: batchSize });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ai-egitim-${offset}-${offset + batchSize}.${format === "text" ? "txt" : format}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      const count = format === "jsonl" ? (await blob.text()).split("\n").filter(Boolean).length : format === "json" ? (JSON.parse(await blob.text()) as unknown[]).length : (await blob.text()).split("### Konuşma").length - 1;
      setNotice({ ok: true, text: t("downloaded", { count }) });
    } catch (reason) {
      setNotice({ ok: false, text: errorText(reason) });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <DebugShell title={t("trainingTitle")} icon={<GraduationCap size={18} />} testId="ai-training" loading={loading} error={error} onRefresh={() => void reload()}>
      <section className="detail-panel debug-form">
        <p className="debug-strong" data-testid="ai-training-total">
          {t("trainingStats", { total })}
        </p>
        {data && (
          <p className="muted-line" data-testid="ai-training-channels">
            {Object.entries(data.by_channel)
              .map(([name, count]) => `${name}: ${count}`)
              .join(" · ")}
          </p>
        )}
        <label className="debug-check">
          <input
            type="checkbox"
            checked={answeredOnly}
            onChange={(event) => {
              setAnsweredOnly(event.target.checked);
              setOffset(0);
            }}
            data-testid="ai-training-answered"
          />
          {t("answeredOnly")}
        </label>
        <div className="debug-grid">
          <label>
            <span className="field-label">{t("channel")}</span>
            <select
              value={channel}
              onChange={(event) => {
                setChannel(event.target.value);
                setOffset(0);
              }}
              data-testid="ai-training-channel"
            >
              <option value="">{t("allChannels")}</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="instagram">Instagram</option>
              <option value="messenger">Messenger</option>
            </select>
          </label>
          <label>
            <span className="field-label">{t("format")}</span>
            <select value={format} onChange={(event) => setFormat(event.target.value)} data-testid="ai-training-format">
              <option value="text">{t("formatText")}</option>
              <option value="jsonl">{t("formatJsonl")}</option>
              <option value="json">{t("formatJson")}</option>
            </select>
          </label>
          <label>
            <span className="field-label">{t("batchSize")}</span>
            <select
              value={batchSize}
              onChange={(event) => {
                setBatchSize(Number(event.target.value));
                setOffset(0);
              }}
            >
              {[50, 100, 250, 500].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="debug-pager">
          <button type="button" className="secondary-action debug-button" disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - batchSize))}>
            {t("previous")}
          </button>
          <span data-testid="ai-training-batch">{t("batch", { from: offset + 1, to: Math.min(offset + batchSize, Math.max(total, offset + 1)) })}</span>
          <button type="button" className="secondary-action debug-button" disabled={offset + batchSize >= total} onClick={() => setOffset((value) => value + batchSize)}>
            {t("next")}
          </button>
        </div>
        <button type="button" className="primary-action debug-button" onClick={() => void download()} disabled={downloading || total === 0} data-testid="ai-training-download">
          {downloading ? <Loader2 size={16} className="acct-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />} {downloading ? t("downloading") : t("download")}
        </button>
        {notice && (
          <p className={`debug-notice ${notice.ok ? "success" : "error"}`} role="status" data-testid="ai-training-notice">
            {notice.text}
          </p>
        )}
      </section>
    </DebugShell>
  );
}

/** Admin-only link block shown on the Ayarlar page (legacy settings page linked the debug pages). */
export function DebugLinks() {
  const t = useT(debugMessages);
  const links = [
    { to: "/ayarlar/whatsapp-debug", label: t("whatsappTitle"), icon: <MessageSquare size={16} aria-hidden="true" /> },
    { to: "/ayarlar/instagram-debug", label: t("instagramTitle"), icon: <Instagram size={16} aria-hidden="true" /> },
    { to: "/ayarlar/ai-debug", label: t("aiTitle"), icon: <Bot size={16} aria-hidden="true" /> },
    { to: "/ayarlar/ai-egitim", label: t("trainingTitle"), icon: <GraduationCap size={16} aria-hidden="true" /> },
  ];
  return (
    <section className="ayarlar-card" data-testid="debug-links">
      <h3 className="ayarlar-h2">
        <Bug size={18} aria-hidden="true" /> {t("linksTitle")}
      </h3>
      <p className="ayarlar-muted">{t("linksSubtitle")}</p>
      <div className="debug-links">
        {links.map((link) => (
          <Link key={link.to} to={link.to} className="debug-link">
            {link.icon} {link.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
