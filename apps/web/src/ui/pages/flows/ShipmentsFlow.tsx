import { CheckCircle, Eye, Printer, RefreshCw, Search, Truck } from "lucide-react";
import { cx, shipmentStatusLabel, cargoProviderLabel, FlowPanel, DetailPanel, Metric, DataRows } from "../../app/shared.js";
import type { DashboardController } from "../../app/useDashboardController.js";
import { localeFor, useLanguage, useT } from "../../i18n/index.js";
import { shipmentsMessages } from "../../i18n/messages/shipments.js";

export function ShipmentsFlow({ ctx }: { ctx: DashboardController }) {
  const {
    activeShipmentCount,
    data,
    deliveredShipmentCount,
    handleApplyShipmentFilter,
    handleOpenShipmentDetail,
    handleSearchShipments,
    handleShipmentPage,
    handleTrackShipment,
    handleUpdateShipment,
    lastShipmentTrack,
    otherShipmentCount,
    pttNotDeliveredCount,
    pttShipmentCount,
    selectedShipment,
    setPrintShipmentId,
    setShipmentSearch,
    shipmentFilter,
    shipmentOffsetEnd,
    shipmentOffsetStart,
    shipmentPage,
    shipmentPageCount,
    shipmentSearch,
    shipmentTotalCount,
    suratNotDeliveredCount,
    suratShipmentCount,
    trackingMissingCount,
    trackingShipmentId,
  } = ctx;
  const t = useT(shipmentsMessages);
  const { language } = useLanguage();

  return (
    <FlowPanel title={t("title")} icon={<Truck size={18} />} testId="shipments-flow">
            <div className="report-grid">
              <Metric title="PTT Kargo" value={String(pttShipmentCount)} />
              <Metric title="Sürat Kargo" value={String(suratShipmentCount)} />
              <Metric title={t("metricInTransit")} value={String(activeShipmentCount)} />
              <Metric title={t("metricDelivered")} value={String(deliveredShipmentCount)} />
            </div>
            <form className="filter-grid" onSubmit={(event) => void handleSearchShipments(event)}>
              <label className="field-label" htmlFor="shipment-search">
                {t("searchLabel")}
              </label>
              <div className="search-row">
                <Search size={16} />
                <input
                  data-testid="shipment-search"
                  id="shipment-search"
                  placeholder={t("searchPlaceholder")}
                  type="search"
                  value={shipmentSearch}
                  onChange={(event) => setShipmentSearch(event.target.value)}
                />
                <button className="secondary-action" type="submit">
                  {t("searchButton")}
                </button>
              </div>
            </form>
            <div className="detail-actions" data-testid="shipment-section-tabs">
              <button
                className={cx("secondary-action", shipmentFilter === "all" && "selected")}
                data-testid="shipment-filter-all"
                type="button"
                onClick={() => void handleApplyShipmentFilter("all")}
              >
                {t("filterAll")} {shipmentFilter === "all" ? data.shipmentSummary.total_count : t("resultsWord")}
              </button>
              <button
                className={cx("secondary-action", shipmentFilter === "ptt" && "selected")}
                data-testid="shipment-filter-ptt"
                type="button"
                onClick={() => void handleApplyShipmentFilter("ptt")}
              >
                PTT {shipmentFilter === "all" || shipmentFilter === "ptt" ? pttShipmentCount : t("resultsWord")}
              </button>
              <button
                className={cx("secondary-action", shipmentFilter === "surat" && "selected")}
                data-testid="shipment-filter-surat"
                type="button"
                onClick={() => void handleApplyShipmentFilter("surat")}
              >
                Sürat {shipmentFilter === "all" || shipmentFilter === "surat" ? suratShipmentCount : t("resultsWord")}
              </button>
              <button
                className={cx("secondary-action", shipmentFilter === "other" && "selected")}
                data-testid="shipment-filter-other"
                type="button"
                onClick={() => void handleApplyShipmentFilter("other")}
              >
                {t("filterOther")} {shipmentFilter === "all" || shipmentFilter === "other" ? otherShipmentCount : t("resultsWord")}
              </button>
              <button
                className={cx("secondary-action", shipmentFilter === "in_transit" && "selected")}
                data-testid="shipment-filter-in-transit"
                type="button"
                onClick={() => void handleApplyShipmentFilter("in_transit")}
              >
                {t("filterInTransit")} {shipmentFilter === "all" || shipmentFilter === "in_transit" ? activeShipmentCount : t("resultsWord")}
              </button>
              <button
                className={cx("secondary-action", shipmentFilter === "delivered" && "selected")}
                data-testid="shipment-filter-delivered"
                type="button"
                onClick={() => void handleApplyShipmentFilter("delivered")}
              >
                {t("filterDelivered")} {shipmentFilter === "all" || shipmentFilter === "delivered" ? deliveredShipmentCount : t("resultsWord")}
              </button>
              <button
                className={cx("secondary-action", shipmentFilter === "tracking_missing" && "selected")}
                data-testid="shipment-filter-tracking-missing"
                type="button"
                onClick={() => void handleApplyShipmentFilter("tracking_missing")}
              >
                {t("filterTrackingMissing")} {shipmentFilter === "all" || shipmentFilter === "tracking_missing" ? trackingMissingCount : t("resultsWord")}
              </button>
            </div>
            <DetailPanel title={t("filterSummaryTitle")} testId="shipment-filter-summary">
              <DataRows
                rows={[
                  [t("summaryNew"), String(activeShipmentCount), t("summaryNewHint")],
                  [t("summaryPttNotDelivered"), String(pttNotDeliveredCount), t("summaryLegacyFilter")],
                  [t("summarySuratNotDelivered"), String(suratNotDeliveredCount), t("summaryLegacyFilter")],
                  [t("summaryTrackingMissing"), String(trackingMissingCount), t("summaryBarcodeCheck")],
                ]}
              />
            </DetailPanel>
            <div className="table-wrap">
              <table className="data-table" data-testid="shipment-table">
                <thead>
                  <tr>
                    <th>{t("colProvider")}</th>
                    <th>{t("colTracking")}</th>
                    <th>{t("colCustomer")}</th>
                    <th>{t("colOrder")}</th>
                    <th>{t("colStatus")}</th>
                    <th>{t("colTransferredAt")}</th>
                    <th>{t("colAction")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.shipments.length === 0 ? (
                    <tr>
                      <td colSpan={7}>{t("emptyTable")}</td>
                    </tr>
                  ) : data.shipments.map((shipment) => (
                    <tr data-testid="shipment-row" key={shipment.public_id}>
                      <td>
                        <span className="status-pill">{cargoProviderLabel(shipment.provider)} Kargo</span>
                      </td>
                      <td>
                        <button
                          className="link-button"
                          data-testid="shipment-open-tracking"
                          type="button"
                          onClick={() => void handleOpenShipmentDetail(shipment.public_id)}
                        >
                          {shipment.tracking_number ?? shipment.barcode_number ?? t("trackingMissing")} {t("detailSuffix")}
                        </button>
                        <span className="muted-line">{shipment.last_event_text ?? t("awaitingMovement")}</span>
                      </td>
                      <td>
                        <strong>{shipment.recipient_name}</strong>
                        <span className="muted-line">
                          {[shipment.recipient_district, shipment.recipient_city].filter(Boolean).join(" / ") || shipment.customer_full_name || "-"}
                        </span>
                      </td>
                      <td>{shipment.order_number ?? shipment.customer_full_name ?? "-"}</td>
                      <td>{shipmentStatusLabel(shipment.status, language)}</td>
                      <td>{new Date(shipment.updated_at).toLocaleString(localeFor(language))}</td>
                      <td>
                        <div className="icon-actions">
                          <button
                            aria-label={t("actionDetail")}
                            className={cx("icon-button", selectedShipment?.public_id === shipment.public_id && "selected")}
                            data-testid="shipment-detail-action"
                            title={t("actionDetail")}
                            type="button"
                            onClick={() => void handleOpenShipmentDetail(shipment.public_id)}
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            aria-label={t("actionTrack")}
                            className="icon-button"
                            data-testid="shipment-track-action"
                            disabled={trackingShipmentId === shipment.public_id || !shipment.tracking_number}
                            title={t("actionTrack")}
                            type="button"
                            onClick={() => void handleTrackShipment(shipment)}
                          >
                            <RefreshCw className={trackingShipmentId === shipment.public_id ? "spin" : undefined} size={16} />
                          </button>
                          <button
                            aria-label={selectedShipment?.public_id === shipment.public_id ? t("actionMarkDelivered") : t("actionSelectDetailFirst")}
                            className="icon-button"
                            data-testid="shipment-status-action"
                            disabled={selectedShipment?.public_id !== shipment.public_id}
                            title={selectedShipment?.public_id === shipment.public_id ? t("actionMarkDelivered") : t("actionSelectDetailFirst")}
                            type="button"
                            onClick={() => void handleUpdateShipment()}
                          >
                            <CheckCircle size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination-row" data-testid="shipment-pagination">
              <span>
                {shipmentOffsetStart}-{shipmentOffsetEnd} / {shipmentTotalCount}
              </span>
              <div className="detail-actions">
                <button
                  className="secondary-action"
                  data-testid="shipment-prev-page"
                  disabled={shipmentPage === 0}
                  type="button"
                  onClick={() => void handleShipmentPage(shipmentPage - 1)}
                >
                  {t("previous")}
                </button>
                <span>{t("pageOf", { page: shipmentPage + 1, count: shipmentPageCount })}</span>
                <button
                  className="secondary-action"
                  data-testid="shipment-next-page"
                  disabled={shipmentPage + 1 >= shipmentPageCount}
                  type="button"
                  onClick={() => void handleShipmentPage(shipmentPage + 1)}
                >
                  {t("next")}
                </button>
              </div>
            </div>
            {lastShipmentTrack && <p className="status-copy" data-testid="shipment-track-result">{lastShipmentTrack}</p>}
            {selectedShipment && (
              <DetailPanel title={t("detailTitle")} testId="shipment-detail">
                <DataRows
                  rows={[
                    [t("rowTrackingNo"), selectedShipment.tracking_number ?? "-", selectedShipment.provider],
                    [t("rowRecipient"), selectedShipment.recipient_name, selectedShipment.recipient_phone ?? "-"],
                    [
                      t("rowAddress"),
                      [selectedShipment.recipient_district, selectedShipment.recipient_city].filter(Boolean).join(" / ") || "-",
                      selectedShipment.barcode_number ?? "-",
                    ],
                    [t("rowLastEvent"), selectedShipment.last_event_text ?? "-", selectedShipment.status],
                    [t("rowOrder"), selectedShipment.order_number ?? "-", selectedShipment.customer_full_name ?? "-"],
                    [t("rowBarcode"), selectedShipment.barcode_number ?? t("barcodePending"), "shipments API"],
                  ]}
                />
                <div className="detail-actions">
                  {selectedShipment.tracking_number || selectedShipment.barcode_number ? (
                    <button
                      className="kargo-yazdir-button"
                      data-testid="kargo-yazdir"
                      title={t("printTitle")}
                      type="button"
                      onClick={() => setPrintShipmentId(selectedShipment.public_id)}
                    >
                      <Printer size={14} aria-hidden="true" /> {t("print")}
                    </button>
                  ) : (
                    <span className="kargo-muted">{t("transferFirst")}</span>
                  )}
                </div>
                <div className="timeline" data-testid="shipment-tracking-history">
                  <h3>{t("historyTitle")}</h3>
                  {(selectedShipment.tracking_events ?? []).length === 0 ? (
                    <p>{t("noEvents")}</p>
                  ) : (
                    selectedShipment.tracking_events.map((event) => (
                      <div className="timeline-item" key={event.public_id}>
                        <strong>{event.description ?? shipmentStatusLabel(event.status, language)}</strong>
                        <span>{event.location ?? "-"}</span>
                        <span>{new Date(event.occurred_at).toLocaleString(localeFor(language))}</span>
                      </div>
                    ))
                  )}
                </div>
              </DetailPanel>
            )}
          </FlowPanel>
  );
}

