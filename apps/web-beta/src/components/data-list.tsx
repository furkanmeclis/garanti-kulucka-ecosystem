import { AlertCircle, ChevronLeft, ChevronRight, Inbox, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import { pageSize } from "@/lib/list-params";
import { statusKey, statusTone } from "@/lib/status";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Card layout: "title" and "badge" sit on the card's first row, "meta" rows below as label/value pairs. */
  mobile?: "title" | "badge" | "meta" | "hidden";
}

/** Responsive list: a table from md up, stacked cards below (no horizontal scrolling on phones). */
export function DataList<T>({ rows, columns, rowKey, loading, testId }: { rows: T[]; columns: Column<T>[]; rowKey: (row: T) => string; loading: boolean; testId: string }) {
  const { t } = useTranslation();
  if (loading && rows.length === 0) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" data-testid={`${testId}-loading`}>
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground" data-testid={`${testId}-empty`}>
        <Inbox className="size-8" aria-hidden="true" />
        {t("common.empty")}
      </Card>
    );
  }
  const title = columns.find((column) => column.mobile === "title");
  const badge = columns.find((column) => column.mobile === "badge");
  const meta = columns.filter((column) => column.mobile === "meta" || column.mobile === undefined);

  return (
    <div className={cn("min-w-0 max-w-full transition-opacity", loading && "opacity-60")} aria-busy={loading}>
      <Card className="hidden max-w-full overflow-x-auto md:block">
        <table className="w-full text-sm" data-testid={`${testId}-table`}>
          <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground uppercase">
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" className={cn("px-4 py-3 font-medium whitespace-nowrap", column.className)}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b last:border-b-0 hover:bg-muted/30" data-testid={`${testId}-row`}>
                {columns.map((column) => (
                  <td key={column.key} className={cn("max-w-64 truncate px-4 py-3 align-middle", column.className)}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <ul className="flex flex-col gap-2 md:hidden" data-testid={`${testId}-cards`}>
        {rows.map((row) => (
          <li key={rowKey(row)}>
            <Card className="flex flex-col gap-2 p-4" data-testid={`${testId}-card`}>
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0 font-medium break-words">{title?.cell(row)}</div>
                {badge && <div className="shrink-0">{badge.cell(row)}</div>}
              </div>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                {meta.map((column) => (
                  <div key={column.key} className="contents">
                    <dt className="text-muted-foreground">{column.header}</dt>
                    <dd className="min-w-0 truncate text-right">{column.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Pagination({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (page: number) => void }) {
  const { t, i18n } = useTranslation();
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-2" aria-label={t("common.pageOf", { page, pages })} data-testid="pagination">
      <p className="text-sm text-muted-foreground" data-testid="pagination-summary">
        {t("common.showing", { from: formatNumber(from, i18n.language), to: formatNumber(to, i18n.language), total: formatNumber(total, i18n.language) })}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t("common.previous")} data-testid="pagination-prev">
          <ChevronLeft />
        </Button>
        <span className="min-w-20 text-center text-sm tabular-nums" data-testid="pagination-page">
          {page} / {pages}
        </span>
        <Button variant="outline" size="icon" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t("common.next")} data-testid="pagination-next">
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}

export function StatusBadge({ value }: { value: string | null | undefined }) {
  const { t } = useTranslation();
  if (!value) return <span className="text-muted-foreground">{t("common.none")}</span>;
  const key = statusKey(value);
  return <Badge tone={statusTone(value)}>{key ? t(`status.${key}` as "status.delivered") : value}</Badge>;
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Card className="flex flex-col items-center gap-3 p-8 text-center" role="alert" data-testid="error-state">
      <AlertCircle className="size-8 text-destructive" aria-hidden="true" />
      <p className="text-sm">{t("common.error")}</p>
      <Button variant="outline" onClick={onRetry}>
        <RefreshCw />
        {t("common.refresh")}
      </Button>
    </Card>
  );
}
