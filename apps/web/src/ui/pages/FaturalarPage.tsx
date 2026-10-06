import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Ban, Eye, FileDown, FileText, Plus, Printer, Search, Trash2, Wallet } from "lucide-react";
import {
  createAccountingClient,
  type AccountingClient,
  type AccountingContact,
  type Invoice,
  type InvoiceDetail,
  type InvoiceListResponse,
  type InvoiceStatus,
  type PaymentMethod,
} from "../../api/accounting-client.js";
import type { BackendHttpClient } from "../../api/http-client.js";
import {
  InvoiceStatusPill,
  KolaybiSyncPanel,
  Modal,
  Notice,
  Pager,
  SyncPill,
  accountingPageSize,
  errorText,
  newIdempotencyKey,
  paymentMethodKeys,
  todayIso,
  useAccountingT,
  useDate,
  useMoney,
} from "./MuhasebeShared.js";

/**
 * Legacy muhasebe/FaturaListPage + FaturaOlusturPage: invoice list with filters, create form, HTML/PDF
 * view + print, tahsilat and cancel. Invoices are stored by the backend; KolayBi sync is a queued job.
 */

type Notice = { tone: "success" | "error"; text: string } | null;
type StatusFilter = InvoiceStatus | "open" | "all";

interface Filters {
  search: string;
  status: StatusFilter;
  from: string;
  to: string;
}

const emptyFilters: Filters = { search: "", status: "all", from: "", to: "" };

