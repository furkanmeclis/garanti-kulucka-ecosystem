import { XCircle } from "lucide-react";
import { cx, FlowPanel, DetailPanel, DataRows } from "../../app/shared.js";
import type { DashboardController } from "../../app/useDashboardController.js";
import { useT } from "../../i18n/index.js";
import { cancellationsMessages } from "../../i18n/messages/cancellations.js";
import { IptallerListesi } from "../IptallerListesi.js";

export function CancellationsFlow({ ctx }: { ctx: DashboardController }) {
  const {
    http,
    data,
    handleCancelSelectedOrder,
    selectedOrder,
    setSelectedOrderId,
  } = ctx;
  const t = useT(cancellationsMessages);

  return (
    <FlowPanel title={t("title")} icon={<XCircle size={18} />} testId="cancellations-flow">
            <IptallerListesi http={http} />
            <DataRows rows={data.orders.map((order) => [order.order_number, order.status, order.customer_full_name ?? "-"])} />
            <div className="detail-actions">
              {data.orders.map((order) => (
                <button
                  className={cx("secondary-action", selectedOrder?.public_id === order.public_id && "selected")}
                  key={order.public_id}
                  type="button"
                  onClick={() => setSelectedOrderId(order.public_id)}
                >
                  {t("reviewOrder", { orderNumber: order.order_number })}
                </button>
              ))}
            </div>
            <DetailPanel title={t("reviewTitle")} testId="cancellation-detail">
              <DataRows
                rows={[
                  [t("orderRecords"), String(data.orderSummary.total_count), "orders summary API"],
                  [t("selectedOrder"), selectedOrder?.order_number ?? "-", selectedOrder?.customer_full_name ?? "-"],
                  [t("status"), selectedOrder?.status ?? "-", selectedOrder?.confirmation_status ?? t("awaitingConfirmation")],
                  [t("amount"), selectedOrder ? `${selectedOrder.total_amount} ${selectedOrder.currency}` : "-", selectedOrder?.source ?? "-"],
                  [t("note"), selectedOrder?.notes ?? "-", "orders API"],
                ]}
              />
            </DetailPanel>
            <button className="primary-action" type="button" onClick={() => void handleCancelSelectedOrder()}>
              {t("confirmCancellation")}
            </button>
          </FlowPanel>
  );
}

