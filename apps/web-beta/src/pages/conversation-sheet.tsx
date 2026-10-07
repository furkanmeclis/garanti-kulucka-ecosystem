import type { ConversationSummary } from "@garanti-kulucka/shared";
import { Bot, CheckCheck, FileText, Loader2, Paperclip, Send, ShoppingCart, Sparkles, X, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { channelLabel, formatDateTime } from "@/lib/format";
import { attachmentTypeOf, type AttachmentType, type MessageAttachment, type MessageShortcut, type ThreadMessage } from "@/lib/inbox";
import { cn } from "@/lib/utils";
import { errorText, FeedbackLine, type Feedback } from "./accounting-shared";
import { OrderFormSheet } from "./order-form-sheet";

interface Pending {
  key: string;
  name: string;
  attachment_type: AttachmentType;
  file?: File;
  file_public_id?: string;
}

/** Legacy Mesajlar loads the newest page first and pages backwards with "eski mesajları yükle". */
const messagePageSize = 50;

const area =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

export function AttachmentChip({ attachment }: { attachment: MessageAttachment }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  async function download() {
    const response = await api.fileDownload(attachment.file_public_id);
    if (response.download.presigned_url) window.open(response.download.presigned_url, "_blank", "noopener");
  }
  return (
    <button type="button" className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-md border bg-background/60 px-2 text-xs md:min-h-8" onClick={() => void download()} title={t("inbox.download")} data-testid="message-attachment">
      <FileText className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{attachment.original_name ?? attachment.attachment_type}</span>
    </button>
  );
}

/**
 * Legacy MesajlarPage conversation pane: thread, composer (text + up to 10 files + shortcuts + AI suggestion),
 * pool/agent/status toggles, conversation + customer notes (autosaved) and "sohbetten sipariş" order form.
 */
export function ConversationSheet({ conversation, onClose, onChanged }: { conversation: ConversationSummary | null; onClose: () => void; onChanged: (next?: ConversationSummary) => void }) {
  const { t, i18n } = useTranslation();
  const { api, user } = useAuth();
  const [current, setCurrent] = useState<ConversationSummary | null>(conversation);
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [shortcuts, setShortcuts] = useState<MessageShortcut[]>([]);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [suggestion, setSuggestion] = useState<{ text: string; dryRun: boolean } | null>(null);
  const [conversationNote, setConversationNote] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [orderOpen, setOrderOpen] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const skipScroll = useRef(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);
  const noteTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const id = conversation?.public_id ?? null;

  const loadMessages = useCallback(
    async (publicId: string) => {
      try {
        const page = await api.listMessages(publicId, messagePageSize);
        setMessages(page.data);
        setHasOlder(Boolean(page.has_more));
      } catch (error) {
        setFeedback({ tone: "error", text: t("inbox.loadFailed", { error: errorText(error) }) });
        setMessages([]);
        setHasOlder(false);
      }
    },
    [api, t],
  );

  useEffect(() => {
    setCurrent(conversation);
    setMessages(null);
    setHasOlder(false);
    setDraft("");
    setPending([]);
    setFeedback(null);
    setSuggestion(null);
    setConversationNote(conversation?.notes ?? "");
    setCustomerNote("");
    if (!id) return;
    void loadMessages(id);
    api
      .listShortcuts()
      .then((response) => setShortcuts(response.data.filter((item) => item.is_active)))
      .catch(() => setShortcuts([]));
    // Only a different conversation resets the pane.
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Prepending an older page keeps the reader where they were instead of jumping to the newest message.
    if (skipScroll.current) {
      skipScroll.current = false;
      return;
    }
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function loadOlder() {
    const oldest = messages?.[0];
    if (!current || !oldest || loadingOlder) return;
    const publicId = current.public_id;
    setLoadingOlder(true);
    try {
      const page = await api.listMessages(publicId, messagePageSize, oldest.public_id);
      if (publicId !== id) return;
      skipScroll.current = true;
      setMessages((prev) => {
        const loaded = new Set((prev ?? []).map((item) => item.public_id));
        return [...page.data.filter((item) => !loaded.has(item.public_id)), ...(prev ?? [])];
      });
      setHasOlder(Boolean(page.has_more));
    } catch (error) {
      setFeedback({ tone: "error", text: t("inbox.loadFailed", { error: errorText(error) }) });
    } finally {
      setLoadingOlder(false);
    }
  }

  useEffect(() => () => Object.values(noteTimers.current).forEach(clearTimeout), []);

  async function send() {
    if (!current || (!draft.trim() && pending.length === 0)) return;
    setSending(true);
    setFeedback(null);
    try {
      const attachments = await Promise.all(
        pending.map(async (item) => ({ file_public_id: item.file_public_id ?? (await api.uploadFile(item.file!)).public_id, attachment_type: item.attachment_type })),
      );
      const message = await api.sendMessage(current.public_id, { body: draft.trim() || null, sender_name: user?.email ?? "panel", attachments });
      setMessages((prev) => [...(prev ?? []).filter((item) => item.public_id !== message.public_id), message]);
      setDraft("");
      setPending([]);
      onChanged();
    } catch (error) {
      setFeedback({ tone: "error", text: t("inbox.actionFailed", { error: errorText(error) }) });
    } finally {
      setSending(false);
    }
  }

  async function updateState(name: string, input: Parameters<typeof api.updateConversationState>[1]) {
    if (!current) return;
    setBusy(name);
    setFeedback(null);
    try {
      const next = await api.updateConversationState(current.public_id, input);
      setCurrent(next);
      onChanged(next);
    } catch (error) {
      setFeedback({ tone: "error", text: t("inbox.actionFailed", { error: errorText(error) }) });
    } finally {
      setBusy(null);
    }
  }

  async function suggest() {
    if (!current) return;
    setBusy("ai");
    try {
      const response = await api.aiReplySuggestion(current.public_id);
      setSuggestion({ text: response.suggestion, dryRun: response.dry_run });
    } catch (error) {
      setFeedback({ tone: "error", text: t("inbox.actionFailed", { error: errorText(error) }) });
    } finally {
      setBusy(null);
    }
  }

  /** Legacy "AI yanıt üret & gönder": requests the AI suggestion and sends it as the reply right away. */
  async function suggestAndSend() {
    if (!current) return;
    setBusy("ai-send");
    setFeedback(null);
    try {
      const response = await api.aiReplySuggestion(current.public_id);
      const text = response.suggestion?.trim() ?? "";
      if (!text) {
        setFeedback({ tone: "error", text: t("inbox.aiSendEmpty") });
        return;
      }
      const message = await api.sendMessage(current.public_id, { body: text, sender_name: user?.email ?? "panel", attachments: [] });
      setMessages((prev) => [...(prev ?? []).filter((item) => item.public_id !== message.public_id), message]);
      setSuggestion(null);
      setFeedback({ tone: "success", text: t("inbox.aiSent") });
      onChanged();
    } catch (error) {
      setFeedback({ tone: "error", text: t("inbox.actionFailed", { error: errorText(error) }) });
    } finally {
      setBusy(null);
    }
  }

  // Legacy InlineNote: notes save 500 ms after the last keystroke.
  function scheduleNote(kind: "conversation" | "customer", value: string) {
    if (!current) return;
    if (kind === "conversation") setConversationNote(value);
    else setCustomerNote(value);
    clearTimeout(noteTimers.current[kind]);
    const publicId = current.public_id;
    noteTimers.current[kind] = setTimeout(() => {
      const save = kind === "conversation" ? api.updateConversationNotes(publicId, value.trim() || null) : api.updateConversationCustomerNotes(publicId, value.trim() || null);
      save
        .then(() => setFeedback({ tone: "success", text: t("inbox.noteSaved") }))
        .catch((error: unknown) => setFeedback({ tone: "error", text: t("inbox.actionFailed", { error: errorText(error) }) }));
    }, 500);
  }

  function pick(files: FileList | null) {
    const next = Array.from(files ?? []).map((file, index) => ({ key: `${file.name}-${file.size}-${Date.now()}-${index}`, name: file.name, file, attachment_type: attachmentTypeOf(file) }));
    setPending((prev) => {
      const merged = [...prev, ...next];
      if (merged.length > 10) setFeedback({ tone: "error", text: t("inbox.attachmentLimit") });
      return merged.slice(0, 10);
    });
  }

  function useShortcut(shortcut: MessageShortcut) {
    setDraft(shortcut.message ?? "");
    setPending(shortcut.attachments.map((attachment) => ({ key: attachment.file_public_id, name: attachment.original_name ?? attachment.file_public_id, attachment_type: attachment.attachment_type, file_public_id: attachment.file_public_id })));
  }

  const sender = (message: ThreadMessage) =>
    message.sender_type === "user" ? (message.sender_name ?? t("inbox.you")) : message.sender_type === "ai" ? t("inbox.aiSender") : message.sender_type === "system" ? t("inbox.systemSender") : t("inbox.customerSender");
  const customerName = current?.customer?.full_name ?? current?.customer?.username ?? current?.customer?.phone ?? "-";

  return (
    <>
      <Sheet open={conversation !== null && !orderOpen} onOpenChange={(next) => !next && onClose()}>
        <SheetContent side="right" closeLabel={t("inbox.close")} className="flex w-[min(44rem,100vw)] flex-col gap-0 p-0" data-testid="conversation-sheet">
          <SheetHeader className="border-b p-4 pr-14">
            <SheetTitle className="truncate">{customerName}</SheetTitle>
            <SheetDescription className="flex flex-wrap items-center gap-1.5">
              <span>{current ? channelLabel(current.channel) : ""}</span>
              {current?.is_in_pool && <Badge tone="warning">{t("messages.pool")}</Badge>}
              {current && (
                <Badge tone={current.human_agent_enabled ? "info" : "neutral"} data-testid="conversation-agent-badge">
                  {current.human_agent_enabled ? t("inbox.humanAgentOn") : t("inbox.humanAgentOff")}
                </Badge>
              )}
              {current?.assigned_user_email && <span className="text-xs">{current.assigned_user_email}</span>}
            </SheetDescription>
          </SheetHeader>
          {current && (
            <div className="flex flex-wrap gap-2 border-b p-2" data-testid="conversation-actions">
              {current.is_in_pool ? (
                <Button variant="outline" className="min-h-11 md:min-h-9" disabled={busy !== null} onClick={() => void updateState("take", { assign_to_me: true, is_in_pool: false })} data-testid="conversation-take">
                  {t("inbox.takeOver")}
                </Button>
              ) : (
                <Button variant="outline" className="min-h-11 md:min-h-9" disabled={busy !== null} onClick={() => void updateState("pool", { is_in_pool: true })} data-testid="conversation-release">
                  {t("inbox.releaseToPool")}
                </Button>
              )}
              <Button variant="outline" className="min-h-11 md:min-h-9" disabled={busy !== null} onClick={() => void updateState("agent", { human_agent_enabled: !current.human_agent_enabled })} data-testid="conversation-agent">
                <Bot className="size-4" aria-hidden="true" />
                {t("inbox.toggleHumanAgent")}
              </Button>
              <Button variant="outline" className="min-h-11 md:min-h-9" disabled={busy !== null || current.unread_count === 0} onClick={() => void updateState("read", { unread_count: 0 })} data-testid="conversation-read">
                <CheckCheck className="size-4" aria-hidden="true" />
                {t("inbox.markRead")}
              </Button>
              <Button
                variant="outline"
                className="min-h-11 md:min-h-9"
                disabled={busy !== null}
                onClick={() => void updateState("status", { status: current.status === "closed" ? "open" : "closed" })}
                data-testid="conversation-status"
              >
                {current.status === "closed" ? t("inbox.reopen") : t("inbox.close")}
              </Button>
              <Button className="min-h-11 md:min-h-9" onClick={() => setOrderOpen(true)} data-testid="conversation-create-order">
                <ShoppingCart className="size-4" aria-hidden="true" />
                {t("inbox.createOrder")}
              </Button>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto bg-muted/30 p-3" data-testid="conversation-thread">
            {hasOlder && messages !== null && messages.length > 0 && (
              <div className="mb-2 flex justify-center">
                <Button variant="outline" className="min-h-11 md:min-h-8" disabled={loadingOlder} onClick={() => void loadOlder()} data-testid="conversation-load-older">
                  {loadingOlder && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                  {loadingOlder ? t("inbox.loadingOlder") : t("inbox.loadOlder")}
                </Button>
              </div>
            )}
            {messages === null ? (
              <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" aria-hidden="true" />
            ) : messages.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("inbox.noMessages")}</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {messages.map((message) => {
                  const outgoing = message.sender_type !== "customer";
                  return (
                    <li key={message.public_id} className={cn("flex max-w-[85%] flex-col gap-1 rounded-lg px-3 py-2 text-sm", outgoing ? "self-end bg-primary/10" : "self-start bg-background shadow-xs")} data-testid="thread-message">
                      <span className="text-xs font-medium text-muted-foreground">{sender(message)}</span>
                      {message.body && <p className="break-words whitespace-pre-wrap">{message.body}</p>}
                      {message.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {message.attachments.map((attachment) => (
                            <AttachmentChip key={attachment.file_public_id} attachment={attachment} />
                          ))}
                        </div>
                      )}
                      <span className="self-end text-[11px] text-muted-foreground">{formatDateTime(message.sent_at, i18n.language)}</span>
                    </li>
                  );
                })}
              </ol>
            )}
            <div ref={bottom} />
          </div>
          <div className="flex flex-col gap-2 border-t p-3">
            <FeedbackLine feedback={feedback} testId="conversation-feedback" />
            {suggestion && (
              <div className="flex flex-col gap-2 rounded-md border border-violet-500/40 bg-violet-500/10 p-2 text-sm" data-testid="conversation-ai-suggestion">
                <span className="flex items-center gap-1.5 font-medium">
                  <Sparkles className="size-4" aria-hidden="true" />
                  {t("inbox.aiSuggestion")}
                  {suggestion.dryRun && <span className="text-xs font-normal text-muted-foreground">· {t("inbox.aiDryRun")}</span>}
                </span>
                <p className="whitespace-pre-wrap">{suggestion.text}</p>
                <Button
                  variant="outline"
                  className="min-h-11 self-start md:min-h-9"
                  onClick={() => {
                    setDraft((prev) => (prev.trim() ? `${prev}\n${suggestion.text}` : suggestion.text));
                    setSuggestion(null);
                  }}
                  data-testid="conversation-ai-use"
                >
                  {t("inbox.aiUse")}
                </Button>
              </div>
            )}
            {pending.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" data-testid="composer-attachments">
                {pending.map((item) => (
                  <li key={item.key} className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 text-xs">
                    <span className="max-w-40 truncate">{item.name}</span>
                    <Button variant="ghost" size="icon" className="size-11 md:size-7" aria-label={t("inbox.removeAttachment")} onClick={() => setPending((prev) => prev.filter((entry) => entry.key !== item.key))}>
                      <X className="size-3.5" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <textarea
              className={cn(area, "min-h-20")}
              rows={3}
              placeholder={t("inbox.composerPlaceholder")}
              aria-label={t("inbox.composerPlaceholder")}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
              }}
              data-testid="composer-input"
            />
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileInput} type="file" multiple accept="image/*,video/*,application/pdf" className="sr-only" tabIndex={-1} onChange={(event) => { pick(event.target.files); event.target.value = ""; }} data-testid="composer-file" />
              <Button variant="outline" size="icon" className="size-11 md:size-9" aria-label={t("inbox.attach")} title={t("inbox.attach")} onClick={() => fileInput.current?.click()}>
                <Paperclip className="size-4" aria-hidden="true" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="min-h-11 md:min-h-9" data-testid="composer-shortcuts">
                    <Zap className="size-4" aria-hidden="true" />
                    {t("inbox.shortcuts")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-72 w-72 overflow-y-auto">
                  <DropdownMenuLabel>{t("inbox.shortcuts")}</DropdownMenuLabel>
                  {shortcuts.length === 0 ? (
                    <p className="px-2 py-1.5 text-sm text-muted-foreground">{t("inbox.shortcutsEmpty")}</p>
                  ) : (
                    shortcuts.map((shortcut) => (
                      <DropdownMenuItem key={shortcut.public_id} className="flex min-h-10 flex-col items-start gap-0.5" onSelect={() => useShortcut(shortcut)} data-testid={`shortcut-${shortcut.code}`}>
                        <span className="font-mono text-xs">/{shortcut.code}</span>
                        <span className="line-clamp-2 text-xs text-muted-foreground">{shortcut.message ?? shortcut.attachments.map((item) => item.original_name).join(", ")}</span>
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" className="min-h-11 md:min-h-9" disabled={busy !== null} onClick={() => void suggest()} data-testid="composer-ai">
                {busy === "ai" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
                {busy === "ai" ? t("inbox.aiPreparing") : t("inbox.ai")}
              </Button>
              <Button variant="outline" className="min-h-11 md:min-h-9" disabled={busy !== null || sending} onClick={() => void suggestAndSend()} data-testid="composer-ai-send">
                {busy === "ai-send" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Bot className="size-4" aria-hidden="true" />}
                {busy === "ai-send" ? t("inbox.aiSending") : t("inbox.aiSend")}
              </Button>
              <Button className="ml-auto min-h-11 md:min-h-9" disabled={sending || (!draft.trim() && pending.length === 0)} onClick={() => void send()} data-testid="composer-send">
                {sending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
                {sending ? t("inbox.sending") : t("inbox.send")}
              </Button>
            </div>
            <details className="text-sm" data-testid="conversation-notes">
              <summary className="flex min-h-11 cursor-pointer items-center font-medium md:min-h-8">{t("inbox.notes")}</summary>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{t("inbox.conversationNote")}</span>
                  <textarea className={cn(area, "min-h-16")} rows={2} value={conversationNote} onChange={(event) => scheduleNote("conversation", event.target.value)} data-testid="conversation-note" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{t("inbox.customerNote")}</span>
                  <textarea className={cn(area, "min-h-16")} rows={2} value={customerNote} onChange={(event) => scheduleNote("customer", event.target.value)} data-testid="customer-note" />
                </label>
              </div>
            </details>
          </div>
        </SheetContent>
      </Sheet>
      <OrderFormSheet
        open={orderOpen}
        initial={{ name: current?.customer?.full_name ?? "", phone: current?.customer?.phone ?? "", conversationPublicId: current?.public_id, notes: t("inbox.fromConversation") }}
        onClose={() => setOrderOpen(false)}
        onCreated={(order) => {
          setOrderOpen(false);
          setFeedback({ tone: "success", text: t("orders.created", { orderNumber: order.order_number }) });
        }}
      />
    </>
  );
}
