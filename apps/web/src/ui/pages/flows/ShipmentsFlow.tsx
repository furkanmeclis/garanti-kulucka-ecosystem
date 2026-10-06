import { CheckCircle, Eye, Printer, RefreshCw, Search, Truck } from "lucide-react";
import { cx, shipmentStatusLabel, cargoProviderLabel, FlowPanel, DetailPanel, Metric, DataRows } from "../../app/shared.js";
import type { DashboardController } from "../../app/useDashboardController.js";

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

  return (
    <FlowPanel title="Kargo Gönderileri" icon={<Truck size={18} />} testId="shipments-flow">
            <div className="report-grid">
              <Metric title="PTT Kargo" value={String(pttShipmentCount)} />
              <Metric title="Sürat Kargo" value={String(suratShipmentCount)} />
              <Metric title="Yoldaki Kargolar" value={String(activeShipmentCount)} />
              <Metric title="Teslim Edilen" value={String(deliveredShipmentCount)} />
            </div>
            <form className="filter-grid" onSubmit={(event) => void handleSearchShipments(event)}>
              <label className="field-label" htmlFor="shipment-search">
                Arama
              </label>
              <div className="search-row">
                <Search size={16} />
                <input
                  data-testid="shipment-search"
                  id="shipment-search"
                  placeholder="Takip no, müşteri veya sipariş ara..."
                  type="search"
                  value={shipmentSearch}
                  onChange={(event) => setShipmentSearch(event.target.value)}
                />
                <button className="secondary-action" type="submit">
                  Ara
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
                Tüm kargolar {shipmentFilter === "all" ? data.shipmentSummary.total_count : "sonuç"}
              </button>
              <button
                className={cx("secondary-action", shipmentFilter === "ptt" && "selected")}
                data-testid="shipment-filter-ptt"
                type="button"
                onClick={() => void handleApplyShipmentFilter("ptt")}
              >
                PTT {shipmentFilter === "all" || shipmentFilter === "ptt" ? pttShipmentCount : "sonuç"}
              </button>
              <button
                className={cx("secondary-action", shipmentFilter === "surat" && "selected")}
                data-testid="shipment-filter-surat"
                type="button"
                onClick={() => void handleApplyShipmentFilter("surat")}
              >
                Sürat {shipmentFilter === "all" || shipmentFilter === "surat" ? suratShipmentCount : "sonuç"}
              </button>
              <button
                className={cx("secondary-action", shipmentFilter === "other" && "selected")}
                data-testid="shipment-filter-other"
                type="button"
                onClick={() => void handleApplyShipmentFilter("other")}
              >
                Diğer {shipmentFilter === "all" || shipmentFilter === "other" ? otherShipmentCount : "sonuç"}
              </button>
              <button
                className={cx("secondary-action", shipmentFilter === "in_transit" && "selected")}
                data-testid="shipment-filter-in-transit"
                type="button"
                onClick={() => void handleApplyShipmentFilter("in_transit")}
              >
                Yoldaki {shipmentFilter === "all" || shipmentFilter === "in_transit" ? activeShipmentCount : "sonuç"}
              </button>
              <button
                className={cx("secondary-action", shipmentFilter === "delivered" && "selected")}
                data-testid="shipment-filter-delivered"
                type="button"
                onClick={() => void handleApplyShipmentFilter("delivered")}
              >
                Teslim {shipmentFilter === "all" || shipmentFilter === "delivered" ? deliveredShipmentCount : "sonuç"}
              </button>
              <button
                className={cx("secondary-action", shipmentFilter === "tracking_missing" && "selected")}
                data-testid="shipment-filter-tracking-missing"
                type="button"
                onClick={() => void handleApplyShipmentFilter("tracking_missing")}
              >
                Takipsiz {shipmentFilter === "all" || shipmentFilter === "tracking_missing" ? trackingMissingCount : "sonuç"}
              </button>
            </div>
            <DetailPanel title="Kargo Filtre Özeti" testId="shipment-filter-summary">
              <DataRows
                rows={[
                  ["Yeni", String(activeShipmentCount), "sevk/teslim bekliyor"],
                  ["PTT Almayan", String(pttNotDeliveredCount), "legacy filtre"],
                  ["Sürat Almayan", String(suratNotDeliveredCount), "legacy filtre"],
                  ["Takip No Yok", String(trackingMissingCount), "barkod kontrol"],
                ]}
              />
            </DetailPanel>
            <div className="table-wrap">
              <table className="data-table" data-testid="shipment-table">
                <thead>
                  <tr>
                    <th>Kargo Firma</th>
                    <th>Takip No / Aktar</th>
                    <th>Müşteri</th>
                    <th>Sipariş</th>
                    <th>Kargo Durumu</th>
                    <th>Aktarılma Tarihi</th>
                    <th>İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {data.shipments.length === 0 ? (
                    <tr>
                      <td colSpan={7}>Henüz kargoya aktarılmış sipariş bulunmuyor</td>
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
                          {shipment.tracking_number ?? shipment.barcode_number ?? "Takip No Yok"} detay
                        </button>
                        <span className="muted-line">{shipment.last_event_text ?? "Kargoya aktarıldı - hareket bekleniyor"}</span>
                      </td>
                      <td>
                        <strong>{shipment.recipient_name}</strong>
                        <span className="muted-line">
                          {[shipment.recipient_district, shipment.recipient_city].filter(Boolean).join(" / ") || shipment.customer_full_name || "-"}
                        </span>
                      </td>
                      <td>{shipment.order_number ?? shipment.customer_full_name ?? "-"}</td>
                      <td>{shipmentStatusLabel(shipment.status)}</td>
                      <td>{new Date(shipment.updated_at).toLocaleString("tr-TR")}</td>
                      <td>
                        <div className="icon-actions">
                          <button
                            aria-label="Detay"
                            className={cx("icon-button", selectedShipment?.public_id === shipment.public_id && "selected")}
                            data-testid="shipment-detail-action"
                            title="Detay"
                            type="button"
                            onClick={() => void handleOpenShipmentDetail(shipment.public_id)}
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            aria-label="Takip Güncelle"
                            className="icon-button"
                            data-testid="shipment-track-action"
                            disabled={trackingShipmentId === shipment.public_id || !shipment.tracking_number}
                            title="Takip Güncelle"
                            type="button"
                            onClick={() => void handleTrackShipment(shipment)}
                          >
                            <RefreshCw className={trackingShipmentId === shipment.public_id ? "spin" : undefined} size={16} />
                          </button>
                          <button
                            aria-label={selectedShipment?.public_id === shipment.public_id ? "Teslim edildi yap" : "Önce detay seç"}
                            className="icon-button"
                            data-testid="shipment-status-action"
                            disabled={selectedShipment?.public_id !== shipment.public_id}
                            title={selectedShipment?.public_id === shipment.public_id ? "Teslim edildi yap" : "Önce detay seç"}
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
                  Önceki
                </button>
                <span>Sayfa {shipmentPage + 1} / {shipmentPageCount}</span>
                <button
                  className="secondary-action"
                  data-testid="shipment-next-page"
                  disabled={shipmentPage + 1 >= shipmentPageCount}
                  type="button"
                  onClick={() => void handleShipmentPage(shipmentPage + 1)}
                >
                  Sonraki
                </button>
              </div>
            </div>
            {lastShipmentTrack && <p className="status-copy" data-testid="shipment-track-result">{lastShipmentTrack}</p>}
            {selectedShipment && (
              <DetailPanel title="Kargo Detayı" testId="shipment-detail">
                <DataRows
                  rows={[
                    ["Takip No", selectedShipment.tracking_number ?? "-", selectedShipment.provider],
                    ["Alıcı", selectedShipment.recipient_name, selectedShipment.recipient_phone ?? "-"],
                    [
                      "Adres",
                      [selectedShipment.recipient_district, selectedShipment.recipient_city].filter(Boolean).join(" / ") || "-",
                      selectedShipment.barcode_number ?? "-",
                    ],
                    ["Son Hareket", selectedShipment.last_event_text ?? "-", selectedShipment.status],
                    ["Sipariş", selectedShipment.order_number ?? "-", selectedShipment.customer_full_name ?? "-"],
                    ["Barkod", selectedShipment.barcode_number ?? "barkod bekliyor", "shipments API"],
                  ]}
                />
                <div className="detail-actions">
                  {selectedShipment.tracking_number || selectedShipment.barcode_number ? (
                    <button
                      className="kargo-yazdir-button"
                      data-testid="kargo-yazdir"
                      title="Barkodlu Fatura Yazdır"
                      type="button"
                      onClick={() => setPrintShipmentId(selectedShipment.public_id)}
                    >
                      <Printer size={14} aria-hidden="true" /> Yazdır
                    </button>
                  ) : (
                    <span className="kargo-muted">Önce kargoya aktarın</span>
                  )}
                </div>
                <div className="timeline" data-testid="shipment-tracking-history">
                  <h3>Hareket Geçmişi</h3>
                  {(selectedShipment.tracking_events ?? []).length === 0 ? (
                    <p>Henüz hareket yok</p>
                  ) : (
                    selectedShipment.tracking_events.map((event) => (
                      <div className="timeline-item" key={event.public_id}>
                        <strong>{event.description ?? shipmentStatusLabel(event.status)}</strong>
                        <span>{event.location ?? "-"}</span>
                        <span>{new Date(event.occurred_at).toLocaleString("tr-TR")}</span>
                      </div>
                    ))
                  )}
                </div>
              </DetailPanel>
            )}
          </FlowPanel>
  );
}

