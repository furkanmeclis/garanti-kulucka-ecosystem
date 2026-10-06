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

  return routes;
}
