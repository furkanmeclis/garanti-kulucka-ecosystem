import { Zap } from "lucide-react";
import { cx, FlowPanel, DetailPanel, Metric, DataRows } from "../../app/shared.js";
import type { DashboardController } from "../../app/useDashboardController.js";

export function ShipmentPipelineFlow({ ctx }: { ctx: DashboardController }) {
  const {
    handleApplyShipmentPipelineFilter,
    pipelineDeliveredCount,
    pipelineErrorCount,
    pipelineProcessingCount,
    pipelineWaitingCount,
    shipmentPipelineFilter,
    shipmentPipelineFilters,
    visibleShipmentPipelineRows,
  } = ctx;

  return (
    <FlowPanel title="Teslim Alınmayan Kargo Pipeline" icon={<Zap size={18} />} testId="shipment-pipeline-flow">
            <div className="report-grid">
              <Metric title="Bekliyor" value={String(pipelineWaitingCount)} />
              <Metric title="İşleniyor" value={String(pipelineProcessingCount)} />
              <Metric title="Hata" value={String(pipelineErrorCount)} />
              <Metric title="Teslim" value={String(pipelineDeliveredCount)} />
            </div>
            <div className="detail-actions" data-testid="shipment-pipeline-tabs">
              {shipmentPipelineFilters.map(({ value, label, count }) => (
                <button
                  key={value}
                  aria-pressed={shipmentPipelineFilter === value}
                  className={cx("secondary-action", shipmentPipelineFilter === value && "selected")}
                  data-testid={`shipment-pipeline-filter-${value}`}
                  type="button"
                  onClick={() => handleApplyShipmentPipelineFilter(value)}
                >
                  {label} {count}
                </button>
              ))}
            </div>
            <DetailPanel title="Mesaj SMS VAPI Akışı" testId="shipment-pipeline-detail">
              <DataRows
                rows={[
                  ["Kaynak", "shipments API", "legacy /kargo/pipeline"],
                  ["Akış", "Mesaj -> SMS -> VAPI", "backend verisi"],
                  ["Aktif sekme", shipmentPipelineFilter, `${visibleShipmentPipelineRows.length} kargo`],
                  ["Otomatik yenileme", "Socket.IO sonrası domain refresh", "Supabase channel yok"],
                  ["Canlı provider", "kapalı", "fixture/live gate kontrollü"],
                ]}
              />
            </DetailPanel>
            <DataRows
              rows={visibleShipmentPipelineRows.map((row) => [
                row.recipient_name,
                `${row.step} / ${row.pipeline_status}`,
                row.tracking_number ?? row.barcode_number ?? row.recipient_phone ?? "-",
              ])}
            />
          </FlowPanel>
  );
}

