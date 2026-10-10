import { useTranslation } from "react-i18next";
import { formatValue } from "./format";

export interface FunnelStep {
  key: string;
  label: string;
  value: number;
}

/**
 * Stage funnel (ordinal: one hue, lightness steps from the brand orange). Each row shows the count, its share of
 * the first stage and the step-to-step conversion, so the reading never depends on colour.
 */
export function Funnel({ steps, testId }: { steps: FunnelStep[]; testId?: string }) {
  const { t, i18n } = useTranslation();
  const first = steps[0]?.value ?? 0;
  const pct = (value: number, base: number) => (base ? `%${new Intl.NumberFormat(i18n.language === "en" ? "en-GB" : "tr-TR", { maximumFractionDigits: 1 }).format((value / base) * 100)}` : "—");
  return (
    <ol className="flex flex-col gap-2.5" data-testid={testId}>
      {steps.map((step, index) => {
        const previous = index > 0 ? steps[index - 1]!.value : null;
        const width = first ? Math.max(2, (step.value / first) * 100) : 0;
        const mix = 100 - index * (55 / Math.max(1, steps.length - 1));
        return (
          <li key={step.key} className="flex flex-col gap-1" data-testid={testId ? `${testId}-step` : undefined} data-value={step.value}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">{step.label}</span>
              <span className="flex items-baseline gap-2">
                <span className="font-semibold tabular-nums">{formatValue(step.value, "count", i18n.language)}</span>
                <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">{pct(step.value, first)}</span>
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div className="h-full rounded-full" style={{ width: `${width}%`, background: `color-mix(in oklab, var(--chart-1) ${mix}%, var(--card))` }} />
            </div>
            {previous !== null && <span className="text-[11px] text-muted-foreground">{t("charts.stepConversion", { rate: pct(step.value, previous) })}</span>}
          </li>
        );
      })}
    </ol>
  );
}
