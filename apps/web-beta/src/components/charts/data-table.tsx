import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ExportColumn } from "./export";

export interface TableColumn<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
  /** Raw value for CSV/Excel (numbers stay numbers). */
  exportValue: (row: T) => string | number | null | undefined;
  className?: string;
}

export function exportColumns<T>(columns: ReadonlyArray<TableColumn<T>>): Array<ExportColumn<T>> {
  return columns.map((column) => ({ header: column.header, value: column.exportValue }));
}

/** Compact analytics table: horizontal scroll on phones, tabular numbers, optional totals row. */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  footer,
  testId,
  maxHeight,
  caption,
}: {
  rows: readonly T[];
  columns: ReadonlyArray<TableColumn<T>>;
  rowKey: (row: T, index: number) => string;
  footer?: ReactNode;
  testId?: string;
  maxHeight?: number;
  caption?: string;
}) {
  return (
    <div className="-mx-1 overflow-x-auto overscroll-x-contain px-1" style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined} data-testid={testId}>
      <table className="w-full min-w-max border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="sticky top-0 z-[1] bg-card">
          <tr className="border-b text-xs text-muted-foreground">
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cn("px-2 py-2 font-medium whitespace-nowrap", column.align === "right" ? "text-right" : "text-left")}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)} className="border-b last:border-0 hover:bg-muted/40" data-testid={testId ? `${testId}-row` : undefined}>
              {columns.map((column) => (
                <td key={column.key} className={cn("px-2 py-2 whitespace-nowrap", column.align === "right" && "text-right tabular-nums", column.className)}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot className="border-t font-medium">{footer}</tfoot>}
      </table>
    </div>
  );
}
