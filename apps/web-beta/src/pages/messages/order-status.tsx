import { Loader2, MapPin, Package, RefreshCw, Truck, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { BrandIcon } from "@/components/brand-icons";
import type { ShipmentSummary } from "@garanti-kulucka/shared";
import { humanize } from "@/lib/chat";
import { formatDateTime } from "@/lib/format";
import type { EditableOrder, OrderRow } from "@/lib/orders";
import { statusKey, statusTone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";
import { LegacyBadge, useChatToast } from "./chat-ui";
import { chatTipClass } from "./top-bar";

const money = (value: string | number | null | undefined) => `₺${Number(value ?? 0).toLocaleString("tr-TR")}`;
const providerOf = (value: string | null | undefined) => ((value ?? "").toLowerCase().includes("ptt") ? "ptt" : "surat");

/** Order status pill: translated label (humanized fallback) with a tooltip naming what it is. */
function StatusPill({ value }: { value: string }) {
  const { t } = useTranslation();
  const key = statusKey(value);
  const label = key ? t(`status.${key}` as "status.delivered") : humanize(value);
  return (
    <Tip label={t("chat.orderStatusHint", { status: label })} className={chatTipClass}>
      <span tabIndex={0} className="inline-flex shrink-0">
        <LegacyBadge tone={statusTone(value)}>{label}</LegacyBadge>
      </span>
    </Tip>
  );
}

const cardClass = "rounded-lg border border-msg-border bg-msg-base/50 p-2.5";
const detailButton =
  "flex w-full items-center justify-center gap-1.5 rounded-md border border-msg-primary/40 bg-msg-primary/10 px-2 py-1.5 text-[11px] font-medium text-msg-primary-text transition-colors hover:bg-msg-primary/20 max-lg:min-h-11";

/** "Sipariş Sorgusu" detail (search result or a customer order): customer, address, total, items and cargo block. */
export function OrderDetail({ row, onBack, onCargo }: { row: OrderRow; onBack: () => void; onCargo: (shipmentPublicId: string) => void }) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const toast = useChatToast();
  const [order, setOrder] = useState<EditableOrder | null>(null);
  const [shipment, setShipment] = useState<ShipmentSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setOrder(null);
    setShipment(null);
    Promise.all([api.getEditableOrder(row.public_id).then((response) => response.order), row.shipment ? api.getShipment(row.shipment.public_id).catch(() => null) : Promise.resolve(null)])
      .then(([detail, cargo]) => {
        if (!active) return;
        setOrder(detail);
        setShipment(cargo);
      })
      .catch(() => active && toast.error(t("chat.orderDetailFailed")))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [api, row.public_id, row.shipment, t, toast]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8">
        <Loader2 className="size-4 animate-spin text-msg-muted" aria-hidden="true" />
        <span className="text-xs text-msg-muted">{t("chat.loadingOrders")}</span>
      </div>
    );
  }

  const tracking = row.shipment?.tracking_number ?? shipment?.tracking_number ?? null;
  const provider = row.shipment?.provider ?? row.cargo_provider ?? order?.cargo_provider ?? null;
  return (
    <div className="space-y-3" data-testid="order-detail">
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate text-sm font-semibold text-msg-fg-strong">
          {t("chat.orderQueryTitle")} #{row.order_number}
        </h3>
        <Tip label={t("chat.backToOrderList")} className={chatTipClass}>
        <button type="button" onClick={onBack} aria-label={t("chat.backToOrderList")} className="shrink-0 rounded-md p-1 text-msg-muted hover:bg-msg-hover-raised hover:text-msg-fg max-lg:inline-flex max-lg:size-11 max-lg:items-center max-lg:justify-center" data-testid="order-detail-close">
          <X className="size-3.5" aria-hidden="true" />
        </button>
        </Tip>
      </div>

      <div className={cn(cardClass, "space-y-2")}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-msg-fg">{order?.customer?.full_name ?? row.customer_full_name ?? "-"}</p>
            <p className="text-[10px] text-msg-muted">{order?.customer?.phone ?? row.customer_phone ?? "-"}</p>
          </div>
          <StatusPill value={row.status} />
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
          <span className="text-msg-subtle">{t("chat.address")}</span>
          <span className="text-msg-fg-soft">{order?.address?.address_line || "-"}</span>
          <span className="text-msg-subtle">{t("chat.city")}</span>
          <span className="text-msg-fg-soft">{[order?.address?.city, order?.address?.district].filter(Boolean).join(" / ") || "-"}</span>
          <span className="text-msg-subtle">{t("chat.price")}</span>
          <span className="font-medium text-msg-fg">{money(order?.total_amount ?? row.total_amount)}</span>
          {(order?.notes ?? row.notes) && (
            <>
              <span className="text-msg-subtle">{t("chat.note")}</span>
              <span className="text-msg-fg-soft">{order?.notes ?? row.notes}</span>
            </>
          )}
        </div>
        {(order?.items.length ?? 0) > 0 && (
          <div className="space-y-1 border-t border-msg-border/60 pt-2">
            <div className="text-[10px] font-medium text-msg-muted">{t("chat.products")}</div>
            {order!.items.map((item) => (
              <div key={item.public_id} className="flex justify-between text-[11px]">
                <span className="text-msg-fg-soft">
                  {item.name} x{item.quantity}
                </span>
                <span className="text-msg-muted">{money(item.total_amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={cn(cardClass, "space-y-2")}>
        <h4 className="text-[10px] font-semibold tracking-wide text-msg-muted uppercase">{t("chat.cargoInfo")}</h4>
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
          <span className="text-msg-subtle">{t("chat.shipping")}</span>
          <span className="flex items-center gap-1 text-msg-fg-soft">
            {provider ? (
              <>
                <BrandIcon brand={providerOf(provider)} className="size-3.5" title="" />
                {providerOf(provider) === "ptt" ? "PTT Kargo" : "Sürat Kargo"}
              </>
            ) : (
              "-"
            )}
          </span>
          <span className="text-msg-subtle">{t("chat.trackingNo")}</span>
          <span className="font-mono text-msg-fg-soft">{tracking ?? "-"}</span>
          <span className="text-msg-subtle">{t("chat.lastEvent")}</span>
          <span className="text-msg-fg-soft">{shipment?.last_event_text || t("chat.noTrackingNo")}</span>
          <span className="text-msg-subtle">{t("chat.date")}</span>
          <span className="text-msg-fg-soft">{formatDateTime(row.created_at, i18n.language) || "-"}</span>
        </div>
        {tracking && row.shipment && (
          <button type="button" onClick={() => onCargo(row.shipment!.public_id)} className={detailButton} data-testid="order-detail-cargo">
            <MapPin className="size-3.5" aria-hidden="true" />
            {t("chat.cargoDetail")}
          </button>
        )}
      </div>
    </div>
  );
}

/** "Müşteri Siparişleri": the open customer's orders with tracking number, carrier chip and Kargo Detayı. */
export function CustomerOrders({ load, reloadKey, onOpen, onCargo }: { load: () => Promise<OrderRow[]>; reloadKey: string; onOpen: (row: OrderRow) => void; onCargo: (shipmentPublicId: string) => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const loadRef = useCallback(load, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(() => {
    setLoading(true);
    loadRef()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [loadRef]);

  useEffect(() => refresh(), [refresh]);

  return (
    <div className="space-y-2" data-testid="customer-orders">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-msg-fg-strong">{t("chat.customerOrders")}</h3>
        <Tip label={t("chat.refresh")} className={chatTipClass}>
        <button type="button" onClick={refresh} disabled={loading} aria-label={t("chat.refresh")} className="rounded-md p-1 text-msg-muted hover:bg-msg-hover-raised hover:text-msg-fg disabled:opacity-50 max-lg:inline-flex max-lg:size-11 max-lg:items-center max-lg:justify-center" data-testid="customer-orders-refresh">
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden="true" />
        </button>
        </Tip>
      </div>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8">
          <Loader2 className="size-4 animate-spin text-msg-muted" aria-hidden="true" />
          <span className="text-xs text-msg-muted">{t("chat.loadingOrders")}</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="py-8 text-center">
          <Package className="mx-auto mb-2 size-8 text-msg-faint" aria-hidden="true" />
          <p className="text-xs text-msg-subtle">{t("chat.noCustomerOrders")}</p>
        </div>
      ) : (
        rows.map((row) => {
          const tracking = row.shipment?.tracking_number ?? null;
          const provider = providerOf(row.shipment?.provider ?? row.cargo_provider);
          const openCargo = () => row.shipment && onCargo(row.shipment.public_id);
          return (
            <div
              key={row.public_id}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(row)}
              onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && onOpen(row)}
              className={cn(cardClass, "cursor-pointer hover:border-msg-border-strong")}
              data-testid="customer-order"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Package className="size-3.5 shrink-0 text-msg-subtle" aria-hidden="true" />
                    <span className="truncate text-xs font-medium text-msg-fg">{row.order_number ? `#${row.order_number}` : row.customer_full_name}</span>
                  </div>
                  {tracking && (
                    <Tip label={t("chat.cargoDetail")} className={chatTipClass}>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openCargo();
                      }}
                      className="mt-1 flex items-center gap-1 text-[10px] text-msg-muted hover:text-emerald-600 dark:hover:text-emerald-300"
                    >
                      <Truck className="size-3 shrink-0" aria-hidden="true" />
                      <span className="font-mono">{tracking}</span>
                      <span className={cn("flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-semibold uppercase", provider === "ptt" ? "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300" : "bg-blue-500/15 text-blue-700 dark:text-blue-300")}>
                        <BrandIcon brand={provider} className="size-2.5" title="" />
                        {provider === "ptt" ? "PTT" : "Sürat"}
                      </span>
                    </button>
                    </Tip>
                  )}
                </div>
                <StatusPill value={row.status} />
              </div>
              {tracking && row.shipment ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openCargo();
                  }}
                  className={cn(detailButton, "mt-2")}
                  data-testid="customer-order-cargo"
                >
                  <MapPin className="size-3.5" aria-hidden="true" />
                  {t("chat.cargoDetail")}
                </button>
              ) : (
                <p className="mt-2 text-center text-[10px] text-msg-faint">{t("chat.noTrackingNo")}</p>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
