import type { ConversationSummary } from "@garanti-kulucka/shared";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { DataList, ErrorState, Pagination, StatusBadge, type Column } from "@/components/data-list";
import { FilterSelect, ListToolbar } from "@/components/list-toolbar";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/layout/page-header";
import { channelLabel, formatDateTime } from "@/lib/format";
import { paginate, useListParams } from "@/lib/list-params";
import { useQuery } from "@/lib/use-query";

/** The conversations API filters by channel/status but has no search or offset: search and paging run on the latest 200. */
export function MessagesPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const list = useListParams(["channel", "status"] as const);
  const { channel, status } = list.filters;
  const { data, error, loading, reload } = useQuery(`conversations:${channel}:${status}`, () =>
    api.listConversations({ limit: 200, ...(channel !== "all" ? { channel: channel === "facebook" ? "facebook,messenger" : channel } : {}), ...(status !== "all" ? { status } : {}) }),
  );
  const filtered = useMemo(() => {
    const needle = list.query.toLocaleLowerCase("tr-TR");
    const rows = data?.data ?? [];
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.customer?.full_name, row.customer?.phone, row.customer?.username, row.last_message_text, row.assigned_user_email].some((value) => value?.toLocaleLowerCase("tr-TR").includes(needle)),
    );
  }, [data, list.query]);
  const paged = paginate(filtered, list.page);

  const columns: Column<ConversationSummary>[] = [
    { key: "customer", header: t("messages.customer"), mobile: "title", cell: (row) => <span className="font-medium">{row.customer?.full_name ?? row.customer?.username ?? row.customer?.phone ?? t("common.none")}</span> },
    {
      key: "unread",
      header: t("messages.unread"),
      mobile: "badge",
      cell: (row) => (row.unread_count > 0 ? <Badge tone="success">{row.unread_count}</Badge> : <StatusBadge value={row.status} />),
    },
    { key: "channel", header: t("messages.channel"), cell: (row) => channelLabel(row.channel) },
    { key: "last", header: t("messages.lastMessage"), cell: (row) => <span title={row.last_message_text ?? undefined}>{row.last_message_text ?? t("messages.noMessage")}</span> },
    { key: "assigned", header: t("messages.assigned"), cell: (row) => (row.is_in_pool ? t("messages.pool") : row.assigned_user_email ?? t("common.none")) },
    { key: "updated", header: t("messages.updated"), cell: (row) => formatDateTime(row.last_message_at ?? row.updated_at, i18n.language) },
  ];

  return (
    <section data-testid="page-messages">
      <PageHeader title={t("messages.title")} description={t("messages.subtitle")} />
      <ListToolbar query={list.query} placeholder={t("messages.searchPlaceholder")} onQuery={(q) => list.update({ q })} hasFilters={list.hasFilters} onClear={list.clear}>
        <FilterSelect
          testId="filter-channel"
          label={t("messages.channel")}
          value={channel}
          onChange={(value) => list.update({ channel: value })}
          options={[
            { value: "all", label: `${t("messages.channel")}: ${t("common.all")}` },
            { value: "instagram", label: "Instagram" },
            { value: "facebook", label: "Facebook" },
          ]}
        />
        <FilterSelect
          testId="filter-status"
          label={t("common.status")}
          value={status}
          onChange={(value) => list.update({ status: value })}
          options={[
            { value: "all", label: `${t("common.status")}: ${t("common.all")}` },
            { value: "open", label: t("status.open") },
            { value: "closed", label: t("status.closed") },
          ]}
        />
      </ListToolbar>
      {error && !data ? (
        <ErrorState onRetry={reload} />
      ) : (
        <>
          <DataList testId="messages" rows={paged.rows} columns={columns} rowKey={(row) => row.public_id} loading={loading} />
          {paged.total > 0 && <Pagination page={paged.page} pages={paged.pages} total={paged.total} onPage={(page) => list.update({ page }, false)} />}
        </>
      )}
    </section>
  );
}
