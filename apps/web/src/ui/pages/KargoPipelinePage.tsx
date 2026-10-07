import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle,
  Clock,
  FlaskConical,
  Loader2,
  MessageSquare,
  Package,
  Phone,
  Play,
  RefreshCw,
  Send,
  SkipForward,
  Trash2,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { fillCargoPipelineTemplate, defaultCargoPipelineMessageTemplate } from "@garanti-kulucka/shared";
import type { BackendHttpClient } from "../../api/http-client.js";
import {
  createCargoPipelineClient,
  type CargoPipelineAction,
  type CargoPipelineClient,
  type CargoPipelineItem,
  type CargoPipelineTestType,
} from "../../api/cargo-pipeline-client.js";
import { localeFor, useLanguage, useT } from "../i18n/index.js";
import { cargoPipelineMessages } from "../i18n/messages/cargoPipeline.js";
import { errorText } from "./MuhasebeShared.js";

type Key = keyof (typeof cargoPipelineMessages)["tr"];
type Bildirim = { tip: "success" | "error" | "warning"; mesaj: string };

const PAGE_SIZE = 50;

const STATUS_STYLE: Record<string, { className: string; icon: LucideIcon; label: Key }> = {
  bekliyor: { className: "vapi-badge-blue", icon: Clock, label: "statusBekliyor" },
  isleniyor: { className: "vapi-badge-amber", icon: Loader2, label: "statusIsleniyor" },
  tamamlandi: { className: "vapi-badge-green", icon: CheckCircle, label: "statusTamamlandi" },
  teslim: { className: "vapi-badge-emerald", icon: CheckCircle, label: "statusTeslim" },
  hata: { className: "vapi-badge-red", icon: AlertCircle, label: "statusHata" },
  iptal: { className: "vapi-badge-slate", icon: X, label: "statusIptal" },
};

const STEP_STYLE: Record<string, { className: string; icon: LucideIcon; label: Key }> = {
  mesaj: { className: "vapi-badge-cyan", icon: MessageSquare, label: "stepMesaj" },
  sms: { className: "vapi-badge-blue", icon: Send, label: "stepSms" },
  vapi: { className: "vapi-badge-amber", icon: Bot, label: "stepVapi" },
  tamamlandi: { className: "vapi-badge-green", icon: CheckCircle, label: "stepTamamlandi" },
  teslim: { className: "vapi-badge-emerald", icon: CheckCircle, label: "stepTeslim" },
};

const FILTERS: Array<{ id: string; label: Key }> = [
  { id: "tumu", label: "filterAll" },
  { id: "bekliyor", label: "filterWaiting" },
  { id: "isleniyor", label: "filterProcessing" },
  { id: "hata", label: "filterError" },
  { id: "tamamlandi", label: "filterDone" },
  { id: "teslim", label: "filterDelivered" },
  { id: "iptal", label: "filterCancelled" },
];

const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger", facebook: "Messenger" };

function isManager(role: string | undefined) {
  return role === "admin" || role === "owner";
}

