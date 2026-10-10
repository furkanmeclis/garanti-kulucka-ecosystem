import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatValue } from "./format";

export interface HeatCell {
  weekday: number;
  hour: number;
  value: number;
}

/**
 * Weekday × hour-of-day heatmap (sequential: one hue, light → dark, via opacity of the brand orange).
 * Hover/focus shows the cell in a readout line; the table view (parent card) carries every value.
 */
export function Heatmap({ cells, unitLabel, testId }: { cells: HeatCell[]; unitLabel: string; testId?: string }) {
  const { t, i18n } = useTranslation();
  const weekdays = t("charts.weekdaysShort").split(",");
  const max = Math.max(1, ...cells.map((cell) => cell.value));
  const [active, setActive] = useState<HeatCell | null>(null);
  const byKey = new Map(cells.map((cell) => [`${cell.weekday}-${cell.hour}`, cell]));
  const peak = cells.reduce<HeatCell | null>((best, cell) => (!best || cell.value > best.value ? cell : best), null);
  const describe = (cell: HeatCell) => `${weekdays[cell.weekday] ?? ""} ${String(cell.hour).padStart(2, "0")}:00–${String((cell.hour + 1) % 24).padStart(2, "0")}:00 · ${formatValue(cell.value, "count", i18n.language)} ${unitLabel}`;
  const steps = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <p className="min-h-5 text-xs text-muted-foreground" aria-live="polite">
        {active ? describe(active) : peak && peak.value > 0 ? t("charts.heatPeak", { slot: describe(peak) }) : t("charts.noData")}
      </p>
      <div className="overflow-x-auto overscroll-x-contain pb-1">
        <div className="grid min-w-[560px] gap-[2px]" style={{ gridTemplateColumns: "2.25rem repeat(24, minmax(0, 1fr))" }} role="grid" aria-label={t("charts.heatmapLabel", { unit: unitLabel })} onMouseLeave={() => setActive(null)}>
          <span />
          {Array.from({ length: 24 }, (_, hour) => (
            <span key={hour} className="text-center text-[10px] tabular-nums text-muted-foreground">
              {hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}
            </span>
          ))}
          {weekdays.map((day, weekday) => (
            <div key={day} className="contents" role="row">
              <span className="pr-1 text-right text-[11px] leading-6 text-muted-foreground">{day}</span>
              {Array.from({ length: 24 }, (_, hour) => {
                const cell = byKey.get(`${weekday}-${hour}`) ?? { weekday, hour, value: 0 };
                const intensity = cell.value / max;
                return (
                  <span
                    key={hour}
                    role="gridcell"
                    aria-label={describe(cell)}
                    className="h-6 rounded-[3px] outline-none ring-foreground/60 hover:ring-1"
                    style={{ background: cell.value === 0 ? "var(--muted)" : `color-mix(in oklab, var(--chart-seq) ${Math.round(15 + intensity * 85)}%, var(--card))` }}
                    onMouseEnter={() => setActive(cell)}
                    data-value={cell.value}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{formatValue(0, "count", i18n.language)}</span>
        <span className="flex h-2 w-32 overflow-hidden rounded-full" aria-hidden="true">
          {steps.map((step) => (
            <span key={step} className="flex-1" style={{ background: step === 0 ? "var(--muted)" : `color-mix(in oklab, var(--chart-seq) ${Math.round(15 + step * 85)}%, var(--card))` }} />
          ))}
        </span>
        <span>{formatValue(max, "count", i18n.language)}</span>
      </div>
    </div>
  );
}
