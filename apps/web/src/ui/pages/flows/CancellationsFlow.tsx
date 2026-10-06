import { XCircle } from "lucide-react";
import { cx, FlowPanel, DetailPanel, DataRows } from "../../app/shared.js";
import type { DashboardController } from "../../app/useDashboardController.js";

export function CancellationsFlow({ ctx }: { ctx: DashboardController }) {
  const {
    data,
    handleCancelSelectedOrder,
    selectedOrder,
    setSelectedOrderId,
  } = ctx;

  return (
    <FlowPanel title="İptaller" icon={<XCircle size={18} />} testId="cancellations-flow">
            <DataRows rows={data.orders.map((order) => [order.order_number, order.status, order.customer_full_name ?? "-"])} />
            <div className="detail-actions">
              {data.orders.map((order) => (
                <button
                  className={cx("secondary-action", selectedOrder?.public_id === order.public_id && "selected")}
                  key={order.public_id}
                  type="button"
                  onClick={() => setSelectedOrderId(order.public_id)}
                >
                  {order.order_number} incele
                </button>
              ))}
            </div>
            <DetailPanel title="İptal İncelemesi" testId="cancellation-detail">
              <DataRows
                rows={[
                  ["Sipariş kaydı", String(data.orderSummary.total_count), "orders summary API"],
                  ["Seçili sipariş", selectedOrder?.order_number ?? "-", selectedOrder?.customer_full_name ?? "-"],
                  ["Durum", selectedOrder?.status ?? "-", selectedOrder?.confirmation_status ?? "teyit bekliyor"],
                  ["Tutar", selectedOrder ? `${selectedOrder.total_amount} ${selectedOrder.currency}` : "-", selectedOrder?.source ?? "-"],
                  ["Not", selectedOrder?.notes ?? "-", "orders API"],
                ]}
              />
            </DetailPanel>
            <button className="primary-action" type="button" onClick={() => void handleCancelSelectedOrder()}>
              İptali onayla
            </button>
          </FlowPanel>
  );
}

