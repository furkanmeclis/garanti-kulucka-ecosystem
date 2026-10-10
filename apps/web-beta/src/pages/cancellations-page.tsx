import type { OrderSummary } from "@garanti-kulucka/shared";
import { Ban, CheckCircle2, RotateCcw, Save, Trash2, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { DataList, ErrorState, Pagination, StatusBadge, type Column } from "@/components/data-list";
import { FilterSelect, ListToolbar } from "@/components/list-toolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageHeader } from "@/layout/page-header";
import type { OrderActionState } from "@/lib/api";
import { formatDateTime, formatMoney } from "@/lib/format";
import { pageCount, pageSize, useListParams } from "@/lib/list-params";
import { useQuery } from "@/lib/use-query";
import { ProviderLabel } from "@/components/provider-label";
import { enumLabel } from "@/lib/status";
import { useConfirm } from "@/components/confirm-dialog";

type Feedback = { tone: "success" | "error"; text: string } | null;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function idempotencyKey(prefix: string) {
  return `${prefix}_${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

/**
 * /iptaller — legacy IptallerPage: cancelled + returned orders (newest update first), filter, search,
 * detail, confirmed restore (back to Oluşturuldu), confirmed permanent delete (an invoiced order queues
 * the KolayBi e-document cancellation) and inline notes.
 */
export function CancellationsPage() {
  const confirm = useConfirm();
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const list = useListParams(["status"] as const);
  const { status } = list.filters;
  const key = JSON.stringify({ q: list.query, page: list.page, status });
  const { data, error, loading, reload } = useQuery(`cancellations:${key}`, () =>
    api.listOrders({
      status: status === "cancelled" || status === "returned" ? status : "cancellations",
      ...(list.query ? { search: list.query } : {}),
      sort_by: "updated_at",
      sort_direction: "desc",
      limit: pageSize,
      offset: list.offset,
    }),
  );
  const [rows, setRows] = useState<OrderSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [detail, setDetail] = useState<OrderActionState | null>(null);

  useEffect(() => {
    if (!data) return;
    setRows(data.data);
    setTotal(data.meta?.total_count ?? data.data.length);
  }, [data]);

  const removeRow = (publicId: string) => {
    setRows((current) => current.filter((row) => row.public_id !== publicId));
    setTotal((current) => Math.max(0, current - 1));
    setDetail((current) => (current?.public_id === publicId ? null : current));
  };

  async function restore(order: { public_id: string; order_number: string }) {
    if (busy || !(await confirm(t("cancellations.confirmRestore", { order: order.order_number })))) return;
    setBusy(order.public_id);
    setFeedback(null);
    try {
      await api.restoreOrder(order.public_id);
      removeRow(order.public_id);
      setFeedback({ tone: "success", text: t("cancellations.restored") });
    } catch (actionError) {
      setFeedback({ tone: "error", text: t("cancellations.actionFailed", { error: errorText(actionError) }) });
    } finally {
      setBusy(null);
    }
  }

  async function remove(order: { public_id: string; order_number: string }) {
    if (busy) return;
    setBusy(order.public_id);
    setFeedback(null);
    try {
      // The legacy confirmation names the KolayBi invoice, so read the order's invoice state first.
      const state = detail?.public_id === order.public_id ? detail : (await api.getOrderActions(order.public_id)).order;
      const invoiced = Boolean(state.kolaybi.invoice_id);
      if (!(await confirm(t(invoiced ? "cancellations.confirmDeleteInvoiced" : "cancellations.confirmDelete", { order: order.order_number }), { tone: "danger" }))) return;
      const result = await api.deleteOrder(order.public_id, idempotencyKey("iptal_sil"));
      removeRow(order.public_id);
      setFeedback({ tone: "success", text: result.e_document_cancel ? t("cancellations.deletedWithInvoice") : t("cancellations.deleted") });
    } catch (actionError) {
      setFeedback({ tone: "error", text: t("cancellations.actionFailed", { error: errorText(actionError) }) });
    } finally {
      setBusy(null);
    }
  }

  async function saveNote(order: OrderSummary) {
    const draft = drafts[order.public_id];
    if (draft === undefined || busy) return;
    setBusy(order.public_id);
    setFeedback(null);
    try {
      const result = await api.updateOrderNotes(order.public_id, draft.trim() ? draft : null);
      setRows((current) => current.map((row) => (row.public_id === order.public_id ? { ...row, notes: result.order.notes } : row)));
      setDrafts(({ [order.public_id]: _saved, ...rest }) => rest);
      setFeedback({ tone: "success", text: t("cancellations.noteSaved") });
    } catch (actionError) {
      setFeedback({ tone: "error", text: t("cancellations.actionFailed", { error: errorText(actionError) }) });
    } finally {
      setBusy(null);
    }
  }

  async function openDetail(order: OrderSummary) {
    setFeedback(null);
    try {
      setDetail((await api.getOrderActions(order.public_id)).order);
    } catch (actionError) {
      setFeedback({ tone: "error", text: t("cancellations.actionFailed", { error: errorText(actionError) }) });
    }
  }

  const columns: Column<OrderSummary>[] = [
    {
      key: "order",
      header: t("cancellations.order"),
      mobile: "title",
      cell: (row) => (
        <button type="button" className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline md:min-h-0" onClick={() => void openDetail(row)} data-testid="cancellation-details">
          {row.order_number}
        </button>
      ),
    },
    { key: "status", header: t("cancellations.status"), mobile: "badge", cell: (row) => <StatusBadge value={row.status} /> },
    { key: "customer", header: t("cancellations.customer"), cell: (row) => row.customer_full_name ?? t("common.none") },
    { key: "amount", header: t("cancellations.amount"), cell: (row) => formatMoney(row.total_amount, row.currency, i18n.language) },
    { key: "updated", header: t("cancellations.updated"), cell: (row) => formatDateTime(row.updated_at, i18n.language) },
    {
      key: "note",
      header: t("cancellations.note"),
      className: "max-w-none min-w-56 overflow-visible",
      cell: (row) => {
        const draft = drafts[row.public_id];
        const changed = draft !== undefined && draft !== (row.notes ?? "");
        return (
          <div className="flex min-w-0 items-center gap-2">
            <Input
              value={draft ?? row.notes ?? ""}
              placeholder={t("cancellations.notePlaceholder")}
              aria-label={`${t("cancellations.note")}: ${row.order_number}`}
              className="h-11 min-w-0 md:h-9"
              onChange={(event) => setDrafts((current) => ({ ...current, [row.public_id]: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveNote(row);
              }}
              data-testid="cancellation-note"
            />
            {changed && (
              <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" disabled={busy !== null} onClick={() => void saveNote(row)} data-testid="cancellation-note-save">
                <Save className="size-4" aria-hidden="true" />
                {t("common.save")}
              </Button>
            )}
          </div>
        );
      },
    },
    {
      key: "actions",
      header: t("cancellations.actions"),
      className: "max-w-none overflow-visible",
      cell: (row) => (
        <div className="flex flex-wrap justify-end gap-2 md:justify-start">
          <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" disabled={busy !== null} onClick={() => void restore(row)} data-testid="cancellation-restore">
            <RotateCcw className="size-4" aria-hidden="true" />
            {t("cancellations.restore")}
          </Button>
          <Button size="sm" variant="outline" className="min-h-11 text-destructive md:min-h-8" disabled={busy !== null} onClick={() => void remove(row)} data-testid="cancellation-delete">
            <Trash2 className="size-4" aria-hidden="true" />
            {t("cancellations.delete")}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <section data-testid="page-cancellations">
      <PageHeader title={t("cancellations.title")} description={t("cancellations.subtitle")} />
      <ListToolbar query={list.query} placeholder={t("cancellations.searchPlaceholder")} onQuery={(q) => list.update({ q })} hasFilters={list.hasFilters} onClear={list.clear}>
        <FilterSelect
          testId="filter-status"
          label={t("cancellations.status")}
          value={status}
          onChange={(value) => list.update({ status: value })}
          options={[
            { value: "all", label: `${t("cancellations.status")}: ${t("cancellations.filterAll")}` },
            { value: "cancelled", label: t("cancellations.filterCancelled"), icon: <Ban className="size-4 text-muted-foreground" aria-hidden="true" /> },
            { value: "returned", label: t("cancellations.filterReturned"), icon: <Undo2 className="size-4 text-muted-foreground" aria-hidden="true" /> },
          ]}
        />
      </ListToolbar>
      {feedback && (
        <p
          role={feedback.tone === "error" ? "alert" : "status"}
          className={feedback.tone === "error" ? "mb-3 text-sm text-destructive" : "mb-3 flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300"}
          data-testid="cancellations-feedback"
        >
          {feedback.tone === "success" && <CheckCircle2 className="size-4" aria-hidden="true" />}
          {feedback.text}
        </p>
      )}
      {error && !data ? (
        <ErrorState onRetry={reload} />
      ) : (
        <>
          <DataList testId="cancellations" rows={rows} columns={columns} rowKey={(row) => row.public_id} loading={loading} />
          {total > 0 && <Pagination page={list.page} pages={pageCount(total)} total={total} onPage={(page) => list.update({ page }, false)} />}
        </>
      )}
      <Sheet open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <SheetContent side="right" closeLabel={t("nav.closeMenu")} className="w-[min(28rem,100vw)] overflow-y-auto p-0" data-testid="cancellation-detail">
          {detail && (
            <>
              <SheetHeader className="border-b p-4 pr-14">
                <SheetTitle>{t("cancellations.detailTitle", { order: detail.order_number })}</SheetTitle>
                <SheetDescription>{detail.customer_full_name ?? t("common.none")}</SheetDescription>
              </SheetHeader>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 text-sm">
                <dt className="text-muted-foreground">{t("cancellations.status")}</dt>
                <dd><StatusBadge value={detail.status} /></dd>
                <dt className="text-muted-foreground">{t("cancellations.phone")}</dt>
                <dd className="break-words">{detail.customer_phone ?? t("common.none")}</dd>
                <dt className="text-muted-foreground">{t("cancellations.amount")}</dt>
                <dd>{formatMoney(detail.total_amount, detail.currency, i18n.language)}</dd>
                <dt className="text-muted-foreground">{t("cancellations.confirmation")}</dt>
                <dd>{enumLabel(t, "confirmationStatus", detail.confirmation_status)}</dd>
                <dt className="text-muted-foreground">
                  <ProviderLabel brand="kolaybi">{t("cancellations.invoice")}</ProviderLabel>
                </dt>
                <dd className="break-all" data-testid="cancellation-detail-invoice">{detail.kolaybi.invoice_id ?? t("common.none")}</dd>
                <dt className="text-muted-foreground">{t("cancellations.eDocument")}</dt>
                <dd>{enumLabel(t, "eDocumentStatus", detail.kolaybi.e_document_status)}</dd>
                <dt className="text-muted-foreground">{t("cancellations.note")}</dt>
                <dd className="break-words">{detail.notes ?? t("common.none")}</dd>
                <dt className="text-muted-foreground">{t("cancellations.created")}</dt>
                <dd>{formatDateTime(detail.created_at, i18n.language)}</dd>
              </dl>
              <div className="mt-auto flex flex-wrap gap-2 border-t p-4">
                <Button variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void restore(detail)} data-testid="cancellation-detail-restore">
                  <RotateCcw className="size-4" aria-hidden="true" />
                  {t("cancellations.restore")}
                </Button>
                <Button variant="outline" className="min-h-11 text-destructive" disabled={busy !== null} onClick={() => void remove(detail)} data-testid="cancellation-detail-delete">
                  <Trash2 className="size-4" aria-hidden="true" />
                  {t("cancellations.delete")}
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}
