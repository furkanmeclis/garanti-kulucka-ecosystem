import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { BookUser, Loader2, MessageSquare, RefreshCw, Search, Send, X } from "lucide-react";
import { BackendRequestError, type BackendHttpClient } from "../../api/http-client.js";
import {
  createVoiceClient,
  type PhonebookEntry,
  type VoiceClient,
  type VoiceMessage,
  type VoiceMessageStatus,
} from "../../api/voice-client.js";
import { localeFor, useLanguage, useT } from "../i18n/index.js";
import { voiceMessagesMessages } from "../i18n/messages/voiceMessages.js";
import { ClickToCall } from "../softphone/Softphone.js";

/**
 * Legacy parity: garanti-kulucka/frontend/src/pages/sesli-asistan/SesliMesajlarPage.jsx and RehberPage.jsx.
 * Sending and report queries are `netgsm.voice.message.*` provider-delivery jobs gated by
 * `providers.netgsm.live_mode`; NetGSM has no phonebook API, so Rehber lists customers and staff SIP extensions.
 */

const PAGE_SIZE = 25;
const statuses: VoiceMessageStatus[] = ["queued", "sent", "failed", "dry_run"];
const callStatuses = ["cevaplandi", "cevaplanmadi", "mesgul", "ulasilamadi", "araniyor"] as const;
type CallStatus = (typeof callStatuses)[number];
type Notice = { tone: "ok" | "error"; text: string } | null;

