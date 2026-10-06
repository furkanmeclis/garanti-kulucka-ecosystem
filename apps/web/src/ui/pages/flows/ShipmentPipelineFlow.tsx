import { Zap } from "lucide-react";
import { cx, FlowPanel, DetailPanel, Metric, DataRows } from "../../app/shared.js";
import type { DashboardController } from "../../app/useDashboardController.js";
import { useUiMessageText } from "../../i18n/messages/status.js";
import { useT } from "../../i18n/index.js";
import { shipmentPipelineMessages } from "../../i18n/messages/shipmentPipeline.js";

export function ShipmentPipelineFlow({ ctx }: { ctx: DashboardController }) {
  const labelText = useUiMessageText();
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
  const t = useT(shipmentPipelineMessages);

  return (
    <FlowPanel title={t("title")} icon={<Zap size={18} />} testId="shipment-pipeline-flow">
            <div className="report-grid">
              <Metric title={t("metricWaiting")} value={String(pipelineWaitingCount)} />
              <Metric title={t("metricProcessing")} value={String(pipelineProcessingCount)} />
              <Metric title={t("metricError")} value={String(pipelineErrorCount)} />
              <Metric title={t("metricDelivered")} value={String(pipelineDeliveredCount)} />
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
                  {labelText(label)} {count}
                </button>
              ))}
            </div>
            <DetailPanel title={t("detailTitle")} testId="shipment-pipeline-detail">
              <DataRows
                rows={[
                  [t("rowSource"), "shipments API", "legacy /kargo/pipeline"],
                  [t("rowFlow"), t("flowValue"), t("backendData")],
                  [t("rowActiveTab"), shipmentPipelineFilter, t("shipmentCount", { count: visibleShipmentPipelineRows.length })],
                  [t("rowAutoRefresh"), t("autoRefreshValue"), t("noSupabaseChannel")],
                  [t("rowLiveProvider"), t("liveProviderOff"), t("liveGateControlled")],
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

