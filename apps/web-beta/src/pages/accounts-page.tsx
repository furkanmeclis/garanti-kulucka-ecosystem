import { Loader2, Pencil, Plus, Save } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { DataList, ErrorState, Pagination, type Column } from "@/components/data-list";
import { FilterSelect, ListToolbar } from "@/components/list-toolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageHeader } from "@/layout/page-header";
import type { AccountingContact, AccountingContactInput, SyncStatus } from "@/lib/accounting";
import { formatMoney } from "@/lib/format";
import { pageCount, pageSize, useListParams } from "@/lib/list-params";
import { useQuery } from "@/lib/use-query";
import { errorText, FeedbackLine, Field, KolaybiPanel, FormSelect, SyncBadge, type Feedback } from "./accounting-shared";

const syncFilters: SyncStatus[] = ["local", "queued", "synced", "failed"];
const syncFilterLabel = { local: "syncLocal", queued: "syncQueued", synced: "syncSynced", failed: "syncFailed" } as const;

type Draft = Required<Pick<AccountingContactInput, "contact_type">> & Record<"name" | "tax_number" | "tax_office" | "phone" | "email" | "address_line" | "district" | "city" | "notes", string>;

function draftFrom(contact: AccountingContact | null): Draft {
  return {
    contact_type: contact?.contact_type ?? "individual",
    name: contact?.name ?? "",
    tax_number: contact?.tax_number ?? "",
    tax_office: contact?.tax_office ?? "",
    phone: contact?.phone ?? "",
    email: contact?.email ?? "",
    address_line: contact?.address_line ?? "",
    district: contact?.district ?? "",
    city: contact?.city ?? "",
    notes: contact?.notes ?? "",
  };
}

/** /cari-hesaplar (managers): accounts with search, KolayBi sync state, create and edit. */
export function AccountsPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const list = useListParams(["sync"] as const);
  const { sync } = list.filters;
  const key = JSON.stringify({ q: list.query, page: list.page, sync });
  const { data, error, loading, reload } = useQuery(`accounts:${key}`, () =>
    api.listAccountingContacts({
      ...(list.query ? { search: list.query } : {}),
      ...(sync !== "all" ? { sync_status: sync as SyncStatus } : {}),
      limit: pageSize,
      offset: list.offset,
    }),
  );
  const rows = data?.data ?? [];
  const total = data?.meta.total_count ?? rows.length;
  const [editing, setEditing] = useState<AccountingContact | "new" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const columns: Column<AccountingContact>[] = [
    { key: "name", header: t("accounting.name"), mobile: "title", cell: (row) => <span className="font-medium">{row.name}</span> },
    { key: "sync", header: t("accounting.sync"), mobile: "badge", cell: (row) => <SyncBadge sync={row.sync} /> },
    { key: "type", header: t("accounting.contactType"), cell: (row) => t(`accounting.${row.contact_type}`) },
    { key: "tax", header: t("accounting.taxNumber"), cell: (row) => row.tax_number ?? t("common.none") },
    { key: "phone", header: t("accounting.phone"), cell: (row) => row.phone ?? t("common.none") },
    { key: "invoices", header: t("accounting.invoiceCount"), cell: (row) => String(row.invoice_count ?? 0) },
    { key: "balance", header: t("accounting.balance"), cell: (row) => formatMoney(row.open_balance ?? "0", "TRY", i18n.language) },
    {
      key: "edit",
      header: t("accounting.actions"),
      cell: (row) => (
        <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" onClick={() => setEditing(row)} data-testid="account-edit">
          <Pencil className="size-4" aria-hidden="true" />
          {t("accounting.editAccount")}
        </Button>
      ),
    },
  ];

  return (
    <section data-testid="page-accounts">
      <PageHeader
        title={t("accounting.accountsTitle")}
        description={t("accounting.accountsSubtitle")}
        actions={
          <Button className="min-h-11" onClick={() => setEditing("new")} data-testid="account-new">
            <Plus className="size-4" aria-hidden="true" />
            {t("accounting.newAccount")}
          </Button>
        }
      />
      <KolaybiPanel onSynced={reload} />
      <ListToolbar query={list.query} placeholder={t("accounting.accountSearchPlaceholder")} onQuery={(q) => list.update({ q })} hasFilters={list.hasFilters} onClear={list.clear}>
        <FilterSelect
          testId="filter-sync"
          label={t("accounting.sync")}
          value={sync}
          onChange={(value) => list.update({ sync: value })}
          options={[{ value: "all", label: `${t("accounting.sync")}: ${t("accounting.all")}` }, ...syncFilters.map((value) => ({ value, label: t(`accounting.${syncFilterLabel[value]}`) }))]}
        />
      </ListToolbar>
      <div className="mb-3">
        <FeedbackLine feedback={feedback} testId="accounts-feedback" />
      </div>
      {error && !data ? (
        <ErrorState onRetry={reload} />
      ) : (
        <>
          <DataList testId="accounts" rows={rows} columns={columns} rowKey={(row) => row.public_id} loading={loading} />
          {total > 0 && <Pagination page={list.page} pages={pageCount(total)} total={total} onPage={(page) => list.update({ page }, false)} />}
        </>
      )}
      <AccountSheet
        contact={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          setFeedback({ tone: "success", text: t("accounting.accountSaved") });
          reload();
        }}
      />
    </section>
  );
}

