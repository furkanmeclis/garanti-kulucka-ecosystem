import { createDatabase, type AppDatabase } from "@garanti-kulucka/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const mocks = vi.hoisted(() => {
  const now = new Date("2026-10-06T09:00:00.000Z");
  let role = "admin";
  return {
    setRole: (next: string) => {
      role = next;
    },
    authRepository: {
      findUserByPublicId: vi.fn(async () => ({
        id: 10,
        public_id: "usr_test",
        role_id: 1,
        email: "user@example.com",
        password_hash: "hash",
        first_name: "Test",
        last_name: "User",
        phone: null,
        is_active: true,
        is_online: false,
        last_seen_at: null,
        sip_username: null,
        sip_password_encrypted: null,
        created_at: now,
        updated_at: now,
        role_name: role,
      })),
      findSessionByPublicId: vi.fn(async () => ({
        id: 100,
        public_id: "ses_test",
        user_id: 10,
        user_agent: null,
        ip_address: null,
        expires_at: new Date("2099-02-01T00:00:00.000Z"),
        revoked_at: null,
        created_at: now,
        updated_at: now,
      })),
    },
    analytics: {
      getDashboard: vi.fn(async (range: unknown, access: unknown) => ({ range, access })),
      getTimeseries: vi.fn(async (range: { from: string; to: string; granularity: "day" | "week" | "month" }) => {
        const { fillBuckets } = await import("../src/reports/analytics.js");
        return fillBuckets(range, [{ bucket: range.from, orders: 4, revenue: 1000, active_orders: 3, cancelled: 1, confirmed: 3 }]);
      }),
      getBreakdowns: vi.fn(async (query: unknown) => ({ query })),
      getInvoices: vi.fn(async (range: unknown) => ({ range })),
    },
  };
});

vi.mock("../src/auth/repository.js", () => ({
  AuthRepository: vi.fn(function AuthRepository() {
    return mocks.authRepository;
  }),
  isAdminRole: (role: string) => role === "admin" || role === "owner",
}));

vi.mock("../src/reports/analytics.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/reports/analytics.js")>();
  return {
    ...actual,
    AnalyticsRepository: vi.fn(function AnalyticsRepository() {
      return mocks.analytics;
    }),
  };
});

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const analytics = await import("../src/reports/analytics.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "report-analytics-route-test-secret",
  encryptionKey: "report-analytics-route-encryption",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

async function call(path: string, role: string) {
  mocks.setRole(role);
  const token = await signAccessToken({ user_public_id: "usr_test", session_public_id: "ses_test", role }, config);
  return createApp({ config, db: {} as AppDatabase }).request(path, { headers: { authorization: `Bearer ${token}` } });
}

const query = (values: Record<string, string>) => (name: string) => values[name];

describe("analytics query parsing", () => {
  const now = new Date("2026-10-10T10:00:00.000Z");

  it("defaults to the last 30 Istanbul days with the previous 30 days as comparison", () => {
    const parsed = analytics.parseAnalyticsQuery(query({}), now);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.query.range).toEqual({ from: "2026-09-11", to: "2026-10-10", previous_from: "2026-08-12", previous_to: "2026-09-10", granularity: "day", days: 30 });
    expect(parsed.query.compare).toBe(true);
    expect(parsed.query.filters).toEqual(analytics.emptyAnalyticsFilters());
  });

  it("accepts every dimension filter and picks week/month granularity for long spans", () => {
    const parsed = analytics.parseAnalyticsQuery(
      query({ from: "2026-01-01", to: "2026-06-30", compare: "0", cargo_provider: "surat", channel: "instagram", status: "iade", city: "Konya", category: "incubator", product_public_id: "prd_1", personnel_public_id: "usr_a" }),
      now,
    );
    expect(parsed.ok && parsed.query.range.granularity).toBe("week");
    expect(parsed.ok && parsed.query.compare).toBe(false);
    expect(parsed.ok && parsed.query.filters).toEqual({ cargo_provider: "surat", personnel_public_id: "usr_a", channel: "instagram", status: "iade", product_public_id: "prd_1", category: "incubator", city: "Konya" });
    expect(analytics.defaultGranularity(400)).toBe("month");
  });

  it("rejects malformed or oversized input", () => {
    for (const values of [
      { from: "2026-10-05", to: "2026-10-01" },
      { from: "2026-02-30" },
      { from: "2023-01-01", to: "2026-10-01" },
      { granularity: "hour" },
      { cargo_provider: "aras" },
      { channel: "telegram" },
      { status: "lost" },
      { city: "x".repeat(200) },
    ]) {
      expect(analytics.parseAnalyticsQuery(query(values), now).ok).toBe(false);
    }
  });
});

