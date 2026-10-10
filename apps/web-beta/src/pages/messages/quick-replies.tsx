import { Copy, Download, FileText, Image, Pencil, Plus, Trash2, X, Zap } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { ApiError } from "@/lib/api";
import { attachmentTypeOf, type AttachmentType, type MessageShortcut } from "@/lib/inbox";
import { cn } from "@/lib/utils";
import { errorText } from "../accounting-shared";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tip } from "@/components/ui/tooltip";
import { useChatConfirm, useChatToast } from "./chat-ui";
import { chatTipClass } from "./top-bar";

interface DraftMedia {
  key: string;
  name: string;
  attachment_type: AttachmentType;
  file?: File;
  file_public_id?: string;
  preview_url?: string;
}

const emptyDraft = { id: null as string | null, type: "custom" as MessageShortcut["type"], originalCode: "", code: "", message: "", media: [] as DraftMedia[] };

/** Small media glyph used in the list and in the inline suggestions (legacy: video purple, PDF red, image slate). */
export function ShortcutMediaGlyph({ shortcut }: { shortcut: MessageShortcut }) {
  const first = shortcut.attachments[0];
  if (!first) return null;
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {first.attachment_type === "video" ? (
        <Image className="size-3.5 text-purple-500 dark:text-purple-400" aria-hidden="true" />
      ) : first.attachment_type === "document" ? (
        <FileText className="size-3.5 text-red-500 dark:text-red-400" aria-hidden="true" />
      ) : (
        <Image className="size-3.5 text-msg-muted" aria-hidden="true" />
      )}
      {shortcut.attachments.length > 1 && <span className="text-[10px] text-msg-muted">x{shortcut.attachments.length}</span>}
    </span>
  );
}

const iconButton = "rounded p-1 text-msg-muted transition-colors hover:bg-msg-hover-raised max-md:inline-flex max-md:size-11 max-md:items-center max-md:justify-center";

