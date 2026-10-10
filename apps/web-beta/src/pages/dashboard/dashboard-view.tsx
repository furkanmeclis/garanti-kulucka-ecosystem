import type { AnalyticsKpi, AnalyticsKpiKey, DashboardAnalytics } from "@garanti-kulucka/shared";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock,
  Filter,
  MessageCircle,
  Package,
  PackageCheck,
  PackageX,
  Percent,
  RefreshCw,
  Search,
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  Truck,
  UserPlus,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/app/auth";
import { BrandIcon } from "@/components/brand-icons";
import {
  CategoryBarChart,
  ChartCard,
  DataTable,
  DonutChart,
  Funnel,
  KpiTile,
  TrendChart,
  channelColor,
  chartTokens,
  exportColumns,
  formatDay,
  formatRelative,
  formatValue,
  providerColor,
  seriesColor,
  type TableColumn,
} from "@/components/charts";
import { ErrorState, StatusBadge } from "@/components/data-list";
import { carrierBrand, channelBrand } from "@/components/provider-label";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageHeader } from "@/layout/page-header";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { dashboardPresets, parseDashboardPreset, presetRange, type DashboardPreset } from "../reports/filters";
import { TodoCard } from "./todo-card";

const kpiIcons: Record<AnalyticsKpiKey, LucideIcon> = {
  revenue: Wallet,
  orders: ShoppingCart,
  avg_basket: ShoppingBag,
  confirmation_rate: Percent,
  in_cargo: Truck,
  delivered: PackageCheck,
  cancel_rate: PackageX,
  return_rate: PackageX,
  new_customers: UserPlus,
  conversations: MessageCircle,
  messages_in: MessageCircle,
  unread_messages: MessageCircle,
};

const presetLabelKey: Record<DashboardPreset, string> = {
  last7: "datePicker.last7",
  last30: "datePicker.last30",
  last90: "reports.presetLast90",
  thisMonth: "datePicker.thisMonth",
};

function SnapshotTile({ label, value, icon: Icon, info, to, hint, testId }: { label: string; value: number | null; icon: LucideIcon; info: string; to?: string; hint?: string; testId: string }) {
  const { i18n } = useTranslation();
  const body = (
    <Card className={cn("flex h-full items-center gap-3 p-3 sm:p-4", to && "transition-colors hover:border-primary/40")} data-testid={testId} title={info}>
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-xs text-muted-foreground sm:text-sm">{label}</span>
        <span className="text-lg font-semibold sm:text-xl" data-testid={`${testId}-value`}>
          {value === null ? "—" : formatValue(value, "count", i18n.language)}
        </span>
        {hint && <span className="truncate text-[11px] text-muted-foreground">{hint}</span>}
      </span>
    </Card>
  );
  return to ? (
    <Link to={to} className="block min-w-0 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      {body}
    </Link>
  ) : (
    body
  );
}