describe("analytics bucketing and KPIs", () => {
  it("builds Monday weeks and calendar months that cover the range", () => {
    expect(analytics.bucketKeys("2026-10-01", "2026-10-14", "week")).toEqual(["2026-09-28", "2026-10-05", "2026-10-12"]);
    expect(analytics.bucketKeys("2026-08-15", "2026-10-02", "month")).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
    expect(analytics.bucketKeys("2026-10-01", "2026-10-03", "day")).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(analytics.bucketKeys("2026-12-20", "2027-01-05", "month")).toEqual(["2026-12-01", "2027-01-01"]);
  });

  it("zero-fills buckets and merges order and conversation rows", () => {
    const buckets = analytics.fillBuckets({ from: "2026-10-01", to: "2026-10-03", granularity: "day" }, [
      { bucket: "2026-10-02", orders: 2, revenue: 100.555 },
      { bucket: "2026-10-02", conversations: 3 },
    ]);
    expect(buckets.map((bucket) => bucket.orders)).toEqual([0, 2, 0]);
    expect(buckets[1]).toMatchObject({ revenue: 100.56, conversations: 3 });
  });

  it("derives tiles, legacy rates and deltas vs the previous period", () => {
    const current = analytics.fillBuckets({ from: "2026-10-01", to: "2026-10-02", granularity: "day" }, [
      { bucket: "2026-10-01", orders: 10, revenue: 8000, active_orders: 8, cancelled: 1, returned: 1, confirmed: 6, delivered: 4 },
      { bucket: "2026-10-02", orders: 10, revenue: 2000, active_orders: 2, cancelled: 4, returned: 4, confirmed: 2 },
    ]);
    const previous = analytics.fillBuckets({ from: "2026-09-29", to: "2026-09-30", granularity: "day" }, [{ bucket: "2026-09-29", orders: 16, revenue: 5000, active_orders: 10, cancelled: 2 }]);
    const kpis = Object.fromEntries(analytics.buildKpis(current, previous, analytics.dashboardKpiKeys, { unread_messages: 7 }).map((kpi) => [kpi.key, kpi]));
    expect(kpis.revenue).toMatchObject({ value: 10000, previous: 5000, change_pct: 100, series: [8000, 2000], unit: "money" });
    expect(kpis.orders).toMatchObject({ value: 20, previous: 16, change_pct: 25 });
    expect(kpis.avg_basket).toMatchObject({ value: 1000, previous: 500 });
    expect(kpis.confirmation_rate).toMatchObject({ value: 80, series: [75, 100], unit: "percent" });
    expect(kpis.cancel_rate).toMatchObject({ value: 25, previous: 12.5, change_pct: 100 });
    expect(kpis.return_rate.value).toBe(25);
    expect(kpis.delivered.change_pct).toBeNull();
    expect(kpis.unread_messages).toMatchObject({ value: 7, previous: null, series: [] });
    expect(analytics.changePct(5, 0)).toBeNull();
    expect(analytics.changePct(90, 120)).toBe(-25);
  });

  it("keeps the legacy RaporlarPage KPI formulas for the filtered set", () => {
    const { metrics, rates } = analytics.buildLegacyMetrics({ toplam: "10", ciro: "1234.567", iptal: 1, iade: 1, sevk_edildi: 2, teslim_edildi: 2, kargoya_giden: 5, ptt: 5, surat: 3, ptt_subede: 1, surat_subede: 1, teyit_edildi: 6, kargo_iade: 1 });
    expect(metrics).toMatchObject({ aktif: 8, ciro: 1234.57, subede_toplam: 2 });
    expect(rates).toEqual({ teslim: 50, iptal: 10, iade: 10, kargo_iade: 20, teyit: 75, sube: 40 });
  });

  it("shapes the heatmap, cohorts and invoice analysis", () => {
    const heat = analytics.buildHeatmap([
      { weekday: 0, hour: 9, kind: "orders", count: 3 },
      { weekday: 6, hour: 23, kind: "messages", count: 5 },
    ]);
    expect(heat).toHaveLength(168);
    expect(heat[9]).toEqual({ weekday: 0, hour: 9, orders: 3, messages: 0 });
    expect(heat[167]).toEqual({ weekday: 6, hour: 23, orders: 0, messages: 5 });

    expect(analytics.buildCohorts([
      { cohort: "2026-09", offset: 0, customers: 10 },
      { cohort: "2026-09", offset: 1, customers: 3 },
      { cohort: "2026-08", offset: 0, customers: 4 },
    ])).toEqual([
      { cohort: "2026-08", customers: 4, retention: [4, 0, 0, 0, 0, 0] },
      { cohort: "2026-09", customers: 10, retention: [10, 3, 0, 0, 0, 0] },
    ]);

    const invoices = analytics.buildInvoiceAnalytics({ from: "2026-10-01", to: "2026-10-03" }, [
      { date: "2026-10-01", type: "sale", count: 2, total: 1200, vat: 200, paid: 1000 },
      { date: "2026-10-03", type: "sale_return", count: 1, total: 120, vat: 20, paid: 120 },
    ]);
    expect(invoices.sale).toEqual({ count: 2, total: 1200, vat: 200, paid: 1000, remaining: 200 });
    expect(invoices.sale_return.remaining).toBe(0);
    expect(invoices.net_vat).toBe(180);
    expect(invoices.daily.map((day) => [day.date, day.sale, day.sale_return])).toEqual([
      ["2026-10-01", 1200, 0],
      ["2026-10-02", 0, 0],
      ["2026-10-03", 0, 120],
    ]);
  });
});

