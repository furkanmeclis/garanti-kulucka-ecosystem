import { Bot, FileText, Image, Loader2, Plus, SendHorizontal, X, Zap } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { expandShortcut, matchShortcuts } from "@/lib/chat";
import { ApiError } from "@/lib/api";
import { attachmentTypeOf, type AttachmentType, type MessageShortcut, type ThreadMessage } from "@/lib/inbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Tip } from "@/components/ui/tooltip";
import { breakpoints, useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { errorText } from "../accounting-shared";
import { useChatToast } from "./chat-ui";
import { chatTipClass } from "./top-bar";
import { QuickReplies, ShortcutMediaGlyph } from "./quick-replies";

/** One queued media item: a picked file (uploaded on send) or a shortcut attachment already in storage. */
export interface ComposerMedia {
  key: string;
  name: string;
  attachment_type: AttachmentType;
  mime_type: string | null;
  file?: File;
  file_public_id?: string;
  preview_url?: string;
}

const fromShortcut = (shortcut: MessageShortcut): ComposerMedia[] =>
  shortcut.attachments.map((item) => ({ key: item.file_public_id, name: item.original_name ?? item.file_public_id, attachment_type: item.attachment_type, mime_type: item.mime_type, file_public_id: item.file_public_id }));

function fromFile(file: File): ComposerMedia {
  return { key: `${file.name}-${file.size}-${Date.now()}`, name: file.name, attachment_type: attachmentTypeOf(file), mime_type: file.type || null, file, preview_url: URL.createObjectURL(file) };
}

const mediaLabelKey = (media: ComposerMedia) => (media.attachment_type === "video" ? "chat.mediaVideo" : media.attachment_type === "document" ? "chat.mediaPdf" : "chat.mediaImage");

function MediaThumb({ media, size }: { media: ComposerMedia; size: "sm" | "lg" }) {
  const box = size === "lg" ? "h-20 w-32 rounded-lg" : "h-14 w-20 rounded";
  if (media.preview_url && media.attachment_type === "image") return <img src={media.preview_url} alt="" className={cn(box, "object-cover")} />;
  if (media.preview_url && media.attachment_type === "video") return <video src={media.preview_url} className={cn(box, "object-cover")} muted />;
  return (
    <div className={cn(box, "flex items-center justify-center bg-msg-chip")}>
      {media.attachment_type === "document" ? <FileText className={cn(size === "lg" ? "size-10" : "size-6", "text-red-500 dark:text-red-400")} aria-hidden="true" /> : <Image className={cn(size === "lg" ? "size-10" : "size-6", "text-msg-muted")} aria-hidden="true" />}
    </div>
  );
}

export interface ComposerProps {
  conversationId: string;
  shortcuts: MessageShortcut[];
  onShortcutsChanged: () => void;
  /** Resolves once the optimistic bubble is queued; the composer clears right away (legacy behaviour). */
  onSend: (text: string, media: ComposerMedia[]) => void;
  /** Enter on an empty composer jumps to the next conversation (legacy sonrakiKonusmayaGec). */
  onNext: () => void;
  /** "AI üret ve gönder" stored and queued an AI message server-side. */
  onAiSent: (message: ThreadMessage) => void;
}

const squareButton = "flex size-10 shrink-0 items-center justify-center rounded-lg max-lg:size-11";
/** Textarea auto-grow cap on phones (~5 lines of 16px text + padding). */
const maxMobileInputHeight = 140;

/** Small upward Popover menu used by the mobile [+] and AI buttons (the trigger toggles it). */
function ComposerMenu({ open, onOpenChange, align, trigger, children, testId }: { open: boolean; onOpenChange: (open: boolean) => void; align: "start" | "end"; trigger: ReactNode; children: ReactNode; testId: string }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent side="top" align={align} sideOffset={8} role="menu" className="w-60 rounded-xl border-msg-border-strong bg-msg-raised p-0 py-1 text-msg-fg shadow-xl" data-testid={testId}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

function ComposerMenuItem({ icon, children, onClick, testId }: { icon: ReactNode; children: ReactNode; onClick: () => void; testId: string }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm text-msg-fg hover:bg-msg-hover-raised" data-testid={testId}>
      {icon}
      {children}
    </button>
  );
}
const roundButton =
  "group flex size-10 shrink-0 items-center justify-center rounded-xl transition-all hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 max-lg:size-11";

/** Legacy composer: image/video, PDF, ⚡ quick replies, 42px input with inline shortcut suggestions, AI öner, AI üret & gönder, send. */
export function Composer({ conversationId, shortcuts, onShortcutsChanged, onSend, onNext, onAiSent }: ComposerProps) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const toast = useChatToast();
  const [text, setText] = useState("");
  const [media, setMedia] = useState<ComposerMedia[]>([]);
  const [suggestions, setSuggestions] = useState<MessageShortcut[]>([]);
  const [active, setActive] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<{ text: string; dryRun: boolean } | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const imageInput = useRef<HTMLInputElement | null>(null);
  const pdfInput = useRef<HTMLInputElement | null>(null);
  const debounce = useRef<number | undefined>(undefined);
  // Below lg the composer is one row: [+] menu, auto-growing input, AI menu, send (desktop keeps the legacy row).
  const desktop = useMediaQuery(breakpoints.lg);
  const [attachOpen, setAttachOpen] = useState(false);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    if (desktop) {
      element.style.height = "";
      return;
    }
    element.style.height = "auto";
    element.style.height = `${Math.max(44, Math.min(element.scrollHeight, maxMobileInputHeight))}px`;
  }, [text, desktop]);

  // Legacy: the input is focused right after a conversation opens so the agent can type at once.
  useEffect(() => {
    const timer = window.setTimeout(() => input.current?.focus(), 100);
    return () => window.clearTimeout(timer);
  }, [conversationId]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setQuickOpen(false);
      setSuggestions([]);
      setAttachOpen(false);
      setAiMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(debounce.current);
    };
  }, []);

  const placeCaret = (position: number, focus: boolean) =>
    window.setTimeout(() => {
      if (!input.current) return;
      input.current.selectionStart = position;
      input.current.selectionEnd = position;
      if (focus) input.current.focus();
    }, 0);

  function applyShortcut(shortcut: MessageShortcut, focus: boolean) {
    if (shortcut.attachments.length > 0) {
      setMedia(fromShortcut(shortcut));
      setText(shortcut.message ?? "");
    } else {
      const caret = input.current?.selectionStart ?? text.length;
      const next = expandShortcut(text, caret, shortcut.message ?? "");
      setText(next.text);
      placeCaret(next.cursor, focus);
    }
    setSuggestions([]);
  }

  function pickFromPopover(shortcut: MessageShortcut) {
    if (shortcut.attachments.length > 0) {
      setMedia(fromShortcut(shortcut));
      setText(shortcut.message ?? "");
    } else {
      setText(`${shortcut.message ?? ""} `);
    }
    setQuickOpen(false);
    input.current?.focus();
  }

  function send(override?: string) {
    const body = override ?? text;
    if (media.length === 0 && !body.trim()) return;
    onSend(body.trim(), media);
    setText("");
    setMedia([]);
    setSuggestions([]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length > 0) {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        return setActive((index) => Math.max(index - 1, 0));
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        return setActive((index) => Math.min(index + 1, suggestions.length - 1));
      }
      if (event.key === "Tab") {
        // Tab only expands; it never sends.
        event.preventDefault();
        const shortcut = suggestions[active];
        if (shortcut) applyShortcut(shortcut, false);
        return;
      }
      if (event.key === "Enter") {
        // Enter sends the highlighted shortcut straight away (media shortcuts are queued instead).
        event.preventDefault();
        const shortcut = suggestions[active];
        setSuggestions([]);
        if (!shortcut) return;
        if (shortcut.attachments.length > 0) {
          setText("");
          setMedia(fromShortcut(shortcut));
        } else {
          onSend((shortcut.message ?? "").trim(), []);
          setText("");
          setMedia([]);
        }
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (media.length > 0 || text.trim()) send();
      else onNext();
    }
  }

  function onChange(value: string, caret: number) {
    setText(value);
    window.clearTimeout(debounce.current);
    // 150 ms debounce like legacy so typing never lags behind the suggestion lookup.
    debounce.current = window.setTimeout(() => {
      const matches = matchShortcuts(value, caret, shortcuts);
      setSuggestions(matches);
      setActive(0);
    }, 150);
  }

  async function suggestReply() {
    if (aiBusy) return;
    setAiBusy(true);
    setAiSuggestion(null);
    try {
      const response = await api.aiReplySuggestion(conversationId);
      if (response.suggestion?.trim()) setAiSuggestion({ text: response.suggestion, dryRun: response.dry_run });
      else toast.error(t("chat.aiEmpty"));
    } catch (error) {
      toast.error(t("chat.aiFailed", { error: errorText(error) }));
    } finally {
      setAiBusy(false);
    }
  }

  /** Legacy `/api/ai-agent/yanit-ve-gonder`: the server drafts and sends; a dry-run draft only comes back as a suggestion. */
  async function suggestAndSend() {
    if (aiBusy) return;
    setAiBusy(true);
    setAiSuggestion(null);
    try {
      onAiSent(await api.aiReplyAndSend(conversationId));
      toast.success(t("chat.aiSent"));
    } catch (error) {
      if (error instanceof ApiError && error.code === "ai_live_disabled") {
        // Live AI off: nothing reached the customer — show the draft as a suggestion instead.
        const draft = typeof error.details?.suggestion === "string" ? error.details.suggestion.trim() : "";
        if (draft) setAiSuggestion({ text: draft, dryRun: true });
        toast.error(t("chat.aiDryRunNotSent"));
      } else if (error instanceof ApiError && error.code === "already_answered") {
        toast.error(t("chat.aiAlreadyAnswered"));
      } else if (error instanceof ApiError && error.code === "ai_empty") {
        toast.error(t("chat.aiEmpty"));
      } else {
        toast.error(t("chat.aiFailed", { error: errorText(error) }));
      }
    } finally {
      setAiBusy(false);
    }
  }

  // Desktop: the purple button suggests right away (legacy); below lg it opens the AI menu (öner / üret & gönder).
  const aiButton = (
    <button
      type="button"
      onClick={desktop ? () => void suggestReply() : undefined}
      disabled={aiBusy}
      aria-haspopup={desktop ? undefined : "menu"}
      aria-label={desktop ? t("chat.aiSuggest") : t("chat.aiMenu")}
      className={cn(roundButton, aiBusy ? "animate-pulse bg-purple-700" : "bg-purple-600 shadow-lg shadow-purple-600/20 hover:bg-purple-500")}
      data-testid="composer-ai"
    >
      {aiBusy ? <Loader2 className="size-5 animate-spin text-white" aria-hidden="true" /> : <Bot className="size-5 text-white" aria-hidden="true" />}
    </button>
  );

  const pickFile = (files: FileList | null) => {
    const file = files?.[0];
    if (file) setMedia([fromFile(file)]);
  };
  const single = media.length === 1 ? media[0] : null;

  return (
    <div
      className="relative border-t border-msg-border bg-msg-raised px-2 py-2 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] max-lg:pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-3 max-lg:sm:px-4"
      data-testid="message-composer"
    >
      <div className="mx-auto flex max-w-4xl items-end gap-1.5 sm:gap-3 max-lg:sm:gap-2">
        <input
          ref={imageInput}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={(event) => {
            pickFile(event.target.files);
            event.target.value = "";
          }}
          data-testid="composer-image-file"
        />
        <input
          ref={pdfInput}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(event) => {
            pickFile(event.target.files);
            event.target.value = "";
          }}
          data-testid="composer-pdf-file"
        />
        <Tip label={t("chat.attachImage")} className={chatTipClass}>
          <button type="button" onClick={() => imageInput.current?.click()} className={cn(squareButton, "text-msg-muted hover:bg-msg-hover-raised max-lg:hidden")} aria-label={t("chat.attachImage")} data-testid="composer-attach-image">
            <Image className="size-5" aria-hidden="true" />
          </button>
        </Tip>
        <Tip label={t("chat.attachPdf")} className={chatTipClass}>
          <button type="button" onClick={() => pdfInput.current?.click()} className={cn(squareButton, "text-msg-muted hover:bg-msg-hover-raised max-lg:hidden")} aria-label={t("chat.attachPdf")} data-testid="composer-attach-pdf">
            <FileText className="size-5" aria-hidden="true" />
          </button>
        </Tip>
        <Tip label={t("chat.quickReplies")} className={chatTipClass}>
          <button
            type="button"
            onClick={() => setQuickOpen((open) => !open)}
            className={cn(squareButton, "transition-colors max-lg:hidden", quickOpen ? "bg-msg-primary/20 text-msg-primary-text" : "text-msg-muted hover:bg-msg-hover-raised hover:text-yellow-500 dark:hover:text-yellow-400")}
            aria-label={t("chat.quickReplies")}
            aria-expanded={quickOpen}
            data-testid="composer-quick-replies"
          >
            <Zap className="size-5" aria-hidden="true" />
          </button>
        </Tip>

        <div className="lg:hidden">
          <ComposerMenu
            open={attachOpen}
            onOpenChange={setAttachOpen}
            align="start"
            testId="composer-attach-options"
            trigger={
              <button
                type="button"
                className={cn(squareButton, "text-msg-muted hover:bg-msg-hover-raised", attachOpen && "bg-msg-primary/20 text-msg-primary-text")}
                aria-label={t("chat.attachMenu")}
                aria-haspopup="menu"
                data-testid="composer-attach-menu"
              >
                <Plus className="size-5" aria-hidden="true" />
              </button>
            }
          >
            <ComposerMenuItem icon={<Image className="size-5 text-msg-muted" aria-hidden="true" />} onClick={() => (setAttachOpen(false), imageInput.current?.click())} testId="composer-attach-menu-image">
              {t("chat.attachImage")}
            </ComposerMenuItem>
            <ComposerMenuItem icon={<FileText className="size-5 text-red-500 dark:text-red-400" aria-hidden="true" />} onClick={() => (setAttachOpen(false), pdfInput.current?.click())} testId="composer-attach-menu-pdf">
              {t("chat.attachPdf")}
            </ComposerMenuItem>
            <ComposerMenuItem icon={<Zap className="size-5 text-yellow-500 dark:text-yellow-400" aria-hidden="true" />} onClick={() => (setAttachOpen(false), setQuickOpen(true))} testId="composer-attach-menu-quick">
              {t("chat.quickReplies")}
            </ComposerMenuItem>
          </ComposerMenu>
        </div>

        {quickOpen && <QuickReplies shortcuts={shortcuts} onPick={pickFromPopover} onClose={() => setQuickOpen(false)} onChanged={onShortcutsChanged} />}

        <div className="relative min-w-[96px] flex-1">
          {suggestions.length > 0 && (
            <div className="absolute bottom-full left-0 z-50 mb-2 w-full max-w-md overflow-hidden rounded-xl border border-msg-border-strong bg-msg-raised shadow-2xl" role="listbox" aria-label={t("chat.quickReplies")} data-testid="shortcut-suggestions">
              {suggestions.map((shortcut, index) => (
                <div
                  key={shortcut.public_id}
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyShortcut(shortcut, true)}
                  className={cn("flex cursor-pointer items-center gap-3 border-b border-msg-border/50 px-4 py-2.5 transition-colors last:border-0", index === active ? "bg-msg-hover-raised" : "hover:bg-msg-hover-raised/50")}
                  data-testid="shortcut-suggestion"
                >
                  <code className="rounded bg-msg-primary/10 px-1.5 py-0.5 font-mono text-xs font-bold text-msg-primary-text">{shortcut.code}</code>
                  <ShortcutMediaGlyph shortcut={shortcut} />
                  <span className="truncate text-sm text-msg-fg">{shortcut.message || shortcut.attachments[0]?.original_name || ""}</span>
                </div>
              ))}
            </div>
          )}

          <Textarea
            unstyled
            ref={input}
            value={text}
            onChange={(event) => onChange(event.target.value, event.target.selectionStart)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={media.length > 0 ? t("chat.typeMessageWithMedia") : t("chat.typeMessage")}
            aria-label={t("chat.typeMessage")}
            className="flex h-[42px] min-h-10 w-full resize-none items-center rounded-xl border border-msg-border bg-msg-base/50 px-4 py-2.5 text-sm text-msg-fg placeholder:text-msg-subtle msg-scrollbar-none focus:border-msg-primary focus:bg-msg-base focus:ring-1 focus:ring-msg-primary focus:outline-none max-lg:h-11 max-lg:py-2 max-lg:text-base"
            data-testid="message-input"
          />

          {media.length > 1 ? (
            <div className="absolute right-0 bottom-14 left-0 mx-2 mb-1 rounded-xl border border-msg-border-strong bg-msg-base p-2" data-testid="media-preview">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-medium text-msg-muted">{t("chat.mediaCount", { count: media.length })}</span>
                <button type="button" onClick={() => setMedia([])} className="rounded-full p-0.5 text-msg-muted hover:text-red-500" aria-label={t("chat.removeMedia")}>
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 msg-scrollbar">
                {media.map((item) => (
                  <div key={item.key} className="relative shrink-0">
                    <MediaThumb media={item} size="sm" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            single && (
              <div className="absolute right-0 bottom-14 left-0 mx-2 mb-1 flex items-center gap-2 rounded-xl border border-msg-border-strong bg-msg-base p-2" data-testid="media-preview">
                <MediaThumb media={single} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-msg-fg-soft">{single.name}</p>
                  <p className="text-xs text-msg-subtle">{t(mediaLabelKey(single))}</p>
                </div>
                <button type="button" onClick={() => setMedia([])} className="rounded-full p-1 text-msg-muted hover:bg-msg-hover-raised hover:text-red-500" aria-label={t("chat.removeMedia")} data-testid="media-remove">
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            )
          )}
        </div>

        {desktop ? (
          <Tip label={t("chat.aiSuggest")} className={chatTipClass}>
            {aiButton}
          </Tip>
        ) : (
          <ComposerMenu open={aiMenuOpen} onOpenChange={setAiMenuOpen} align="end" testId="composer-ai-menu" trigger={aiButton}>
            <ComposerMenuItem icon={<Bot className="size-5 text-purple-500" aria-hidden="true" />} onClick={() => (setAiMenuOpen(false), void suggestReply())} testId="composer-ai-menu-suggest">
              {t("chat.aiSuggest")}
            </ComposerMenuItem>
            <ComposerMenuItem icon={<Zap className="size-5 text-emerald-500" aria-hidden="true" />} onClick={() => (setAiMenuOpen(false), void suggestAndSend())} testId="composer-ai-menu-send">
              {t("chat.aiSuggestAndSend")}
            </ComposerMenuItem>
          </ComposerMenu>
        )}
        <Tip label={t("chat.aiSuggestAndSend")} className={chatTipClass}>
        <button
          type="button"
          onClick={() => void suggestAndSend()}
          disabled={aiBusy}
          aria-label={t("chat.aiSuggestAndSend")}
          className={cn(roundButton, "max-lg:hidden", aiBusy ? "animate-pulse bg-emerald-700" : "bg-emerald-600 shadow-lg shadow-emerald-600/20 hover:bg-emerald-500")}
          data-testid="composer-ai-send"
        >
          {aiBusy ? <Loader2 className="size-5 animate-spin text-white" aria-hidden="true" /> : <Zap className="size-5 text-white" aria-hidden="true" />}
        </button>
        </Tip>
        <button
          type="button"
          onClick={() => send()}
          disabled={!text.trim() && media.length === 0}
          aria-label={t("chat.send")}
          className={cn(roundButton, "bg-msg-primary text-msg-on-primary shadow-lg shadow-msg-primary/20 hover:bg-msg-primary/90")}
          data-testid="message-send-button"
        >
          <SendHorizontal className="size-5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </button>
      </div>

      {aiSuggestion && (
        <div className="mx-3 mb-2 rounded-xl border border-purple-300 bg-purple-50 p-3 dark:border-purple-700/50 dark:bg-purple-950/40" data-testid="ai-suggestion">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-medium text-purple-700 dark:text-purple-300">
              <Bot className="size-3.5" aria-hidden="true" />
              {t("chat.aiSuggestionTitle")}
              {aiSuggestion.dryRun && <span className="font-normal opacity-70">· {t("chat.aiDryRun")}</span>}
            </div>
            <button type="button" onClick={() => setAiSuggestion(null)} className="rounded-full p-0.5 text-purple-500 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-200" aria-label={t("chat.close")}>
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
          <p className="mb-2 max-h-32 overflow-y-auto text-sm whitespace-pre-wrap text-purple-900 dark:text-purple-100">{aiSuggestion.text}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setText(aiSuggestion.text);
                setAiSuggestion(null);
                input.current?.focus();
              }}
              className="flex-1 rounded-lg bg-purple-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-purple-600 max-md:min-h-11"
              data-testid="ai-suggestion-use"
            >
              {t("chat.aiUse")}
            </button>
            <button
              type="button"
              disabled={aiSuggestion.dryRun}
              onClick={() => {
                if (aiSuggestion.dryRun) return;
                const reply = aiSuggestion.text;
                setAiSuggestion(null);
                setText("");
                onSend(reply.trim(), []);
              }}
              className="flex-1 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50 max-md:min-h-11"
              data-testid="ai-suggestion-send"
            >
              {t("chat.aiSendNow")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
