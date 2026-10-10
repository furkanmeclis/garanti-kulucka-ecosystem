import { sql, type AppDatabase } from "@garanti-kulucka/database";
import type {
  AnalyticsBucket,
  AnalyticsCargoProviderRow,
  AnalyticsChannel,
  AnalyticsChannelRow,
  AnalyticsCityRow,
  AnalyticsCohortRow,
  AnalyticsConversionRow,
  AnalyticsFilters,
  AnalyticsFunnelStep,
  AnalyticsGranularity,
  AnalyticsHeatCell,
  AnalyticsKpi,
  AnalyticsKpiKey,
  AnalyticsLegacyMetrics,
  AnalyticsLegacyRates,
  AnalyticsOrderStatus,
  AnalyticsPersonnelRow,
  AnalyticsProductRow,
  AnalyticsRange,
  AnalyticsRecentOrder,
  AnalyticsRecentShipment,
  AnalyticsUnreadConversation,
  BreakdownAnalytics,
  DashboardAnalytics,
  InvoiceAnalytics,
  InvoiceAnalyticsTotals,
} from "@garanti-kulucka/shared";
import {
  addDays,
  cargoTrackingReturnPatterns,
  differenceInCalendarDays,
  isReportDate,
  legacyOrderStatusKeys,
  patternArray,
  pttBranchPatterns,
  reportTimeZone,
  reportToday,
  statusInList,
  suratBranchPatterns,
  yuzdeHesapla,
} from "./repository.js";

/**
 * Read-only aggregates behind the beta Pano and İş Analizi pages. Every query is parametrised SQL over
 * orders / order_items / shipments / conversations / messages / customers / invoices; day boundaries are
 * Europe/Istanbul; soft-deleted orders are always excluded and cancelled/returned orders never count as revenue.
 */

export const analyticsGranularities = ["day", "week", "month"] as const;
export const analyticsChannels = ["whatsapp", "instagram", "messenger", "phone", "manual"] as const;
export const analyticsCargoProviders = ["tumu", "ptt", "surat"] as const;
export const analyticsMaxDays = 731;

export interface AnalyticsQuery {
  range: AnalyticsRange;
  filters: AnalyticsFilters;
  compare: boolean;
}

export type AnalyticsParseResult = { ok: true; query: AnalyticsQuery } | { ok: false; message: string };

/** Day/week/month default for a span: daily up to two months, weekly up to ~6.5 months, then monthly. */
export function defaultGranularity(days: number): AnalyticsGranularity {
  if (days <= 62) return "day";
  if (days <= 200) return "week";
  return "month";
}

export function buildRange(from: string, to: string, granularity: AnalyticsGranularity): AnalyticsRange {
  const days = differenceInCalendarDays(to, from) + 1;
  return { from, to, previous_from: addDays(from, -days), previous_to: addDays(from, -1), granularity, days };
}

const optionalText = (value: string | undefined, max = 120) => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? undefined : trimmed;
};

/** Validates the shared query string: from/to (default last 30 days), granularity, compare and the dimension filters. */
export function parseAnalyticsQuery(query: (name: string) => string | undefined, now: Date = new Date()): AnalyticsParseResult {
  const today = reportToday(now);
  const to = query("to") || query("end_date") || today;
  const from = query("from") || query("start_date") || addDays(to, -29);
  if (!isReportDate(from) || !isReportDate(to) || from > to) return { ok: false, message: "Invalid analytics date range" };
  const days = differenceInCalendarDays(to, from) + 1;
  if (days > analyticsMaxDays) return { ok: false, message: "Analytics date range is too long" };

  const granularityValue = query("granularity") || defaultGranularity(days);
  if (!(analyticsGranularities as readonly string[]).includes(granularityValue)) return { ok: false, message: "Invalid analytics granularity" };

  const cargo = query("cargo_provider") || "tumu";
  if (!(analyticsCargoProviders as readonly string[]).includes(cargo)) return { ok: false, message: "Invalid analytics cargo provider filter" };

  const channel = query("channel") || null;
  if (channel !== null && !(analyticsChannels as readonly string[]).includes(channel)) return { ok: false, message: "Invalid analytics channel filter" };

  const status = query("status") || null;
  if (status !== null && !(legacyOrderStatusKeys as readonly string[]).includes(status)) return { ok: false, message: "Invalid analytics status filter" };

  const personnel = optionalText(query("personnel_public_id"), 64);
  const product = optionalText(query("product_public_id") ?? query("product"), 64);
  const category = optionalText(query("category"));
  const city = optionalText(query("city"));
  if (personnel === undefined || product === undefined || category === undefined || city === undefined) {
    return { ok: false, message: "Invalid analytics filter" };
  }

  const compareValue = query("compare");
  return {
    ok: true,
    query: {
      range: buildRange(from, to, granularityValue as AnalyticsGranularity),
      compare: compareValue === undefined ? true : !["0", "false", "no"].includes(compareValue),
      filters: {
        cargo_provider: cargo as AnalyticsFilters["cargo_provider"],
        personnel_public_id: personnel,
        channel: channel as AnalyticsChannel | null,
        status: status as AnalyticsOrderStatus | null,
        product_public_id: product,
        category,
        city,
      },
    },
  };
}

export const emptyAnalyticsFilters = (): AnalyticsFilters => ({
  cargo_provider: "tumu",
  personnel_public_id: null,
  channel: null,
  status: null,
  product_public_id: null,
  category: null,
  city: null,
});

