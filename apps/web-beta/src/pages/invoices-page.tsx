import { Ban, FileDown, Loader2, Plus, Trash2, Wallet } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { DataList, ErrorState, Pagination, type Column } from "@/components/data-list";
import { FilterSelect, ListToolbar } from "@/components/list-toolbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageHeader } from "@/layout/page-header";
import type { Invoice, InvoiceDetail, InvoiceStatus, PaymentMethod } from "@/lib/accounting";
import { formatDate, formatMoney } from "@/lib/format";
import { pageCount, pageSize, useListParams } from "@/lib/list-params";
import { useQuery } from "@/lib/use-query";
import { errorText, FeedbackLine, Field, idempotencyKey, InvoiceStatusBadge, KolaybiPanel, NativeSelect, SyncBadge, type Feedback } from "./accounting-shared";

const statusFilters = ["open", "issued", "partially_paid", "paid", "cancelled"] as const;
const statusFilterLabel = { open: "statusOpen", issued: "statusIssued", partially_paid: "statusPartiallyPaid", paid: "statusPaid", cancelled: "statusCancelled" } as const;
const methods: Array<[PaymentMethod, "methodCash" | "methodBank" | "methodCard" | "methodOther"]> = [
  ["cash", "methodCash"],
  ["bank_transfer", "methodBank"],
  ["credit_card", "methodCard"],
  ["other", "methodOther"],
];

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** /faturalar (managers): invoices with totals, detail (items, payments, PDF, collect, cancel), create and KolayBi sync. */
export function InvoicesPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const list = useListParams(["status"] as const);
  const { status } = list.filters;
  const key = JSON.stringify({ q: list.query, page: list.page, status });
  const { data, error, loading, reload } = useQuery(`invoices:${key}`, () =>
    api.listInvoices({
      ...(list.query ? { search: list.query } : {}),
      ...(status !== "all" ? { status: status as InvoiceStatus | "open" } : {}),
      limit: pageSize,
      offset: list.offset,
    }),
  );
  const rows = data?.data ?? [];
  const total = data?.meta.total_count ?? rows.length;
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const money = (value: string | number, currency = "TRY") => formatMoney(value, currency, i18n.language);

  const columns: Column<Invoice>[] = [
    {
      key: "number",
      header: t("accounting.invoiceNumber"),
      mobile: "title",
      cell: (row) => (
        <button type="button" className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline md:min-h-0" onClick={() => setSelected(row.public_id)} data-testid="invoice-open">
          {row.invoice_number}
        </button>
      ),
    },
    { key: "status", header: t("accounting.status"), mobile: "badge", cell: (row) => <InvoiceStatusBadge status={row.status} /> },
    { key: "account", header: t("accounting.account"), cell: (row) => row.contact.name },
    { key: "date", header: t("accounting.issueDate"), cell: (row) => formatDate(row.issue_date, i18n.language) },
    { key: "amount", header: t("accounting.amount"), cell: (row) => money(row.grand_total, row.currency) },
    { key: "open", header: t("accounting.openAmount"), cell: (row) => money(row.open_amount, row.currency) },
    { key: "sync", header: t("accounting.sync"), cell: (row) => <SyncBadge sync={row.sync} /> },
  ];

  return (
    <section data-testid="page-invoices">
      <PageHeader
        title={t("accounting.invoicesTitle")}
        description={t("accounting.invoicesSubtitle")}
        actions={
          <Button className="min-h-11" onClick={() => setCreating(true)} data-testid="invoice-new">
            <Plus className="size-4" aria-hidden="true" />
            {t("accounting.newInvoice")}
          </Button>
        }
      />
      <KolaybiPanel onSynced={reload} />
      {data && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="invoice-totals">
          {(
            [
              ["totalInvoiced", data.totals.grand_total],
              ["totalPaid", data.totals.paid_total],
              ["totalOpen", data.totals.open_total],
            ] as const
          ).map(([label, value]) => (
            <Card key={label} className="p-4">
              <p className="text-sm text-muted-foreground">{t(`accounting.${label}`)}</p>
              <p className="text-xl font-semibold">{money(value)}</p>
            </Card>
          ))}
        </div>
      )}
      <ListToolbar query={list.query} placeholder={t("accounting.invoiceSearchPlaceholder")} onQuery={(q) => list.update({ q })} hasFilters={list.hasFilters} onClear={list.clear}>
        <FilterSelect
          testId="filter-status"
          label={t("accounting.status")}
          value={status}
          onChange={(value) => list.update({ status: value })}
          options={[{ value: "all", label: `${t("accounting.status")}: ${t("accounting.all")}` }, ...statusFilters.map((value) => ({ value, label: t(`accounting.${statusFilterLabel[value]}`) }))]}
        />
      </ListToolbar>
      <div className="mb-3">
        <FeedbackLine feedback={feedback} testId="invoices-feedback" />
      </div>
      {error && !data ? (
        <ErrorState onRetry={reload} />
      ) : (
        <>
          <DataList testId="invoices" rows={rows} columns={columns} rowKey={(row) => row.public_id} loading={loading} />
          {total > 0 && <Pagination page={list.page} pages={pageCount(total)} total={total} onPage={(page) => list.update({ page }, false)} />}
        </>
      )}
      <InvoiceDetailSheet publicId={selected} onClose={() => setSelected(null)} onChanged={reload} />
      <CreateInvoiceSheet
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(invoice) => {
          setCreating(false);
          setFeedback({ tone: "success", text: t("accounting.invoiceCreated", { number: invoice.invoice_number }) });
          reload();
          setSelected(invoice.public_id);
        }}
      />
    </section>
  );
}

