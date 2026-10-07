import type { BackendHttpClient } from "./http-client.js";

export type InstagramPublicationStatus = "recorded" | "queued" | "dry_run" | "published" | "retrying" | "failed";

export interface InstagramPublication {
  public_id: string;
  account_public_id: string | null;
  media_kind: "image" | "video";
  media_type: "IMAGE" | "REELS" | "VIDEO";
  media_url: string | null;
  file_public_id: string | null;
  caption: string;
  idempotency_key: string;
  request_id: string;
  job_id: string | null;
  queued: boolean;
  status: InstagramPublicationStatus;
  media_id: string | null;
  error_message: string | null;
  created_at: string;
}

export interface InstagramPublishRequest {
  account_public_id?: string | null;
  image_url?: string | null;
  video_url?: string | null;
  file_public_id?: string | null;
  media_type?: "IMAGE" | "REELS" | "VIDEO" | null;
  caption: string;
  idempotency_key: string;
}

export interface InstagramPublishResponse {
  provider: "instagram";
  operation: "media.publish";
  publication: InstagramPublication;
  job_id: string | null;
  queued: boolean;
  replayed: boolean;
  live_call_permitted: boolean;
  live_gate: string;
}

export interface InstagramInsightMetric {
  name: string;
  period: string;
  title?: string;
  description?: string;
  values: Array<{ value: number; end_time: string }>;
}

export interface InstagramAccountInsights {
  success: boolean;
  cached: boolean;
  account_public_id?: string;
  data: InstagramInsightMetric[];
  followers: { followers_count: number; media_count: number } | null;
  period: { days: number; since: number; until: number };
  dry_run: boolean;
  synced_at?: string | null;
  live_gate?: string;
  live_call_permitted: boolean;
}

export interface InstagramInsightsRefresh {
  account_public_id: string;
  request_id: string;
  job_id: string | null;
  queued: boolean;
  live_gate: string;
  live_call_permitted: false;
}

export function createInstagramClient(http: BackendHttpClient) {
  return {
    publish: (input: InstagramPublishRequest) =>
      http.request<InstagramPublishResponse>("/api/instagram/publications", { method: "POST", body: input }),
    getPublication: (publicId: string) =>
      http.request<InstagramPublication>(`/api/instagram/publications/${encodeURIComponent(publicId)}`),
    getAccountInsights: (days: number) =>
      http.request<InstagramAccountInsights>(`/api/instagram/insights/account?days=${encodeURIComponent(String(days))}`),
    refreshAccountInsights: () =>
      http.request<InstagramInsightsRefresh>("/api/instagram/insights/account/refresh", { method: "POST", body: {} }),
  };
}

export type InstagramClient = ReturnType<typeof createInstagramClient>;
