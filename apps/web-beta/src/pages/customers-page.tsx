import type { CustomerSummary } from "@garanti-kulucka/shared";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "@/app/auth";
import { DataList, ErrorState, Pagination, type Column } from "@/components/data-list";
import { FilterSelect, ListToolbar } from "@/components/list-toolbar";
import { PageHeader } from "@/layout/page-header";
import { formatDate } from "@/lib/format";
import { paginate, useListParams } from "@/lib/list-params";
import { useQuery } from "@/lib/use-query";

const contactFilters: Record<string, (row: CustomerSummary) => boolean> = {
  phone: (row) => Boolean(row.phone),
  email: (row) => Boolean(row.email),
  notes: (row) => Boolean(row.notes?.trim()),
};

/** The customers API returns the latest records without search/offset; filtering and paging run in the browser. */
export function CustomersPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const list = useListParams(["contact"] as const);
  const { contact } = list.filters;
  const { data, error, loading, reload } = useQuery("customers", () => api.listCustomers(200));
  const filtered = useMemo(() => {
    const needle = list.query.toLocaleLowerCase("tr-TR");
    return (data?.data ?? []).filter(
      (row) =>
        (contact === "all" || contactFilters[contact]?.(row) !== false) &&
        (!needle || [row.full_name, row.phone, row.email, row.username].some((value) => value?.toLocaleLowerCase("tr-TR").includes(needle))),
    );
  }, [data, list.query, contact]);
  const paged = paginate(filtered, list.page);

  const columns: Column<CustomerSummary>[] = [
    { key: "name", header: t("customers.name"), mobile: "title", cell: (row) => (
        <Link
          to={`/musteriler/${encodeURIComponent(row.public_id)}`}
          className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline md:min-h-0"
          aria-label={t("customerDetail.openDetail", { name: row.full_name })}
          data-testid="customer-link"
        >
          {row.full_name}
        </Link>
      ),
    },
    { key: "phone", header: t("customers.phone"), cell: (row) => row.phone ?? t("common.none") },
    { key: "email", header: t("customers.email"), cell: (row) => row.email ?? t("common.none") },
    { key: "notes", header: t("customers.notes"), cell: (row) => <span title={row.notes ?? undefined}>{row.notes?.trim() || t("common.none")}</span> },
    { key: "updated", header: t("customers.updated"), cell: (row) => formatDate(row.updated_at, i18n.language) },
  ];

  return (
    <section data-testid="page-customers">
      <PageHeader title={t("customers.title")} description={t("customers.subtitle")} />
      <ListToolbar query={list.query} placeholder={t("customers.searchPlaceholder")} onQuery={(q) => list.update({ q })} hasFilters={list.hasFilters} onClear={list.clear}>
        <FilterSelect
          testId="filter-contact"
          label={t("common.filter")}
          value={contact}
          onChange={(value) => list.update({ contact: value })}
          options={[
            { value: "all", label: `${t("common.filter")}: ${t("common.all")}` },
            { value: "phone", label: t("customers.filterWithPhone") },
            { value: "email", label: t("customers.filterWithEmail") },
            { value: "notes", label: t("customers.filterWithNotes") },
          ]}
        />
      </ListToolbar>
      {error && !data ? (
        <ErrorState onRetry={reload} />
      ) : (
        <>
          <DataList testId="customers" rows={paged.rows} columns={columns} rowKey={(row) => row.public_id} loading={loading} />
          {paged.total > 0 && <Pagination page={paged.page} pages={paged.pages} total={paged.total} onPage={(page) => list.update({ page }, false)} />}
        </>
      )}
    </section>
  );
}
