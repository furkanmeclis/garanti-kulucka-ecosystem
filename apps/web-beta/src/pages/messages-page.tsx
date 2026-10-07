import type { ConversationSummary } from "@garanti-kulucka/shared";
import { CheckCheck, Loader2, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { errorText, FeedbackLine, type Feedback } from "./accounting-shared";
import { ConversationSheet } from "./conversation-sheet";
import { ShortcutsSheet } from "./shortcuts-sheet";

/** Conversations loaded per request; "Daha fazla konuşma yükle" fetches the next offset batch. */
export const conversationBatchSize = 100;

/**
 * Channel/status filters and the search box (`?q=`) go to the conversations API (legacy Mesajlar arama:
 * customer name / phone / username or last message); batches load by offset and page locally.
 */
export function MessagesPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const list = useListParams(["channel", "status"] as const);
  const { channel, status } = list.filters;
  const search = list.query.trim();
  const channelQuery = channel !== "all" ? { channel: channel === "facebook" ? "facebook,messenger" : channel } : {};
  const queryKey = `conversations:${channel}:${status}:${search}`;
  const { data, error, loading, reload } = useQuery(queryKey, () =>
    api.listConversations({ limit: conversationBatchSize, ...channelQuery, ...(status !== "all" ? { status } : {}), ...(search ? { search } : {}) }),
  );
  const summary = useQuery("conversations:summary", () => api.conversationSummary());
  // Extra batches appended by "load more"; a new filter/search starts over from the first batch.
  const [more, setMore] = useState<ConversationSummary[]>([]);
  const [lastBatchFull, setLastBatchFull] = useState<boolean | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [marking, setMarking] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  useEffect(() => {
    setMore([]);
    setLastBatchFull(null);
  }, [queryKey]);
  const filtered = useMemo(() => {
    const first = data?.data ?? [];
    const seen = new Set(first.map((row) => row.public_id));
    return [...first, ...more.filter((row) => !seen.has(row.public_id))];
  }, [data, more]);
  const hasMore = lastBatchFull ?? (data?.data.length ?? 0) >= conversationBatchSize;
  const paged = paginate(filtered, list.page);

  async function loadMore() {
    if (loadingMore) return;
    const key = queryKey;
    setLoadingMore(true);
    setFeedback(null);
    try {
      const batch = await api.listConversations({
        limit: conversationBatchSize,
        offset: filtered.length,
        ...channelQuery,
        ...(status !== "all" ? { status } : {}),
        ...(search ? { search } : {}),
      });
      if (key !== queryKey) return;
      setMore((prev) => [...prev, ...batch.data]);
      setLastBatchFull(batch.data.length >= conversationBatchSize);
    } catch (reason) {
      setFeedback({ tone: "error", text: t("messages.loadMoreFailed", { error: errorText(reason) }) });
    } finally {
      setLoadingMore(false);
    }
  }

  // Legacy count for the confirm: every unread for "all", otherwise the loaded unread rows of that channel.
  const unreadForFilter =
    channel === "all"
      ? (summary.data?.unread_count ?? filtered.filter((row) => row.unread_count > 0).length)
      : filtered.filter((row) => row.unread_count > 0).length;

  async function markAllRead() {
    if (marking || unreadForFilter === 0) return;
    if (!window.confirm(t("messages.markAllReadConfirm", { count: unreadForFilter }))) return;
    setMarking(true);
    setFeedback(null);
    try {
      const result = await api.markAllConversationsRead(channel === "all" ? undefined : channel);
      setFeedback({ tone: "success", text: t("messages.markAllReadDone", { count: result.updated }) });
      setOverrides({});
      setMore([]);
      setLastBatchFull(null);
      reload();
      summary.reload();
    } catch (reason) {
      setFeedback({ tone: "error", text: t("messages.markAllReadFailed", { error: errorText(reason) }) });
    } finally {
      setMarking(false);
    }
  }
  // `?konusma=<public_id>` deep link (kargo pipeline, notifications) opens that conversation.
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("konusma"));
  const [overrides, setOverrides] = useState<Record<string, ConversationSummary>>({});
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const opened = openId ? (overrides[openId] ?? filtered.find((row) => row.public_id === openId) ?? null) : null;

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
          <>
            <Button variant="outline" className="min-h-11" disabled={marking || unreadForFilter === 0} onClick={() => void markAllRead()} data-testid="messages-mark-all-read">
              {marking ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCheck className="size-4" aria-hidden="true" />}
              {t("messages.markAllRead")}
            </Button>
            <Button variant="outline" className="min-h-11" onClick={() => setShortcutsOpen(true)} data-testid="shortcuts-manage">
              <Zap className="size-4" aria-hidden="true" />
              {t("inbox.shortcutsManage")}
            </Button>
          </>
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
      {feedback && (
        <div className="mb-3">
          <FeedbackLine feedback={feedback} testId="messages-feedback" />
        </div>
      )}
      {error && !data ? (
        <ErrorState onRetry={reload} />
      ) : (
        <>
          <DataList testId="messages" rows={paged.rows.map((row) => overrides[row.public_id] ?? row)} columns={columns} rowKey={(row) => row.public_id} loading={loading} />
          {paged.total > 0 && <Pagination page={paged.page} pages={paged.pages} total={paged.total} onPage={(page) => list.update({ page }, false)} />}
          {hasMore && (
            <div className="mt-3 flex justify-center">
              <Button variant="outline" className="min-h-11" disabled={loadingMore} onClick={() => void loadMore()} data-testid="messages-load-more">
                {loadingMore && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                {loadingMore ? t("messages.loadingMore") : t("messages.loadMore")}
              </Button>
            </div>
          )}
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