function InvoiceDetailSheet({ publicId, onClose, onChanged }: { publicId: string | null; onClose: () => void; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<"pdf" | "pay" | "cancel" | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [vaultId, setVaultId] = useState("");
  const money = (value: string | number) => formatMoney(value, detail?.currency ?? "TRY", i18n.language);

  useEffect(() => {
    setDetail(null);
    setFeedback(null);
    if (!publicId) return;
    let cancelled = false;
    api
      .getInvoice(publicId)
      .then((invoice) => {
        if (cancelled) return;
        setDetail(invoice);
        setAmount(invoice.open_amount);
      })
      .catch((error: unknown) => !cancelled && setFeedback({ tone: "error", text: t("accounting.loadFailed", { message: errorText(error) }) }));
    return () => {
      cancelled = true;
    };
  }, [api, publicId, t]);

  async function pdf() {
    if (!detail) return;
    setBusy("pdf");
    try {
      const file = await api.invoiceDocument(detail.public_id, "pdf");
      downloadBlob(file.blob, file.filename ?? `${detail.invoice_number}.pdf`);
    } catch (error) {
      setFeedback({ tone: "error", text: t("accounting.pdfFailed", { message: errorText(error) }) });
    } finally {
      setBusy(null);
    }
  }

  async function collect(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    setBusy("pay");
    setFeedback(null);
    try {
      const result = await api.addInvoicePayment(detail.public_id, {
        idempotency_key: idempotencyKey("tahsilat"),
        amount: amount.trim().replace(",", "."),
        method,
        ...(vaultId.trim() ? { vault_id: vaultId.trim() } : {}),
      });
      setDetail(result.invoice);
      setAmount(result.invoice.open_amount);
      setFeedback({ tone: "success", text: t("accounting.paymentRecorded") });
      onChanged();
    } catch (error) {
      setFeedback({ tone: "error", text: t("accounting.error", { message: errorText(error) }) });
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (!detail || !window.confirm(t("accounting.cancelConfirm", { number: detail.invoice_number }))) return;
    setBusy("cancel");
    setFeedback(null);
    try {
      setDetail(await api.cancelInvoice(detail.public_id));
      setFeedback({ tone: "success", text: t("accounting.invoiceCancelled") });
      onChanged();
    } catch (error) {
      setFeedback({ tone: "error", text: t("accounting.error", { message: errorText(error) }) });
    } finally {
      setBusy(null);
    }
  }

  const open = Number(detail?.open_amount ?? 0) > 0 && detail?.status !== "cancelled";

  return (
    <Sheet open={publicId !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" closeLabel={t("accounting.close")} className="w-[min(32rem,100vw)] overflow-y-auto p-0" data-testid="invoice-detail">
        <SheetHeader className="border-b p-4 pr-14">
          <SheetTitle>{detail ? t("accounting.detailTitle", { number: detail.invoice_number }) : t("accounting.loading")}</SheetTitle>
          <SheetDescription>{detail?.contact.name ?? ""}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          <FeedbackLine feedback={feedback} testId="invoice-feedback" />
          {!detail ? (
            !feedback && <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" aria-label={t("accounting.loading")} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <InvoiceStatusBadge status={detail.status} />
                <SyncBadge sync={detail.sync} />
                <span className="text-sm text-muted-foreground">{formatDate(detail.issue_date, i18n.language)}</span>
              </div>
              <ul className="flex flex-col divide-y rounded-md border text-sm" data-testid="invoice-items">
                {detail.items.map((item) => (
                  <li key={item.public_id} className="flex items-start justify-between gap-3 p-3">
                    <span className="min-w-0 break-words">
                      {item.description}
                      <span className="block text-xs text-muted-foreground">
                        {item.quantity} {item.unit} × {money(item.unit_price)} · %{Number(item.vat_rate)}
                      </span>
                    </span>
                    <span className="shrink-0 font-medium">{money(item.line_total)}</span>
                  </li>
                ))}
              </ul>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">{t("accounting.subtotal")}</dt>
                <dd>{money(detail.subtotal)}</dd>
                <dt className="text-muted-foreground">{t("accounting.vat")}</dt>
                <dd>{money(detail.vat_total)}</dd>
                <dt className="font-medium">{t("accounting.grandTotal")}</dt>
                <dd className="font-semibold" data-testid="invoice-grand-total">{money(detail.grand_total)}</dd>
                <dt className="text-muted-foreground">{t("accounting.openAmount")}</dt>
                <dd data-testid="invoice-open-amount">{money(detail.open_amount)}</dd>
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void pdf()} data-testid="invoice-pdf">
                  {busy === "pdf" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <FileDown className="size-4" aria-hidden="true" />}
                  {t("accounting.pdf")}
                </Button>
                {detail.status !== "cancelled" && (
                  <Button variant="outline" className="min-h-11 text-destructive" disabled={busy !== null} onClick={() => void cancel()} data-testid="invoice-cancel">
                    <Ban className="size-4" aria-hidden="true" />
                    {t("accounting.cancelInvoice")}
                  </Button>
                )}
              </div>
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold">{t("accounting.payments")}</h3>
                {detail.payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("accounting.noPayments")}</p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm" data-testid="invoice-payments">
                    {detail.payments.map((payment) => (
                      <li key={payment.public_id} className="flex items-center justify-between gap-2">
                        <span>
                          {formatDate(payment.paid_at, i18n.language)} · {t(`accounting.${methods.find(([value]) => value === payment.method)?.[1] ?? "methodOther"}`)}
                        </span>
                        <span className="flex items-center gap-2">
                          {money(payment.amount)}
                          <SyncBadge sync={payment.sync} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {open && (
                <form className="grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-2" onSubmit={(event) => void collect(event)} data-testid="invoice-payment-form">
                  <Field label={t("accounting.paymentAmount")}>
                    <Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="h-11 md:h-9" data-testid="payment-amount" />
                  </Field>
                  <Field label={t("accounting.paymentMethod")}>
                    <NativeSelect value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)} data-testid="payment-method">
                      {methods.map(([value, label]) => (
                        <option key={value} value={value}>
                          {t(`accounting.${label}`)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label={t("accounting.vaultId")} className="sm:col-span-2">
                    <Input value={vaultId} onChange={(event) => setVaultId(event.target.value)} className="h-11 md:h-9" placeholder={t("accounting.vaultHint")} />
                  </Field>
                  <Button type="submit" className="min-h-11 sm:col-span-2" disabled={busy !== null} data-testid="payment-submit">
                    <Wallet className="size-4" aria-hidden="true" />
                    {t("accounting.collect")}
                  </Button>
                </form>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface Line {
  id: number;
  description: string;
  quantity: string;
  unit_price: string;
  vat_rate: string;
}

const emptyLine = (id: number): Line => ({ id, description: "", quantity: "1", unit_price: "", vat_rate: "20" });

function CreateInvoiceSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (invoice: InvoiceDetail) => void }) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const contacts = useQuery("accounting:contacts:all", () => api.listAccountingContacts({ limit: 200 }), { enabled: open });
  const [contactId, setContactId] = useState("");
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<Line[]>([emptyLine(1)]);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    if (!open) return;
    setFeedback(null);
    setLines([emptyLine(1)]);
    setDescription("");
  }, [open]);

  const totals = useMemo(() => {
    let subtotal = 0;
    let vat = 0;
    for (const line of lines) {
      const net = Number(line.quantity.replace(",", ".")) * Number(line.unit_price.replace(",", "."));
      if (!Number.isFinite(net)) continue;
      subtotal += net;
      vat += (net * Number(line.vat_rate)) / 100;
    }
    return { subtotal, vat, total: subtotal + vat };
  }, [lines]);

  const update = (id: number, patch: Partial<Line>) => setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFeedback(null);
    if (!contactId) return setFeedback({ tone: "error", text: t("accounting.accountRequired") });
    const items = lines
      .filter((line) => line.description.trim() && Number(line.quantity.replace(",", ".")) > 0 && Number(line.unit_price.replace(",", ".")) >= 0 && line.unit_price.trim())
      .map((line) => ({ description: line.description.trim(), quantity: Number(line.quantity.replace(",", ".")), unit_price: line.unit_price.trim().replace(",", "."), vat_rate: Number(line.vat_rate) }));
    if (items.length === 0) return setFeedback({ tone: "error", text: t("accounting.itemsRequired") });
    setSaving(true);
    try {
      const invoice = await api.createInvoice({ idempotency_key: idempotencyKey("fatura"), contact_public_id: contactId, issue_date: issueDate, ...(description.trim() ? { description: description.trim() } : {}), items });
      onCreated(invoice);
    } catch (error) {
      setFeedback({ tone: "error", text: t("accounting.error", { message: errorText(error) }) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" closeLabel={t("accounting.close")} className="w-[min(36rem,100vw)] overflow-y-auto p-0" data-testid="invoice-create">
        <SheetHeader className="border-b p-4 pr-14">
          <SheetTitle>{t("accounting.newInvoice")}</SheetTitle>
          <SheetDescription>{t("accounting.invoicesSubtitle")}</SheetDescription>
        </SheetHeader>
        <form className="flex flex-col gap-4 px-4 pb-4" onSubmit={(event) => void submit(event)}>
          <Field label={t("accounting.account")}>
            <NativeSelect value={contactId} onChange={(event) => setContactId(event.target.value)} data-testid="invoice-contact">
              <option value="">{t("accounting.chooseAccount")}</option>
              {(contacts.data?.data ?? []).map((contact) => (
                <option key={contact.public_id} value={contact.public_id}>
                  {contact.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("accounting.issueDate")}>
              <Input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} className="h-11 md:h-9" />
            </Field>
            <Field label={t("accounting.description")}>
              <Input value={description} onChange={(event) => setDescription(event.target.value)} className="h-11 md:h-9" />
            </Field>
          </div>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-semibold">{t("accounting.items")}</legend>
            {lines.map((line, index) => (
              <div key={line.id} className="grid grid-cols-2 gap-2 rounded-md border p-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]" data-testid="invoice-line">
                <Field label={t("accounting.description")} className="col-span-2 sm:col-span-1">
                  <Input value={line.description} onChange={(event) => update(line.id, { description: event.target.value })} className="h-11 md:h-9" data-testid="line-description" />
                </Field>
                <Field label={t("accounting.quantity")}>
                  <Input inputMode="decimal" value={line.quantity} onChange={(event) => update(line.id, { quantity: event.target.value })} className="h-11 md:h-9" data-testid="line-quantity" />
                </Field>
                <Field label={t("accounting.unitPrice")}>
                  <Input inputMode="decimal" value={line.unit_price} onChange={(event) => update(line.id, { unit_price: event.target.value })} className="h-11 md:h-9" data-testid="line-price" />
                </Field>
                <Field label={t("accounting.vatRate")}>
                  <NativeSelect value={line.vat_rate} onChange={(event) => update(line.id, { vat_rate: event.target.value })} data-testid="line-vat">
                    {["0", "1", "10", "20"].map((rate) => (
                      <option key={rate} value={rate}>
                        %{rate}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11"
                    disabled={lines.length === 1}
                    aria-label={`${t("accounting.removeItem")} ${index + 1}`}
                    onClick={() => setLines((current) => current.filter((entry) => entry.id !== line.id))}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" className="min-h-11 self-start" onClick={() => setLines((current) => [...current, emptyLine(Math.max(...current.map((line) => line.id)) + 1)])} data-testid="invoice-add-line">
              <Plus className="size-4" aria-hidden="true" />
              {t("accounting.addItem")}
            </Button>
          </fieldset>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm" data-testid="invoice-create-totals">
            <dt className="text-muted-foreground">{t("accounting.subtotal")}</dt>
            <dd>{formatMoney(totals.subtotal, "TRY", i18n.language)}</dd>
            <dt className="text-muted-foreground">{t("accounting.vat")}</dt>
            <dd>{formatMoney(totals.vat, "TRY", i18n.language)}</dd>
            <dt className="font-medium">{t("accounting.grandTotal")}</dt>
            <dd className="font-semibold">{formatMoney(totals.total, "TRY", i18n.language)}</dd>
          </dl>
          <FeedbackLine feedback={feedback} testId="invoice-create-feedback" />
          <Button type="submit" className="min-h-11" disabled={saving} data-testid="invoice-create-submit">
            {saving ? t("accounting.saving") : t("accounting.save")}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