/** Legacy "Hızlı Cevaplar" popover above the composer: pick, copy, download, edit, delete, add (≤10 media) and JSON export. */
export function QuickReplies({ shortcuts, onPick, onClose, onChanged }: { shortcuts: MessageShortcut[]; onPick: (shortcut: MessageShortcut) => void; onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const toast = useChatToast();
  const confirm = useChatConfirm();
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  function reset() {
    setDraft(emptyDraft);
    setFormOpen(false);
  }

  async function save() {
    const code = draft.code.trim().replace(/^\//, "");
    if (!code) return toast.error(t("chat.shortcutCodeRequired"));
    if (!draft.message.trim() && draft.media.length === 0) return toast.error(t("chat.shortcutContentRequired"));
    if (draft.id && draft.type === "default" && code !== draft.originalCode) return toast.error(t("chat.defaultCodeLocked"));
    const clash = shortcuts.find((item) => item.code === code && item.public_id !== draft.id);
    if (clash) return toast.error(t("chat.shortcutDuplicate", { code }));
    setSaving(true);
    try {
      const attachments = await Promise.all(
        draft.media.map(async (item) => ({ file_public_id: item.file_public_id ?? (await api.uploadFile(item.file!)).public_id, attachment_type: item.attachment_type })),
      );
      const input = { code, message: draft.message.trim() || null, attachments };
      if (draft.id) await api.updateShortcut(draft.id, input);
      else await api.createShortcut(input);
      toast.success(t("chat.shortcutSaved"));
      reset();
      onChanged();
    } catch (error) {
      toast.error(error instanceof ApiError && error.status === 409 ? t("chat.shortcutDuplicate", { code }) : t("chat.failed", { error: errorText(error) }));
    } finally {
      setSaving(false);
    }
  }

  async function remove(shortcut: MessageShortcut) {
    if (!(await confirm(shortcut.type === "default" ? t("chat.disableDefaultConfirm") : t("chat.deleteConfirm"), { confirmLabel: t("chat.delete"), tone: "danger" }))) return;
    try {
      await api.deleteShortcut(shortcut.public_id);
      toast.success(t("chat.shortcutDeleted"));
      onChanged();
    } catch (error) {
      toast.error(t("chat.failed", { error: errorText(error) }));
    }
  }

  function edit(shortcut: MessageShortcut) {
    setDraft({
      id: shortcut.public_id,
      type: shortcut.type,
      originalCode: shortcut.code,
      code: shortcut.code,
      message: shortcut.message ?? "",
      media: shortcut.attachments.map((item) => ({ key: item.file_public_id, name: item.original_name ?? item.file_public_id, attachment_type: item.attachment_type, file_public_id: item.file_public_id })),
    });
    setFormOpen(true);
  }

  async function downloadMedia(shortcut: MessageShortcut) {
    toast.success(shortcut.attachments.length > 1 ? t("chat.downloadFiles", { count: shortcut.attachments.length }) : t("chat.downloading"));
    for (const attachment of shortcut.attachments) {
      try {
        const response = await api.fileDownload(attachment.file_public_id);
        if (response.download.presigned_url) window.open(response.download.presigned_url, "_blank", "noopener");
      } catch {
        // A missing file only skips that download.
      }
    }
  }

  function exportJson() {
    const payload = shortcuts.map((row) => ({ code: row.code, message: row.message, type: row.type, is_active: row.is_active, sort_order: row.sort_order, attachments: row.attachments.map((item) => item.original_name ?? item.file_public_id) }));
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kisayollar_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast.success(t("chat.downloaded"));
  }

  const field = "w-full rounded border border-msg-border-strong bg-msg-field px-2 py-1.5 text-xs text-msg-fg placeholder:text-msg-subtle focus:border-msg-primary focus:outline-none max-lg:text-base";

  return (
    <div className="absolute bottom-20 left-1/2 z-50 w-80 max-w-[calc(100vw-1rem)] -translate-x-1/2 overflow-hidden rounded-xl max-lg:right-2 max-lg:bottom-full max-lg:left-2 max-lg:mb-1 max-lg:w-auto max-lg:max-w-none max-lg:translate-x-0 border border-msg-border-strong bg-msg-raised shadow-xl" role="dialog" aria-label={t("chat.quickReplies")} data-testid="quick-replies">
      <div className="flex items-center justify-between border-b border-msg-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Zap className="size-4 text-yellow-500 dark:text-yellow-400" aria-hidden="true" />
          <span className="text-xs font-semibold text-msg-fg-soft">{t("chat.quickReplies")}</span>
        </div>
        <div className="flex items-center gap-1">
          <Tip label={t("chat.downloadAll")} className={chatTipClass}>
          <button type="button" onClick={exportJson} className={cn(iconButton, "hover:text-emerald-500")} aria-label={t("chat.downloadAll")} data-testid="shortcuts-export">
            <Download className="size-3.5" aria-hidden="true" />
          </button>
          </Tip>
          <Tip label={t("chat.addShortcut")} className={chatTipClass}>
          <button
            type="button"
            onClick={() => (formOpen ? reset() : setFormOpen(true))}
            className={cn(iconButton, "hover:text-msg-primary-text")}
            aria-label={t("chat.addShortcut")}
            data-testid="shortcut-add"
          >
            <Plus className="size-3.5" aria-hidden="true" />
          </button>
          </Tip>
          <button type="button" onClick={onClose} className={cn(iconButton, "hover:text-red-500")} aria-label={t("chat.close")} data-testid="quick-replies-close">
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {formOpen && (
        <div className="space-y-2 border-b border-msg-border bg-msg-base/50 p-3" data-testid="shortcut-form">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="image/*,video/*,application/pdf"
            className="hidden"
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (draft.media.length + picked.length > 10) toast.error(t("chat.attachmentLimit"));
              setDraft((prev) => ({
                ...prev,
                media: [
                  ...prev.media,
                  ...picked.map((file, index) => ({ key: `${file.name}-${Date.now()}-${index}`, name: file.name, file, attachment_type: attachmentTypeOf(file), preview_url: URL.createObjectURL(file) })),
                ].slice(0, 10),
              }));
            }}
            data-testid="shortcut-file"
          />
          <Input unstyled type="text" placeholder={t("chat.shortcutCodePh")} aria-label={t("chat.shortcutCodePh")} value={draft.code} onChange={(event) => setDraft((prev) => ({ ...prev, code: event.target.value }))} className={field} data-testid="shortcut-code" />
          <Textarea
            unstyled
            placeholder={draft.media.length > 0 ? t("chat.shortcutCaptionPh") : t("chat.shortcutMessagePh")}
            aria-label={t("chat.shortcutMessagePh")}
            value={draft.message}
            onChange={(event) => setDraft((prev) => ({ ...prev, message: event.target.value }))}
            rows={2}
            className={cn(field, "resize-none")}
            data-testid="shortcut-message"
          />
          {draft.media.length > 0 && (
            <div className="space-y-1">
              {draft.media.map((item) => (
                <div key={item.key} className="flex items-center gap-2 rounded border border-msg-border-strong bg-msg-field/50 p-1.5">
                  {item.preview_url && item.attachment_type === "image" ? (
                    <img src={item.preview_url} alt="" className="h-8 w-12 shrink-0 rounded object-cover" />
                  ) : item.preview_url && item.attachment_type === "video" ? (
                    <video src={item.preview_url} className="h-8 w-12 shrink-0 rounded object-cover" muted />
                  ) : (
                    <div className="flex h-8 w-12 shrink-0 items-center justify-center rounded bg-msg-chip">
                      {item.attachment_type === "document" ? <FileText className="size-4 text-red-500 dark:text-red-400" aria-hidden="true" /> : <Image className="size-4 text-msg-muted" aria-hidden="true" />}
                    </div>
                  )}
                  <span className="flex-1 truncate text-[10px] text-msg-fg-soft">{item.name}</span>
                  <button type="button" onClick={() => setDraft((prev) => ({ ...prev, media: prev.media.filter((entry) => entry.key !== item.key) }))} className="rounded p-0.5 text-msg-subtle hover:text-red-500" aria-label={t("chat.removeMedia")}>
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {draft.media.length < 10 && (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-msg-border-strong py-1.5 text-[11px] text-msg-subtle transition-colors hover:border-msg-primary hover:text-msg-primary-text"
            >
              <Image className="size-3.5" aria-hidden="true" />
              {draft.media.length === 0 ? t("chat.addMediaOptional") : t("chat.addMediaCount", { count: draft.media.length })}
            </button>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !draft.code.trim() || (!draft.message.trim() && draft.media.length === 0)}
              className="flex-1 rounded bg-msg-primary px-2 py-1 text-xs font-medium text-msg-on-primary hover:bg-msg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="shortcut-save"
            >
              {saving ? t("chat.saving") : draft.id ? t("chat.update") : t("chat.add")}
            </button>
            <button type="button" onClick={reset} className="rounded px-2 py-1 text-xs text-msg-muted hover:bg-msg-hover-raised">
              {t("chat.cancel")}
            </button>
          </div>
        </div>
      )}

      <div className="max-h-60 overflow-y-auto overscroll-y-contain p-1 msg-scrollbar max-lg:max-h-[45dvh]" data-testid="shortcut-list">
        {shortcuts.length === 0 && <p className="px-2 py-3 text-center text-xs text-msg-subtle">{t("chat.shortcutsEmpty")}</p>}
        {shortcuts.map((shortcut) => {
          const text = shortcut.message ?? "";
          return (
            <div key={shortcut.public_id} className="group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-msg-hover-raised/70" data-testid={`shortcut-row-${shortcut.code}`}>
              <button type="button" onClick={() => onPick(shortcut)} className="flex min-w-0 flex-1 items-center gap-2 text-left max-lg:min-h-11" data-testid={`shortcut-${shortcut.code}`}>
                <span className="shrink-0 rounded bg-msg-primary/10 px-1.5 py-0.5 font-mono text-xs font-bold text-msg-primary-text">{shortcut.code}</span>
                <ShortcutMediaGlyph shortcut={shortcut} />
                <span className="truncate text-xs text-msg-fg-soft">{text ? (text.length > 40 ? `${text.substring(0, 40)}...` : text) : (shortcut.attachments[0]?.original_name ?? "")}</span>
              </button>
              <div className="hidden shrink-0 items-center gap-0.5 group-focus-within:flex group-hover:flex max-lg:flex">
                {text && (
                  <Tip label={t("chat.copyText")} className={chatTipClass}>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      navigator.clipboard
                        .writeText(text)
                        .then(() => toast.success(t("chat.copied")))
                        .catch(() => toast.error(t("chat.copyFailed")));
                    }}
                    className="rounded p-1 text-msg-subtle transition-colors hover:bg-sky-500/20 hover:text-sky-500"
                    aria-label={t("chat.copyText")}
                  >
                    <Copy className="size-3" aria-hidden="true" />
                  </button>
                  </Tip>
                )}
                {shortcut.attachments.length > 0 && (
                  <Tip label={shortcut.attachments.length > 1 ? t("chat.downloadFiles", { count: shortcut.attachments.length }) : t("chat.downloadFile")} className={chatTipClass}>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void downloadMedia(shortcut);
                    }}
                    className="rounded p-1 text-msg-subtle transition-colors hover:bg-emerald-500/20 hover:text-emerald-500"
                    aria-label={t("chat.downloadFile")}
                  >
                    <Download className="size-3" aria-hidden="true" />
                  </button>
                  </Tip>
                )}
                <Tip label={t("chat.editShortcut")} className={chatTipClass}>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    edit(shortcut);
                  }}
                  className="rounded p-1 text-msg-subtle transition-colors hover:bg-msg-primary/20 hover:text-msg-primary-text"
                  aria-label={t("chat.editShortcut")}
                  data-testid="shortcut-edit"
                >
                  <Pencil className="size-3" aria-hidden="true" />
                </button>
                </Tip>
                <Tip label={t("chat.deleteShortcut")} className={chatTipClass}>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void remove(shortcut);
                  }}
                  className="rounded p-1 text-msg-subtle transition-colors hover:bg-red-500/20 hover:text-red-500"
                  aria-label={t("chat.deleteShortcut")}
                  data-testid="shortcut-delete"
                >
                  <Trash2 className="size-3" aria-hidden="true" />
                </button>
                </Tip>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