describe("analytics routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serves the dashboard to every panel role, gating personnel / customers / conversations by role", async () => {
    const admin = await call("/api/reports/dashboard?from=2026-10-01&to=2026-10-07", "admin");
    expect(admin.status).toBe(200);
    await expect(admin.json()).resolves.toMatchObject({ range: { from: "2026-10-01", to: "2026-10-07", previous_from: "2026-09-24", previous_to: "2026-09-30" }, access: { managers: true, customers: true, conversations: true } });

    const staff = await call("/api/reports/dashboard", "calisan");
    await expect(staff.json()).resolves.toMatchObject({ access: { managers: false, customers: true, conversations: true } });
    const cargo = await call("/api/reports/dashboard", "kargo_operatoru");
    await expect(cargo.json()).resolves.toMatchObject({ access: { managers: false, customers: false, conversations: false } });

    expect((await call("/api/reports/dashboard", "misafir")).status).toBe(403);
    expect((await call("/api/reports/dashboard?from=bad", "admin")).status).toBe(400);
    expect((await createApp({ config, db: {} as AppDatabase }).request("/api/reports/dashboard")).status).toBe(401);
  });

  it("returns timeseries with KPIs and the optional previous period for managers only", async () => {
    const response = await call("/api/reports/timeseries?from=2026-10-01&to=2026-10-03&channel=whatsapp", "admin");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { compare: boolean; timeseries: unknown[]; previous_timeseries: unknown[] | null; kpis: Array<{ key: string; value: number; previous: number | null }>; filters: { channel: string } };
    expect(body.compare).toBe(true);
    expect(body.filters.channel).toBe("whatsapp");
    expect(body.timeseries).toHaveLength(3);
    expect(body.previous_timeseries).toHaveLength(3);
    expect(mocks.analytics.getTimeseries).toHaveBeenNthCalledWith(2, { from: "2026-09-28", to: "2026-09-30", granularity: "day" }, expect.objectContaining({ channel: "whatsapp" }));
    expect(body.kpis.find((kpi) => kpi.key === "orders")).toMatchObject({ value: 4, previous: 4 });

    const noCompare = (await (await call("/api/reports/timeseries?compare=0", "owner")).json()) as { previous_timeseries: unknown };
    expect(noCompare.previous_timeseries).toBeNull();

    expect((await call("/api/reports/timeseries", "calisan")).status).toBe(403);
    expect((await call("/api/reports/timeseries?granularity=year", "admin")).status).toBe(400);
  });

  it("passes parsed filters to breakdowns and the range to invoices (managers only)", async () => {
    const response = await call("/api/reports/breakdowns?from=2026-09-01&to=2026-09-30&status=teslim_edildi&city=İzmir&cargo_provider=ptt", "admin");
    expect(response.status).toBe(200);
    expect(mocks.analytics.getBreakdowns).toHaveBeenCalledWith(
      expect.objectContaining({ range: expect.objectContaining({ from: "2026-09-01", to: "2026-09-30", granularity: "day" }), filters: expect.objectContaining({ status: "teslim_edildi", city: "İzmir", cargo_provider: "ptt" }) }),
    );
    const invoices = await call("/api/reports/invoices?from=2026-09-01&to=2026-09-30", "admin");
    await expect(invoices.json()).resolves.toEqual({ range: { from: "2026-09-01", to: "2026-09-30" } });
    expect((await call("/api/reports/breakdowns", "kargo_operatoru")).status).toBe(403);
    expect((await call("/api/reports/invoices", "calisan")).status).toBe(403);
    expect((await call("/api/reports/breakdowns?status=lost", "admin")).status).toBe(400);
  });
});

