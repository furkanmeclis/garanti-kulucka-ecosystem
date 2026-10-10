import { AlertCircle, BarChart3, Download, FileSpreadsheet, FileText, Info, RefreshCw, Table2, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BrandIcon, type Brand } from "@/components/brand-icons";
import { Hint } from "@/components/hint";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { downloadText, exportFileName, toCsv, toSpreadsheetXml, type ExportColumn } from "./export";
import "./charts.css";

export interface ExportSpec<T = unknown> {
  title: string;
  rows: readonly T[];
  columns: ReadonlyArray<ExportColumn<T>>;
  /** Appended to the file name (e.g. the date range). */
  suffix?: string;
}

/** CSV / Excel download menu for one table. */
export function ExportMenu<T>({ spec, testId }: { spec: ExportSpec<T>; testId?: string }) {
  const { t } = useTranslation();
  const disabled = spec.rows.length === 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button variant="ghost" size="icon" className="size-11 lg:size-8" aria-label={t("charts.export", { title: spec.title })} data-testid={testId}>
          <Download className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => downloadText(toCsv(spec.rows, spec.columns), exportFileName(spec.title, spec.suffix ?? "", "csv"), "text/csv;charset=utf-8")}
          data-testid={testId ? `${testId}-csv` : undefined}
        >
          <FileText className="size-4" aria-hidden="true" />
          {t("charts.exportCsv")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => downloadText(toSpreadsheetXml(spec.rows, spec.columns, spec.title), exportFileName(spec.title, spec.suffix ?? "", "xls"), "application/vnd.ms-excel")}
          data-testid={testId ? `${testId}-xls` : undefined}
        >
          <FileSpreadsheet className="size-4" aria-hidden="true" />
          {t("charts.exportExcel")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function InfoHint({ text }: { text: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Hint content={text}>
      <span className="inline-flex size-5 items-center justify-center text-muted-foreground hover:text-foreground" aria-label={t("charts.definition")}>
        <Info className="size-3.5" aria-hidden="true" />
      </span>
    </Hint>
  );
}

export function ChartEmpty({ height, text }: { height?: number; text?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground" style={{ minHeight: height ?? 160 }} data-testid="chart-empty">
      <BarChart3 className="size-5 opacity-60" aria-hidden="true" />
      {text ?? t("charts.noData")}
    </div>
  );
}

export function ChartError({ onRetry, height }: { onRetry?: (() => void) | undefined; height?: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center gap-2 text-sm" style={{ minHeight: height ?? 160 }} role="alert">
      <AlertCircle className="size-5 text-destructive" aria-hidden="true" />
      {t("charts.loadError")}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="size-4" aria-hidden="true" />
          {t("common.refresh")}
        </Button>
      )}
    </div>
  );
}

export interface ChartCardProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  brand?: Brand;
  /** KPI / metric definition shown in the (i) tooltip. */
  info?: ReactNode;
  actions?: ReactNode;
  loading?: boolean;
  /** Refetching with data on screen: keep the frame, dim it (no skeleton flash). */
  refreshing?: boolean;
  error?: boolean;
  onRetry?: () => void;
  empty?: boolean;
  /** Chart height in px (skeleton/empty keep it so the grid does not jump). */
  height?: number;
  /** Table twin of the chart (view toggle) — also what the export downloads. */
  table?: ReactNode;
  exportSpec?: ExportSpec<any>;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  testId?: string;
}

/** Card shell shared by every chart: header (icon, title, definition, actions), chart/table toggle, export, states. */
export function ChartCard(props: ChartCardProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<"chart" | "table">("chart");
  const Icon = props.icon;
  const height = props.height ?? 260;
  const body = props.loading ? (
    <Skeleton className="w-full" style={{ height }} />
  ) : props.error ? (
    <ChartError onRetry={props.onRetry} height={height} />
  ) : props.empty ? (
    <ChartEmpty height={height} />
  ) : view === "table" && props.table ? (
    props.table
  ) : (
    props.children
  );
  return (
    <Card className={cn("chart-root flex min-w-0 flex-col gap-3 p-4 sm:p-5", props.className)} data-testid={props.testId}>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          {props.brand ? (
            <BrandIcon brand={props.brand} title="" className="mt-0.5 size-5 shrink-0" />
          ) : Icon ? (
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
              <Icon className="size-4" aria-hidden="true" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 className="flex items-center gap-1 text-sm font-semibold leading-tight sm:text-base">
              <span className="min-w-0 break-words">{props.title}</span>
              {props.info && <InfoHint text={props.info} />}
            </h2>
            {props.description && <p className="mt-0.5 text-xs text-muted-foreground">{props.description}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {props.actions}
          {props.table && !props.loading && !props.error && !props.empty && (
            <ToggleGroup
              type="single"
              value={view}
              onValueChange={(next) => next && setView(next as "chart" | "table")}
              aria-label={t("charts.view")}
              className="rounded-md border p-0.5"
            >
              <ToggleGroupItem value="chart" aria-label={t("charts.viewChart")} className="min-h-11 min-w-11 px-2 lg:min-h-7 lg:min-w-7" data-testid={props.testId ? `${props.testId}-view-chart` : undefined}>
                <BarChart3 className="size-4" aria-hidden="true" />
              </ToggleGroupItem>
              <ToggleGroupItem value="table" aria-label={t("charts.viewTable")} className="min-h-11 min-w-11 px-2 lg:min-h-7 lg:min-w-7" data-testid={props.testId ? `${props.testId}-view-table` : undefined}>
                <Table2 className="size-4" aria-hidden="true" />
              </ToggleGroupItem>
            </ToggleGroup>
          )}
          {props.exportSpec && <ExportMenu spec={props.exportSpec} {...(props.testId ? { testId: `${props.testId}-export` } : {})} />}
        </div>
      </div>
      <div className={cn("min-w-0 transition-opacity", props.refreshing && "opacity-60")} aria-busy={props.loading || props.refreshing || undefined}>
        {body}
      </div>
      {props.footer && !props.loading && !props.error && <div className="text-xs text-muted-foreground">{props.footer}</div>}
    </Card>
  );
}
