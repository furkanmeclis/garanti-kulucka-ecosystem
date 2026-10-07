import type { OrderSummary } from "@garanti-kulucka/shared";
import { Download, Loader2, Phone, Plus, Truck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import {
  DataList,
  ErrorState,
  Pagination,
  StatusBadge,
  type Column,
} from "@/components/data-list";
import { FilterSelect, ListToolbar } from "@/components/list-toolbar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/layout/page-header";
import type { OrderListQuery } from "@/lib/api";
import { carrierLabel, formatDateTime, formatMoney } from "@/lib/format";
import { pageCount, pageSize, useListParams } from "@/lib/list-params";
import type { CargoProviderKey } from "@/lib/orders";
import { useQuery } from "@/lib/use-query";
import {
  errorText,
  FeedbackLine,
  idempotencyKey,
  type Feedback,
} from "./accounting-shared";
import { OrderDetailSheet } from "./order-detail-sheet";
import { OrderFormSheet } from "./order-form-sheet";

const orderStatuses = [
  "pending_confirmation",
  "confirmed",
  "preparing",
  "shipped",
  "delivered",
  "cancelled",
  "returned",
] as const;
const sources = ["manual", "conversation", "ai", "woocommerce"] as const;
const sorts: Record<
  string,
  Pick<OrderListQuery, "sort_by" | "sort_direction">
> = {
  newest: { sort_by: "created_at", sort_direction: "desc" },
  oldest: { sort_by: "created_at", sort_direction: "asc" },
  amount: { sort_by: "total_amount", sort_direction: "desc" },
};

/** Legacy Excel export (HTML table saved as .xls): "liste" or the "telefon" (isim + telefon) format. */
function downloadExcel(
  rows: OrderSummary[],
  format: "liste" | "telefon",
  labels: {
    status: (value: string) => string;
    date: (value: string) => string;
  },
) {
  const headers =
    format === "telefon"
      ? ["İsim", "Telefon"]
      : [
          "Sipariş No",
          "Müşteri",
          "Telefon",
          "Durum",
          "Kaynak",
          "Kargo",
          "Personel",
          "Tutar",
          "Tarih",
        ];
  const body = rows.map((order) =>
    format === "telefon"
      ? [
          order.customer_full_name ?? order.order_number,
          order.customer_phone ?? "",
        ]
      : [
          order.order_number,
          order.customer_full_name ?? "",
          order.customer_phone ?? "",
          labels.status(order.status),
          order.source,
          carrierLabel(order.cargo_provider ?? null, "-"),
          order.created_by_user_email ?? "",
          `${order.total_amount} ${order.currency}`,
          order.created_at ? labels.date(order.created_at) : "",
        ],
  );
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  const table = [headers, ...body]
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escape(String(cell))}</td>`).join("")}</tr>`,
    )
    .join("");
  const url = URL.createObjectURL(
    new Blob(
      [
        `<html><head><meta charset="utf-8" /></head><body><table>${table}</table></body></html>`,
      ],
      { type: "application/vnd.ms-excel;charset=utf-8" },
    ),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `siparisler-${format}-${new Date().toISOString().slice(0, 10)}.xls`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function OrdersPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const list = useListParams([
    "status",
    "cargo",
    "sort",
    "source",
    "from",
    "to",
  ] as const);
  const { status, cargo, sort, source, from, to } = list.filters;
  const query: OrderListQuery = {
    ...(list.query ? { search: list.query } : {}),
    ...(status !== "all" ? { status } : {}),
    ...(cargo !== "all" ? { cargo_provider: cargo } : {}),
    ...(source !== "all" ? { source } : {}),
    ...(from !== "all" ? { created_from: from } : {}),
    ...(to !== "all" ? { created_to: to } : {}),
    ...(sorts[sort] ?? sorts.newest),
  };
  const key = JSON.stringify({ query, page: list.page });
  const { data, error, loading, reload } = useQuery(`orders:${key}`, () =>
    api.listOrders({ ...query, limit: pageSize, offset: list.offset }),
  );
  const rows = data?.data ?? [];
  const total = data?.meta?.total_count ?? rows.length;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);

  useEffect(() => setSelected(new Set()), [key]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allVisible =
    rows.length > 0 && rows.every((row) => selected.has(row.public_id));
  const selectedRows = rows.filter((row) => selected.has(row.public_id));
  const labels = {
    status: (value: string) => t(`status.${value}`, { defaultValue: value }),
    date: (value: string) => formatDateTime(value, i18n.language),
  };

  async function exportOrders(
    scope: "visible" | "selected" | "filtered" | "phones",
  ) {
    let exportRows =
      scope === "selected" || scope === "phones" ? selectedRows : rows;
    if (scope === "filtered")
      exportRows = (await api.listOrders({ ...query, limit: 200, offset: 0 }))
        .data;
    downloadExcel(exportRows, scope === "phones" ? "telefon" : "liste", labels);
    setFeedback({
      tone: "success",
      text: t("orders.exported", { count: exportRows.length }),
    });
  }

  async function bulk(kind: "confirmation" | "kolaybi" | CargoProviderKey) {
    const ids = [...selected];
    if (ids.length === 0) return;
    const prompt =
      kind === "confirmation"
        ? t("orderActions.bulkConfirmPrompt", { count: ids.length })
        : kind === "kolaybi"
          ? t("orderActions.bulkKolaybiPrompt", { count: ids.length })
          : t("cargoCreate.bulkConfirm", {
              count: ids.length,
              provider: kind === "ptt" ? "PTT Kargo" : "Sürat Kargo",
            });
    if (!window.confirm(prompt)) return;
    setBulkBusy(kind);
    setFeedback(null);
    try {
      if (kind === "confirmation" || kind === "kolaybi") {
        const response =
          kind === "confirmation"
            ? await api.bulkConfirmationCalls(ids, idempotencyKey("bulk_teyit"))
            : await api.bulkKolaybiTransfer(
                ids,
                idempotencyKey("bulk_kolaybi"),
              );
        const failed = response.results.filter((row) => !row.queued).length;
        setFeedback({
          tone: response.queued_count > 0 ? "success" : "error",
          text:
            response.queued_count === 0
              ? t(
                  kind === "confirmation"
                    ? "orderActions.bulkNoUnconfirmed"
                    : "orderActions.bulkNothingToTransfer",
                )
              : t(
                  kind === "confirmation"
                    ? "orderActions.bulkConfirmResult"
                    : "orderActions.bulkKolaybiResult",
                  { succeeded: response.queued_count, failed },
                ),
        });
      } else {
        const response = await api.bulkCreateShipments({
          provider: kind,
          order_public_ids: ids,
          idempotency_key: idempotencyKey(`toplu_${kind}`),
        });
        setFeedback({
          tone: response.created_count > 0 ? "success" : "error",
          text: response.message,
        });
      }
      reload();
    } catch (reason) {
      setFeedback({ tone: "error", text: errorText(reason) });
    } finally {
      setBulkBusy(null);
    }
  }

  const columns: Column<OrderSummary>[] = [
    {
      key: "select",
      header: "",
      mobile: "hidden",
      className: "w-10",
      cell: (row) => (
        <input
          type="checkbox"
          className="size-5 accent-primary"
          aria-label={t("orders.selectRow", { order: row.order_number })}
          checked={selected.has(row.public_id)}
          onChange={() => toggle(row.public_id)}
          data-testid="order-select"
        />
      ),
    },
    {
      key: "number",
      header: t("orders.number"),
      mobile: "title",
      cell: (row) => (
        <span className="flex items-center gap-3">
          <input
            type="checkbox"
            className="h-11 w-5 shrink-0 accent-primary md:hidden"
            aria-label={t("orders.selectRow", { order: row.order_number })}
            checked={selected.has(row.public_id)}
            onChange={() => toggle(row.public_id)}
            data-testid="order-select-mobile"
          />
          <button
            type="button"
            className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline md:min-h-0"
            onClick={() => setDetail(row.public_id)}
            data-testid="order-open"
          >
            {row.order_number}
          </button>
        </span>
      ),
    },
    {
      key: "customer",
      header: t("orders.customer"),
      cell: (row) => row.customer_full_name ?? t("common.none"),
    },
    {
      key: "status",
      header: t("orders.status"),
      mobile: "badge",
      cell: (row) => <StatusBadge value={row.status} />,
    },
    {
      key: "cargo",
      header: t("orders.cargo"),
      cell: (row) =>
        carrierLabel(row.cargo_provider, t("shipments.otherProvider")) ||
        t("common.none"),
    },
    {
      key: "amount",
      header: t("orders.amount"),
      className: "text-right tabular-nums",
      cell: (row) => formatMoney(row.total_amount, row.currency, i18n.language),
    },
    {
      key: "date",
      header: t("orders.date"),
      cell: (row) => formatDateTime(row.created_at, i18n.language),
    },
  ];

  return (
    <section data-testid="page-orders">
      <PageHeader
        title={t("orders.title")}
        description={t("orders.subtitle")}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="min-h-11"
                  data-testid="orders-export"
                >
                  <Download className="size-4" aria-hidden="true" />
                  {t("orders.export")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="min-h-10"
                  onSelect={() => void exportOrders("visible")}
                  data-testid="orders-export-visible"
                >
                  {t("orders.exportVisible")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="min-h-10"
                  onSelect={() => void exportOrders("filtered")}
                  data-testid="orders-export-filtered"
                >
                  {t("orders.exportFiltered")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="min-h-10"
                  disabled={selected.size === 0}
                  onSelect={() => void exportOrders("selected")}
                  data-testid="orders-export-selected"
                >
                  {t("orders.exportSelected")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="min-h-10"
                  disabled={selected.size === 0}
                  onSelect={() => void exportOrders("phones")}
                  data-testid="orders-export-phones"
                >
                  {t("orders.exportPhones")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              className="min-h-11"
              onClick={() => setCreating(true)}
              data-testid="order-new"
            >
              <Plus className="size-4" aria-hidden="true" />
              {t("orders.newOrder")}
            </Button>
          </>
        }
      />
      <ListToolbar
        query={list.query}
        placeholder={t("orders.searchPlaceholder")}
        onQuery={(q) => list.update({ q })}
        hasFilters={list.hasFilters}
        onClear={list.clear}
      >
        <FilterSelect
          testId="filter-status"
          label={t("orders.status")}
          value={status}
          onChange={(value) => list.update({ status: value })}
          options={[
            {
              value: "all",
              label: `${t("orders.status")}: ${t("common.all")}`,
            },
            ...orderStatuses.map((value) => ({
              value,
              label: t(`status.${value}`),
            })),
          ]}
        />
        <FilterSelect
          testId="filter-cargo"
          label={t("orders.cargo")}
          value={cargo}
          onChange={(value) => list.update({ cargo: value })}
          options={[
            { value: "all", label: `${t("orders.cargo")}: ${t("common.all")}` },
            { value: "ptt", label: "PTT" },
            { value: "surat", label: "Sürat" },
          ]}
        />
        <FilterSelect
          testId="filter-source"
          label={t("orders.filterSource")}
          value={source}
          onChange={(value) => list.update({ source: value })}
          options={[
            {
              value: "all",
              label: `${t("orders.filterSource")}: ${t("common.all")}`,
            },
            ...sources.map((value) => ({
              value,
              label: t(`orders.source_${value}`),
            })),
          ]}
        />
        <FilterSelect
          testId="filter-sort"
          label={t("orders.sort")}
          value={sort === "all" ? "newest" : sort}
          onChange={(value) =>
            list.update({ sort: value === "newest" ? null : value })
          }
          options={[
            { value: "newest", label: t("orders.sortNewest") },
            { value: "oldest", label: t("orders.sortOldest") },
            { value: "amount", label: t("orders.sortAmount") },
          ]}
        />
        <Input
          type="date"
          className="h-11 sm:w-40 md:h-9"
          aria-label={t("orders.filterFrom")}
          value={from === "all" ? "" : from}
          onChange={(event) =>
            list.update({ from: event.target.value || null })
          }
          data-testid="filter-from"
        />
        <Input
          type="date"
          className="h-11 sm:w-40 md:h-9"
          aria-label={t("orders.filterTo")}
          value={to === "all" ? "" : to}
          onChange={(event) => list.update({ to: event.target.value || null })}
          data-testid="filter-to"
        />
      </ListToolbar>
      <div className="mb-3 flex flex-col gap-2">
        {selected.size > 0 && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/50 p-2"
            data-testid="orders-bulk-bar"
          >
            <span className="px-1 text-sm font-medium">
              {t("orders.selectedCount", { count: selected.size })}
            </span>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={bulkBusy !== null}
              onClick={() => void bulk("confirmation")}
              data-testid="orders-bulk-confirmation"
            >
              <Phone className="size-4" aria-hidden="true" />
              {t("orderActions.bulkConfirmButton")}
            </Button>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={bulkBusy !== null}
              onClick={() => void bulk("kolaybi")}
              data-testid="orders-bulk-kolaybi"
            >
              {t("orderActions.bulkKolaybiButton")}
            </Button>
            {(["surat", "ptt"] as const).map((provider) => (
              <Button
                key={provider}
                variant="outline"
                className="min-h-11"
                disabled={bulkBusy !== null}
                onClick={() => void bulk(provider)}
                data-testid={`orders-bulk-${provider}`}
              >
                {bulkBusy === provider ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Truck className="size-4" aria-hidden="true" />
                )}
                {t(
                  provider === "surat"
                    ? "cargoCreate.transferToSurat"
                    : "cargoCreate.transferToPtt",
                )}
              </Button>
            ))}
            <Button
              variant="ghost"
              className="min-h-11"
              onClick={() => setSelected(new Set())}
            >
              <X className="size-4" aria-hidden="true" />
              {t("orders.clearSelection")}
            </Button>
          </div>
        )}
        {rows.length > 0 && (
          <Button
            variant="ghost"
            className="min-h-11 self-start"
            onClick={() =>
              setSelected(
                allVisible
                  ? new Set()
                  : new Set(rows.map((row) => row.public_id)),
              )
            }
            data-testid="orders-select-all"
          >
            {allVisible
              ? t("orders.clearSelection")
              : t("orders.selectAllVisible")}
          </Button>
        )}
        <FeedbackLine feedback={feedback} testId="orders-feedback" />
      </div>
      {error && !data ? (
        <ErrorState onRetry={reload} />
      ) : (
        <>
          <DataList
            testId="orders"
            rows={rows}
            columns={columns}
            rowKey={(row) => row.public_id}
            loading={loading}
          />
          {total > 0 && (
            <Pagination
              page={list.page}
              pages={pageCount(total)}
              total={total}
              onPage={(page) => list.update({ page }, false)}
            />
          )}
        </>
      )}
      <OrderFormSheet
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(order) => {
          setCreating(false);
          setFeedback({
            tone: "success",
            text: t("orders.created", { orderNumber: order.order_number }),
          });
          reload();
        }}
      />
      <OrderDetailSheet
        publicId={detail}
        onClose={() => setDetail(null)}
        onChanged={reload}
      />
    </section>
  );
}