function errorText(error: unknown, fallback: string) {
  if (error instanceof BackendRequestError) {
    const body = error.body as { error?: { message?: unknown } } | null | undefined;
    if (typeof body?.error?.message === "string" && body.error.message) return body.error.message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Splits the textarea on newlines, commas and semicolons and keeps unique 10–15 digit numbers. */
export function parseRecipients(text: string) {
  const numbers = text
    .split(/[\n,;]+/)
    .map((value) => value.replace(/[^\d+]/g, ""))
    .filter((value) => /^\+?\d{10,15}$/.test(value));
  return [...new Set(numbers)].slice(0, 500);
}

function newKey(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function SesliMesajlarPage(props: { http: BackendHttpClient }) {
  const client = useMemo(() => createVoiceClient(props.http), [props.http]);
  const t = useT(voiceMessagesMessages);
  const [tab, setTab] = useState<"send" | "reports">("send");
  return (
    <section className="arama-page voice-page" data-testid="voice-messages-page">
      <div className="voice-page-head">
        <div>
          <h1>{t("pageTitle")}</h1>
          <p className="arama-muted">{t("pageSubtitle")}</p>
        </div>
        <Link to="/sesli-asistan/rehber" className="secondary-action voice-link" data-testid="open-phonebook">
          <BookUser size={16} aria-hidden="true" />
          {t("openPhonebook")}
        </Link>
      </div>
      <div className="arama-tabs" role="tablist">
        {(["send", "reports"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "selected" : ""}
            onClick={() => setTab(key)}
            data-testid={`voice-tab-${key}`}
          >
            {key === "send" ? t("tabSend") : t("tabReports")}
          </button>
        ))}
      </div>
      {tab === "send" ? <SendForm client={client} onSent={() => setTab("reports")} /> : <Reports client={client} />}
    </section>
  );
}

function SendForm(props: { client: VoiceClient; onSent: () => void }) {
  const t = useT(voiceMessagesMessages);
  const [recipientsText, setRecipientsText] = useState("");
  const [mode, setMode] = useState<"text" | "audio">("text");
  const [message, setMessage] = useState("");
  const [audioId, setAudioId] = useState("");
  const [ringtime, setRingtime] = useState(20);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const recipients = parseRecipients(recipientsText);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    if (recipients.length === 0) return setNotice({ tone: "error", text: t("invalidRecipients") });
    const content = mode === "text" ? message.trim() : audioId.trim();
    if (!content) return setNotice({ tone: "error", text: t("contentRequired") });
    setSending(true);
    try {
      const result = await props.client.sendVoiceMessage({
        recipients,
        ...(mode === "text" ? { message: content } : { audio_id: content }),
        ringtime,
        idempotency_key: newKey("voice"),
      });
      setNotice({
        tone: "ok",
        text: `${result.replayed ? t("replayed") : t("queued", { count: result.voice_message.recipient_count })} ${t("liveGateNote", { gate: result.live_gate })}`,
      });
      setRecipientsText("");
      setMessage("");
      setAudioId("");
    } catch (error) {
      setNotice({ tone: "error", text: t("sendFailed", { error: errorText(error, t("unknownError")) }) });
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="arama-card voice-form" onSubmit={(event) => void submit(event)} data-testid="voice-send-form">
      <label className="voice-field">
        <span>{t("recipientsLabel")}</span>
        <textarea
          rows={5}
          value={recipientsText}
          onChange={(event) => setRecipientsText(event.target.value)}
          placeholder="05551112233"
          data-testid="voice-recipients"
        />
        <small className="arama-muted">
          {t("recipientsHint")} · <strong data-testid="voice-recipient-count">{t("recipientsCount", { count: recipients.length })}</strong>
        </small>
      </label>
      <fieldset className="voice-field voice-mode">
        <legend>{t("contentLabel")}</legend>
        {(["text", "audio"] as const).map((value) => (
          <label key={value} className="voice-radio">
            <input type="radio" name="voice-mode" checked={mode === value} onChange={() => setMode(value)} />
            {value === "text" ? t("contentText") : t("contentAudio")}
          </label>
        ))}
      </fieldset>
      {mode === "text" ? (
        <label className="voice-field">
          <span>{t("messageLabel")}</span>
          <textarea rows={4} maxLength={1000} value={message} onChange={(event) => setMessage(event.target.value)} data-testid="voice-message-text" />
        </label>
      ) : (
        <label className="voice-field">
          <span>{t("audioIdLabel")}</span>
          <input value={audioId} maxLength={64} onChange={(event) => setAudioId(event.target.value)} data-testid="voice-audio-id" />
        </label>
      )}
      <label className="voice-field voice-ringtime">
        <span>{t("ringtimeLabel")}</span>
        <select value={ringtime} onChange={(event) => setRingtime(Number(event.target.value))} data-testid="voice-ringtime">
          {[10, 15, 20, 25, 30].map((value) => (
            <option key={value} value={value}>
              {t("seconds", { count: value })}
            </option>
          ))}
        </select>
      </label>
      {notice && (
        <p className={`arama-message ${notice.tone === "ok" ? "arama-message-ok" : "arama-message-error"}`} role={notice.tone === "ok" ? "status" : "alert"} data-testid="voice-notice">
          {notice.text}
        </p>
      )}
      <div className="voice-actions">
        <button type="submit" className="primary-action" disabled={sending} data-testid="voice-send">
          {sending ? <Loader2 size={16} className="arama-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
          {sending ? t("sending") : t("send")}
        </button>
        <button type="button" className="secondary-action" onClick={props.onSent}>
          {t("tabReports")}
        </button>
      </div>
    </form>
  );
}

function Reports(props: { client: VoiceClient }) {
  const t = useT(voiceMessagesMessages);
  const { language } = useLanguage();
  const [status, setStatus] = useState<VoiceMessageStatus | "">("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<VoiceMessage[]>([]);
  const [totals, setTotals] = useState({ total: 0, recipients: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await props.client.listVoiceMessages({ status: status || undefined, search: search || undefined, limit: PAGE_SIZE, offset });
      setRows(page.data);
      setTotals({ total: page.total_count, recipients: page.recipient_total });
    } catch (loadError) {
      setError(errorText(loadError, t("unknownError")));
    } finally {
      setLoading(false);
    }
  }, [props.client, status, search, offset, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const formatDate = (value: string) => new Date(value).toLocaleString(localeFor(language), { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="arama-gorusme" data-testid="voice-reports">
      <div className="arama-toolbar">
        <form
          className="arama-search voice-search"
          onSubmit={(event) => {
            event.preventDefault();
            setOffset(0);
            setSearch(searchDraft.trim());
          }}
        >
          <Search size={16} aria-hidden="true" />
          <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} data-testid="voice-search" />
        </form>
        <select
          value={status}
          aria-label={t("colStatus")}
          onChange={(event) => {
            setOffset(0);
            setStatus(event.target.value as VoiceMessageStatus | "");
          }}
          data-testid="voice-status-filter"
        >
          <option value="">{t("statusAll")}</option>
          {statuses.map((value) => (
            <option key={value} value={value}>
              {t(`status_${value}`)}
            </option>
          ))}
        </select>
        <div className="arama-totals">
          <span>
            {t("totalMessages")}: <strong data-testid="voice-total">{totals.total}</strong>
          </span>
          <span>
            {t("totalRecipients")}: <strong>{totals.recipients}</strong>
          </span>
          <button type="button" className="secondary-action icon-only" onClick={() => void load()} aria-label={t("refresh")} title={t("refresh")}>
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      {error && (
        <p className="arama-message arama-message-error" role="alert">
          {t("loadFailed", { error })}
        </p>
      )}
      <div className="arama-table-card">
        <div className="arama-table-scroll">
          <table className="arama-table" data-testid="voice-table">
            <thead>
              <tr>
                <th>{t("colDate")}</th>
                <th>{t("colContent")}</th>
                <th>{t("colRecipients")}</th>
                <th>{t("colStatus")}</th>
                <th>{t("colBulkId")}</th>
                <th>{t("colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="arama-empty">
                    <Loader2 size={24} className="arama-spin" aria-hidden="true" />
                    {t("loading")}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="arama-empty">
                    <MessageSquare size={24} aria-hidden="true" />
                    {t("noRecords")}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.public_id} data-testid="voice-row">
                    <td>{formatDate(row.created_at)}</td>
                    <td className="voice-content-cell">{row.message ?? t("audioContent", { id: row.audio_id ?? "-" })}</td>
                    <td>{row.recipient_count}</td>
                    <td>
                      <span className={`voice-status voice-status-${row.status}`}>{t(`status_${row.status}`)}</span>
                    </td>
                    <td>{row.bulk_id ?? "-"}</td>
                    <td>
                      <button type="button" className="link-button" onClick={() => setSelected(row.public_id)} data-testid="voice-details">
                        {t("details")}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {totals.total > PAGE_SIZE && (
        <div className="voice-pager">
          <button type="button" className="secondary-action" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            {t("previous")}
          </button>
          <span className="arama-muted">{t("pageInfo", { from: offset + 1, to: Math.min(offset + PAGE_SIZE, totals.total), total: totals.total })}</span>
          <button type="button" className="secondary-action" disabled={offset + PAGE_SIZE >= totals.total} onClick={() => setOffset(offset + PAGE_SIZE)}>
            {t("next")}
          </button>
        </div>
      )}
      {selected && (
        <VoiceMessageDetail
          client={props.client}
          publicId={selected}
          onClose={() => {
            setSelected(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function callStatusKey(status: string): `call_${CallStatus}` {
  return `call_${(callStatuses as readonly string[]).includes(status) ? (status as CallStatus) : "araniyor"}`;
}

function VoiceMessageDetail(props: { client: VoiceClient; publicId: string; onClose: () => void }) {
  const t = useT(voiceMessagesMessages);
  const { language } = useLanguage();
  const [row, setRow] = useState<VoiceMessage | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const { client, publicId } = props;

  const load = useCallback(async () => {
    try {
      setRow((await client.getVoiceMessage(publicId)).voice_message);
    } catch (error) {
      setNotice({ tone: "error", text: t("loadFailed", { error: errorText(error, t("unknownError")) }) });
    }
  }, [client, publicId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function requestReport() {
    setBusy(true);
    setNotice(null);
    try {
      setRow((await client.requestVoiceMessageReport(publicId, newKey("report"))).voice_message);
      setNotice({ tone: "ok", text: t("reportQueued") });
    } catch (error) {
      setNotice({ tone: "error", text: errorText(error, t("unknownError")) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stok-modal-backdrop" role="presentation" onClick={props.onClose}>
      <div className="stok-modal wide voice-detail" role="dialog" aria-modal="true" aria-label={t("detailTitle")} onClick={(event) => event.stopPropagation()} data-testid="voice-detail">
        <div className="voice-page-head">
          <h2>{t("detailTitle")}</h2>
          <button type="button" className="secondary-action icon-only" onClick={props.onClose} aria-label={t("close")} title={t("close")}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {!row ? (
          <p className="arama-muted">{t("loading")}</p>
        ) : (
          <>
            <dl className="voice-detail-fields">
              <dt>{t("colStatus")}</dt>
              <dd>
                <span className={`voice-status voice-status-${row.status}`} data-testid="voice-detail-status">
                  {t(`status_${row.status}`)}
                </span>
              </dd>
              <dt>{t("colBulkId")}</dt>
              <dd data-testid="voice-detail-bulk">{row.bulk_id ?? "-"}</dd>
              <dt>{t("colContent")}</dt>
              <dd>{row.message ?? t("audioContent", { id: row.audio_id ?? "-" })}</dd>
              <dt>{t("ringtimeLabel")}</dt>
              <dd>{t("seconds", { count: row.ringtime })}</dd>
              <dt>{t("colRecipients")}</dt>
              <dd>{row.recipients.join(", ")}</dd>
            </dl>
            {row.error_message && <p className="arama-message arama-message-error">{row.error_message}</p>}
            <div className="voice-actions">
              <button type="button" className="primary-action" disabled={busy || !row.bulk_id} onClick={() => void requestReport()} data-testid="voice-request-report">
                {t("requestReport")}
              </button>
              <button type="button" className="secondary-action" onClick={() => void load()} data-testid="voice-detail-refresh">
                <RefreshCw size={14} aria-hidden="true" />
                {t("refresh")}
              </button>
            </div>
            {!row.bulk_id && <p className="arama-muted">{t("reportUnavailable")}</p>}
            {notice && (
              <p className={`arama-message ${notice.tone === "ok" ? "arama-message-ok" : "arama-message-error"}`} role="status">
                {notice.text}
              </p>
            )}
            <h3>{t("reportTitle")}</h3>
            {row.report_checked_at && <p className="arama-muted">{t("reportCheckedAt", { date: new Date(row.report_checked_at).toLocaleString(localeFor(language)) })}</p>}
            {!row.report || row.report.rows.length === 0 ? (
              <p className="arama-muted">{row.report?.message ?? t("reportPending")}</p>
            ) : (
              <div className="arama-table-scroll">
                <table className="arama-table" data-testid="voice-report-table">
                  <thead>
                    <tr>
                      <th>{t("colPhone")}</th>
                      <th>{t("colCallStatus")}</th>
                      <th>{t("colPressedKey")}</th>
                      <th>{t("colListen")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.report.rows.map((entry, index) => (
                      <tr key={`${entry.phone}_${index}`}>
                        <td>{entry.phone}</td>
                        <td>{t(callStatusKey(entry.status))}</td>
                        <td>{entry.pressed_key ?? "-"}</td>
                        <td>{entry.listen_seconds}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function RehberPage(props: { http: BackendHttpClient }) {
  const client = useMemo(() => createVoiceClient(props.http), [props.http]);
  const t = useT(voiceMessagesMessages);
  const [kind, setKind] = useState<PhonebookEntry["kind"] | "">("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<PhonebookEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 50;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    client
      .listPhonebook({ kind: kind || undefined, search: search || undefined, limit: pageSize, offset })
      .then((page) => {
        if (cancelled) return;
        setRows(page.data);
        setTotal(page.total_count);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(errorText(loadError, t("unknownError")));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, kind, search, offset, t]);

  return (
    <section className="arama-page voice-page" data-testid="phonebook-page">
      <div className="voice-page-head">
        <div>
          <h1>{t("phonebookTitle")}</h1>
          <p className="arama-muted">{t("phonebookSubtitle")}</p>
        </div>
        <Link to="/sesli-asistan/sesli-mesajlar" className="secondary-action voice-link" data-testid="open-voice-messages">
          <MessageSquare size={16} aria-hidden="true" />
          {t("openVoiceMessages")}
        </Link>
      </div>
      <div className="arama-toolbar">
        <form
          className="arama-search voice-search"
          onSubmit={(event) => {
            event.preventDefault();
            setOffset(0);
            setSearch(searchDraft.trim());
          }}
        >
          <Search size={16} aria-hidden="true" />
          <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={t("phonebookSearch")} aria-label={t("phonebookSearch")} data-testid="phonebook-search" />
        </form>
        <select
          value={kind}
          aria-label={t("colKind")}
          onChange={(event) => {
            setOffset(0);
            setKind(event.target.value as PhonebookEntry["kind"] | "");
          }}
          data-testid="phonebook-kind"
        >
          <option value="">{t("kindAll")}</option>
          <option value="customer">{t("kind_customer")}</option>
          <option value="staff">{t("kind_staff")}</option>
        </select>
        <span className="arama-totals">
          <strong data-testid="phonebook-total">{total}</strong>
        </span>
      </div>
      {error && (
        <p className="arama-message arama-message-error" role="alert">
          {t("loadFailed", { error })}
        </p>
      )}
      <div className="arama-table-card">
        <div className="arama-table-scroll">
          <table className="arama-table" data-testid="phonebook-table">
            <thead>
              <tr>
                <th>{t("colName")}</th>
                <th>{t("colKind")}</th>
                <th>{t("colPhone")}</th>
                <th>{t("colExtension")}</th>
                <th>{t("colRole")}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="arama-empty">
                    {t("loading")}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="arama-empty">
                    {t("noRecords")}
                  </td>
                </tr>
              ) : (
                rows.map((entry) => (
                  <tr key={`${entry.kind}_${entry.public_id}`} data-testid="phonebook-row">
                    <td className="arama-strong">{entry.name}</td>
                    <td>
                      <span className={`voice-kind voice-kind-${entry.kind}`}>{t(`kind_${entry.kind}`)}</span>
                    </td>
                    <td>
                      {entry.phone ?? "-"} <ClickToCall number={entry.phone} />
                    </td>
                    <td>
                      {entry.extension ?? "-"} {entry.kind === "staff" && <ClickToCall number={entry.extension} />}
                    </td>
                    <td>{entry.role ?? "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {total > pageSize && (
        <div className="voice-pager">
          <button type="button" className="secondary-action" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>
            {t("previous")}
          </button>
          <span className="arama-muted">{t("pageInfo", { from: offset + 1, to: Math.min(offset + pageSize, total), total })}</span>
          <button type="button" className="secondary-action" disabled={offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)}>
            {t("next")}
          </button>
        </div>
      )}
    </section>
  );
}
