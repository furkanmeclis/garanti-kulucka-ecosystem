/** SMS (`/api/sms/*`) and comment moderation (`/api/comments*`) shapes used by the beta pages. */
export type SmsHistoryType = "all" | "manual" | "automatic";
export type SmsDeliveryStatus = "queued" | "sent" | "failed";

export interface SmsTemplate {
  public_id: string;
  title: string;
  body: string;
  sort_order: number;
  is_active: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface SmsMessage {
  public_id: string;
  recipient_phone: string;
  customer_name: string | null;
  tracking_number: string | null;
  message: string;
  is_automatic: boolean;
  status: SmsDeliveryStatus;
  error_message: string | null;
  provider_bulk_id: string | null;
  request_id: string;
  job_id: string | null;
  queued: boolean;
  created_at: string;
}

export interface SmsHistoryResponse {
  data: SmsMessage[];
  total: number;
  page: number;
  page_size: number;
}

export interface ManualSmsSendRequest {
  recipients: string[];
  message: string;
  idempotency_key: string;
  template_public_id?: string;
  customer_name?: string;
  shipment_public_id?: string;
  tracking_number?: string;
}

export interface ManualSmsSendResponse {
  provider: "netgsm";
  operation: "sms.send";
  recipient_count: number;
  queued_count: number;
  replayed: boolean;
  live_call_permitted: boolean;
  live_gate: string;
  messages: SmsMessage[];
}

export interface AutomaticSmsTriggerResponse {
  provider: "ptt" | "surat";
  operation: "shipment.track";
  checked_count: number;
  queued_count: number;
  job_ids: string[];
  live_call_permitted: boolean;
  live_gate: string;
}

export type CommentStatus = "pending" | "manual" | "auto_replied" | "replied" | "deleted" | "hidden" | "error";
export type CommentPlatform = "instagram" | "facebook";
export type CommentReplyType = "public" | "private";

export interface SocialComment {
  public_id: string;
  platform: CommentPlatform;
  external_comment_id: string;
  media_id: string | null;
  post_id: string | null;
  username: string | null;
  text: string | null;
  status: CommentStatus;
  classification: string | null;
  classification_reason: string | null;
  confidence: number | null;
  ai_reply_draft: string | null;
  manual_reply: string | null;
  reply_type: CommentReplyType | null;
  error_message: string | null;
  received_at: string;
  updated_at: string;
}

export interface CommentListResponse {
  data: SocialComment[];
  total: number;
  page: number;
  page_size: number;
}

export interface CommentModerationConfig {
  enabled: boolean;
  platforms: { instagram: boolean; facebook: boolean };
  reply_type: CommentReplyType;
  delete_profanity: boolean;
  delete_brand_disparagement: boolean;
  risk_manual_examples: string[];
  auto_reply_topics: string[];
  min_confidence: number;
}

export interface CommentControlCheck {
  id: string;
  level: "ok" | "warning" | "error";
  title: string;
  detail: string;
}

export interface CommentControlReport {
  status: "ready" | "warning" | "critical";
  summary: { ok: number; warning: number; error: number };
  warnings: CommentControlCheck[];
  checks: CommentControlCheck[];
}

export interface CommentActionResponse {
  provider: "instagram" | null;
  operation: "comment.reply" | "comment.private_reply" | "comment.hide" | "comment.delete" | null;
  action: "reply" | "private_reply" | "hide" | "delete" | "mark_manual";
  job_id: string | null;
  queued: boolean;
  replayed: boolean;
  live_call_permitted: boolean;
  comment: SocialComment;
}

export interface CommentAiSuggestionResponse {
  provider: "openai";
  operation: "comments.reply_suggestion";
  dry_run: true;
  live_call_permitted: false;
  comment_public_id: string;
  action: string;
  suggestion: string;
}
