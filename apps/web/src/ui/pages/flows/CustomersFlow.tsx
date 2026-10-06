import { Users } from "lucide-react";
import { FlowPanel, DetailPanel, Metric, DataRows } from "../../app/shared.js";
import type { DashboardController } from "../../app/useDashboardController.js";

export function CustomersFlow({ ctx }: { ctx: DashboardController }) {
  const {
    customerWithEmailCount,
    customerWithNotesCount,
    customerWithPhoneCount,
    data,
    selectedCustomer,
  } = ctx;

  return (
    <FlowPanel title="Müşteriler" icon={<Users size={18} />} testId="customers-flow">
            <div className="report-grid">
              <Metric title="Müşteri" value={String(data.customerSummary.total_count)} />
              <Metric title="Telefon" value={String(customerWithPhoneCount)} />
              <Metric title="E-posta" value={String(customerWithEmailCount)} />
            </div>
            <DetailPanel title="Müşteri Listesi" testId="customers-list-detail">
              <DataRows
                rows={data.customers.map((customer) => [
                  customer.full_name,
                  customer.phone ?? customer.email ?? customer.username ?? "-",
                  customer.notes ?? "customers API",
                ])}
              />
            </DetailPanel>
            <DetailPanel title="Müşteri Kartı" testId="customer-card-detail">
              <DataRows
                rows={[
                  ["Seçili müşteri", selectedCustomer?.full_name ?? "-", selectedCustomer?.username ?? "-"],
                  ["Telefon", selectedCustomer?.phone ?? "-", "customers API"],
                  ["E-posta", selectedCustomer?.email ?? "-", selectedCustomer?.updated_at ?? "-"],
                  ["Notlu müşteri", String(customerWithNotesCount), "legacy müşteri notu"],
                ]}
              />
            </DetailPanel>
          </FlowPanel>
  );
}

