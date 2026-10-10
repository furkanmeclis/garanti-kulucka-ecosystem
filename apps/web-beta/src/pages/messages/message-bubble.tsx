import { Bot, Check, CheckCheck, Clock, Paperclip } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import type { ApiClient } from "@/lib/api";
import { clockTime, isPending } from "@/lib/chat";
import type { MessageAttachment, ThreadMessage } from "@/lib/inbox";
import { cn } from "@/lib/utils";
import { AudioPlayer, VideoPlayer } from "./media-player";

/** Optimistic attachments carry a local object URL until the server copy exists. */
export type ChatAttachment = MessageAttachment & { preview_url?: string };
export type ChatMessage = Omit<ThreadMessage, "attachments"> & { attachments: ChatAttachment[] };

/** Presigned download URLs are short-lived; cache them for the session so polling does not refetch every bubble. */
const urlCache = new Map<string, Promise<string | null>>();

function resolveUrl(api: ApiClient, filePublicId: string) {
  let cached = urlCache.get(filePublicId);
  if (!cached) {
    cached = api
      .fileDownload(filePublicId)
      .then((response) => response.download.presigned_url)
      .catch(() => {
        urlCache.delete(filePublicId);
        return null;
      });
    urlCache.set(filePublicId, cached);
  }
  return cached;
}

const mediaKind = (attachment: ChatAttachment) => {
  const mime = attachment.mime_type ?? "";
  if (attachment.attachment_type === "image" || mime.startsWith("image/")) return "image";
  if (attachment.attachment_type === "video" || mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
};

/** Legacy media block: inline image / video / audio, documents as a 📎 link. */
function AttachmentMedia({ attachment }: { attachment: ChatAttachment }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [url, setUrl] = useState<string | null>(attachment.preview_url ?? null);
  useEffect(() => {
    if (attachment.preview_url) return setUrl(attachment.preview_url);
    let active = true;
    void resolveUrl(api, attachment.file_public_id).then((value) => active && setUrl(value));
    return () => {
      active = false;
    };
  }, [api, attachment.file_public_id, attachment.preview_url]);

  const kind = mediaKind(attachment);
  const name = attachment.original_name ?? t("chat.fileFallback");
  if (url && kind === "video") return <VideoPlayer src={url} />;
  if (url && kind === "image")
    return (
      <img
        src={url}
        alt={t("chat.mediaAlt")}
        className="mb-1 max-h-52 max-w-[260px] cursor-pointer rounded-lg object-contain"
        onClick={() => window.open(url, "_blank", "noopener")}
        data-testid="message-attachment"
      />
    );
  if (url && kind === "audio") return <AudioPlayer src={url} />;
  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        if (url) return;
        // No presigned URL yet (or storage is off): ask again on click instead of a dead link.
        event.preventDefault();
        urlCache.delete(attachment.file_public_id);
        void resolveUrl(api, attachment.file_public_id).then((value) => value && window.open(value, "_blank", "noopener"));
      }}
      className="mb-1 flex items-center gap-1.5 rounded-lg bg-black/5 px-2.5 py-1.5 text-xs text-blue-700 underline hover:text-blue-600 dark:bg-black/20 dark:text-blue-300 dark:hover:text-blue-200"
      data-testid="message-attachment"
    >
      <Paperclip className="size-3.5 shrink-0" aria-hidden="true" />
      {name}
    </a>
  );
}

/** Legacy bubble: agent (right, #3b1f6b), AI (left, purple), customer (left, slate); time + read ticks underneath. */
export function MessageBubble({ message, agentFallback }: { message: ChatMessage; agentFallback: string }) {
  const { t, i18n } = useTranslation();
  const mine = message.sender_type === "user";
  const ai = message.sender_type === "ai";
  const body = message.body ?? "";
  const hasMedia = message.attachments.length > 0;
  // "[Görsel]"-style placeholders only describe the media; show them when there is nothing else to render.
  const showBody = hasMedia ? Boolean(body) && !body.startsWith("[") : Boolean(body);
  const pending = isPending(message);

  return (
    <div className={cn("mb-0.5 flex flex-col", mine ? "items-end" : "items-start")} data-testid="thread-message" data-sender={message.sender_type} data-pending={pending ? "true" : undefined}>
      {mine && <span className="mb-0.5 px-1 text-[10px] text-msg-subtle">{message.sender_name || agentFallback}</span>}
      <div
        className={cn(
          "group relative w-fit max-w-[82%] rounded-xl lg:max-w-[58%] px-3 py-1.5 shadow-sm select-text",
          ai ? "border border-msg-ai-border bg-msg-ai-bg text-msg-ai-fg" : mine ? "bg-msg-out-bg text-msg-out-fg" : "border border-msg-in-border bg-msg-in-bg text-msg-in-fg",
          pending && "opacity-70",
        )}
      >
        {ai && (
          <div className="mb-0.5 flex items-center gap-1 text-[10px] font-medium text-purple-600 dark:text-purple-400">
            <Bot className="size-2.5" aria-hidden="true" />
            {t("chat.aiBadge")}
          </div>
        )}
        {message.attachments.map((attachment) => (
          <AttachmentMedia key={attachment.file_public_id} attachment={attachment} />
        ))}
        {showBody && <p className="cursor-text text-[13px] leading-snug break-words whitespace-pre-wrap select-text">{body}</p>}
        <div className={cn("mt-0.5 flex items-center justify-end gap-1 text-[10px]", mine ? "text-msg-out-meta" : ai ? "text-msg-ai-meta" : "text-msg-faint")}>
          <span>{clockTime(message.sent_at, i18n.language)}</span>
          {mine &&
            (pending ? <Clock className="size-3" aria-hidden="true" /> : message.is_read ? <CheckCheck className="size-3" aria-hidden="true" /> : <Check className="size-3" aria-hidden="true" />)}
        </div>
      </div>
    </div>
  );
}
