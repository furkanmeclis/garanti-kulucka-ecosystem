import type { ConversationSummary } from "@garanti-kulucka/shared";
import { CheckCheck, ChevronDown, Loader2, MessageSquare, MoreVertical, ShoppingCart } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BrandIcon } from "@/components/brand-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tip } from "@/components/ui/tooltip";
import { channelConfig, channelKey } from "@/lib/chat";
import { cn } from "@/lib/utils";
import { InlineNote } from "./fields";
import { ChatMenuItems, chatMenuClass, chatTipClass, type TopBarProps } from "./top-bar";
import { MessageBubble, type ChatMessage } from "./message-bubble";

/** Legacy durum → header status word: açık = Çevrimiçi (green), beklemede = Beklemede, everything else = Çevrimdışı. */
function statusWord(status: string) {
  const value = status.toLowerCase();
  if (value === "open" || value === "acik") return { key: "chat.online", tone: "text-green-600 dark:text-green-400" } as const;
  if (value === "pending" || value === "waiting" || value === "beklemede") return { key: "chat.away", tone: "text-msg-subtle" } as const;
  return { key: "chat.offline", tone: "text-msg-subtle" } as const;
}

export function EmptyChat() {
  const { t } = useTranslation();
  return (
    <div className="hidden flex-1 items-center justify-center bg-msg-base lg:flex" data-testid="chat-empty">
      <div className="text-center">
        <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-msg-raised">
          <MessageSquare className="size-10 text-msg-faint" aria-hidden="true" />
        </div>
        <h3 className="text-lg font-medium text-msg-fg">{t("chat.emptyTitle")}</h3>
        <p className="mt-1 text-sm text-msg-subtle">{t("chat.emptySubtitle")}</p>
      </div>
    </div>
  );
}

export interface ChatPanelProps {
  conversation: ConversationSummary;
  name: string;
  initials: string;
  isManager: boolean;
  agentName: string;
  messages: ChatMessage[] | null;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onBack: () => void;
  markingRead: boolean;
  onMarkRead: () => void;
  customerNote: string;
  onSaveCustomerNote: (note: string) => Promise<void>;
  composer: ReactNode;
  /** Below lg the top strip is gone: its toggles and ⋮ entries live in the header menu. */
  menu: TopBarProps;
  /** Below xl there is no order column; the cart button opens the order sheet. */
  onOpenOrder: () => void;
}

const headerIcon = "inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-msg-muted hover:bg-msg-hover-raised max-lg:size-11";

