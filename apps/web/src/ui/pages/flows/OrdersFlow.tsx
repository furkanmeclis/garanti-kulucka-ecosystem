import { useState } from "react";
import { Calendar, CheckSquare, Download, Pencil, Search, ShoppingCart, Square, Trash2, XCircle } from "lucide-react";
import { SiparisAksiyonlari, SiparisTopluAksiyonlar } from "../SiparisAksiyonlari.js";
import { KargoSiparisAksiyonlari, KargoTopluAktar } from "../KargoOlusturModal.js";
import { SiparisDuzenleModal } from "../SiparisDuzenleModal.js";
import { orderEditMessages } from "../../i18n/messages/orderEdit.js";
import { cx, orderStatusLabel, cargoProviderLabel, formatMoney, parseMoneyInput, FlowPanel, DetailPanel, Metric, DataRows } from "../../app/shared.js";
import type { DashboardController } from "../../app/useDashboardController.js";
import { useUiMessageText } from "../../i18n/messages/status.js";
import { localeFor, useLanguage, useT } from "../../i18n/index.js";
import { ordersMessages } from "../../i18n/messages/orders.js";

export function OrdersFlow({ ctx }: { ctx: DashboardController }) {
  const orderFormText = useUiMessageText();
  const t = useT(ordersMessages);
  const editText = useT(orderEditMessages);
  const { language } = useLanguage();
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const {
    addOrderFormItem,
    allVisibleOrdersSelected,
    currentOrderFormTotals,
    data,
    handleApplyOrderAdvancedFilters,
    handleApplyOrderFilter,
    handleExportOrders,
    handleOrderPage,
    handleOrderSort,
    handleSubmitOrderForm,
    http,
    lookupOrderCustomerByPhone,
    openOrderForm,
    orderCargoFilter,
    orderCreatedFrom,
    orderCreatedTo,
    orderFilter,
    orderForm,
    orderFormMessage,
    orderFormOpen,
    orderFormSubmitting,
    orderPage,
    orderPageCount,
    orderPersonnel,
    orderPersonnelFilter,
    orderSearch,
    orderSourceFilter,
    orderSources,
    orderStatusFilter,
    orderTotalCount,
    refreshOrders,
    removeOrderFormItem,
    selectOrderFormProduct,
    selectedOrder,
    selectedOrderIds,
    setOrderCargoFilter,
    setOrderCreatedFrom,
    setOrderCreatedTo,
    setOrderForm,
    setOrderFormOpen,
    setOrderPersonnelFilter,
    setOrderSearch,
    setOrderSourceFilter,
    setOrderStatusFilter,
    setSelectedOrderId,
    toggleAllVisibleOrders,
    toggleOrderSelection,
    updateOrderFormItem,
  } = ctx;

  return (
    <FlowPanel title={t("title")} icon={<ShoppingCart size={18} />} testId="orders-flow">
            <div className="report-grid">
              <Metric title={t("metricTotalOrders")} value={String(data.orderSummary.total_count)} />
              <Metric title={t("metricActiveOrders")} value={String(data.orderSummary.active_count)} />
              <Metric title={t("metricPendingConfirmation")} value={String(data.orderSummary.pending_confirmation_count)} />
              <Metric title={t("metricRevenue")} value={formatMoney(data.orderSummary.total_revenue, data.orderSummary.currency)} />
            </div>
            <div className="orders-toolbar" data-testid="order-section-filters">
              <button
                className={cx("secondary-action", orderFilter === "all" && "selected")}
                data-testid="order-filter-all"
                type="button"
                onClick={() => void handleApplyOrderFilter("all")}
              >
                {t("filterAll", { count: orderFilter === "all" ? data.orderSummary.total_count : t("filterResultWord") })}
              </button>
              <button
                className={cx("secondary-action", orderFilter === "active" && "selected")}
                data-testid="order-filter-active"
                type="button"
                onClick={() => void handleApplyOrderFilter("active")}
              >
                {t("filterActive", { count: orderFilter === "all" || orderFilter === "active" ? data.orderSummary.active_count : t("filterResultWord") })}
              </button>
              <button
                className={cx("secondary-action", orderFilter === "pending_confirmation" && "selected")}
                data-testid="order-filter-pending-confirmation"
                type="button"
                onClick={() => void handleApplyOrderFilter("pending_confirmation")}
              >
                {t("filterPendingConfirmation", { count: orderFilter === "all" || orderFilter === "pending_confirmation" ? data.orderSummary.pending_confirmation_count : t("filterResultWord") })}
              </button>
              <button
                className={cx("secondary-action", orderFilter === "delivered" && "selected")}
                data-testid="order-filter-delivered"
                type="button"
                onClick={() => void handleApplyOrderFilter("delivered")}
              >
                {t("filterDelivered", { count: orderFilter === "all" || orderFilter === "delivered" ? data.orderSummary.delivered_count : t("filterResultWord") })}
              </button>
            </div>
            <div className="orders-filter-grid" data-testid="orders-advanced-filters">
              <label>
                <span>{t("search")}</span>
                <input
                  className="inline-input"
                  data-testid="orders-search-input"
                  placeholder={t("searchPlaceholder")}
                  value={orderSearch}
                  onChange={(event) => setOrderSearch(event.target.value)}
                />
              </label>
              <label>
                <span>{t("status")}</span>
                <select className="inline-input" data-testid="orders-status-filter" value={orderStatusFilter} onChange={(event) => setOrderStatusFilter(event.target.value)}>
                  <option value="all">{t("allStatuses")}</option>
                  <option value="active">{t("statusActive")}</option>
                  <option value="draft">{t("statusDraft")}</option>
                  <option value="delivered">{t("statusDelivered")}</option>
                  <option value="cancelled">{t("statusCancelled")}</option>
                  <option value="returned">{t("statusReturned")}</option>
                </select>
              </label>
              <label>
                <span>{t("source")}</span>
                <select className="inline-input" data-testid="orders-source-filter" value={orderSourceFilter} onChange={(event) => setOrderSourceFilter(event.target.value)}>
                  <option value="all">{t("allSources")}</option>
                  <option value="manual">manual</option>
                  {orderSources.filter((source) => source !== "manual").map((source) => (
                    <option key={source} value={source}>{source}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t("cargo")}</span>
                <select className="inline-input" data-testid="orders-cargo-filter" value={orderCargoFilter} onChange={(event) => setOrderCargoFilter(event.target.value)}>
                  <option value="all">{t("allCargos")}</option>
                  <option value="ptt">PTT</option>
                  <option value="surat">Sürat</option>
                  <option value="other">{t("cargoOther")}</option>
                </select>
              </label>
              <label>
                <span>{t("personnel")}</span>
                <select className="inline-input" data-testid="orders-person-filter" value={orderPersonnelFilter} onChange={(event) => setOrderPersonnelFilter(event.target.value)}>
                  <option value="all">{t("allPersonnel")}</option>
                  {orderPersonnel.map(([publicId, email]) => (
                    <option key={publicId} value={publicId}>{email}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t("dateFrom")}</span>
                <input className="inline-input" data-testid="orders-date-from" type="date" value={orderCreatedFrom} onChange={(event) => setOrderCreatedFrom(event.target.value)} />
              </label>
              <label>
                <span>{t("dateTo")}</span>
                <input className="inline-input" data-testid="orders-date-to" type="date" value={orderCreatedTo} onChange={(event) => setOrderCreatedTo(event.target.value)} />
              </label>
              <button className="primary-action icon-action" data-testid="orders-apply-filters" type="button" onClick={() => void handleApplyOrderAdvancedFilters()}>
                <Search size={16} aria-hidden="true" />
                <span>{t("applyFilters")}</span>
              </button>
            </div>
            <div className="orders-toolbar">
              <button className="primary-action" type="button" onClick={() => openOrderForm("orders")}>
                {t("createOrder")}
              </button>
              <button className="secondary-action icon-action" data-testid="orders-export-current" type="button" onClick={() => void handleExportOrders("current")}>
                <Download size={16} aria-hidden="true" />
                <span>{t("exportCurrent")}</span>
              </button>
              <button className="secondary-action icon-action" data-testid="orders-export-all" type="button" onClick={() => void handleExportOrders("all")}>
                <Download size={16} aria-hidden="true" />
                <span>{t("exportFiltered")}</span>
              </button>
              <button className="secondary-action" data-testid="orders-export-selected" disabled={selectedOrderIds.size === 0} type="button" onClick={() => void handleExportOrders("selected")}>
                {t("exportSelected", { count: selectedOrderIds.size })}
              </button>
              <SiparisTopluAksiyonlar http={http} selectedIds={[...selectedOrderIds]} onDone={() => refreshOrders({ page: orderPage })} />
            </div>
            <KargoTopluAktar http={http} selectedOrderPublicIds={[...selectedOrderIds]} onChanged={() => void refreshOrders()} />
            {orderFormOpen && (
              <div className="order-form-backdrop" data-testid="order-create-modal">
                <form
                  className="order-form-modal"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSubmitOrderForm();
                  }}
                >
                  <div className="order-form-header">
                    <h2>{t("formTitle")}</h2>
                    <button className="secondary-action icon-only" type="button" onClick={() => setOrderFormOpen(false)} aria-label={t("close")}>
                      <XCircle size={16} aria-hidden="true" />
                    </button>
                  </div>
                  {orderFormMessage && (
                    <div className="order-form-message" data-testid="order-form-message">
                      {orderFormText(orderFormMessage)}
                    </div>
                  )}
                  <div className="order-form-grid">
                    <label>
                      <span>{t("name")}</span>
                      <input
                        className="inline-input"
                        data-testid="order-form-name"
                        placeholder={t("namePlaceholder")}
                        value={orderForm.customer_name}
                        onChange={(event) => setOrderForm((current) => ({ ...current, customer_name: event.target.value, customer_public_id: null, force_duplicate: false }))}
                      />
                    </label>
                    <label>
                      <span>{t("phone")}</span>
                      <input
                        className="inline-input"
                        data-testid="order-form-phone"
                        placeholder="05XX XXX XX XX"
                        value={orderForm.customer_phone}
                        onBlur={() => void lookupOrderCustomerByPhone()}
                        onChange={(event) => setOrderForm((current) => ({ ...current, customer_phone: event.target.value, customer_public_id: null, force_duplicate: false }))}
                      />
                    </label>
                  </div>
                  <div className="order-form-items">
                    <div className="order-form-section-title">
                      <span>{t("products")}</span>
                      <button className="secondary-action" data-testid="order-form-add-item" type="button" onClick={addOrderFormItem}>
                        {t("addProduct")}
                      </button>
                    </div>
                    {orderForm.items.map((item, index) => (
                      <div className="order-form-item" data-testid={`order-form-item-${index}`} key={index}>
                        <select
                          className="inline-input"
                          data-testid={`order-form-product-${index}`}
                          value={item.product_public_id}
                          onChange={(event) => selectOrderFormProduct(index, event.target.value)}
                        >
                          <option value="">{t("selectProduct")}</option>
                          {data.products.map((product) => (
                            <option key={product.public_id} value={product.public_id}>{product.name}</option>
                          ))}
                        </select>
                        <input
                          className="inline-input"
                          data-testid={`order-form-item-name-${index}`}
                          placeholder={t("productNamePlaceholder")}
                          value={item.name}
                          onChange={(event) => updateOrderFormItem(index, { name: event.target.value, product_public_id: "" })}
                        />
                        <input
                          className="inline-input"
                          data-testid={`order-form-quantity-${index}`}
                          min="1"
                          type="number"
                          value={item.quantity}
                          onChange={(event) => updateOrderFormItem(index, { quantity: Number(event.target.value) || 1 })}
                        />
                        <input
                          className="inline-input"
                          data-testid={`order-form-price-${index}`}
                          min="0"
                          step="0.01"
                          type="number"
                          value={item.unit_price}
                          onChange={(event) => updateOrderFormItem(index, { unit_price: event.target.value })}
                        />
                        <span data-testid={`order-form-line-total-${index}`}>
                          {(Math.max(Number(item.quantity) || 0, 0) * parseMoneyInput(item.unit_price)).toFixed(2)} TRY
                        </span>
                        {orderForm.items.length > 1 && (
                          <button className="secondary-action icon-only" type="button" onClick={() => removeOrderFormItem(index)} aria-label={t("removeProduct")}>
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="order-form-grid">
                    <label>
                      <span>{t("city")}</span>
                      <input
                        className="inline-input"
                        data-testid="order-form-city"
                        placeholder={t("city")}
                        value={orderForm.city}
                        onChange={(event) => setOrderForm((current) => ({ ...current, city: event.target.value, force_surat_at: false }))}
                      />
                    </label>
                    <label>
                      <span>{t("district")}</span>
                      <input
                        className="inline-input"
                        data-testid="order-form-district"
                        placeholder={t("district")}
                        value={orderForm.district}
                        onChange={(event) => setOrderForm((current) => ({ ...current, district: event.target.value, force_surat_at: false }))}
                      />
                    </label>
                  </div>
                  <label className="order-form-full">
                    <span>{t("address")}</span>
                    <textarea
                      className="inline-input"
                      data-testid="order-form-address"
                      placeholder={t("address")}
                      rows={2}
                      value={orderForm.address_line}
                      onChange={(event) => setOrderForm((current) => ({ ...current, address_line: event.target.value, force_surat_at: false }))}
                    />
                  </label>
                  <label className="order-form-full">
                    <span>{t("note")}</span>
                    <input
                      className="inline-input"
                      data-testid="order-form-notes"
                      placeholder={t("notePlaceholder")}
                      value={orderForm.notes}
                      onChange={(event) => setOrderForm((current) => ({ ...current, notes: event.target.value }))}
                    />
                  </label>
                  <div className="order-form-cargo" data-testid="order-form-cargo">
                    <span>{t("cargo")}</span>
                    <button
                      className={cx("secondary-action", orderForm.cargo_provider === "ptt" && "selected")}
                      type="button"
                      onClick={() => setOrderForm((current) => ({ ...current, cargo_provider: "ptt", force_surat_at: false }))}
                    >
                      PTT Kargo
                    </button>
                    <button
                      className={cx("secondary-action", orderForm.cargo_provider === "surat" && "selected")}
                      type="button"
                      onClick={() => setOrderForm((current) => ({ ...current, cargo_provider: "surat", force_surat_at: false }))}
                    >
                      Sürat Kargo
                    </button>
                  </div>
                  <DataRows
                    rows={[
                      [t("subtotal"), `${currentOrderFormTotals.araToplam.toFixed(2)} TRY`, t("excludingVat")],
                      [t("vat"), `${currentOrderFormTotals.kdvToplam.toFixed(2)} TRY`, "%20"],
                      [t("grandTotal"), `${currentOrderFormTotals.genelToplam.toFixed(2)} TRY`, t("includingVat")],
                    ]}
                  />
                  <button className="primary-action order-form-submit" data-testid="order-form-submit" disabled={orderFormSubmitting} type="submit">
                    {orderFormSubmitting
                      ? t("submitting")
                      : orderForm.force_surat_at
                        ? t("submitCreate")
                        : orderForm.force_duplicate
                          ? t("submitCreateAnyway")
                          : t("submitCreateOrder")}
                  </button>
                </form>
              </div>
            )}
            <div className="orders-list" data-testid="orders-list">
              <div className="orders-list-header">
                <button className="secondary-action icon-only" data-testid="orders-select-all" type="button" onClick={toggleAllVisibleOrders} aria-label={t("selectAll")}>
                  {allVisibleOrdersSelected ? <CheckSquare size={16} aria-hidden="true" /> : <Square size={16} aria-hidden="true" />}
                </button>
                <button className="orders-sort-button" type="button" onClick={() => void handleOrderSort("order_number")}>{t("columnOrderNumber")}</button>
                <span>{t("columnCustomer")}</span>
                <button className="orders-sort-button" type="button" onClick={() => void handleOrderSort("status")}>{t("columnStatus")}</button>
                <span>{t("columnSource")}</span>
                <span>{t("columnCargo")}</span>
                <span>{t("columnPersonnel")}</span>
                <button className="orders-sort-button" type="button" onClick={() => void handleOrderSort("total_amount")}>{t("columnAmount")}</button>
                <button className="orders-sort-button" type="button" onClick={() => void handleOrderSort("created_at")}>{t("columnDate")}</button>
              </div>
              {data.orders.map((order) => (
                <button
                  className={cx("orders-list-row", selectedOrder?.public_id === order.public_id && "selected")}
                  data-testid={`order-row-${order.public_id}`}
                  key={order.public_id}
                  type="button"
                  onClick={() => setSelectedOrderId(order.public_id)}
                >
                  <span
                    className="orders-row-checkbox"
                    role="checkbox"
                    aria-checked={selectedOrderIds.has(order.public_id)}
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleOrderSelection(order.public_id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleOrderSelection(order.public_id);
                      }
                    }}
                  >
                    {selectedOrderIds.has(order.public_id) ? <CheckSquare size={16} aria-hidden="true" /> : <Square size={16} aria-hidden="true" />}
                  </span>
                  <strong>{order.order_number}</strong>
                  <span>{order.customer_full_name ?? t("customerUnmatched")}</span>
                  <span>{orderStatusLabel(order.status, language)}</span>
                  <span>{order.source}</span>
                  <span>{cargoProviderLabel(order.cargo_provider)}</span>
                  <span>{order.created_by_user_email ?? "-"}</span>
                  <span>{order.total_amount} {order.currency}</span>
                  <span><Calendar size={14} aria-hidden="true" /> {new Date(order.created_at).toLocaleDateString(localeFor(language))}</span>
                </button>
              ))}
            </div>
            <div className="orders-pagination" data-testid="orders-pagination">
              <span>{t("pagination", { count: orderTotalCount.toLocaleString(localeFor(language)), page: orderPage + 1, pageCount: orderPageCount })}</span>
              <button className="secondary-action" disabled={orderPage === 0} type="button" onClick={() => void handleOrderPage(orderPage - 1)}>{t("previous")}</button>
              <button className="secondary-action" disabled={orderPage + 1 >= orderPageCount} type="button" onClick={() => void handleOrderPage(orderPage + 1)}>{t("next")}</button>
            </div>
            {selectedOrder && (
              <DetailPanel title={t("detailTitle")} testId="order-detail">
                <DataRows
                  rows={[
                    [t("detailOrderNumber"), selectedOrder.order_number, orderStatusLabel(selectedOrder.status, language)],
                    [t("detailCustomer"), selectedOrder.customer_full_name ?? t("customerUnmatched"), selectedOrder.source],
                    [
                      t("detailAmount"),
                      `${selectedOrder.total_amount} ${selectedOrder.currency}`,
                      selectedOrder.confirmation_status ?? t("detailAwaitingConfirmation"),
                    ],
                    [t("detailCargo"), cargoProviderLabel(selectedOrder.cargo_provider), selectedOrder.created_by_user_email ?? t("detailNoPersonnel")],
                    [t("detailNote"), selectedOrder.notes ?? "-", selectedOrder.updated_at],
                  ]}
                />
                <div className="detail-actions">
                  <button type="button" className="secondary-action" onClick={() => setEditingOrderId(selectedOrder.public_id)} data-testid="order-edit-open">
                    <Pencil size={14} />
                    {editText("open")}
                  </button>
                </div>
                <KargoSiparisAksiyonlari
                  http={http}
                  orderPublicId={selectedOrder.public_id}
                  onChanged={(result) => void refreshOrders().then(() => setSelectedOrderId(result.order_public_id))}
                />
                <SiparisAksiyonlari http={http} orderPublicId={selectedOrder.public_id} onChanged={() => refreshOrders({ page: orderPage })} />
              </DetailPanel>
            )}
            {editingOrderId && (
              <SiparisDuzenleModal
                http={http}
                orderPublicId={editingOrderId}
                onClose={() => setEditingOrderId(null)}
                onSaved={() => {
                  setEditingOrderId(null);
                  void refreshOrders({ page: orderPage });
                }}
              />
            )}
          </FlowPanel>
  );
}

