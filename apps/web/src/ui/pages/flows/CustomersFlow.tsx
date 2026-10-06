import { Users } from "lucide-react";
import { FlowPanel, DetailPanel, Metric, DataRows } from "../../app/shared.js";
import type { DashboardController } from "../../app/useDashboardController.js";
import { useT } from "../../i18n/index.js";
import { customersMessages } from "../../i18n/messages/customers.js";

export function CustomersFlow({ ctx }: { ctx: DashboardController }) {
  const {
    customerWithEmailCount,
    customerWithNotesCount,
    customerWithPhoneCount,
    data,
    selectedCustomer,
  } = ctx;
  const t = useT(customersMessages);

  return (
    <FlowPanel title={t("title")} icon={<Users size={18} />} testId="customers-flow">
            <div className="report-grid">
              <Metric title={t("metricCustomer")} value={String(data.customerSummary.total_count)} />
              <Metric title={t("metricPhone")} value={String(customerWithPhoneCount)} />
              <Metric title={t("metricEmail")} value={String(customerWithEmailCount)} />
            </div>
            <DetailPanel title={t("listTitle")} testId="customers-list-detail">
              <DataRows
                rows={data.customers.map((customer) => [
                  customer.full_name,
                  customer.phone ?? customer.email ?? customer.username ?? "-",
                  customer.notes ?? "customers API",
                ])}
              />
            </DetailPanel>
            <DetailPanel title={t("cardTitle")} testId="customer-card-detail">
              <DataRows
                rows={[
                  [t("selectedCustomer"), selectedCustomer?.full_name ?? "-", selectedCustomer?.username ?? "-"],
                  [t("phone"), selectedCustomer?.phone ?? "-", "customers API"],
                  [t("email"), selectedCustomer?.email ?? "-", selectedCustomer?.updated_at ?? "-"],
                  [t("customersWithNotes"), String(customerWithNotesCount), t("legacyCustomerNote")],
                ]}
              />
            </DetailPanel>
          </FlowPanel>
  );
}