function TestPanel({ client, onResult }: { client: CargoPipelineClient; onResult: (bildirim: Bildirim) => void }) {
  const t = useT(cargoPipelineMessages);
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [tracking, setTracking] = useState("TEST-000");
  const [lastMove, setLastMove] = useState("şubede bekliyor");
  const [provider, setProvider] = useState("PTT");
  const [conversation, setConversation] = useState("");
  const [template, setTemplate] = useState(defaultCargoPipelineMessageTemplate);
  const [busy, setBusy] = useState<CargoPipelineTestType | null>(null);

  useEffect(() => {
    void client
      .getConfig()
      .then((response) => setTemplate(response.config.mesaj_sablonu))
      .catch(() => undefined);
  }, [client]);

  const preview = useMemo(
    () => fillCargoPipelineTemplate(template, { customerName: customer || "Test Müşteri", trackingNumber: tracking || "TEST-000", lastEventText: lastMove || "şubede bekliyor", cargoProvider: provider }),
    [template, customer, tracking, lastMove, provider],
  );

  async function send(type: CargoPipelineTestType) {
    if (!phone.trim()) return onResult({ tip: "warning", mesaj: t("testPhoneRequired") });
    if (type === "mesaj" && !conversation.trim()) return onResult({ tip: "warning", mesaj: t("testConversationRequired") });
    setBusy(type);
    try {
      const result = await client.test({
        type,
        phone: phone.trim(),
        customer_name: customer.trim() || "Test Müşteri",
        tracking_number: tracking.trim() || "TEST-000",
        last_event_text: lastMove.trim() || "şubede bekliyor",
        cargo_provider: provider,
        ...(type === "mesaj" ? { conversation_public_id: conversation.trim() } : {}),
        idempotency_key: `${type}_${Date.now()}`,
      });
      onResult(result.queued ? { tip: "success", mesaj: t("testQueued", { gate: result.live_gate }) } : { tip: "warning", mesaj: t("testNotQueued") });
    } catch (error) {
      onResult({ tip: "error", mesaj: t("testFailed", { error: errorText(error) }) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="cargo-pipeline-test" data-testid="cargo-pipeline-test">
      <div className="vapi-modal-title">
        <FlaskConical size={16} />
        <div>
          <strong>{t("testTitle")}</strong>
          <p className="vapi-sub">{t("testSubtitle")}</p>
        </div>
      </div>
      <div className="cargo-pipeline-test-grid">
        <label>
          {t("testCustomer")}
          <input value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="Test Müşteri" />
        </label>
        <label>
          {t("testPhone")}
          <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="05xx xxx xx xx" data-testid="cargo-pipeline-test-phone" />
        </label>
        <label>
          {t("testTracking")}
          <input value={tracking} onChange={(event) => setTracking(event.target.value)} />
        </label>
        <label>
          {t("testLastMove")}
          <input value={lastMove} onChange={(event) => setLastMove(event.target.value)} />
        </label>
        <label>
          {t("testProvider")}
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="PTT">PTT</option>
            <option value="Sürat">Sürat</option>
          </select>
        </label>
        <label>
          {t("testConversation")}
          <input value={conversation} onChange={(event) => setConversation(event.target.value)} placeholder="cnv_…" data-testid="cargo-pipeline-test-conversation" />
        </label>
      </div>
      <div className="vapi-info">
        <span className="vapi-sub">{t("testPreview")}</span>
        <p className="vapi-pre" data-testid="cargo-pipeline-test-preview">{preview}</p>
      </div>
      <div className="vapi-toolbar">
        <button type="button" className="vapi-secondary" disabled={busy !== null} onClick={() => void send("sms")} data-testid="cargo-pipeline-test-sms">
          {busy === "sms" ? <Loader2 size={14} className="vapi-spin" /> : <Send size={14} />}
          {t("testSms")}
        </button>
        <button type="button" className="vapi-secondary" disabled={busy !== null} onClick={() => void send("mesaj")} data-testid="cargo-pipeline-test-message">
          {busy === "mesaj" ? <Loader2 size={14} className="vapi-spin" /> : <MessageSquare size={14} />}
          {t("testMessage")}
        </button>
        <button type="button" className="vapi-secondary" disabled={busy !== null} onClick={() => void send("vapi")} data-testid="cargo-pipeline-test-vapi">
          {busy === "vapi" ? <Loader2 size={14} className="vapi-spin" /> : <Phone size={14} />}
          {t("testVapi")}
        </button>
      </div>
    </section>
  );
}

/**
 * Legacy parity: garanti-kulucka/frontend/src/pages/kargo/KargoPipelinePage.jsx (+ KargoPipelineTestPaneli).
 * Rows come from `/api/cargo-pipeline`; the worker engine walks mesaj → sms → vapi. Actions, delete and the
 * test panel are manager-only as in the legacy page; the legacy quick-message popover opens the conversation.
 */
export function KargoPipelinePage({ http, role, onOpenConversation }: { http: BackendHttpClient; role: string | undefined; onOpenConversation: (conversationPublicId: string) => void }) {
  const t = useT(cargoPipelineMessages);
  const { language } = useLanguage();
  const client = useMemo(() => createCargoPipelineClient(http), [http]);
  const manager = isManager(role);
  const [rows, setRows] = useState<CargoPipelineItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("tumu");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [bildirim, setBildirim] = useState<Bildirim | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.list({ status: filter, page, pageSize: PAGE_SIZE });
      setRows(response.data);
      setTotal(response.total);
    } catch (error) {
      setBildirim({ tip: "error", mesaj: t("loadFailed", { error: errorText(error) }) });
    } finally {
      setLoading(false);
    }
  }, [client, filter, page, t]);

  useEffect(() => {
    void load();
    // Legacy: 30 sn'de bir otomatik yenile
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function act(row: CargoPipelineItem, action: CargoPipelineAction) {
    setBusy(`${row.public_id}:${action}`);
    try {
      const { item } = await client.action(row.public_id, action);
      setRows((current) => current.map((entry) => (entry.public_id === item.public_id ? item : entry)));
      setBildirim({ tip: "success", mesaj: action === "run_now" ? t("runNowDone") : t("actionDone") });
    } catch (error) {
      setBildirim({ tip: "error", mesaj: t("actionFailed", { error: errorText(error) }) });
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: CargoPipelineItem) {
    if (!window.confirm(t("deleteConfirm"))) return;
    setBusy(`${row.public_id}:delete`);
    try {
      await client.remove(row.public_id);
      setRows((current) => current.filter((entry) => entry.public_id !== row.public_id));
      setTotal((current) => Math.max(0, current - 1));
      setBildirim({ tip: "success", mesaj: t("deleted") });
    } catch (error) {
      setBildirim({ tip: "error", mesaj: t("actionFailed", { error: errorText(error) }) });
    } finally {
      setBusy(null);
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const formatDate = (value: string) =>
    new Date(value).toLocaleString(localeFor(language), { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="vapi-page" data-testid="shipment-pipeline-flow">
      <div className="vapi-header">
        <div>
          <h1>
            <span className="vapi-logo">
              <Package size={20} />
            </span>
            {t("title")}
          </h1>
          <p className="vapi-muted">{t("subtitle")}</p>
        </div>
        <button type="button" className="vapi-secondary" onClick={() => void load()} disabled={loading} data-testid="cargo-pipeline-refresh">
          <RefreshCw size={16} className={loading ? "vapi-spin" : undefined} />
          {t("refresh")}
        </button>
      </div>

      {bildirim && (
        <div className={`vapi-toast vapi-toast-${bildirim.tip}`} role="status" data-testid="cargo-pipeline-toast">
          <span>{bildirim.mesaj}</span>
          <button type="button" className="vapi-icon-button" onClick={() => setBildirim(null)} aria-label="×">
            <X size={14} />
          </button>
        </div>
      )}

      {manager && <TestPanel client={client} onResult={setBildirim} />}

      <div className="vapi-toolbar" data-testid="cargo-pipeline-filters">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={filter === item.id ? "vapi-primary" : "vapi-secondary"}
            aria-pressed={filter === item.id}
            onClick={() => {
              setFilter(item.id);
              setPage(1);
            }}
            data-testid={`cargo-pipeline-filter-${item.id}`}
          >
            {t(item.label)}
          </button>
        ))}
        <span className="vapi-spacer" />
        <span className="vapi-muted" data-testid="cargo-pipeline-total">
          {t("total")}: {total}
        </span>
      </div>

      <div className="vapi-table-wrap">
        <table className="vapi-table" data-testid="cargo-pipeline-table">
          <thead>
            <tr>
              <th>{t("colCustomer")}</th>
              <th>{t("colChannel")}</th>
              <th>{t("colStep")}</th>
              <th>{t("colLastMove")}</th>
              <th>{t("colNextRun")}</th>
              <th className="vapi-right">{t("colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="vapi-empty">
                  {loading ? <Loader2 size={20} className="vapi-spin" /> : <Zap size={32} />}
                  {loading ? t("loading") : t("empty")}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const status = STATUS_STYLE[row.status] ?? STATUS_STYLE.bekliyor!;
                const step = STEP_STYLE[row.step] ?? STEP_STYLE.mesaj!;
                const StatusIcon = status.icon;
                const StepIcon = step.icon;
                const finished = row.status === "tamamlandi" || row.status === "teslim" || row.status === "iptal";
                const spinning = (action: string) => busy === `${row.public_id}:${action}`;
                return (
                  <tr key={row.public_id} data-testid={`cargo-pipeline-row-${row.public_id}`}>
                    <td>
                      <div className="vapi-strong">{row.customer_name ?? "—"}</div>
                      <div className="vapi-sub">{row.phone ?? "—"}</div>
                      {row.tracking_number && <div className="vapi-sub vapi-mono">{row.tracking_number}</div>}
                    </td>
                    <td>
                      <div>{row.channel ? (CHANNEL_LABEL[row.channel] ?? row.channel) : "—"}</div>
                      {row.cargo_provider && <div className="vapi-sub">{row.cargo_provider.toUpperCase()}</div>}
                    </td>
                    <td>
                      <div className="cargo-pipeline-badges">
                        <span className={`vapi-badge ${step.className}`}>
                          <StepIcon size={12} />
                          {t(step.label)}
                        </span>
                        <span className={`vapi-badge ${status.className}`}>
                          <StatusIcon size={12} className={row.status === "isleniyor" ? "vapi-spin" : undefined} />
                          {t(status.label)}
                        </span>
                        <span className="vapi-sub">
                          {t("attempt")}: {row.attempt_count}/{row.max_attempts}
                        </span>
                        {row.error_message && (
                          <span className="vapi-sub cargo-pipeline-error" title={row.error_message}>
                            {row.error_message}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="vapi-truncate" title={row.last_event_text ?? undefined}>
                        {row.last_event_text ?? "—"}
                      </span>
                    </td>
                    <td className="vapi-sub">{formatDate(row.next_run_at)}</td>
                    <td className="vapi-right">
                      <div className="vapi-actions">
                        <button
                          type="button"
                          className="vapi-icon-button"
                          disabled={!row.conversation_public_id}
                          title={row.conversation_public_id ? t("openConversation") : t("noConversation")}
                          aria-label={t("openConversation")}
                          onClick={() => row.conversation_public_id && onOpenConversation(row.conversation_public_id)}
                        >
                          <Zap size={16} />
                        </button>
                        {manager && !finished && (
                          <>
                            <button type="button" className="vapi-icon-button" disabled={busy !== null} title={t("runNow")} aria-label={t("runNow")} onClick={() => void act(row, "run_now")} data-testid="cargo-pipeline-run-now">
                              {spinning("run_now") ? <Loader2 size={16} className="vapi-spin" /> : <Play size={16} />}
                            </button>
                            <button type="button" className="vapi-icon-button" disabled={busy !== null} title={t("skip")} aria-label={t("skip")} onClick={() => void act(row, "skip")} data-testid="cargo-pipeline-skip">
                              {spinning("skip") ? <Loader2 size={16} className="vapi-spin" /> : <SkipForward size={16} />}
                            </button>
                            <button type="button" className="vapi-icon-button" disabled={busy !== null} title={t("complete")} aria-label={t("complete")} onClick={() => void act(row, "complete")} data-testid="cargo-pipeline-complete">
                              {spinning("complete") ? <Loader2 size={16} className="vapi-spin" /> : <CheckCircle size={16} />}
                            </button>
                            <button type="button" className="vapi-icon-button" disabled={busy !== null} title={t("cancel")} aria-label={t("cancel")} onClick={() => void act(row, "cancel")} data-testid="cargo-pipeline-cancel">
                              {spinning("cancel") ? <Loader2 size={16} className="vapi-spin" /> : <X size={16} />}
                            </button>
                          </>
                        )}
                        {manager && (
                          <button type="button" className="vapi-icon-button vapi-delete-button" disabled={busy !== null} title={t("delete")} aria-label={t("delete")} onClick={() => void remove(row)} data-testid="cargo-pipeline-delete">
                            {spinning("delete") ? <Loader2 size={16} className="vapi-spin" /> : <Trash2 size={16} />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="vapi-pagination">
          <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
            {t("previous")}
          </button>
          <span>{t("pageOf", { page, pages })}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>
            {t("next")}
          </button>
        </div>
      )}
    </div>
  );
}