function AttentionRow({ icon: Icon, label, count, to, tone, testId }: { icon: LucideIcon; label: string; count: number | null; to: string; tone: "warning" | "critical" | "info"; testId: string }) {
  const { i18n } = useTranslation();
  if (count === null) return null;
  return (
    <Link to={to} className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50" data-testid={testId}>
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-md",
          count === 0 ? "bg-muted text-muted-foreground" : tone === "critical" ? "bg-destructive/10 text-destructive" : tone === "warning" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-primary/10 text-primary",
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      <span className={cn("text-base font-semibold tabular-nums", count === 0 && "text-muted-foreground")} data-testid={`${testId}-count`}>
        {formatValue(count, "count", i18n.language)}
      </span>
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-20" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-36" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-80 lg:col-span-2" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

export { DashboardSkeleton };

/** Pano: KPI tiles with sparklines and deltas, trends, channel/carrier/funnel breakdowns, products, staff and the work lists. */
export function DashboardView() {
  const { t, i18n } = useTranslation();
  const { api, user } = useAuth();
  const [params, setParams] = useSearchParams();
  const preset = parseDashboardPreset(params);
  const range = presetRange(preset);
  const [metric, setMetric] = useState<"revenue" | "orders">("revenue");
  const query = useQuery(`dashboard:${user?.public_id}:${range.from}:${range.to}`, () => api.dashboardAnalytics({ from: range.from, to: range.to }));
  const data = query.data;
  const language = i18n.language;

  const setPreset = (next: string) => {
    if (!next) return;
    const updated = new URLSearchParams(params);
    if (next === "last30") updated.delete("range");
    else updated.set("range", next);
    setParams(updated, { replace: true });
  };

  return (
    <section data-testid="page-dashboard">
      <PageHeader
        title={t("dashboard.title")}
        description={user?.first_name ? t("dashboard.welcome", { name: user.first_name }) : t("dashboard.welcomeAnonymous")}
        actions={
          <>
            <ToggleGroup type="single" value={preset} onValueChange={setPreset} aria-label={t("dashboard.range")} className="rounded-lg border p-0.5" data-testid="dashboard-range">
              {dashboardPresets.map((key) => (
                <ToggleGroupItem key={key} value={key} className="min-h-11 px-2.5 text-xs sm:text-sm lg:min-h-8" data-testid={`dashboard-range-${key}`}>
                  {t(presetLabelKey[key] as "datePicker.last7")}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Button variant="outline" size="icon" className="lg:size-9" onClick={query.reload} aria-label={t("common.refresh")} data-testid="dashboard-refresh">
              <RefreshCw className={cn("size-4", query.loading && "animate-spin")} aria-hidden="true" />
            </Button>
          </>
        }
      />
      {query.error && !data ? (
        <ErrorState onRetry={query.reload} />
      ) : !data ? (
        <DashboardSkeleton />
      ) : (
        <DashboardBody data={data} metric={metric} setMetric={setMetric} refreshing={query.loading} language={language} userKey={user?.public_id ?? "me"} />
      )}
    </section>
  );
}

function DashboardBody({ data, metric, setMetric, refreshing, language, userKey }: { data: DashboardAnalytics; metric: "revenue" | "orders"; setMetric: (value: "revenue" | "orders") => void; refreshing: boolean; language: string; userKey: string }) {
  const { t } = useTranslation();
  const kpi = (key: AnalyticsKpiKey) => data.kpis.find((item) => item.key === key);
  const granularity = data.range.granularity;
  const managers = data.personnel !== null;

  const trendData = useMemo(
    () =>
      data.timeseries.map((bucket, index) => {
        const previous = data.previous_timeseries[index];
        return {
          bucket: bucket.bucket,
          previousBucket: previous?.bucket,
          revenue: bucket.revenue,
          orders: bucket.orders,
          prev_revenue: previous?.revenue ?? 0,
          prev_orders: previous?.orders ?? 0,
        };
      }),
    [data],
  );

  const channelSlices = data.channels.map((row) => ({
    key: row.channel,
    label: t(`analytics.channel.${row.channel}` as "analytics.channel.whatsapp"),
    value: row.orders,
    color: channelColor(row.channel),
    brand: channelBrand(row.channel),
  }));

  const cargoData = data.cargo_providers.map((row) => ({
    key: row.provider,
    label: t(`analytics.provider.${row.provider}` as "analytics.provider.ptt"),
    brand: carrierBrand(row.provider),
    delivered: row.delivered,
    in_cargo: row.in_cargo,
    returned: row.returned,
  }));

  const kpiTile = (key: AnalyticsKpiKey, options: { goodWhen?: "up" | "down"; hint?: string; to?: string } = {}) => {
    const item: AnalyticsKpi | undefined = kpi(key);
    if (!item) return null;
    return (
      <KpiTile
        key={key}
        testId={`kpi-${key}`}
        label={t(`analytics.kpi.${key}` as "analytics.kpi.revenue")}
        info={t(`analytics.kpiInfo.${key}` as "analytics.kpiInfo.revenue")}
        value={item.value}
        kind={item.unit === "percent" ? "percent" : item.unit === "money" ? "money" : "count"}
        icon={kpiIcons[key]}
        changePct={item.change_pct}
        previous={item.previous}
        series={item.series}
        {...(options.goodWhen ? { goodWhen: options.goodWhen } : {})}
        {...(options.hint ? { hint: options.hint } : {})}
        {...(options.to ? { to: options.to } : {})}
      />
    );
  };

  const productColumns: TableColumn<DashboardAnalytics["top_products"][number]>[] = [
    { key: "name", header: t("reports.colProduct"), render: (row) => <span className="block max-w-56 truncate">{row.name}</span>, exportValue: (row) => row.name },
    { key: "quantity", header: t("reports.colQuantity"), align: "right", render: (row) => formatValue(row.quantity, "count", language), exportValue: (row) => row.quantity },
    { key: "revenue", header: t("reports.colRevenue"), align: "right", render: (row) => formatValue(row.revenue, "money", language), exportValue: (row) => row.revenue },
  ];
  const personnelColumns: TableColumn<NonNullable<DashboardAnalytics["personnel"]>[number]>[] = [
    { key: "name", header: t("reports.colPersonnel"), render: (row) => row.name, exportValue: (row) => row.name },
    { key: "orders", header: t("reports.colOrders"), align: "right", render: (row) => formatValue(row.orders, "count", language), exportValue: (row) => row.orders },
    { key: "revenue", header: t("reports.colRevenue"), align: "right", render: (row) => formatValue(row.revenue, "money", language), exportValue: (row) => row.revenue },
    { key: "confirmation", header: t("reports.colConfirmation"), align: "right", render: (row) => formatValue(row.confirmation_rate, "percent", language), exportValue: (row) => row.confirmation_rate },
    { key: "cancelled", header: t("reports.colCancelled"), align: "right", render: (row) => formatValue(row.cancelled, "count", language), exportValue: (row) => row.cancelled },
  ];
  const suffix = `${data.range.from}_${data.range.to}`;
  const unread = data.snapshot.unread_conversations;

  return (
    <div className={cn("flex flex-col gap-4 transition-opacity sm:gap-5", refreshing && "opacity-70")} data-testid="dashboard-body">
      {/* Legacy Pano cards: point-in-time counters. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="dashboard-snapshot">
        <SnapshotTile testId="stat-pending-shipments" label={t("dashboard.pendingShipments")} info={t("dashboard.pendingShipmentsInfo")} value={data.snapshot.pending_shipments} icon={Package} to="/kargolar" />
        <SnapshotTile testId="stat-delivered-today" label={t("dashboard.deliveredToday")} info={t("dashboard.deliveredTodayInfo")} value={data.snapshot.delivered_today} icon={CheckCircle2} />
        {data.snapshot.total_customers !== null && <SnapshotTile testId="stat-customers" label={t("dashboard.totalCustomers")} info={t("dashboard.totalCustomersInfo")} value={data.snapshot.total_customers} icon={Users} to="/musteriler" />}
        {unread !== null && (
          <SnapshotTile
            testId="stat-unread"
            label={t("dashboard.unreadMessages")}
            info={t("dashboard.unreadMessagesInfo")}
            value={data.snapshot.unread_messages}
            hint={t("dashboard.unreadConversations", { count: unread })}
            icon={MessageCircle}
            to="/mesajlar"
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="dashboard-kpis">
        {kpiTile("revenue")}
        {kpiTile("orders", { to: "/siparisler" })}
        {kpiTile("avg_basket")}
        {kpiTile("confirmation_rate")}
        {kpiTile("delivered", { hint: t("dashboard.inCargoHint", { count: kpi("in_cargo")?.value ?? 0 }) })}
        {kpiTile("cancel_rate", { goodWhen: "down", hint: t("dashboard.returnRateHint", { rate: formatValue(kpi("return_rate")?.value ?? 0, "decimal", language) }) })}
        {kpiTile("unread_messages", { to: "/mesajlar", ...(unread !== null ? { hint: t("dashboard.unreadConversations", { count: unread }) } : {}) })}
        {kpiTile("new_customers", { to: "/musteriler" })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          testId="dashboard-trend"
          title={t("dashboard.trendTitle")}
          description={`${t("dashboard.trendDescription")} · ${formatDay(data.range.from)} – ${formatDay(data.range.to)}`}
          icon={TrendingUp}
          info={t("dashboard.rangeHint")}
          height={280}
          empty={data.timeseries.every((bucket) => bucket.orders === 0)}
          actions={
            <ToggleGroup type="single" value={metric} onValueChange={(value) => value && setMetric(value as "revenue" | "orders")} className="rounded-md border p-0.5" aria-label={t("dashboard.trendTitle")}>
              <ToggleGroupItem value="revenue" className="min-h-11 min-w-11 px-2 text-xs lg:min-h-7 lg:min-w-0" data-testid="dashboard-metric-revenue">
                {t("dashboard.metricRevenue")}
              </ToggleGroupItem>
              <ToggleGroupItem value="orders" className="min-h-11 min-w-11 px-2 text-xs lg:min-h-7 lg:min-w-0" data-testid="dashboard-metric-orders">
                {t("dashboard.metricOrders")}
              </ToggleGroupItem>
            </ToggleGroup>
          }
          exportSpec={{
            title: t("dashboard.trendTitle"),
            suffix,
            rows: trendData,
            columns: [
              { header: t("reports.colDate"), value: (row) => row.bucket },
              { header: t("reports.colRevenue"), value: (row) => row.revenue },
              { header: t("reports.colOrders"), value: (row) => row.orders },
              { header: `${t("charts.previousPeriod")} · ${t("reports.colRevenue")}`, value: (row) => row.prev_revenue },
              { header: `${t("charts.previousPeriod")} · ${t("reports.colOrders")}`, value: (row) => row.prev_orders },
            ],
          }}
        >
          <TrendChart
            ariaLabel={t("dashboard.trendTitle")}
            data={trendData}
            granularity={granularity}
            height={280}
            valueKind={metric === "revenue" ? "money" : "count"}
            series={[{ key: metric, name: metric === "revenue" ? t("dashboard.metricRevenue") : t("dashboard.metricOrders"), color: seriesColor(0), type: metric === "revenue" ? "area" : "bar" }]}
            previousKey={metric === "revenue" ? "prev_revenue" : "prev_orders"}
            previousName={t("charts.previousPeriod")}
          />
        </ChartCard>

        <ChartCard testId="dashboard-channels" title={t("dashboard.channelsTitle")} description={t("dashboard.channelsDescription")} icon={Filter} empty={channelSlices.length === 0} height={200}>
          <DonutChart ariaLabel={t("dashboard.channelsTitle")} data={channelSlices} valueKind="count" centerLabel={t("dashboard.channelsCenter")} testId="dashboard-channels-donut" />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard testId="dashboard-providers" title={t("dashboard.cargoTitle")} description={t("dashboard.cargoDescription")} icon={Truck} empty={cargoData.length === 0} height={140}>
          <CategoryBarChart
            ariaLabel={t("dashboard.cargoTitle")}
            data={cargoData}
            valueKind="count"
            categoryWidth={104}
            series={[
              { key: "delivered", name: t("dashboard.seriesDelivered"), color: chartTokens.good, stack: "s" },
              { key: "in_cargo", name: t("dashboard.seriesInCargo"), color: seriesColor(1), stack: "s" },
              { key: "returned", name: t("dashboard.seriesReturned"), color: chartTokens.critical, stack: "s" },
            ]}
          />
          <ul className="mt-3 grid grid-cols-2 gap-2 text-xs">
            {data.cargo_providers.map((row) => (
              <li key={row.provider} className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5">
                <span className="size-2.5 rounded-[3px]" style={{ background: providerColor(row.provider) }} aria-hidden="true" />
                {carrierBrand(row.provider) && <BrandIcon brand={carrierBrand(row.provider)!} title="" className="size-4" />}
                <span className="truncate">{t(`analytics.provider.${row.provider}` as "analytics.provider.ptt")}</span>
                <span className="ml-auto font-semibold tabular-nums">{formatValue(row.orders, "count", language)}</span>
              </li>
            ))}
          </ul>
        </ChartCard>
        <ChartCard testId="dashboard-funnel" title={t("dashboard.funnelTitle")} description={t("dashboard.funnelDescription")} icon={BarChart3} empty={(data.funnel[0]?.count ?? 0) === 0} height={200}>
          <Funnel testId="dashboard-funnel-steps" steps={data.funnel.map((step) => ({ key: step.key, label: t(`analytics.funnel.${step.key}` as "analytics.funnel.created"), value: step.count }))} />
        </ChartCard>
      </div>

      <div className={cn("grid gap-4", managers && "lg:grid-cols-2")}>
        <ChartCard
          testId="dashboard-products"
          title={t("dashboard.topProducts")}
          description={t("dashboard.topProductsDescription")}
          icon={ShoppingBag}
          empty={data.top_products.length === 0}
          height={180}
          table={<DataTable rows={data.top_products} columns={productColumns} rowKey={(row, index) => `${row.product_public_id ?? row.name}-${index}`} testId="dashboard-products-table" />}
          exportSpec={{ title: t("dashboard.topProducts"), suffix, rows: data.top_products, columns: exportColumns(productColumns) }}
        >
          <CategoryBarChart
            ariaLabel={t("dashboard.topProducts")}
            data={data.top_products.map((row, index) => ({ key: `${row.product_public_id ?? row.name}-${index}`, label: row.name, revenue: row.revenue }))}
            series={[{ key: "revenue", name: t("reports.colRevenue"), color: seriesColor(0) }]}
            valueKind="money"
            showValues
            categoryWidth={150}
          />
        </ChartCard>
        {managers && data.personnel && (
          <ChartCard
            testId="dashboard-personnel"
            title={t("dashboard.personnelTitle")}
            description={t("dashboard.personnelDescription")}
            icon={Users}
            empty={data.personnel.length === 0}
            height={180}
            table={<DataTable rows={data.personnel} columns={personnelColumns} rowKey={(row) => row.user_public_id} testId="dashboard-personnel-table" />}
            exportSpec={{ title: t("dashboard.personnelTitle"), suffix, rows: data.personnel, columns: exportColumns(personnelColumns) }}
          >
            <CategoryBarChart
              ariaLabel={t("dashboard.personnelTitle")}
              data={data.personnel.map((row) => ({ key: row.user_public_id, label: row.name, orders: row.orders, cancelled: row.cancelled }))}
              series={[
                { key: "orders", name: t("reports.colOrders"), color: seriesColor(1) },
                { key: "cancelled", name: t("reports.colCancelled"), color: chartTokens.critical },
              ]}
              valueKind="count"
            />
          </ChartCard>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col gap-2 p-4 sm:p-5" data-testid="dashboard-attention">
          <div className="flex items-start gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-semibold sm:text-base">{t("dashboard.attentionTitle")}</h2>
              <p className="text-xs text-muted-foreground">{t("dashboard.attentionDescription")}</p>
            </div>
          </div>
          <AttentionRow testId="attention-awaiting" icon={Clock} tone="warning" label={t("dashboard.attentionAwaiting")} count={data.snapshot.awaiting_confirmation} to="/siparisler?status=pending_confirmation" />
          <AttentionRow testId="attention-tracking" icon={Search} tone="critical" label={t("dashboard.attentionTracking")} count={data.snapshot.tracking_missing} to="/kargolar" />
          <AttentionRow testId="attention-unread" icon={MessageCircle} tone="info" label={t("dashboard.attentionUnread")} count={data.snapshot.unread_conversations} to="/mesajlar" />
          <AttentionRow testId="attention-branch" icon={Building2} tone="warning" label={t("dashboard.attentionAtBranch")} count={data.snapshot.at_branch} to="/kargolar" />
          {data.attention.awaiting_confirmation.length > 0 && (
            <ul className="mt-1 flex flex-col gap-1 border-t pt-2" data-testid="attention-awaiting-list">
              {data.attention.awaiting_confirmation.map((order) => (
                <li key={order.public_id}>
                  <Link to={`/siparisler?q=${encodeURIComponent(order.order_number)}`} className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted/60">
                    {channelBrand(order.channel) && <BrandIcon brand={channelBrand(order.channel)!} title="" className="size-4 shrink-0" />}
                    <span className="min-w-0 flex-1 truncate">{order.customer_name ?? t("dashboard.unknownCustomer")}</span>
                    <span className="text-xs text-muted-foreground">{formatRelative(order.created_at, language)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {data.attention.unread_conversations && data.attention.unread_conversations.length > 0 && (
            <ul className="flex flex-col gap-1 border-t pt-2" data-testid="attention-unread-list">
              {data.attention.unread_conversations.map((conversation) => (
                <li key={conversation.public_id}>
                  <Link to={`/mesajlar?konusma=${encodeURIComponent(conversation.public_id)}`} className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted/60">
                    {channelBrand(conversation.channel) && <BrandIcon brand={channelBrand(conversation.channel)!} title="" className="size-4 shrink-0" />}
                    <span className="min-w-0 flex-1 truncate">{conversation.customer_name ?? t("dashboard.unknownCustomer")}</span>
                    <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular-nums">{conversation.unread_count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col gap-2 p-4 sm:p-5 lg:col-span-2" data-testid="dashboard-recent-orders">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2.5 text-sm font-semibold sm:text-base">
              <span className="grid size-8 place-items-center rounded-md bg-primary/10 text-primary">
                <ShoppingCart className="size-4" aria-hidden="true" />
              </span>
              {t("dashboard.recentOrders")}
            </h2>
            <Link to="/siparisler" className="inline-flex min-h-11 items-center text-sm text-primary hover:underline lg:min-h-0">
              {t("dashboard.viewAll")}
            </Link>
          </div>
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">{t("orders.number")}</th>
                  <th className="py-2 pr-2 font-medium">{t("reports.colChannel")}</th>
                  <th className="py-2 pr-2 font-medium">{t("reports.colStatus")}</th>
                  <th className="py-2 pr-2 text-right font-medium">{t("reports.colRevenue")}</th>
                  <th className="py-2 text-right font-medium">{t("reports.colDate")}</th>
                </tr>
              </thead>
              <tbody>
                {data.recent_orders.map((order) => (
                  <tr key={order.public_id} className="border-b last:border-0" data-testid="dashboard-recent-order">
                    <td className="py-2 pr-2">
                      <Link to={`/siparisler?q=${encodeURIComponent(order.order_number)}`} className="inline-flex min-h-11 items-center font-medium hover:underline lg:min-h-0">
                        {order.order_number}
                      </Link>
                      <span className="block max-w-48 truncate text-xs text-muted-foreground">{order.customer_name ?? t("dashboard.unknownCustomer")}</span>
                    </td>
                    <td className="py-2 pr-2">
                      <span className="inline-flex items-center gap-1.5">
                        {channelBrand(order.channel) && <BrandIcon brand={channelBrand(order.channel)!} title="" className="size-4" />}
                        {t(`analytics.channel.${order.channel}` as "analytics.channel.whatsapp")}
                      </span>
                    </td>
                    <td className="py-2 pr-2">
                      <StatusBadge value={order.status} />
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums">{formatValue(order.total_amount, "money", language)}</td>
                    <td className="py-2 text-right text-xs whitespace-nowrap text-muted-foreground">{formatRelative(order.created_at, language)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col gap-2 p-4 sm:p-5" data-testid="dashboard-recent-shipments">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2.5 text-sm font-semibold sm:text-base">
              <span className="grid size-8 place-items-center rounded-md bg-primary/10 text-primary">
                <Truck className="size-4" aria-hidden="true" />
              </span>
              {t("dashboard.recentShipments")}
            </h2>
            <Link to="/kargolar" className="inline-flex min-h-11 items-center text-sm text-primary hover:underline lg:min-h-0">
              {t("dashboard.viewAll")}
            </Link>
          </div>
          {data.recent_shipments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t("charts.noData")}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {data.recent_shipments.map((shipment) => (
                <li key={shipment.public_id} className="flex items-center justify-between gap-3 py-2.5" data-testid="dashboard-recent-shipment">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{shipment.recipient_name}</p>
                    <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                      {carrierBrand(shipment.provider) && <BrandIcon brand={carrierBrand(shipment.provider)!} title="" className="size-3.5" />}
                      {shipment.tracking_number ?? t("dashboard.noTracking")}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge value={shipment.status} />
                    <span className="text-[11px] text-muted-foreground">{formatRelative(shipment.created_at, language)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <TodoCard userKey={userKey} />
        <Card className="flex flex-col gap-3 p-4 sm:p-5" data-testid="dashboard-quick-actions">
          <h2 className="flex items-center gap-2.5 text-sm font-semibold sm:text-base">
            <span className="grid size-8 place-items-center rounded-md bg-primary/10 text-primary">
              <Zap className="size-4" aria-hidden="true" />
            </span>
            {t("dashboard.quickActions")}
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {[
              { to: "/kargolar/pipeline", icon: Package, label: t("dashboard.quickNewShipment"), testId: "quick-new-shipment" },
              { to: "/musteriler", icon: Users, label: t("dashboard.quickCustomers"), testId: "quick-customers" },
              { to: "/kargolar", icon: TrendingUp, label: t("dashboard.quickTracking"), testId: "quick-tracking" },
              ...(managers ? [{ to: "/raporlar", icon: BarChart3, label: t("dashboard.quickReports"), testId: "quick-reports" }] : [{ to: "/siparisler", icon: ShoppingCart, label: t("dashboard.quickOrders"), testId: "quick-orders" }]),
            ].map((action) => (
              <Link
                key={action.to}
                to={action.to}
                className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed p-3 text-center text-sm font-medium transition-colors outline-none hover:border-primary hover:bg-primary/5 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                data-testid={action.testId}
              >
                <action.icon className="size-6 text-primary" aria-hidden="true" />
                {action.label}
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