function AccountSheet({ contact, onClose, onSaved }: { contact: AccountingContact | "new" | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const existing = contact && contact !== "new" ? contact : null;
  const [draft, setDraft] = useState<Draft>(() => draftFrom(existing));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    setDraft(draftFrom(existing));
    setFeedback(null);
  }, [contact]);

  const set = (field: keyof Draft) => (value: string) => setDraft((current) => ({ ...current, [field]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim()) return setFeedback({ tone: "error", text: t("accounting.nameRequired") });
    const optional = (value: string) => (value.trim() ? value.trim() : null);
    const input = {
      contact_type: draft.contact_type,
      name: draft.name.trim(),
      tax_number: optional(draft.tax_number),
      tax_office: optional(draft.tax_office),
      phone: optional(draft.phone),
      email: optional(draft.email),
      address_line: optional(draft.address_line),
      district: optional(draft.district),
      city: optional(draft.city),
      notes: optional(draft.notes),
    };
    setSaving(true);
    setFeedback(null);
    try {
      if (existing) await api.updateAccountingContact(existing.public_id, input);
      else await api.createAccountingContact(input);
      onSaved();
    } catch (error) {
      setFeedback({ tone: "error", text: t("accounting.error", { message: errorText(error) }) });
    } finally {
      setSaving(false);
    }
  }

  const text = (field: Exclude<keyof Draft, "contact_type">, label: string, props: { type?: string; inputMode?: "tel" | "email" | "numeric"; className?: string } = {}) => (
    <Field label={label} className={props.className}>
      <Input value={draft[field]} type={props.type} inputMode={props.inputMode} onChange={(event) => set(field)(event.target.value)} className="h-11 md:h-9" data-testid={`account-${field}`} />
    </Field>
  );

  return (
    <Sheet open={contact !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" closeLabel={t("accounting.close")} className="w-[min(32rem,100vw)] overflow-y-auto p-0" data-testid="account-sheet">
        <SheetHeader className="border-b p-4 pr-14">
          <SheetTitle>{existing ? existing.name : t("accounting.newAccount")}</SheetTitle>
          <SheetDescription>{t("accounting.accountsSubtitle")}</SheetDescription>
        </SheetHeader>
        <form className="grid grid-cols-1 gap-3 px-4 pb-4 sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
          <Field label={t("accounting.contactType")}>
            <FormSelect value={draft.contact_type} onChange={(event) => setDraft((current) => ({ ...current, contact_type: event.target.value as Draft["contact_type"] }))} data-testid="account-contact_type">
              <option value="individual">{t("accounting.individual")}</option>
              <option value="corporate">{t("accounting.corporate")}</option>
            </FormSelect>
          </Field>
          {text("name", t("accounting.name"))}
          {text("tax_number", t("accounting.taxNumber"), { inputMode: "numeric" })}
          {text("tax_office", t("accounting.taxOffice"))}
          {text("phone", t("accounting.phone"), { type: "tel", inputMode: "tel" })}
          {text("email", t("accounting.email"), { type: "email", inputMode: "email" })}
          {text("address_line", t("accounting.address"), { className: "sm:col-span-2" })}
          {text("district", t("accounting.district"))}
          {text("city", t("accounting.city"))}
          {text("notes", t("accounting.notes"), { className: "sm:col-span-2" })}
          <div className="sm:col-span-2">
            <FeedbackLine feedback={feedback} testId="account-feedback" />
          </div>
          <Button type="submit" className="min-h-11 sm:col-span-2" disabled={saving} data-testid="account-save">
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
            {saving ? t("accounting.saving") : t("accounting.save")}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
