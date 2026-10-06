import { useRef, useState } from "react";
import { type ConversationSummary, type OrderSummary } from "../../../api/domain-client.js";
import { BackendRequestError } from "../../../api/http-client.js";
import { type OrderSortBy, type SortDirection, type OrderCargoProvider, type OrderFormItem, type OrderFormState, orderStatusLabel, cargoProviderLabel, isRecord, defaultOrderForm, parseMoneyInput, orderFormTotals } from "../shared.js";
import { rawMessage, uiMessage, type StatusKey, type UiMessage } from "../../i18n/messages/status.js";
import type { DashboardCore } from "./types.js";

/** Orders flow: list filters/sort/paging, selection, Excel export, cancellation and the order form. */
export function useOrdersFlow(core: DashboardCore, selectedConversation: ConversationSummary | null) {
  const { domain, data, setData, setStatus } = core;
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [orderFilter, setOrderFilter] = useState("all");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [orderSourceFilter, setOrderSourceFilter] = useState("all");
  const [orderCargoFilter, setOrderCargoFilter] = useState("all");
  const [orderPersonnelFilter, setOrderPersonnelFilter] = useState("all");
  const [orderCreatedFrom, setOrderCreatedFrom] = useState("");
  const [orderCreatedTo, setOrderCreatedTo] = useState("");
  const [orderSortBy, setOrderSortBy] = useState<OrderSortBy>("created_at");
  const [orderSortDirection, setOrderSortDirection] = useState<SortDirection>("desc");
  const [orderPage, setOrderPage] = useState(0);
  const [orderTotalCount, setOrderTotalCount] = useState(0);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(() => new Set());
  const [orderFormOpen, setOrderFormOpen] = useState(false);
  const [orderFormSubmitting, setOrderFormSubmitting] = useState(false);
  const [orderFormMessage, setOrderFormMessage] = useState<UiMessage | null>(null);
  const [orderForm, setOrderForm] = useState<OrderFormState>(() => defaultOrderForm());
  const orderFilterRequestSeqRef = useRef(0);

  function orderListParams(overrides: Partial<{
    status: string;
    confirmation_status: string;
    search: string;
    source: string;
    cargo_provider: string;
    created_by_user_public_id: string;
    created_from: string;
    created_to: string;
    sort_by: OrderSortBy;
    sort_direction: SortDirection;
    page: number;
    limit: number;
  }> = {}) {
    const status = overrides.status ?? orderStatusFilter;
    const source = overrides.source ?? orderSourceFilter;
    const cargoProvider = overrides.cargo_provider ?? orderCargoFilter;
    const personnel = overrides.created_by_user_public_id ?? orderPersonnelFilter;
    const search = overrides.search ?? orderSearch;
    const createdFrom = overrides.created_from ?? orderCreatedFrom;
    const createdTo = overrides.created_to ?? orderCreatedTo;
    const sortBy = overrides.sort_by ?? orderSortBy;
    const sortDirection = overrides.sort_direction ?? orderSortDirection;
    const page = overrides.page ?? orderPage;
    const limit = overrides.limit ?? 20;
    const params: Parameters<typeof domain.listOrders>[0] = {
      limit,
      offset: page * limit,
      sort_by: sortBy,
      sort_direction: sortDirection,
    };
    if (status !== "all") params.status = status;
    if (overrides.confirmation_status) params.confirmation_status = overrides.confirmation_status;
    if (source !== "all") params.source = source;
    if (cargoProvider !== "all") params.cargo_provider = cargoProvider;
    if (personnel !== "all") params.created_by_user_public_id = personnel;
    if (search.trim()) params.search = search.trim();
    if (createdFrom) params.created_from = createdFrom;
    if (createdTo) params.created_to = createdTo;
    return params;
  }

  async function refreshOrders(overrides: Parameters<typeof orderListParams>[0] = {}) {
    await refreshOrdersWithParams(orderListParams(overrides));
  }

  async function refreshOrdersWithParams(params: Parameters<typeof domain.listOrders>[0]) {
    const requestSeq = orderFilterRequestSeqRef.current + 1;
    orderFilterRequestSeqRef.current = requestSeq;
    setStatus(uiMessage("orderFiltersApplying"));
    const orders = await domain.listOrders(params);
    if (orderFilterRequestSeqRef.current !== requestSeq) return;
    setData((current) => ({
      ...current,
      orders: orders.data,
    }));
    setOrderTotalCount(orders.meta?.total_count ?? orders.data.length);
    setSelectedOrderId(orders.data[0]?.public_id ?? null);
    setSelectedOrderIds(new Set());
    setStatus(uiMessage("orderFiltersApplied"));
  }

  async function handleApplyOrderFilter(nextFilter: string) {
    setOrderFilter(nextFilter);
    setOrderPage(0);
    setOrderStatusFilter("all");
    let params: Parameters<typeof domain.listOrders>[0] = { limit: 20 };
    if (nextFilter === "active") {
      setOrderStatusFilter("active");
      params = { status: "active", limit: 20 };
    }
    if (nextFilter === "pending_confirmation") {
      params = { confirmation_status: "pending", limit: 20 };
    }
    if (nextFilter === "delivered") {
      setOrderStatusFilter("delivered");
      params = { status: "delivered", limit: 20 };
    }
    await refreshOrdersWithParams(params);
  }

  async function handleApplyOrderAdvancedFilters() {
    setOrderFilter("custom");
    setOrderPage(0);
    await refreshOrders({ page: 0, confirmation_status: "" });
  }

  async function handleOrderPage(nextPage: number) {
    const boundedPage = Math.max(0, nextPage);
    setOrderPage(boundedPage);
    await refreshOrders({ page: boundedPage, confirmation_status: orderFilter === "pending_confirmation" ? "pending" : "" });
  }

  async function handleOrderSort(nextSortBy: OrderSortBy) {
    const nextDirection: SortDirection = orderSortBy === nextSortBy && orderSortDirection === "desc" ? "asc" : "desc";
    setOrderSortBy(nextSortBy);
    setOrderSortDirection(nextDirection);
    setOrderPage(0);
    await refreshOrders({
      page: 0,
      sort_by: nextSortBy,
      sort_direction: nextDirection,
      confirmation_status: orderFilter === "pending_confirmation" ? "pending" : "",
    });
  }

  function openOrderForm(source: "orders" | "conversation" = "orders") {
    const conversation = source === "conversation" ? selectedConversation : null;
    setOrderForm({
      ...defaultOrderForm(data.products),
      customer_name: conversation?.customer?.full_name ?? "",
      customer_phone: conversation?.customer?.phone ?? "",
      conversation_public_id: conversation?.public_id ?? null,
      notes: source === "conversation" ? "Konuşmadan oluşturuldu" : "",
    });
    setOrderFormMessage(null);
    setOrderFormOpen(true);
  }

  function updateOrderFormItem(index: number, patch: Partial<OrderFormItem>) {
    setOrderForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
      force_duplicate: false,
      force_surat_at: false,
    }));
  }

  function selectOrderFormProduct(index: number, productPublicId: string) {
    const product = data.products.find((item) => item.public_id === productPublicId);
    updateOrderFormItem(index, {
      product_public_id: productPublicId,
      name: product?.name ?? "",
      unit_price: product?.unit_price ?? "0.00",
      external_product_id: product?.external_product_id ?? null,
    });
  }

  function addOrderFormItem() {
    setOrderForm((current) => ({
      ...current,
      items: [...current.items, { product_public_id: "", name: "", quantity: 1, unit_price: "0.00", external_product_id: null }],
    }));
  }

  function removeOrderFormItem(index: number) {
    setOrderForm((current) => ({
      ...current,
      items: current.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  async function lookupOrderCustomerByPhone() {
    const phone = orderForm.customer_phone.trim();
    if (phone.replace(/\D/g, "").length < 10) return;
    const lookup = await domain.lookupCustomerByPhone(phone);
    if (!lookup.customer) return;
    setOrderForm((current) => ({
      ...current,
      customer_public_id: lookup.customer?.public_id ?? current.customer_public_id,
      customer_name: lookup.customer?.full_name ?? current.customer_name,
      customer_phone: lookup.customer?.phone ?? current.customer_phone,
      address_line: lookup.default_address?.address_line ?? current.address_line,
      city: lookup.default_address?.city ?? current.city,
      district: lookup.default_address?.district ?? current.district,
      country: lookup.default_address?.country ?? current.country,
    }));
    setOrderFormMessage(uiMessage("customerFoundByPhone"));
  }

  async function handleSubmitOrderForm() {
    const validationKey: StatusKey | null = !orderForm.customer_name.trim() ? "customerNameRequired"
      : !orderForm.customer_phone.trim() ? "customerPhoneRequired"
      : !orderForm.city.trim() ? "cityRequired"
      : !orderForm.district.trim() ? "districtRequired"
      : !orderForm.address_line.trim() ? "addressRequired"
      : !orderForm.cargo_provider ? "cargoProviderRequired"
      : null;
    const validationError = validationKey ? uiMessage(validationKey) : null;
    if (validationError) {
      setOrderFormMessage(validationError);
      setStatus(validationError);
      return;
    }
    if (orderFormTotals(orderForm.items).genelToplam <= 0) {
      setOrderFormMessage(uiMessage("orderZeroTotal"));
      setStatus(uiMessage("orderZeroTotal"));
      return;
    }
    if (!orderForm.items.some((item) => item.name.trim())) {
      setOrderFormMessage(uiMessage("productRequired"));
      setStatus(uiMessage("productRequired"));
      return;
    }

    setOrderFormSubmitting(true);
    setStatus(uiMessage("orderCreating"));
    try {
      const order = await domain.createOrder({
        customer_public_id: orderForm.customer_public_id,
        customer: {
          full_name: orderForm.customer_name.trim(),
          phone: orderForm.customer_phone.trim(),
        },
        address: {
          address_line: orderForm.address_line.trim(),
          city: orderForm.city.trim(),
          district: orderForm.district.trim(),
          country: orderForm.country.trim() || "Türkiye",
        },
        conversation_public_id: orderForm.conversation_public_id,
        status: "draft",
        source: orderForm.conversation_public_id ? "conversation" : "manual",
        cargo_provider: orderForm.cargo_provider as OrderCargoProvider,
        notes: orderForm.notes.trim() || null,
        currency: "TRY",
        force_duplicate: orderForm.force_duplicate,
        force_surat_at: orderForm.force_surat_at,
        items: orderForm.items
          .filter((item) => item.name.trim())
          .map((item) => ({
            product_public_id: item.product_public_id || null,
            name: item.name.trim(),
            quantity: Math.max(Number(item.quantity) || 1, 1),
            unit_price: parseMoneyInput(item.unit_price).toFixed(2),
            external_product_id: item.external_product_id,
          })),
      });
      setData((current) => ({
        ...current,
        orders: [order, ...current.orders],
      }));
      setSelectedOrderId(order.public_id);
      setOrderFormOpen(false);
      setOrderFormMessage(null);
      setStatus(uiMessage("orderCreated", { orderNumber: order.order_number }));
    } catch (error) {
      if (error instanceof BackendRequestError && error.status === 409 && isRecord(error.body)) {
        const bodyError = isRecord(error.body.error) ? error.body.error : null;
        const code = typeof bodyError?.code === "string" ? bodyError.code : "";
        const message = typeof bodyError?.message === "string" ? rawMessage(bodyError.message) : uiMessage("orderCreateWarning");
        setOrderFormMessage(message);
        setStatus(message);
        if (code === "duplicate_phone_warning" || code === "duplicate_name_warning") {
          setOrderForm((current) => ({ ...current, force_duplicate: true }));
        }
        if (code === "surat_at_warning") {
          setOrderForm((current) => ({ ...current, force_surat_at: true }));
        }
        return;
      }
      setOrderFormMessage(error instanceof Error ? uiMessage("orderCreateFailedWith", { message: error.message }) : uiMessage("orderCreateFailed"));
      setStatus(uiMessage("orderCreateFailed"));
    } finally {
      setOrderFormSubmitting(false);
    }
  }

  function toggleOrderSelection(orderPublicId: string) {
    setSelectedOrderIds((current) => {
      const next = new Set(current);
      if (next.has(orderPublicId)) next.delete(orderPublicId);
      else next.add(orderPublicId);
      return next;
    });
  }

  function toggleAllVisibleOrders() {
    setSelectedOrderIds((current) => {
      const visibleIds = data.orders.map((order) => order.public_id);
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => current.has(id));
      if (allSelected) return new Set([...current].filter((id) => !visibleIds.includes(id)));
      return new Set([...current, ...visibleIds]);
    });
  }

  function downloadOrderExcel(rows: OrderSummary[], format: "liste" | "telefon") {
    const headers = format === "telefon"
      ? ["İsim", "Telefon"]
      : ["Sipariş No", "Müşteri", "Durum", "Kaynak", "Kargo", "Personel", "Tutar", "Tarih"];
    const bodyRows = rows.map((order) => format === "telefon"
      ? [order.customer_full_name ?? order.order_number, ""]
      : [
          order.order_number,
          order.customer_full_name ?? "",
          orderStatusLabel(order.status),
          order.source,
          cargoProviderLabel(order.cargo_provider),
          order.created_by_user_email ?? "",
          `${order.total_amount} ${order.currency}`,
          new Date(order.created_at).toLocaleDateString("tr-TR"),
        ]);
    const escapeCell = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const tableRows = [headers, ...bodyRows]
      .map((row) => `<tr>${row.map((cell) => `<td>${escapeCell(String(cell))}</td>`).join("")}</tr>`)
      .join("");
    const blob = new Blob(
      [`<html><head><meta charset="utf-8" /></head><body><table>${tableRows}</table></body></html>`],
      { type: "application/vnd.ms-excel;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `siparisler-${format}-${new Date().toISOString().slice(0, 10)}.xls`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportOrders(scope: "current" | "selected" | "all") {
    const selectedRows = data.orders.filter((order) => selectedOrderIds.has(order.public_id));
    if (scope === "selected") {
      downloadOrderExcel(selectedRows, "liste");
      setStatus(uiMessage("ordersExportedSelected", { count: selectedRows.length }));
      return;
    }
    if (scope === "current") {
      downloadOrderExcel(data.orders, "liste");
      setStatus(uiMessage("ordersExportedVisible", { count: data.orders.length }));
      return;
    }
    const orders = await domain.listOrders(orderListParams({ page: 0, limit: 200, confirmation_status: orderFilter === "pending_confirmation" ? "pending" : "" }));
    downloadOrderExcel(orders.data, "liste");
    setStatus(uiMessage("ordersExportedFiltered", { count: orders.data.length }));
  }

  async function handleCancelSelectedOrder() {
    const order = selectedOrder;
    if (!order) return;

    setStatus(uiMessage("cancellationUpdating"));
    const updated = await domain.updateOrderStatus(order.public_id, {
      status: "cancelled",
      notes: "Frontend iptal inceleme onayi",
    });
    setData((current) => ({
      ...current,
      orders: current.orders.map((item) => (item.public_id === updated.public_id ? updated : item)),
    }));
    setSelectedOrderId(updated.public_id);
    setStatus(uiMessage("cancellationUpdated"));
  }

  const selectedOrder = data.orders.find((order) => order.public_id === selectedOrderId) ?? data.orders[0] ?? null;
  const visibleOrderIds = data.orders.map((order) => order.public_id);
  const allVisibleOrdersSelected = visibleOrderIds.length > 0 && visibleOrderIds.every((id) => selectedOrderIds.has(id));
  const orderPageCount = Math.max(1, Math.ceil(orderTotalCount / 20));
  const orderSources = [...new Set(data.orders.map((order) => order.source).filter(Boolean))].sort();
  const orderPersonnel = [...new Map(data.orders
    .filter((order) => order.created_by_user_public_id && order.created_by_user_email)
    .map((order) => [order.created_by_user_public_id as string, order.created_by_user_email as string])).entries()];
  const currentOrderFormTotals = orderFormTotals(orderForm.items);

  return {
    selectedOrderId,
    setSelectedOrderId,
    orderFilter,
    setOrderFilter,
    orderSearch,
    setOrderSearch,
    orderStatusFilter,
    setOrderStatusFilter,
    orderSourceFilter,
    setOrderSourceFilter,
    orderCargoFilter,
    setOrderCargoFilter,
    orderPersonnelFilter,
    setOrderPersonnelFilter,
    orderCreatedFrom,
    setOrderCreatedFrom,
    orderCreatedTo,
    setOrderCreatedTo,
    orderSortBy,
    setOrderSortBy,
    orderSortDirection,
    setOrderSortDirection,
    orderPage,
    setOrderPage,
    orderTotalCount,
    setOrderTotalCount,
    selectedOrderIds,
    setSelectedOrderIds,
    orderFormOpen,
    setOrderFormOpen,
    orderFormSubmitting,
    setOrderFormSubmitting,
    orderFormMessage,
    setOrderFormMessage,
    orderForm,
    setOrderForm,
    orderFilterRequestSeqRef,
    orderListParams,
    refreshOrders,
    refreshOrdersWithParams,
    handleApplyOrderFilter,
    handleApplyOrderAdvancedFilters,
    handleOrderPage,
    handleOrderSort,
    openOrderForm,
    updateOrderFormItem,
    selectOrderFormProduct,
    addOrderFormItem,
    removeOrderFormItem,
    lookupOrderCustomerByPhone,
    handleSubmitOrderForm,
    toggleOrderSelection,
    toggleAllVisibleOrders,
    downloadOrderExcel,
    handleExportOrders,
    handleCancelSelectedOrder,
    selectedOrder,
    visibleOrderIds,
    allVisibleOrdersSelected,
    orderPageCount,
    orderSources,
    orderPersonnel,
    currentOrderFormTotals,
  };
}
