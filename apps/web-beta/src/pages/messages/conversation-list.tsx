import type { ConversationSummary } from "@garanti-kulucka/shared";
import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDown, Filter, MessageSquare, Search, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BrandIcon, type Brand } from "@/components/brand-icons";
import { Input } from "@/components/ui/input";
import { SelectContent, SelectItem } from "@/components/ui/select";
import { Tip } from "@/components/ui/tooltip";
import { channelConfig, channelKey, listTime, type ChannelFilter } from "@/lib/chat";
import { cn } from "@/lib/utils";
import { chatTipClass } from "./top-bar";

/** Legacy avatar: channel-coloured initials with the channel's brand mark in the corner. */
export function ConversationAvatar({ channel, initials }: { channel: string; initials: string }) {
  const { t } = useTranslation();
  const config = channelConfig[channelKey(channel)];
  return (
    <div className="relative shrink-0">
      <div className={cn("flex size-9 items-center justify-center rounded-full text-xs font-semibold text-white", config.avatar)}>{initials}</div>
      {config.brand && (
        <Tip label={t("chat.channelHint", { channel: config.label })} className={chatTipClass}>
          <span className="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full bg-msg-base ring-1 ring-msg-base" data-testid="avatar-channel">
            <BrandIcon brand={config.brand} className="size-3" />
          </span>
        </Tip>
      )}
    </div>
  );
}

const channelSelectTone: Record<ChannelFilter, string> = {
  all: "border-msg-border bg-msg-raised text-msg-muted",
  whatsapp: "border-green-500 bg-green-500/20 text-green-700 dark:text-green-400",
  instagram: "border-pink-500 bg-pink-500/20 text-pink-700 dark:text-pink-400",
  messenger: "border-blue-500 bg-blue-500/20 text-blue-700 dark:text-blue-400",
};

export interface ConversationListProps {
  rows: ConversationSummary[];
  selectedId: string | null;
  hidden: boolean;
  nameOf: (row: ConversationSummary) => string;
  initialsOf: (row: ConversationSummary) => string;
  onSelect: (row: ConversationSummary) => void;
  unreadOnly: boolean;
  onToggleUnread: () => void;
  unreadTotal: number;
  poolCount: number | null;
  channel: ChannelFilter;
  onChannel: (channel: ChannelFilter) => void;
  channelCounts: Record<ChannelFilter, number>;
  search: string;
  onSearch: (value: string) => void;
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  offline: boolean;
  onGoOnline?: () => void;
}

/** Legacy channel select entries (Facebook covers both stored Messenger names). */
const channelOptionsOf = (allLabel: string): Array<{ value: ChannelFilter; label: string; brand: Brand | null }> => [
  { value: "all", label: allLabel, brand: null },
  { value: "whatsapp", label: "WhatsApp", brand: "whatsapp" },
  { value: "instagram", label: "Instagram", brand: "instagram" },
  { value: "messenger", label: "Facebook", brand: "facebook" },
];

