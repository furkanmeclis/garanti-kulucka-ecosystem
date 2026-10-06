import { sql, type AppDatabase } from "@garanti-kulucka/database";

/**
 * Legacy frontend/src/pages/raporlar/RaporlarPage.jsx ("İş Analizi") reproduced as one
 * backend-owned aggregate. Every legacy Supabase `count: exact` probe becomes a `FILTER` clause
 * over a single date-range scan (orders_created_at_idx); the legacy order columns map as:
 * durum -> orders.status (canonical + legacy synonyms normalised to the legacy keys),
 * teyit_durumu -> orders.confirmation_status, kargo_firmasi -> orders.cargo_provider,
 * kolaybi_siparis_id -> orders.external_order_id, olusturan_id -> orders.created_by_user_id,
 * kargo_son_hareket -> latest shipments.last_event_text of the order.
 */

export const reportTimeZone = "Europe/Istanbul";
export const reportCargoProviders = ["tumu", "ptt", "surat"] as const;
export type ReportCargoProvider = (typeof reportCargoProviders)[number];

export const legacyOrderStatusKeys = [
  "olusturuldu",
  "teyit_bekliyor",
  "teyit_edildi",
  "hazirlaniyor",
  "kargoya_verildi",
  "sevk_edildi",
  "teslim_edildi",
  "iptal",
  "iade",
] as const;
export type LegacyOrderStatusKey = (typeof legacyOrderStatusKeys)[number];

/** Canonical/legacy order status spellings grouped under the legacy `durum` keys. */
export const legacyOrderStatusSynonyms: Record<LegacyOrderStatusKey, readonly string[]> = {
  olusturuldu: ["olusturuldu", "draft", "created", "pending"],
  teyit_bekliyor: ["teyit_bekliyor", "awaiting_confirmation", "pending_confirmation"],
  teyit_edildi: ["teyit_edildi", "confirmed"],
  hazirlaniyor: ["hazirlaniyor", "preparing"],
  kargoya_verildi: ["kargoya_verildi", "shipped"],
  sevk_edildi: ["sevk_edildi", "dispatched", "in_transit"],
  teslim_edildi: ["teslim_edildi", "delivered"],
  iptal: ["iptal", "cancelled"],
  iade: ["iade", "returned"],
};

/** Legacy PTT_SUBE_OR / SURAT_SUBE_OR / KARGO_IADE_OR `kargo_son_hareket.ilike` patterns. */
export const pttBranchPatterns = [
  "%Adreste Yok%",
  "%Haber Kağıdı Bırakıldı%",
  "%Adresten Ayrılmış%",
  "%Taşınmış%",
  "%Kabul Edilmedi%",
  "%İşyerinde Bekliyor%",
] as const;
export const suratBranchPatterns = ["%TekrarGidilecek%", "%AliciSubede%", "%Alıcı Kabul Etmedi%"] as const;
export const cargoTrackingReturnPatterns = [
  "%iade%",
  "%İade%",
  "%IADE%",
  "%geri gönderildi%",
  "%Dağıtımdan İade%",
  "%Dagitimdan Iade%",
] as const;

export interface ReportFilters {
  startDate: string;
  endDate: string;
  personnelPublicId: string | null;
  cargoProvider: ReportCargoProvider;
}

export interface ReportMetricAggregates {
  toplam: number;
  ciro: number;
  iptal: number;
  iade: number;
  sevk_edildi: number;
  teslim_edildi: number;
  kargoya_giden: number;
  ptt: number;
  surat: number;
  ptt_subede: number;
  surat_subede: number;
  teyit_edildi: number;
  teyit_bekliyor: number;
  kargo_iade: number;
  ptt_kargo_iade: number;
  surat_kargo_iade: number;
  kargo_takip_iade: number;
}

export interface ReportDailyAggregate {
  date: string;
  orders: number;
  revenue: number;
  cancelled: number;
  returned: number;
}

