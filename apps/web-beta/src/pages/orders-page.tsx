import type { OrderSummary } from "@garanti-kulucka/shared";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { DataList, ErrorState, Pagination, StatusBadge, type Column } from "@/components/data-list";
import { FilterSelect, ListToolbar } from "@/components/list-toolbar";
import { PageHeader } from "@/layout/page-header";
import type { OrderListQuery } from "@/lib/api";
import { carrierLabel, formatDateTime, formatMoney } from "@/lib/format";
import { pageCount, pageSize, useListParams } from "@/lib/list-params";
import { useQuery } from "@/lib/use-query";

const orderStatuses = ["pending_confirmation", "confirmed", "preparing", "shipped", "delivered", "cancelled", "returned"] as const;
const sorts: Record<string, Pick<OrderListQuery, "sort_by" | "sort_direction">> = {
  newest: { sort_by: "created_at", sort_direction: "desc" },
  oldest: { sort_by: "created_at", sort_direction: "asc" },
  amount: { sort_by: "total_amount", sort_direction: "desc" },
};

export function OrdersPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const list = useListParams(["status", "cargo", "sort"] as const);
  const { status, cargo, sort } = list.filters;
  const key = JSON.stringify({ q: list.query, page: list.page, status, cargo, sort });
  const { data, error, loading, reload } = useQuery(`orders:${key}`, () =>
    api.listOrders({
      ...(list.query ? { search: list.query } : {}),
      ...(status !== "all" ? { status } : {}),
      ...(cargo !== "all" ? { cargo_provider: cargo } : {}),
      ...(sorts[sort] ?? sorts.newest),
      limit: pageSize,
      offset: list.offset,
    }),
  );
  const rows = data?.data ?? [];
  const total = data?.meta?.total_count ?? rows.length;

  const columns: Column<OrderSummary>[] = [
    { key: "number", header: t("orders.number"), mobile: "title", cell: (row) => <span className="font-medium">{row.order_number}</span> },
    { key: "customer", header: t("orders.customer"), cell: (row) => row.customer_full_name ?? t("common.none") },
    { key: "status", header: t("orders.status"), mobile: "badge", cell: (row) => <StatusBadge value={row.status} /> },
    { key: "cargo", header: t("orders.cargo"), cell: (row) => carrierLabel(row.cargo_provider, t("shipments.otherProvider")) || t("common.none") },
    { key: "amount", header: t("orders.amount"), className: "text-right tabular-nums", cell: (row) => formatMoney(row.total_amount, row.currency, i18n.language) },
    { key: "date", header: t("orders.date"), cell: (row) => formatDateTime(row.created_at, i18n.language) },
  ];

  return (
    <section data-testid="page-orders">
      <PageHeader title={t("orders.title")} description={t("orders.subtitle")} />
      <ListToolbar query={list.query} placeholder={t("orders.searchPlaceholder")} onQuery={(q) => list.update({ q })} hasFilters={list.hasFilters} onClear={list.clear}>
        <FilterSelect
          testId="filter-status"
          label={t("orders.status")}
          value={status}
          onChange={(value) => list.update({ status: value })}
          options={[{ value: "all", label: `${t("orders.status")}: ${t("common.all")}` }, ...orderStatuses.map((value) => ({ value, label: t(`status.${value}`) }))]}
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
          testId="filter-sort"
          label={t("orders.sort")}
          value={sort === "all" ? "newest" : sort}
          onChange={(value) => list.update({ sort: value === "newest" ? null : value })}
          options={[
            { value: "newest", label: t("orders.sortNewest") },
            { value: "oldest", label: t("orders.sortOldest") },
            { value: "amount", label: t("orders.sortAmount") },
          ]}
        />
      </ListToolbar>
      {error && !data ? (
        <ErrorState onRetry={reload} />
      ) : (
        <>
          <DataList testId="orders" rows={rows} columns={columns} rowKey={(row) => row.public_id} loading={loading} />
          {total > 0 && <Pagination page={list.page} pages={pageCount(total)} total={total} onPage={(page) => list.update({ page }, false)} />}
        </>
      )}
    </section>
  );
}