/** First day of the bucket that contains `date` (ISO weeks start on Monday). */
export function bucketStart(date: string, granularity: AnalyticsGranularity): string {
  if (granularity === "day") return date;
  if (granularity === "month") return `${date.slice(0, 7)}-01`;
  const weekday = (new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7;
  return addDays(date, -weekday);
}

function nextBucket(bucket: string, granularity: AnalyticsGranularity): string {
  if (granularity === "day") return addDays(bucket, 1);
  if (granularity === "week") return addDays(bucket, 7);
  const [year, month] = bucket.split("-").map(Number) as [number, number];
  const next = new Date(Date.UTC(year, month, 1));
  return next.toISOString().slice(0, 10);
}

/** Every bucket start covering [from, to], oldest first. */
export function bucketKeys(from: string, to: string, granularity: AnalyticsGranularity): string[] {
  const keys: string[] = [];
  for (let bucket = bucketStart(from, granularity); bucket <= to; bucket = nextBucket(bucket, granularity)) {
    keys.push(bucket);
    if (keys.length > 800) break;
  }
  return keys;
}

export const emptyBucket = (bucket: string): AnalyticsBucket => ({
  bucket,
  orders: 0,
  revenue: 0,
  active_orders: 0,
  cancelled: 0,
  returned: 0,
  delivered: 0,
  in_cargo: 0,
  confirmed: 0,
  new_customers: 0,
  conversations: 0,
  messages_in: 0,
});

/** Zero-fills raw bucket rows onto the full bucket list of the range. */
export function fillBuckets(range: { from: string; to: string; granularity: AnalyticsGranularity }, rows: Array<Partial<AnalyticsBucket> & { bucket: string }>): AnalyticsBucket[] {
  const byBucket = new Map<string, AnalyticsBucket>();
  for (const row of rows) {
    const current = byBucket.get(row.bucket) ?? emptyBucket(row.bucket);
    for (const [key, value] of Object.entries(row)) {
      if (key === "bucket" || typeof value !== "number") continue;
      (current as unknown as Record<string, number>)[key] = ((current as unknown as Record<string, number>)[key] ?? 0) + value;
    }
    byBucket.set(row.bucket, current);
  }
  return bucketKeys(range.from, range.to, range.granularity).map((bucket) => {
    const row = byBucket.get(bucket) ?? emptyBucket(bucket);
    return { ...row, revenue: roundMoney(row.revenue) };
  });
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Relative change in percent with one decimal; null when there is no baseline. */
export function changePct(value: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return Math.round(((value - previous) / Math.abs(previous)) * 1000) / 10;
}

interface KpiTotals {
  revenue: number;
  orders: number;
  active_orders: number;
  cancelled: number;
  returned: number;
  delivered: number;
  in_cargo: number;
  confirmed: number;
  new_customers: number;
  conversations: number;
  messages_in: number;
}

function totals(buckets: AnalyticsBucket[]): KpiTotals {
  return buckets.reduce<KpiTotals>(
    (sum, bucket) => ({
      revenue: sum.revenue + bucket.revenue,
      orders: sum.orders + bucket.orders,
      active_orders: sum.active_orders + bucket.active_orders,
      cancelled: sum.cancelled + bucket.cancelled,
      returned: sum.returned + bucket.returned,
      delivered: sum.delivered + bucket.delivered,
      in_cargo: sum.in_cargo + bucket.in_cargo,
      confirmed: sum.confirmed + bucket.confirmed,
      new_customers: sum.new_customers + bucket.new_customers,
      conversations: sum.conversations + bucket.conversations,
      messages_in: sum.messages_in + bucket.messages_in,
    }),
    { revenue: 0, orders: 0, active_orders: 0, cancelled: 0, returned: 0, delivered: 0, in_cargo: 0, confirmed: 0, new_customers: 0, conversations: 0, messages_in: 0 },
  );
}

const kpiUnits: Record<AnalyticsKpiKey, AnalyticsKpi["unit"]> = {
  revenue: "money",
  orders: "count",
  avg_basket: "money",
  confirmation_rate: "percent",
  in_cargo: "count",
  delivered: "count",
  cancel_rate: "percent",
  return_rate: "percent",
  new_customers: "count",
  conversations: "count",
  messages_in: "count",
  unread_messages: "count",
};

function kpiValue(key: Exclude<AnalyticsKpiKey, "unread_messages">, total: KpiTotals | AnalyticsBucket): number {
  switch (key) {
    case "revenue":
      return roundMoney(total.revenue);
    case "orders":
      return total.orders;
    case "avg_basket":
      return total.active_orders ? roundMoney(total.revenue / total.active_orders) : 0;
    case "confirmation_rate":
      return yuzdeHesapla(total.confirmed, total.active_orders);
    case "in_cargo":
      return total.in_cargo;
    case "delivered":
      return total.delivered;
    case "cancel_rate":
      return yuzdeHesapla(total.cancelled, total.orders);
    case "return_rate":
      return yuzdeHesapla(total.returned, total.orders);
    case "new_customers":
      return total.new_customers;
    case "conversations":
      return total.conversations;
    case "messages_in":
      return total.messages_in;
  }
}

/**
 * KPI tiles with deltas vs the previous period. Rates use the legacy formulas: teyit = confirmed / active,
 * iptal = cancelled / all, iade = returned / all; average basket = revenue / active orders.
 */
export function buildKpis(
  current: AnalyticsBucket[],
  previous: AnalyticsBucket[] | null,
  keys: ReadonlyArray<Exclude<AnalyticsKpiKey, "unread_messages">>,
  extras: { unread_messages?: number | null } = {},
): AnalyticsKpi[] {
  const now = totals(current);
  const before = previous ? totals(previous) : null;
  const kpis: AnalyticsKpi[] = keys.map((key) => {
    const value = kpiValue(key, now);
    const previousValue = before ? kpiValue(key, before) : null;
    return { key, value, previous: previousValue, change_pct: changePct(value, previousValue), series: current.map((bucket) => kpiValue(key, bucket)), unit: kpiUnits[key] };
  });
  if (extras.unread_messages !== undefined && extras.unread_messages !== null) {
    kpis.push({ key: "unread_messages", value: extras.unread_messages, previous: null, change_pct: null, series: [], unit: "count" });
  }
  return kpis;
}

export const dashboardKpiKeys = ["revenue", "orders", "avg_basket", "confirmation_rate", "in_cargo", "delivered", "cancel_rate", "return_rate", "new_customers"] as const;
export const reportKpiKeys = [...dashboardKpiKeys, "conversations", "messages_in"] as const;

function toNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? 0));
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return value === null || value === undefined ? "" : new Date(String(value)).toISOString();
}

function personName(first: string | null, last: string | null) {
  return `${first ?? ""} ${last ?? ""}`.trim() || "—";
}

const tz = sql.lit(reportTimeZone);
const startBound = (date: string) => sql`((${date}::date)::timestamp AT TIME ZONE ${tz})`;
const endBound = (date: string) => sql`(((${date}::date) + 1)::timestamp AT TIME ZONE ${tz})`;

const legacyStatusExpression = sql`CASE
  ${sql.join(
    legacyOrderStatusKeys.map((key) => sql`WHEN o.status IN (${statusInList(key)}) THEN ${sql.lit(key)}`),
    sql` `,
  )}
  ELSE o.status END`;

/** Conversation channel (facebook → messenger) or, without a conversation, the order source; `manual` otherwise. */
const channelExpression = sql`CASE
  WHEN c.channel IN ('facebook', 'messenger') THEN 'messenger'
  WHEN c.channel IN ('whatsapp', 'instagram', 'phone', 'manual') THEN c.channel
  WHEN o.source ILIKE '%whatsapp%' THEN 'whatsapp'
  WHEN o.source ILIKE '%instagram%' THEN 'instagram'
  WHEN o.source ILIKE '%messenger%' OR o.source ILIKE '%facebook%' THEN 'messenger'
  ELSE 'manual' END`;

const conversationChannelExpression = sql`CASE WHEN c.channel = 'facebook' THEN 'messenger' ELSE c.channel END`;
const active = sql`st NOT IN ('iptal', 'iade')`;
const inCargo = sql`st IN ('kargoya_verildi', 'sevk_edildi')`;
const confirmedExpr = sql`confirmation_status IN ('confirmed', 'teyit_edildi')`;
const branchExpr = sql`(${active} AND last_event_text IS NOT NULL AND (
  (provider_key = 'ptt' AND last_event_text ILIKE ANY (${patternArray(pttBranchPatterns)}))
  OR (provider_key = 'surat' AND last_event_text ILIKE ANY (${patternArray(suratBranchPatterns)}))))`;
const trackingReturnExpr = sql`(st <> 'iptal' AND last_event_text ILIKE ANY (${patternArray(cargoTrackingReturnPatterns)}))`;

