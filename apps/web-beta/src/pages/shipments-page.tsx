import type { ShipmentSummary } from "@garanti-kulucka/shared";
import { CheckCircle2, Download, Printer, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { panelRoleOf } from "@garanti-kulucka/shared";
import { DataList, ErrorState, Pagination, StatusBadge, type Column } from "@/components/data-list";
import { FilterSelect, ListToolbar } from "@/components/list-toolbar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageHeader } from "@/layout/page-header";
import type { ShipmentListQuery } from "@/lib/api";
import { carrierLabel, formatDateTime } from "@/lib/format";
import { pageCount, pageSize, useListParams } from "@/lib/list-params";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { errorText, FeedbackLine, idempotencyKey, type Feedback } from "./accounting-shared";
import { ShipmentPrintOverlay } from "./shipment-print";

const shipmentStatuses = ["in_transit", "delivered", "returned"] as const;
/** Legacy KargolarPage single filter: tümü / ptt_almayan / surat_almayan / yeni / sevk_edildi / takip_no_yok. */
const views = ["all", "ptt_not_received", "surat_not_received", "new", "shipped", "tracking_missing"] as const;

function viewQuery(view: string): Partial<ShipmentListQuery> {
  if (view === "ptt_not_received") return { not_received: "ptt" };
  if (view === "surat_not_received") return { not_received: "surat" };
  if (view === "new") return { stage: "new" };
  if (view === "shipped") return { stage: "shipped" };
  if (view === "tracking_missing") return { tracking_missing: true };
  return {};
}

/** Legacy Excel: "liste" (ad, telefon, il) or "telefon" (telefon, ad). */
function downloadExcel(rows: ShipmentSummary[], format: "liste" | "telefon") {
  const headers = format === "telefon" ? ["Telefon", "Ad Soyad"] : ["Ad Soyad", "Telefon", "İl", "İlçe", "Kargo", "Takip No", "Sipariş No", "Durum", "Son Hareket"];
  const body = rows.map((row) =>
    format === "telefon"
      ? [row.recipient_phone ?? "", row.recipient_name ?? ""]
      : [row.recipient_name ?? "", row.recipient_phone ?? "", row.recipient_city ?? "", row.recipient_district ?? "", row.provider, row.tracking_number ?? row.barcode_number ?? "", row.order_number ?? "", row.status, row.last_event_text ?? ""],
  );
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const table = [headers, ...body].map((row) => `<tr>${row.map((cell) => `<td>${escape(String(cell))}</td>`).join("")}</tr>`).join("");
  const url = URL.createObjectURL(new Blob([`<html><head><meta charset="utf-8" /></head><body><table>${table}</table></body></html>`], { type: "application/vnd.ms-excel;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `kargolar-${format}-${new Date().toISOString().slice(0, 10)}.xls`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ShipmentsPage() {
  const { t, i18n } = useTranslation();
  const { api, user } = useAuth();
  const manager = panelRoleOf(user?.role) === "manager";
  const list = useListParams(["status", "provider", "view", "from", "to"] as const);
  const { status, provider, view, from, to } = list.filters;
  const query: ShipmentListQuery = {
    ...(list.query ? { search: list.query } : {}),
    ...(status !== "all" ? { status } : {}),
    ...(provider !== "all" ? { provider } : {}),
    ...viewQuery(view),
    ...(from !== "all" ? { created_from: from } : {}),
    ...(to !== "all" ? { created_to: to } : {}),
  };
  const key = JSON.stringify({ query, page: list.page });
  const { data, error, loading, reload } = useQuery(`shipments:${key}`, () => api.listShipments({ ...query, limit: pageSize, offset: list.offset }));
  const rows = data?.data ?? [];
  const total = data?.meta?.total_count ?? rows.length;
  const other = t("shipments.otherProvider");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<string | null>(null);
  const [printIds, setPrintIds] = useState<string[] | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => setSelected(new Set()), [key]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allVisible = rows.length > 0 && rows.every((row) => selected.has(row.public_id));
  const label = (row: ShipmentSummary) => row.tracking_number ?? row.barcode_number ?? t("common.none");

  async function exportRows(format: "liste" | "telefon", scope: "selected" | "filtered") {
    const exportRows = scope === "selected" ? rows.filter((row) => selected.has(row.public_id)) : (await api.listShipments({ ...query, limit: 200, offset: 0 })).data;
    downloadExcel(exportRows, format);
    setFeedback({ tone: "success", text: t("shipments.exported", { count: exportRows.length }) });
  }

  async function refreshAllTracking() {
    setRefreshing(true);
    setFeedback(null);
    try {
      const base = idempotencyKey("kargo_takip");
      await Promise.all([api.triggerTrackingCron("ptt", `${base}_ptt`), api.triggerTrackingCron("surat", `${base}_surat`)]);
      setFeedback({ tone: "success", text: t("shipments.trackingQueued") });
    } catch (reason) {
      setFeedback({ tone: "error", text: t("shipments.failed", { error: errorText(reason) }) });
    } finally {
      setRefreshing(false);
    }
  }

  const columns: Column<ShipmentSummary>[] = [
    {
      key: "select",
      header: "",
      mobile: "hidden",
      className: "w-10",
      cell: (row) => <input type="checkbox" className="size-5 accent-primary" aria-label={t("shipments.selectRow", { tracking: label(row) })} checked={selected.has(row.public_id)} onChange={() => toggle(row.public_id)} data-testid="shipment-select" />,
    },
    {
      key: "tracking",
      header: t("shipments.tracking"),
      mobile: "title",
      cell: (row) => (
        <span className="flex items-center gap-3">
          <input type="checkbox" className="h-11 w-5 shrink-0 accent-primary md:hidden" aria-label={t("shipments.selectRow", { tracking: label(row) })} checked={selected.has(row.public_id)} onChange={() => toggle(row.public_id)} />
          <button type="button" className="inline-flex min-h-11 min-w-11 items-center font-medium text-primary underline-offset-4 hover:underline md:min-h-0 md:min-w-0" onClick={() => setDetail(row.public_id)} data-testid="shipment-open">
            {label(row)}
          </button>
        </span>
      ),
    },
    { key: "status", header: t("shipments.status"), mobile: "badge", cell: (row) => <StatusBadge value={row.status} /> },
    { key: "recipient", header: t("shipments.recipient"), cell: (row) => row.recipient_name ?? row.customer_full_name ?? t("common.none") },
    { key: "provider", header: t("shipments.provider"), cell: (row) => carrierLabel(row.provider, other) },
    { key: "location", header: t("shipments.location"), cell: (row) => [row.recipient_district, row.recipient_city].filter(Boolean).join(", ") || t("common.none") },
    { key: "order", header: t("shipments.order"), cell: (row) => row.order_number ?? t("common.none") },
    { key: "event", header: t("shipments.lastEvent"), cell: (row) => <span title={row.last_event_text ?? undefined}>{row.last_event_text ?? t("common.none")}</span> },
    { key: "updated", header: t("messages.updated"), mobile: "hidden", cell: (row) => formatDateTime(row.updated_at, i18n.language) },
  ];

  return (
    <section data-testid="page-shipments">
      <PageHeader
        title={t("shipments.title")}
        description={t("shipments.subtitle")}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="min-h-11" data-testid="shipments-export">
                  <Download className="size-4" aria-hidden="true" />
                  {t("shipments.export")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(["selected", "filtered"] as const).map((scope, index) => (
                  <div key={scope}>
                    {index > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel>{t(scope === "selected" ? "shipments.exportSelected" : "shipments.exportFiltered")}</DropdownMenuLabel>
                    {(["liste", "telefon"] as const).map((format) => (
                      <DropdownMenuItem
                        key={format}
                        className="min-h-10"
                        disabled={scope === "selected" && selected.size === 0}
                        onSelect={() => void exportRows(format, scope)}
                        data-testid={`shipments-export-${scope}-${format}`}
                      >
                        {t(format === "liste" ? "shipments.exportList" : "shipments.exportPhone")}
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {manager && (
              <Button variant="outline" className="min-h-11" disabled={refreshing} onClick={() => void refreshAllTracking()} data-testid="shipments-refresh-tracking">
                <RefreshCw className={cn("size-4", refreshing && "animate-spin")} aria-hidden="true" />
                {t("shipments.refreshAllTracking")}
              </Button>
            )}
          </>
        }
      />
      <ListToolbar query={list.query} placeholder={t("shipments.searchPlaceholder")} onQuery={(q) => list.update({ q })} hasFilters={list.hasFilters} onClear={list.clear}>
        <FilterSelect
          testId="filter-view"
          label={t("shipments.view")}
          value={view}
          onChange={(value) => list.update({ view: value })}
          options={views.map((value) => ({ value, label: t(`shipments.view_${value}`) }))}
        />
        <FilterSelect
          testId="filter-provider"
          label={t("shipments.provider")}
          value={provider}
          onChange={(value) => list.update({ provider: value })}
          options={[
            { value: "all", label: `${t("shipments.provider")}: ${t("common.all")}` },
            { value: "ptt", label: "PTT" },
            { value: "surat", label: "Sürat" },
            { value: "other", label: other },
          ]}
        />
        <FilterSelect
          testId="filter-status"
          label={t("shipments.status")}
          value={status}
          onChange={(value) => list.update({ status: value })}
          options={[{ value: "all", label: `${t("shipments.status")}: ${t("common.all")}` }, ...shipmentStatuses.map((value) => ({ value, label: t(`status.${value}`) }))]}
        />
        <Input type="date" className="h-11 sm:w-40 md:h-9" aria-label={t("shipments.dateFrom")} value={from === "all" ? "" : from} onChange={(event) => list.update({ from: event.target.value || null })} data-testid="filter-from" />
        <Input type="date" className="h-11 sm:w-40 md:h-9" aria-label={t("shipments.dateTo")} value={to === "all" ? "" : to} onChange={(event) => list.update({ to: event.target.value || null })} data-testid="filter-to" />
      </ListToolbar>
      <div className="mb-3 flex flex-col gap-2">
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/50 p-2" data-testid="shipments-bulk-bar">
            <span className="px-1 text-sm font-medium">{t("shipments.selectedCount", { count: selected.size })}</span>
            <Button variant="outline" className="min-h-11" onClick={() => setPrintIds([...selected])} data-testid="shipments-bulk-print">
              <Printer className="size-4" aria-hidden="true" />
              {t("shipments.bulkPrint")}
            </Button>
            <Button variant="ghost" className="min-h-11" onClick={() => setSelected(new Set())}>
              <X className="size-4" aria-hidden="true" />
              {t("shipments.clearSelection")}
            </Button>
          </div>
        )}
        {rows.length > 0 && (
          <Button variant="ghost" className="min-h-11 self-start" onClick={() => setSelected(allVisible ? new Set() : new Set(rows.map((row) => row.public_id)))} data-testid="shipments-select-all">
            {allVisible ? t("shipments.clearSelection") : t("shipments.selectAllVisible")}
          </Button>
        )}
        <FeedbackLine feedback={feedback} testId="shipments-feedback" />
      </div>
      {error && !data ? (
        <ErrorState onRetry={reload} />
      ) : (
        <>
          <DataList testId="shipments" rows={rows} columns={columns} rowKey={(row) => row.public_id} loading={loading} />
          {total > 0 && <Pagination page={list.page} pages={pageCount(total)} total={total} onPage={(page) => list.update({ page }, false)} />}
        </>
      )}
      <ShipmentDetailSheet publicId={detail} onClose={() => setDetail(null)} onChanged={reload} onPrint={(id) => {
          // The sheet is modal (outside content is inert); close it so the print overlay stays interactive.
          setDetail(null);
          setPrintIds([id]);
        }}
      />
      {printIds && <ShipmentPrintOverlay ids={printIds} onClose={() => setPrintIds(null)} />}
    </section>
  );
}

/** Legacy kargo detay: alıcı, adres, barkod, hareket geçmişi, takibi güncelle, teslim edildi, barkodlu fatura yazdır. */
function ShipmentDetailSheet({ publicId, onClose, onChanged, onPrint }: { publicId: string | null; onClose: () => void; onChanged: () => void; onPrint: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [shipment, setShipment] = useState<ShipmentSummary | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setShipment(null);
    setFeedback(null);
    if (!publicId) return;
    let active = true;
    api
      .getShipment(publicId)
      .then((row) => active && setShipment(row))
      .catch((reason: unknown) => active && setFeedback({ tone: "error", text: errorText(reason) }));
    return () => {
      active = false;
    };
  }, [api, publicId]);

  async function track() {
    if (!shipment) return;
    setBusy("track");
    try {
      const result = await api.trackShipment(shipment.public_id, idempotencyKey(`track_${shipment.public_id}`));
      setFeedback({ tone: "success", text: t("shipments.trackQueued", { gate: result.live_gate }) });
    } catch (reason) {
      setFeedback({ tone: "error", text: t("shipments.failed", { error: errorText(reason) }) });
    } finally {
      setBusy(null);
    }
  }

  async function markDelivered() {
    if (!shipment) return;
    setBusy("delivered");
    try {
      setShipment(await api.updateShipmentStatus(shipment.public_id, { status: "delivered", last_event_text: "Panelden teslim edildi" }));
      setFeedback({ tone: "success", text: t("shipments.markedDelivered") });
      onChanged();
    } catch (reason) {
      setFeedback({ tone: "error", text: t("shipments.failed", { error: errorText(reason) }) });
    } finally {
      setBusy(null);
    }
  }

  const printable = Boolean(shipment?.tracking_number || shipment?.barcode_number);

  return (
    <Sheet open={publicId !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" closeLabel={t("cargoPrint.close")} className="w-[min(32rem,100vw)] overflow-y-auto p-0" data-testid="shipment-detail">
        <SheetHeader className="border-b p-4 pr-14">
          <SheetTitle>{shipment ? (shipment.tracking_number ?? shipment.barcode_number ?? t("shipments.detail")) : t("shipments.detail")}</SheetTitle>
          <SheetDescription>{shipment ? `${carrierLabel(shipment.provider, t("shipments.otherProvider"))} · ${shipment.order_number ?? "-"}` : ""}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 p-4 text-sm">
          <FeedbackLine feedback={feedback} testId="shipment-detail-feedback" />
          {shipment && (
            <>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
                <dt className="text-muted-foreground">{t("shipments.recipient")}</dt>
                <dd>{shipment.recipient_name ?? "-"}</dd>
                <dt className="text-muted-foreground">{t("shipments.phone")}</dt>
                <dd>{shipment.recipient_phone ?? "-"}</dd>
                <dt className="text-muted-foreground">{t("shipments.address")}</dt>
                <dd>{[shipment.recipient_district, shipment.recipient_city].filter(Boolean).join(" / ") || "-"}</dd>
                <dt className="text-muted-foreground">{t("shipments.barcode")}</dt>
                <dd className="break-all font-mono">{shipment.barcode_number ?? "-"}</dd>
                <dt className="text-muted-foreground">{t("shipments.status")}</dt>
                <dd data-testid="shipment-detail-status">
                  <StatusBadge value={shipment.status} />
                </dd>
                <dt className="text-muted-foreground">{t("shipments.lastEvent")}</dt>
                <dd>{shipment.last_event_text ?? "-"}</dd>
              </dl>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="min-h-11" disabled={busy !== null || !shipment.tracking_number} onClick={() => void track()} data-testid="shipment-track">
                  <RefreshCw className={cn("size-4", busy === "track" && "animate-spin")} aria-hidden="true" />
                  {t("shipments.track")}
                </Button>
                <Button variant="outline" className="min-h-11" disabled={busy !== null || shipment.status === "delivered"} onClick={() => void markDelivered()} data-testid="shipment-mark-delivered">
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  {t("shipments.markDelivered")}
                </Button>
                <Button className="min-h-11" disabled={!printable} title={printable ? undefined : t("shipments.transferFirst")} onClick={() => onPrint(shipment.public_id)} data-testid="shipment-print">
                  <Printer className="size-4" aria-hidden="true" />
                  {t("shipments.print")}
                </Button>
              </div>
              <section className="flex flex-col gap-2 border-t pt-3" data-testid="shipment-history">
                <h3 className="font-semibold">{t("shipments.history")}</h3>
                {(shipment.tracking_events ?? []).length === 0 ? (
                  <p className="text-muted-foreground">{t("shipments.noEvents")}</p>
                ) : (
                  <ol className="flex flex-col gap-2">
                    {shipment.tracking_events!.map((event) => (
                      <li key={event.public_id} className="border-l-2 pl-3">
                        <p className="font-medium">{event.description ?? event.status}</p>
                        <p className="text-xs text-muted-foreground">
                          {event.location ?? "-"} · {formatDateTime(event.occurred_at, i18n.language)}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