/** Opens a blob in a new tab (print view / PDF). Popup blockers fall back to a download link. */
function openBlob(blob: Blob, filename: string, print: boolean) {
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, "_blank");
  if (opened) {
    if (print) opened.addEventListener("load", () => opened.print(), { once: true });
  } else {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function FaturalarPage({ http }: { http: BackendHttpClient }) {
  const t = useAccountingT();
  const money = useMoney();
  const formatDate = useDate();
  const client = useMemo(() => createAccountingClient(http), [http]);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [searchDraft, setSearchDraft] = useState("");
  const [page, setPage] = useState(0);
  const [list, setList] = useState<InvoiceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [collecting, setCollecting] = useState<InvoiceDetail | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.listInvoices({
        search: filters.search || undefined,
        status: filters.status === "all" ? undefined : filters.status,
        issued_from: filters.from || undefined,
        issued_to: filters.to || undefined,
        limit: accountingPageSize,
        offset: page * accountingPageSize,
      });
      setList(response);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [client, filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateFilters = (patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(0);
  };

  async function openDetail(invoice: Invoice) {
    try {
      setDetail(await client.getInvoice(invoice.public_id));
    } catch (error) {
      setNotice({ tone: "error", text: t("error", { message: errorText(error) }) });
    }
  }

  async function showDocument(invoice: Pick<Invoice, "public_id" | "invoice_number">, format: "html" | "pdf", print = false) {
    try {
      const blob = await client.downloadDocument(invoice.public_id, format);
      openBlob(blob, `fatura-${invoice.invoice_number}.${format}`, print);
    } catch (error) {
      setNotice({ tone: "error", text: t("error", { message: errorText(error) }) });
    }
  }

  async function cancel(invoice: InvoiceDetail) {
    if (!window.confirm(t("cancelConfirm", { number: invoice.invoice_number }))) return;
    try {
      setDetail(await client.cancelInvoice(invoice.public_id));
      setNotice({ tone: "success", text: t("invoiceCancelled") });
      void load();
    } catch (error) {
      setNotice({ tone: "error", text: t("error", { message: errorText(error) }) });
    }
  }

  const rows = list?.data ?? [];

  return (
    <section className="flow-panel acct-page" data-testid="invoices-page">
      <header className="acct-header">
        <div>
          <h1>
            <FileText size={18} aria-hidden="true" /> {t("invoicesTitle")}
          </h1>
          <p className="muted-line">{t("invoicesSubtitle")}</p>
        </div>
        <button type="button" className="primary-action" onClick={() => setCreating(true)} data-testid="invoice-new">
          <Plus size={16} aria-hidden="true" /> {t("newInvoice")}
        </button>
      </header>

      <Notice notice={notice} onClose={() => setNotice(null)} />
      <KolaybiSyncPanel client={client} onSynced={() => void load()} />

      <form
        className="acct-filters"
        onSubmit={(event) => {
          event.preventDefault();
          updateFilters({ search: searchDraft.trim() });
        }}
        data-testid="invoice-filters"
      >
        <label className="acct-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={searchDraft}
            placeholder={t("invoiceSearchPlaceholder")}
            aria-label={t("search")}
            onChange={(event) => setSearchDraft(event.target.value)}
            data-testid="invoice-search"
          />
        </label>
        <label>
          <span className="field-label">{t("status")}</span>
          <select value={filters.status} onChange={(event) => updateFilters({ status: event.target.value as StatusFilter })} data-testid="invoice-status-filter">
            <option value="all">{t("all")}</option>
            <option value="open">{t("statusOpen")}</option>
            <option value="issued">{t("statusIssued")}</option>
            <option value="partially_paid">{t("statusPartiallyPaid")}</option>
            <option value="paid">{t("statusPaid")}</option>
            <option value="cancelled">{t("statusCancelled")}</option>
          </select>
        </label>
        <label>
          <span className="field-label">{t("dateFrom")}</span>
          <input type="date" value={filters.from} onChange={(event) => updateFilters({ from: event.target.value })} data-testid="invoice-from" />
        </label>
        <label>
          <span className="field-label">{t("dateTo")}</span>
          <input type="date" value={filters.to} onChange={(event) => updateFilters({ to: event.target.value })} data-testid="invoice-to" />
        </label>
        <div className="acct-filter-actions">
          <button type="submit" className="secondary-action">
            {t("search")}
          </button>
          <button
            type="button"
            className="secondary-action"
            onClick={() => {
              setSearchDraft("");
              updateFilters(emptyFilters);
            }}
          >
            {t("clearFilters")}
          </button>
        </div>
      </form>

      {list && (
        <div className="report-grid" data-testid="invoice-totals">
          <div className="metric">
            <span>{t("totalInvoiced")}</span>
            <strong>{money(list.totals.grand_total)}</strong>
          </div>
          <div className="metric">
            <span>{t("totalPaid")}</span>
            <strong>{money(list.totals.paid_total)}</strong>
          </div>
          <div className="metric">
            <span>{t("totalOpen")}</span>
            <strong data-testid="invoice-open-total">{money(list.totals.open_total)}</strong>
          </div>
        </div>
      )}

      {loadError && (
        <p className="acct-notice error" role="alert">
          {t("loadFailed", { message: loadError })}
        </p>
      )}
      {loading && !list && <p className="muted-line">{t("loading")}</p>}
      {list && rows.length === 0 && <p className="acct-empty">{t("empty")}</p>}

      {rows.length > 0 && (
        <div className="acct-list" data-testid="invoice-list" aria-busy={loading}>
          <div className="acct-row acct-row-head" aria-hidden="true">
            <span>{t("invoiceNumber")}</span>
            <span>{t("account")}</span>
            <span>{t("issueDate")}</span>
            <span className="num">{t("amount")}</span>
            <span className="num">{t("openAmount")}</span>
            <span>{t("status")}</span>
            <span>{t("sync")}</span>
            <span>{t("actions")}</span>
          </div>
          {rows.map((invoice) => (
            <article className="acct-row" key={invoice.public_id} data-testid="invoice-row">
              <span className="acct-strong">{invoice.invoice_number}</span>
              <span>{invoice.contact.name}</span>
              <span>{formatDate(invoice.issue_date)}</span>
              <span className="num">{money(invoice.grand_total, invoice.currency)}</span>
              <span className="num">{money(invoice.open_amount, invoice.currency)}</span>
              <span>
                <InvoiceStatusPill status={invoice.status} />
              </span>
              <span>
                <SyncPill status={invoice.sync.status} error={invoice.sync.error} />
              </span>
              <span className="acct-row-actions">
                <button type="button" className="acct-icon-button" onClick={() => void openDetail(invoice)} aria-label={`${t("view")} ${invoice.invoice_number}`} data-testid="invoice-view">
                  <Eye size={16} aria-hidden="true" />
                </button>
                <button type="button" className="acct-icon-button" onClick={() => void showDocument(invoice, "html", true)} aria-label={`${t("print")} ${invoice.invoice_number}`} data-testid="invoice-print">
                  <Printer size={16} aria-hidden="true" />
                </button>
                <button type="button" className="acct-icon-button" onClick={() => void showDocument(invoice, "pdf")} aria-label={`${t("pdf")} ${invoice.invoice_number}`} data-testid="invoice-pdf">
                  <FileDown size={16} aria-hidden="true" />
                </button>
              </span>
            </article>
          ))}
        </div>
      )}
      <Pager page={page} total={list?.meta.total_count ?? 0} onPage={setPage} />

      {creating && (
        <InvoiceCreateModal
          client={client}
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            setNotice({ tone: "success", text: t("invoiceCreated", { number: created.invoice_number }) });
            setDetail(created);
            void load();
          }}
        />
      )}

      {detail && (
        <Modal title={detail.invoice_number} onClose={() => setDetail(null)} wide testId="invoice-detail">
          <div className="acct-detail-head">
            <InvoiceStatusPill status={detail.status} />
            <SyncPill status={detail.sync.status} error={detail.sync.error} />
            <span className="muted-line">
              {formatDate(detail.issue_date)}
              {detail.due_date ? ` · ${t("dueDate")}: ${formatDate(detail.due_date)}` : ""}
            </span>
          </div>
          <p className="acct-strong">{detail.contact.name}</p>
          <div className="acct-lines">
            {detail.items.map((item) => (
              <div className="acct-line" key={item.public_id}>
                <span>{item.description}</span>
                <span className="num">
                  {Number(item.quantity).toLocaleString()} × {money(item.unit_price, detail.currency)} · %{Number(item.vat_rate)}
                </span>
                <span className="num acct-strong">{money(item.line_total, detail.currency)}</span>
              </div>
            ))}
          </div>
          <dl className="acct-totals">
            <dt>{t("subtotal")}</dt>
            <dd>{money(detail.subtotal, detail.currency)}</dd>
            <dt>{t("vat")}</dt>
            <dd>{money(detail.vat_total, detail.currency)}</dd>
            <dt className="acct-strong">{t("grandTotal")}</dt>
            <dd className="acct-strong" data-testid="invoice-detail-total">
              {money(detail.grand_total, detail.currency)}
            </dd>
            <dt>{t("totalPaid")}</dt>
            <dd>{money(detail.paid_total, detail.currency)}</dd>
            <dt>{t("openAmount")}</dt>
            <dd data-testid="invoice-detail-open">{money(detail.open_amount, detail.currency)}</dd>
          </dl>
          <h3>{t("payments")}</h3>
          {detail.payments.length === 0 ? (
            <p className="muted-line">{t("noPayments")}</p>
          ) : (
            <ul className="acct-payments" data-testid="invoice-payments">
              {detail.payments.map((payment) => (
                <li key={payment.public_id}>
                  <span>{new Date(payment.paid_at).toLocaleDateString()}</span>
                  <span>{t(paymentMethodKeys[payment.method])}</span>
                  <span className="num acct-strong">{money(payment.amount, detail.currency)}</span>
                  <SyncPill status={payment.sync.status} error={payment.sync.error} />
                </li>
              ))}
            </ul>
          )}
          <div className="acct-modal-actions">
            <button type="button" className="secondary-action" onClick={() => void showDocument(detail, "html", true)}>
              <Printer size={16} aria-hidden="true" /> {t("print")}
            </button>
            <button type="button" className="secondary-action" onClick={() => void showDocument(detail, "pdf")}>
              <FileDown size={16} aria-hidden="true" /> {t("pdf")}
            </button>
            {detail.status !== "cancelled" && Number(detail.open_amount) > 0 && (
              <button type="button" className="primary-action" onClick={() => setCollecting(detail)} data-testid="invoice-collect">
                <Wallet size={16} aria-hidden="true" /> {t("collect")}
              </button>
            )}
            {detail.status !== "cancelled" && Number(detail.paid_total) === 0 && (
              <button type="button" className="secondary-action acct-danger" onClick={() => void cancel(detail)} data-testid="invoice-cancel">
                <Ban size={16} aria-hidden="true" /> {t("cancelInvoice")}
              </button>
            )}
          </div>
        </Modal>
      )}

      {collecting && (
        <PaymentModal
          client={client}
          invoice={collecting}
          onClose={() => setCollecting(null)}
          onRecorded={(updated) => {
            setCollecting(null);
            setDetail(updated);
            setNotice({ tone: "success", text: t("paymentRecorded") });
            void load();
          }}
        />
      )}
    </section>
  );
}