/** The filtered order set every analytics aggregate starts from (one range scan on orders_created_at_idx). */
function baseOrders(range: { from: string; to: string }, filters: AnalyticsFilters) {
  const conditions = [sql`o.deleted_at IS NULL`, sql`o.created_at >= ${startBound(range.from)}`, sql`o.created_at < ${endBound(range.to)}`];
  if (filters.cargo_provider !== "tumu") conditions.push(sql`coalesce(o.cargo_provider, sh.provider) = ${filters.cargo_provider}`);
  if (filters.personnel_public_id) conditions.push(sql`o.created_by_user_id = (SELECT u.id FROM users u WHERE u.public_id = ${filters.personnel_public_id})`);
  if (filters.channel) conditions.push(sql`(${channelExpression}) = ${filters.channel}`);
  if (filters.status) conditions.push(sql`(${legacyStatusExpression}) = ${filters.status}`);
  if (filters.city) conditions.push(sql`nullif(btrim(coalesce(sh.recipient_city, addr.city)), '') = ${filters.city}`);
  if (filters.product_public_id) {
    conditions.push(sql`EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id AND p.public_id = ${filters.product_public_id})`);
  }
  if (filters.category) {
    conditions.push(sql`EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = o.id AND p.category = ${filters.category})`);
  }

  return sql`base AS (
    SELECT
      o.id,
      o.public_id,
      o.order_number,
      o.customer_id,
      o.conversation_id,
      o.created_by_user_id,
      o.total_amount::numeric AS amount,
      o.created_at,
      (o.created_at AT TIME ZONE ${tz}) AS local_at,
      CASE WHEN coalesce(o.cargo_provider, sh.provider) IN ('ptt', 'surat') THEN coalesce(o.cargo_provider, sh.provider) WHEN coalesce(o.cargo_provider, sh.provider) IS NULL THEN NULL ELSE 'other' END AS provider_key,
      o.external_order_id,
      o.confirmation_status,
      o.confirmation_call_status,
      o.confirmation_call_count,
      o.confirmation_listen_seconds,
      o.notes,
      ${legacyStatusExpression} AS st,
      ${channelExpression} AS channel,
      sh.last_event_text,
      nullif(btrim(coalesce(sh.recipient_city, addr.city)), '') AS city
    FROM orders o
    LEFT JOIN conversations c ON c.id = o.conversation_id
    LEFT JOIN LATERAL (
      SELECT s.provider, s.last_event_text, s.recipient_city
      FROM shipments s
      WHERE s.order_id = o.id
      ORDER BY s.created_at DESC
      LIMIT 1
    ) sh ON true
    LEFT JOIN LATERAL (
      SELECT ca.city
      FROM customer_addresses ca
      WHERE ca.customer_id = o.customer_id
      ORDER BY ca.is_default DESC, ca.id
      LIMIT 1
    ) addr ON true
    WHERE ${sql.join(conditions, sql` AND `)}
  )`;
}

function bucketExpression(column: ReturnType<typeof sql>, granularity: AnalyticsGranularity) {
  return sql`to_char(date_trunc(${sql.lit(granularity)}, ${column})::date, 'YYYY-MM-DD')`;
}

function channelCondition(filters: AnalyticsFilters) {
  return filters.channel ? sql`AND (${conversationChannelExpression}) = ${filters.channel}` : sql``;
}

export class AnalyticsRepository {
  constructor(private readonly db: AppDatabase) {}

  /** Order, customer, conversation and inbound-message buckets for one range. */
  async getTimeseries(range: { from: string; to: string; granularity: AnalyticsGranularity }, filters: AnalyticsFilters): Promise<AnalyticsBucket[]> {
    const orderRows = await sql<Record<string, unknown>>`
      WITH ${baseOrders(range, filters)}
      SELECT
        ${bucketExpression(sql`local_at`, range.granularity)} AS bucket,
        count(*) AS orders,
        coalesce(sum(amount) FILTER (WHERE ${active}), 0) AS revenue,
        count(*) FILTER (WHERE ${active}) AS active_orders,
        count(*) FILTER (WHERE st = 'iptal') AS cancelled,
        count(*) FILTER (WHERE st = 'iade') AS returned,
        count(*) FILTER (WHERE st = 'teslim_edildi') AS delivered,
        count(*) FILTER (WHERE ${inCargo}) AS in_cargo,
        count(*) FILTER (WHERE ${confirmedExpr} AND ${active}) AS confirmed
      FROM base
      GROUP BY 1
    `.execute(this.db);

    const otherRows = await sql<{ bucket: string; kind: string; count: unknown }>`
      SELECT ${bucketExpression(sql`(cu.created_at AT TIME ZONE ${tz})`, range.granularity)} AS bucket, 'new_customers' AS kind, count(*) AS count
      FROM customers cu
      WHERE cu.created_at >= ${startBound(range.from)} AND cu.created_at < ${endBound(range.to)}
      GROUP BY 1
      UNION ALL
      SELECT ${bucketExpression(sql`(c.created_at AT TIME ZONE ${tz})`, range.granularity)}, 'conversations', count(*)
      FROM conversations c
      WHERE c.created_at >= ${startBound(range.from)} AND c.created_at < ${endBound(range.to)} ${channelCondition(filters)}
      GROUP BY 1
      UNION ALL
      SELECT ${bucketExpression(sql`(m.sent_at AT TIME ZONE ${tz})`, range.granularity)}, 'messages_in', count(*)
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.sender_type = 'customer' AND m.sent_at >= ${startBound(range.from)} AND m.sent_at < ${endBound(range.to)} ${channelCondition(filters)}
      GROUP BY 1
    `.execute(this.db);

    const rows: Array<Partial<AnalyticsBucket> & { bucket: string }> = orderRows.rows.map((row) => ({
      bucket: String(row.bucket),
      orders: toNumber(row.orders),
      revenue: toNumber(row.revenue),
      active_orders: toNumber(row.active_orders),
      cancelled: toNumber(row.cancelled),
      returned: toNumber(row.returned),
      delivered: toNumber(row.delivered),
      in_cargo: toNumber(row.in_cargo),
      confirmed: toNumber(row.confirmed),
    }));
    for (const row of otherRows.rows) {
      rows.push({ bucket: row.bucket, [row.kind]: toNumber(row.count) });
    }
    return fillBuckets(range, rows);
  }