/**
 * Opt-in: runs every analytics query against a real (seeded) Postgres, read-only.
 *   REPORTS_IT_DATABASE_URL=postgres://… npx vitest run test/report-analytics.test.ts
 */
const integrationUrl = process.env.REPORTS_IT_DATABASE_URL;
describe.skipIf(!integrationUrl)("analytics SQL against Postgres", () => {
  it("executes dashboard, timeseries, breakdowns and invoices with every filter", async () => {
    const { AnalyticsRepository } = await vi.importActual<typeof import("../src/reports/analytics.js")>("../src/reports/analytics.js");
    const db = createDatabase(integrationUrl!);
    try {
      const repository = new AnalyticsRepository(db);
      const parsed = analytics.parseAnalyticsQuery(query({ granularity: "week" }));
      if (!parsed.ok) throw new Error(parsed.message);
      const dashboard = await repository.getDashboard(parsed.query.range, { managers: true, customers: true, conversations: true });
      expect(dashboard.kpis.length).toBeGreaterThan(5);
      expect(dashboard.funnel.map((step) => step.key)).toEqual(["created", "confirmed", "shipped", "delivered"]);
      const filtered = analytics.parseAnalyticsQuery(query({ cargo_provider: "ptt", channel: "whatsapp", status: "teslim_edildi", city: "İstanbul", category: "incubator", product_public_id: "prd_demo_1", personnel_public_id: "usr_demo_elif" }));
      if (!filtered.ok) throw new Error(filtered.message);
      const breakdowns = await repository.getBreakdowns(filtered.query);
      expect(breakdowns.heatmap).toHaveLength(168);
      expect(breakdowns.metrics.toplam).toBeGreaterThanOrEqual(breakdowns.metrics.teslim_edildi);
      const series = await repository.getTimeseries(filtered.query.range, filtered.query.filters);
      expect(series).toHaveLength(filtered.query.range.days);
      const invoices = await repository.getInvoices(filtered.query.range);
      expect(invoices.daily).toHaveLength(filtered.query.range.days);
    } finally {
      await db.destroy();
    }
  });
});
