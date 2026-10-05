import type { BackendHttpClient } from "./http-client.js";

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

function commentPath(publicId: string, action: string) {
  return `/api/comments/${encodeURIComponent(publicId)}/${action}`;
}

export function createCommentsClient(http: BackendHttpClient) {
  return {
    listComments: (params: { status?: CommentStatus; platform?: CommentPlatform; q?: string; page?: number; pageSize?: number } = {}) => {
      const search = new URLSearchParams();
      search.set("page", String(params.page ?? 1));
      search.set("page_size", String(params.pageSize ?? 30));
      if (params.status) search.set("status", params.status);
      if (params.platform) search.set("platform", params.platform);
      if (params.q?.trim()) search.set("q", params.q.trim());
      return http.request<CommentListResponse>(`/api/comments?${search.toString()}`);
    },
    getStats: () => http.request<{ counts: Record<CommentStatus, number> }>("/api/comments/stats"),
    getControl: () => http.request<CommentControlReport>("/api/comments/control"),
    getSettings: () => http.request<{ config: CommentModerationConfig }>("/api/comments/settings"),
    saveSettings: (config: CommentModerationConfig) =>
      http.request<{ config: CommentModerationConfig }>("/api/comments/settings", { method: "PUT", body: config }),
    reply: (publicId: string, input: { message: string; reply_type: CommentReplyType; idempotency_key: string }) =>
      http.request<CommentActionResponse>(commentPath(publicId, "reply"), { method: "POST", body: input }),
    hide: (publicId: string, idempotencyKey: string) =>
      http.request<CommentActionResponse>(commentPath(publicId, "hide"), {
        method: "POST",
        body: { idempotency_key: idempotencyKey },
      }),
    remove: (publicId: string, idempotencyKey: string) =>
      http.request<CommentActionResponse>(commentPath(publicId, "delete"), {
        method: "POST",
        body: { idempotency_key: idempotencyKey },
      }),
    markManual: (publicId: string, idempotencyKey: string) =>
      http.request<CommentActionResponse>(commentPath(publicId, "manual"), {
        method: "POST",
        body: { idempotency_key: idempotencyKey },
      }),
    suggestReply: (publicId: string) =>
      http.request<CommentAiSuggestionResponse>(commentPath(publicId, "ai-suggestion"), { method: "POST", body: {} }),
  };
}

export type CommentsClient = ReturnType<typeof createCommentsClient>;