interface DraftLine {
  key: number;
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
}

function parseDecimal(value: string) {
  const normalized = value.trim().replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return normalized && Number.isFinite(parsed) ? parsed : NaN;
}

/** Same rounding as the backend (VAT per line on kuruş). */
function draftLineTotals(line: DraftLine) {
  const quantity = parseDecimal(line.quantity);
  const price = parseDecimal(line.unitPrice);
  const rate = parseDecimal(line.vatRate);
  if (!(quantity > 0) || !(price >= 0) || !(rate >= 0)) return null;
  const subtotal = Math.round(Math.round(price * 100) * quantity);
  const vat = Math.round((subtotal * rate) / 100);
  return { subtotal, vat, total: subtotal + vat };
}

function InvoiceCreateModal(props: { client: AccountingClient; onClose: () => void; onCreated: (invoice: InvoiceDetail) => void }) {
  const t = useAccountingT();
  const money = useMoney();
  const [contacts, setContacts] = useState<AccountingContact[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [contactId, setContactId] = useState("");
  const [issueDate, setIssueDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ key: 1, description: "", quantity: "1", unitPrice: "", vatRate: "20" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => newIdempotencyKey("invoice"));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      props.client
        .listContacts({ search: contactSearch.trim() || undefined, limit: 50 })
        .then((response) => setContacts(response.data))
        .catch((reason: unknown) => setError(errorText(reason)));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [contactSearch, props.client]);

  const totals = lines.reduce(
    (sum, line) => {
      const amounts = draftLineTotals(line);
      return amounts ? { subtotal: sum.subtotal + amounts.subtotal, vat: sum.vat + amounts.vat } : sum;
    },
    { subtotal: 0, vat: 0 },
  );

  const updateLine = (key: number, patch: Partial<DraftLine>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!contactId) {
      setError(t("accountRequired"));
      return;
    }
    const items = lines
      .filter((line) => line.description.trim())
      .map((line) => ({ line, amounts: draftLineTotals(line) }))
      .filter((entry) => entry.amounts !== null)
      .map(({ line }) => ({
        description: line.description.trim(),
        quantity: parseDecimal(line.quantity),
        unit_price: parseDecimal(line.unitPrice).toFixed(2),
        vat_rate: parseDecimal(line.vatRate),
      }));
    if (items.length === 0) {
      setError(t("itemsRequired"));
      return;
    }
    setSaving(true);
    try {
      const created = await props.client.createInvoice({
        idempotency_key: idempotencyKey,
        contact_public_id: contactId,
        issue_date: issueDate,
        due_date: dueDate || null,
        description: description.trim() || null,
        items,
      });
      props.onCreated(created);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={t("newInvoice")} onClose={props.onClose} wide testId="invoice-create">
      <form className="acct-form" onSubmit={submit}>
        <div className="acct-form-grid">
          <label>
            <span className="field-label">{t("search")}</span>
            <input type="search" value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder={t("accountSearchPlaceholder")} />
          </label>
          <label>
            <span className="field-label">{t("account")}</span>
            <select value={contactId} onChange={(event) => setContactId(event.target.value)} required data-testid="invoice-contact">
              <option value="">{t("chooseAccount")}</option>
              {contacts.map((contact) => (
                <option key={contact.public_id} value={contact.public_id}>
                  {contact.name}
                  {contact.tax_number ? ` (${contact.tax_number})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">{t("issueDate")}</span>
            <input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} required />
          </label>
          <label>
            <span className="field-label">{t("dueDate")}</span>
            <input type="date" value={dueDate} min={issueDate} onChange={(event) => setDueDate(event.target.value)} />
          </label>
        </div>

        <fieldset className="acct-items">
          <legend>{t("items")}</legend>
          {lines.map((line, index) => {
            const amounts = draftLineTotals(line);
            return (
              <div className="acct-item" key={line.key} data-testid="invoice-item">
                <label className="acct-item-desc">
                  <span className="field-label">{t("description")}</span>
                  <input value={line.description} onChange={(event) => updateLine(line.key, { description: event.target.value })} name={`item-${index}-description`} />
                </label>
                <label>
                  <span className="field-label">{t("quantity")}</span>
                  <input inputMode="decimal" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} name={`item-${index}-quantity`} />
                </label>
                <label>
                  <span className="field-label">{t("unitPrice")}</span>
                  <input inputMode="decimal" value={line.unitPrice} onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })} name={`item-${index}-price`} />
                </label>
                <label>
                  <span className="field-label">{t("vatRate")}</span>
                  <select value={line.vatRate} onChange={(event) => updateLine(line.key, { vatRate: event.target.value })} name={`item-${index}-vat`}>
                    {["0", "1", "10", "20"].map((rate) => (
                      <option key={rate} value={rate}>
                        %{rate}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="acct-item-total">
                  <span className="field-label">{t("lineTotal")}</span>
                  <strong>{amounts ? money(amounts.total / 100) : "-"}</strong>
                </span>
                <button
                  type="button"
                  className="acct-icon-button"
                  aria-label={t("removeItem")}
                  disabled={lines.length === 1}
                  onClick={() => setLines((current) => current.filter((candidate) => candidate.key !== line.key))}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="secondary-action"
            onClick={() => setLines((current) => [...current, { key: Math.max(...current.map((line) => line.key)) + 1, description: "", quantity: "1", unitPrice: "", vatRate: "20" }])}
            data-testid="invoice-add-item"
          >
            <Plus size={16} aria-hidden="true" /> {t("addItem")}
          </button>
        </fieldset>

        <label>
          <span className="field-label">{t("description")}</span>
          <textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>

        <dl className="acct-totals">
          <dt>{t("subtotal")}</dt>
          <dd>{money(totals.subtotal / 100)}</dd>
          <dt>{t("vat")}</dt>
          <dd>{money(totals.vat / 100)}</dd>
          <dt className="acct-strong">{t("grandTotal")}</dt>
          <dd className="acct-strong" data-testid="invoice-draft-total">
            {money((totals.subtotal + totals.vat) / 100)}
          </dd>
        </dl>

        {error && (
          <p className="acct-notice error" role="alert">
            {error}
          </p>
        )}
        <div className="acct-modal-actions">
          <button type="button" className="secondary-action" onClick={props.onClose}>
            {t("cancel")}
          </button>
          <button type="submit" className="primary-action" disabled={saving} data-testid="invoice-save">
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PaymentModal(props: { client: AccountingClient; invoice: InvoiceDetail; onClose: () => void; onRecorded: (invoice: InvoiceDetail) => void }) {
  const t = useAccountingT();
  const money = useMoney();
  const [amount, setAmount] = useState(props.invoice.open_amount);
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [vaultId, setVaultId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => newIdempotencyKey("payment"));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const parsed = parseDecimal(amount);
      const result = await props.client.addPayment(props.invoice.public_id, {
        idempotency_key: idempotencyKey,
        amount: Number.isFinite(parsed) ? parsed.toFixed(2) : amount,
        method,
        vault_id: vaultId.trim() || null,
        notes: notes.trim() || null,
      });
      props.onRecorded(result.invoice);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`${t("collect")} · ${props.invoice.invoice_number}`} onClose={props.onClose} testId="invoice-payment">
      <form className="acct-form" onSubmit={submit}>
        <p className="muted-line">{t("remaining", { amount: money(props.invoice.open_amount, props.invoice.currency) })}</p>
        <label>
          <span className="field-label">{t("paymentAmount")}</span>
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required data-testid="payment-amount" />
        </label>
        <label>
          <span className="field-label">{t("paymentMethod")}</span>
          <select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)} data-testid="payment-method">
            {(Object.keys(paymentMethodKeys) as PaymentMethod[]).map((key) => (
              <option key={key} value={key}>
                {t(paymentMethodKeys[key])}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">{t("vaultId")}</span>
          <input value={vaultId} onChange={(event) => setVaultId(event.target.value)} data-testid="payment-vault" />
          <span className="muted-line">{t("vaultHint")}</span>
        </label>
        <label>
          <span className="field-label">{t("notes")}</span>
          <input value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        {error && (
          <p className="acct-notice error" role="alert" data-testid="payment-error">
            {error}
          </p>
        )}
        <div className="acct-modal-actions">
          <button type="button" className="secondary-action" onClick={props.onClose}>
            {t("cancel")}
          </button>
          <button type="submit" className="primary-action" disabled={saving} data-testid="payment-save">
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
