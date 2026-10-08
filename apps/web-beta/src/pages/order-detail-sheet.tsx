import type { ShipmentSummary } from "@garanti-kulucka/shared";
import { Loader2, MapPin, Pencil, Phone, RefreshCw, RotateCcw, Trash2, Truck, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { carrierLabel, formatDateTime, formatMoney } from "@/lib/format";
import { confirmationBadge, kolaybiBadge, type CargoProviderKey, type OrderActionDetail, type OrderProviderStep, type OrderRow, type ShipmentDraft, type ShipmentPaymentStatus } from "@/lib/orders";
import { errorText, FeedbackLine, Field, idempotencyKey, NativeSelect, type Feedback } from "./accounting-shared";
import { OrderEditForm } from "./order-edit-form";

const statusKeys: Record<string, "statusCreated" | "statusPendingConfirmation" | "statusConfirmed" | "statusPreparing" | "statusShipped" | "statusDelivered" | "statusCancelled" | "statusReturned"> = {
  draft: "statusCreated",
  created: "statusCreated",
  olusturuldu: "statusCreated",
  pending_confirmation: "statusPendingConfirmation",
  confirmed: "statusConfirmed",
  preparing: "statusPreparing",
  shipped: "statusShipped",
  delivered: "statusDelivered",
  cancelled: "statusCancelled",
  returned: "statusReturned",
};


function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t pt-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Legacy SiparislerPage order detail: Durumu Değiştir, iptal/iade, geri al, kalıcı sil, KolayBi KB1 + e-Fatura,
 * teyit arama, notlar and the KargolarPage "Sürat'e Aktar / PTT'ye Aktar" barkod modal. Every provider call is queued.
 */
export function OrderDetailSheet({ publicId, row, onClose, onChanged }: { publicId: string | null; row?: OrderRow | null; onClose: () => void; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const statusLabel = (status: string) => {
    const key = statusKeys[status];
    return key ? t(`orderActions.${key}`) : status;
  };
  const [order, setOrder] = useState<OrderActionDetail | null>(null);
  const [steps, setSteps] = useState<OrderProviderStep[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [deleted, setDeleted] = useState(false);
  const [cargo, setCargo] = useState<CargoProviderKey | null>(null);
  const [editing, setEditing] = useState(false);
  const [tracking, setTracking] = useState(false);
  const tRef = useRef(t);
  tRef.current = t;

  const load = useCallback(async (id: string) => {
    try {
      const response = await api.getOrderActionDetail(id);
      setOrder(response.order);
      setSteps(response.steps);
      setNote(response.order.notes ?? "");
    } catch (error) {
      setFeedback({ tone: "error", text: errorText(error) || tRef.current("orderActions.loadFailed") });
    }
  }, [api]);

  useEffect(() => {
    setOrder(null);
    setSteps([]);
    setFeedback(null);
    setDeleted(false);
    setCargo(null);
    setEditing(false);
    setTracking(false);
    if (publicId) void load(publicId);
  }, [publicId, load]);

  async function run(name: string, action: () => Promise<string | null>, fallback: string) {
    if (!order) return;
    setBusy(name);
    setFeedback(null);
    try {
      const text = await action();
      if (text) setFeedback({ tone: "success", text });
      await load(order.public_id);
      onChanged();
    } catch (error) {
      setFeedback({ tone: "error", text: errorText(error) || fallback });
    } finally {
      setBusy(null);
    }
  }

  const invoiced = Boolean(order?.kolaybi.invoice_id);
  const closed = order ? order.status === "cancelled" || order.status === "returned" : false;
  const disabled = busy !== null;

  function changeStatus(status: string) {
    void run(`status-${status}`, async () => {
      await api.updateOrderStatus(order!.public_id, status);
      return t("orderActions.statusUpdated", { status: statusLabel(status) });
    }, t("orderActions.statusUpdateFailed"));
  }

  function cancel(status: "cancelled" | "returned") {
    if (!order) return;
    if (status === "cancelled" && !window.confirm(t(invoiced ? "orderActions.confirmCancelInvoiced" : "orderActions.confirmCancel", { orderNumber: order.order_number }))) return;
    void run(status, async () => {
      const response = await api.cancelOrder(order.public_id, status, idempotencyKey("order_cancel"), status === "returned" ? "Manuel iade" : undefined);
      if (status === "returned") return t("orderActions.statusUpdated", { status: statusLabel("returned") });
      return response.e_document_cancel ? t("orderActions.cancellingInvoice") : t("orderActions.orderCancelled");
    }, t(status === "cancelled" ? "orderActions.cancelFailed" : "orderActions.statusUpdateFailed"));
  }

  function restore() {
    if (!order || !window.confirm(t("orderActions.confirmRestore", { orderNumber: order.order_number }))) return;
    void run("restore", async () => {
      await api.restoreOrder(order.public_id);
      return t("orderActions.restored");
    }, t("orderActions.restoreFailed"));
  }

  async function remove() {
    if (!order || !window.confirm(t(invoiced ? "orderActions.confirmDeleteInvoiced" : "orderActions.confirmDelete", { orderNumber: order.order_number }))) return;
    setBusy("delete");
    try {
      await api.deleteOrder(order.public_id, idempotencyKey("order_delete"));
      setDeleted(true);
      onChanged();
    } catch (error) {
      setFeedback({ tone: "error", text: errorText(error) || t("orderActions.deleteFailed") });
    } finally {
      setBusy(null);
    }
  }

  const confirmation = order ? confirmationBadge(order) : null;
  const kb = order ? kolaybiBadge(order) : null;

  return (
    <Sheet open={publicId !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" closeLabel={t("cargoCreate.close")} className="w-[min(34rem,100vw)] overflow-y-auto p-0" data-testid="order-detail">
        <SheetHeader className="border-b p-4 pr-14">
          <SheetTitle>{order ? order.order_number : t("orders.detail")}</SheetTitle>
          <SheetDescription>
            {order ? `${order.customer_full_name ?? "-"} · ${order.customer_phone ?? "-"} · ${formatMoney(order.total_amount, order.currency, i18n.language)}` : t("orderActions.loading")}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 p-4 text-sm">
          <FeedbackLine feedback={feedback} testId="order-action-message" />
          {deleted ? (
            <p className="text-emerald-700 dark:text-emerald-300" data-testid="order-deleted">
              {t("orderActions.deletedPermanently")}
            </p>
          ) : !order ? (
            !feedback && <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t("orderActions.loading")} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5" data-testid="order-badges">
                <Badge tone="outline">{statusLabel(order.status)}</Badge>
                {confirmation && (
                  <Badge tone={confirmation.tone} data-testid="order-teyit-badge">
                    {t(`orderActions.${confirmation.key}` as const)}
                  </Badge>
                )}
                {order.confirmation_call.call_count > 0 && <span className="text-xs text-muted-foreground">x{order.confirmation_call.call_count}</span>}
                {kb && (
                  <Badge tone={kb.tone} data-testid="order-kolaybi-badge">
                    {t(`orderActions.${kb.key}` as const)}
                  </Badge>
                )}
                {kb?.sub && <span className="text-xs text-muted-foreground">{t(`orderActions.${kb.sub}` as const)}</span>}
                {order.kolaybi.status === "failed" && <Badge tone="danger">{t("orderActions.transferFailedBadge")}</Badge>}
              </div>
              {order.kolaybi.error && <p className="text-destructive">{order.kolaybi.error}</p>}
              {editing ? (
                <OrderEditForm
                  publicId={order.public_id}
                  onCancel={() => setEditing(false)}
                  onSaved={() => {
                    setEditing(false);
                    setFeedback({ tone: "success", text: t("orderEdit.saved") });
                    void load(order.public_id);
                    onChanged();
                  }}
                />
              ) : (
                <>
              <Button variant="outline" className="min-h-11 self-start" disabled={disabled} onClick={() => setEditing(true)} data-testid="order-edit-open">
                <Pencil className="size-4" aria-hidden="true" />
                {t("orderEdit.open")}
              </Button>

              <Section title={t("orderActions.sectionChangeStatus")}>
                <div className="flex flex-wrap gap-2">
                  {["draft", "created", "olusturuldu"].includes(order.status) && (
                    <Button variant="outline" className="min-h-11" disabled={disabled} onClick={() => changeStatus("confirmed")} data-testid="order-status-confirmed">
                      {t("orderActions.statusConfirmed")}
                    </Button>
                  )}
                  {["draft", "created", "olusturuldu", "confirmed"].includes(order.status) && (
                    <Button variant="outline" className="min-h-11" disabled={disabled} onClick={() => changeStatus("preparing")} data-testid="order-status-preparing">
                      {t("orderActions.statusPreparing")}
                    </Button>
                  )}
                  {["preparing", "shipped"].includes(order.status) && (
                    <Button variant="outline" className="min-h-11" disabled={disabled} onClick={() => changeStatus("delivered")} data-testid="order-status-delivered">
                      {t("orderActions.statusDelivered")}
                    </Button>
                  )}
                  {!closed && order.status !== "delivered" && (
                    <Button variant="outline" className="min-h-11 text-destructive" disabled={disabled} onClick={() => cancel("cancelled")} data-testid="order-cancel">
                      <XCircle className="size-4" aria-hidden="true" />
                      {t("orderActions.cancelButton")}
                    </Button>
                  )}
                  {!closed && (
                    <Button variant="outline" className="min-h-11" disabled={disabled} onClick={() => cancel("returned")} data-testid="order-return">
                      {t("orderActions.returnButton")}
                    </Button>
                  )}
                  {closed && (
                    <Button variant="outline" className="min-h-11" disabled={disabled} onClick={restore} data-testid="order-restore">
                      <RotateCcw className="size-4" aria-hidden="true" />
                      {t("orderActions.restoreButton")}
                    </Button>
                  )}
                  <Button variant="outline" className="min-h-11 text-destructive" disabled={disabled} onClick={() => void remove()} data-testid="order-delete">
                    <Trash2 className="size-4" aria-hidden="true" />
                    {t("orderActions.deletePermanently")}
                  </Button>
                </div>
              </Section>

              <Section title={t("orders.cargoActions")}>
                {row?.shipment && (
                  <div className="flex flex-wrap items-center gap-2" data-testid="order-shipment-summary">
                    <Badge tone="info">
                      {[carrierLabel(row.shipment.provider, t("shipments.otherProvider")), row.shipment.status].filter(Boolean).join(" · ")}
                    </Badge>
                    {row.shipment.tracking_number && <span className="text-muted-foreground">{t("orders.trackingNumber", { number: row.shipment.tracking_number })}</span>}
                    <Button variant="outline" className="min-h-11 md:min-h-9" onClick={() => setTracking(true)} data-testid="order-tracking-open">
                      <Truck className="size-4" aria-hidden="true" />
                      {t("orders.tracking")}
                    </Button>
                    <TrackingSheet shipmentId={row.shipment.public_id} open={tracking} onClose={() => setTracking(false)} />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {(["surat", "ptt"] as const).map((provider) => (
                    <Button
                      key={provider}
                      variant={cargo === provider ? "default" : "outline"}
                      className="min-h-11"
                      disabled={closed}
                      onClick={() => setCargo(cargo === provider ? null : provider)}
                      data-testid={`order-cargo-${provider}`}
                    >
                      <Truck className="size-4" aria-hidden="true" />
                      {t(provider === "surat" ? "cargoCreate.transferToSurat" : "cargoCreate.transferToPtt")}
                    </Button>
                  ))}
                </div>
                {cargo && (
                  <CargoTransfer
                    orderPublicId={order.public_id}
                    provider={cargo}
                    onDone={(text) => {
                      setCargo(null);
                      setFeedback({ tone: "success", text });
                      void load(order.public_id);
                      onChanged();
                    }}
                    onError={(text) => setFeedback({ tone: "error", text })}
                  />
                )}
              </Section>

              <Section title="KolayBi">
                <div className="flex flex-wrap gap-2">
                  <Button
                    className="min-h-11"
                    disabled={disabled || invoiced}
                    title={t(order.kolaybi.status === "failed" ? "orderActions.kolaybiRetryTitle" : "orderActions.kolaybiTitle")}
                    onClick={() =>
                      void run("kolaybi", async () => {
                        const response = await api.orderKolaybiTransfer(order.public_id, idempotencyKey("order_kolaybi"));
                        return response.replayed ? t("orderActions.kbTransferring") : t("orderActions.kolaybiQueued");
                      }, t("orderActions.transferFailed"))
                    }
                    data-testid="order-kolaybi-transfer"
                  >
                    {busy === "kolaybi" ? t("orderActions.kbTransferring") : t("orderActions.kolaybiButton")}
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={disabled}
                    onClick={() =>
                      void run("invoice", async () => {
                        const response = await api.orderInvoice(order.public_id, idempotencyKey("order_invoice"));
                        return t("orderActions.invoiceId", { id: String(response.invoice_id ?? order.kolaybi.invoice_id) });
                      }, t("orderActions.invoiceLoadFailed"))
                    }
                    data-testid="order-invoice-view"
                  >
                    {t("orderActions.viewInvoice")}
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={disabled}
                    onClick={() =>
                      void run("edoc", async () => {
                        await api.orderEDocument(order.public_id, idempotencyKey("order_edoc"));
                        return t("orderActions.eDocumentSending");
                      }, t("orderActions.eDocumentFailed"))
                    }
                    data-testid="order-e-document-send"
                  >
                    {t("orderActions.sendEDocument")}
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={disabled}
                    onClick={() =>
                      void run("sync", async () => {
                        const response = await api.syncOrderProviderSteps(order.public_id);
                        return response.advanced_count > 0 ? t("orderActions.syncUpdated") : null;
                      }, t("orderActions.syncFailed"))
                    }
                    data-testid="order-provider-sync"
                  >
                    <RefreshCw className="size-4" aria-hidden="true" />
                    {t("orderActions.refreshStatus")}
                  </Button>
                </div>
                {order.kolaybi.e_document_status && <p className="text-muted-foreground">{t("orderActions.eDocumentStatus", { status: order.kolaybi.e_document_status })}</p>}
              </Section>

              <Section title={t("orderActions.sectionConfirmation")}>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={disabled}
                    onClick={() =>
                      void run("call", async () => {
                        await api.orderConfirmationCall(order.public_id, idempotencyKey("order_call"));
                        return t("orderActions.callStarted", { name: order.customer_full_name ?? "-", phone: order.customer_phone ?? "-" });
                      }, t("orderActions.callFailed"))
                    }
                    data-testid="order-confirmation-call"
                  >
                    <Phone className="size-4" aria-hidden="true" />
                    {t("orderActions.call")}
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={disabled || !order.confirmation_call.bulk_id}
                    title={t("orderActions.checkTitle")}
                    onClick={() =>
                      void run("check", async () => {
                        await api.orderConfirmationStatus(order.public_id, idempotencyKey("order_call_status"));
                        return t("orderActions.noResultYet");
                      }, t("orderActions.noResultYet"))
                    }
                    data-testid="order-confirmation-check"
                  >
                    {t("orderActions.check")}
                  </Button>
                  {(
                    [
                      ["teyit_edildi", "statusConfirmed", "order-manual-confirm"],
                      ["ulasilamadi", "badgeUnreachable", "order-manual-unreachable"],
                      ["bekliyor", "badgePending", "order-manual-pending"],
                    ] as const
                  ).map(([value, label, testId]) => (
                    <Button
                      key={value}
                      variant="outline"
                      className="min-h-11"
                      disabled={disabled}
                      onClick={() =>
                        void run(`confirm-${value}`, async () => {
                          await api.setOrderConfirmation(order.public_id, value);
                          return value === "teyit_edildi" ? t("orderActions.manualConfirmed", { name: order.customer_full_name ?? order.order_number }) : null;
                        }, t("orderActions.actionFailed"))
                      }
                      data-testid={testId}
                    >
                      {t(`orderActions.${label}`)}
                    </Button>
                  ))}
                </div>
              </Section>

              <Section title={t("orderActions.sectionNote")}>
                <textarea
                  className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
                  rows={3}
                  aria-label={t("orderActions.sectionNote")}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  data-testid="order-notes-input"
                />
                <Button
                  variant="outline"
                  className="min-h-11 self-start"
                  disabled={disabled}
                  onClick={() =>
                    void run("note", async () => {
                      await api.updateOrderNotes(order.public_id, note.trim() ? note : null);
                      return t("orderActions.noteSaved");
                    }, t("orderActions.noteSaveFailed"))
                  }
                  data-testid="order-notes-save"
                >
                  {t("orderActions.save")}
                </Button>
              </Section>

              {steps.length > 0 && (
                <ul className="flex flex-col gap-1 border-t pt-3 text-xs text-muted-foreground" data-testid="order-provider-steps">
                  {steps.map((step) => (
                    <li key={step.public_id}>
                      {step.provider}.{step.operation} #{step.attempt + 1} · {t(step.status === "queued" ? "orderActions.stepQueued" : step.status === "succeeded" ? "orderActions.stepSucceeded" : "orderActions.stepFailed")}
                      {step.error_message ? ` · ${step.error_message}` : ""}
                    </li>
                  ))}
                </ul>
              )}
                </>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Legacy KargoTakipModal: tracking events of the order's latest shipment with a "Yenile" (POST /track) button. */
function TrackingSheet({ shipmentId, open, onClose }: { shipmentId: string; open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [shipment, setShipment] = useState<ShipmentSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setShipment(null);
    setError(null);
    setNotice(null);
    api
      .getShipment(shipmentId)
      .then((next) => active && setShipment(next))
      .catch((reason: unknown) => active && setError(errorText(reason)));
    return () => {
      active = false;
    };
  }, [api, shipmentId, open]);

  async function refresh() {
    setBusy(true);
    setNotice(null);
    try {
      await api.trackShipment(shipmentId, idempotencyKey(`takip_${shipmentId}`));
      setNotice(t("orders.trackingRefreshQueued"));
      setShipment(await api.getShipment(shipmentId));
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  const events = shipment?.tracking_events ?? [];
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" closeLabel={t("orders.close")} className="w-[min(30rem,100vw)] overflow-y-auto p-0" data-testid="order-tracking-modal">
        <SheetHeader className="border-b p-4 pr-14">
          <SheetTitle>{t("orders.trackingTitle")}</SheetTitle>
          <SheetDescription>
            {shipment ? `${carrierLabel(shipment.provider, t("shipments.otherProvider"))} · ${shipment.tracking_number ?? "-"} · ${shipment.status}` : t("orderActions.loading")}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="min-h-11 md:min-h-9" disabled={busy} onClick={() => void refresh()} data-testid="order-tracking-refresh">
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
              {t("orders.trackingRefresh")}
            </Button>
            {notice && <span className="text-muted-foreground" data-testid="order-tracking-notice">{notice}</span>}
          </div>
          {error ? (
            <p className="text-destructive">{error || t("orders.trackingFailed")}</p>
          ) : !shipment ? (
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t("orderActions.loading")} />
          ) : events.length === 0 ? (
            <p className="text-muted-foreground" data-testid="order-tracking-empty">{t("orders.trackingNoEvents")}</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {events.map((event) => (
                <li key={event.public_id} className="flex flex-col gap-0.5 rounded-md border-l-2 border-primary bg-muted/40 px-3 py-2" data-testid="order-tracking-event">
                  <time className="text-xs text-muted-foreground" dateTime={event.occurred_at}>{formatDateTime(event.occurred_at, i18n.language)}</time>
                  <span className="font-medium">{event.status}</span>
                  {event.description && <span>{event.description}</span>}
                  {event.location && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3" aria-hidden="true" />
                      {event.location}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Legacy kargo onay modal: shipment draft, missing address fields, Ödeme Durumu, "Barkod Oluştur". */
function CargoTransfer({ orderPublicId, provider, onDone, onError }: { orderPublicId: string; provider: CargoProviderKey; onDone: (message: string) => void; onError: (message: string) => void }) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [draft, setDraft] = useState<ShipmentDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payment, setPayment] = useState<ShipmentPaymentStatus>("karsi_odemeli");
  const [address, setAddress] = useState({ address: "", city: "", district: "" });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    setDraft(null);
    setLoadError(null);
    api
      .getShipmentDraft(orderPublicId)
      .then((next) => {
        if (!active) return;
        setDraft(next);
        setAddress({ address: next.recipient.address ?? "", city: next.recipient.city ?? "", district: next.recipient.district ?? "" });
      })
      .catch((error: unknown) => active && setLoadError(errorText(error)));
    return () => {
      active = false;
    };
  }, [api, orderPublicId]);

  async function create() {
    if (!draft) return;
    setCreating(true);
    try {
      const changed = (value: string, original: string | null) => (value.trim() && value.trim() !== (original ?? "") ? value.trim() : undefined);
      const recipientAddress = changed(address.address, draft.recipient.address);
      const recipientCity = changed(address.city, draft.recipient.city);
      const recipientDistrict = changed(address.district, draft.recipient.district);
      const result = await api.createShipment(draft.order_public_id, {
        provider,
        payment_status: payment,
        idempotency_key: idempotencyKey(`kargo_${provider}_${draft.order_public_id}`),
        ...(recipientAddress ? { recipient_address: recipientAddress } : {}),
        ...(recipientCity ? { recipient_city: recipientCity } : {}),
        ...(recipientDistrict ? { recipient_district: recipientDistrict } : {}),
      });
      onDone(result.message);
    } catch (error) {
      onError(t("cargoCreate.createError", { error: errorText(error) }));
    } finally {
      setCreating(false);
    }
  }

  const name = provider === "surat" ? "Sürat" : "PTT";
  if (loadError) return <p className="text-destructive">{loadError}</p>;
  if (!draft) return <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t("cargoCreate.loading")} />;
  const missing = !draft.recipient.city || !draft.recipient.district || !draft.recipient.address;

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3" data-testid="order-cargo-transfer">
      <p className="font-medium">{t("cargoCreate.barcodeTitle", { provider: name })}</p>
      <p className="text-muted-foreground">
        {draft.recipient.name ?? "-"} · {draft.items.map((item) => `${item.quantity} ${item.name}`).join(", ")} · {formatMoney(draft.total_amount, draft.currency, i18n.language)}
      </p>
      {draft.existing_shipment && (
        <p className="text-destructive" data-testid="order-cargo-existing">
          {t("cargoCreate.existingShipment")} {t("cargoCreate.tracking", { number: String(draft.existing_shipment.tracking_number ?? draft.existing_shipment.barcode_number ?? "-") })}
        </p>
      )}
      {missing && (
        <div className="flex flex-col gap-2" data-testid="order-cargo-missing-address">
          <p className="text-amber-700 dark:text-amber-300">{t("cargoCreate.completeMissingAddress")}</p>
          {!draft.recipient.address && (
            <Input className="h-11 md:h-9" placeholder={t("cargoCreate.addressPlaceholder")} value={address.address} onChange={(event) => setAddress((prev) => ({ ...prev, address: event.target.value }))} data-testid="order-cargo-address" />
          )}
          <div className="grid grid-cols-2 gap-2">
            {!draft.recipient.city && (
              <Input className="h-11 md:h-9" placeholder={t("cargoCreate.cityPlaceholder")} value={address.city} onChange={(event) => setAddress((prev) => ({ ...prev, city: event.target.value, district: "" }))} data-testid="order-cargo-city" />
            )}
            {!draft.recipient.district && (
              <Input
                className="h-11 md:h-9"
                disabled={!address.city && !draft.recipient.city}
                placeholder={!(address.city || draft.recipient.city) ? t("cargoCreate.selectCityFirst") : t("cargoCreate.districtPlaceholder")}
                value={address.district}
                onChange={(event) => setAddress((prev) => ({ ...prev, district: event.target.value }))}
                data-testid="order-cargo-district"
              />
            )}
          </div>
        </div>
      )}
      <Field label={t("cargoCreate.paymentStatus")}>
        <NativeSelect value={payment} onChange={(event) => setPayment(event.target.value as ShipmentPaymentStatus)} data-testid="order-cargo-payment">
          <option value="karsi_odemeli">{t("cargoCreate.paymentCashOnDelivery")}</option>
          <option value="odeme_alindi">{t("cargoCreate.paymentReceived")}</option>
        </NativeSelect>
      </Field>
      <Button className="min-h-11" disabled={creating || Boolean(draft.existing_shipment)} onClick={() => void create()} data-testid="order-cargo-create">
        {creating ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Truck className="size-4" aria-hidden="true" />}
        {creating ? t("cargoCreate.creating") : t("cargoCreate.createBarcode")}
      </Button>
    </div>
  );
}
