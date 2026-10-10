import { useTranslation } from "react-i18next";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, type TooltipContentProps } from "recharts";
import { BrandIcon, type Brand } from "@/components/brand-icons";
import { ChartTooltipBox } from "./chart-tooltip";
import { formatValue, type ValueKind } from "./format";
import { chartTokens } from "./theme";

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
  brand?: Brand | null | undefined;
}

/**
 * Part-to-whole at a glance (≤ 6 slices; the tail folds into "Other" upstream). The legend doubles as the
 * value list (label, value, share) so nothing is readable only by colour or by hovering.
 */
export function DonutChart({ data, valueKind, centerLabel, height = 200, testId, ariaLabel }: { data: DonutSlice[]; valueKind: ValueKind; centerLabel: string; height?: number; testId?: string; ariaLabel: string }) {
  const { i18n } = useTranslation();
  const language = i18n.language;
  const total = data.reduce((sum, slice) => sum + slice.value, 0);
  const share = (value: number) => (total ? `%${new Intl.NumberFormat(language === "en" ? "en-GB" : "tr-TR", { maximumFractionDigits: 1 }).format((value / total) * 100)}` : "%0");

  const renderTooltip = (props: TooltipContentProps) => {
    const slice = props.payload?.[0]?.payload as DonutSlice | undefined;
    if (!props.active || !slice) return null;
    return <ChartTooltipBox rows={[{ key: slice.key, name: slice.label, value: `${formatValue(slice.value, valueKind, language)} · ${share(slice.value)}`, color: slice.color, brand: slice.brand ?? null, shape: "square" }]} />;
  };

  return (
    <div className="flex flex-col items-center gap-4" data-testid={testId}>
      <div className="relative w-full max-w-[220px] shrink-0" style={{ height }} role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="92%" paddingAngle={data.length > 1 ? 1.5 : 0} stroke={chartTokens.surface} strokeWidth={2} isAnimationActive={false}>
              {data.map((slice) => (
                <Cell key={slice.key} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip content={renderTooltip} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-lg font-semibold">{formatValue(total, valueKind, language, { compact: valueKind === "money" && total >= 100_000 })}</span>
          <span className="text-[11px] text-muted-foreground">{centerLabel}</span>
        </div>
      </div>
      <ul className="flex w-full min-w-0 flex-col gap-1.5 text-sm">
        {data.map((slice) => (
          <li key={slice.key} className="flex min-w-0 items-center gap-2" data-testid={testId ? `${testId}-item` : undefined}>
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: slice.color }} aria-hidden="true" />
            {slice.brand && <BrandIcon brand={slice.brand} title="" className="size-4 shrink-0" />}
            <span className="min-w-0 flex-1 truncate">{slice.label}</span>
            <span className="font-medium tabular-nums">{formatValue(slice.value, valueKind, language)}</span>
            <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{share(slice.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
