import { CheckCheck, Loader2, MoreVertical, Settings, StickyNote, UserCheck, Users, XCircle, RotateCcw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Switch } from "./chat-ui";

/** Legacy tooltip look (slate card) for the strip's hints. */
export const chatTipClass = "rounded-lg border border-msg-border bg-msg-raised px-2.5 py-1.5 text-xs text-msg-fg shadow-xl";
/** Legacy ⋮ dropdown card. */
export const chatMenuClass = "w-56 rounded-lg border border-msg-border bg-msg-raised p-0 py-1 text-msg-fg shadow-xl";

export interface OnlineAgent {
  public_id: string;
  first_name: string;
  last_name: string;
}

export interface TopBarProps {
  isManager: boolean;
  dailySales: number | null;
  stocks: Array<{ name: string; quantity: number }>;
  onlineAgents: OnlineAgent[];
  /** Manager clicks an agent chip to set that agent offline (legacy). */
  onAgentOffline?: (agent: OnlineAgent) => void;
  /** Human agent toggle: only Instagram/Messenger conversations can carry the Meta Human Agent tag. */
  agent: { enabled: boolean; value: boolean; busy: boolean; onToggle: () => void };
  ai: { value: boolean; busy: boolean; canToggle: boolean; onToggle: () => void };
  unreadTotal: number;
  marking: boolean;
  onSettings: () => void;
  onMarkAllRead: () => void;
  /** Beta extras for the open conversation (pool, status, conversation note) live in the same menu. */
  conversation: null | {
    inPool: boolean;
    closed: boolean;
    busy: boolean;
    onPool: () => void;
    onStatus: () => void;
    onNote: () => void;
  };
}

function MenuItem({ icon, children, onClick, disabled, testId, trailing }: { icon: ReactNode; children: ReactNode; onClick: () => void; disabled?: boolean; testId?: string; trailing?: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-msg-fg hover:bg-msg-hover-raised disabled:cursor-not-allowed disabled:opacity-40 max-md:min-h-11"
      data-testid={testId}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </button>
  );
}