  /** Legacy RaporlarPage metric probes (same FILTER definitions as ReportRepository) over the filtered base. */
  async getLegacyMetrics(range: AnalyticsRange, filters: AnalyticsFilters): Promise<{ metrics: AnalyticsLegacyMetrics; rates: AnalyticsLegacyRates }> {
    const result = await sql<Record<string, unknown>>`
      WITH ${baseOrders(range, filters)}
      SELECT
        count(*) AS toplam,
        coalesce(sum(amount) FILTER (WHERE ${active}), 0) AS ciro,
        count(*) FILTER (WHERE st = 'iptal') AS iptal,
        count(*) FILTER (WHERE st = 'iade') AS iade,
        count(*) FILTER (WHERE st = 'sevk_edildi') AS sevk_edildi,
        count(*) FILTER (WHERE st = 'teslim_edildi') AS teslim_edildi,
        count(*) FILTER (WHERE st IN ('sevk_edildi', 'teslim_edildi', 'kargoya_verildi')) AS kargoya_giden,
        count(*) FILTER (WHERE ${active} AND provider_key = 'ptt') AS ptt,
        count(*) FILTER (WHERE ${active} AND provider_key = 'surat') AS surat,
        count(*) FILTER (WHERE ${active} AND external_order_id IS NOT NULL AND last_event_text ILIKE ANY (${patternArray(pttBranchPatterns)})) AS ptt_subede,
        count(*) FILTER (WHERE ${active} AND external_order_id IS NOT NULL AND last_event_text ILIKE ANY (${patternArray(suratBranchPatterns)})) AS surat_subede,
        count(*) FILTER (WHERE ${confirmedExpr}) AS teyit_edildi,
        count(*) FILTER (WHERE st = 'teyit_bekliyor') AS teyit_bekliyor,
        count(*) FILTER (WHERE st = 'iade' AND external_order_id IS NOT NULL) AS kargo_iade,
        count(*) FILTER (WHERE st = 'iade' AND external_order_id IS NOT NULL AND provider_key = 'ptt') AS ptt_kargo_iade,
        count(*) FILTER (WHERE st = 'iade' AND external_order_id IS NOT NULL AND provider_key = 'surat') AS surat_kargo_iade,
        count(*) FILTER (WHERE external_order_id IS NOT NULL AND ${trackingReturnExpr}) AS kargo_takip_iade
      FROM base
    `.execute(this.db);
    return buildLegacyMetrics(result.rows[0] ?? {});
  }

  async getStatusDistribution(range: AnalyticsRange, filters: AnalyticsFilters) {
    const result = await sql<{ st: string; count: unknown }>`
      WITH ${baseOrders(range, filters)}
      SELECT st, count(*) AS count FROM base GROUP BY st
    `.execute(this.db);
    const counts = new Map(result.rows.map((row) => [row.st, toNumber(row.count)]));
    return legacyOrderStatusKeys.map((status) => ({ status, count: counts.get(status) ?? 0 })).filter((row) => row.count > 0);
  }

  async getChannels(range: AnalyticsRange, filters: AnalyticsFilters): Promise<AnalyticsChannelRow[]> {
    const result = await sql<{ channel: AnalyticsChannel; orders: unknown; revenue: unknown; cancelled: unknown }>`
      WITH ${baseOrders(range, filters)}
      SELECT channel, count(*) AS orders, coalesce(sum(amount) FILTER (WHERE ${active}), 0) AS revenue, count(*) FILTER (WHERE st = 'iptal') AS cancelled
      FROM base GROUP BY channel ORDER BY 2 DESC
    `.execute(this.db);
    return result.rows.map((row) => ({ channel: row.channel, orders: toNumber(row.orders), revenue: roundMoney(toNumber(row.revenue)), cancelled: toNumber(row.cancelled) }));
  }

  async getCargoProviders(range: AnalyticsRange, filters: AnalyticsFilters): Promise<AnalyticsCargoProviderRow[]> {
    const result = await sql<Record<string, unknown>>`
      WITH ${baseOrders(range, filters)}
      SELECT
        provider_key AS provider,
        count(*) AS orders,
        coalesce(sum(amount) FILTER (WHERE ${active}), 0) AS revenue,
        count(*) FILTER (WHERE ${inCargo}) AS in_cargo,
        count(*) FILTER (WHERE st = 'teslim_edildi') AS delivered,
        count(*) FILTER (WHERE st = 'iade') AS returned,
        count(*) FILTER (WHERE ${branchExpr}) AS at_branch,
        count(*) FILTER (WHERE ${trackingReturnExpr}) AS tracking_returns
      FROM base
      WHERE provider_key IS NOT NULL
      GROUP BY provider_key
      ORDER BY 2 DESC
    `.execute(this.db);
    return result.rows.map((row) => ({
      provider: row.provider as AnalyticsCargoProviderRow["provider"],
      orders: toNumber(row.orders),
      revenue: roundMoney(toNumber(row.revenue)),
      in_cargo: toNumber(row.in_cargo),
      delivered: toNumber(row.delivered),
      returned: toNumber(row.returned),
      at_branch: toNumber(row.at_branch),
      tracking_returns: toNumber(row.tracking_returns),
    }));
  }

  /** Orders that reached each stage (returned orders were shipped; cancelled ones stop where they were). */
  async getFunnel(range: AnalyticsRange, filters: AnalyticsFilters): Promise<AnalyticsFunnelStep[]> {
    const result = await sql<Record<string, unknown>>`
      WITH ${baseOrders(range, filters)}
      SELECT
        count(*) AS created,
        count(*) FILTER (WHERE st IN ('teyit_edildi', 'hazirlaniyor', 'kargoya_verildi', 'sevk_edildi', 'teslim_edildi', 'iade') OR (${confirmedExpr})) AS confirmed,
        count(*) FILTER (WHERE st IN ('kargoya_verildi', 'sevk_edildi', 'teslim_edildi', 'iade')) AS shipped,
        count(*) FILTER (WHERE st = 'teslim_edildi') AS delivered
      FROM base
    `.execute(this.db);
    const row = result.rows[0] ?? {};
    return (["created", "confirmed", "shipped", "delivered"] as const).map((key) => ({ key, count: toNumber(row[key]) }));
  }

  async getProducts(range: AnalyticsRange, filters: AnalyticsFilters, limit: number): Promise<AnalyticsProductRow[]> {
    const result = await sql<Record<string, unknown>>`
      WITH ${baseOrders(range, filters)}
      SELECT
        p.public_id AS product_public_id,
        coalesce(p.name, oi.name) AS name,
        p.category,
        sum(oi.quantity) AS quantity,
        coalesce(sum(oi.total_amount::numeric), 0) AS revenue,
        count(DISTINCT b.id) AS orders
      FROM base b
      JOIN order_items oi ON oi.order_id = b.id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE ${sql`b.st NOT IN ('iptal', 'iade')`}
      GROUP BY p.public_id, coalesce(p.name, oi.name), p.category
      ORDER BY revenue DESC, quantity DESC
      LIMIT ${limit}
    `.execute(this.db);
    return result.rows.map((row) => ({
      product_public_id: (row.product_public_id as string | null) ?? null,
      name: String(row.name ?? ""),
      category: (row.category as string | null) ?? null,
      quantity: toNumber(row.quantity),
      revenue: roundMoney(toNumber(row.revenue)),
      orders: toNumber(row.orders),
    }));
  }

  async getCategories(range: AnalyticsRange, filters: AnalyticsFilters) {
    const result = await sql<Record<string, unknown>>`
      WITH ${baseOrders(range, filters)}
      SELECT coalesce(p.category, '') AS category, sum(oi.quantity) AS quantity, coalesce(sum(oi.total_amount::numeric), 0) AS revenue, count(DISTINCT b.id) AS orders
      FROM base b
      JOIN order_items oi ON oi.order_id = b.id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE b.st NOT IN ('iptal', 'iade')
      GROUP BY 1
      ORDER BY revenue DESC
    `.execute(this.db);
    return result.rows.map((row) => ({ category: String(row.category ?? ""), quantity: toNumber(row.quantity), revenue: roundMoney(toNumber(row.revenue)), orders: toNumber(row.orders) }));
  }

