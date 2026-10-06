import { Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { FlowPanel, DetailPanel, Metric, DataRows } from "../../app/shared.js";
import type { DashboardController } from "../../app/useDashboardController.js";
import { useT } from "../../i18n/index.js";
import { customerDetailMessages } from "../../i18n/messages/customerDetail.js";
import { customersMessages } from "../../i18n/messages/customers.js";
import { CustomerDetailPage } from "../CustomerDetailPage.js";

const customersPath = "/musteriler";

/** `/musteriler/:id` → customer public id; `/musteriler` → null. */
export function customerIdFromPath(pathname: string) {
  if (!pathname.startsWith(`${customersPath}/`)) return null;
  const id = pathname.slice(customersPath.length + 1).split("/")[0];
  return id ? decodeURIComponent(id) : null;
}

export function CustomersFlow({ ctx }: { ctx: DashboardController }) {
  const {
    customerWithEmailCount,
    customerWithNotesCount,
    customerWithPhoneCount,
    data,
    domain,
    handleSelectConversation,
    location,
    refreshOrders,
    selectedCustomer,
    setOrderSearch,
  } = ctx;
  const t = useT(customersMessages);
  const td = useT(customerDetailMessages);
  const navigate = useNavigate();
  const customerId = customerIdFromPath(location.pathname);

  if (customerId) {
    return (
      <CustomerDetailPage
        customerPublicId={customerId}
        domain={domain}
        onBack={() => navigate(customersPath)}
        onOpenOrder={(orderNumber) => {
          navigate("/siparisler");
          setOrderSearch(orderNumber);
          void refreshOrders({ search: orderNumber, page: 0 });
        }}
        onOpenConversation={(conversationPublicId) => {
          navigate("/mesajlar");
          void handleSelectConversation(conversationPublicId);
        }}
      />
    );
  }

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
            <DetailPanel title={td("detailsTitle")} testId="customers-detail-links">
              <ul className="customer-detail-list">
                {data.customers.map((customer) => (
                  <li key={customer.public_id}>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => navigate(`${customersPath}/${encodeURIComponent(customer.public_id)}`)}
                      data-testid="customer-detail-link"
                    >
                      {customer.full_name}
                    </button>
                    <span className="muted-line">{td("detailLink")}</span>
                  </li>
                ))}
              </ul>
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
