import type { BackendHttpClient } from "./http-client.js";

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

export interface ReportAnalysisParams {
  startDate: string;
  endDate: string;
  personnelPublicId?: string;
  cargoProvider?: ReportCargoProvider;
}

export function createReportsClient(http: BackendHttpClient) {
  return {
    getAnalysis: (params: ReportAnalysisParams) => {
      const search = new URLSearchParams();
      search.set("start_date", params.startDate);
      search.set("end_date", params.endDate);
      search.set("cargo_provider", params.cargoProvider ?? "tumu");
      if (params.personnelPublicId) search.set("personnel_public_id", params.personnelPublicId);
      return http.request<ReportAnalysis>(`/api/reports/analysis?${search.toString()}`);
    },
  };
}

export type ReportsClient = ReturnType<typeof createReportsClient>;
