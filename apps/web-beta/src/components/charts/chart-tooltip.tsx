import type { ReactNode } from "react";
import { BrandIcon, type Brand } from "@/components/brand-icons";

export interface TooltipRow {
  key: string;
  name: string;
  value: string;
  color: string;
  brand?: Brand | null | undefined;
  /** Rendered as a short line key (lines) or a square (bars/areas). */
  shape?: "line" | "square";
  muted?: boolean;
}

/** shadcn-style tooltip body: value first (strong), series name secondary, line keys in the series colour. */
export function ChartTooltipBox({ title, rows, footer }: { title?: ReactNode; rows: TooltipRow[]; footer?: ReactNode }) {
  return (
    <div className="pointer-events-none min-w-36 max-w-64 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg" role="status">
      {title && <p className="mb-1.5 font-medium text-muted-foreground">{title}</p>}
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2">
            {row.shape === "square" ? (
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: row.color }} aria-hidden="true" />
            ) : (
              <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: row.color }} aria-hidden="true" />
            )}
            <span className={row.muted ? "font-medium tabular-nums text-muted-foreground" : "font-semibold tabular-nums"}>{row.value}</span>
            <span className="ml-auto flex min-w-0 items-center gap-1 truncate pl-2 text-muted-foreground">
              {row.brand && <BrandIcon brand={row.brand} title="" className="size-3.5" />}
              {row.name}
            </span>
          </li>
        ))}
      </ul>
      {footer && <p className="mt-1.5 border-t pt-1.5 text-muted-foreground">{footer}</p>}
    </div>
  );
}

export interface LegendItem {
  key: string;
  label: string;
  color: string;
  brand?: Brand | null | undefined;
  shape?: "line" | "square";
  value?: string;
  dashed?: boolean;
}

/** HTML legend (always present for ≥ 2 series): swatch mirrors the mark, brand icon when the series is a brand. */
export function ChartLegend({ items, className, testId }: { items: LegendItem[]; className?: string; testId?: string }) {
  return (
    <ul className={className ?? "flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground"} data-testid={testId}>
      {items.map((item) => (
        <li key={item.key} className="flex min-w-0 items-center gap-1.5">
          {item.shape === "line" ? (
            <span className="h-0.5 w-3.5 shrink-0 rounded-full" style={{ background: item.color, opacity: item.dashed ? 0.9 : 1 }} aria-hidden="true" />
          ) : (
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: item.color }} aria-hidden="true" />
          )}
          {item.brand && <BrandIcon brand={item.brand} title="" className="size-3.5" />}
          <span className="truncate text-foreground/80">{item.label}</span>
          {item.value && <span className="font-medium tabular-nums text-foreground">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}
