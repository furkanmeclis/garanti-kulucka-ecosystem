import type { AnalyticsKpiKey, BreakdownAnalytics, InvoiceAnalytics, TimeseriesAnalytics } from "@garanti-kulucka/shared";
import {
  BarChart3,
  Building2,
  CheckCircle,
  Clock,
  FileText,
  Filter,
  Grid3x3,
  Info,
  MapPin,
  MessageCircle,
  Package,
  PackageX,
  Percent,
  PhoneCall,
  Receipt,
  RefreshCw,
  Repeat,
  RotateCcw,
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  Truck,
  UserPlus,
  Users,
  Wallet,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/app/auth";
import { BrandIcon } from "@/components/brand-icons";
import {
  CategoryBarChart,
  ChartCard,
  DataTable,
  DonutChart,
  Funnel,
  Heatmap,
  InfoHint,
  KpiTile,
  TrendChart,
  channelColor,
  chartTokens,
  exportColumns,
  formatBucket,
  formatValue,
  providerColor,
  seriesColor,
  type TableColumn,
  type ValueKind,
} from "@/components/charts";
import { ErrorState } from "@/components/data-list";
import { carrierBrand, channelBrand } from "@/components/provider-label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageHeader } from "@/layout/page-header";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { ReportFilterBar } from "./filter-bar";
import { parseReportFilters, rebucket, resolvedGranularity, serializeReportFilters, toAnalyticsQuery, type ReportFilterState } from "./filters";
import { callStatusName, categoryLabel, channelName, legacyStatusName, outcomeName, reasonName } from "./labels";

const kpiIcons: Partial<Record<AnalyticsKpiKey, LucideIcon>> = {
  revenue: Wallet,
  orders: ShoppingCart,
  avg_basket: ShoppingBag,
  confirmation_rate: Percent,
  in_cargo: Truck,
  delivered: CheckCircle,
  cancel_rate: XCircle,
  return_rate: RotateCcw,
  new_customers: UserPlus,
  conversations: MessageCircle,
  messages_in: MessageCircle,
};
const lowerIsBetter = new Set<AnalyticsKpiKey>(["cancel_rate", "return_rate"]);

function SectionTitle({ icon: Icon, title, description, testId }: { icon: LucideIcon; title: string; description?: string; testId?: string }) {
  return (
    <div className="mt-2 flex items-center gap-2" data-testid={testId}>
      <Icon className="size-4 text-primary" aria-hidden="true" />
      <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
      {description && <span className="hidden text-xs text-muted-foreground sm:inline">· {description}</span>}
    </div>
  );
}

/** Legacy KpiKart: label, value, optional detail line, icon — no delta (the legacy block is a filtered snapshot). */
function StatCard({ label, value, detail, icon: Icon, info, testId, tone = "primary" }: { label: string; value: string; detail?: string | undefined; icon: LucideIcon; info?: string; testId: string; tone?: "primary" | "good" | "bad" | "warn" }) {
  const toneClass = tone === "good" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : tone === "bad" ? "bg-destructive/10 text-destructive" : tone === "warn" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-primary/10 text-primary";
  return (
    <Card className="flex min-w-0 items-start justify-between gap-2 p-3 sm:p-4" data-testid={testId}>
      <div className="min-w-0">
        <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground sm:text-sm">
          <span className="truncate">{label}</span>
          {info && <InfoHint text={info} />}
        </p>
        <p className="mt-1 truncate text-xl font-semibold tracking-tight sm:text-2xl" data-testid={`${testId}-value`}>
          {value}
        </p>
        {detail && <p className="mt-0.5 text-xs break-words text-muted-foreground">{detail}</p>}
      </div>
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-md", toneClass)}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
    </Card>
  );
}

function SkeletonGrid({ count, className }: { count: number; className: string }) {
  return (
    <div className={className} aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-28" />
      ))}
    </div>
  );
}

/** /raporlar — İş Analizi: legacy RaporlarPage + FaturaAnalizBolumu parity plus comparison, granularity, dimensions and new breakdowns. */
export function ReportsView() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [params, setParams] = useSearchParams();
  const paramsKey = params.toString();
  const state = useMemo(() => parseReportFilters(new URLSearchParams(paramsKey)), [paramsKey]);
  const query = toAnalyticsQuery(state);
  const queryKey = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined) as Array<[string, string]>).toString();

  // Merge into the latest URL state, not the render's snapshot: two quick changes (provider, then personnel) used
  // to race and the second dropped the first.
  const update = useCallback(
    (next: Partial<ReportFilterState>) => {
      setParams((prev) => serializeReportFilters({ ...parseReportFilters(prev), ...next }), { replace: true });
    },
    [setParams],
  );

  const timeseries = useQuery(`reports-ts:${queryKey}`, () => api.reportTimeseries(query));
  const breakdowns = useQuery(`reports-bd:${queryKey}`, () => api.reportBreakdowns(query));
  const invoices = useQuery(`reports-inv:${state.from}:${state.to}`, () => api.reportInvoices({ from: state.from, to: state.to }));
  const reloadAll = () => {
    timeseries.reload();
    breakdowns.reload();
    invoices.reload();
  };
  const loading = timeseries.loading || breakdowns.loading || invoices.loading;

  return (
    <section data-testid="page-reports">
      <PageHeader
        title={t("reports.title")}
        description={t("reports.subtitleNew")}
        actions={
          <Button variant="outline" className="min-h-11 lg:min-h-9" onClick={reloadAll} disabled={loading} data-testid="reports-refresh">
            <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" />
            {t("reports.refresh")}
          </Button>
        }
      />
      <ReportFilterBar state={state} onChange={update} options={breakdowns.data?.options} />
      <div className="flex flex-col gap-4 sm:gap-5" data-testid="reports-content" data-query={queryKey}>
        <KpiSection data={timeseries.data} error={Boolean(timeseries.error)} loading={timeseries.loading} onRetry={timeseries.reload} />
        {breakdowns.error && !breakdowns.data ? (
          <ErrorState onRetry={breakdowns.reload} />
        ) : (
          <>
            <LegacySection data={breakdowns.data} refreshing={breakdowns.loading} />
            <TrendSection data={timeseries.data} breakdowns={breakdowns.data} refreshing={timeseries.loading || breakdowns.loading} />
            <ChannelSection data={breakdowns.data} refreshing={breakdowns.loading} />
            <GeoProductSection data={breakdowns.data} refreshing={breakdowns.loading} />
            <BehaviourSection data={breakdowns.data} refreshing={breakdowns.loading} />
            <OperationsSection data={breakdowns.data} refreshing={breakdowns.loading} />
          </>
        )}
        <InvoiceSection data={invoices.data} error={Boolean(invoices.error)} loading={invoices.loading} onRetry={invoices.reload} granularity={resolvedGranularity(state)} />
      </div>
    </section>
  );
}