export interface ReportPersonnelAggregate {
  user_public_id: string;
  first_name: string | null;
  last_name: string | null;
  listed: boolean;
  orders: number;
  revenue: number;
  cancelled: number;
}

export interface ReportPersonnelOption {
  public_id: string;
  first_name: string;
  last_name: string;
}

export interface ReportAggregates {
  metrics: ReportMetricAggregates;
  statusCounts: Array<{ status: string; count: number }>;
  daily: ReportDailyAggregate[];
  personnel: ReportPersonnelAggregate[];
  personnelOptions: ReportPersonnelOption[];
}

export interface ReportAnalysis {
  filters: {
    start_date: string;
    end_date: string;
    personnel_public_id: string | null;
    cargo_provider: ReportCargoProvider;
  };
  currency: "TRY";
  metrics: ReportMetricAggregates & { aktif: number; subede_toplam: number };
  rates: {
    teslim: number;
    iptal: number;
    iade: number;
    kargo_iade: number;
    teyit: number;
    sube: number;
  };
  status_distribution: Array<{ status: LegacyOrderStatusKey; count: number }>;
  daily_source: "daily_series" | "filtered_rows";
  daily: ReportDailyAggregate[];
  cargo_providers: Array<{ provider: "ptt" | "surat"; active: number; returns: number }>;
  personnel_performance: Array<{ user_public_id: string; name: string; orders: number; revenue: number; cancelled: number }>;
  personnel_options: ReportPersonnelOption[];
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function isReportDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Calendar date (YYYY-MM-DD) in the report time zone. */
export function reportToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: reportTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function differenceInCalendarDays(later: string, earlier: string): number {
  return Math.round(
    (new Date(`${later}T00:00:00.000Z`).getTime() - new Date(`${earlier}T00:00:00.000Z`).getTime()) / 86_400_000,
  );
}

/** Legacy yuzdeHesapla: one decimal percentage, 0 when the denominator is 0. */
export function yuzdeHesapla(pay: number, payda: number): number {
  if (!payda) return 0;
  return Math.round((pay / payda) * 1000) / 10;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Legacy daily trend: without personnel/cargo filters the `gunluk_istatistikler` RPC returned a
 * zero-filled day series ending at the end date, capped at 90 days; with filters the page grouped
 * the matching rows client-side and only days with orders appear.
 */
export function buildDailySeries(
  filters: Pick<ReportFilters, "startDate" | "endDate" | "personnelPublicId" | "cargoProvider">,
  rows: ReportDailyAggregate[],
): { source: ReportAnalysis["daily_source"]; daily: ReportDailyAggregate[] } {
  const sorted = [...rows].sort((first, second) => first.date.localeCompare(second.date));
  const extraFilter = Boolean(filters.personnelPublicId) || filters.cargoProvider !== "tumu";
  if (extraFilter) {
    return { source: "filtered_rows", daily: sorted.filter((row) => row.orders > 0) };
  }

  const dayCount = Math.min(90, Math.max(1, differenceInCalendarDays(filters.endDate, filters.startDate) + 1));
  const byDate = new Map(sorted.map((row) => [row.date, row]));
  const daily: ReportDailyAggregate[] = [];
  for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
    const date = addDays(filters.endDate, -offset);
    if (date < filters.startDate || date > filters.endDate) continue;
    daily.push(byDate.get(date) ?? { date, orders: 0, revenue: 0, cancelled: 0, returned: 0 });
  }
  return { source: "daily_series", daily };
}

export function buildReportAnalysis(filters: ReportFilters, aggregates: ReportAggregates): ReportAnalysis {
  const metrics = aggregates.metrics;
  const aktif = metrics.toplam - metrics.iptal - metrics.iade;
  const subedeToplam = metrics.ptt_subede + metrics.surat_subede;
  const kargolanan = metrics.sevk_edildi + metrics.teslim_edildi;
  const statusCounts = new Map(aggregates.statusCounts.map((row) => [row.status, row.count]));
  const daily = buildDailySeries(filters, aggregates.daily);

  return {
    filters: {
      start_date: filters.startDate,
      end_date: filters.endDate,
      personnel_public_id: filters.personnelPublicId,
      cargo_provider: filters.cargoProvider,
    },
    currency: "TRY",
    metrics: { ...metrics, ciro: roundMoney(metrics.ciro), aktif, subede_toplam: subedeToplam },
    rates: {
      teslim: yuzdeHesapla(metrics.teslim_edildi, kargolanan),
      iptal: yuzdeHesapla(metrics.iptal, metrics.toplam),
      iade: yuzdeHesapla(metrics.iade, metrics.toplam),
      kargo_iade: yuzdeHesapla(metrics.kargo_iade, metrics.kargoya_giden),
      teyit: yuzdeHesapla(metrics.teyit_edildi, aktif),
      sube: yuzdeHesapla(subedeToplam, metrics.kargoya_giden || metrics.ptt + metrics.surat),
    },
    status_distribution: legacyOrderStatusKeys
      .map((status) => ({ status, count: statusCounts.get(status) ?? 0 }))
      .filter((row) => row.count > 0),
    daily_source: daily.source,
    daily: daily.daily.map((row) => ({ ...row, revenue: roundMoney(row.revenue) })),
    cargo_providers: [
      { provider: "ptt", active: metrics.ptt, returns: metrics.ptt_kargo_iade },
      { provider: "surat", active: metrics.surat, returns: metrics.surat_kargo_iade },
    ],
    personnel_performance: aggregates.personnel
      .filter((row) => row.orders > 0)
      .map((row) => ({
        user_public_id: row.user_public_id,
        name: row.listed
          ? `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim().split(" ").slice(0, 2).join(" ") || "—"
          : "—",
        orders: row.orders,
        revenue: roundMoney(row.revenue),
        cancelled: row.cancelled,
      }))
      .sort((first, second) => second.orders - first.orders),
    personnel_options: aggregates.personnelOptions,
  };
}

function statusInList(key: LegacyOrderStatusKey) {
  return sql.join(legacyOrderStatusSynonyms[key].map((status) => sql.lit(status)));
}

function patternArray(patterns: readonly string[]) {
  return sql`ARRAY[${sql.join(patterns.map((pattern) => sql.lit(pattern)))}]::text[]`;
}

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? 0));
  return Number.isFinite(parsed) ? parsed : 0;
}

export class ReportRepository {
  constructor(private readonly db: AppDatabase) {}

  /** The filtered order CTE shared by every report aggregate (one indexed range scan). */
  private filteredOrders(filters: ReportFilters) {
    const legacyStatus = sql`CASE
      ${sql.join(
        legacyOrderStatusKeys.map((key) => sql`WHEN o.status IN (${statusInList(key)}) THEN ${sql.lit(key)}`),
        sql` `,
      )}
      ELSE o.status END`;
    const startBound = sql`((${filters.startDate}::date)::timestamp AT TIME ZONE ${sql.lit(reportTimeZone)})`;
    const endBound = sql`(((${filters.endDate}::date) + 1)::timestamp AT TIME ZONE ${sql.lit(reportTimeZone)})`;
    const personnel = filters.personnelPublicId
      ? sql`AND o.created_by_user_id = (SELECT u.id FROM users u WHERE u.public_id = ${filters.personnelPublicId})`
      : sql``;
    const cargo = filters.cargoProvider === "tumu" ? sql`` : sql`AND o.cargo_provider = ${filters.cargoProvider}`;

    return sql`filtered AS (
      SELECT
        o.id,
        o.total_amount,
        o.created_at,
        o.created_by_user_id,
        o.cargo_provider,
        o.external_order_id,
        o.confirmation_status,
        ${legacyStatus} AS legacy_status,
        last_event.last_event_text
      FROM orders o
      LEFT JOIN LATERAL (
        SELECT s.last_event_text
        FROM shipments s
        WHERE s.order_id = o.id
        ORDER BY s.created_at DESC
        LIMIT 1
      ) last_event ON true
      WHERE o.created_at >= ${startBound}
        AND o.created_at < ${endBound}
        ${personnel}
        ${cargo}
    )`;
  }

  async getMetricAggregates(filters: ReportFilters): Promise<ReportMetricAggregates> {
    const active = sql`legacy_status NOT IN ('iptal', 'iade')`;
    const result = await sql<Record<keyof ReportMetricAggregates, unknown>>`
      WITH ${this.filteredOrders(filters)}
      SELECT
        count(*) AS toplam,
        coalesce(sum(total_amount) FILTER (WHERE ${active}), 0) AS ciro,
        count(*) FILTER (WHERE legacy_status = 'iptal') AS iptal,
        count(*) FILTER (WHERE legacy_status = 'iade') AS iade,
        count(*) FILTER (WHERE legacy_status = 'sevk_edildi') AS sevk_edildi,
        count(*) FILTER (WHERE legacy_status = 'teslim_edildi') AS teslim_edildi,
        count(*) FILTER (WHERE legacy_status IN ('sevk_edildi', 'teslim_edildi', 'kargoya_verildi')) AS kargoya_giden,
        count(*) FILTER (WHERE ${active} AND cargo_provider = 'ptt') AS ptt,
        count(*) FILTER (WHERE ${active} AND cargo_provider = 'surat') AS surat,
        count(*) FILTER (
          WHERE ${active} AND external_order_id IS NOT NULL
            AND last_event_text ILIKE ANY (${patternArray(pttBranchPatterns)})
        ) AS ptt_subede,
        count(*) FILTER (
          WHERE ${active} AND external_order_id IS NOT NULL
            AND last_event_text ILIKE ANY (${patternArray(suratBranchPatterns)})
        ) AS surat_subede,
        count(*) FILTER (WHERE confirmation_status IN ('confirmed', 'teyit_edildi')) AS teyit_edildi,
        count(*) FILTER (WHERE legacy_status = 'teyit_bekliyor') AS teyit_bekliyor,
        count(*) FILTER (WHERE legacy_status = 'iade' AND external_order_id IS NOT NULL) AS kargo_iade,
        count(*) FILTER (
          WHERE legacy_status = 'iade' AND external_order_id IS NOT NULL AND cargo_provider = 'ptt'
        ) AS ptt_kargo_iade,
        count(*) FILTER (
          WHERE legacy_status = 'iade' AND external_order_id IS NOT NULL AND cargo_provider = 'surat'
        ) AS surat_kargo_iade,
        count(*) FILTER (
          WHERE legacy_status <> 'iptal' AND external_order_id IS NOT NULL
            AND last_event_text ILIKE ANY (${patternArray(cargoTrackingReturnPatterns)})
        ) AS kargo_takip_iade
      FROM filtered
    `.execute(this.db);
    const row = result.rows[0] ?? ({} as Record<keyof ReportMetricAggregates, unknown>);
    return Object.fromEntries(
      (Object.keys(emptyReportMetricAggregates()) as Array<keyof ReportMetricAggregates>).map((key) => [key, toNumber(row[key])]),
    ) as unknown as ReportMetricAggregates;
  }

  async getStatusCounts(filters: ReportFilters): Promise<Array<{ status: string; count: number }>> {
    const result = await sql<{ status: string; count: unknown }>`
      WITH ${this.filteredOrders(filters)}
      SELECT legacy_status AS status, count(*) AS count
      FROM filtered
      GROUP BY legacy_status
    `.execute(this.db);
    return result.rows.map((row) => ({ status: row.status, count: toNumber(row.count) }));
  }

  async getDailyAggregates(filters: ReportFilters): Promise<ReportDailyAggregate[]> {
    const result = await sql<{ date: string; orders: unknown; revenue: unknown; cancelled: unknown; returned: unknown }>`
      WITH ${this.filteredOrders(filters)}
      SELECT
        to_char((created_at AT TIME ZONE ${sql.lit(reportTimeZone)})::date, 'YYYY-MM-DD') AS date,
        count(*) AS orders,
        coalesce(sum(total_amount) FILTER (WHERE legacy_status NOT IN ('iptal', 'iade')), 0) AS revenue,
        count(*) FILTER (WHERE legacy_status = 'iptal') AS cancelled,
        count(*) FILTER (WHERE legacy_status = 'iade') AS returned
      FROM filtered
      GROUP BY 1
      ORDER BY 1
    `.execute(this.db);
    return result.rows.map((row) => ({
      date: row.date,
      orders: toNumber(row.orders),
      revenue: toNumber(row.revenue),
      cancelled: toNumber(row.cancelled),
      returned: toNumber(row.returned),
    }));
  }

  async getPersonnelAggregates(filters: ReportFilters): Promise<ReportPersonnelAggregate[]> {
    const result = await sql<{
      user_public_id: string;
      first_name: string | null;
      last_name: string | null;
      listed: boolean;
      orders: unknown;
      revenue: unknown;
      cancelled: unknown;
    }>`
      WITH ${this.filteredOrders(filters)}
      SELECT
        u.public_id AS user_public_id,
        u.first_name,
        u.last_name,
        (u.is_active AND r.name IN ('admin', 'calisan')) AS listed,
        count(*) AS orders,
        coalesce(sum(f.total_amount) FILTER (WHERE f.legacy_status NOT IN ('iptal', 'iade')), 0) AS revenue,
        count(*) FILTER (WHERE f.legacy_status = 'iptal') AS cancelled
      FROM filtered f
      JOIN users u ON u.id = f.created_by_user_id
      LEFT JOIN roles r ON r.id = u.role_id
      GROUP BY u.public_id, u.first_name, u.last_name, u.is_active, r.name
    `.execute(this.db);
    return result.rows.map((row) => ({
      user_public_id: row.user_public_id,
      first_name: row.first_name,
      last_name: row.last_name,
      listed: Boolean(row.listed),
      orders: toNumber(row.orders),
      revenue: toNumber(row.revenue),
      cancelled: toNumber(row.cancelled),
    }));
  }

  /** Legacy personel dropdown: active users with the calisan/admin role, ordered by first name. */
  async listPersonnelOptions(): Promise<ReportPersonnelOption[]> {
    return this.db
      .selectFrom("users")
      .innerJoin("roles", "roles.id", "users.role_id")
      .select(["users.public_id", "users.first_name", "users.last_name"])
      .where("users.is_active", "=", true)
      .where("roles.name", "in", ["calisan", "admin"])
      .orderBy("users.first_name", "asc")
      .execute();
  }

  async getAggregates(filters: ReportFilters): Promise<ReportAggregates> {
    const [metrics, statusCounts, daily, personnel, personnelOptions] = await Promise.all([
      this.getMetricAggregates(filters),
      this.getStatusCounts(filters),
      this.getDailyAggregates(filters),
      this.getPersonnelAggregates(filters),
      this.listPersonnelOptions(),
    ]);
    return { metrics, statusCounts, daily, personnel, personnelOptions };
  }
}

export function emptyReportMetricAggregates(): ReportMetricAggregates {
  return {
    toplam: 0,
    ciro: 0,
    iptal: 0,
    iade: 0,
    sevk_edildi: 0,
    teslim_edildi: 0,
    kargoya_giden: 0,
    ptt: 0,
    surat: 0,
    ptt_subede: 0,
    surat_subede: 0,
    teyit_edildi: 0,
    teyit_bekliyor: 0,
    kargo_iade: 0,
    ptt_kargo_iade: 0,
    surat_kargo_iade: 0,
    kargo_takip_iade: 0,
  };
}