  async getPersonnel(range: AnalyticsRange, filters: AnalyticsFilters, limit = 50): Promise<AnalyticsPersonnelRow[]> {
    const result = await sql<Record<string, unknown>>`
      WITH ${baseOrders(range, filters)}
      SELECT
        u.public_id AS user_public_id, u.first_name, u.last_name,
        count(*) AS orders,
        coalesce(sum(b.amount) FILTER (WHERE b.st NOT IN ('iptal', 'iade')), 0) AS revenue,
        count(*) FILTER (WHERE b.st NOT IN ('iptal', 'iade')) AS active_orders,
        count(*) FILTER (WHERE b.st = 'iptal') AS cancelled,
        count(*) FILTER (WHERE b.st = 'iade') AS returned,
        count(*) FILTER (WHERE b.st = 'teslim_edildi') AS delivered,
        count(*) FILTER (WHERE b.confirmation_status IN ('confirmed', 'teyit_edildi') AND b.st NOT IN ('iptal', 'iade')) AS confirmed
      FROM base b
      JOIN users u ON u.id = b.created_by_user_id
      GROUP BY u.public_id, u.first_name, u.last_name
      ORDER BY orders DESC
      LIMIT ${limit}
    `.execute(this.db);
    return result.rows.map((row) => {
      const revenue = toNumber(row.revenue);
      const activeOrders = toNumber(row.active_orders);
      return {
        user_public_id: String(row.user_public_id),
        name: personName(row.first_name as string | null, row.last_name as string | null),
        orders: toNumber(row.orders),
        revenue: roundMoney(revenue),
        cancelled: toNumber(row.cancelled),
        returned: toNumber(row.returned),
        delivered: toNumber(row.delivered),
        avg_basket: activeOrders ? roundMoney(revenue / activeOrders) : 0,
        confirmation_rate: yuzdeHesapla(toNumber(row.confirmed), activeOrders),
      };
    });
  }

  async getCities(range: AnalyticsRange, filters: AnalyticsFilters, limit = 50): Promise<AnalyticsCityRow[]> {
    const result = await sql<Record<string, unknown>>`
      WITH ${baseOrders(range, filters)}
      SELECT city, count(*) AS orders, coalesce(sum(amount) FILTER (WHERE ${active}), 0) AS revenue,
        count(DISTINCT customer_id) AS customers,
        count(*) FILTER (WHERE st = 'iptal') AS cancelled,
        count(*) FILTER (WHERE st = 'iade') AS returned
      FROM base
      WHERE city IS NOT NULL
      GROUP BY city
      ORDER BY orders DESC, revenue DESC
      LIMIT ${limit}
    `.execute(this.db);
    return result.rows.map((row) => ({
      city: String(row.city),
      orders: toNumber(row.orders),
      revenue: roundMoney(toNumber(row.revenue)),
      customers: toNumber(row.customers),
      cancelled: toNumber(row.cancelled),
      returned: toNumber(row.returned),
    }));
  }

  /** Orders (filtered) and inbound customer messages (channel filter only) per Istanbul weekday × hour. */
  async getHeatmap(range: AnalyticsRange, filters: AnalyticsFilters): Promise<AnalyticsHeatCell[]> {
    const result = await sql<{ weekday: unknown; hour: unknown; kind: string; count: unknown }>`
      WITH ${baseOrders(range, filters)}
      SELECT (extract(isodow FROM local_at)::int - 1) AS weekday, extract(hour FROM local_at)::int AS hour, 'orders' AS kind, count(*) AS count
      FROM base GROUP BY 1, 2
      UNION ALL
      SELECT (extract(isodow FROM (m.sent_at AT TIME ZONE ${tz}))::int - 1), extract(hour FROM (m.sent_at AT TIME ZONE ${tz}))::int, 'messages', count(*)
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.sender_type = 'customer' AND m.sent_at >= ${startBound(range.from)} AND m.sent_at < ${endBound(range.to)} ${channelCondition(filters)}
      GROUP BY 1, 2
    `.execute(this.db);
    return buildHeatmap(result.rows.map((row) => ({ weekday: toNumber(row.weekday), hour: toNumber(row.hour), kind: row.kind as "orders" | "messages", count: toNumber(row.count) })));
  }

  /** Conversations opened in the range and how many of them produced at least one (non-deleted) order. */
  async getConversion(range: AnalyticsRange, filters: AnalyticsFilters): Promise<BreakdownAnalytics["conversion"]> {
    const result = await sql<{ channel: AnalyticsChannel; conversations: unknown; converted: unknown; orders: unknown }>`
      SELECT
        ${conversationChannelExpression} AS channel,
        count(*) AS conversations,
        count(*) FILTER (WHERE ord.order_count > 0) AS converted,
        coalesce(sum(ord.order_count), 0) AS orders
      FROM conversations c
      LEFT JOIN LATERAL (
        SELECT count(*) AS order_count FROM orders o WHERE o.conversation_id = c.id AND o.deleted_at IS NULL
      ) ord ON true
      WHERE c.created_at >= ${startBound(range.from)} AND c.created_at < ${endBound(range.to)} ${channelCondition(filters)}
      GROUP BY 1
      ORDER BY 2 DESC
    `.execute(this.db);
    const byChannel: AnalyticsConversionRow[] = result.rows.map((row) => {
      const conversations = toNumber(row.conversations);
      const converted = toNumber(row.converted);
      return { channel: row.channel, conversations, converted, orders: toNumber(row.orders), rate: yuzdeHesapla(converted, conversations) };
    });
    const conversations = byChannel.reduce((sum, row) => sum + row.conversations, 0);
    const converted = byChannel.reduce((sum, row) => sum + row.converted, 0);
    return { conversations, converted, orders: byChannel.reduce((sum, row) => sum + row.orders, 0), rate: yuzdeHesapla(converted, conversations), by_channel: byChannel };
  }

