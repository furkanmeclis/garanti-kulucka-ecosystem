import type { ConversationSummary } from "@garanti-kulucka/shared";
import { Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { DataList, ErrorState, Pagination, StatusBadge, type Column } from "@/components/data-list";
import { FilterSelect, ListToolbar } from "@/components/list-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/layout/page-header";
import { channelLabel, formatDateTime } from "@/lib/format";
import { paginate, useListParams } from "@/lib/list-params";
import { useQuery } from "@/lib/use-query";
import { ConversationSheet } from "./conversation-sheet";
import { ShortcutsSheet } from "./shortcuts-sheet";

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
  const [openId, setOpenId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, ConversationSummary>>({});
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const opened = openId ? (overrides[openId] ?? (data?.data ?? []).find((row) => row.public_id === openId) ?? null) : null;

  const columns: Column<ConversationSummary>[] = [
    {
      key: "customer",
      header: t("messages.customer"),
      mobile: "title",
      cell: (row) => (
        <button type="button" className="inline-flex min-h-11 min-w-11 items-center text-left font-medium text-primary underline-offset-4 hover:underline md:min-h-0" onClick={() => setOpenId(row.public_id)} data-testid="conversation-open">
          {row.customer?.full_name ?? row.customer?.username ?? row.customer?.phone ?? t("common.none")}
        </button>
      ),
    },
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
      <PageHeader
        title={t("messages.title")}
        description={t("messages.subtitle")}
        actions={
          <Button variant="outline" className="min-h-11" onClick={() => setShortcutsOpen(true)} data-testid="shortcuts-manage">
            <Zap className="size-4" aria-hidden="true" />
            {t("inbox.shortcutsManage")}
          </Button>
        }
      />
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
          <DataList testId="messages" rows={paged.rows.map((row) => overrides[row.public_id] ?? row)} columns={columns} rowKey={(row) => row.public_id} loading={loading} />
          {paged.total > 0 && <Pagination page={paged.page} pages={paged.pages} total={paged.total} onPage={(page) => list.update({ page }, false)} />}
        </>
      )}
      <ConversationSheet
        conversation={opened}
        onClose={() => setOpenId(null)}
        onChanged={(next) => {
          if (next) setOverrides((prev) => ({ ...prev, [next.public_id]: next }));
          else reload();
        }}
      />
      <ShortcutsSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </section>
  );
}
