import type { ShipmentSummary } from "@garanti-kulucka/shared";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { DataList, ErrorState, Pagination, StatusBadge, type Column } from "@/components/data-list";
import { FilterSelect, ListToolbar } from "@/components/list-toolbar";
import { PageHeader } from "@/layout/page-header";
import { carrierLabel, formatDateTime } from "@/lib/format";
import { pageCount, pageSize, useListParams } from "@/lib/list-params";
import { useQuery } from "@/lib/use-query";

const shipmentStatuses = ["in_transit", "delivered", "returned"] as const;

export function ShipmentsPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const list = useListParams(["status", "provider"] as const);
  const { status, provider } = list.filters;
  const key = JSON.stringify({ q: list.query, page: list.page, status, provider });
  const { data, error, loading, reload } = useQuery(`shipments:${key}`, () =>
    api.listShipments({
      ...(list.query ? { search: list.query } : {}),
      ...(status !== "all" ? { status } : {}),
      ...(provider !== "all" ? { provider } : {}),
      limit: pageSize,
      offset: list.offset,
    }),
  );
  const rows = data?.data ?? [];
  const total = data?.meta?.total_count ?? rows.length;
  const other = t("shipments.otherProvider");

  const columns: Column<ShipmentSummary>[] = [
    { key: "tracking", header: t("shipments.tracking"), mobile: "title", cell: (row) => <span className="font-medium">{row.tracking_number ?? row.barcode_number ?? t("common.none")}</span> },
    { key: "status", header: t("shipments.status"), mobile: "badge", cell: (row) => <StatusBadge value={row.status} /> },
    { key: "recipient", header: t("shipments.recipient"), cell: (row) => row.recipient_name ?? row.customer_full_name ?? t("common.none") },
    { key: "provider", header: t("shipments.provider"), cell: (row) => carrierLabel(row.provider, other) },
    { key: "location", header: t("shipments.location"), cell: (row) => [row.recipient_district, row.recipient_city].filter(Boolean).join(", ") || t("common.none") },
    { key: "order", header: t("shipments.order"), cell: (row) => row.order_number ?? t("common.none") },
    { key: "event", header: t("shipments.lastEvent"), cell: (row) => <span title={row.last_event_text ?? undefined}>{row.last_event_text ?? t("common.none")}</span> },
    { key: "updated", header: t("messages.updated"), mobile: "hidden", cell: (row) => formatDateTime(row.updated_at, i18n.language) },
  ];

  return (
    <section data-testid="page-shipments">
      <PageHeader title={t("shipments.title")} description={t("shipments.subtitle")} />
      <ListToolbar query={list.query} placeholder={t("shipments.searchPlaceholder")} onQuery={(q) => list.update({ q })} hasFilters={list.hasFilters} onClear={list.clear}>
        <FilterSelect
          testId="filter-status"
          label={t("shipments.status")}
          value={status}
          onChange={(value) => list.update({ status: value })}
          options={[{ value: "all", label: `${t("shipments.status")}: ${t("common.all")}` }, ...shipmentStatuses.map((value) => ({ value, label: t(`status.${value}`) }))]}
        />
        <FilterSelect
          testId="filter-provider"
          label={t("shipments.provider")}
          value={provider}
          onChange={(value) => list.update({ provider: value })}
          options={[
            { value: "all", label: `${t("shipments.provider")}: ${t("common.all")}` },
            { value: "ptt", label: "PTT" },
            { value: "surat", label: "Sürat" },
            { value: "other", label: other },
          ]}
        />
      </ListToolbar>
      {error && !data ? (
        <ErrorState onRetry={reload} />
      ) : (
        <>
          <DataList testId="shipments" rows={rows} columns={columns} rowKey={(row) => row.public_id} loading={loading} />
          {total > 0 && <Pagination page={list.page} pages={pageCount(total)} total={total} onPage={(page) => list.update({ page }, false)} />}
        </>
      )}
    </section>
  );
}