/** Legacy left pane (lg: w-96): filter strip (h-12) and 56px conversation rows. */
export function ConversationList(props: ConversationListProps) {
  const { t, i18n } = useTranslation();
  const { rows, selectedId, channel } = props;
  const channelOptions = channelOptionsOf(t("chat.allChannels"));
  return (
    <div className={cn("min-h-0 w-full flex-1 flex-col bg-msg-base lg:w-96 lg:flex-none", props.hidden ? "hidden lg:flex" : "flex")} data-testid="conversation-list">
      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-msg-border bg-msg-base px-3">
        <button
          type="button"
          onClick={props.onToggleUnread}
          aria-pressed={props.unreadOnly}
          className={cn(
            "inline-flex shrink-0 items-center rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors max-lg:min-h-11",
            props.unreadOnly ? "border-msg-primary bg-msg-primary/20 text-msg-primary-text" : "border-msg-border bg-msg-raised text-msg-muted hover:bg-msg-hover-raised hover:text-msg-fg",
          )}
          data-testid="filter-unread"
        >
          {t("chat.unread")}
          {props.unreadTotal > 0 && (
            <Tip label={t("chat.unreadTotalHint", { count: props.unreadTotal })} className={chatTipClass}>
              <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-msg-primary/30 px-1 text-[10px] font-bold text-msg-primary-text" data-testid="filter-unread-count">
                {props.unreadTotal}
              </span>
            </Tip>
          )}
        </button>

        {props.poolCount !== null && props.poolCount > 0 && (
          <Tip label={t("chat.poolHint")}>
            <span tabIndex={0} className="shrink-0 rounded-md border border-orange-500/50 bg-orange-500/15 px-2 py-1.5 text-[10px] font-semibold text-orange-600 dark:text-orange-400" data-testid="pool-count">
              {t("chat.poolBadge")} ({props.poolCount})
            </span>
          </Tip>
        )}

        <SelectPrimitive.Root value={channel} onValueChange={(value) => props.onChannel(value as ChannelFilter)}>
          {/* Legacy chip look; below 400px it collapses to the channel mark so the search gets the room. */}
          <SelectPrimitive.Trigger
            aria-label={`${t("chat.channelFilter")}: ${channelOptions.find((option) => option.value === channel)?.label ?? ""}`}
            className={cn(
              "relative inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border py-1.5 pr-7 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-1 focus-visible:ring-msg-primary max-lg:min-h-11 max-lg:text-sm max-[399px]:w-11 max-[399px]:justify-center max-[399px]:px-0",
              channel === "all" ? "pl-2.5" : "pl-2",
              channelSelectTone[channel],
            )}
            data-testid="channel-filter"
          >
            {channel === "all" ? (
              <Filter className="hidden size-4 max-[399px]:block" aria-hidden="true" />
            ) : (
              <BrandIcon brand={channelConfig[channel].brand ?? "messenger"} className="size-3.5 max-[399px]:size-4" title="" />
            )}
            <span className="max-[399px]:sr-only">
              {channelOptions.find((option) => option.value === channel)?.label} ({props.channelCounts[channel]})
            </span>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-1.5 size-3 -translate-y-1/2 text-msg-subtle max-[399px]:hidden" aria-hidden="true" />
          </SelectPrimitive.Trigger>
          <SelectContent align="start" className="border-msg-border bg-msg-raised text-msg-fg" data-testid="channel-filter-options">
            {channelOptions.map((option) => (
              <SelectItem key={option.value} value={option.value} className="min-h-9 gap-2 text-xs focus:bg-msg-hover-raised focus:text-msg-fg max-lg:min-h-11 max-lg:text-sm" data-testid={`channel-filter-${option.value}`}>
                <span className="flex items-center gap-2">
                  {option.brand ? <BrandIcon brand={option.brand} className="size-3.5" title="" /> : <Filter className="size-3.5 text-msg-muted" aria-hidden="true" />}
                  {option.label} ({props.channelCounts[option.value]})
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </SelectPrimitive.Root>

        <div className="relative min-w-0 flex-1">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-msg-subtle" aria-hidden="true" />
          <Input
            unstyled
            type="search"
            value={props.search}
            onChange={(event) => props.onSearch(event.target.value)}
            placeholder={t("chat.search")}
            aria-label={t("chat.searchLabel")}
            className="h-10 w-full rounded-md border border-msg-border bg-msg-raised pr-3 pl-8 text-sm text-msg-fg placeholder:text-msg-subtle focus:border-msg-primary focus:ring-1 focus:ring-msg-primary focus:outline-none max-lg:h-11 max-lg:text-base [&::-webkit-search-cancel-button]:hidden"
            data-testid="conversation-search"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-r border-msg-border">
        <div className="min-h-0 flex-1 overflow-y-auto msg-scrollbar" data-testid="conversation-rows">
          {props.offline ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center text-msg-subtle" data-testid="conversations-offline">
              <WifiOff className="mx-auto mb-4 size-12 text-msg-faint opacity-50" aria-hidden="true" />
              <p className="text-sm font-medium text-msg-muted">{t("chat.offlineTitle")}</p>
              <p className="mt-1 text-xs text-msg-subtle">{t("chat.offlineBody")}</p>
              {props.onGoOnline && (
                <button
                  type="button"
                  onClick={props.onGoOnline}
                  className="mt-4 rounded-lg border border-msg-primary/40 bg-msg-primary/10 px-3 py-1.5 text-xs font-medium text-msg-primary-text hover:bg-msg-primary/20 max-md:min-h-11"
                  data-testid="conversations-go-online"
                >
                  {t("chat.goOnline")}
                </button>
              )}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-msg-subtle" data-testid="conversations-empty">
              <MessageSquare className="mx-auto mb-2 size-8 text-msg-faint" aria-hidden="true" />
              <p className="text-sm">{props.loading ? t("chat.loading") : t("chat.noConversations")}</p>
            </div>
          ) : (
            rows.map((row) => {
              const active = row.public_id === selectedId;
              const unread = row.unread_count > 0;
              const name = props.nameOf(row);
              const prefix = row.last_message_sender_type === "ai" ? "🤖 " : row.last_message_sender_type === "user" ? t("chat.agentPrefix") : "";
              return (
                <button
                  type="button"
                  key={row.public_id}
                  onClick={() => props.onSelect(row)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "flex h-14 w-full cursor-pointer items-center gap-2 border-b border-msg-border/50 px-3 text-left transition-colors hover:bg-msg-hover",
                    active && "border-l-2 border-l-msg-primary bg-msg-primary/10",
                  )}
                  data-testid="conversation-row"
                  data-channel={row.channel}
                  data-id={row.public_id}
                >
                  <ConversationAvatar channel={row.channel} initials={props.initialsOf(row)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn("truncate text-base", unread ? "font-bold text-msg-fg-max" : "font-normal text-msg-muted")} data-testid="conversation-name">
                        {name}
                        {row.is_in_pool && (
                          <Tip label={t("chat.poolRowHint")} className={chatTipClass}>
                            <span className="ml-1.5 inline-flex items-center rounded bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-orange-600 dark:text-orange-400">{t("chat.poolBadge")}</span>
                          </Tip>
                        )}
                      </span>
                      <span className={cn("shrink-0 text-xs", unread ? "font-medium text-msg-fg-soft" : "text-msg-faint")}>{listTime(row.last_message_at ?? row.updated_at, i18n.language, t("chat.yesterday"))}</span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between">
                      <p className={cn("truncate text-sm", unread ? "font-semibold text-msg-fg-strong" : "text-msg-subtle")}>
                        {prefix}
                        {row.last_message_text ?? ""}
                      </p>
                      {unread && (
                        <Tip label={t("chat.unreadCountHint", { count: row.unread_count })} className={chatTipClass}>
                          <span className="ml-2 flex size-5 shrink-0 items-center justify-center rounded-full bg-msg-primary text-[11px] font-bold text-msg-on-primary" data-testid="conversation-unread">
                            {row.unread_count}
                          </span>
                        </Tip>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {props.hasMore && !props.search.trim() && !props.offline && (
          <button
            type="button"
            onClick={props.onLoadMore}
            disabled={props.loadingMore}
            className="mx-3 my-2 flex shrink-0 items-center justify-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 py-2.5 text-xs font-medium text-emerald-700 transition-all duration-200 hover:border-emerald-500/40 hover:bg-emerald-500/20 hover:text-emerald-800 disabled:opacity-50 max-md:min-h-11 dark:text-emerald-300 dark:hover:text-emerald-200"
            data-testid="conversations-load-more"
          >
            {props.loadingMore ? (
              <>
                <span className="size-3 animate-spin rounded-full border-[1.5px] border-emerald-400/60 border-t-transparent" aria-hidden="true" />
                <span>{t("chat.loading")}</span>
              </>
            ) : (
              <>
                <ChevronDown className="size-3.5" aria-hidden="true" />
                <span>{t("chat.loadOlderConversations")}</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