  /**
   * New vs returning customers among the range's (filtered) orders, lifetime order-count distribution and
   * monthly first-order cohorts (non-cancelled orders) for up to the last six months of the range.
   */
  async getCustomers(range: AnalyticsRange, filters: AnalyticsFilters): Promise<BreakdownAnalytics["customers"]> {
    const summary = await sql<Record<string, unknown>>`
      WITH ${baseOrders(range, filters)},
      ranged AS (SELECT customer_id, count(*) AS orders FROM base WHERE customer_id IS NOT NULL GROUP BY customer_id),
      lifetime AS (
        SELECT o.customer_id, count(*) AS orders, min(o.created_at) AS first_at
        FROM orders o
        WHERE o.deleted_at IS NULL AND o.customer_id IN (SELECT customer_id FROM ranged) AND o.created_at < ${endBound(range.to)}
        GROUP BY o.customer_id
      )
      SELECT
        count(*) AS customers_with_orders,
        coalesce(sum(r.orders), 0) AS orders,
        count(*) FILTER (WHERE l.first_at >= ${startBound(range.from)}) AS new_customers,
        count(*) FILTER (WHERE l.orders >= 2) AS repeaters,
        count(*) FILTER (WHERE l.orders = 1) AS b1,
        count(*) FILTER (WHERE l.orders = 2) AS b2,
        count(*) FILTER (WHERE l.orders = 3) AS b3,
        count(*) FILTER (WHERE l.orders >= 4) AS b4
      FROM ranged r
      JOIN lifetime l ON l.customer_id = r.customer_id
    `.execute(this.db);
    const row = summary.rows[0] ?? {};
    const withOrders = toNumber(row.customers_with_orders);
    const newCustomers = toNumber(row.new_customers);

    const cohortStart = (() => {
      const month = bucketStart(range.from, "month");
      const latest = bucketStart(range.to, "month");
      const [year, monthIndex] = latest.split("-").map(Number) as [number, number];
      const sixBack = new Date(Date.UTC(year, monthIndex - 6, 1)).toISOString().slice(0, 10);
      return month > sixBack ? month : sixBack;
    })();
    const cohorts = await sql<{ cohort: string; offset_month: unknown; customers: unknown }>`
      WITH firsts AS (
        SELECT o.customer_id, date_trunc('month', min(o.created_at AT TIME ZONE ${tz})) AS cohort_month
        FROM orders o
        WHERE o.deleted_at IS NULL AND o.customer_id IS NOT NULL AND o.status NOT IN (${statusInList("iptal")})
        GROUP BY o.customer_id
      ),
      activity AS (
        SELECT DISTINCT o.customer_id, date_trunc('month', o.created_at AT TIME ZONE ${tz}) AS active_month
        FROM orders o
        WHERE o.deleted_at IS NULL AND o.customer_id IS NOT NULL AND o.status NOT IN (${statusInList("iptal")})
      )
      SELECT to_char(f.cohort_month, 'YYYY-MM') AS cohort,
        ((extract(year FROM a.active_month) - extract(year FROM f.cohort_month)) * 12 + extract(month FROM a.active_month) - extract(month FROM f.cohort_month))::int AS offset_month,
        count(DISTINCT a.customer_id) AS customers
      FROM firsts f
      JOIN activity a ON a.customer_id = f.customer_id AND a.active_month >= f.cohort_month
      WHERE f.cohort_month >= ${cohortStart}::date AND f.cohort_month <= ${range.to}::date
      GROUP BY 1, 2
      ORDER BY 1, 2
    `.execute(this.db);

    return {
      customers_with_orders: withOrders,
      new_customers: newCustomers,
      returning_customers: Math.max(0, withOrders - newCustomers),
      repeat_rate: yuzdeHesapla(toNumber(row.repeaters), withOrders),
      avg_orders_per_customer: withOrders ? Math.round((toNumber(row.orders) / withOrders) * 100) / 100 : 0,
      distribution: [
        { bucket: "1", customers: toNumber(row.b1) },
        { bucket: "2", customers: toNumber(row.b2) },
        { bucket: "3", customers: toNumber(row.b3) },
        { bucket: "4+", customers: toNumber(row.b4) },
      ],
      cohorts: buildCohorts(cohorts.rows.map((entry) => ({ cohort: entry.cohort, offset: toNumber(entry.offset_month), customers: toNumber(entry.customers) }))),
    };
  }

  /** NetGSM IVR teyit outcomes of the range's orders. */
  async getConfirmation(range: AnalyticsRange, filters: AnalyticsFilters): Promise<BreakdownAnalytics["confirmation"]> {
    const result = await sql<{ kind: string; key: string; count: unknown }>`
      WITH ${baseOrders(range, filters)}
      SELECT 'call' AS kind, coalesce(confirmation_call_status, 'not_called') AS key, count(*) AS count FROM base GROUP BY 2
      UNION ALL
      SELECT 'outcome', coalesce(confirmation_status, 'pending'), count(*) FROM base GROUP BY 2
      UNION ALL
      SELECT 'total_calls', '', coalesce(sum(confirmation_call_count), 0) FROM base
      UNION ALL
      SELECT 'called_orders', '', count(*) FILTER (WHERE confirmation_call_count > 0 OR confirmation_call_status IS NOT NULL) FROM base
      UNION ALL
      SELECT 'avg_listen', '', coalesce(round(avg(confirmation_listen_seconds)::numeric, 1), 0) FROM base
    `.execute(this.db);
    const pick = (kind: string) => toNumber(result.rows.find((row) => row.kind === kind)?.count);
    const sorted = (kind: string) =>
      result.rows
        .filter((row) => row.kind === kind)
        .map((row) => ({ key: row.key, count: toNumber(row.count) }))
        .sort((first, second) => second.count - first.count);
    return {
      total_calls: pick("total_calls"),
      called_orders: pick("called_orders"),
      avg_listen_seconds: pick("avg_listen"),
      call_statuses: sorted("call").map((row) => ({ status: row.key, count: row.count })),
      outcomes: sorted("outcome").map((row) => ({ outcome: row.key, count: row.count })),
    };
  }

  /** Cancel/return reasons: the last note line (order actions append the reason there), else the return's last cargo event. */
  async getCancellationReasons(range: AnalyticsRange, filters: AnalyticsFilters) {
    const result = await sql<{ reason: string; st: "iptal" | "iade"; count: unknown }>`
      WITH ${baseOrders(range, filters)}
      SELECT
        coalesce(
          nullif(btrim(regexp_replace(btrim(notes), '^.*\\n', '')), ''),
          CASE WHEN st = 'iade' THEN nullif(btrim(last_event_text), '') END,
          ''
        ) AS reason,
        st,
        count(*) AS count
      FROM base
      WHERE st IN ('iptal', 'iade')
      GROUP BY 1, 2
      ORDER BY 3 DESC
      LIMIT 15
    `.execute(this.db);
    return result.rows.map((row) => ({ reason: row.reason, status: row.st, count: toNumber(row.count) }));
  }

  async getOptions(): Promise<BreakdownAnalytics["options"]> {
    const [personnel, products, cities] = await Promise.all([
      this.db.selectFrom("users").select(["public_id", "first_name", "last_name"]).where("is_active", "=", true).orderBy("first_name", "asc").execute(),
      this.db.selectFrom("products").select(["public_id", "name", "category"]).where("is_active", "=", true).orderBy("name", "asc").limit(500).execute(),
      sql<{ city: string }>`
        SELECT city FROM (
          SELECT nullif(btrim(recipient_city), '') AS city FROM shipments
          UNION ALL
          SELECT nullif(btrim(city), '') FROM customer_addresses
        ) cities
        WHERE city IS NOT NULL
        GROUP BY city
        ORDER BY count(*) DESC, city
        LIMIT 200
      `.execute(this.db),
    ]);
    const categories = [...new Set(products.map((product) => product.category).filter((value): value is string => Boolean(value)))].sort((first, second) => first.localeCompare(second, "tr"));
    return {
      personnel: personnel.map((user) => ({ public_id: user.public_id, name: personName(user.first_name, user.last_name) })),
      products: products.map((product) => ({ public_id: product.public_id, name: product.name, category: product.category })),
      categories,
      cities: cities.rows.map((row) => row.city).sort((first, second) => first.localeCompare(second, "tr")),
    };
  }

