import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, Search, Trash2, X } from "lucide-react";
import { createDomainClient, type OrderSummary } from "../../api/domain-client.js";
import { BackendRequestError, type BackendHttpClient } from "../../api/http-client.js";
import { createOrderActionsClient, newIdempotencyKey, type OrderActionState } from "../../api/order-actions-client.js";
import { formatMoney, orderStatusLabel } from "../app/shared.js";
import { localeFor, useLanguage, useT } from "../i18n/index.js";
import { cancellationsMessages } from "../i18n/messages/cancellations.js";

/**
 * Legacy parity: garanti-kulucka/frontend/src/pages/siparisler/IptallerPage.jsx — iptal + iade orders
 * (newest update first), status filter, search, detail, "geri al" (back to Oluşturuldu), "kalıcı sil"
 * (an invoiced order's KolayBi e-document cancellation is queued by the API) and inline notes.
 */

const PAGE_SIZE = 25;
type Filter = "cancellations" | "cancelled" | "returned";
type Notice = { tone: "ok" | "error"; text: string } | null;

function errorText(error: unknown) {
  if (error instanceof BackendRequestError) {
    const body = error.body as { error?: { message?: unknown } } | null | undefined;
    if (typeof body?.error?.message === "string" && body.error.message) return body.error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function IptallerListesi(props: { http: BackendHttpClient; onChanged?: () => void }) {
  const t = useT(cancellationsMessages);
  const { language } = useLanguage();
  const domain = useMemo(() => createDomainClient(props.http), [props.http]);
  const actions = useMemo(() => createOrderActionsClient(props.http), [props.http]);
  const [filter, setFilter] = useState<Filter>("cancellations");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<OrderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderActionState | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await domain.listOrders({ status: filter, ...(search ? { search } : {}), sort_by: "updated_at", sort_direction: "desc", limit: PAGE_SIZE, offset });
      setRows(page.data);
      setTotal(page.meta?.total_count ?? page.data.length);
    } catch (loadError) {
      setError(errorText(loadError));
    } finally {
      setLoading(false);
    }
  }, [domain, filter, search, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  // Legacy debounced search: 400 ms after typing stops.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOffset(0);
      setSearch(searchDraft.trim());
    }, 400);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const formatDate = (value: string) => new Date(value).toLocaleString(localeFor(language), { dateStyle: "medium", timeStyle: "short" });

  const removeRow = (publicId: string) => {
    setRows((current) => current.filter((row) => row.public_id !== publicId));
    setTotal((current) => Math.max(0, current - 1));
    setDetail((current) => (current?.public_id === publicId ? null : current));
    props.onChanged?.();
  };

  async function restore(order: { public_id: string; order_number: string }) {
    if (busy || !window.confirm(t("confirmRestore", { orderNumber: order.order_number }))) return;
    setBusy(order.public_id);
    setNotice(null);
    try {
      await actions.restore(order.public_id);
      removeRow(order.public_id);
      setNotice({ tone: "ok", text: t("restored") });
    } catch (actionError) {
      setNotice({ tone: "error", text: t("actionFailed", { error: errorText(actionError) }) });
    } finally {
      setBusy(null);
    }
  }

  async function remove(order: { public_id: string; order_number: string }) {
    if (busy) return;
    setBusy(order.public_id);
    setNotice(null);
    try {
      // The legacy confirmation names the KolayBi invoice, so read the order's invoice state first.
      const state = detail?.public_id === order.public_id ? detail : (await actions.getActions(order.public_id)).order;
      const invoiced = Boolean(state.kolaybi.invoice_id);
      if (!window.confirm(t(invoiced ? "confirmDeleteInvoiced" : "confirmDelete", { orderNumber: order.order_number }))) return;
      const result = await actions.remove(order.public_id, newIdempotencyKey("iptal_sil"));
      removeRow(order.public_id);
      setNotice({ tone: "ok", text: result.e_document_cancel ? t("deletedWithInvoice") : t("deleted") });
    } catch (actionError) {
      setNotice({ tone: "error", text: t("actionFailed", { error: errorText(actionError) }) });
    } finally {
      setBusy(null);
    }
  }

  async function saveNote(order: OrderSummary) {
    const draft = noteDrafts[order.public_id];
    if (draft === undefined || busy) return;
    setBusy(order.public_id);
    try {
      const result = await actions.updateNotes(order.public_id, draft.trim() ? draft : null);
      setRows((current) => current.map((row) => (row.public_id === order.public_id ? { ...row, notes: result.order.notes } : row)));
      setNoteDrafts(({ [order.public_id]: _saved, ...rest }) => rest);
      setNotice({ tone: "ok", text: t("noteSaved") });
    } catch (actionError) {
      setNotice({ tone: "error", text: t("actionFailed", { error: errorText(actionError) }) });
    } finally {
      setBusy(null);
    }
  }

  async function openDetail(order: OrderSummary) {
    setNotice(null);
    try {
      setDetail((await actions.getActions(order.public_id)).order);
    } catch (actionError) {
      setNotice({ tone: "error", text: t("actionFailed", { error: errorText(actionError) }) });
    }
  }

  return (
    <section className="detail-panel iptal-list" data-testid="cancellations-list">
      <h2>{t("listTitle")}</h2>
      <div className="iptal-toolbar">
        <div className="iptal-filters" role="group" aria-label={t("colStatus")}>
          {(
            [
              ["cancellations", t("filterAll")],
              ["cancelled", t("filterCancelled")],
              ["returned", t("filterReturned")],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filter === value ? "secondary-action selected" : "secondary-action"}
              aria-pressed={filter === value}
              onClick={() => {
                setOffset(0);
                setFilter(value);
              }}
              data-testid={`iptal-filter-${value}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="iptal-search">
          <Search size={16} aria-hidden="true" />
          <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} data-testid="iptal-search" />
        </label>
        <span className="muted-line" data-testid="iptal-total">
          {t("totalCount", { count: total })}
        </span>
      </div>
      {notice && (
        <p className={`customer-detail-notice ${notice.tone === "ok" ? "success" : "error"}`} role={notice.tone === "ok" ? "status" : "alert"} data-testid="iptal-notice">
          {notice.text}
        </p>
      )}
      {error && (
        <p className="customer-detail-notice error" role="alert">
          {t("loadFailed", { error })}
        </p>
      )}
      <div className="iptal-table-scroll">
        <table className="iptal-table" data-testid="iptal-table">
          <thead>
            <tr>
              <th>{t("colOrder")}</th>
              <th>{t("colCustomer")}</th>
              <th>{t("colAmount")}</th>
              <th>{t("colStatus")}</th>
              <th>{t("colUpdated")}</th>
              <th>{t("colNote")}</th>
              <th>{t("colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="iptal-empty">
                  <Loader2 size={18} className="arama-spin" aria-hidden="true" /> {t("loading")}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="iptal-empty">
                  {t("noRecords")}
                </td>
              </tr>
            ) : (
              rows.map((order) => {
                const noteDraft = noteDrafts[order.public_id];
                return (
                  <tr key={order.public_id} data-testid="iptal-row">
                    <td>
                      <button type="button" className="link-button" onClick={() => void openDetail(order)} data-testid="iptal-details">
                        {order.order_number}
                      </button>
                    </td>
                    <td>{order.customer_full_name ?? "-"}</td>
                    <td>{formatMoney(Number(order.total_amount), order.currency)}</td>
                    <td>
                      <span className={`status-pill iptal-status-${order.status}`}>{orderStatusLabel(order.status, language)}</span>
                    </td>
                    <td>{formatDate(order.updated_at)}</td>
                    <td className="iptal-note-cell">
                      <input
                        value={noteDraft ?? order.notes ?? ""}
                        placeholder={t("notePlaceholder")}
                        aria-label={`${t("colNote")}: ${order.order_number}`}
                        onChange={(event) => setNoteDrafts((current) => ({ ...current, [order.public_id]: event.target.value }))}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void saveNote(order);
                        }}
                        data-testid="iptal-note"
                      />
                      {noteDraft !== undefined && noteDraft !== (order.notes ?? "") && (
                        <button type="button" className="secondary-action" disabled={busy !== null} onClick={() => void saveNote(order)} data-testid="iptal-note-save">
                          {t("saveNote")}
                        </button>
                      )}
                    </td>
                    <td>
                      <div className="iptal-actions">
                        <button
                          type="button"
                          className="secondary-action"
                          disabled={busy !== null}
                          onClick={() => void restore(order)}
                          data-testid="iptal-restore"
                        >
                          <RotateCcw size={14} aria-hidden="true" /> {t("restore")}
                        </button>
                        <button
                          type="button"
                          className="secondary-action danger"
                          disabled={busy !== null}
                          onClick={() => void remove(order)}
                          data-testid="iptal-delete"
                        >
                          <Trash2 size={14} aria-hidden="true" /> {t("deletePermanently")}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {total > PAGE_SIZE && (
        <div className="iptal-pager">
          <button type="button" className="secondary-action" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            {t("previous")}
          </button>
          <span className="muted-line">{t("pageInfo", { from: offset + 1, to: Math.min(offset + PAGE_SIZE, total), total })}</span>
          <button type="button" className="secondary-action" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
            {t("next")}
          </button>
        </div>
      )}
      {detail && (
        <div className="stok-modal-backdrop" role="presentation" onClick={() => setDetail(null)}>
          <div className="stok-modal iptal-detail" role="dialog" aria-modal="true" aria-label={t("detailTitle", { orderNumber: detail.order_number })} onClick={(event) => event.stopPropagation()} data-testid="iptal-detail">
            <header>
              <h2>{t("detailTitle", { orderNumber: detail.order_number })}</h2>
              <button type="button" className="secondary-action icon-only" onClick={() => setDetail(null)} aria-label={t("close")} title={t("close")}>
                <X size={16} aria-hidden="true" />
              </button>
            </header>
            <dl className="voice-detail-fields iptal-detail-fields">
              <dt>{t("colStatus")}</dt>
              <dd>{orderStatusLabel(detail.status, language)}</dd>
              <dt>{t("colCustomer")}</dt>
              <dd>{detail.customer_full_name ?? "-"}</dd>
              <dt>{t("phone")}</dt>
              <dd>{detail.customer_phone ?? "-"}</dd>
              <dt>{t("colAmount")}</dt>
              <dd>{formatMoney(Number(detail.total_amount), detail.currency)}</dd>
              <dt>{t("confirmation")}</dt>
              <dd>{detail.confirmation_status ?? "-"}</dd>
              <dt>{t("kolaybiInvoice")}</dt>
              <dd data-testid="iptal-detail-invoice">{detail.kolaybi.invoice_id ?? "-"}</dd>
              <dt>{t("eDocument")}</dt>
              <dd>{detail.kolaybi.e_document_status ?? "-"}</dd>
              <dt>{t("colNote")}</dt>
              <dd>{detail.notes ?? "-"}</dd>
              <dt>{t("created")}</dt>
              <dd>{formatDate(detail.created_at)}</dd>
            </dl>
            <footer>
              <button type="button" className="secondary-action" disabled={busy !== null} onClick={() => void restore(detail)} data-testid="iptal-detail-restore">
                <RotateCcw size={14} aria-hidden="true" /> {t("restore")}
              </button>
              <button type="button" className="secondary-action danger" disabled={busy !== null} onClick={() => void remove(detail)} data-testid="iptal-detail-delete">
                <Trash2 size={14} aria-hidden="true" /> {t("deletePermanently")}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