/** Mobile ⋮ in the chat header (lg:hidden): TEMSİLCİ / GPT switches plus the top-strip menu entries. */
function HeaderMenu({ menu }: { menu: TopBarProps }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-haspopup="menu" aria-label={t("chat.menu")} className={cn(headerIcon, "lg:hidden")} data-testid="chat-header-menu-trigger">
          <MoreVertical className="size-5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" role="menu" className={cn(chatMenuClass, "w-64")} data-testid="chat-header-menu">
        <ChatMenuItems {...menu} withToggles onPicked={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/** Legacy middle column: 56px header (avatar, name, note, channel • status, Okundu Yap), thread on #0f172a, composer. */
export function ChatPanel(props: ChatPanelProps) {
  const { t } = useTranslation();
  const { conversation, messages } = props;
  const config = channelConfig[channelKey(conversation.channel)];
  const status = statusWord(conversation.status);
  const handle = conversation.customer?.username ? `(@${conversation.customer.username})` : conversation.customer?.phone ? `(${conversation.customer.phone})` : "";

  const scroller = useRef<HTMLDivElement | null>(null);
  const scrolledUp = useRef(false);
  const programmatic = useRef(false);
  const previous = useRef<{ conversation: string | null; first: string | null; count: number; height: number }>({ conversation: null, first: null, count: 0, height: 0 });

  const toBottom = useCallback((repeat: boolean) => {
    const go = () => {
      const element = scroller.current;
      if (!element) return;
      programmatic.current = true;
      element.scrollTop = element.scrollHeight;
      window.setTimeout(() => {
        programmatic.current = false;
      }, 80);
    };
    requestAnimationFrame(go);
    // Media loads late; legacy re-scrolls a few times so the newest bubble ends up in view.
    if (repeat) [100, 300, 700].forEach((delay) => window.setTimeout(go, delay));
  }, []);

  useLayoutEffect(() => {
    const element = scroller.current;
    const list = messages ?? [];
    const before = previous.current;
    const first = list[0]?.public_id ?? null;
    if (before.conversation !== conversation.public_id) {
      scrolledUp.current = false;
      if (list.length > 0) toBottom(true);
    } else if (before.count === 0 && list.length > 0) {
      toBottom(true);
    } else if (element && first !== before.first && list.length > before.count && before.first && list.some((message) => message.public_id === before.first)) {
      // Older page prepended: keep the reader on the same message.
      element.scrollTop = element.scrollHeight - before.height + element.scrollTop;
    } else if (list.length !== before.count && !scrolledUp.current) {
      toBottom(false);
    }
    previous.current = { conversation: conversation.public_id, first, count: list.length, height: element?.scrollHeight ?? 0 };
  }, [conversation.public_id, messages, toBottom]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-msg-base" data-testid="chat-panel">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-msg-border bg-msg-raised px-4 max-lg:box-content max-lg:gap-1 max-lg:px-2 max-lg:pt-[env(safe-area-inset-top)]" data-testid="chat-header">
        <div className="flex min-w-0 items-center gap-3 max-lg:gap-2">
          <button
            type="button"
            onClick={props.onBack}
            className="shrink-0 rounded-lg p-1 hover:bg-msg-hover-raised max-md:inline-flex max-md:size-11 max-md:items-center max-md:justify-center lg:hidden"
            aria-label={t("chat.back")}
            data-testid="chat-back"
          >
            <ChevronDown className="size-5 rotate-90 text-msg-muted" aria-hidden="true" />
          </button>
          <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white", config.avatar)}>{props.initials}</div>
          <div className="min-w-0">
            {/* Phones keep the title on one line inside the 56px header; the handle comes back from sm. */}
            <h2 className="flex min-w-0 items-center gap-1 leading-tight font-semibold text-msg-fg-strong sm:flex-wrap" data-testid="chat-title">
              <span className="truncate">{props.name}</span>
              {handle && <span className="hidden text-xs font-normal tracking-wide text-msg-subtle sm:inline">{handle}</span>}
              <InlineNote value={props.customerNote} onSave={props.onSaveCustomerNote} />
            </h2>
            <div className="flex items-center gap-2 text-xs text-msg-muted" data-testid="chat-channel">
              {config.brand && <BrandIcon brand={config.brand} className="size-3.5" title="" />}
              {config.brand ? config.label : t("chat.channelPanel")}
              <span aria-hidden="true">•</span>
              <span className={status.tone}>{t(status.key)}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {props.isManager && conversation.unread_count > 0 && (
            <Tip label={t("chat.markRead")} className={chatTipClass}>
            <button
              type="button"
              onClick={props.onMarkRead}
              disabled={props.markingRead}
              aria-label={t("chat.markRead")}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-50 max-lg:min-h-11 max-lg:min-w-11 max-lg:justify-center dark:text-emerald-400"
              data-testid="chat-mark-read"
            >
              {props.markingRead ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <CheckCheck className="size-3.5" aria-hidden="true" />}
              <span className="hidden sm:inline">{t("chat.markRead")}</span>
            </button>
            </Tip>
          )}
          <Tip label={t("chat.orderOpen")} className={chatTipClass}>
            <button type="button" onClick={props.onOpenOrder} aria-label={t("chat.orderOpen")} className={cn(headerIcon, "xl:hidden")} data-testid="chat-open-order">
              <ShoppingCart className="size-5" aria-hidden="true" />
            </button>
          </Tip>
          <HeaderMenu menu={props.menu} />
        </div>
      </div>

      <div
        ref={scroller}
        onScroll={() => {
          if (programmatic.current || !scroller.current) return;
          const element = scroller.current;
          // More than 150px above the bottom = the agent is reading history; stop auto-scrolling.
          scrolledUp.current = element.scrollHeight - element.scrollTop - element.clientHeight > 150;
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-msg-base px-4 py-3 msg-scrollbar max-lg:px-3"
        data-testid="message-scroll-area"
      >
        <div className="mx-auto max-w-4xl space-y-2">
          {props.hasOlder && (messages?.length ?? 0) > 0 && (
            <div className="flex justify-center py-2">
              <button
                type="button"
                onClick={props.onLoadOlder}
                disabled={props.loadingOlder}
                className="flex items-center gap-1.5 rounded-full bg-msg-chip/60 px-4 py-1.5 text-xs text-msg-fg-soft transition-colors hover:bg-msg-border-strong/60 disabled:opacity-50 max-md:min-h-11"
                data-testid="conversation-load-older"
              >
                {props.loadingOlder ? (
                  <>
                    <span className="size-3 animate-spin rounded-full border-2 border-msg-muted border-t-transparent" aria-hidden="true" />
                    {t("chat.loading")}
                  </>
                ) : (
                  t("chat.loadMoreMessages")
                )}
              </button>
            </div>
          )}
          {messages === null ? (
            <Loader2 className="mx-auto size-5 animate-spin text-msg-subtle" aria-label={t("chat.loading")} />
          ) : (
            messages.map((message) => <MessageBubble key={message.public_id} message={message} agentFallback={props.agentName} />)
          )}
        </div>
      </div>

      {props.composer}
    </div>
  );
}
