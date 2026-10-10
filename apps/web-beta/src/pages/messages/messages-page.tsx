import { panelRoleOf, type ConversationListCounts, type ConversationSummary, type OrderSummary } from "@garanti-kulucka/shared";
import { Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/app/auth";
import { Textarea } from "@/components/ui/textarea";
import { useImmersive } from "@/layout/shell-chrome";
import {
  channelKey,
  channelQuery,
  conversationName,
  initialsOf,
  isSocialChannel,
  mergeConversations,
  mergeThread,
  nextConversation,
  orderFollowUp,
  pendingPrefix,
  realPhone,
  stockBadges,
  visibleConversations,
  type ChannelFilter,
} from "@/lib/chat";
import type { MessageShortcut } from "@/lib/inbox";
import type { OrderRow, ProductOption } from "@/lib/orders";
import { usePolling } from "@/lib/use-polling";
import { cn } from "@/lib/utils";
import { errorText } from "../accounting-shared";
import { ChatPanel, EmptyChat } from "./chat-panel";
import { ChatDialog, ChatToastProvider, Switch, useChatConfirm, useChatToast } from "./chat-ui";
import { Composer, type ComposerMedia } from "./composer";
import { ConversationList } from "./conversation-list";
import type { ChatMessage } from "./message-bubble";
import { OrderPanel, OrderSheet, type PanelMode } from "./order-panel";
import type { OrderPrefill } from "./order-create-form";
import { TopBar, type OnlineAgent, type TopBarProps } from "./top-bar";

/** Conversations per request (API max 200); "Daha Önceki Sohbetleri Gör" loads the next batch by offset. */
export const conversationBatchSize = 100;
/** Legacy thread page size (`/api/mesajlar/:id?limit=100`). */
export const messagePageSize = 100;
const listPollMs = 10_000;
const threadPollMs = 5_000;
const agentsPollMs = 30_000;
export const autoOpenStorageKey = "garanti-beta-chat-auto-open";

function readAutoOpen() {
  try {
    return window.localStorage.getItem(autoOpenStorageKey) === "1";
  } catch {
    return false;
  }
}

interface CustomerInfo {
  conversationId: string;
  customerPublicId: string | null;
  notes: string;
  city: string;
  district: string;
  address: string;
}

export function MessagesPage() {
  return (
    <ChatToastProvider>
      <MessagesWorkspace />
    </ChatToastProvider>
  );
}

/** Legacy MesajlarPage: list (w-96) | top strip + chat + order panel (w-80, xl+). */
function MessagesWorkspace() {
  const { t } = useTranslation();
  const { api, user, updateUser } = useAuth();
  const toast = useChatToast();
  const confirm = useChatConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const isManager = panelRoleOf(user?.role) === "manager";
  const offline = !isManager && user?.is_online !== true;
  const agentName = isManager ? "Yönetici" : user?.first_name || t("chat.agentLabel");

  /* ------------------------------------------------------------ conversation list */
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [channel, setChannel] = useState<ChannelFilter>("all");
  // `?q=` (global search, older links) pre-fills the list search.
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [rows, setRows] = useState<ConversationSummary[]>([]);
  const [extra, setExtra] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Inbox-wide counters (unread / pool / per channel) that ride along with every list response. */
  const [counts, setCounts] = useState<ConversationListCounts | null>(null);
  const listKey = useRef(0);
  // The "Okunmamış" filter runs on the server, so every batch (and "load more") is already unread-only.
  const listQuery = useMemo(() => ({ ...channelQuery(channel), ...(unreadOnly ? { unread: true } : {}) }), [channel, unreadOnly]);

  const fetchFirstBatch = useCallback(
    async (reset: boolean) => {
      const key = listKey.current;
      try {
        const batch = await api.listConversations({ limit: conversationBatchSize, ...listQuery });
        if (batch.meta?.counts) setCounts(batch.meta.counts);
        if (key !== listKey.current) return;
        setRows((prev) => (reset ? batch.data : mergeConversations(prev, batch.data)));
        if (reset) setHasMore(batch.data.length >= conversationBatchSize);
      } catch {
        if (reset) toast.error(t("chat.loadFailed"));
      } finally {
        if (key === listKey.current) setLoading(false);
      }
    },
    [api, listQuery, t, toast],
  );
  const refreshCounts = useCallback(() => void fetchFirstBatch(false), [fetchFirstBatch]);

  useEffect(() => {
    listKey.current += 1;
    setLoading(true);
    setRows([]);
    void fetchFirstBatch(true);
  }, [fetchFirstBatch]);
  usePolling(() => void fetchFirstBatch(false), listPollMs);

  async function loadMore() {
    if (loadingMore) return;
    const key = listKey.current;
    setLoadingMore(true);
    try {
      const batch = await api.listConversations({ limit: conversationBatchSize, offset: rows.length, ...listQuery });
      if (key !== listKey.current) return;
      setRows((prev) => {
        const seen = new Set(prev.map((row) => row.public_id));
        return [...prev, ...batch.data.filter((row) => !seen.has(row.public_id))];
      });
      setHasMore(batch.data.length >= conversationBatchSize);
    } catch {
      toast.error(t("chat.loadFailed"));
    } finally {
      setLoadingMore(false);
    }
  }

  // Legacy server search: ≥3 characters, 600 ms debounce, every conversation (not only the loaded batches).
  useEffect(() => {
    const term = search.trim();
    if (term.length < 3) {
      setExtra([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      api
        .listConversations({ limit: 200, search: term.replace(/^@/, "") })
        .then((response) => active && setExtra(response.data))
        .catch(() => undefined);
    }, 600);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [api, search]);

  const visible = useMemo(() => visibleConversations(rows, { channel, unreadOnly, search, extra }), [rows, channel, unreadOnly, search, extra]);

  const nameLabels = useMemo(
    () => ({
      instagram: (last4: string) => t("chat.fallbackInstagram", { last4 }),
      messenger: (last4: string) => t("chat.fallbackMessenger", { last4 }),
      other: (last4: string) => t("chat.fallbackOther", { last4 }),
      unknown: t("chat.unknown"),
    }),
    [t],
  );
  const nameOf = useCallback((row: ConversationSummary) => conversationName(row.customer, row.channel, nameLabels), [nameLabels]);

  /** Applies a server or optimistic change to every copy of a conversation. */
  const patchConversation = useCallback((publicId: string, patch: Partial<ConversationSummary> | ((row: ConversationSummary) => ConversationSummary)) => {
    const apply = (row: ConversationSummary) => (row.public_id === publicId ? (typeof patch === "function" ? patch(row) : { ...row, ...patch }) : row);
    setRows((prev) => prev.map(apply));
    setExtra((prev) => prev.map(apply));
    setSnapshot((prev) => (prev ? apply(prev) : prev));
  }, []);

  /* ------------------------------------------------------------ selection + thread */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ConversationSummary | null>(null);
  const selected = useMemo(() => {
    if (!selectedId) return null;
    return rows.find((row) => row.public_id === selectedId) ?? extra.find((row) => row.public_id === selectedId) ?? (snapshot?.public_id === selectedId ? snapshot : null);
  }, [rows, extra, snapshot, selectedId]);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const threadFor = useRef<string | null>(null);
  const pendingSeq = useRef(0);

  const loadThread = useCallback(
    async (publicId: string, initial: boolean) => {
      try {
        const page = await api.listMessages(publicId, messagePageSize);
        if (threadFor.current !== publicId) return;
        setMessages((prev) => (initial || !prev ? page.data : mergeThread<ChatMessage>(prev, page.data)));
        if (initial) setHasOlder(Boolean(page.has_more));
      } catch {
        if (initial && threadFor.current === publicId) {
          setMessages([]);
          toast.error(t("chat.threadFailed"));
        }
      }
    },
    [api, t, toast],
  );

  const select = useCallback(
    (row: ConversationSummary) => {
      threadFor.current = row.public_id;
      setSelectedId(row.public_id);
      setSnapshot(row);
      setMessages(null);
      setHasOlder(false);
      void loadThread(row.public_id, true);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("konusma", row.public_id);
          return next;
        },
        { replace: true },
      );
      // Staff opening a conversation reads it; managers stay "ghost" observers until they reply (legacy).
      if (!isManager && row.unread_count > 0) {
        patchConversation(row.public_id, { unread_count: 0 });
        api.updateConversationState(row.public_id, { unread_count: 0 }).catch(() => undefined);
      }
    },
    [api, isManager, loadThread, patchConversation, setSearchParams],
  );

  function closeConversation() {
    threadFor.current = null;
    setSelectedId(null);
    setMessages(null);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("konusma");
        return next;
      },
      { replace: true },
    );
  }

  usePolling(() => {
    if (selectedId) void loadThread(selectedId, false);
  }, threadPollMs, selectedId !== null);

  async function loadOlder() {
    const oldest = messages?.find((message) => !message.public_id.startsWith(pendingPrefix));
    if (!selectedId || !oldest || loadingOlder) return;
    const publicId = selectedId;
    setLoadingOlder(true);
    try {
      const page = await api.listMessages(publicId, messagePageSize, oldest.public_id);
      if (threadFor.current !== publicId) return;
      setMessages((prev) => {
        const loaded = new Set((prev ?? []).map((item) => item.public_id));
        return [...page.data.filter((item) => !loaded.has(item.public_id)), ...(prev ?? [])];
      });
      setHasOlder(Boolean(page.has_more));
    } catch {
      toast.error(t("chat.loadOlderFailed"));
    } finally {
      setLoadingOlder(false);
    }
  }

  // `?konusma=<public_id>` deep link (kargo pipeline, notifications): open it once the list is in; a conversation
  // outside the loaded batch is fetched on its own.
  const deepLink = useRef(searchParams.get("konusma"));
  const autoOpened = useRef(false);
  useEffect(() => {
    if (loading || autoOpened.current) return;
    const wanted = deepLink.current;
    if (wanted) {
      autoOpened.current = true;
      const found = rows.find((row) => row.public_id === wanted);
      if (found) return select(found);
      api
        .getConversation(wanted)
        .then((match) => select(match))
        .catch(() => toast.error(t("chat.deepLinkMissing")));
      return;
    }
    if (readAutoOpen() && !selectedId && visible[0]) {
      autoOpened.current = true;
      select(visible[0]);
    } else if (rows.length > 0) {
      autoOpened.current = true;
    }
  }, [loading, rows, visible, selectedId, select, api, t, toast]);

  /* ------------------------------------------------------------ sending */
  async function send(text: string, media: ComposerMedia[]) {
    const conversation = selected;
    if (!conversation || (!text && media.length === 0)) return;
    const publicId = conversation.public_id;
    const now = new Date().toISOString();
    const tempId = `${pendingPrefix}${++pendingSeq.current}`;
    const optimistic: ChatMessage = {
      public_id: tempId,
      sender_type: "user",
      sender_name: agentName,
      body: text || (media.length > 0 ? `[${media[0]!.attachment_type === "video" ? t("chat.mediaVideo") : media[0]!.attachment_type === "document" ? t("chat.mediaPdf") : t("chat.mediaImage")}]` : null),
      is_read: false,
      sent_at: now,
      attachments: media.map((item) => ({ file_public_id: item.file_public_id ?? item.key, attachment_type: item.attachment_type, original_name: item.name, mime_type: item.mime_type, byte_size: null, ...(item.preview_url ? { preview_url: item.preview_url } : {}) })),
    };
    setMessages((prev) => [...(prev ?? []), optimistic]);
    const wasUnread = conversation.unread_count > 0;
    patchConversation(publicId, (row) => ({ ...row, last_message_text: text || optimistic.body, last_message_at: now, last_message_sender_type: "user", unread_count: 0, is_in_pool: false }));
    if (wasUnread) api.updateConversationState(publicId, { unread_count: 0 }).catch(() => undefined);
    try {
      const attachments = await Promise.all(media.map(async (item) => ({ file_public_id: item.file_public_id ?? (await api.uploadFile(item.file!)).public_id, attachment_type: item.attachment_type })));
      const saved = await api.sendMessage(publicId, { body: text || null, sender_name: agentName, attachments });
      if (threadFor.current === publicId) {
        setMessages((prev) => {
          const list = (prev ?? []).filter((message) => message.public_id !== saved.public_id);
          const index = list.findIndex((message) => message.public_id === tempId);
          if (index === -1) return [...list, saved];
          // Keep the local preview until the presigned copy is fetched.
          const merged: ChatMessage = { ...saved, attachments: saved.attachments.map((attachment, position) => {
            const preview = optimistic.attachments[position]?.preview_url;
            return preview ? { ...attachment, preview_url: preview } : attachment;
          }) };
          return [...list.slice(0, index), merged, ...list.slice(index + 1)];
        });
      }
    } catch (error) {
      if (threadFor.current === publicId) setMessages((prev) => (prev ?? []).filter((message) => message.public_id !== tempId));
      toast.error(t("chat.sendFailed", { error: errorText(error) }));
    }
  }

  /** "AI üret ve gönder" already stored the AI message server-side; show it without waiting for the poll. */
  function aiSent(message: ChatMessage) {
    const publicId = selectedId;
    if (!publicId) return;
    if (threadFor.current === publicId) setMessages((prev) => (prev ?? []).some((item) => item.public_id === message.public_id) ? prev : [...(prev ?? []), message]);
    patchConversation(publicId, (row) => ({ ...row, last_message_text: message.body, last_message_at: message.sent_at, last_message_sender_type: "ai", unread_count: 0 }));
  }

  function goNext() {
    const next = nextConversation(visible, selectedId);
    if (next) select(next);
  }

  /* ------------------------------------------------------------ shortcuts, products, stats */
  const [shortcuts, setShortcuts] = useState<MessageShortcut[]>([]);
  const loadShortcuts = useCallback(() => {
    api
      .listShortcuts()
      .then((response) => setShortcuts(response.data.filter((item) => item.is_active).sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code, "tr"))))
      .catch(() => setShortcuts([]));
  }, [api]);
  useEffect(() => loadShortcuts(), [loadShortcuts]);

  const [products, setProducts] = useState<ProductOption[] | null>(null);
  const loadProducts = useCallback(() => {
    api
      .orderProductOptions()
      .then((response) => setProducts(response.data))
      .catch(() => setProducts((prev) => prev ?? []));
  }, [api]);
  useEffect(() => loadProducts(), [loadProducts]);
  const stocks = useMemo(() => stockBadges(products ?? []), [products]);

  const [dailySales, setDailySales] = useState<number | null>(null);
  const loadDailySales = useCallback(() => {
    if (!isManager) return;
    // Legacy GÜNLÜK SATIŞ: units sold today (Europe/Istanbul), not cancelled/returned; an order without items is 1.
    api
      .orderSummary()
      .then((stats) => setDailySales(stats.today_sold_units ?? 0))
      .catch(() => setDailySales(null));
  }, [api, isManager]);
  useEffect(() => loadDailySales(), [loadDailySales]);

  const [agents, setAgents] = useState<OnlineAgent[]>([]);
  const loadAgents = useCallback(() => {
    if (!isManager) return;
    api
      .listUsers()
      .then((response) => setAgents(response.data.filter((item) => item.is_active && item.is_online && (item.role === "calisan" || item.role === "kargo_operatoru"))))
      .catch(() => setAgents([]));
  }, [api, isManager]);
  useEffect(() => loadAgents(), [loadAgents]);
  usePolling(loadAgents, agentsPollMs, isManager);

  async function setAgentOffline(agent: OnlineAgent) {
    const name = `${agent.first_name} ${agent.last_name}`.trim();
    if (!(await confirm(t("chat.agentOfflineConfirm", { name }), { confirmLabel: t("chat.agentOfflineConfirmLabel") }))) return;
    try {
      await api.setUserOffline(agent.public_id);
      setAgents((prev) => prev.filter((item) => item.public_id !== agent.public_id));
      toast.success(t("chat.agentOfflineDone", { name }));
    } catch (error) {
      toast.error(t("chat.actionFailed", { error: errorText(error) }));
    }
  }

  /* ------------------------------------------------------------ toggles + menu actions */
  const [agentBusy, setAgentBusy] = useState(false);
  async function toggleHumanAgent() {
    if (!selected || agentBusy || !isSocialChannel(selected.channel)) return;
    const previous = selected.human_agent_enabled;
    const publicId = selected.public_id;
    setAgentBusy(true);
    patchConversation(publicId, { human_agent_enabled: !previous });
    try {
      const saved = await api.updateConversationState(publicId, { human_agent_enabled: !previous });
      patchConversation(publicId, saved);
      toast.success(saved.human_agent_enabled ? t("chat.agentOn") : t("chat.agentOff"));
    } catch (error) {
      patchConversation(publicId, { human_agent_enabled: previous });
      toast.error(t("chat.actionFailed", { error: errorText(error) }));
    } finally {
      setAgentBusy(false);
    }
  }

  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  useEffect(() => {
    api
      .aiStatus()
      .then((response) => setAiEnabled(response.ai_enabled))
      .catch(() => undefined);
  }, [api]);
  async function toggleAi() {
    if (!isManager || aiBusy) return;
    const next = !aiEnabled;
    setAiBusy(true);
    setAiEnabled(next);
    try {
      await api.upsertAdminSetting("ai.auto_reply_enabled", next);
      toast.success(next ? t("chat.gptOn") : t("chat.gptOff"));
    } catch (error) {
      setAiEnabled(!next);
      toast.error(t("chat.actionFailed", { error: errorText(error) }));
    } finally {
      setAiBusy(false);
    }
  }

  const unreadTotal = counts?.unread_conversation_count ?? rows.filter((row) => row.unread_count > 0).length;
  const [marking, setMarking] = useState(false);
  async function markAllRead() {
    const scoped = channel === "all" ? unreadTotal : rows.filter((row) => channelKey(row.channel) === channel && row.unread_count > 0).length;
    if (marking || scoped === 0) return;
    if (!(await confirm(t("chat.markAllReadConfirm", { count: scoped }), { confirmLabel: t("chat.markAllRead") }))) return;
    setMarking(true);
    try {
      const result = await api.markAllConversationsRead(channel === "all" ? undefined : channel === "messenger" ? "facebook" : channel);
      const touch = (row: ConversationSummary) => (channel === "all" || channelKey(row.channel) === channel ? { ...row, unread_count: 0 } : row);
      setRows((prev) => prev.map(touch));
      setExtra((prev) => prev.map(touch));
      setSnapshot((prev) => (prev ? touch(prev) : prev));
      refreshCounts();
      toast.success(t("chat.markAllReadSuccess", { count: result.updated }));
    } catch (error) {
      toast.error(t("chat.actionFailed", { error: errorText(error) }));
    } finally {
      setMarking(false);
    }
  }

  const [stateBusy, setStateBusy] = useState(false);
  async function updateState(input: Parameters<typeof api.updateConversationState>[1]) {
    if (!selected) return;
    const publicId = selected.public_id;
    setStateBusy(true);
    try {
      patchConversation(publicId, await api.updateConversationState(publicId, input));
      if (input.unread_count === 0) refreshCounts();
    } catch (error) {
      toast.error(t("chat.actionFailed", { error: errorText(error) }));
    } finally {
      setStateBusy(false);
    }
  }

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(readAutoOpen);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  async function saveConversationNote() {
    if (!selected) return;
    try {
      patchConversation(selected.public_id, await api.updateConversationNotes(selected.public_id, noteDraft.trim() || null));
      setNoteOpen(false);
      toast.success(t("chat.noteSaved"));
    } catch (error) {
      toast.error(t("chat.actionFailed", { error: errorText(error) }));
    }
  }

  /* ------------------------------------------------------------ customer (note, prefill, orders) */
  const [customer, setCustomer] = useState<CustomerInfo | null>(null);
  const [ordersVersion, setOrdersVersion] = useState(0);
  const selectedPhone = realPhone(selected?.customer?.phone);
  // The conversation detail carries the customer's id, note and default address (no phone lookup).
  useEffect(() => {
    if (!selectedId) return;
    const base: CustomerInfo = { conversationId: selectedId, customerPublicId: null, notes: "", city: "", district: "", address: "" };
    setCustomer(base);
    let active = true;
    api
      .getConversation(selectedId)
      .then((detail) => {
        if (!active) return;
        const address = detail.customer?.default_address ?? null;
        setCustomer({
          ...base,
          customerPublicId: detail.customer?.public_id ?? null,
          notes: detail.customer?.notes ?? "",
          city: address?.city ?? "",
          district: address?.district ?? "",
          address: address?.address_line ?? "",
        });
      })
      .catch(() => undefined); // No customer record: the form keeps the conversation's name and phone only.
    return () => {
      active = false;
    };
  }, [api, selectedId]);

  const info = customer?.conversationId === selectedId ? customer : null;
  const realName = selected ? (nameOf(selected) === (selected.customer?.full_name ?? "").trim() ? selected.customer?.full_name ?? "" : "") : "";
  const prefill: OrderPrefill = {
    key: selectedId ?? "",
    customerPublicId: info?.customerPublicId ?? null,
    name: realName,
    phone: selectedPhone,
    city: info?.city ?? "",
    district: info?.district ?? "",
    address: info?.address ?? "",
  };

  const loadCustomerOrders = useCallback(async (): Promise<OrderRow[]> => {
    if (!selected) return [];
    if (info?.customerPublicId) return (await api.getCustomer(info.customerPublicId)).orders as OrderRow[];
    const name = (selected.customer?.full_name ?? "").trim();
    if (name.length < 4) return [];
    const response = await api.listOrders({ search: name, limit: 50 });
    return (response.data as OrderRow[]).filter((row) => row.conversation_public_id === selected.public_id || (row.customer_full_name ?? "").trim().toLocaleLowerCase("tr-TR") === name.toLocaleLowerCase("tr-TR"));
  }, [api, info?.customerPublicId, selected]);

  async function saveCustomerNote(note: string) {
    if (!selected) return;
    await api.updateConversationCustomerNotes(selected.public_id, note || null);
    setCustomer((prev) => (prev && prev.conversationId === selected.public_id ? { ...prev, notes: note } : prev));
    toast.success(t("chat.noteSaved"));
  }

  const [panelMode, setPanelMode] = useState<PanelMode>("create");
  const [orderSheetOpen, setOrderSheetOpen] = useState(false);
  // Open chat below lg = full screen (no app navbar / bottom bar); the back button is the way out.
  useImmersive(selected !== null);

  function orderCreated(order: OrderSummary, total: number, productNames: string[]) {
    const incubator = productNames.some((name) => /kuluçka|kulucka/i.test(name));
    toast.success(incubator ? t("chat.createdCommission", { orderNumber: order.order_number }) : t("chat.created", { orderNumber: order.order_number }));
    setOrdersVersion((value) => value + 1);
    setOrderSheetOpen(false);
    loadProducts();
    loadDailySales();
    // Legacy: the second shortcut (price filled in) goes to the customer right after the order.
    const followUp = orderFollowUp(shortcuts, total);
    if (followUp) void send(followUp, []);
  }

  async function goOnline() {
    try {
      updateUser(await api.setPresence(true));
    } catch (error) {
      toast.error(t("chat.actionFailed", { error: errorText(error) }));
    }
  }

  const topBarProps: TopBarProps = {
    isManager,
    dailySales,
    stocks,
    onlineAgents: agents,
    onAgentOffline: (agent) => void setAgentOffline(agent),
    agent: { enabled: Boolean(selected && isSocialChannel(selected.channel)), value: Boolean(selected && isSocialChannel(selected.channel) && selected.human_agent_enabled), busy: agentBusy, onToggle: () => void toggleHumanAgent() },
    ai: { value: aiEnabled, busy: aiBusy, canToggle: isManager, onToggle: () => void toggleAi() },
    unreadTotal,
    marking,
    onSettings: () => setSettingsOpen(true),
    onMarkAllRead: () => void markAllRead(),
    conversation: selected
      ? {
          inPool: selected.is_in_pool,
          closed: selected.status === "closed",
          busy: stateBusy,
          onPool: () => void updateState(selected.is_in_pool ? { assign_to_me: true, is_in_pool: false } : { is_in_pool: true }),
          onStatus: () => void updateState({ status: selected.status === "closed" ? "open" : "closed" }),
          onNote: () => {
            setNoteDraft(selected.notes ?? "");
            setNoteOpen(true);
          },
        }
      : null,
  };
  const orderPanelProps = selected
    ? {
        conversationId: selected.public_id,
        prefill,
        products,
        mode: panelMode,
        onMode: setPanelMode,
        loadCustomerOrders,
        ordersKey: ordersVersion,
        onOrderCreated: orderCreated,
      }
    : null;

  /* ------------------------------------------------------------ layout */
  const byChannel = counts?.channel_counts ?? {};
  const channelCounts: Record<ChannelFilter, number> = {
    all: counts?.total_count ?? rows.length,
    whatsapp: byChannel.whatsapp ?? 0,
    instagram: byChannel.instagram ?? 0,
    // `facebook` already includes stored `messenger` rows.
    messenger: byChannel.facebook ?? 0,
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-0 bg-msg-base text-msg-fg lg:flex-row" data-testid="page-messages">
      <h1 className="sr-only">{t("chat.pageTitle")}</h1>
      <ConversationList
        rows={offline ? [] : visible}
        selectedId={selectedId}
        hidden={selected !== null}
        nameOf={nameOf}
        initialsOf={(row) => initialsOf(nameOf(row))}
        onSelect={select}
        unreadOnly={unreadOnly}
        onToggleUnread={() => setUnreadOnly((value) => !value)}
        unreadTotal={unreadTotal}
        poolCount={!isManager && !offline ? (counts?.pool_count ?? null) : null}
        channel={channel}
        onChannel={setChannel}
        channelCounts={channelCounts}
        search={search}
        onSearch={setSearch}
        loading={loading}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onLoadMore={() => void loadMore()}
        offline={offline}
        onGoOnline={() => void goOnline()}
      />

      <div className={cn("min-h-0 min-w-0 flex-1 flex-col", selected ? "flex" : "hidden lg:flex")} data-testid="chat-column">
        <TopBar {...topBarProps} />
        <div className="flex min-h-0 flex-1 flex-row">
          {selected ? (
            <ChatPanel
              conversation={selected}
              name={nameOf(selected)}
              initials={initialsOf(nameOf(selected))}
              isManager={isManager}
              agentName={t("chat.agentLabel")}
              messages={messages}
              hasOlder={hasOlder}
              loadingOlder={loadingOlder}
              onLoadOlder={() => void loadOlder()}
              onBack={closeConversation}
              markingRead={stateBusy}
              onMarkRead={() => void updateState({ unread_count: 0 })}
              customerNote={info?.notes ?? ""}
              onSaveCustomerNote={saveCustomerNote}
              menu={topBarProps}
              onOpenOrder={() => setOrderSheetOpen(true)}
              composer={<Composer key={selected.public_id} conversationId={selected.public_id} shortcuts={shortcuts} onShortcutsChanged={loadShortcuts} onSend={(text, media) => void send(text, media)} onNext={goNext} onAiSent={aiSent} />}
            />
          ) : (
            <EmptyChat />
          )}
          {orderPanelProps && <OrderPanel {...orderPanelProps} />}
        </div>
      </div>

      {orderPanelProps && <OrderSheet open={orderSheetOpen} onClose={() => setOrderSheetOpen(false)} {...orderPanelProps} />}

      <ChatDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        icon={<Settings className="size-5 text-msg-muted" aria-hidden="true" />}
        title={t("chat.conversationSettings")}
        testId="chat-settings"
        footer={
          <button type="button" onClick={() => setSettingsOpen(false)} className="rounded-lg bg-msg-chip px-4 py-2 text-sm font-medium text-msg-fg hover:bg-msg-border-strong">
            {t("chat.close")}
          </button>
        }
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-msg-fg">{t("chat.autoOpenLast")}</div>
            <div className="mt-0.5 text-xs text-msg-subtle">{t("chat.autoOpenLastDesc")}</div>
          </div>
          <Switch
            checked={autoOpen}
            size="md"
            label={t("chat.autoOpenLast")}
            testId="chat-settings-auto-open"
            onChange={() => {
              const next = !autoOpen;
              setAutoOpen(next);
              try {
                window.localStorage.setItem(autoOpenStorageKey, next ? "1" : "0");
              } catch {
                // Storage unavailable: the choice lasts for this visit.
              }
            }}
          />
        </div>
      </ChatDialog>

      <ChatDialog
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        title={t("chat.conversationNote")}
        testId="conversation-note-dialog"
        footer={
          <>
            <button type="button" onClick={() => setNoteOpen(false)} className="rounded-lg px-4 py-2 text-sm text-msg-muted hover:bg-msg-hover-raised">
              {t("chat.cancel")}
            </button>
            <button type="button" onClick={() => void saveConversationNote()} className="rounded-lg bg-msg-primary px-4 py-2 text-sm font-medium text-msg-on-primary hover:bg-msg-primary/90" data-testid="conversation-note-save">
              {t("chat.save")}
            </button>
          </>
        }
      >
        <Textarea
          unstyled
          rows={4}
          value={noteDraft}
          onChange={(event) => setNoteDraft(event.target.value)}
          aria-label={t("chat.conversationNote")}
          className="w-full resize-none rounded-lg border border-msg-border-strong bg-msg-field px-3 py-2 text-sm text-msg-fg focus:border-msg-primary focus:ring-1 focus:ring-msg-primary focus:outline-none max-lg:text-base"
          data-testid="conversation-note"
        />
      </ChatDialog>
    </div>
  );
}