function KpiSection({ data, loading, error, onRetry }: { data: TimeseriesAnalytics | undefined; loading: boolean; error: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  if (error && !data) return <ErrorState onRetry={onRetry} />;
  if (!data) return <SkeletonGrid count={8} className="grid grid-cols-2 gap-3 lg:grid-cols-4" />;
  return (
    <>
      <SectionTitle icon={TrendingUp} title={t("reports.kpiRow")} />
      <div className={cn("grid grid-cols-2 gap-3 transition-opacity lg:grid-cols-4 2xl:grid-cols-6", loading && "opacity-60")} data-testid="reports-kpis">
        {data.kpis.map((kpi) => (
          <KpiTile
            key={kpi.key}
            testId={`reports-kpi-${kpi.key}`}
            label={t(`analytics.kpi.${kpi.key}`)}
            info={t(`analytics.kpiInfo.${kpi.key}`)}
            value={kpi.value}
            kind={kpi.unit === "money" ? "money" : kpi.unit === "percent" ? "percent" : "count"}
            icon={kpiIcons[kpi.key] ?? BarChart3}
            changePct={data.compare ? kpi.change_pct : undefined}
            previous={data.compare ? kpi.previous : undefined}
            series={kpi.series}
            {...(lowerIsBetter.has(kpi.key) ? { goodWhen: "down" as const } : {})}
          />
        ))}
      </div>
    </>
  );
}

/** Legacy "Sipariş Özeti", "Kargo Durumu" KPI cards and the five-rate summary, over the fully filtered set. */
function LegacySection({ data, refreshing }: { data: BreakdownAnalytics | undefined; refreshing: boolean }) {
  const { t, i18n } = useTranslation();
  if (!data) return <SkeletonGrid count={12} className="grid grid-cols-2 gap-3 lg:grid-cols-4" />;
  const m = data.metrics;
  const r = data.rates;
  const n = (value: number) => formatValue(value, "count", i18n.language);
  const pct = (value: number) => formatValue(value, "percent", i18n.language);
  const rates = [
    { key: "delivery", label: t("reports.deliveryRate"), formula: t("reports.deliveryRateFormula"), value: r.teslim, tone: "text-emerald-700 dark:text-emerald-400" },
    { key: "cargoReturn", label: t("reports.cargoReturnRate"), formula: t("reports.cargoReturnRateFormula"), value: r.kargo_iade, tone: "text-amber-700 dark:text-amber-400" },
    { key: "cancel", label: t("reports.cancelRate"), formula: t("reports.cancelRateFormula"), value: r.iptal, tone: "text-red-700 dark:text-red-400" },
    { key: "return", label: t("reports.returnRate"), formula: t("reports.returnRateFormula"), value: r.iade, tone: "text-amber-700 dark:text-amber-400" },
    { key: "branch", label: t("reports.branchWaiting"), formula: t("reports.branchWaitingFormula"), value: r.sube, tone: "text-amber-700 dark:text-amber-400" },
  ];
  return (
    <div className={cn("flex flex-col gap-4 transition-opacity", refreshing && "opacity-60")}>
      <SectionTitle icon={Package} title={t("reports.orderSummary")} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="reports-order-summary">
        <StatCard testId="reports-legacy-total" label={t("reports.totalOrders")} value={n(m.toplam)} icon={Package} />
        <StatCard testId="reports-legacy-active" label={t("reports.activeOrders")} value={n(m.aktif)} icon={TrendingUp} tone="good" />
        <StatCard testId="reports-legacy-revenue" label={t("reports.totalRevenue")} value={formatValue(m.ciro, "money", i18n.language)} icon={Wallet} tone="good" />
        <StatCard testId="reports-legacy-cancelled" label={t("analytics.status.iptal")} value={n(m.iptal)} detail={t("reports.cancelRateSuffix", { rate: r.iptal })} icon={XCircle} tone="bad" />
        <StatCard testId="reports-legacy-returned" label={t("analytics.status.iade")} value={n(m.iade)} detail={t("reports.returnRateSuffix", { rate: r.iade })} icon={RotateCcw} tone="warn" />
      </div>
      <SectionTitle icon={Truck} title={t("reports.cargoStatus")} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7" data-testid="reports-cargo-summary">
        <StatCard testId="reports-legacy-cargo" label={t("reports.handedToCargo")} value={n(m.kargoya_giden)} icon={Truck} />
        <StatCard testId="reports-legacy-transit" label={t("reports.statusInTransit")} value={n(m.sevk_edildi)} icon={Truck} />
        <StatCard testId="reports-legacy-delivered" label={t("reports.statusDelivered")} value={n(m.teslim_edildi)} detail={t("reports.deliveryRateSuffix", { rate: r.teslim })} icon={CheckCircle} tone="good" />
        <StatCard testId="reports-legacy-cargo-returns" label={t("reports.cargoReturns")} value={n(m.kargo_iade)} detail={t("reports.cargoReturnsDetail", { ptt: m.ptt_kargo_iade, surat: m.surat_kargo_iade, rate: r.kargo_iade })} icon={RotateCcw} tone="warn" />
        <StatCard testId="reports-legacy-branch" label={t("reports.waitingAtBranch")} value={n(m.subede_toplam)} detail={t("reports.branchDetail", { ptt: m.ptt_subede, surat: m.surat_subede })} icon={Building2} tone="warn" />
        <StatCard testId="reports-legacy-tracking" label={t("reports.trackingReturns")} value={n(m.kargo_takip_iade)} detail={t("reports.trackingReturnsDetail")} icon={RotateCcw} tone="bad" />
        <StatCard testId="reports-legacy-confirmation" label={t("reports.confirmationRate")} value={pct(r.teyit)} detail={t("reports.awaitingConfirmationCount", { count: m.teyit_bekliyor })} icon={Percent} />
      </div>
      <Card className="p-4" data-testid="reports-rates">
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {rates.map((rate) => (
            <li key={rate.key} className="min-w-0 text-center" data-testid={`reports-rate-${rate.key}`}>
              <p className="truncate text-xs text-muted-foreground">{rate.label}</p>
              <p className={cn("mt-1 text-2xl font-bold sm:text-3xl", rate.tone)}>{pct(rate.value)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{rate.formula}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function TrendSection({ data, breakdowns, refreshing }: { data: TimeseriesAnalytics | undefined; breakdowns: BreakdownAnalytics | undefined; refreshing: boolean }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const granularity = data?.range.granularity ?? "day";
  const points = useMemo(
    () =>
      (data?.timeseries ?? []).map((bucket, index) => {
        const previous = data?.previous_timeseries?.[index];
        return { bucket: bucket.bucket, previousBucket: previous?.bucket, orders: bucket.orders, revenue: bucket.revenue, cancelled: bucket.cancelled, returned: bucket.returned, prev_orders: previous?.orders ?? 0, prev_revenue: previous?.revenue ?? 0 };
      }),
    [data],
  );
  type Point = (typeof points)[number];
  const compare = Boolean(data?.compare);
  const suffix = data ? `${data.range.from}_${data.range.to}` : "";
  const trendColumns: TableColumn<Point>[] = [
    { key: "bucket", header: t("reports.colDate"), render: (row) => formatBucket(row.bucket, granularity, language, true), exportValue: (row) => row.bucket },
    { key: "orders", header: t("reports.colOrders"), align: "right", render: (row) => formatValue(row.orders, "count", language), exportValue: (row) => row.orders },
    { key: "revenue", header: t("reports.colRevenue"), align: "right", render: (row) => formatValue(row.revenue, "money", language), exportValue: (row) => row.revenue },
    { key: "cancelled", header: t("reports.colCancelled"), align: "right", render: (row) => formatValue(row.cancelled, "count", language), exportValue: (row) => row.cancelled },
    { key: "returned", header: t("reports.colReturned"), align: "right", render: (row) => formatValue(row.returned, "count", language), exportValue: (row) => row.returned },
    ...(compare
      ? [
          { key: "prev_orders", header: `${t("reports.colPrevious")} · ${t("reports.colOrders")}`, align: "right" as const, render: (row: Point) => formatValue(row.prev_orders, "count", language), exportValue: (row: Point) => row.prev_orders },
          { key: "prev_revenue", header: `${t("reports.colPrevious")} · ${t("reports.colRevenue")}`, align: "right" as const, render: (row: Point) => formatValue(row.prev_revenue, "money", language), exportValue: (row: Point) => row.prev_revenue },
        ]
      : []),
  ];
  const trendTable = <DataTable rows={points} columns={trendColumns} rowKey={(row) => row.bucket} maxHeight={320} testId="reports-trend-table" />;
  const trendExport = { title: t("reports.orderTrend"), suffix, rows: points, columns: exportColumns(trendColumns) };

  const statusRows = (breakdowns?.status_distribution ?? []).map((row) => ({ key: row.status, label: legacyStatusName(t, row.status), count: row.count }));
  const statusTotal = statusRows.reduce((sum, row) => sum + row.count, 0);
  const statusColumns: TableColumn<(typeof statusRows)[number]>[] = [
    { key: "status", header: t("reports.colStatus"), render: (row) => row.label, exportValue: (row) => row.label },
    { key: "count", header: t("reports.colCount"), align: "right", render: (row) => formatValue(row.count, "count", language), exportValue: (row) => row.count },
    { key: "share", header: t("reports.colShare"), align: "right", render: (row) => formatValue(statusTotal ? (row.count / statusTotal) * 100 : 0, "percent", language), exportValue: (row) => (statusTotal ? Math.round((row.count / statusTotal) * 1000) / 10 : 0) },
  ];

  const cargoRows = breakdowns?.cargo_providers ?? [];
  const cargoColumns: TableColumn<(typeof cargoRows)[number]>[] = [
    { key: "provider", header: t("reports.colProvider"), render: (row) => <ProviderCell provider={row.provider} />, exportValue: (row) => t(`analytics.provider.${row.provider}`) },
    { key: "orders", header: t("reports.colOrders"), align: "right", render: (row) => formatValue(row.orders, "count", language), exportValue: (row) => row.orders },
    { key: "revenue", header: t("reports.colRevenue"), align: "right", render: (row) => formatValue(row.revenue, "money", language), exportValue: (row) => row.revenue },
    { key: "in_cargo", header: t("reports.colInCargo"), align: "right", render: (row) => formatValue(row.in_cargo, "count", language), exportValue: (row) => row.in_cargo },
    { key: "delivered", header: t("reports.colDelivered"), align: "right", render: (row) => formatValue(row.delivered, "count", language), exportValue: (row) => row.delivered },
    { key: "returned", header: t("reports.colReturned"), align: "right", render: (row) => formatValue(row.returned, "count", language), exportValue: (row) => row.returned },
    { key: "at_branch", header: t("reports.colAtBranch"), align: "right", render: (row) => formatValue(row.at_branch, "count", language), exportValue: (row) => row.at_branch },
    { key: "tracking_returns", header: t("reports.colTrackingReturns"), align: "right", render: (row) => formatValue(row.tracking_returns, "count", language), exportValue: (row) => row.tracking_returns },
  ];
  const m = breakdowns?.metrics;
  const legacyCargo = m
    ? [
        { key: "ptt", label: "PTT", brand: carrierBrand("ptt"), active: m.ptt, returns: m.ptt_kargo_iade },
        { key: "surat", label: "Sürat", brand: carrierBrand("surat"), active: m.surat, returns: m.surat_kargo_iade },
      ]
    : [];

  const personnel = breakdowns?.personnel ?? [];
  const personnelColumns: TableColumn<(typeof personnel)[number]>[] = [
    { key: "name", header: t("reports.colPersonnel"), render: (row) => row.name, exportValue: (row) => row.name },
    { key: "orders", header: t("reports.colOrders"), align: "right", render: (row) => formatValue(row.orders, "count", language), exportValue: (row) => row.orders },
    { key: "revenue", header: t("reports.colRevenue"), align: "right", render: (row) => formatValue(row.revenue, "money", language), exportValue: (row) => row.revenue },
    { key: "avg", header: t("reports.colAvgBasket"), align: "right", render: (row) => formatValue(row.avg_basket, "money", language), exportValue: (row) => row.avg_basket },
    { key: "confirmation", header: t("reports.colConfirmation"), align: "right", render: (row) => formatValue(row.confirmation_rate, "percent", language), exportValue: (row) => row.confirmation_rate },
    { key: "delivered", header: t("reports.colDelivered"), align: "right", render: (row) => formatValue(row.delivered, "count", language), exportValue: (row) => row.delivered },
    { key: "cancelled", header: t("reports.colCancelled"), align: "right", render: (row) => formatValue(row.cancelled, "count", language), exportValue: (row) => row.cancelled },
    { key: "returned", header: t("reports.colReturned"), align: "right", render: (row) => formatValue(row.returned, "count", language), exportValue: (row) => row.returned },
  ];

  return (
    <>
      <SectionTitle icon={BarChart3} title={t("reports.overview")} />
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          testId="reports-daily"
          title={t("reports.orderTrend")}
          description={t("reports.orderTrendDetail")}
          icon={TrendingUp}
          loading={!data}
          refreshing={refreshing}
          empty={points.every((point) => point.orders === 0 && point.prev_orders === 0)}
          height={280}
          table={trendTable}
          exportSpec={trendExport}
        >
          <TrendChart
            ariaLabel={t("reports.orderTrend")}
            data={points}
            granularity={granularity}
            valueKind="count"
            height={280}
            series={[{ key: "orders", name: t("reports.seriesOrders"), color: seriesColor(0), type: "area" }]}
            previousKey={compare ? "prev_orders" : undefined}
            previousName={t("charts.previousPeriod")}
          />
        </ChartCard>
        <ChartCard
          testId="reports-status"
          title={t("reports.orderStatus")}
          description={t("reports.orderStatusDetail")}
          icon={Filter}
          loading={!breakdowns}
          refreshing={refreshing}
          empty={statusRows.length === 0}
          height={280}
          table={<DataTable rows={statusRows} columns={statusColumns} rowKey={(row) => row.key} testId="reports-status-table" />}
          exportSpec={{ title: t("reports.orderStatus"), suffix, rows: statusRows, columns: exportColumns(statusColumns) }}
        >
          <CategoryBarChart ariaLabel={t("reports.orderStatus")} data={statusRows.map((row) => ({ key: row.key, label: row.label, count: row.count }))} series={[{ key: "count", name: t("reports.colCount"), color: seriesColor(0) }]} valueKind="count" showValues categoryWidth={118} />
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          testId="reports-revenue"
          title={t("reports.revenueTrend")}
          description={t("reports.revenueTrendDetail")}
          icon={Wallet}
          loading={!data}
          refreshing={refreshing}
          empty={points.every((point) => point.revenue === 0 && point.prev_revenue === 0)}
          height={260}
          table={trendTable}
          exportSpec={{ ...trendExport, title: t("reports.revenueTrend") }}
        >
          <TrendChart
            ariaLabel={t("reports.revenueTrend")}
            data={points}
            granularity={granularity}
            valueKind="money"
            height={260}
            series={[{ key: "revenue", name: t("reports.seriesRevenue"), color: seriesColor(0), type: "bar" }]}
            previousKey={compare ? "prev_revenue" : undefined}
            previousName={t("charts.previousPeriod")}
          />
        </ChartCard>
        <ChartCard
          testId="reports-cargo"
          title={t("reports.cargoProviderChart")}
          description={t("reports.cargoProviderDetail")}
          icon={Truck}
          loading={!breakdowns}
          refreshing={refreshing}
          empty={legacyCargo.every((row) => row.active === 0 && row.returns === 0)}
          height={180}
          table={<DataTable rows={cargoRows} columns={cargoColumns} rowKey={(row) => row.provider} testId="reports-cargo-table" />}
          exportSpec={{ title: t("reports.cargoProviderChart"), suffix, rows: cargoRows, columns: exportColumns(cargoColumns) }}
        >
          <CategoryBarChart
            ariaLabel={t("reports.cargoProviderChart")}
            data={legacyCargo}
            valueKind="count"
            categoryWidth={92}
            series={[
              { key: "active", name: t("reports.seriesActiveCargo"), color: seriesColor(1) },
              { key: "returns", name: t("reports.cargoReturns"), color: chartTokens.critical },
            ]}
          />
          <ul className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2" data-testid="reports-cargo-providers">
            {cargoRows.map((row) => (
              <li key={row.provider} className="flex flex-col gap-1 rounded-md bg-muted/50 px-3 py-2">
                <span className="flex items-center justify-between gap-2 text-sm font-medium">
                  <ProviderCell provider={row.provider} />
                  <span className="tabular-nums">{formatValue(row.orders, "count", language)}</span>
                </span>
                <span className="text-muted-foreground">
                  {t("reports.colDelivered")} {formatValue(row.delivered, "count", language)} · {t("reports.colInCargo")} {formatValue(row.in_cargo, "count", language)} · {t("reports.colAtBranch")} {formatValue(row.at_branch, "count", language)}
                </span>
              </li>
            ))}
          </ul>
        </ChartCard>
      </div>
      <ChartCard
        testId="reports-personnel-performance"
        title={t("reports.personnelPerformance")}
        description={t("reports.personnelPerformanceDetail")}
        icon={Users}
        loading={!breakdowns}
        refreshing={refreshing}
        empty={personnel.length === 0}
        height={200}
        table={<DataTable rows={personnel} columns={personnelColumns} rowKey={(row) => row.user_public_id} testId="reports-personnel-table" />}
        exportSpec={{ title: t("reports.personnelPerformance"), suffix, rows: personnel, columns: exportColumns(personnelColumns) }}
      >
        <CategoryBarChart
          ariaLabel={t("reports.personnelPerformance")}
          data={personnel.map((row) => ({ key: row.user_public_id, label: row.name, orders: row.orders, cancelled: row.cancelled }))}
          valueKind="count"
          categoryWidth={120}
          series={[
            { key: "orders", name: t("reports.seriesOrders"), color: seriesColor(1) },
            { key: "cancelled", name: t("analytics.status.iptal"), color: chartTokens.critical },
          ]}
        />
      </ChartCard>
    </>
  );
}

function ProviderCell({ provider }: { provider: string }) {
  const { t } = useTranslation();
  const brand = carrierBrand(provider);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2.5 rounded-[3px]" style={{ background: providerColor(provider) }} aria-hidden="true" />
      {brand && <BrandIcon brand={brand} title="" className="size-4" />}
      {t(`analytics.provider.${provider}` as "analytics.provider.ptt")}
    </span>
  );
}

function ChannelCell({ channel }: { channel: string }) {
  const { t } = useTranslation();
  const brand = channelBrand(channel);
  return (
    <span className="inline-flex items-center gap-1.5">
      {brand ? <BrandIcon brand={brand} title="" className="size-4" /> : <span className="size-2.5 rounded-[3px]" style={{ background: channelColor(channel) }} aria-hidden="true" />}
      {channelName(t, channel)}
    </span>
  );
}

function ChannelSection({ data, refreshing }: { data: BreakdownAnalytics | undefined; refreshing: boolean }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const channels = data?.channels ?? [];
  const conversion = data?.conversion;
  const suffix = data ? `${data.range.from}_${data.range.to}` : "";
  const channelColumns: TableColumn<(typeof channels)[number]>[] = [
    { key: "channel", header: t("reports.colChannel"), render: (row) => <ChannelCell channel={row.channel} />, exportValue: (row) => channelName(t, row.channel) },
    { key: "orders", header: t("reports.colOrders"), align: "right", render: (row) => formatValue(row.orders, "count", language), exportValue: (row) => row.orders },
    { key: "revenue", header: t("reports.colRevenue"), align: "right", render: (row) => formatValue(row.revenue, "money", language), exportValue: (row) => row.revenue },
    { key: "cancelled", header: t("reports.colCancelled"), align: "right", render: (row) => formatValue(row.cancelled, "count", language), exportValue: (row) => row.cancelled },
  ];
  const conversionRows = conversion?.by_channel ?? [];
  const conversionColumns: TableColumn<(typeof conversionRows)[number]>[] = [
    { key: "channel", header: t("reports.colChannel"), render: (row) => <ChannelCell channel={row.channel} />, exportValue: (row) => channelName(t, row.channel) },
    { key: "conversations", header: t("reports.colConversations"), align: "right", render: (row) => formatValue(row.conversations, "count", language), exportValue: (row) => row.conversations },
    { key: "converted", header: t("reports.colConverted"), align: "right", render: (row) => formatValue(row.converted, "count", language), exportValue: (row) => row.converted },
    { key: "orders", header: t("reports.colOrders"), align: "right", render: (row) => formatValue(row.orders, "count", language), exportValue: (row) => row.orders },
    { key: "rate", header: t("reports.colConversion"), align: "right", render: (row) => formatValue(row.rate, "percent", language), exportValue: (row) => row.rate },
  ];
  return (
    <>
      <SectionTitle icon={MessageCircle} title={t("reports.channelsTitle")} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          testId="reports-channels"
          title={t("reports.channelsTitle")}
          description={t("reports.channelsDetail")}
          icon={Filter}
          loading={!data}
          refreshing={refreshing}
          empty={channels.length === 0}
          height={200}
          table={<DataTable rows={channels} columns={channelColumns} rowKey={(row) => row.channel} testId="reports-channels-table" />}
          exportSpec={{ title: t("reports.channelsTitle"), suffix, rows: channels, columns: exportColumns(channelColumns) }}
        >
          <DonutChart
            ariaLabel={t("reports.channelsTitle")}
            valueKind="count"
            centerLabel={t("dashboard.channelsCenter")}
            data={channels.map((row) => ({ key: row.channel, label: channelName(t, row.channel), value: row.orders, color: channelColor(row.channel), brand: channelBrand(row.channel) }))}
          />
        </ChartCard>
        <ChartCard
          testId="reports-conversion"
          title={t("reports.conversionTitle")}
          description={t("reports.conversionDetail")}
          info={t("reports.conversionInfo")}
          icon={Repeat}
          loading={!data}
          refreshing={refreshing}
          empty={!conversion || conversion.conversations === 0}
          height={200}
          table={<DataTable rows={conversionRows} columns={conversionColumns} rowKey={(row) => row.channel} testId="reports-conversion-table" />}
          exportSpec={{ title: t("reports.conversionTitle"), suffix, rows: conversionRows, columns: exportColumns(conversionColumns) }}
        >
          {conversion && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <MiniStat label={t("reports.colConversations")} value={formatValue(conversion.conversations, "count", language)} />
                <MiniStat label={t("reports.colConverted")} value={formatValue(conversion.converted, "count", language)} />
                <MiniStat label={t("reports.conversionRate")} value={formatValue(conversion.rate, "percent", language)} testId="reports-conversion-rate" />
              </div>
              <CategoryBarChart
                ariaLabel={t("reports.conversionTitle")}
                data={conversionRows.map((row) => ({ key: row.channel, label: channelName(t, row.channel), brand: channelBrand(row.channel), color: channelColor(row.channel), rate: row.rate }))}
                series={[{ key: "rate", name: t("reports.conversionRate"), color: seriesColor(0) }]}
                valueKind="percent"
                showValues
              />
            </div>
          )}
        </ChartCard>
      </div>
      <ChartCard testId="reports-funnel" title={t("reports.funnelTitle")} description={t("dashboard.funnelDescription")} icon={BarChart3} loading={!data} refreshing={refreshing} empty={(data?.funnel[0]?.count ?? 0) === 0} height={180}>
        <Funnel testId="reports-funnel-steps" steps={(data?.funnel ?? []).map((step) => ({ key: step.key, label: t(`analytics.funnel.${step.key}`), value: step.count }))} />
      </ChartCard>
    </>
  );
}

function MiniStat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="rounded-lg bg-muted/50 px-2 py-2">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className="text-base font-semibold sm:text-lg" data-testid={testId}>
        {value}
      </p>
    </div>
  );
}

function GeoProductSection({ data, refreshing }: { data: BreakdownAnalytics | undefined; refreshing: boolean }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const suffix = data ? `${data.range.from}_${data.range.to}` : "";
  const cities = data?.cities ?? [];
  const cityColumns: TableColumn<(typeof cities)[number]>[] = [
    { key: "city", header: t("reports.colCity"), render: (row) => row.city, exportValue: (row) => row.city },
    { key: "orders", header: t("reports.colOrders"), align: "right", render: (row) => formatValue(row.orders, "count", language), exportValue: (row) => row.orders },
    { key: "revenue", header: t("reports.colRevenue"), align: "right", render: (row) => formatValue(row.revenue, "money", language), exportValue: (row) => row.revenue },
    { key: "customers", header: t("reports.colCustomers"), align: "right", render: (row) => formatValue(row.customers, "count", language), exportValue: (row) => row.customers },
    { key: "cancelled", header: t("reports.colCancelled"), align: "right", render: (row) => formatValue(row.cancelled, "count", language), exportValue: (row) => row.cancelled },
    { key: "returned", header: t("reports.colReturned"), align: "right", render: (row) => formatValue(row.returned, "count", language), exportValue: (row) => row.returned },
  ];
  const products = data?.products ?? [];
  const productColumns: TableColumn<(typeof products)[number]>[] = [
    { key: "name", header: t("reports.colProduct"), render: (row) => <span className="block max-w-64 truncate">{row.name}</span>, exportValue: (row) => row.name },
    { key: "category", header: t("reports.colCategory"), render: (row) => categoryLabel(t, row.category), exportValue: (row) => categoryLabel(t, row.category) },
    { key: "quantity", header: t("reports.colQuantity"), align: "right", render: (row) => formatValue(row.quantity, "count", language), exportValue: (row) => row.quantity },
    { key: "orders", header: t("reports.colOrders"), align: "right", render: (row) => formatValue(row.orders, "count", language), exportValue: (row) => row.orders },
    { key: "revenue", header: t("reports.colRevenue"), align: "right", render: (row) => formatValue(row.revenue, "money", language), exportValue: (row) => row.revenue },
  ];
  const categories = data?.categories ?? [];
  return (
    <>
      <SectionTitle icon={MapPin} title={`${t("reports.citiesTitle")} · ${t("reports.productsTitle")}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          testId="reports-cities"
          title={t("reports.citiesTitle")}
          description={t("reports.citiesDetail")}
          icon={MapPin}
          loading={!data}
          refreshing={refreshing}
          empty={cities.length === 0}
          height={340}
          table={<DataTable rows={cities} columns={cityColumns} rowKey={(row) => row.city} maxHeight={360} testId="reports-cities-table" />}
          exportSpec={{ title: t("reports.citiesTitle"), suffix, rows: cities, columns: exportColumns(cityColumns) }}
        >
          <CategoryBarChart ariaLabel={t("reports.citiesTitle")} data={cities.slice(0, 10).map((row) => ({ key: row.city, label: row.city, orders: row.orders }))} series={[{ key: "orders", name: t("reports.colOrders"), color: seriesColor(0) }]} valueKind="count" showValues categoryWidth={110} />
        </ChartCard>
        <ChartCard
          testId="reports-products"
          title={t("reports.productsTitle")}
          description={t("reports.productsDetail")}
          icon={ShoppingBag}
          loading={!data}
          refreshing={refreshing}
          empty={products.length === 0}
          height={340}
          table={<DataTable rows={products} columns={productColumns} rowKey={(row, index) => `${row.product_public_id ?? row.name}-${index}`} maxHeight={360} testId="reports-products-table" />}
          exportSpec={{ title: t("reports.productsTitle"), suffix, rows: products, columns: exportColumns(productColumns) }}
          footer={
            categories.length > 0 && (
              <span className="flex flex-wrap gap-x-3 gap-y-1" data-testid="reports-categories">
                <span className="font-medium text-foreground">{t("reports.categoriesTitle")}:</span>
                {categories.map((row, index) => (
                  <span key={row.category || index} className="inline-flex items-center gap-1">
                    <span className="size-2.5 rounded-[3px]" style={{ background: seriesColor(index) }} aria-hidden="true" />
                    {categoryLabel(t, row.category)} · {formatValue(row.revenue, "money", language)}
                  </span>
                ))}
              </span>
            )
          }
        >
          <CategoryBarChart ariaLabel={t("reports.productsTitle")} data={products.slice(0, 8).map((row, index) => ({ key: `${row.product_public_id ?? row.name}-${index}`, label: row.name, revenue: row.revenue }))} series={[{ key: "revenue", name: t("reports.colRevenue"), color: seriesColor(0) }]} valueKind="money" showValues categoryWidth={160} />
        </ChartCard>
      </div>
    </>
  );
}

function BehaviourSection({ data, refreshing }: { data: BreakdownAnalytics | undefined; refreshing: boolean }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const [heatKind, setHeatKind] = useState<"orders" | "messages">("orders");
  const suffix = data ? `${data.range.from}_${data.range.to}` : "";
  const weekdays = t("charts.weekdaysShort").split(",");
  const heatRows = (data?.heatmap ?? []).filter((cell) => cell.orders > 0 || cell.messages > 0);
  const heatColumns: TableColumn<(typeof heatRows)[number]>[] = [
    { key: "weekday", header: t("reports.colWeekday"), render: (row) => weekdays[row.weekday] ?? "", exportValue: (row) => weekdays[row.weekday] ?? "" },
    { key: "hour", header: t("reports.colHour"), render: (row) => `${String(row.hour).padStart(2, "0")}:00`, exportValue: (row) => `${String(row.hour).padStart(2, "0")}:00` },
    { key: "orders", header: t("reports.colOrders"), align: "right", render: (row) => formatValue(row.orders, "count", language), exportValue: (row) => row.orders },
    { key: "messages", header: t("reports.colMessages"), align: "right", render: (row) => formatValue(row.messages, "count", language), exportValue: (row) => row.messages },
  ];
  const customers = data?.customers;
  const cohorts = customers?.cohorts ?? [];
  const cohortColumns: TableColumn<(typeof cohorts)[number]>[] = [
    { key: "cohort", header: t("reports.colCohort"), render: (row) => formatBucket(`${row.cohort}-01`, "month", language), exportValue: (row) => row.cohort },
    { key: "customers", header: t("reports.colCustomers"), align: "right", render: (row) => formatValue(row.customers, "count", language), exportValue: (row) => row.customers },
    ...[1, 2, 3, 4, 5].map((offset) => ({
      key: `m${offset}`,
      header: t("reports.colMonth", { n: offset }),
      align: "right" as const,
      render: (row: (typeof cohorts)[number]) => {
        const value = row.retention[offset] ?? 0;
        const share = row.customers ? (value / row.customers) * 100 : 0;
        return (
          <span className="inline-block min-w-14 rounded px-1.5 py-0.5" style={{ background: value ? `color-mix(in oklab, var(--chart-seq) ${Math.round(12 + Math.min(1, share / 40) * 60)}%, var(--card))` : undefined }}>
            {value ? `${formatValue(value, "count", language)} · ${formatValue(share, "percent", language)}` : "—"}
          </span>
        );
      },
      exportValue: (row: (typeof cohorts)[number]) => row.retention[offset] ?? 0,
    })),
  ];
  return (
    <>
      <SectionTitle icon={Users} title={t("reports.customersTitle")} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          testId="reports-heatmap"
          title={t("reports.heatmapTitle")}
          description={t("reports.heatmapDetail")}
          icon={Grid3x3}
          loading={!data}
          refreshing={refreshing}
          empty={heatRows.length === 0}
          height={240}
          actions={
            <ToggleGroup type="single" value={heatKind} onValueChange={(value) => value && setHeatKind(value as "orders" | "messages")} className="rounded-md border p-0.5" aria-label={t("reports.heatmapTitle")}>
              <ToggleGroupItem value="orders" className="min-h-11 min-w-11 px-2 text-xs lg:min-h-7 lg:min-w-0" data-testid="reports-heatmap-orders">
                {t("reports.heatmapOrders")}
              </ToggleGroupItem>
              <ToggleGroupItem value="messages" className="min-h-11 min-w-11 px-2 text-xs lg:min-h-7 lg:min-w-0" data-testid="reports-heatmap-messages">
                {t("reports.heatmapMessages")}
              </ToggleGroupItem>
            </ToggleGroup>
          }
          table={<DataTable rows={heatRows} columns={heatColumns} rowKey={(row) => `${row.weekday}-${row.hour}`} maxHeight={300} testId="reports-heatmap-table" />}
          exportSpec={{ title: t("reports.heatmapTitle"), suffix, rows: heatRows, columns: exportColumns(heatColumns) }}
        >
          <Heatmap testId="reports-heatmap-grid" unitLabel={heatKind === "orders" ? t("reports.heatUnitOrders") : t("reports.heatUnitMessages")} cells={(data?.heatmap ?? []).map((cell) => ({ weekday: cell.weekday, hour: cell.hour, value: heatKind === "orders" ? cell.orders : cell.messages }))} />
        </ChartCard>
        <ChartCard testId="reports-customers" title={t("reports.customersTitle")} description={t("reports.customersDetail")} icon={Repeat} loading={!data} refreshing={refreshing} empty={!customers || customers.customers_with_orders === 0} height={240}>
          {customers && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <MiniStat label={t("reports.customersWithOrders")} value={formatValue(customers.customers_with_orders, "count", language)} />
                <MiniStat label={t("reports.newCustomers")} value={formatValue(customers.new_customers, "count", language)} />
                <MiniStat label={t("reports.returningCustomers")} value={formatValue(customers.returning_customers, "count", language)} />
                <MiniStat label={t("reports.repeatRate")} value={formatValue(customers.repeat_rate, "percent", language)} testId="reports-repeat-rate" />
                <MiniStat label={t("reports.avgOrdersPerCustomer")} value={formatValue(customers.avg_orders_per_customer, "decimal", language)} />
              </div>
              <div>
                <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  {t("reports.distributionTitle")}
                  <InfoHint text={t("reports.repeatRateInfo")} />
                </p>
                <CategoryBarChart
                  ariaLabel={t("reports.distributionTitle")}
                  data={customers.distribution.map((row) => ({ key: row.bucket, label: t("reports.distributionBucket", { bucket: row.bucket }), customers: row.customers }))}
                  series={[{ key: "customers", name: t("reports.colCustomers"), color: seriesColor(1) }]}
                  valueKind="count"
                  showValues
                  categoryWidth={84}
                />
              </div>
            </div>
          )}
        </ChartCard>
      </div>
      <ChartCard
        testId="reports-cohorts"
        title={t("reports.cohortTitle")}
        description={t("reports.cohortDetail")}
        icon={Users}
        loading={!data}
        refreshing={refreshing}
        empty={cohorts.length === 0}
        height={160}
        exportSpec={{ title: t("reports.cohortTitle"), suffix, rows: cohorts, columns: exportColumns(cohortColumns) }}
      >
        <DataTable rows={cohorts} columns={cohortColumns} rowKey={(row) => row.cohort} testId="reports-cohort-table" />
      </ChartCard>
    </>
  );
}

function OperationsSection({ data, refreshing }: { data: BreakdownAnalytics | undefined; refreshing: boolean }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const suffix = data ? `${data.range.from}_${data.range.to}` : "";
  const confirmation = data?.confirmation;
  const confirmationRows = [
    ...(confirmation?.call_statuses ?? []).map((row) => ({ key: `call-${row.status}`, type: t("reports.callStatuses"), label: callStatusName(t, row.status), count: row.count })),
    ...(confirmation?.outcomes ?? []).map((row) => ({ key: `outcome-${row.outcome}`, type: t("reports.outcomes"), label: outcomeName(t, row.outcome), count: row.count })),
  ];
  const confirmationColumns: TableColumn<(typeof confirmationRows)[number]>[] = [
    { key: "type", header: t("reports.colType"), render: (row) => row.type, exportValue: (row) => row.type },
    { key: "label", header: t("reports.colOutcome"), render: (row) => row.label, exportValue: (row) => row.label },
    { key: "count", header: t("reports.colCount"), align: "right", render: (row) => formatValue(row.count, "count", language), exportValue: (row) => row.count },
  ];
  const reasons = data?.cancellation_reasons ?? [];
  const reasonColumns: TableColumn<(typeof reasons)[number]>[] = [
    { key: "reason", header: t("reports.colReason"), render: (row) => <span className="block max-w-72 truncate">{reasonName(t, row.reason)}</span>, exportValue: (row) => reasonName(t, row.reason) },
    { key: "status", header: t("reports.colType"), render: (row) => legacyStatusName(t, row.status), exportValue: (row) => legacyStatusName(t, row.status) },
    { key: "count", header: t("reports.colCount"), align: "right", render: (row) => formatValue(row.count, "count", language), exportValue: (row) => row.count },
  ];
  const reasonData = useMemo(() => {
    const merged = new Map<string, { key: string; label: string; iptal: number; iade: number }>();
    for (const row of reasons) {
      const key = row.reason || "__unspecified";
      const entry = merged.get(key) ?? { key, label: reasonName(t, row.reason), iptal: 0, iade: 0 };
      entry[row.status] += row.count;
      merged.set(key, entry);
    }
    return [...merged.values()].sort((first, second) => second.iptal + second.iade - (first.iptal + first.iade)).slice(0, 10);
  }, [reasons, t]);

  return (
    <>
      <SectionTitle icon={PhoneCall} title={`${t("reports.confirmationTitle")} · ${t("reports.reasonsTitle")}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          testId="reports-confirmation"
          title={t("reports.confirmationTitle")}
          description={t("reports.confirmationDetail")}
          icon={PhoneCall}
          loading={!data}
          refreshing={refreshing}
          empty={confirmationRows.length === 0}
          height={240}
          table={<DataTable rows={confirmationRows} columns={confirmationColumns} rowKey={(row) => row.key} testId="reports-confirmation-table" />}
          exportSpec={{ title: t("reports.confirmationTitle"), suffix, rows: confirmationRows, columns: exportColumns(confirmationColumns) }}
        >
          {confirmation && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <MiniStat label={t("reports.totalCalls")} value={formatValue(confirmation.total_calls, "count", language)} />
                <MiniStat label={t("reports.calledOrders")} value={formatValue(confirmation.called_orders, "count", language)} />
                <MiniStat label={t("reports.avgListen")} value={formatValue(confirmation.avg_listen_seconds, "seconds", language)} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{t("reports.callStatuses")}</p>
                  <CategoryBarChart ariaLabel={t("reports.callStatuses")} data={confirmation.call_statuses.map((row) => ({ key: row.status, label: callStatusName(t, row.status), count: row.count }))} series={[{ key: "count", name: t("reports.colCount"), color: seriesColor(1) }]} valueKind="count" showValues categoryWidth={96} />
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">{t("reports.outcomes")}</p>
                  <CategoryBarChart ariaLabel={t("reports.outcomes")} data={confirmation.outcomes.map((row) => ({ key: row.outcome, label: outcomeName(t, row.outcome), count: row.count }))} series={[{ key: "count", name: t("reports.colCount"), color: seriesColor(0) }]} valueKind="count" showValues categoryWidth={96} />
                </div>
              </div>
            </div>
          )}
        </ChartCard>
        <ChartCard
          testId="reports-reasons"
          title={t("reports.reasonsTitle")}
          description={t("reports.reasonsDetail")}
          icon={PackageX}
          loading={!data}
          refreshing={refreshing}
          empty={reasons.length === 0}
          height={240}
          table={<DataTable rows={reasons} columns={reasonColumns} rowKey={(row, index) => `${row.status}-${row.reason}-${index}`} testId="reports-reasons-table" />}
          exportSpec={{ title: t("reports.reasonsTitle"), suffix, rows: reasons, columns: exportColumns(reasonColumns) }}
        >
          <CategoryBarChart
            ariaLabel={t("reports.reasonsTitle")}
            data={reasonData}
            valueKind="count"
            categoryWidth={150}
            series={[
              { key: "iptal", name: t("analytics.status.iptal"), color: chartTokens.critical, stack: "r" },
              { key: "iade", name: t("analytics.status.iade"), color: chartTokens.serious, stack: "r" },
            ]}
          />
        </ChartCard>
      </div>
    </>
  );
}

function InvoiceSection({ data, loading, error, onRetry, granularity }: { data: InvoiceAnalytics | undefined; loading: boolean; error: boolean; onRetry: () => void; granularity: "day" | "week" | "month" }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const money = (value: number) => formatValue(value, "money", language);
  const n = (value: number) => formatValue(value, "count", language);
  const daily = useMemo(() => rebucket(data?.daily ?? [], granularity, ["sale", "sale_return", "count"]), [data, granularity]);
  const suffix = data ? `${data.range.from}_${data.range.to}` : "";
  const columns: TableColumn<(typeof daily)[number]>[] = [
    { key: "date", header: t("reports.colDate"), render: (row) => formatBucket(row.bucket, granularity, language, true), exportValue: (row) => row.bucket },
    { key: "sale", header: t("reports.colSale"), align: "right", render: (row) => money(row.sale), exportValue: (row) => row.sale },
    { key: "sale_return", header: t("reports.colSaleReturn"), align: "right", render: (row) => money(row.sale_return), exportValue: (row) => row.sale_return },
    { key: "count", header: t("reports.colInvoiceCount"), align: "right", render: (row) => n(row.count), exportValue: (row) => row.count },
  ];
  const points = daily.map((row) => ({ bucket: row.date, sale: row.sale, sale_return: row.sale_return }));
  const table = <DataTable rows={daily.filter((row) => row.count > 0)} columns={columns} rowKey={(row) => row.date} maxHeight={320} testId="reports-invoices-table" />;
  const exportSpec = { title: t("reports.invoicesTitle"), suffix, rows: daily, columns: exportColumns(columns) };
  const card = (key: string, label: string, value: string, icon: LucideIcon, tone?: "good" | "bad" | "warn") => <StatCard key={key} testId={`reports-invoice-${key}`} label={label} value={data ? value : "…"} icon={icon} {...(tone ? { tone } : {})} />;

  return (
    <div className="flex flex-col gap-4 border-t pt-5" data-testid="reports-invoices">
      <SectionTitle icon={Receipt} title={t("reports.invoicesTitle")} description={t("reports.invoicesDetail")} />
      {error && !data ? (
        <ErrorState onRetry={onRetry} />
      ) : (
        <div className={cn("flex flex-col gap-4 transition-opacity", loading && data && "opacity-60")}>
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-100" data-testid="reports-invoice-note">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t("reports.purchaseNote")}
          </p>
          <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <FileText className="size-3.5" aria-hidden="true" />
            {t("reports.salesInvoices")}
          </h3>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {card("sale-count", t("reports.saleInvoiceCount"), n(data?.sale.count ?? 0), FileText)}
            {card("sale-total", t("reports.saleTotal"), money(data?.sale.total ?? 0), Wallet, "good")}
            {card("sale-paid", t("reports.collected"), money(data?.sale.paid ?? 0), CheckCircle, "good")}
            {card("sale-remaining", t("reports.receivable"), money(data?.sale.remaining ?? 0), Clock, "warn")}
            {card("sale-vat", t("reports.saleVat"), money(data?.sale.vat ?? 0), Percent)}
          </div>
          <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <RotateCcw className="size-3.5" aria-hidden="true" />
            {t("reports.returnInvoices")}
          </h3>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {card("return-count", t("reports.returnInvoiceCount"), n(data?.sale_return.count ?? 0), FileText)}
            {card("return-total", t("reports.returnTotal"), money(data?.sale_return.total ?? 0), RotateCcw, "bad")}
            {card("return-paid", t("reports.refunded"), money(data?.sale_return.paid ?? 0), CheckCircle)}
            {card("return-remaining", t("reports.returnRemaining"), money(data?.sale_return.remaining ?? 0), Clock, "warn")}
            {card("return-vat", t("reports.returnVat"), money(data?.sale_return.vat ?? 0), Percent)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {card("total-count", t("reports.totalInvoiceCount"), n((data?.sale.count ?? 0) + (data?.sale_return.count ?? 0)), Receipt)}
            {card("net-vat", t("reports.netVat"), money(data?.net_vat ?? 0), Percent)}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <InvoiceTrend testId="reports-invoice-sales" title={t("reports.dailySales")} description={t("reports.dailySalesDetail")} loading={!data} points={points} seriesKey="sale" color={seriesColor(0)} table={table} exportSpec={exportSpec} granularity={granularity} />
            <InvoiceTrend testId="reports-invoice-returns" title={t("reports.dailyReturns")} description={t("reports.dailyReturnsDetail")} loading={!data} points={points} seriesKey="sale_return" color={seriesColor(1)} table={table} exportSpec={exportSpec} granularity={granularity} />
          </div>
          <ChartCard testId="reports-invoice-compare" title={t("reports.salesVsReturns")} description={t("reports.salesVsReturnsDetail")} icon={BarChart3} loading={!data} empty={points.every((point) => point.sale === 0 && point.sale_return === 0)} height={260} table={table} exportSpec={exportSpec}>
            <TrendChart
              ariaLabel={t("reports.salesVsReturns")}
              data={points}
              granularity={granularity}
              valueKind="money"
              height={260}
              series={[
                { key: "sale", name: t("reports.colSale"), color: seriesColor(0), type: "bar" },
                { key: "sale_return", name: t("reports.colSaleReturn"), color: seriesColor(1), type: "bar" },
              ]}
            />
          </ChartCard>
        </div>
      )}
    </div>
  );
}

function InvoiceTrend(props: { testId: string; title: string; description: string; loading: boolean; points: Array<{ bucket: string; sale: number; sale_return: number }>; seriesKey: "sale" | "sale_return"; color: string; table: ReactNode; exportSpec: { title: string; suffix: string; rows: readonly unknown[]; columns: ReadonlyArray<{ header: string; value: (row: never) => string | number | null | undefined }> }; granularity: "day" | "week" | "month" }) {
  const empty = props.points.every((point) => point[props.seriesKey] === 0);
  const kind: ValueKind = "money";
  return (
    <ChartCard testId={props.testId} title={props.title} description={props.description} icon={Receipt} loading={props.loading} empty={empty} height={240} table={props.table} exportSpec={props.exportSpec as never}>
      <TrendChart ariaLabel={props.title} data={props.points} granularity={props.granularity} valueKind={kind} height={240} series={[{ key: props.seriesKey, name: props.title, color: props.color, type: "area" }]} />
    </ChartCard>
  );
}
