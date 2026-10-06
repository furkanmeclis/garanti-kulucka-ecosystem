import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { BookUser, Pencil, Plus, Search } from "lucide-react";
import { createAccountingClient, type AccountingClient, type AccountingContact, type AccountingContactInput } from "../../api/accounting-client.js";
import type { BackendHttpClient } from "../../api/http-client.js";
import { KolaybiSyncPanel, Modal, Notice, Pager, SyncPill, accountingPageSize, errorText, useAccountingT, useMoney } from "./MuhasebeShared.js";

/**
 * Legacy muhasebe/CariHesaplarPage: cari hesap list with search, create/update and KolayBi sync.
 * Accounts are stored by the backend; KolayBi receives them through queued provider jobs.
 */

type Notice = { tone: "success" | "error"; text: string } | null;

export function CariHesaplarPage({ http }: { http: BackendHttpClient }) {
  const t = useAccountingT();
  const money = useMoney();
  const client = useMemo(() => createAccountingClient(http), [http]);
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AccountingContact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState<AccountingContact | "new" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await client.listContacts({ search: search || undefined, limit: accountingPageSize, offset: page * accountingPageSize });
      setRows(response.data);
      setTotal(response.meta.total_count);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [client, page, search]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="flow-panel acct-page" data-testid="accounts-page">
      <header className="acct-header">
        <div>
          <h1>
            <BookUser size={18} aria-hidden="true" /> {t("accountsTitle")}
          </h1>
          <p className="muted-line">{t("accountsSubtitle")}</p>
        </div>
        <button type="button" className="primary-action" onClick={() => setEditing("new")} data-testid="account-new">
          <Plus size={16} aria-hidden="true" /> {t("newAccount")}
        </button>
      </header>

      <Notice notice={notice} onClose={() => setNotice(null)} />
      <KolaybiSyncPanel client={client} onSynced={() => void load()} />

      <form
        className="acct-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(searchDraft.trim());
          setPage(0);
        }}
      >
        <label className="acct-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={searchDraft}
            placeholder={t("accountSearchPlaceholder")}
            aria-label={t("search")}
            onChange={(event) => setSearchDraft(event.target.value)}
            data-testid="account-search"
          />
        </label>
        <div className="acct-filter-actions">
          <button type="submit" className="secondary-action">
            {t("search")}
          </button>
        </div>
      </form>

      {loadError && (
        <p className="acct-notice error" role="alert">
          {t("loadFailed", { message: loadError })}
        </p>
      )}
      {loading && !loaded && <p className="muted-line">{t("loading")}</p>}
      {loaded && !loadError && rows.length === 0 && <p className="acct-empty">{t("empty")}</p>}

      {rows.length > 0 && (
        <div className="acct-list acct-accounts" data-testid="account-list" aria-busy={loading}>
          <div className="acct-row acct-row-head" aria-hidden="true">
            <span>{t("name")}</span>
            <span>{t("taxNumber")}</span>
            <span>{t("phone")}</span>
            <span>{t("city")}</span>
            <span className="num">{t("invoiceCount")}</span>
            <span className="num">{t("balance")}</span>
            <span>{t("sync")}</span>
            <span>{t("actions")}</span>
          </div>
          {rows.map((contact) => (
            <article className="acct-row" key={contact.public_id} data-testid="account-row">
              <span className="acct-strong">
                {contact.name}
                <span className="muted-line">{contact.contact_type === "corporate" ? t("corporate") : t("individual")}</span>
              </span>
              <span>{contact.tax_number ?? "-"}</span>
              <span>{contact.phone ?? contact.email ?? "-"}</span>
              <span>{[contact.district, contact.city].filter(Boolean).join(" / ") || "-"}</span>
              <span className="num">{contact.invoice_count ?? 0}</span>
              <span className="num">{money(contact.open_balance ?? 0)}</span>
              <span>
                <SyncPill status={contact.sync.status} error={contact.sync.error} />
              </span>
              <span className="acct-row-actions">
                <button type="button" className="acct-icon-button" onClick={() => setEditing(contact)} aria-label={`${t("editAccount")} ${contact.name}`} data-testid="account-edit">
                  <Pencil size={16} aria-hidden="true" />
                </button>
              </span>
            </article>
          ))}
        </div>
      )}
      <Pager page={page} total={total} onPage={setPage} />

      {editing && (
        <AccountModal
          client={client}
          contact={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setNotice({ tone: "success", text: t("accountSaved") });
            void load();
          }}
        />
      )}
    </section>
  );
}

const textFields = ["name", "tax_number", "tax_office", "phone", "email", "address_line", "district", "city", "notes"] as const;
type TextField = (typeof textFields)[number];
const fieldLabels: Record<TextField, Parameters<ReturnType<typeof useAccountingT>>[0]> = {
  name: "name",
  tax_number: "taxNumber",
  tax_office: "taxOffice",
  phone: "phone",
  email: "email",
  address_line: "address",
  district: "district",
  city: "city",
  notes: "notes",
};

function AccountModal(props: { client: AccountingClient; contact: AccountingContact | null; onClose: () => void; onSaved: () => void }) {
  const t = useAccountingT();
  const [contactType, setContactType] = useState<"individual" | "corporate">(props.contact?.contact_type ?? "individual");
  const [values, setValues] = useState<Record<TextField, string>>(() =>
    Object.fromEntries(textFields.map((field) => [field, props.contact?.[field] ?? ""])) as Record<TextField, string>,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!values.name.trim()) {
      setError(t("nameRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    const input: AccountingContactInput = { contact_type: contactType };
    for (const field of textFields) {
      const value = values[field].trim();
      if (field === "name") input.name = value;
      else input[field] = value || null;
    }
    try {
      if (props.contact) await props.client.updateContact(props.contact.public_id, input);
      else await props.client.createContact({ ...input, name: values.name.trim() });
      props.onSaved();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={props.contact ? props.contact.name : t("newAccount")} onClose={props.onClose} wide testId="account-form">
      <form className="acct-form" onSubmit={submit}>
        <div className="acct-form-grid">
          <label>
            <span className="field-label">{t("contactType")}</span>
            <select value={contactType} onChange={(event) => setContactType(event.target.value as "individual" | "corporate")} name="contact_type">
              <option value="individual">{t("individual")}</option>
              <option value="corporate">{t("corporate")}</option>
            </select>
          </label>
          {textFields.map((field) => (
            <label key={field} className={field === "address_line" || field === "notes" ? "acct-span-2" : undefined}>
              <span className="field-label">{t(fieldLabels[field])}</span>
              <input
                name={field}
                type={field === "email" ? "email" : field === "phone" ? "tel" : "text"}
                inputMode={field === "tax_number" ? "numeric" : undefined}
                required={field === "name"}
                value={values[field]}
                onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))}
              />
            </label>
          ))}
        </div>
        {error && (
          <p className="acct-notice error" role="alert" data-testid="account-error">
            {error}
          </p>
        )}
        <div className="acct-modal-actions">
          <button type="button" className="secondary-action" onClick={props.onClose}>
            {t("cancel")}
          </button>
          <button type="submit" className="primary-action" disabled={saving} data-testid="account-save">
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
