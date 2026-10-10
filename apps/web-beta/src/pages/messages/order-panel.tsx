import type { OrderSummary } from "@garanti-kulucka/shared";
import { Loader2, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import type { OrderRow, ProductOption } from "@/lib/orders";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { breakpoints, useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { useChatToast, useClickOutside } from "./chat-ui";
import { CargoDialog } from "./cargo-dialog";
import { OrderCreateForm, type OrderPrefill } from "./order-create-form";
import { CustomerOrders, OrderDetail } from "./order-status";

interface SearchHit {
  key: string;
  order: OrderRow | null;
  orderNumber: string | null;
  name: string;
  phone: string;
  total: string | null;
  tracking: string | null;
}

export type PanelMode = "create" | "status";

/**
 * Legacy right panel (xl+, w-80, only with an open conversation): order search on top, one primary button that
 * flips between "Sipariş Oluştur" and "Sipariş / Kargo Durumu", the create form and the status view.
 */
export interface OrderPanelProps {
  conversationId: string;
  prefill: OrderPrefill;
  products: ProductOption[] | null;
  mode: PanelMode;
  onMode: (mode: PanelMode) => void;
  loadCustomerOrders: () => Promise<OrderRow[]>;
  /** Changes after an order is created so "Müşteri Siparişleri" refetches. */
  ordersKey: number;
  onOrderCreated: (order: OrderSummary, total: number, productNames: string[]) => void;
}

/** Desktop (xl+) right column; mounted only at xl so the sheet below xl owns the form state alone. */
export function OrderPanel(props: OrderPanelProps) {
  const wide = useMediaQuery(breakpoints.xl);
  if (!wide) return null;
  return (
    <aside className="hidden min-h-0 w-80 flex-col overflow-y-auto border-l border-msg-border bg-msg-raised msg-scrollbar xl:flex" data-testid="order-panel">
      <div className="flex-1 p-3">
        <OrderPanelBody {...props} />
      </div>
    </aside>
  );
}

/** Below xl the same panel opens from the chat header: bottom sheet on phones, right sheet on 1024–1279 tablets. */
export function OrderSheet({ open, onClose, ...props }: OrderPanelProps & { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const large = useMediaQuery(breakpoints.lg);
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side={large ? "right" : "bottom"}
        closeLabel={t("chat.close")}
        className={cn("gap-0 border-msg-border bg-msg-raised p-0 text-msg-fg", large ? "w-[min(24rem,100vw)]" : "max-h-[92dvh]")}
        aria-describedby={undefined}
        data-testid="order-sheet"
      >
        <SheetTitle className="flex h-12 shrink-0 items-center border-b border-msg-border px-4 pr-14 text-sm text-msg-fg-strong">{t("chat.orderSheetTitle")}</SheetTitle>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 pt-3 msg-scrollbar">
          <OrderPanelBody {...props} sheet />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Search, mode switch, create form and status view: the one implementation behind the column and the sheet. */
function OrderPanelBody({
  conversationId,
  prefill,
  products,
  mode,
  onMode,
  loadCustomerOrders,
  ordersKey,
  onOrderCreated,
  sheet = false,
}: OrderPanelProps & { sheet?: boolean }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const toast = useChatToast();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [detail, setDetail] = useState<OrderRow | null>(null);
  const [cargo, setCargo] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const searchBox = useRef<HTMLDivElement | null>(null);
  const searchSeq = useRef(0);
  useClickOutside(searchBox, () => setResultsOpen(false), resultsOpen);

  // A new conversation drops the previous query result (legacy siparisSorguDetay reset).
  useEffect(() => setDetail(null), [conversationId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setResultsOpen(false);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(timer.current);
    };
  }, []);

  function search(value: string) {
    setQuery(value);
    window.clearTimeout(timer.current);
    if (value.trim().length < 2) {
      setHits([]);
      setResultsOpen(false);
      return;
    }
    setSearching(true);
    setResultsOpen(true);
    onMode("status");
    const seq = ++searchSeq.current;
    timer.current = window.setTimeout(async () => {
      const term = value.trim();
      try {
        // Orders match number / customer name; shipments add tracking number and recipient phone.
        const [orders, shipments] = await Promise.all([
          api.listOrders({ search: term, limit: 8 }).then((response) => response.data as OrderRow[]).catch(() => []),
          api.listShipments({ search: term, limit: 8 }).then((response) => response.data).catch(() => []),
        ]);
        if (seq !== searchSeq.current) return;
        const byNumber = new Map<string, SearchHit>();
        for (const order of orders) {
          byNumber.set(order.order_number, {
            key: order.public_id,
            order,
            orderNumber: order.order_number,
            name: order.customer_full_name ?? "-",
            phone: order.customer_phone ?? "",
            total: order.total_amount,
            tracking: order.shipment?.tracking_number ?? null,
          });
        }
        for (const shipment of shipments) {
          if (shipment.order_number && byNumber.has(shipment.order_number)) continue;
          byNumber.set(shipment.order_number ?? shipment.public_id, {
            key: shipment.public_id,
            order: null,
            orderNumber: shipment.order_number ?? null,
            name: shipment.customer_full_name ?? shipment.recipient_name ?? "-",
            phone: shipment.recipient_phone ?? "",
            total: null,
            tracking: shipment.tracking_number ?? null,
          });
        }
        setHits([...byNumber.values()].slice(0, 8));
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 300);
  }

  async function openHit(hit: SearchHit) {
    setResultsOpen(false);
    onMode("status");
    let order = hit.order;
    if (!order && hit.orderNumber) {
      // Shipment hits only know the order number; resolve the order row once.
      order = ((await api.listOrders({ search: hit.orderNumber, limit: 5 }).catch(() => ({ data: [] }))).data as OrderRow[]).find((row) => row.order_number === hit.orderNumber) ?? null;
    }
    if (!order) return toast.error(t("chat.orderDetailFailed"));
    setDetail(order);
    setQuery("");
    setHits([]);
  }

  const toggleButton = "mb-2 w-full rounded-lg border border-msg-primary bg-msg-primary px-2 py-2 text-[11px] font-semibold text-msg-on-primary transition-colors hover:bg-msg-primary/90 max-lg:min-h-11 max-lg:text-sm";

  return (
    <>
      <div className={sheet ? "pb-3" : undefined}>
        <div className="relative mb-2" ref={searchBox}>
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-msg-subtle" aria-hidden="true" />
          {searching && <Loader2 className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-msg-subtle" aria-hidden="true" />}
          <Input
            unstyled
            type="search"
            value={query}
            onChange={(event) => search(event.target.value)}
            onFocus={() => {
              if (hits.length > 0 || query.trim().length >= 2) setResultsOpen(true);
            }}
            placeholder={t("chat.searchOrdersPh")}
            aria-label={t("chat.searchOrdersPh")}
            className="h-8 w-full rounded-lg border border-msg-border-strong bg-msg-field pr-8 pl-8 text-xs text-msg-fg max-lg:h-11 max-lg:text-base placeholder:text-msg-subtle focus:border-msg-primary focus:ring-1 focus:ring-msg-primary focus:outline-none"
            data-testid="order-search"
          />
          {resultsOpen && (
            <div className="absolute top-full left-0 z-[80] mt-1 w-full rounded-lg border border-msg-border bg-msg-raised shadow-xl" data-testid="order-search-results">
              {searching && hits.length === 0 ? (
                <div className="flex items-center justify-center gap-2 p-3">
                  <Loader2 className="size-3.5 animate-spin text-msg-muted" aria-hidden="true" />
                  <span className="text-xs text-msg-muted">{t("chat.searching")}</span>
                </div>
              ) : hits.length === 0 ? (
                <div className="p-3 text-center text-xs text-msg-subtle">{t("chat.noResults")}</div>
              ) : (
                <div className="max-h-[280px] overflow-auto msg-scrollbar">
                  <div className="border-b border-msg-border px-3 py-1.5">
                    <span className="text-[10px] font-medium text-msg-muted">{t("chat.resultsCount", { count: hits.length })}</span>
                  </div>
                  {hits.map((hit) => (
                    <button type="button" key={hit.key} onClick={() => void openHit(hit)} className="block w-full cursor-pointer border-b border-msg-border/50 px-3 py-2 text-left last:border-b-0 hover:bg-msg-hover-raised/50" data-testid="order-search-hit">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-msg-fg">{hit.name}</span>
                        {hit.orderNumber && <span className="font-mono text-[10px] text-msg-muted">#{hit.orderNumber}</span>}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-msg-subtle">
                        <span>{hit.phone}</span>
                        {hit.total !== null && (
                          <>
                            <span>•</span>
                            <span className="font-semibold text-msg-fg-soft">₺{Number(hit.total).toLocaleString("tr-TR")}</span>
                          </>
                        )}
                        {hit.tracking && (
                          <>
                            <span>•</span>
                            <span className="text-blue-600 dark:text-blue-400">{hit.tracking}</span>
                          </>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {mode === "create" ? (
          <button type="button" onClick={() => onMode("status")} className={toggleButton} data-testid="order-panel-mode">
            {t("chat.openQueryScreen")}
          </button>
        ) : (
          <button type="button" onClick={() => onMode("create")} className={toggleButton} data-testid="order-panel-mode">
            {t("chat.openCreateScreen")}
          </button>
        )}

        {/* The form stays mounted so switching to the status view keeps what was typed. */}
        <div className={mode === "create" ? undefined : "hidden"}>
          <OrderCreateForm conversationId={conversationId} prefill={prefill} products={products} onCreated={onOrderCreated} stickySubmit={sheet} />
        </div>
        {mode === "status" && (
          <div className="mt-2 space-y-2">
            {detail ? (
              <OrderDetail row={detail} onBack={() => setDetail(null)} onCargo={setCargo} />
            ) : (
              <CustomerOrders load={loadCustomerOrders} reloadKey={`${conversationId}:${ordersKey}`} onOpen={setDetail} onCargo={setCargo} />
            )}
          </div>
        )}
      </div>
      <CargoDialog shipmentPublicId={cargo} onClose={() => setCargo(null)} />
    </>
  );
}
