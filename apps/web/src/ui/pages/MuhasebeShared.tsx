import { useCallback, useEffect, useState, type ReactNode } from "react";
import { UploadCloud, Loader2, RefreshCw, X } from "lucide-react";
import type { AccountingClient, InvoiceStatus, KolaybiSyncStatus, PaymentMethod, SyncStatus } from "../../api/accounting-client.js";
import { BackendRequestError } from "../../api/http-client.js";
import { localeFor, useLanguage, useT, type Translator } from "../i18n/index.js";
import { accountingMessages, type AccountingKey } from "../i18n/messages/accounting.js";

export const accountingPageSize = 20;

export type AccountingT = Translator<AccountingKey>;

export function useAccountingT() {
  return useT(accountingMessages);
}

export function useMoney() {
  const { language } = useLanguage();
  return useCallback(
    (value: string | number, currency = "TRY") =>
      new Intl.NumberFormat(localeFor(language), { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(Number(value)),
    [language],
  );
}

export function useDate() {
  const { language } = useLanguage();
  return useCallback(
    (value: string | null) => {
      if (!value) return "-";
      const [year, month, day] = value.slice(0, 10).split("-").map(Number);
      return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1).toLocaleDateString(localeFor(language));
    },
    [language],
  );
}

export function errorText(error: unknown) {
  if (error instanceof BackendRequestError) {
    const body = error.body as { error?: { message?: string } } | null;
    return body?.error?.message ?? error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function newIdempotencyKey(prefix: string) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${random}`;
}

export function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const invoiceStatusKeys: Record<InvoiceStatus, AccountingKey> = {
  issued: "statusIssued",
  partially_paid: "statusPartiallyPaid",
  paid: "statusPaid",
  cancelled: "statusCancelled",
};

const syncKeys: Record<SyncStatus, AccountingKey> = {
  local: "syncLocal",
  queued: "syncQueued",
  synced: "syncSynced",
  failed: "syncFailed",
};

export const paymentMethodKeys: Record<PaymentMethod, AccountingKey> = {
  cash: "methodCash",
  bank_transfer: "methodBank",
  credit_card: "methodCard",
  other: "methodOther",
};

export function InvoiceStatusPill({ status }: { status: InvoiceStatus }) {
  const t = useAccountingT();
  return <span className={`acct-pill acct-status-${status}`}>{t(invoiceStatusKeys[status])}</span>;
}

export function SyncPill({ status, error }: { status: SyncStatus; error: string | null }) {
  const t = useAccountingT();
  return (
    <span className={`acct-pill acct-sync-${status}`} title={error ?? undefined} data-testid="acct-sync-pill">
      {t(syncKeys[status])}
    </span>
  );
}

export function Notice({ notice, onClose }: { notice: { tone: "success" | "error"; text: string } | null; onClose: () => void }) {
  if (!notice) return null;
  return (
    <div className={`acct-notice ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"} data-testid="acct-notice">
      <span>{notice.text}</span>
      <button type="button" className="acct-icon-button" onClick={onClose} aria-label="×">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; testId: string }) {
  const t = useAccountingT();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);
  return (
    <div className="acct-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <section className={`acct-modal${props.wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={props.title} data-testid={props.testId}>
        <header className="acct-modal-header">
          <h2>{props.title}</h2>
          <button type="button" className="acct-icon-button" onClick={props.onClose} aria-label={t("close")}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="acct-modal-body">{props.children}</div>
      </section>
    </div>
  );
}

export function Pager(props: { page: number; total: number; onPage: (page: number) => void }) {
  const t = useAccountingT();
  const pages = Math.max(1, Math.ceil(props.total / accountingPageSize));
  if (props.total <= accountingPageSize) return null;
  return (
    <nav className="acct-pager" aria-label={t("pageOf", { page: props.page + 1, pages })}>
      <button type="button" className="secondary-action" disabled={props.page === 0} onClick={() => props.onPage(props.page - 1)}>
        {t("previous")}
      </button>
      <span data-testid="acct-page">{t("pageOf", { page: props.page + 1, pages })}</span>
      <button type="button" className="secondary-action" disabled={props.page + 1 >= pages} onClick={() => props.onPage(props.page + 1)}>
        {t("next")}
      </button>
    </nav>
  );
}

/** KolayBi live-gate status + "send pending rows" action shared by both muhasebe pages. */
export function KolaybiSyncPanel({ client, onSynced }: { client: AccountingClient; onSynced: () => void }) {
  const t = useAccountingT();
  const [status, setStatus] = useState<KolaybiSyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await client.kolaybiStatus());
    } catch (error) {
      setMessage(t("error", { message: errorText(error) }));
    }
  }, [client, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sync() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await client.syncKolaybi(newIdempotencyKey("kolaybi-sync"));
      setMessage(t("kolaybiQueued", { queued: result.queued_count, total: result.requested_count }));
      await load();
      onSynced();
    } catch (error) {
      setMessage(t("error", { message: errorText(error) }));
    } finally {
      setBusy(false);
    }
  }

  const pending = (target: "contact" | "invoice" | "payment") => (status ? status.counts[target].local + status.counts[target].failed : 0);

  return (
    <section className="acct-kolaybi" data-testid="kolaybi-sync-panel">
      <div>
        <h2>{t("kolaybiTitle")}</h2>
        {status && (
          <>
            <p className={status.live_call_permitted ? "acct-live on" : "acct-live off"} data-testid="kolaybi-live-state">
              {status.live_call_permitted ? t("kolaybiLive") : t("kolaybiDryRun")}
            </p>
            <p className="muted-line">{t("kolaybiGate", { gate: status.live_gate })}</p>
            <p className="muted-line">{status.account ? t("kolaybiAccount", { name: status.account.display_name }) : t("kolaybiNoAccount")}</p>
            <p className="muted-line" data-testid="kolaybi-pending">
              {t("kolaybiCounts", { contacts: pending("contact"), invoices: pending("invoice"), payments: pending("payment") })}
            </p>
          </>
        )}
        {message && (
          <p className="acct-kolaybi-message" role="status" data-testid="kolaybi-message">
            {message}
          </p>
        )}
      </div>
      <div className="acct-kolaybi-actions">
        <button type="button" className="secondary-action" onClick={() => void load()} aria-label={t("refresh")}>
          <RefreshCw size={16} aria-hidden="true" />
        </button>
        <button type="button" className="primary-action" disabled={busy} onClick={() => void sync()} data-testid="kolaybi-sync">
          {busy ? <Loader2 size={16} className="acct-spin" aria-hidden="true" /> : <UploadCloud size={16} aria-hidden="true" />}
          {busy ? t("kolaybiSyncing") : t("kolaybiSync")}
        </button>
      </div>
    </section>
  );
}