  async getBreakdowns(query: AnalyticsQuery): Promise<BreakdownAnalytics> {
    const { range, filters } = query;
    const [legacy, status_distribution, channels, cargo_providers, funnel, cities, products, categories, personnel, heatmap, conversion, customers, confirmation, cancellation_reasons, options] =
      await Promise.all([
        this.getLegacyMetrics(range, filters),
        this.getStatusDistribution(range, filters),
        this.getChannels(range, filters),
        this.getCargoProviders(range, filters),
        this.getFunnel(range, filters),
        this.getCities(range, filters),
        this.getProducts(range, filters, 50),
        this.getCategories(range, filters),
        this.getPersonnel(range, filters),
        this.getHeatmap(range, filters),
        this.getConversion(range, filters),
        this.getCustomers(range, filters),
        this.getConfirmation(range, filters),
        this.getCancellationReasons(range, filters),
        this.getOptions(),
      ]);
    return { range, filters, currency: "TRY", metrics: legacy.metrics, rates: legacy.rates, status_distribution, channels, cargo_providers, funnel, cities, products, categories, personnel, heatmap, conversion, customers, confirmation, cancellation_reasons, options };
  }

  /** Point-in-time counters for the Pano cards and the attention list. */
  async getSnapshot(today: string, include: { customers: boolean; conversations: boolean }): Promise<DashboardAnalytics["snapshot"]> {
    const result = await sql<Record<string, unknown>>`
      SELECT
        (SELECT count(*) FROM shipments s LEFT JOIN orders o ON o.id = s.order_id
          WHERE s.status NOT IN ('delivered', 'returned', 'cancelled') AND (o.id IS NULL OR o.deleted_at IS NULL)) AS pending_shipments,
        (SELECT count(*) FROM shipments s WHERE s.delivered_at >= ${startBound(today)} AND s.delivered_at < ${endBound(today)}) AS delivered_today,
        (SELECT count(*) FROM customers) AS total_customers,
        (SELECT count(*) FROM conversations WHERE unread_count > 0) AS unread_conversations,
        (SELECT coalesce(sum(unread_count), 0) FROM conversations) AS unread_messages,
        (SELECT count(*) FROM orders o WHERE o.deleted_at IS NULL AND o.status IN (${statusInList("teyit_bekliyor")})) AS awaiting_confirmation,
        (SELECT count(*) FROM shipments s LEFT JOIN orders o ON o.id = s.order_id
          WHERE s.tracking_number IS NULL AND s.barcode_number IS NULL AND s.status NOT IN ('delivered', 'returned', 'cancelled')
            AND (o.id IS NULL OR o.deleted_at IS NULL)) AS tracking_missing,
        (SELECT count(*) FROM shipments s JOIN orders o ON o.id = s.order_id
          WHERE o.deleted_at IS NULL AND o.status NOT IN (${statusInList("iptal")}, ${statusInList("iade")})
            AND s.status NOT IN ('delivered', 'returned', 'cancelled')
            AND ((s.provider = 'ptt' AND s.last_event_text ILIKE ANY (${patternArray(pttBranchPatterns)}))
              OR (s.provider = 'surat' AND s.last_event_text ILIKE ANY (${patternArray(suratBranchPatterns)})))) AS at_branch
    `.execute(this.db);
    const row = result.rows[0] ?? {};
    return {
      pending_shipments: toNumber(row.pending_shipments),
      delivered_today: toNumber(row.delivered_today),
      total_customers: include.customers ? toNumber(row.total_customers) : null,
      unread_conversations: include.conversations ? toNumber(row.unread_conversations) : null,
      unread_messages: include.conversations ? toNumber(row.unread_messages) : null,
      awaiting_confirmation: toNumber(row.awaiting_confirmation),
      tracking_missing: toNumber(row.tracking_missing),
      at_branch: toNumber(row.at_branch),
    };
  }

  async listRecentOrders(options: { awaitingOnly: boolean; limit: number }): Promise<AnalyticsRecentOrder[]> {
    const result = await sql<Record<string, unknown>>`
      SELECT o.public_id, o.order_number, cu.full_name AS customer_name, o.status, ${channelExpression} AS channel,
        o.cargo_provider, o.total_amount, o.created_at
      FROM orders o
      LEFT JOIN conversations c ON c.id = o.conversation_id
      LEFT JOIN customers cu ON cu.id = o.customer_id
      WHERE o.deleted_at IS NULL ${options.awaitingOnly ? sql`AND o.status IN (${statusInList("teyit_bekliyor")})` : sql``}
      ORDER BY o.created_at ${options.awaitingOnly ? sql`ASC` : sql`DESC`}, o.id DESC
      LIMIT ${options.limit}
    `.execute(this.db);
    return result.rows.map((row) => ({
      public_id: String(row.public_id),
      order_number: String(row.order_number),
      customer_name: (row.customer_name as string | null) ?? null,
      status: String(row.status),
      channel: row.channel as AnalyticsChannel,
      cargo_provider: (row.cargo_provider as string | null) ?? null,
      total_amount: roundMoney(toNumber(row.total_amount)),
      created_at: iso(row.created_at),
    }));
  }

  async listRecentShipments(options: { trackingMissingOnly: boolean; limit: number }): Promise<AnalyticsRecentShipment[]> {
    const result = await sql<Record<string, unknown>>`
      SELECT s.public_id, s.recipient_name, s.tracking_number, s.provider, s.status, o.order_number, s.created_at
      FROM shipments s
      LEFT JOIN orders o ON o.id = s.order_id
      WHERE (o.id IS NULL OR o.deleted_at IS NULL)
        ${options.trackingMissingOnly ? sql`AND s.tracking_number IS NULL AND s.barcode_number IS NULL AND s.status NOT IN ('delivered', 'returned', 'cancelled')` : sql``}
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT ${options.limit}
    `.execute(this.db);
    return result.rows.map((row) => ({
      public_id: String(row.public_id),
      recipient_name: String(row.recipient_name),
      tracking_number: (row.tracking_number as string | null) ?? null,
      provider: String(row.provider),
      status: String(row.status),
      order_number: (row.order_number as string | null) ?? null,
      created_at: iso(row.created_at),
    }));
  }

  async listUnreadConversations(limit: number): Promise<AnalyticsUnreadConversation[]> {
    const result = await sql<Record<string, unknown>>`
      SELECT c.public_id, c.channel, cu.full_name AS customer_name, c.unread_count, c.last_message_text, c.last_message_at
      FROM conversations c
      LEFT JOIN customers cu ON cu.id = c.customer_id
      WHERE c.unread_count > 0
      ORDER BY c.last_message_at DESC NULLS LAST, c.id DESC
      LIMIT ${limit}
    `.execute(this.db);
    return result.rows.map((row) => ({
      public_id: String(row.public_id),
      channel: String(row.channel),
      customer_name: (row.customer_name as string | null) ?? null,
      unread_count: toNumber(row.unread_count),
      last_message_text: (row.last_message_text as string | null) ?? null,
      last_message_at: row.last_message_at ? iso(row.last_message_at) : null,
    }));
  }

