/** Conversation thread, shortcut and file shapes used by the beta Mesajlar page (legacy MesajlarPage). */
export type AttachmentType = "image" | "video" | "document" | "file";

export interface MessageAttachment {
  file_public_id: string;
  attachment_type: AttachmentType;
  original_name: string | null;
  mime_type: string | null;
  byte_size: number | null;
}

export interface ThreadMessage {
  public_id: string;
  sender_type: string;
  sender_name: string | null;
  body: string | null;
  is_read: boolean;
  sent_at: string;
  attachments: MessageAttachment[];
}

export interface MessageShortcut {
  public_id: string;
  code: string;
  message: string | null;
  type: "default" | "custom";
  is_active: boolean;
  sort_order: number;
  attachments: MessageAttachment[];
  updated_at: string;
}

export interface ConversationStateInput {
  status?: string;
  unread_count?: number;
  human_agent_enabled?: boolean;
  is_in_pool?: boolean;
  assign_to_me?: boolean;
}

export interface UploadedFile {
  public_id: string;
  original_name: string | null;
  mime_type: string | null;
  byte_size: number | null;
}

export function attachmentTypeOf(file: File): AttachmentType {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type === "application/pdf") return "document";
  return "file";
}

/** SHA-256 (base64) the upload API checks against the stored object. */
export async function sha256Base64(file: Blob) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary);
}