/** Legacy full-width top strip (h-12) right of the list: daily sales / stock, online agents, TEMSİLCİ + GPT toggles, ⋮ menu. */
export function TopBar(props: TopBarProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-msg-border bg-msg-base px-4 max-lg:hidden" data-testid="chat-topbar">
      <div className="flex min-w-0 items-center gap-3">
        <div className="hidden items-center gap-3 md:flex">
          {props.isManager && props.dailySales !== null && (
            <Tip label={t("chat.dailySalesHint")} className={chatTipClass}>
              <div tabIndex={0} className="flex items-center gap-1.5" data-testid="daily-sales">
                <span className="text-[10px] font-medium tracking-wider text-msg-muted uppercase">{t("chat.dailySales")}</span>
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{props.dailySales}</span>
              </div>
            </Tip>
          )}
          {props.stocks.length > 0 && (
            <div className="flex items-center gap-2" data-testid="current-stock">
              <span className="text-[10px] font-medium tracking-wider text-msg-muted uppercase">{t("chat.currentStock")}</span>
              {props.stocks.map((stock) => (
                <Tip key={stock.name} label={stock.name} className={chatTipClass}>
                  <span tabIndex={0} className={cn("text-xs font-bold", stock.quantity > 10 ? "text-blue-600 dark:text-blue-400" : "text-red-600 dark:text-red-400")}>
                    {stock.quantity}
                  </span>
                </Tip>
              ))}
            </div>
          )}
        </div>

        {props.isManager && props.onlineAgents.length > 0 && (
          <div className="hidden max-w-[280px] items-center gap-1 overflow-x-auto border-l border-msg-border pl-3 msg-scrollbar-none lg:flex" aria-label={t("chat.onlineAgents")} data-testid="online-agents">
            {props.onlineAgents.map((agent) => (
              <Tip
                key={agent.public_id}
                side="bottom"
                className={chatTipClass}
                label={
                  <>
                    <span className="block font-medium">
                      {agent.first_name} {agent.last_name}
                    </span>
                    <span className="block text-[10px] text-emerald-600 dark:text-emerald-400">● {t("chat.online")}</span>
                    {props.onAgentOffline && <span className="block text-[10px] text-msg-subtle">{t("chat.agentOfflineHint")}</span>}
                  </>
                }
              >
                <button
                  type="button"
                  onClick={() => props.onAgentOffline?.(agent)}
                  disabled={!props.onAgentOffline}
                  aria-label={t("chat.agentOfflineAction", { name: `${agent.first_name} ${agent.last_name}`.trim() })}
                  className="flex shrink-0 items-center gap-1 rounded-full border border-emerald-600/40 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 hover:border-red-500/60 hover:bg-red-50 hover:text-red-700 disabled:cursor-default dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                  data-testid={`online-agent-${agent.public_id}`}
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                  {agent.first_name}
                </button>
              </Tip>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <ToggleRow kind="agent" {...props} />
        <div className="hidden h-5 w-px bg-msg-border-strong md:block" />
        <ToggleRow kind="ai" {...props} />
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button type="button" aria-haspopup="menu" aria-label={t("chat.menu")} className="rounded-lg p-2 text-msg-muted hover:bg-msg-hover-raised" data-testid="chat-menu-trigger">
              <MoreVertical className="size-5" aria-hidden="true" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" role="menu" className={chatMenuClass} data-testid="chat-menu">
            <ChatMenuItems {...props} onPicked={() => setMenuOpen(false)} />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

/**
 * The ⋮ menu entries. Desktop shows them under the top strip; below lg the strip is gone and the chat header's ⋮
 * shows the same entries plus the TEMSİLCİ / GPT switches (`withToggles`).
 */
export function ChatMenuItems(props: TopBarProps & { onPicked: () => void; withToggles?: boolean }) {
  const { t } = useTranslation();
  const run = (action: () => void) => () => {
    props.onPicked();
    action();
  };
  return (
    <>
      {props.withToggles && (
        <>
          <div className="flex items-center justify-between gap-2 px-3 py-1">
            <ToggleRow kind="agent" fill {...props} />
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-1">
            <ToggleRow kind="ai" fill {...props} />
          </div>
          <div className="my-1 border-t border-msg-border" />
        </>
      )}
      <MenuItem icon={<Settings className="size-4 text-msg-muted" aria-hidden="true" />} onClick={run(props.onSettings)} testId="chat-menu-settings">
        {t("chat.settings")}
      </MenuItem>
      {props.isManager && (
        <MenuItem
          icon={props.marking ? <Loader2 className="size-4 animate-spin text-emerald-500" aria-hidden="true" /> : <CheckCheck className="size-4 text-emerald-500" aria-hidden="true" />}
          onClick={run(props.onMarkAllRead)}
          disabled={props.marking || props.unreadTotal === 0}
          testId="chat-menu-mark-all-read"
          trailing={props.unreadTotal > 0 ? <span className="ml-auto text-[10px] font-semibold text-msg-subtle">{props.unreadTotal}</span> : null}
        >
          {t("chat.markAllRead")}
        </MenuItem>
      )}
      {props.conversation && (
        <>
          <div className="my-1 border-t border-msg-border" />
          <MenuItem
            icon={props.conversation.inPool ? <UserCheck className="size-4 text-msg-muted" aria-hidden="true" /> : <Users className="size-4 text-msg-muted" aria-hidden="true" />}
            onClick={run(props.conversation.onPool)}
            disabled={props.conversation.busy}
            testId={props.conversation.inPool ? "conversation-take" : "conversation-release"}
          >
            {props.conversation.inPool ? t("chat.takeOver") : t("chat.releaseToPool")}
          </MenuItem>
          <MenuItem
            icon={props.conversation.closed ? <RotateCcw className="size-4 text-msg-muted" aria-hidden="true" /> : <XCircle className="size-4 text-msg-muted" aria-hidden="true" />}
            onClick={run(props.conversation.onStatus)}
            disabled={props.conversation.busy}
            testId="conversation-status"
          >
            {props.conversation.closed ? t("chat.reopenConversation") : t("chat.closeConversation")}
          </MenuItem>
          <MenuItem icon={<StickyNote className="size-4 text-msg-muted" aria-hidden="true" />} onClick={run(props.conversation.onNote)} testId="conversation-note-open">
            {t("chat.conversationNote")}
          </MenuItem>
        </>
      )}
    </>
  );
}

/** TEMSİLCİ / GPT label + switch with its hint as a tooltip (strip and mobile ⋮ menu). */
function ToggleRow({ kind, fill = false, ...props }: TopBarProps & { kind: "agent" | "ai"; fill?: boolean }) {
  const { t } = useTranslation();
  const agent = kind === "agent";
  const hint = agent ? (props.agent.enabled ? t("chat.agentHint") : t("chat.agent")) : props.ai.canToggle ? t("chat.gptHint") : t("chat.gptAdminOnly");
  const on = agent ? props.agent.value : props.ai.value;
  return (
    <Tip label={hint} className={chatTipClass}>
      <div className={cn("flex items-center gap-1.5", fill && "flex-1 justify-between", agent && !props.agent.enabled && "opacity-40")}>
        <span className={cn("text-xs font-bold tracking-wider uppercase", on ? (agent ? "text-blue-600 dark:text-blue-400" : "text-emerald-600 dark:text-emerald-400") : "text-msg-subtle")}>
          {agent ? t("chat.agent") : t("chat.gpt")}
        </span>
        {agent ? (
          <Switch checked={props.agent.value} onChange={props.agent.onToggle} disabled={!props.agent.enabled || props.agent.busy} busy={props.agent.busy} tone="blue" label={t("chat.agent")} testId="human-agent-toggle" />
        ) : (
          <Switch checked={props.ai.value} onChange={props.ai.onToggle} disabled={!props.ai.canToggle || props.ai.busy} busy={props.ai.busy} label={t("chat.gptHint")} testId="gpt-toggle" />
        )}
      </div>
    </Tip>
  );
}
