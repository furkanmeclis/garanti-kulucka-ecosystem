import { Calendar, CheckSquare, Download, Search, ShoppingCart, Square, Trash2, XCircle } from "lucide-react";
import { SiparisAksiyonlari, SiparisTopluAksiyonlar } from "../SiparisAksiyonlari.js";
import { KargoSiparisAksiyonlari, KargoTopluAktar } from "../KargoOlusturModal.js";
import { cx, orderStatusLabel, cargoProviderLabel, formatMoney, parseMoneyInput, FlowPanel, DetailPanel, Metric, DataRows } from "../../app/shared.js";
import type { DashboardController } from "../../app/useDashboardController.js";

export function OrdersFlow({ ctx }: { ctx: DashboardController }) {
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
    <FlowPanel title="Siparişler" icon={<ShoppingCart size={18} />} testId="orders-flow">
            <div className="report-grid">
              <Metric title="Toplam Sipariş" value={String(data.orderSummary.total_count)} />
              <Metric title="Aktif Sipariş" value={String(data.orderSummary.active_count)} />
              <Metric title="Teyit Bekleyen" value={String(data.orderSummary.pending_confirmation_count)} />
              <Metric title="Ciro" value={formatMoney(data.orderSummary.total_revenue, data.orderSummary.currency)} />
            </div>
            <div className="orders-toolbar" data-testid="order-section-filters">
              <button
                className={cx("secondary-action", orderFilter === "all" && "selected")}
                data-testid="order-filter-all"
                type="button"
                onClick={() => void handleApplyOrderFilter("all")}
              >
                Hepsi {orderFilter === "all" ? data.orderSummary.total_count : "sonuç"}
              </button>
              <button
                className={cx("secondary-action", orderFilter === "active" && "selected")}
                data-testid="order-filter-active"
                type="button"
                onClick={() => void handleApplyOrderFilter("active")}
              >
                Aktif {orderFilter === "all" || orderFilter === "active" ? data.orderSummary.active_count : "sonuç"}
              </button>
              <button
                className={cx("secondary-action", orderFilter === "pending_confirmation" && "selected")}
                data-testid="order-filter-pending-confirmation"
                type="button"
                onClick={() => void handleApplyOrderFilter("pending_confirmation")}
              >
                Teyit {orderFilter === "all" || orderFilter === "pending_confirmation" ? data.orderSummary.pending_confirmation_count : "sonuç"}
              </button>
              <button
                className={cx("secondary-action", orderFilter === "delivered" && "selected")}
                data-testid="order-filter-delivered"
                type="button"
                onClick={() => void handleApplyOrderFilter("delivered")}
              >
                Teslim {orderFilter === "all" || orderFilter === "delivered" ? data.orderSummary.delivered_count : "sonuç"}
              </button>
            </div>
            <div className="orders-filter-grid" data-testid="orders-advanced-filters">
              <label>
                <span>Arama</span>
                <input
                  className="inline-input"
                  data-testid="orders-search-input"
                  placeholder="Sipariş, müşteri, not"
                  value={orderSearch}
                  onChange={(event) => setOrderSearch(event.target.value)}
                />
              </label>
              <label>
                <span>Durum</span>
                <select className="inline-input" data-testid="orders-status-filter" value={orderStatusFilter} onChange={(event) => setOrderStatusFilter(event.target.value)}>
                  <option value="all">Tüm durumlar</option>
                  <option value="active">Aktif</option>
                  <option value="draft">Oluşturuldu</option>
                  <option value="delivered">Teslim Edildi</option>
                  <option value="cancelled">İptal</option>
                  <option value="returned">İade</option>
                </select>
              </label>
              <label>
                <span>Kaynak</span>
                <select className="inline-input" data-testid="orders-source-filter" value={orderSourceFilter} onChange={(event) => setOrderSourceFilter(event.target.value)}>
                  <option value="all">Tüm kaynaklar</option>
                  <option value="manual">manual</option>
                  {orderSources.filter((source) => source !== "manual").map((source) => (
                    <option key={source} value={source}>{source}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Kargo</span>
                <select className="inline-input" data-testid="orders-cargo-filter" value={orderCargoFilter} onChange={(event) => setOrderCargoFilter(event.target.value)}>
                  <option value="all">Tüm kargolar</option>
                  <option value="ptt">PTT</option>
                  <option value="surat">Sürat</option>
                  <option value="other">Diğer</option>
                </select>
              </label>
              <label>
                <span>Personel</span>
                <select className="inline-input" data-testid="orders-person-filter" value={orderPersonnelFilter} onChange={(event) => setOrderPersonnelFilter(event.target.value)}>
                  <option value="all">Tüm personel</option>
                  {orderPersonnel.map(([publicId, email]) => (
                    <option key={publicId} value={publicId}>{email}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Başlangıç</span>
                <input className="inline-input" data-testid="orders-date-from" type="date" value={orderCreatedFrom} onChange={(event) => setOrderCreatedFrom(event.target.value)} />
              </label>
              <label>
                <span>Bitiş</span>
                <input className="inline-input" data-testid="orders-date-to" type="date" value={orderCreatedTo} onChange={(event) => setOrderCreatedTo(event.target.value)} />
              </label>
              <button className="primary-action icon-action" data-testid="orders-apply-filters" type="button" onClick={() => void handleApplyOrderAdvancedFilters()}>
                <Search size={16} aria-hidden="true" />
                <span>Filtrele</span>
              </button>
            </div>
            <div className="orders-toolbar">
              <button className="primary-action" type="button" onClick={() => openOrderForm("orders")}>
                Sipariş oluştur
              </button>
              <button className="secondary-action icon-action" data-testid="orders-export-current" type="button" onClick={() => void handleExportOrders("current")}>
                <Download size={16} aria-hidden="true" />
                <span>Excel indir</span>
              </button>
              <button className="secondary-action icon-action" data-testid="orders-export-all" type="button" onClick={() => void handleExportOrders("all")}>
                <Download size={16} aria-hidden="true" />
                <span>Filtreli Excel</span>
              </button>
              <button className="secondary-action" data-testid="orders-export-selected" disabled={selectedOrderIds.size === 0} type="button" onClick={() => void handleExportOrders("selected")}>
                Seçilenleri indir ({selectedOrderIds.size})
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
                    <h2>Sipariş Oluştur</h2>
                    <button className="secondary-action icon-only" type="button" onClick={() => setOrderFormOpen(false)} aria-label="Kapat">
                      <XCircle size={16} aria-hidden="true" />
                    </button>
                  </div>
                  {orderFormMessage && (
                    <div className="order-form-message" data-testid="order-form-message">
                      {orderFormMessage}
                    </div>
                  )}
                  <div className="order-form-grid">
                    <label>
                      <span>İsim</span>
                      <input
                        className="inline-input"
                        data-testid="order-form-name"
                        placeholder="İsim Soyisim"
                        value={orderForm.customer_name}
                        onChange={(event) => setOrderForm((current) => ({ ...current, customer_name: event.target.value, customer_public_id: null, force_duplicate: false }))}
                      />
                    </label>
                    <label>
                      <span>Telefon</span>
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
                      <span>Ürünler</span>
                      <button className="secondary-action" data-testid="order-form-add-item" type="button" onClick={addOrderFormItem}>
                        Ürün Ekle
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
                          <option value="">Ürün seç...</option>
                          {data.products.map((product) => (
                            <option key={product.public_id} value={product.public_id}>{product.name}</option>
                          ))}
                        </select>
                        <input
                          className="inline-input"
                          data-testid={`order-form-item-name-${index}`}
                          placeholder="Ürün adı"
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
                          <button className="secondary-action icon-only" type="button" onClick={() => removeOrderFormItem(index)} aria-label="Ürünü çıkar">
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="order-form-grid">
                    <label>
                      <span>Şehir</span>
                      <input
                        className="inline-input"
                        data-testid="order-form-city"
                        placeholder="Şehir"
                        value={orderForm.city}
                        onChange={(event) => setOrderForm((current) => ({ ...current, city: event.target.value, force_surat_at: false }))}
                      />
                    </label>
                    <label>
                      <span>İlçe</span>
                      <input
                        className="inline-input"
                        data-testid="order-form-district"
                        placeholder="İlçe"
                        value={orderForm.district}
                        onChange={(event) => setOrderForm((current) => ({ ...current, district: event.target.value, force_surat_at: false }))}
                      />
                    </label>
                  </div>
                  <label className="order-form-full">
                    <span>Adres</span>
                    <textarea
                      className="inline-input"
                      data-testid="order-form-address"
                      placeholder="Adres"
                      rows={2}
                      value={orderForm.address_line}
                      onChange={(event) => setOrderForm((current) => ({ ...current, address_line: event.target.value, force_surat_at: false }))}
                    />
                  </label>
                  <label className="order-form-full">
                    <span>Not</span>
                    <input
                      className="inline-input"
                      data-testid="order-form-notes"
                      placeholder="Sipariş notu..."
                      value={orderForm.notes}
                      onChange={(event) => setOrderForm((current) => ({ ...current, notes: event.target.value }))}
                    />
                  </label>
                  <div className="order-form-cargo" data-testid="order-form-cargo">
                    <span>Kargo</span>
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
                      ["Ara Toplam", `${currentOrderFormTotals.araToplam.toFixed(2)} TRY`, "KDV hariç"],
                      ["KDV", `${currentOrderFormTotals.kdvToplam.toFixed(2)} TRY`, "%20"],
                      ["Genel Toplam", `${currentOrderFormTotals.genelToplam.toFixed(2)} TRY`, "KDV dahil"],
                    ]}
                  />
                  <button className="primary-action order-form-submit" data-testid="order-form-submit" disabled={orderFormSubmitting} type="submit">
                    {orderFormSubmitting
                      ? "Oluşturuluyor..."
                      : orderForm.force_surat_at
                        ? "Oluştur"
                        : orderForm.force_duplicate
                          ? "Yine de Oluştur"
                          : "Sipariş Oluştur"}
                  </button>
                </form>
              </div>
            )}
            <div className="orders-list" data-testid="orders-list">
              <div className="orders-list-header">
                <button className="secondary-action icon-only" data-testid="orders-select-all" type="button" onClick={toggleAllVisibleOrders} aria-label="Tümünü seç">
                  {allVisibleOrdersSelected ? <CheckSquare size={16} aria-hidden="true" /> : <Square size={16} aria-hidden="true" />}
                </button>
                <button className="orders-sort-button" type="button" onClick={() => void handleOrderSort("order_number")}>Sipariş No</button>
                <span>Müşteri</span>
                <button className="orders-sort-button" type="button" onClick={() => void handleOrderSort("status")}>Durum</button>
                <span>Kaynak</span>
                <span>Kargo</span>
                <span>Personel</span>
                <button className="orders-sort-button" type="button" onClick={() => void handleOrderSort("total_amount")}>Tutar</button>
                <button className="orders-sort-button" type="button" onClick={() => void handleOrderSort("created_at")}>Tarih</button>
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
                  <span>{order.customer_full_name ?? "Müşteri eşleşmedi"}</span>
                  <span>{orderStatusLabel(order.status)}</span>
                  <span>{order.source}</span>
                  <span>{cargoProviderLabel(order.cargo_provider)}</span>
                  <span>{order.created_by_user_email ?? "-"}</span>
                  <span>{order.total_amount} {order.currency}</span>
                  <span><Calendar size={14} aria-hidden="true" /> {new Date(order.created_at).toLocaleDateString("tr-TR")}</span>
                </button>
              ))}
            </div>
            <div className="orders-pagination" data-testid="orders-pagination">
              <span>{orderTotalCount.toLocaleString("tr-TR")} kayıt, sayfa {orderPage + 1}/{orderPageCount}</span>
              <button className="secondary-action" disabled={orderPage === 0} type="button" onClick={() => void handleOrderPage(orderPage - 1)}>Önceki</button>
              <button className="secondary-action" disabled={orderPage + 1 >= orderPageCount} type="button" onClick={() => void handleOrderPage(orderPage + 1)}>Sonraki</button>
            </div>
            {selectedOrder && (
              <DetailPanel title="Sipariş Detayı" testId="order-detail">
                <DataRows
                  rows={[
                    ["Sipariş No", selectedOrder.order_number, orderStatusLabel(selectedOrder.status)],
                    ["Müşteri", selectedOrder.customer_full_name ?? "Müşteri eşleşmedi", selectedOrder.source],
                    [
                      "Tutar",
                      `${selectedOrder.total_amount} ${selectedOrder.currency}`,
                      selectedOrder.confirmation_status ?? "teyit bekliyor",
                    ],
                    ["Kargo", cargoProviderLabel(selectedOrder.cargo_provider), selectedOrder.created_by_user_email ?? "personel yok"],
                    ["Not", selectedOrder.notes ?? "-", selectedOrder.updated_at],
                  ]}
                />
                <KargoSiparisAksiyonlari
                  http={http}
                  orderPublicId={selectedOrder.public_id}
                  onChanged={(result) => void refreshOrders().then(() => setSelectedOrderId(result.order_public_id))}
                />
                <SiparisAksiyonlari http={http} orderPublicId={selectedOrder.public_id} onChanged={() => refreshOrders({ page: orderPage })} />
              </DetailPanel>
            )}
          </FlowPanel>
  );
}

