import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { ErrorState } from "@/components/data-list";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/layout/page-header";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import type { LegacyOrderStatusKey, ReportCargoProvider } from "@/lib/reports-instagram";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { Field, NativeSelect } from "./accounting-shared";

const statusKeys: Record<LegacyOrderStatusKey, string> = {
  olusturuldu: "statusCreated",
  teyit_bekliyor: "statusAwaitingConfirmation",
  teyit_edildi: "statusConfirmed",
  hazirlaniyor: "statusPreparing",
  kargoya_verildi: "statusHandedToCargo",
  sevk_edildi: "statusInTransit",
  teslim_edildi: "statusDelivered",
  iptal: "statusCancelled",
  iade: "statusReturned",
};
const statusColor: Record<LegacyOrderStatusKey, string> = {
  olusturuldu: "bg-blue-500",
  teyit_bekliyor: "bg-yellow-500",
  teyit_edildi: "bg-green-500",
  hazirlaniyor: "bg-purple-500",
  kargoya_verildi: "bg-orange-500",
  sevk_edildi: "bg-emerald-500",
  teslim_edildi: "bg-emerald-700",
  iptal: "bg-red-500",
  iade: "bg-amber-500",
};
const presets = [7, 30, 90] as const;

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localDate(date);
}

/** Horizontal bar list (no chart library): label, bar scaled to the max value, formatted value. */
function Bars({ rows, testId }: { rows: Array<{ key: string; label: string; value: number; display: string; color?: string }>; testId: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className="flex flex-col gap-1.5" data-testid={testId}>
      {rows.map((row) => (
        <li key={row.key} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-2 text-sm">
          <span className="truncate text-muted-foreground">{row.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-muted">
            <span className={cn("block h-full rounded-full", row.color ?? "bg-primary")} style={{ width: `${(row.value / max) * 100}%` }} />
          </span>
          <span className="text-right font-medium tabular-nums">{row.display}</span>
        </li>
      ))}
    </ul>
  );
}

/** /raporlar (managers) — legacy RaporlarPage: presets, personnel / cargo filters, KPI cards, rates and daily, status, cargo and personnel breakdowns. */
export function ReportsPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [start, setStart] = useState(() => daysAgo(29));
  const [end, setEnd] = useState(() => localDate(new Date()));
  const [preset, setPreset] = useState<number | null>(30);
  const [personnel, setPersonnel] = useState("");
  const [provider, setProvider] = useState<ReportCargoProvider>("tumu");
  const query = useQuery(`reports:${start}:${end}:${personnel}:${provider}`, () =>
    api.reportAnalysis({ start_date: start, end_date: end, cargo_provider: provider, ...(personnel ? { personnel_public_id: personnel } : {}) }),
  );
  const data = query.data;
  const money = (value: number) => formatMoney(value, "TRY", i18n.language);
  const num = (value: number) => formatNumber(value, i18n.language);
  const m = data?.metrics;

  const kpis = m
    ? [
        { key: "total", label: t("reports.totalOrders"), value: num(m.toplam), detail: t("reports.cancelRateSuffix", { rate: data.rates.iptal }) },
        { key: "active", label: t("reports.activeOrders"), value: num(m.aktif), detail: t("reports.returnRateSuffix", { rate: data.rates.iade }) },
        { key: "revenue", label: t("reports.totalRevenue"), value: money(m.ciro), detail: "" },
        { key: "cargo", label: t("reports.handedToCargo"), value: num(m.kargoya_giden), detail: t("reports.deliveryRateSuffix", { rate: data.rates.teslim }) },
        { key: "returns", label: t("reports.cargoReturns"), value: num(m.kargo_iade), detail: t("reports.cargoReturnsDetail", { ptt: m.ptt_kargo_iade, surat: m.surat_kargo_iade, rate: data.rates.kargo_iade }) },
        { key: "branch", label: t("reports.waitingAtBranch"), value: num(m.subede_toplam), detail: t("reports.branchDetail", { ptt: m.ptt_subede, surat: m.surat_subede }) },
        { key: "tracking", label: t("reports.trackingReturns"), value: num(m.kargo_takip_iade), detail: t("reports.trackingReturnsDetail") },
        { key: "confirmation", label: t("reports.confirmationRate"), value: `%${data.rates.teyit}`, detail: t("reports.awaitingConfirmationCount", { count: m.teyit_bekliyor }) },
      ]
    : [];
  const rates = data
    ? [
        { key: "delivery", label: t("reports.deliveryRate"), formula: t("reports.deliveryRateFormula"), value: data.rates.teslim },
        { key: "cargoReturn", label: t("reports.cargoReturnRate"), formula: t("reports.cargoReturnRateFormula"), value: data.rates.kargo_iade },
        { key: "cancel", label: t("reports.cancelRate"), formula: t("reports.cancelRateFormula"), value: data.rates.iptal },
        { key: "return", label: t("reports.returnRate"), formula: t("reports.returnRateFormula"), value: data.rates.iade },
        { key: "branch", label: t("reports.branchWaiting"), formula: t("reports.branchWaitingFormula"), value: data.rates.sube },
      ]
    : [];
  const recentDays = (data?.daily ?? []).slice(-14);

  return (
    <section data-testid="page-reports">
      <PageHeader
        title={t("reports.title")}
        description={t("reports.subtitle")}
        actions={
          <Button variant="outline" className="min-h-11" onClick={query.reload} data-testid="reports-refresh">
            <RefreshCw className={cn("size-4", query.loading && "animate-spin")} aria-hidden="true" />
            {t("reports.refresh")}
          </Button>
        }
      />
      <Card className="mb-4 flex flex-col gap-3 p-4" data-testid="reports-filters">
        <div className="flex flex-wrap gap-2">
          {presets.map((days) => (
            <Button
              key={days}
              variant={preset === days ? "default" : "outline"}
              className="min-h-11"
              aria-pressed={preset === days}
              onClick={() => {
                setPreset(days);
                setStart(daysAgo(days - 1));
                setEnd(localDate(new Date()));
              }}
              data-testid={`reports-preset-${days}`}
            >
              {t(days === 7 ? "reports.presetLast7" : days === 30 ? "reports.presetLast30" : "reports.presetLast90")}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("reports.startDate")}>
            <Input type="date" value={start} max={end} onChange={(event) => { setStart(event.target.value); setPreset(null); }} className="h-11 md:h-9" data-testid="reports-start" />
          </Field>
          <Field label={t("reports.endDate")}>
            <Input type="date" value={end} min={start} onChange={(event) => { setEnd(event.target.value); setPreset(null); }} className="h-11 md:h-9" data-testid="reports-end" />
          </Field>
          <Field label={t("reports.personnel")}>
            <NativeSelect value={personnel} onChange={(event) => setPersonnel(event.target.value)} data-testid="reports-personnel">
              <option value="">{t("reports.allPersonnel")}</option>
              {(data?.personnel_options ?? []).map((option) => (
                <option key={option.public_id} value={option.public_id}>
                  {`${option.first_name} ${option.last_name}`.trim()}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t("reports.cargoProvider")}>
            <NativeSelect value={provider} onChange={(event) => setProvider(event.target.value as ReportCargoProvider)} data-testid="reports-provider">
              <option value="tumu">{t("reports.allProviders")}</option>
              <option value="ptt">PTT</option>
              <option value="surat">Sürat</option>
            </NativeSelect>
          </Field>
        </div>
      </Card>
      {query.error && !data ? (
        <ErrorState onRetry={query.reload} />
      ) : !data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      ) : (
        <div className={cn("flex flex-col gap-4 transition-opacity", query.loading && "opacity-60")}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="reports-kpis">
            {kpis.map((kpi) => (
              <Card key={kpi.key} className="min-w-0 p-4" data-testid={`reports-kpi-${kpi.key}`}>
                <p className="truncate text-sm text-muted-foreground">{kpi.label}</p>
                <p className="truncate text-xl font-semibold">{kpi.value}</p>
                {kpi.detail && <p className="text-xs break-words text-muted-foreground">{kpi.detail}</p>}
              </Card>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <h2 className="font-semibold">{t("reports.dailyOrderTrend")}</h2>
              <p className="mb-3 text-xs text-muted-foreground">{t("reports.dailyOrderTrendDetail")}</p>
              {recentDays.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("reports.noData")}</p>
              ) : (
                <Bars testId="reports-daily" rows={recentDays.map((day) => ({ key: day.date, label: formatDate(day.date, i18n.language), value: day.orders, display: `${num(day.orders)} · ${money(day.revenue)}` }))} />
              )}
            </Card>
            <Card className="p-4">
              <h2 className="font-semibold">{t("reports.orderStatus")}</h2>
              <p className="mb-3 text-xs text-muted-foreground">{t("reports.orderStatusDetail")}</p>
              <Bars
                testId="reports-status"
                rows={data.status_distribution.filter((row) => row.count > 0).map((row) => ({ key: row.status, label: t(`reports.${statusKeys[row.status]}` as "reports.statusCreated"), value: row.count, display: num(row.count), color: statusColor[row.status] }))}
              />
            </Card>
            <Card className="p-4">
              <h2 className="font-semibold">{t("reports.cargoProviderChart")}</h2>
              <p className="mb-3 text-xs text-muted-foreground">{t("reports.cargoProviderChartDetail")}</p>
              <Bars
                testId="reports-cargo"
                rows={data.cargo_providers.flatMap((row) => [
                  { key: `${row.provider}-active`, label: `${row.provider === "ptt" ? "PTT" : "Sürat"} · ${t("reports.seriesActiveCargo")}`, value: row.active, display: num(row.active), color: "bg-sky-500" },
                  { key: `${row.provider}-returns`, label: `${row.provider === "ptt" ? "PTT" : "Sürat"} · ${t("reports.cargoReturns")}`, value: row.returns, display: num(row.returns), color: "bg-amber-500" },
                ])}
              />
            </Card>
            <Card className="p-4">
              <h2 className="font-semibold">{t("reports.personnelPerformance")}</h2>
              <p className="mb-3 text-xs text-muted-foreground">{t("reports.personnelPerformanceDetail")}</p>
              {data.personnel_performance.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("reports.noData")}</p>
              ) : (
                <Bars testId="reports-personnel-performance" rows={data.personnel_performance.map((row) => ({ key: row.user_public_id, label: row.name, value: row.orders, display: `${num(row.orders)} · ${money(row.revenue)}` }))} />
              )}
            </Card>
          </div>
          <Card className="p-4">
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="reports-rates">
              {rates.map((rate) => (
                <li key={rate.key} className="min-w-0">
                  <p className="truncate text-sm font-medium">{rate.label}</p>
                  <p className="text-2xl font-semibold">%{rate.value}</p>
                  <p className="text-xs text-muted-foreground">{rate.formula}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </section>
  );
}
