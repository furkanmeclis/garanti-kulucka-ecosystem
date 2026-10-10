/** Deterministic `/api/reports/{dashboard,timeseries,breakdowns,invoices}` mocks for the beta Pano / İş Analizi specs. */

const day = (date: string, offset: number) => {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return parsed.toISOString().slice(0, 10);
};
const span = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

function bucketStart(date: string, granularity: string) {
  if (granularity === "month") return `${date.slice(0, 7)}-01`;
  if (granularity === "week") return day(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
  return date;
}

export function analyticsRange(url: URL) {
  const to = url.searchParams.get("to") ?? "2026-10-07";
  const from = url.searchParams.get("from") ?? day(to, -29);
  const days = span(from, to);
  const granularity = url.searchParams.get("granularity") ?? (days <= 62 ? "day" : days <= 200 ? "week" : "month");
  return { from, to, previous_from: day(from, -days), previous_to: day(from, -1), granularity, days };
}

function buckets(from: string, to: string, granularity: string, scale: number) {
  const keys: string[] = [];
  for (let date = from; date <= to; date = day(date, 1)) {
    const key = bucketStart(date, granularity);
    if (!keys.includes(key)) keys.push(key);
  }
  return keys.map((bucket, index) => {
    const orders = Math.round((4 + (index % 5)) * scale);
    return { bucket, orders, revenue: orders * 3000, active_orders: orders - 1, cancelled: 1, returned: index % 3 === 0 ? 1 : 0, delivered: Math.max(0, orders - 2), in_cargo: 1, confirmed: orders - 1, new_customers: 3, conversations: 5, messages_in: 20 };
  });
}

function kpis(current: ReturnType<typeof buckets>, previous: ReturnType<typeof buckets> | null) {
  const sum = (rows: ReturnType<typeof buckets>, key: keyof ReturnType<typeof buckets>[number]) => rows.reduce((total, row) => total + Number(row[key]), 0);
  const metric = (rows: ReturnType<typeof buckets>) => ({
    revenue: sum(rows, "revenue"),
    orders: sum(rows, "orders"),
    avg_basket: Math.round((sum(rows, "revenue") / Math.max(1, sum(rows, "active_orders"))) * 100) / 100,
    confirmation_rate: Math.round((sum(rows, "confirmed") / Math.max(1, sum(rows, "active_orders"))) * 1000) / 10,
    in_cargo: sum(rows, "in_cargo"),
    delivered: sum(rows, "delivered"),
    cancel_rate: Math.round((sum(rows, "cancelled") / Math.max(1, sum(rows, "orders"))) * 1000) / 10,
    return_rate: Math.round((sum(rows, "returned") / Math.max(1, sum(rows, "orders"))) * 1000) / 10,
    new_customers: sum(rows, "new_customers"),
    conversations: sum(rows, "conversations"),
    messages_in: sum(rows, "messages_in"),
  });
  const now = metric(current);
  const before = previous ? metric(previous) : null;
  const units: Record<string, string> = { revenue: "money", avg_basket: "money", confirmation_rate: "percent", cancel_rate: "percent", return_rate: "percent" };
  return (Object.keys(now) as Array<keyof typeof now>).map((key) => ({
    key,
    value: now[key],
    previous: before ? before[key] : null,
    change_pct: before && before[key] ? Math.round(((now[key] - before[key]) / before[key]) * 1000) / 10 : null,
    series: current.map((row) => (key in row ? Number((row as Record<string, number>)[key]) : 0)),
    unit: units[key] ?? "count",
  }));
}

export function dashboardFixture(url: URL, role: string) {
  const range = analyticsRange(url);
  const current = buckets(range.from, range.to, range.granularity, 1);
  const previous = buckets(range.previous_from, range.previous_to, range.granularity, 0.8);
  const managers = role === "admin" || role === "owner";
  const office = managers || role === "calisan";
  const allKpis = kpis(current, previous).filter((kpi) => !["conversations", "messages_in"].includes(kpi.key) && (office || kpi.key !== "new_customers"));
  return {
    range,
    currency: "TRY",
    generated_at: "2026-10-07T09:00:00.000Z",
    kpis: [...allKpis, ...(office ? [{ key: "unread_messages", value: 12, previous: null, change_pct: null, series: [], unit: "count" }] : [])],
    timeseries: current,
    previous_timeseries: previous,
    channels: [
      { channel: "whatsapp", orders: 60, revenue: 180000, cancelled: 2 },
      { channel: "instagram", orders: 30, revenue: 90000, cancelled: 3 },
      { channel: "messenger", orders: 10, revenue: 30000, cancelled: 0 },
      { channel: "manual", orders: 8, revenue: 24000, cancelled: 1 },
    ],
    cargo_providers: [
      { provider: "ptt", orders: 64, revenue: 192000, in_cargo: 6, delivered: 50, returned: 4, at_branch: 2, tracking_returns: 3 },
      { provider: "surat", orders: 44, revenue: 132000, in_cargo: 4, delivered: 35, returned: 2, at_branch: 1, tracking_returns: 1 },
    ],
    funnel: [
      { key: "created", count: 108 },
      { key: "confirmed", count: 100 },
      { key: "shipped", count: 95 },
      { key: "delivered", count: 85 },
    ],
    top_products: [
      { product_public_id: "prd_1", name: "El Yapımı Kuluçka Makinesi 96'lık", category: "incubator", quantity: 50, revenue: 175000, orders: 50 },
      { product_public_id: "prd_2", name: "Dijital Termostat", category: "spare_part", quantity: 40, revenue: 18000, orders: 30 },
    ],
    personnel: managers ? [{ user_public_id: "usr_1", name: "Ayşe Yılmaz", orders: 70, revenue: 150000, cancelled: 5, returned: 2, delivered: 60, avg_basket: 2200, confirmation_rate: 90 }] : null,
    snapshot: {
      pending_shipments: 19,
      delivered_today: 4,
      total_customers: office ? 342 : null,
      unread_conversations: office ? 5 : null,
      unread_messages: office ? 12 : null,
      awaiting_confirmation: 7,
      tracking_missing: 6,
      at_branch: 3,
    },
    attention: {
      awaiting_confirmation: [{ public_id: "ord_1", order_number: "GK-1001", customer_name: "Hasan Yılmaz", status: "pending_confirmation", channel: "whatsapp", cargo_provider: "ptt", total_amount: 3500, created_at: "2026-10-07T07:00:00.000Z" }],
      tracking_missing: [{ public_id: "shp_5", recipient_name: "Ali Vural", tracking_number: null, provider: "surat", status: "created", order_number: "GK-1005", created_at: "2026-10-06T07:00:00.000Z" }],
      unread_conversations: office ? [{ public_id: "cnv_1", channel: "instagram", customer_name: "Zeynep Kaya", unread_count: 2, last_message_text: "Merhaba", last_message_at: "2026-10-07T08:00:00.000Z" }] : null,
    },
    recent_orders: [
      { public_id: "ord_1", order_number: "GK-1001", customer_name: "Hasan Yılmaz", status: "pending_confirmation", channel: "whatsapp", cargo_provider: "ptt", total_amount: 3500, created_at: "2026-10-07T07:00:00.000Z" },
      { public_id: "ord_2", order_number: "GK-1002", customer_name: "Ayşe Demir", status: "delivered", channel: "instagram", cargo_provider: "surat", total_amount: 2550, created_at: "2026-10-06T07:00:00.000Z" },
    ],
    recent_shipments: [
      { public_id: "shp_1", recipient_name: "Hasan Yılmaz", tracking_number: "270014568912", provider: "ptt", status: "in_transit", order_number: "GK-1001", created_at: "2026-10-07T06:00:00.000Z" },
      { public_id: "shp_5", recipient_name: "Ali Vural", tracking_number: null, provider: "surat", status: "created", order_number: "GK-1005", created_at: "2026-10-06T07:00:00.000Z" },
    ],
  };
}

const filterKeys = ["cargo_provider", "personnel_public_id", "channel", "status", "product_public_id", "category", "city"] as const;

function filtersOf(url: URL) {
  return Object.fromEntries(filterKeys.map((key) => [key, url.searchParams.get(key) ?? (key === "cargo_provider" ? "tumu" : null)]));
}

/** Filtered requests scale down so specs can see the refetch. */
const scaleOf = (url: URL) => (filterKeys.some((key) => url.searchParams.get(key)) ? 0.5 : 1);

export function timeseriesFixture(url: URL) {
  const range = analyticsRange(url);
  const compare = url.searchParams.get("compare") !== "0";
  const scale = scaleOf(url);
  const current = buckets(range.from, range.to, range.granularity, scale);
  const previous = compare ? buckets(range.previous_from, range.previous_to, range.granularity, scale * 0.8) : null;
  return { range, filters: filtersOf(url), compare, currency: "TRY", kpis: kpis(current, previous), timeseries: current, previous_timeseries: previous };
}

export function breakdownsFixture(url: URL) {
  const range = analyticsRange(url);
  const scale = scaleOf(url);
  const n = (value: number) => Math.round(value * scale);
  const heatmap = Array.from({ length: 168 }, (_, index) => ({ weekday: Math.floor(index / 24), hour: index % 24, orders: index % 24 >= 9 && index % 24 <= 21 ? (index % 7) + 1 : 0, messages: index % 24 >= 8 ? (index % 5) * 2 : 0 }));
  return {
    range,
    filters: filtersOf(url),
    currency: "TRY",
    metrics: { toplam: n(120), aktif: n(102), ciro: n(245000), iptal: n(12), iade: n(6), sevk_edildi: n(30), teslim_edildi: n(60), kargoya_giden: n(90), ptt: n(50), surat: n(40), ptt_subede: 4, surat_subede: 3, subede_toplam: 7, teyit_edildi: n(85), teyit_bekliyor: 8, kargo_iade: 5, ptt_kargo_iade: 3, surat_kargo_iade: 2, kargo_takip_iade: 1 },
    rates: { teslim: 66.7, iptal: 10, iade: 5, kargo_iade: 5.6, teyit: 83.3, sube: 7.8 },
    status_distribution: [
      { status: "teslim_edildi", count: n(60) },
      { status: "sevk_edildi", count: n(30) },
      { status: "iptal", count: n(12) },
    ],
    channels: [
      { channel: "whatsapp", orders: n(60), revenue: n(180000), cancelled: 2 },
      { channel: "instagram", orders: n(40), revenue: n(120000), cancelled: 3 },
      { channel: "manual", orders: n(20), revenue: n(60000), cancelled: 1 },
    ],
    cargo_providers: [
      { provider: "ptt", orders: n(64), revenue: n(192000), in_cargo: 6, delivered: 50, returned: 4, at_branch: 2, tracking_returns: 3 },
      { provider: "surat", orders: n(44), revenue: n(132000), in_cargo: 4, delivered: 35, returned: 2, at_branch: 1, tracking_returns: 1 },
    ],
    funnel: [
      { key: "created", count: n(120) },
      { key: "confirmed", count: n(110) },
      { key: "shipped", count: n(95) },
      { key: "delivered", count: n(60) },
    ],
    cities: [
      { city: "İstanbul", orders: n(40), revenue: n(120000), customers: 30, cancelled: 3, returned: 1 },
      { city: "Konya", orders: n(20), revenue: n(60000), customers: 15, cancelled: 1, returned: 0 },
      { city: "İzmir", orders: n(12), revenue: n(36000), customers: 10, cancelled: 0, returned: 1 },
    ],
    products: [
      { product_public_id: "prd_1", name: "El Yapımı Kuluçka Makinesi 96'lık", category: "incubator", quantity: n(50), revenue: n(175000), orders: n(50) },
      { product_public_id: "prd_2", name: "Dijital Termostat", category: "spare_part", quantity: n(40), revenue: n(18000), orders: n(30) },
    ],
    categories: [
      { category: "incubator", quantity: n(50), revenue: n(175000), orders: n(50) },
      { category: "spare_part", quantity: n(40), revenue: n(18000), orders: n(30) },
    ],
    personnel: [{ user_public_id: "usr_1", name: "Ayşe Yılmaz", orders: n(70), revenue: n(150000), cancelled: 5, returned: 2, delivered: 60, avg_basket: 2200, confirmation_rate: 90 }],
    heatmap,
    conversion: {
      conversations: 100,
      converted: 64,
      orders: 70,
      rate: 64,
      by_channel: [
        { channel: "whatsapp", conversations: 60, converted: 40, orders: 44, rate: 66.7 },
        { channel: "instagram", conversations: 40, converted: 24, orders: 26, rate: 60 },
      ],
    },
    customers: {
      customers_with_orders: 90,
      new_customers: 70,
      returning_customers: 20,
      repeat_rate: 26.2,
      avg_orders_per_customer: 1.33,
      distribution: [
        { bucket: "1", customers: 66 },
        { bucket: "2", customers: 18 },
        { bucket: "3", customers: 4 },
        { bucket: "4+", customers: 2 },
      ],
      cohorts: [
        { cohort: "2026-08", customers: 40, retention: [40, 8, 2, 0, 0, 0] },
        { cohort: "2026-09", customers: 50, retention: [50, 6, 0, 0, 0, 0] },
      ],
    },
    confirmation: {
      total_calls: 140,
      called_orders: 100,
      avg_listen_seconds: 18.5,
      call_statuses: [
        { status: "cevaplandi", count: 70 },
        { status: "ulasilamadi", count: 20 },
        { status: "not_called", count: 20 },
      ],
      outcomes: [
        { outcome: "confirmed", count: 85 },
        { outcome: "iptal_istegi", count: 5 },
        { outcome: "pending", count: 8 },
      ],
    },
    cancellation_reasons: [
      { reason: "Müşteri vazgeçti", status: "iptal", count: 6 },
      { reason: "Alıcı Kabul Etmedi", status: "iade", count: 3 },
      { reason: "", status: "iptal", count: 2 },
    ],
    options: {
      personnel: [{ public_id: "usr_1", name: "Ayşe Yılmaz" }],
      products: [
        { public_id: "prd_1", name: "El Yapımı Kuluçka Makinesi 96'lık", category: "incubator" },
        { public_id: "prd_2", name: "Dijital Termostat", category: "spare_part" },
      ],
      categories: ["incubator", "spare_part"],
      cities: ["İstanbul", "İzmir", "Konya"],
    },
  };
}

export function invoicesFixture(url: URL) {
  const range = analyticsRange(url);
  const daily = [];
  for (let date = range.from; date <= range.to; date = day(date, 1)) daily.push({ date, sale: date.endsWith("5") ? 7000 : 3500, sale_return: date.endsWith("3") ? 2550 : 0, count: 1 });
  return {
    range: { from: range.from, to: range.to },
    currency: "TRY",
    sale: { count: 42, total: 147000, vat: 24500, paid: 120000, remaining: 27000 },
    sale_return: { count: 3, total: 7650, vat: 1275, paid: 7650, remaining: 0 },
    net_vat: 23225,
    daily,
  };
}
