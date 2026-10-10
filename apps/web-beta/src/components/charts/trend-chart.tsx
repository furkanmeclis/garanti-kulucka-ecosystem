import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { Brand } from "@/components/brand-icons";
import { ChartLegend, ChartTooltipBox, type LegendItem } from "./chart-tooltip";
import { formatBucket, formatTick, formatValue, type ValueKind } from "./format";
import { chartTokens } from "./theme";

export interface TrendSeries {
  key: string;
  name: string;
  color: string;
  type: "area" | "line" | "bar";
  brand?: Brand | null;
  /** Stack id for stacked bars/areas. */
  stack?: string;
}

export interface TrendPoint {
  bucket: string;
  /** Previous-period bucket aligned by index (for the comparison series' tooltip date). */
  previousBucket?: string | undefined;
  [key: string]: string | number | undefined;
}

export interface TrendChartProps {
  data: TrendPoint[];
  series: TrendSeries[];
  /** Field holding the previous period's value of the first series; drawn as a thin muted line. */
  previousKey?: string | undefined;
  previousName?: string | undefined;
  valueKind: ValueKind;
  granularity: "day" | "week" | "month";
  height?: number;
  testId?: string;
  ariaLabel: string;
}

/**
 * Time trend: area/line/bar series on one value axis (never dual-axis), an optional previous-period line in the
 * de-emphasis hue, a crosshair tooltip listing every series at the hovered bucket, and an HTML legend for ≥ 2 series.
 */
export function TrendChart({ data, series, previousKey, previousName, valueKind, granularity, height = 260, testId, ariaLabel }: TrendChartProps) {
  const { t, i18n } = useTranslation();
  const gradientId = useId().replace(/:/g, "");
  const language = i18n.language;
  const legend: LegendItem[] = [
    ...series.map((item) => ({ key: item.key, label: item.name, color: item.color, brand: item.brand ?? null, shape: item.type === "line" ? ("line" as const) : ("square" as const) })),
    ...(previousKey ? [{ key: previousKey, label: previousName ?? t("charts.previousPeriod"), color: chartTokens.muted, shape: "line" as const }] : []),
  ];
  const hasBars = series.some((item) => item.type === "bar");

  const renderTooltip = (props: TooltipContentProps) => {
    const point = props.payload?.[0]?.payload as TrendPoint | undefined;
    if (!props.active || !point) return null;
    return (
      <ChartTooltipBox
        title={formatBucket(point.bucket, granularity, language, true)}
        rows={[
          ...series.map((item) => ({
            key: item.key,
            name: item.name,
            value: formatValue(Number(point[item.key] ?? 0), valueKind, language),
            color: item.color,
            brand: item.brand ?? null,
            shape: item.type === "line" ? ("line" as const) : ("square" as const),
          })),
          ...(previousKey
            ? [
                {
                  key: previousKey,
                  name: point.previousBucket ? `${previousName ?? t("charts.previousPeriod")} (${formatBucket(point.previousBucket, granularity, language)})` : (previousName ?? t("charts.previousPeriod")),
                  value: formatValue(Number(point[previousKey] ?? 0), valueKind, language),
                  color: chartTokens.muted,
                  shape: "line" as const,
                  muted: true,
                },
              ]
            : []),
        ]}
      />
    );
  };

  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <div style={{ height }} role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart data={data} margin={{ top: 8, right: 18, bottom: 0, left: 0 }} barCategoryGap="20%">
            <defs>
              {series
                .filter((item) => item.type === "area")
                .map((item) => (
                  <linearGradient key={item.key} id={`${gradientId}-${item.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={item.color} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={item.color} stopOpacity={0.02} />
                  </linearGradient>
                ))}
            </defs>
            <CartesianGrid vertical={false} stroke={chartTokens.grid} />
            <XAxis
              dataKey="bucket"
              tickFormatter={(value: string) => formatBucket(value, granularity, language)}
              tick={{ fill: chartTokens.axis, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: chartTokens.grid }}
              minTickGap={18}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(value: number) => formatTick(value, valueKind, language)}
              tick={{ fill: chartTokens.axis, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={valueKind === "money" ? 64 : 40}
              allowDecimals={valueKind !== "count"}
            />
            <Tooltip content={renderTooltip} cursor={hasBars ? { fill: "var(--muted)", opacity: 0.5 } : { stroke: chartTokens.axis, strokeWidth: 1 }} />
            {series.map((item) =>
              item.type === "bar" ? (
                <Bar key={item.key} dataKey={item.key} name={item.name} fill={item.color} maxBarSize={24} radius={item.stack ? 0 : [4, 4, 0, 0]} {...(item.stack ? { stackId: item.stack } : {})} isAnimationActive={false} />
              ) : item.type === "area" ? (
                <Area
                  key={item.key}
                  dataKey={item.key}
                  name={item.name}
                  type="monotone"
                  stroke={item.color}
                  strokeWidth={2}
                  fill={`url(#${gradientId}-${item.key})`}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: chartTokens.surface }}
                  dot={false}
                  {...(item.stack ? { stackId: item.stack } : {})}
                  isAnimationActive={false}
                />
              ) : (
                <Line key={item.key} dataKey={item.key} name={item.name} type="monotone" stroke={item.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: chartTokens.surface }} isAnimationActive={false} />
              ),
            )}
            {previousKey && (
              <Line dataKey={previousKey} name={previousName ?? t("charts.previousPeriod")} type="monotone" stroke={chartTokens.muted} strokeWidth={1.5} dot={false} activeDot={{ r: 3, strokeWidth: 2, stroke: chartTokens.surface }} isAnimationActive={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {legend.length >= 2 && <ChartLegend items={legend} />}
    </div>
  );
}
