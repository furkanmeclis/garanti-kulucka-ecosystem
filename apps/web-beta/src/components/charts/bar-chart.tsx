import { useTranslation } from "react-i18next";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { Brand } from "@/components/brand-icons";
import { ChartLegend, ChartTooltipBox } from "./chart-tooltip";
import { formatTick, formatValue, type ValueKind } from "./format";
import { chartTokens } from "./theme";

export interface BarDatum {
  key: string;
  label: string;
  brand?: Brand | null | undefined;
  /** Per-category colour (brand series); otherwise each series' colour is used. */
  color?: string | undefined;
  [field: string]: string | number | null | undefined | Brand;
}

export interface BarSeries {
  key: string;
  name: string;
  color: string;
  stack?: string;
}

export interface CategoryBarChartProps {
  data: BarDatum[];
  series: BarSeries[];
  valueKind: ValueKind;
  /** "horizontal" = bars grow to the right (long category names, rankings); "vertical" = columns. */
  orientation?: "horizontal" | "vertical";
  height?: number;
  /** Value label at the bar tip (single-series rankings). */
  showValues?: boolean;
  testId?: string;
  ariaLabel: string;
  /** Category axis width for horizontal bars. */
  categoryWidth?: number;
}

interface TickProps {
  x?: number | string | undefined;
  y?: number | string | undefined;
  payload?: { value?: unknown } | undefined;
}

function CategoryTick({ x, y, payload, data, width }: TickProps & { data: BarDatum[]; width: number }) {
  const value = String(payload?.value ?? "");
  const datum = data.find((item) => item.key === value);
  const label = datum?.label ?? value;
  const max = Math.max(6, Math.floor(width / 6.4));
  const text = label.length > max ? `${label.slice(0, max - 1)}…` : label;
  return (
    <g transform={`translate(${Number(x ?? 0)},${Number(y ?? 0)})`}>
      <title>{label}</title>
      <text x={-6} y={0} dy={4} textAnchor="end" fill={chartTokens.axis} fontSize={11}>
        {text}
      </text>
    </g>
  );
}


/** Category comparison (ranking, provider split, grouped/stacked). One value axis, ≤ 24px bars, 4px rounded tips. */
export function CategoryBarChart({ data, series, valueKind, orientation = "horizontal", height, showValues = false, testId, ariaLabel, categoryWidth = 112 }: CategoryBarChartProps) {
  const { i18n } = useTranslation();
  const language = i18n.language;
  const horizontal = orientation === "horizontal";
  const stacked = series.some((item) => item.stack);
  const computedHeight = height ?? (horizontal ? Math.max(120, data.length * (series.length > 1 && !stacked ? 44 : 34) + 24) : 260);

  const renderTooltip = (props: TooltipContentProps) => {
    const datum = props.payload?.[0]?.payload as BarDatum | undefined;
    if (!props.active || !datum) return null;
    return (
      <ChartTooltipBox
        title={
          <span className="flex items-center gap-1">
            {datum.label}
          </span>
        }
        rows={series.map((item) => ({
          key: item.key,
          name: item.name,
          value: formatValue(Number(datum[item.key] ?? 0), valueKind, language),
          color: series.length === 1 && datum.color ? datum.color : item.color,
          brand: series.length === 1 ? (datum.brand ?? null) : null,
          shape: "square" as const,
        }))}
      />
    );
  };

  const tickFormatter = (value: number) => formatTick(value, valueKind, language);
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <div style={{ height: computedHeight }} role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 4, right: showValues ? 56 : 12, bottom: 0, left: 0 }} barGap={2} barCategoryGap={horizontal ? "24%" : "28%"}>
            <CartesianGrid horizontal={!horizontal} vertical={horizontal} stroke={chartTokens.grid} />
            {horizontal ? (
              <>
                <XAxis type="number" tickFormatter={tickFormatter} tick={{ fill: chartTokens.axis, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={valueKind !== "count"} />
                <YAxis
                  type="category"
                  dataKey="key"
                  width={categoryWidth}
                  tickLine={false}
                  axisLine={{ stroke: chartTokens.grid }}
                  interval={0}
                  tick={(props: TickProps) => <CategoryTick x={props.x} y={props.y} payload={props.payload} data={data} width={categoryWidth} />}
                />
              </>
            ) : (
              <>
                <XAxis
                  dataKey="key"
                  tickFormatter={(value: string) => data.find((item) => item.key === value)?.label ?? value}
                  tick={{ fill: chartTokens.axis, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: chartTokens.grid }}
                  interval="preserveStartEnd"
                  minTickGap={8}
                />
                <YAxis tickFormatter={tickFormatter} tick={{ fill: chartTokens.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={valueKind === "money" ? 64 : 40} allowDecimals={valueKind !== "count"} />
              </>
            )}
            <Tooltip content={renderTooltip} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
            {series.map((item, index) => (
              <Bar
                key={item.key}
                dataKey={item.key}
                name={item.name}
                fill={item.color}
                maxBarSize={24}
                radius={item.stack && index < series.length - 1 ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
                {...(item.stack ? { stackId: item.stack } : {})}
                isAnimationActive={false}
              >
                {series.length === 1 && data.map((datum) => <Cell key={datum.key} fill={datum.color ?? item.color} />)}
                {showValues && series.length === 1 && (
                  <LabelList dataKey={item.key} position={horizontal ? "right" : "top"} formatter={(value: unknown) => formatValue(Number(value ?? 0), valueKind, language, { compact: valueKind === "money" })} fill="var(--foreground)" fontSize={11} />
                )}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {series.length >= 2 && <ChartLegend items={series.map((item) => ({ key: item.key, label: item.name, color: item.color, shape: "square" }))} />}
    </div>
  );
}