  async getDashboard(range: AnalyticsRange, access: { managers: boolean; customers: boolean; conversations: boolean }, now: Date = new Date()): Promise<DashboardAnalytics> {
    const filters = emptyAnalyticsFilters();
    const previousRange = { from: range.previous_from, to: range.previous_to, granularity: range.granularity };
    const [timeseries, previous, channels, cargo_providers, funnel, top_products, personnel, snapshot, awaiting, trackingMissing, unread, recent_orders, recent_shipments] = await Promise.all([
      this.getTimeseries(range, filters),
      this.getTimeseries(previousRange, filters),
      this.getChannels(range, filters),
      this.getCargoProviders(range, filters),
      this.getFunnel(range, filters),
      this.getProducts(range, filters, 5),
      access.managers ? this.getPersonnel(range, filters, 6) : Promise.resolve(null),
      this.getSnapshot(reportToday(now), { customers: access.customers, conversations: access.conversations }),
      this.listRecentOrders({ awaitingOnly: true, limit: 5 }),
      this.listRecentShipments({ trackingMissingOnly: true, limit: 5 }),
      access.conversations ? this.listUnreadConversations(5) : Promise.resolve(null),
      this.listRecentOrders({ awaitingOnly: false, limit: 8 }),
      this.listRecentShipments({ trackingMissingOnly: false, limit: 5 }),
    ]);
    const keys = access.customers ? dashboardKpiKeys : dashboardKpiKeys.filter((key) => key !== "new_customers");
    return {
      range,
      currency: "TRY",
      generated_at: now.toISOString(),
      kpis: buildKpis(timeseries, previous, keys, { unread_messages: snapshot.unread_messages }),
      timeseries,
      previous_timeseries: previous,
      channels,
      cargo_providers,
      funnel,
      top_products,
      personnel,
      snapshot,
      attention: { awaiting_confirmation: awaiting, tracking_missing: trackingMissing, unread_conversations: unread },
      recent_orders,
      recent_shipments,
    };
  }

  /** KolayBi-synced invoices (local `invoices`): sales and sale returns, cancelled ones excluded. */
  async getInvoices(range: { from: string; to: string }): Promise<InvoiceAnalytics> {
    const result = await sql<Record<string, unknown>>`
      SELECT to_char(i.issue_date, 'YYYY-MM-DD') AS date, i.invoice_type,
        count(*) AS count,
        coalesce(sum(i.grand_total), 0) AS total,
        coalesce(sum(i.vat_total), 0) AS vat,
        coalesce(sum(i.paid_total), 0) AS paid
      FROM invoices i
      WHERE i.status <> 'cancelled' AND i.cancelled_at IS NULL
        AND i.issue_date >= ${range.from}::date AND i.issue_date <= ${range.to}::date
      GROUP BY 1, 2
    `.execute(this.db);
    return buildInvoiceAnalytics(
      range,
      result.rows.map((row) => ({
        date: String(row.date),
        type: String(row.invoice_type),
        count: toNumber(row.count),
        total: toNumber(row.total),
        vat: toNumber(row.vat),
        paid: toNumber(row.paid),
      })),
    );
  }
}

/** Legacy aktif / şubede totals and the six RaporlarPage rates (yuzdeHesapla, one decimal). */
export function buildLegacyMetrics(row: Record<string, unknown>): { metrics: AnalyticsLegacyMetrics; rates: AnalyticsLegacyRates } {
  const n = (key: string) => toNumber(row[key]);
  const toplam = n("toplam");
  const iptal = n("iptal");
  const iade = n("iade");
  const aktif = toplam - iptal - iade;
  const pttSubede = n("ptt_subede");
  const suratSubede = n("surat_subede");
  const metrics: AnalyticsLegacyMetrics = {
    toplam,
    aktif,
    ciro: roundMoney(n("ciro")),
    iptal,
    iade,
    sevk_edildi: n("sevk_edildi"),
    teslim_edildi: n("teslim_edildi"),
    kargoya_giden: n("kargoya_giden"),
    ptt: n("ptt"),
    surat: n("surat"),
    ptt_subede: pttSubede,
    surat_subede: suratSubede,
    subede_toplam: pttSubede + suratSubede,
    teyit_edildi: n("teyit_edildi"),
    teyit_bekliyor: n("teyit_bekliyor"),
    kargo_iade: n("kargo_iade"),
    ptt_kargo_iade: n("ptt_kargo_iade"),
    surat_kargo_iade: n("surat_kargo_iade"),
    kargo_takip_iade: n("kargo_takip_iade"),
  };
  return {
    metrics,
    rates: {
      teslim: yuzdeHesapla(metrics.teslim_edildi, metrics.sevk_edildi + metrics.teslim_edildi),
      iptal: yuzdeHesapla(iptal, toplam),
      iade: yuzdeHesapla(iade, toplam),
      kargo_iade: yuzdeHesapla(metrics.kargo_iade, metrics.kargoya_giden),
      teyit: yuzdeHesapla(metrics.teyit_edildi, aktif),
      sube: yuzdeHesapla(metrics.subede_toplam, metrics.kargoya_giden || metrics.ptt + metrics.surat),
    },
  };
}

export function buildHeatmap(rows: Array<{ weekday: number; hour: number; kind: "orders" | "messages"; count: number }>): AnalyticsHeatCell[] {
  const cells: AnalyticsHeatCell[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) cells.push({ weekday, hour, orders: 0, messages: 0 });
  }
  for (const row of rows) {
    const cell = cells[row.weekday * 24 + row.hour];
    if (cell) cell[row.kind] += row.count;
  }
  return cells;
}

export function buildCohorts(rows: Array<{ cohort: string; offset: number; customers: number }>): AnalyticsCohortRow[] {
  const byCohort = new Map<string, number[]>();
  for (const row of rows) {
    const retention = byCohort.get(row.cohort) ?? [0, 0, 0, 0, 0, 0];
    if (row.offset >= 0 && row.offset < 6) retention[row.offset] = row.customers;
    byCohort.set(row.cohort, retention);
  }
  return [...byCohort.entries()].sort(([first], [second]) => first.localeCompare(second)).map(([cohort, retention]) => ({ cohort, customers: retention[0] ?? 0, retention }));
}

export function buildInvoiceAnalytics(range: { from: string; to: string }, rows: Array<{ date: string; type: string; count: number; total: number; vat: number; paid: number }>): InvoiceAnalytics {
  const empty = (): InvoiceAnalyticsTotals => ({ count: 0, total: 0, vat: 0, paid: 0, remaining: 0 });
  const sale = empty();
  const saleReturn = empty();
  const daily = new Map<string, { date: string; sale: number; sale_return: number; count: number }>();
  for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
    daily.set(date, { date, sale: 0, sale_return: 0, count: 0 });
    if (daily.size > analyticsMaxDays) break;
  }
  for (const row of rows) {
    const target = row.type === "sale_return" ? saleReturn : sale;
    target.count += row.count;
    target.total += row.total;
    target.vat += row.vat;
    target.paid += row.paid;
    const day = daily.get(row.date) ?? { date: row.date, sale: 0, sale_return: 0, count: 0 };
    if (row.type === "sale_return") day.sale_return += row.total;
    else day.sale += row.total;
    day.count += row.count;
    daily.set(row.date, day);
  }
  for (const target of [sale, saleReturn]) {
    target.total = roundMoney(target.total);
    target.vat = roundMoney(target.vat);
    target.paid = roundMoney(target.paid);
    target.remaining = roundMoney(Math.max(0, target.total - target.paid));
  }
  return {
    range,
    currency: "TRY",
    sale,
    sale_return: saleReturn,
    net_vat: roundMoney(sale.vat - saleReturn.vat),
    daily: [...daily.values()].sort((first, second) => first.date.localeCompare(second.date)).map((day) => ({ ...day, sale: roundMoney(day.sale), sale_return: roundMoney(day.sale_return) })),
  };
}
