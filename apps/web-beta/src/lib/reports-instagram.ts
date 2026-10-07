/** Report analysis (`/api/reports/analysis`) and Instagram (`/api/instagram/*`) shapes used by the beta pages. */
export type ReportCargoProvider = "tumu" | "ptt" | "surat";
export type LegacyOrderStatusKey =
  | "olusturuldu"
  | "teyit_bekliyor"
  | "teyit_edildi"
  | "hazirlaniyor"
  | "kargoya_verildi"
  | "sevk_edildi"
  | "teslim_edildi"
  | "iptal"
  | "iade";

export interface ReportMetrics {
  toplam: number;
  ciro: number;
  aktif: number;
  iptal: number;
  iade: number;
  sevk_edildi: number;
  teslim_edildi: number;
  kargoya_giden: number;
  ptt: number;
  surat: number;
  ptt_subede: number;
  surat_subede: number;
  subede_toplam: number;
  teyit_edildi: number;
  teyit_bekliyor: number;
  kargo_iade: number;
  ptt_kargo_iade: number;
  surat_kargo_iade: number;
  kargo_takip_iade: number;
}

export interface ReportAnalysis {
  filters: {
    start_date: string;
    end_date: string;
    personnel_public_id: string | null;
    cargo_provider: ReportCargoProvider;
  };
  currency: "TRY";
  metrics: ReportMetrics;
  rates: { teslim: number; iptal: number; iade: number; kargo_iade: number; teyit: number; sube: number };
  status_distribution: Array<{ status: LegacyOrderStatusKey; count: number }>;
  daily_source: "daily_series" | "filtered_rows";
  daily: Array<{ date: string; orders: number; revenue: number; cancelled: number; returned: number }>;
  cargo_providers: Array<{ provider: "ptt" | "surat"; active: number; returns: number }>;
  personnel_performance: Array<{ user_public_id: string; name: string; orders: number; revenue: number; cancelled: number }>;
  personnel_options: Array<{ public_id: string; first_name: string; last_name: string }>;
}

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
