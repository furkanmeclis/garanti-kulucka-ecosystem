import { Download, FileJson, Loader2, Paperclip, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { attachmentTypeOf, type AttachmentType, type MessageShortcut } from "@/lib/inbox";
import { errorText, FeedbackLine, Field, type Feedback } from "./accounting-shared";

interface DraftAttachment {
  key: string;
  name: string;
  attachment_type: AttachmentType;
  file?: File;
  file_public_id?: string;
}

const emptyDraft = { id: null as string | null, code: "", message: "", attachments: [] as DraftAttachment[] };

/** Legacy MesajlarPage kısayollar: list, create/edit with media, delete, media download and JSON export. */
export function ShortcutsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [rows, setRows] = useState<MessageShortcut[] | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(emptyDraft);
    setFeedback(null);
    setRows(null);
    api
      .listShortcuts()
      .then((response) => setRows(response.data))
      .catch((error: unknown) => {
        setRows([]);
        setFeedback({ tone: "error", text: t("inbox.actionFailed", { error: errorText(error) }) });
      });
  }, [open, api, t]);

  async function save() {
    const code = draft.code.trim().replace(/^\//, "");
    if (!code || (!draft.message.trim() && draft.attachments.length === 0)) return setFeedback({ tone: "error", text: t("inbox.shortcutRequired") });
    setSaving(true);
    setFeedback(null);
    try {
      const attachments = await Promise.all(
        draft.attachments.map(async (item) => ({ file_public_id: item.file_public_id ?? (await api.uploadFile(item.file!)).public_id, attachment_type: item.attachment_type })),
      );
      const input = { code, message: draft.message.trim() || null, attachments };
      const saved = draft.id ? await api.updateShortcut(draft.id, input) : await api.createShortcut(input);
      setRows((prev) => [saved, ...(prev ?? []).filter((item) => item.public_id !== saved.public_id)].sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code, "tr")));
      setDraft(emptyDraft);
      setFeedback({ tone: "success", text: t("inbox.shortcutSaved") });
    } catch (error) {
      setFeedback({ tone: "error", text: t("inbox.actionFailed", { error: errorText(error) }) });
    } finally {
      setSaving(false);
    }
  }

  async function remove(shortcut: MessageShortcut) {
    if (!window.confirm(t("inbox.shortcutDeleteConfirm", { code: shortcut.code }))) return;
    try {
      await api.deleteShortcut(shortcut.public_id);
      setRows((prev) => (prev ?? []).filter((item) => item.public_id !== shortcut.public_id));
      setFeedback({ tone: "success", text: t("inbox.shortcutDeleted") });
    } catch (error) {
      setFeedback({ tone: "error", text: t("inbox.actionFailed", { error: errorText(error) }) });
    }
  }

  async function download(shortcut: MessageShortcut) {
    const first = shortcut.attachments[0];
    if (!first) return;
    const response = await api.fileDownload(first.file_public_id);
    if (response.download.presigned_url) window.open(response.download.presigned_url, "_blank", "noopener");
  }

  function exportJson() {
    const payload = (rows ?? []).map((row) => ({ code: row.code, message: row.message, type: row.type, is_active: row.is_active, sort_order: row.sort_order, attachments: row.attachments.map((item) => item.original_name ?? item.file_public_id) }));
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kisayollar-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" closeLabel={t("inbox.close")} className="w-[min(34rem,100vw)] overflow-y-auto p-0" data-testid="shortcuts-sheet">
        <SheetHeader className="border-b p-4 pr-14">
          <SheetTitle>{t("inbox.shortcutsManage")}</SheetTitle>
          <SheetDescription>{t("inbox.shortcuts")}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 p-4 text-sm">
          <form
            className="flex flex-col gap-3 rounded-md border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            data-testid="shortcut-form"
          >
            <p className="font-medium">{draft.id ? t("inbox.shortcutEdit") : t("inbox.shortcutNew")}</p>
            <Field label={t("inbox.shortcutCode")}>
              <Input className="h-11 font-mono md:h-9" value={draft.code} onChange={(event) => setDraft((prev) => ({ ...prev, code: event.target.value }))} data-testid="shortcut-code" />
            </Field>
            <Field label={t("inbox.shortcutMessage")}>
              <textarea
                className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
                rows={3}
                value={draft.message}
                onChange={(event) => setDraft((prev) => ({ ...prev, message: event.target.value }))}
                data-testid="shortcut-message"
              />
            </Field>
            {draft.attachments.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {draft.attachments.map((item) => (
                  <li key={item.key} className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 text-xs">
                    <span className="max-w-40 truncate">{item.name}</span>
                    <Button type="button" variant="ghost" size="icon" className="size-11 md:size-7" aria-label={t("inbox.removeAttachment")} onClick={() => setDraft((prev) => ({ ...prev, attachments: prev.attachments.filter((entry) => entry.key !== item.key) }))}>
                      <X className="size-3.5" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="image/*,video/*,application/pdf"
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                const picked = Array.from(event.target.files ?? []).map((file, index) => ({ key: `${file.name}-${Date.now()}-${index}`, name: file.name, file, attachment_type: attachmentTypeOf(file) }));
                setDraft((prev) => ({ ...prev, attachments: [...prev.attachments, ...picked].slice(0, 10) }));
                event.target.value = "";
              }}
              data-testid="shortcut-file"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="min-h-11" onClick={() => fileInput.current?.click()}>
                <Paperclip className="size-4" aria-hidden="true" />
                {t("inbox.attach")}
              </Button>
              {draft.id && (
                <Button type="button" variant="ghost" className="min-h-11" onClick={() => setDraft(emptyDraft)}>
                  {t("users.cancel")}
                </Button>
              )}
              <Button type="submit" className="ml-auto min-h-11" disabled={saving} data-testid="shortcut-save">
                {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
                {t("inbox.shortcutSave")}
              </Button>
            </div>
          </form>
          <FeedbackLine feedback={feedback} testId="shortcuts-feedback" />
          <div className="flex items-center justify-between">
            <span className="font-medium">{t("inbox.shortcuts")}</span>
            <Button variant="outline" className="min-h-11" disabled={!rows || rows.length === 0} onClick={exportJson} data-testid="shortcuts-export">
              <FileJson className="size-4" aria-hidden="true" />
              {t("inbox.shortcutsExport")}
            </Button>
          </div>
          {rows === null ? (
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground">{t("inbox.shortcutsEmpty")}</p>
          ) : (
            <ul className="flex flex-col divide-y" data-testid="shortcuts-list">
              {rows.map((row) => (
                <li key={row.public_id} className="flex items-start gap-2 py-2" data-testid={`shortcut-row-${row.code}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs">/{row.code}</p>
                    <p className="break-words text-muted-foreground">{row.message ?? "-"}</p>
                    {row.attachments.length > 0 && <p className="text-xs text-muted-foreground">{row.attachments.map((item) => item.original_name ?? item.attachment_type).join(", ")}</p>}
                  </div>
                  {row.attachments.length > 0 && (
                    <Button variant="ghost" size="icon" className="size-11 md:size-9" aria-label={t("inbox.shortcutDownload")} onClick={() => void download(row)}>
                      <Download className="size-4" aria-hidden="true" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 md:size-9"
                    aria-label={t("inbox.shortcutEdit")}
                    onClick={() =>
                      setDraft({
                        id: row.public_id,
                        code: row.code,
                        message: row.message ?? "",
                        attachments: row.attachments.map((item) => ({ key: item.file_public_id, name: item.original_name ?? item.file_public_id, attachment_type: item.attachment_type, file_public_id: item.file_public_id })),
                      })
                    }
                    data-testid="shortcut-edit"
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-11 text-destructive md:size-9" aria-label={t("inbox.shortcutDelete")} onClick={() => void remove(row)} data-testid="shortcut-delete">
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
