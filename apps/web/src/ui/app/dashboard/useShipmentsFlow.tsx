import { useCallback, useRef, useState, type FormEvent } from "react";
import { type ShipmentSummary } from "../../../api/domain-client.js";
import { type ShipmentPipelineFilter, type ShipmentFilter, shipmentPageSize, shipmentFilterParams, shipmentMatchesFilter } from "../shared.js";
import { uiMessage, type UiMessage } from "../../i18n/messages/status.js";
import type { DashboardCore } from "./types.js";

export type ShipmentNotice = { kind: "exported"; count: number } | { kind: "trackingQueued" } | { kind: "trackingFailed"; message: string };

/** Shipments flow: list filters/search/paging, detail, delivery update, tracking and the pipeline tab. */
export function useShipmentsFlow(core: DashboardCore) {
  const { domain, admin, user, data, setData, setStatus } = core;
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
  const [printShipmentId, setPrintShipmentId] = useState<string | null>(null);
  const [shipmentFilter, setShipmentFilter] = useState<ShipmentFilter>("all");
  const [shipmentSearch, setShipmentSearch] = useState("");
  const [shipmentPage, setShipmentPage] = useState(0);
  const [shipmentTotalCount, setShipmentTotalCount] = useState(0);
  const [trackingShipmentId, setTrackingShipmentId] = useState<string | null>(null);
  const [lastShipmentTrack, setLastShipmentTrack] = useState<string | null>(null);
  const [shipmentPipelineFilter, setShipmentPipelineFilter] = useState<ShipmentPipelineFilter>("all");
  const shipmentFilterRequestSeqRef = useRef(0);
  // Legacy KargolarPage context filters (tarih, personel), selection, Excel and "Takipleri Güncelle".
  const [shipmentCreatedFrom, setShipmentCreatedFrom] = useState("");
  const [shipmentCreatedTo, setShipmentCreatedTo] = useState("");
  const [shipmentPersonnel, setShipmentPersonnel] = useState("");
  const [selectedShipmentIds, setSelectedShipmentIds] = useState<Set<string>>(() => new Set());
  const [trackingRefreshing, setTrackingRefreshing] = useState(false);
  const [shipmentNotice, setShipmentNotice] = useState<ShipmentNotice | null>(null);

  function contextParams(overrides: { createdFrom?: string; createdTo?: string; personnel?: string } = {}) {
    const from = overrides.createdFrom ?? shipmentCreatedFrom;
    const to = overrides.createdTo ?? shipmentCreatedTo;
    const personnel = overrides.personnel ?? shipmentPersonnel;
    return {
      ...(from ? { created_from: from } : {}),
      ...(to ? { created_to: to } : {}),
      ...(personnel ? { created_by_user_public_id: personnel } : {}),
    };
  }

  const refreshShipments = useCallback(async (options: { page?: number; filter?: ShipmentFilter; search?: string; createdFrom?: string; createdTo?: string; personnel?: string } = {}) => {
    const nextPage = options.page ?? shipmentPage;
    const nextFilter = options.filter ?? shipmentFilter;
    const nextSearch = options.search ?? shipmentSearch;
    const trimmedSearch = nextSearch.trim();
    setSelectedShipmentIds(new Set());
    const shipments = await domain.listShipments({
      ...shipmentFilterParams(nextFilter),
      ...contextParams(options),
      ...(trimmedSearch ? { search: trimmedSearch } : {}),
      limit: shipmentPageSize,
      offset: nextPage * shipmentPageSize,
    });
    setData((current) => ({
      ...current,
      shipments: shipments.data,
    }));
    setShipmentTotalCount(shipments.meta?.total_count ?? shipments.data.length);
    setSelectedShipmentId((current) => shipments.data.some((shipment) => shipment.public_id === current)
      ? current
      : shipments.data[0]?.public_id ?? null);
    return shipments;
  }, [domain, shipmentFilter, shipmentPage, shipmentSearch, shipmentCreatedFrom, shipmentCreatedTo, shipmentPersonnel]);

  async function handleApplyShipmentFilter(nextFilter: ShipmentFilter) {
    const requestSeq = shipmentFilterRequestSeqRef.current + 1;
    shipmentFilterRequestSeqRef.current = requestSeq;
    setShipmentFilter(nextFilter);
    setShipmentPage(0);
    setStatus(uiMessage("shipmentFiltersApplying"));
    const trimmedSearch = shipmentSearch.trim();
    setSelectedShipmentIds(new Set());
    const shipments = await domain.listShipments({
      ...shipmentFilterParams(nextFilter),
      ...contextParams(),
      ...(trimmedSearch ? { search: trimmedSearch } : {}),
      limit: shipmentPageSize,
      offset: 0,
    });
    if (shipmentFilterRequestSeqRef.current !== requestSeq) return;
    setData((current) => ({
      ...current,
      shipments: shipments.data,
    }));
    setShipmentTotalCount(shipments.meta?.total_count ?? shipments.data.length);
    setSelectedShipmentId(shipments.data[0]?.public_id ?? null);
    setStatus(uiMessage("shipmentFiltersApplied"));
  }

  async function handleSearchShipments(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestSeq = shipmentFilterRequestSeqRef.current + 1;
    shipmentFilterRequestSeqRef.current = requestSeq;
    setShipmentPage(0);
    setStatus(uiMessage("shipmentSearchApplying"));
    const shipments = await refreshShipments({ page: 0 });
    if (shipmentFilterRequestSeqRef.current !== requestSeq) return;
    setSelectedShipmentId(shipments.data[0]?.public_id ?? null);
    setStatus(uiMessage("shipmentSearchApplied"));
  }

  async function handleShipmentPage(nextPage: number) {
    const boundedPage = Math.max(0, nextPage);
    const requestSeq = shipmentFilterRequestSeqRef.current + 1;
    shipmentFilterRequestSeqRef.current = requestSeq;
    setShipmentPage(boundedPage);
    setStatus(uiMessage("shipmentPageLoading"));
    const shipments = await refreshShipments({ page: boundedPage });
    if (shipmentFilterRequestSeqRef.current !== requestSeq) return;
    setSelectedShipmentId(shipments.data[0]?.public_id ?? null);
    setStatus(uiMessage("shipmentPageLoaded"));
  }

  async function handleOpenShipmentDetail(shipmentPublicId: string) {
    setSelectedShipmentId(shipmentPublicId);
    setStatus(uiMessage("shipmentDetailLoading"));
    try {
      const shipment = await domain.getShipment(shipmentPublicId);
      setData((current) => ({
        ...current,
        shipments: current.shipments.map((item) => (item.public_id === shipment.public_id ? shipment : item)),
      }));
      setStatus(uiMessage("shipmentDetailLoaded"));
    } catch {
      setStatus(uiMessage("shipmentDetailFromList"));
    }
  }

  async function handleShipmentContextFilter(patch: { createdFrom?: string; createdTo?: string; personnel?: string }) {
    if (patch.createdFrom !== undefined) setShipmentCreatedFrom(patch.createdFrom);
    if (patch.createdTo !== undefined) setShipmentCreatedTo(patch.createdTo);
    if (patch.personnel !== undefined) setShipmentPersonnel(patch.personnel);
    setShipmentPage(0);
    await refreshShipments({ page: 0, ...patch });
  }

  function toggleShipmentSelection(publicId: string) {
    setSelectedShipmentIds((current) => {
      const next = new Set(current);
      if (next.has(publicId)) next.delete(publicId);
      else next.add(publicId);
      return next;
    });
  }

  function toggleAllVisibleShipments() {
    setSelectedShipmentIds((current) => {
      const ids = data.shipments.map((shipment) => shipment.public_id);
      return ids.length > 0 && ids.every((id) => current.has(id)) ? new Set() : new Set(ids);
    });
  }

  /** Legacy Excel: "liste" (ad, telefon, il) or "telefon" (telefon, ad) for the selection or every filtered row. */
  async function handleExportShipments(format: "liste" | "telefon", scope: "selected" | "filtered") {
    let rows = data.shipments.filter((shipment) => selectedShipmentIds.has(shipment.public_id));
    if (scope === "filtered") {
      const trimmedSearch = shipmentSearch.trim();
      rows = (await domain.listShipments({ ...shipmentFilterParams(shipmentFilter), ...contextParams(), ...(trimmedSearch ? { search: trimmedSearch } : {}), limit: 200, offset: 0 })).data;
    }
    const headers = format === "telefon" ? ["Telefon", "Ad Soyad"] : ["Ad Soyad", "Telefon", "İl", "İlçe", "Kargo", "Takip No", "Sipariş No", "Durum", "Son Hareket"];
    const body = rows.map((shipment) =>
      format === "telefon"
        ? [shipment.recipient_phone ?? "", shipment.recipient_name]
        : [shipment.recipient_name, shipment.recipient_phone ?? "", shipment.recipient_city ?? "", shipment.recipient_district ?? "", shipment.provider, shipment.tracking_number ?? shipment.barcode_number ?? "", shipment.order_number ?? "", shipment.status, shipment.last_event_text ?? ""],
    );
    const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const table = [headers, ...body].map((row) => `<tr>${row.map((cell) => `<td>${escape(String(cell))}</td>`).join("")}</tr>`).join("");
    const url = URL.createObjectURL(new Blob([`<html><head><meta charset="utf-8" /></head><body><table>${table}</table></body></html>`], { type: "application/vnd.ms-excel;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kargolar-${format}-${new Date().toISOString().slice(0, 10)}.xls`;
    anchor.click();
    URL.revokeObjectURL(url);
    setShipmentNotice({ kind: "exported", count: rows.length });
  }

  /** Legacy "Takipleri Güncelle": PTT + Sürat tracking cron (dry-run unless the live gates are open). */
  async function handleRefreshAllTracking() {
    if (trackingRefreshing) return;
    setTrackingRefreshing(true);
    try {
      const key = `kargo_takip_${Date.now()}`;
      await Promise.all([admin.triggerProviderCronDebug("ptt", { idempotency_key: `${key}_ptt` }), admin.triggerProviderCronDebug("surat", { idempotency_key: `${key}_surat` })]);
      setShipmentNotice({ kind: "trackingQueued" });
    } catch (error) {
      setShipmentNotice({ kind: "trackingFailed", message: error instanceof Error ? error.message : "" });
    } finally {
      setTrackingRefreshing(false);
    }
  }

  function handleApplyShipmentPipelineFilter(nextFilter: ShipmentPipelineFilter) {
    setShipmentPipelineFilter(nextFilter);
    setStatus(uiMessage("pipelineTabApplied"));
  }

  async function handleUpdateShipment() {
    const shipment = selectedShipment;
    if (!shipment) return;

    setStatus(uiMessage("shipmentStatusUpdating"));
    const updated = await domain.updateShipmentStatus(shipment.public_id, {
      status: "delivered",
      last_event_text: "Frontend teslim kaniti",
      raw_payload: null,
    });
    const shipmentPipeline = await domain.getShipmentPipelineSummary();
    if (shipmentFilter !== "all") {
      const trimmedSearch = shipmentSearch.trim();
      const shipments = await domain.listShipments({
        ...shipmentFilterParams(shipmentFilter),
        ...(trimmedSearch ? { search: trimmedSearch } : {}),
        limit: shipmentPageSize,
        offset: shipmentPage * shipmentPageSize,
      });
      const updatedStillVisible = shipmentMatchesFilter(updated, shipmentFilter);
      const refreshedRows = updatedStillVisible
        ? [updated, ...shipments.data.filter((item) => item.public_id !== updated.public_id)]
        : shipments.data;
      setData((current) => ({
        ...current,
        shipments: refreshedRows,
        shipmentPipeline,
      }));
      setShipmentTotalCount(shipments.meta?.total_count ?? refreshedRows.length);
      setSelectedShipmentId(updatedStillVisible ? updated.public_id : refreshedRows[0]?.public_id ?? null);
      setStatus(uiMessage("shipmentStatusUpdated"));
      return;
    }
    setData((current) => ({
      ...current,
      shipments: current.shipments.map((item) => (item.public_id === updated.public_id ? updated : item)),
      shipmentPipeline,
    }));
    setSelectedShipmentId(updated.public_id);
    setStatus(uiMessage("shipmentStatusUpdated"));
  }

  async function handleTrackShipment(shipment: ShipmentSummary) {
    if (trackingShipmentId) return;

    setStatus(uiMessage("trackingQueueing"));
    setTrackingShipmentId(shipment.public_id);
    try {
      const result = await domain.trackShipment(shipment.public_id, {
        idempotency_key: `track_${shipment.public_id}_${Date.now()}`,
      });
      setLastShipmentTrack(`${result.provider} ${result.operation} ${result.queued ? "queued" : "dry-run"} ${result.request_id}`);
      setStatus(uiMessage("trackingQueued", { gate: result.live_gate }));
    } finally {
      setTrackingShipmentId(null);
    }
  }

  const selectedShipment = data.shipments.find((shipment) => shipment.public_id === selectedShipmentId) ?? data.shipments[0] ?? null;
  const shipmentPageCount = Math.max(1, Math.ceil(shipmentTotalCount / shipmentPageSize));
  const shipmentOffsetStart = shipmentTotalCount === 0 ? 0 : shipmentPage * shipmentPageSize + 1;
  const shipmentOffsetEnd = Math.min((shipmentPage + 1) * shipmentPageSize, shipmentTotalCount);
  const deliveredShipmentCount = data.shipmentSummary.delivered_count;
  const activeShipmentCount = data.shipmentSummary.active_count;
  const pttShipmentCount = data.shipmentSummary.provider_counts.ptt;
  const suratShipmentCount = data.shipmentSummary.provider_counts.surat;
  const pttNotDeliveredCount = data.shipmentSummary.exception_counts.ptt_not_delivered;
  const suratNotDeliveredCount = data.shipmentSummary.exception_counts.surat_not_delivered;
  const trackingMissingCount = data.shipmentSummary.exception_counts.tracking_missing;
  const otherShipmentCount = data.shipmentSummary.provider_counts.other;
  const visibleShipmentPipelineRows = data.shipmentPipeline.rows.filter(
    (row) => shipmentPipelineFilter === "all" || row.step === shipmentPipelineFilter,
  );
  const pipelineMessageCount = data.shipmentPipeline.counts.mesaj;
  const pipelineSmsCount = data.shipmentPipeline.counts.sms;
  const pipelineVapiCount = data.shipmentPipeline.counts.vapi;
  const pipelineWaitingCount = data.shipmentPipeline.counts.bekliyor;
  const pipelineProcessingCount = data.shipmentPipeline.counts.isleniyor;
  const pipelineErrorCount = data.shipmentPipeline.counts.hata;
  const pipelineDeliveredCount = data.shipmentPipeline.counts.teslim;
  const shipmentPipelineFilters: Array<{ value: ShipmentPipelineFilter; label: UiMessage; count: number }> = [
    { value: "all", label: uiMessage("pipelineTabAll"), count: data.shipmentPipeline.counts.all },
    { value: "mesaj", label: uiMessage("pipelineTabMessage"), count: pipelineMessageCount },
    { value: "sms", label: uiMessage("pipelineTabSms"), count: pipelineSmsCount },
    { value: "vapi", label: uiMessage("pipelineTabVapi"), count: pipelineVapiCount },
    { value: "teslim", label: uiMessage("pipelineTabDelivered"), count: pipelineDeliveredCount },
  ];

  /** Shipments part of the logout reset. */
  function resetShipments() {
    setSelectedShipmentIds(new Set());
    setShipmentCreatedFrom("");
    setShipmentCreatedTo("");
    setShipmentPersonnel("");
    setShipmentNotice(null);
    setSelectedShipmentId(null);
    setShipmentFilter("all");
    setShipmentSearch("");
    setShipmentPage(0);
    setShipmentTotalCount(0);
    setTrackingShipmentId(null);
    setLastShipmentTrack(null);
  }

  return {
    selectedShipmentId,
    setSelectedShipmentId,
    printShipmentId,
    setPrintShipmentId,
    shipmentFilter,
    setShipmentFilter,
    shipmentSearch,
    setShipmentSearch,
    shipmentPage,
    setShipmentPage,
    shipmentTotalCount,
    setShipmentTotalCount,
    trackingShipmentId,
    setTrackingShipmentId,
    lastShipmentTrack,
    setLastShipmentTrack,
    shipmentPipelineFilter,
    setShipmentPipelineFilter,
    shipmentFilterRequestSeqRef,
    refreshShipments,
    handleApplyShipmentFilter,
    handleSearchShipments,
    handleShipmentPage,
    handleOpenShipmentDetail,
    handleApplyShipmentPipelineFilter,
    handleUpdateShipment,
    handleTrackShipment,
    selectedShipment,
    shipmentPageCount,
    shipmentOffsetStart,
    shipmentOffsetEnd,
    deliveredShipmentCount,
    activeShipmentCount,
    pttShipmentCount,
    suratShipmentCount,
    pttNotDeliveredCount,
    suratNotDeliveredCount,
    trackingMissingCount,
    otherShipmentCount,
    visibleShipmentPipelineRows,
    pipelineMessageCount,
    pipelineSmsCount,
    pipelineVapiCount,
    pipelineWaitingCount,
    pipelineProcessingCount,
    pipelineErrorCount,
    pipelineDeliveredCount,
    shipmentPipelineFilters,
    resetShipments,
    shipmentCreatedFrom,
    shipmentCreatedTo,
    shipmentPersonnel,
    selectedShipmentIds,
    trackingRefreshing,
    shipmentNotice,
    canRefreshAllTracking: user?.role === "admin" || user?.role === "owner",
    handleShipmentContextFilter,
    toggleShipmentSelection,
    toggleAllVisibleShipments,
    handleExportShipments,
    handleRefreshAllTracking,
  };
}
