import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Hint } from "@/components/hint";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { InfoHint } from "./chart-card";
import { formatValue, type ValueKind } from "./format";

/** 12-ish point trend in the de-emphasis hue with the latest point in the accent (no axes; the value is the tile). */
export function Sparkline({ values, className, accent = "var(--chart-1)" }: { values: number[]; className?: string; accent?: string }) {
  if (values.length < 2) return <div className={className} aria-hidden="true" />;
  const width = 120;
  const height = 32;
  const max = Math.max(...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((value, index) => [index * step, height - 2 - ((value - min) / span) * (height - 6)] as const);
  const path = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = points[points.length - 1]!;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={cn("h-8 w-full overflow-visible", className)} aria-hidden="true" data-testid="sparkline">
      <path d={`${path} L${width},${height} L0,${height} Z`} fill={accent} opacity={0.08} />
      <path d={path} fill="none" stroke="var(--chart-muted)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={accent} />
    </svg>
  );
}

export interface KpiTileProps {
  label: string;
  value: number | null | undefined;
  kind: ValueKind;
  icon: LucideIcon;
  /** Definition shown in the (i) tooltip. */
  info: ReactNode;
  changePct?: number | null | undefined;
  previous?: number | null | undefined;
  /** Whether an increase is good (green) or bad (red), e.g. cancellation rate. */
  goodWhen?: "up" | "down";
  series?: number[] | undefined;
  hint?: ReactNode;
  to?: string;
  loading?: boolean;
  testId: string;
}

/** Stat tile: label · value · signed delta vs previous period (icon + colour by direction × goodness) · sparkline. */
export function KpiTile(props: KpiTileProps) {
  const { t, i18n } = useTranslation();
  const Icon = props.icon;
  const change = props.changePct;
  const direction = change === null || change === undefined || change === 0 ? "flat" : change > 0 ? "up" : "down";
  const good = direction === "flat" ? null : (direction === "up") === ((props.goodWhen ?? "up") === "up");
  const DeltaIcon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  const deltaText = change === null || change === undefined ? null : `${change > 0 ? "+" : ""}${new Intl.NumberFormat(i18n.language === "en" ? "en-GB" : "tr-TR", { maximumFractionDigits: 1 }).format(change)}%`;
  const body = (
    <Card className={cn("flex h-full min-w-0 flex-col gap-2 p-3 transition-colors sm:p-4", props.to && "hover:border-primary/40")} data-testid={props.testId}>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1 text-xs font-medium text-muted-foreground sm:text-sm">
          <span className="truncate">{props.label}</span>
          <InfoHint text={props.info} />
        </span>
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary sm:size-8">
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </div>
      {props.loading ? (
        <Skeleton className="h-7 w-24" />
      ) : (
        <p className="truncate text-xl font-semibold tracking-tight sm:text-2xl" data-testid={`${props.testId}-value`}>
          {props.value === null || props.value === undefined ? "—" : formatValue(props.value, props.kind, i18n.language)}
        </p>
      )}
      <div className="flex min-h-5 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
        {deltaText ? (
          <Hint content={props.previous !== null && props.previous !== undefined ? t("charts.previousValue", { value: formatValue(props.previous, props.kind, i18n.language) }) : null}>
            <span
              className={cn("inline-flex items-center gap-0.5 rounded px-1 font-medium tabular-nums", good === null ? "text-muted-foreground" : good ? "bg-success/10 text-emerald-700 dark:text-emerald-400" : "bg-destructive/10 text-red-700 dark:text-red-400")}
              data-testid={`${props.testId}-delta`}
              data-direction={direction}
            >
              <DeltaIcon className="size-3.5" aria-hidden="true" />
              {deltaText}
            </span>
          </Hint>
        ) : props.previous !== undefined && props.previous !== null ? (
          <span className="text-muted-foreground">{t("charts.noBaseline")}</span>
        ) : null}
        {deltaText && <span className="text-muted-foreground">{t("charts.vsPrevious")}</span>}
        {props.hint && <span className="w-full truncate text-muted-foreground">{props.hint}</span>}
      </div>
      {props.series && props.series.length > 1 && <Sparkline values={props.series} className="mt-auto" />}
    </Card>
  );
  return props.to ? (
    <Link to={props.to} className="block min-w-0 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      {body}
    </Link>
  ) : (
    body
  );
}
