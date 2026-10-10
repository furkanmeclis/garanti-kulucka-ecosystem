import { Hono } from "hono";
import type { AppBindings } from "./types.js";
import { authenticate, requireDatabase } from "./middleware.js";
import { isAdminRole } from "../auth/repository.js";
import {
  ReportRepository,
  addDays,
  buildReportAnalysis,
  isReportDate,
  reportCargoProviders,
  reportToday,
  type ReportCargoProvider,
} from "../reports/repository.js";
import { AnalyticsRepository, buildKpis, parseAnalyticsQuery, reportKpiKeys } from "../reports/analytics.js";

/** Pano is shown to every panel role; analytics breakdowns stay manager-only like `/analysis`. */
function canReadDashboard(role: string) {
  return isAdminRole(role) || role === "calisan" || role === "kargo_operatoru";
}

const forbidden = { error: { code: "forbidden", message: "Reports analytics access is not allowed" } } as const;
const unavailable = { error: { code: "database_unavailable", message: "Database connection is not configured" } } as const;

/**
 * Legacy `/raporlar` (RaporlarPage "İş Analizi", admin only). The page issued ~25 Supabase count
 * probes plus a `gunluk_istatistikler` RPC; here one admin endpoint returns every KPI, rate,
 * breakdown and chart series computed in SQL for the selected date range / personnel / cargo.
 */
export function createReportRoutes() {
  const routes = new Hono<AppBindings>();

  routes.use("*", requireDatabase, authenticate);

  routes.get("/analysis", async (context) => {
    if (!isAdminRole(context.get("auth")?.role ?? "")) {
      return context.json({ error: { code: "forbidden", message: "Reports analysis access is not allowed" } }, 403);
    }

    const today = reportToday();
    const endDate = context.req.query("end_date") || today;
    const startDate = context.req.query("start_date") || addDays(endDate, -29);
    const cargoProvider = (context.req.query("cargo_provider") || "tumu") as ReportCargoProvider;
    const personnelPublicId = context.req.query("personnel_public_id")?.trim() || null;

    if (!isReportDate(startDate) || !isReportDate(endDate) || startDate > endDate) {
      return context.json({ error: { code: "invalid_request", message: "Invalid report date range" } }, 400);
    }
    if (!(reportCargoProviders as readonly string[]).includes(cargoProvider)) {
      return context.json({ error: { code: "invalid_request", message: "Invalid report cargo provider filter" } }, 400);
    }
    if (personnelPublicId !== null && personnelPublicId.length > 64) {
      return context.json({ error: { code: "invalid_request", message: "Invalid report personnel filter" } }, 400);
    }

    const db = context.get("db");
    if (!db) {
      return context.json({ error: { code: "database_unavailable", message: "Database connection is not configured" } }, 503);
    }

    const filters = { startDate, endDate, cargoProvider, personnelPublicId };
    const aggregates = await new ReportRepository(db).getAggregates(filters);
    return context.json(buildReportAnalysis(filters, aggregates));
  });

  /** Beta Pano: KPI tiles with sparklines and deltas, trends, breakdowns, snapshot counters and the attention list. */
  routes.get("/dashboard", async (context) => {
    const role = context.get("auth")?.role ?? "";
    if (!canReadDashboard(role)) return context.json(forbidden, 403);
    const parsed = parseAnalyticsQuery((name) => context.req.query(name));
    if (!parsed.ok) return context.json({ error: { code: "invalid_request", message: parsed.message } }, 400);
    const db = context.get("db");
    if (!db) return context.json(unavailable, 503);
    const managers = isAdminRole(role);
    const dashboard = await new AnalyticsRepository(db).getDashboard(parsed.query.range, {
      managers,
      customers: managers || role === "calisan",
      conversations: managers || role === "calisan",
    });
    return context.json(dashboard);
  });

  /** İş Analizi trend series (current + previous period) and KPI totals for the filtered order set. */
  routes.get("/timeseries", async (context) => {
    if (!isAdminRole(context.get("auth")?.role ?? "")) return context.json(forbidden, 403);
    const parsed = parseAnalyticsQuery((name) => context.req.query(name));
    if (!parsed.ok) return context.json({ error: { code: "invalid_request", message: parsed.message } }, 400);
    const db = context.get("db");
    if (!db) return context.json(unavailable, 503);
    const { range, filters, compare } = parsed.query;
    const repository = new AnalyticsRepository(db);
    const [timeseries, previous] = await Promise.all([
      repository.getTimeseries(range, filters),
      compare ? repository.getTimeseries({ from: range.previous_from, to: range.previous_to, granularity: range.granularity }, filters) : Promise.resolve(null),
    ]);
    return context.json({ range, filters, compare, currency: "TRY", kpis: buildKpis(timeseries, previous, reportKpiKeys), timeseries, previous_timeseries: previous });
  });

  /** İş Analizi breakdowns: status, channel, cargo, city, product, personnel, heatmap, cohorts, conversion, teyit, reasons. */
  routes.get("/breakdowns", async (context) => {
    if (!isAdminRole(context.get("auth")?.role ?? "")) return context.json(forbidden, 403);
    const parsed = parseAnalyticsQuery((name) => context.req.query(name));
    if (!parsed.ok) return context.json({ error: { code: "invalid_request", message: parsed.message } }, 400);
    const db = context.get("db");
    if (!db) return context.json(unavailable, 503);
    return context.json(await new AnalyticsRepository(db).getBreakdowns(parsed.query));
  });

  /** Legacy FaturaAnalizBolumu over the KolayBi-synced local invoices (sales and sale returns). */
  routes.get("/invoices", async (context) => {
    if (!isAdminRole(context.get("auth")?.role ?? "")) return context.json(forbidden, 403);
    const parsed = parseAnalyticsQuery((name) => context.req.query(name));
    if (!parsed.ok) return context.json({ error: { code: "invalid_request", message: parsed.message } }, 400);
    const db = context.get("db");
    if (!db) return context.json(unavailable, 503);
    return context.json(await new AnalyticsRepository(db).getInvoices({ from: parsed.query.range.from, to: parsed.query.range.to }));
  });

  return routes;
}
