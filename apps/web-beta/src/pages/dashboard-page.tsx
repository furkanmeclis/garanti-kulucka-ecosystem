import { CheckCircle2, Clock, MessageCircle, PackageX, ShoppingCart, Truck, Users, Wallet, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "@/app/auth";
import { navigationFor } from "@/app/navigation";
import { ErrorState } from "@/components/data-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/layout/page-header";
import { carrierLabel, channelLabel, formatMoney, formatNumber } from "@/lib/format";
import { useQuery } from "@/lib/use-query";

function StatCard({ title, value, hint, icon: Icon, to, testId }: { title: string; value: string; hint?: string; icon: LucideIcon; to?: string; testId: string }) {
  const body = (
    <Card className="h-full transition-colors hover:border-primary/40" data-testid={testId}>
      <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
        <CardDescription className="font-medium text-foreground/80">{title}</CardDescription>
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </CardHeader>
      <CardContent>
        <p className="truncate text-2xl font-semibold tabular-nums" data-testid={`${testId}-value`}>
          {value}
        </p>
        {hint && <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
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

function Breakdown({ title, items, testId }: { title: string; items: Array<{ label: string; value: number }>; testId: string }) {
  const { i18n } = useTranslation();
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {items.map((item) => (
          <div key={item.label} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{item.label}</span>
              <span className="font-medium tabular-nums">{formatNumber(item.value, i18n.language)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((item.value / total) * 100)}%` }} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { api, user } = useAuth();
  const allowed = new Set(navigationFor(user?.role).map((item) => item.key));
  const canCustomers = allowed.has("customers");
  const { data, error, loading, reload } = useQuery(`dashboard:${user?.public_id}`, async () => {
    const [orders, conversations, customers, shipments] = await Promise.all([
      api.orderSummary(),
      api.conversationSummary(),
      canCustomers ? api.customerSummary() : Promise.resolve(null),
      api.shipmentSummary(),
    ]);
    return { orders, conversations, customers, shipments };
  });
  const n = (value: number | undefined) => formatNumber(value ?? 0, i18n.language);

  return (
    <section data-testid="page-dashboard">
      <PageHeader title={t("dashboard.title")} description={t("dashboard.subtitle")} />
      {error && !data ? (
        <ErrorState onRetry={reload} />
      ) : loading && !data ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-32" />
          ))}
        </div>
      ) : data ? (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="dashboard-stats">
            <StatCard testId="stat-orders" title={t("dashboard.orders")} value={n(data.orders.total_count)} hint={t("dashboard.ordersActive", { count: data.orders.active_count })} icon={ShoppingCart} to="/siparisler" />
            <StatCard testId="stat-revenue" title={t("dashboard.revenue")} value={formatMoney(data.orders.total_revenue, data.orders.currency, i18n.language)} icon={Wallet} />
            <StatCard testId="stat-pending" title={t("dashboard.pendingConfirmation")} value={n(data.orders.pending_confirmation_count)} icon={Clock} to="/siparisler?status=pending_confirmation" />
            <StatCard testId="stat-conversations" title={t("dashboard.conversations")} value={n(data.conversations.total_count)} hint={t("dashboard.unread", { count: data.conversations.unread_count })} icon={MessageCircle} to="/mesajlar" />
            {data.customers && (
              <StatCard testId="stat-customers" title={t("dashboard.customers")} value={n(data.customers.total_count)} hint={t("dashboard.withPhone", { count: data.customers.with_phone_count })} icon={Users} to="/musteriler" />
            )}
            <StatCard testId="stat-shipments" title={t("dashboard.shipments")} value={n(data.shipments.total_count)} hint={t("dashboard.shipmentsActive", { count: data.shipments.active_count })} icon={Truck} to="/kargolar" />
            <StatCard testId="stat-delivered" title={t("dashboard.delivered")} value={n(data.shipments.delivered_count)} icon={CheckCircle2} />
            <StatCard testId="stat-tracking-missing" title={t("dashboard.trackingMissing")} value={n(data.shipments.exception_counts.tracking_missing)} icon={PackageX} />
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Breakdown
              testId="dashboard-channels"
              title={t("dashboard.channels")}
              items={Object.entries(data.conversations.channel_counts).map(([channel, value]) => ({ label: channelLabel(channel), value }))}
            />
            <Breakdown
              testId="dashboard-providers"
              title={t("dashboard.providers")}
              items={Object.entries(data.shipments.provider_counts).map(([provider, value]) => ({ label: carrierLabel(provider, t("shipments.otherProvider")), value }))}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}
