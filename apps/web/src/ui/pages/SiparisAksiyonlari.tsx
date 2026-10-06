import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Phone, Printer, RefreshCw, RotateCcw, Trash2, XCircle } from "lucide-react";
import { BackendRequestError, type BackendHttpClient } from "../../api/http-client.js";
import {
  createOrderActionsClient,
  newIdempotencyKey,
  type OrderActionState,
  type OrderProviderStep,
} from "../../api/order-actions-client.js";
import { useT, type Translator } from "../i18n/index.js";
import { orderActionsMessages } from "../i18n/messages/orderActions.js";

/**
 * Legacy SiparislerPage order detail actions (Durumu Değiştir, iptal/iade, geri al, kalıcı sil, KolayBi KB1,
 * e-Fatura, teyit arama, notlar, yazdır) and the bulk toolbar actions (Toplu teyit ara, Toplu KolayBi aktar).
 * Every provider action is queued through the backend; labels and confirm texts follow the legacy page.
 */

type Bildirim = { tip: "basari" | "hata" | "bilgi"; mesaj: string } | null;

type OrderActionsKey = keyof (typeof orderActionsMessages)["tr"];
type OrderActionsT = Translator<OrderActionsKey>;

const durumEtiketleri: Record<string, OrderActionsKey> = {
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

function durumEtiketi(status: string, t: OrderActionsT) {
  const key = durumEtiketleri[status];
  return key ? t(key) : status;
}

function hataMesaji(error: unknown, fallback: string) {
  if (error instanceof BackendRequestError) {
    const body = error.body as { error?: { message?: string } } | null;
    return body?.error?.message ?? fallback;
  }
  return fallback;
}

/**
 * Legacy teyit badge order: 9'a Bastı → Teyitli → Aranıyor... → Geçersiz Numara → Ulaşılamadı → Bekliyor.
 * `etiket` is an `orderActionsMessages` key, translated at render time.
 */
export function teyitRozeti(order: Pick<OrderActionState, "confirmation_status" | "confirmation_call">): { etiket: OrderActionsKey; sinif: string } {
  const call = order.confirmation_call;
  if (call.pressed_key === "9" || order.confirmation_status === "iptal_istegi") return { etiket: "badgePressed9", sinif: "iptal" };
  if (order.confirmation_status === "teyit_edildi") return { etiket: "badgeConfirmed", sinif: "teyitli" };
  if (call.status === "araniyor") return { etiket: "badgeCalling", sinif: "araniyor" };
  if (order.confirmation_status === "gecersiz_numara" || call.status === "gecersiz_numara") return { etiket: "badgeInvalidNumber", sinif: "gecersiz" };
  if (order.confirmation_status === "ulasilamadi" || ["cevaplanmadi", "ulasilamadi", "mesgul"].includes(call.status ?? "")) {
    return { etiket: "badgeUnreachable", sinif: "ulasilamadi" };
  }
  return { etiket: "badgePending", sinif: "bekliyor" };
}

/** Legacy KolayBi badge: KB İptal Edildi / Aktarıldı / Cari Hazır / Bekliyor (+ Aktarım Başarısız). */
export function kolaybiRozeti(order: Pick<OrderActionState, "status" | "kolaybi">): { etiket: OrderActionsKey; alt: OrderActionsKey | null; sinif: string } {
  const kb = order.kolaybi;
  if (kb.invoice_id && (order.status === "cancelled" || kb.status === "cancelled")) return { etiket: "kbCancelled", alt: "kbInvoiceDeleted", sinif: "iptal" };
  if (kb.invoice_id) return { etiket: "kbTransferred", alt: "kbReadyToSend", sinif: "aktarildi" };
  if (kb.status && ["contact_lookup", "contact_create", "invoice_create"].includes(kb.status)) return { etiket: "kbTransferring", alt: null, sinif: "bekliyor" };
  if (kb.contact_id) return { etiket: "kbContactReady", alt: null, sinif: "cari" };
  return { etiket: "badgePending", alt: null, sinif: "bekliyor" };
}

function adimEtiketi(step: OrderProviderStep, t: OrderActionsT) {
  const durum = t(step.status === "queued" ? "stepQueued" : step.status === "succeeded" ? "stepSucceeded" : "stepFailed");
  return `${step.provider}.${step.operation} #${step.attempt + 1} · ${durum}`;
}

export function SiparisAksiyonlari({
  http,
  orderPublicId,
  onChanged,
}: {
  http: BackendHttpClient;
  orderPublicId: string;
  onChanged?: () => void | Promise<void>;
}) {
  const t = useT(orderActionsMessages);
  // Read through a ref so a language switch does not re-run the load effect (and reset the panel).
  const tRef = useRef(t);
  tRef.current = t;
  const client = useMemo(() => createOrderActionsClient(http), [http]);
  const [order, setOrder] = useState<OrderActionState | null>(null);
  const [steps, setSteps] = useState<OrderProviderStep[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [islem, setIslem] = useState<string | null>(null);
  const [bildirim, setBildirim] = useState<Bildirim>(null);
  const [not, setNot] = useState("");
  const [silindi, setSilindi] = useState(false);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try {
      const response = await client.getActions(orderPublicId);
      setOrder(response.order);
      setSteps(response.steps);
      setNot(response.order.notes ?? "");
    } catch (error) {
      setBildirim({ tip: "hata", mesaj: hataMesaji(error, tRef.current("loadFailed")) });
    } finally {
      setYukleniyor(false);
    }
  }, [client, orderPublicId]);

  useEffect(() => {
    setSilindi(false);
    setBildirim(null);
    void yukle();
  }, [yukle]);

  const calistir = useCallback(
    async (ad: string, fn: () => Promise<string | null>, hataVarsayilan: string) => {
      setIslem(ad);
      try {
        const mesaj = await fn();
        if (mesaj) setBildirim({ tip: "basari", mesaj });
        await yukle();
        await onChanged?.();
      } catch (error) {
        setBildirim({ tip: "hata", mesaj: hataMesaji(error, hataVarsayilan) });
      } finally {
        setIslem(null);
      }
    },
    [onChanged, yukle],
  );

  if (silindi) {
    return (
      <div className="siparis-aksiyon" data-testid="order-actions">
        <div className="siparis-aksiyon-bildirim basari" role="status" data-testid="order-action-message">{t("deletedPermanently")}</div>
      </div>
    );
  }

  if (yukleniyor && !order) {
    return (
      <div className="siparis-aksiyon siparis-aksiyon-yukleniyor" data-testid="order-actions">
        <Loader2 size={16} className="spin" aria-hidden="true" /> {t("loading")}
      </div>
    );
  }

  if (!order) {
    return (
      <div className="siparis-aksiyon" data-testid="order-actions">
        {bildirim && <div className={`siparis-aksiyon-bildirim ${bildirim.tip}`} role="status" data-testid="order-action-message">{bildirim.mesaj}</div>}
      </div>
    );
  }

  const durum = order.status;
  const iptalVeyaIade = durum === "cancelled" || durum === "returned";
  const faturali = Boolean(order.kolaybi.invoice_id);
  const teyit = teyitRozeti(order);
  const kb = kolaybiRozeti(order);
  const mesgul = islem !== null;

  const durumDegistir = (yeniDurum: string) =>
    calistir(`durum-${yeniDurum}`, async () => {
      await client.updateStatus(order.public_id, yeniDurum);
      return t("statusUpdated", { status: durumEtiketi(yeniDurum, t) });
    }, t("statusUpdateFailed"));

  const iptalEt = (status: "cancelled" | "returned") => {
    const metin = faturali
      ? t("confirmCancelInvoiced", { orderNumber: order.order_number })
      : t("confirmCancel", { orderNumber: order.order_number });
    if (status === "cancelled" && !window.confirm(metin)) return;
    void calistir(status, async () => {
      const response = await client.cancel(order.public_id, status, newIdempotencyKey("order_cancel"), status === "returned" ? "Manuel iade" : undefined);
      if (status === "returned") return t("statusUpdated", { status: durumEtiketi("returned", t) });
      return response.e_document_cancel ? t("cancellingInvoice") : t("orderCancelled");
    }, status === "cancelled" ? t("cancelFailed") : t("statusUpdateFailed"));
  };

  const geriAl = () => {
    if (!window.confirm(t("confirmRestore", { orderNumber: order.order_number }))) return;
    void calistir("geri-al", async () => {
      await client.restore(order.public_id);
      return t("restored");
    }, t("restoreFailed"));
  };

  const sil = () => {
    const metin = faturali
      ? t("confirmDeleteInvoiced", { orderNumber: order.order_number })
      : t("confirmDelete", { orderNumber: order.order_number });
    if (!window.confirm(metin)) return;
    setIslem("sil");
    void (async () => {
      try {
        await client.remove(order.public_id, newIdempotencyKey("order_delete"));
        setSilindi(true);
        await onChanged?.();
      } catch (error) {
        setBildirim({ tip: "hata", mesaj: hataMesaji(error, t("deleteFailed")) });
      } finally {
        setIslem(null);
      }
    })();
  };

  const kolaybiAktar = () =>
    calistir("kolaybi", async () => {
      const response = await client.kolaybiTransfer(order.public_id, newIdempotencyKey("order_kolaybi"));
      return response.replayed ? t("kbTransferring") : t("kolaybiQueued");
    }, t("transferFailed"));

  const eFaturaGonder = () =>
    calistir("e-fatura", async () => {
      await client.eDocument(order.public_id, "create", newIdempotencyKey("order_edoc"));
      return t("eDocumentSending");
    }, t("eDocumentFailed"));

  const faturaGoruntule = () =>
    calistir("fatura", async () => {
      const response = await client.invoice(order.public_id, newIdempotencyKey("order_invoice"));
      return t("invoiceId", { id: String(response.invoice_id ?? order.kolaybi.invoice_id) });
    }, t("invoiceLoadFailed"));

  const ara = () =>
    calistir("ara", async () => {
      await client.confirmationCall(order.public_id, newIdempotencyKey("order_call"));
      return t("callStarted", { name: order.customer_full_name ?? "-", phone: order.customer_phone ?? "-" });
    }, t("callFailed"));

  const kontrolEt = () =>
    calistir("kontrol", async () => {
      await client.confirmationStatus(order.public_id, newIdempotencyKey("order_call_status"));
      return t("noResultYet");
    }, t("noResultYet"));

  const durumYenile = () =>
    calistir("senkron", async () => {
      const response = await client.syncProviderSteps(order.public_id);
      return response.advanced_count > 0 ? t("syncUpdated") : null;
    }, t("syncFailed"));

  const manuelTeyit = (value: "teyit_edildi" | "ulasilamadi" | "bekliyor") =>
    calistir(`teyit-${value}`, async () => {
      await client.setConfirmation(order.public_id, value);
      return value === "teyit_edildi" ? t("manualConfirmed", { name: order.customer_full_name ?? order.order_number }) : null;
    }, t("actionFailed"));

  const notKaydet = () =>
    calistir("not", async () => {
      await client.updateNotes(order.public_id, not.trim() ? not : null);
      return t("noteSaved");
    }, t("noteSaveFailed"));

  return (
    <div className="siparis-aksiyon" data-testid="order-actions">
      {bildirim && (
        <div className={`siparis-aksiyon-bildirim ${bildirim.tip}`} role="status" data-testid="order-action-message">
          {bildirim.mesaj}
        </div>
      )}

      <div className="siparis-aksiyon-rozetler">
        <span className={`siparis-rozet teyit-${teyit.sinif}`} data-testid="order-teyit-badge">{t(teyit.etiket)}</span>
        {order.confirmation_call.call_count > 0 && (
          <span className="siparis-rozet-alt" title={t("calledTimes", { count: order.confirmation_call.call_count })}>x{order.confirmation_call.call_count}</span>
        )}
        {order.confirmation_call.listen_seconds ? <span className="siparis-rozet-alt">{t("listenedSeconds", { count: order.confirmation_call.listen_seconds })}</span> : null}
        <span className={`siparis-rozet kb-${kb.sinif}`} data-testid="order-kolaybi-badge">{t(kb.etiket)}</span>
        {kb.alt && <span className="siparis-rozet-alt">{t(kb.alt)}</span>}
        {order.kolaybi.status === "failed" && <span className="siparis-rozet kb-hata" data-testid="order-kolaybi-failed">{t("transferFailedBadge")}</span>}
      </div>

      {faturali && (
        <p className="siparis-aksiyon-bilgi" data-testid="order-kolaybi-info">
          {order.kolaybi.status === "cancelled" || durum === "cancelled"
            ? t("kolaybiInvoiceCancelledInfo", { id: String(order.kolaybi.invoice_id) })
            : t("kolaybiTransferredInfo", { id: String(order.kolaybi.invoice_id) })}
        </p>
      )}
      {order.kolaybi.error && <p className="siparis-aksiyon-hata" data-testid="order-kolaybi-error">{order.kolaybi.error}</p>}

      <section className="siparis-aksiyon-bolum">
        <h4>{t("sectionChangeStatus")}</h4>
        <div className="siparis-aksiyon-butonlar">
          {(durum === "draft" || durum === "created" || durum === "olusturuldu") && (
            <button type="button" className="secondary-action" disabled={mesgul} data-testid="order-status-confirmed" onClick={() => void durumDegistir("confirmed")}>{t("statusConfirmed")}</button>
          )}
          {["draft", "created", "olusturuldu", "confirmed"].includes(durum) && (
            <button type="button" className="secondary-action" disabled={mesgul} data-testid="order-status-preparing" onClick={() => void durumDegistir("preparing")}>{t("statusPreparing")}</button>
          )}
          {(durum === "preparing" || durum === "shipped") && (
            <button type="button" className="secondary-action" disabled={mesgul} data-testid="order-status-delivered" onClick={() => void durumDegistir("delivered")}>{t("statusDelivered")}</button>
          )}
          {!iptalVeyaIade && durum !== "delivered" && (
            <button type="button" className="secondary-action danger" disabled={mesgul} data-testid="order-cancel" title={t("cancelTitle")} onClick={() => iptalEt("cancelled")}>
              <XCircle size={14} aria-hidden="true" /> {t("cancelButton")}
            </button>
          )}
          {!iptalVeyaIade && (
            <button type="button" className="secondary-action" disabled={mesgul} data-testid="order-return" onClick={() => iptalEt("returned")}>{t("returnButton")}</button>
          )}
          {iptalVeyaIade && (
            <button type="button" className="secondary-action" disabled={mesgul} data-testid="order-restore" title={t("restoreTitle")} onClick={geriAl}>
              <RotateCcw size={14} aria-hidden="true" /> {t("restoreButton")}
            </button>
          )}
          <button type="button" className="secondary-action danger" disabled={mesgul} data-testid="order-delete" title={t("deletePermanently")} onClick={sil}>
            <Trash2 size={14} aria-hidden="true" /> {t("deletePermanently")}
          </button>
        </div>
      </section>

      <section className="siparis-aksiyon-bolum">
        <h4>KolayBi</h4>
        <div className="siparis-aksiyon-butonlar">
          <button
            type="button"
            className="primary-action"
            disabled={mesgul || faturali}
            data-testid="order-kolaybi-transfer"
            title={order.kolaybi.status === "failed" ? t("kolaybiRetryTitle") : t("kolaybiTitle")}
            onClick={() => void kolaybiAktar()}
          >
            {islem === "kolaybi" ? t("kbTransferring") : t("kolaybiButton")}
          </button>
          <button type="button" className="secondary-action" disabled={mesgul} data-testid="order-invoice-view" onClick={() => void faturaGoruntule()}>{t("viewInvoice")}</button>
          <button type="button" className="secondary-action" disabled={mesgul} data-testid="order-e-document-send" onClick={() => void eFaturaGonder()}>{t("sendEDocument")}</button>
          <button type="button" className="secondary-action icon-action" disabled={mesgul} data-testid="order-provider-sync" onClick={() => void durumYenile()}>
            <RefreshCw size={14} aria-hidden="true" /> <span>{t("refreshStatus")}</span>
          </button>
        </div>
        {order.kolaybi.e_document_status && (
          <p className="siparis-aksiyon-bilgi" data-testid="order-e-document-status">{t("eDocumentStatus", { status: order.kolaybi.e_document_status })}</p>
        )}
      </section>

      <section className="siparis-aksiyon-bolum">
        <h4>{t("sectionConfirmation")}</h4>
        <div className="siparis-aksiyon-butonlar">
          <button type="button" className="secondary-action icon-action" disabled={mesgul} data-testid="order-confirmation-call" onClick={() => void ara()}>
            <Phone size={14} aria-hidden="true" /> <span>{t("call")}</span>
          </button>
          <button type="button" className="secondary-action" disabled={mesgul || !order.confirmation_call.bulk_id} data-testid="order-confirmation-check" title={t("checkTitle")} onClick={() => void kontrolEt()}>{t("check")}</button>
          <button type="button" className="secondary-action" disabled={mesgul} data-testid="order-manual-confirm" title={t("manualConfirmTitle")} onClick={() => void manuelTeyit("teyit_edildi")}>{t("statusConfirmed")}</button>
          <button type="button" className="secondary-action" disabled={mesgul} data-testid="order-manual-unreachable" onClick={() => void manuelTeyit("ulasilamadi")}>{t("badgeUnreachable")}</button>
          <button type="button" className="secondary-action" disabled={mesgul} data-testid="order-manual-pending" onClick={() => void manuelTeyit("bekliyor")}>{t("badgePending")}</button>
        </div>
      </section>

      <section className="siparis-aksiyon-bolum">
        <h4>{t("sectionNote")}</h4>
        <textarea className="siparis-aksiyon-not" data-testid="order-notes-input" rows={3} value={not} onChange={(event) => setNot(event.target.value)} />
        <div className="siparis-aksiyon-butonlar">
          <button type="button" className="secondary-action" disabled={mesgul} data-testid="order-notes-save" onClick={() => void notKaydet()}>{t("save")}</button>
          <button type="button" className="secondary-action icon-action" data-testid="order-print" onClick={() => window.print()}>
            <Printer size={14} aria-hidden="true" /> <span>{t("print")}</span>
          </button>
        </div>
      </section>

      {steps.length > 0 && (
        <ul className="siparis-aksiyon-adimlar" data-testid="order-provider-steps">
          {steps.map((step) => (
            <li key={step.public_id} className={`adim-${step.status}`}>
              {adimEtiketi(step, t)}
              {step.error_message ? ` · ${step.error_message}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SiparisTopluAksiyonlar({
  http,
  selectedIds,
  onDone,
}: {
  http: BackendHttpClient;
  selectedIds: string[];
  onDone?: () => void | Promise<void>;
}) {
  const t = useT(orderActionsMessages);
  const client = useMemo(() => createOrderActionsClient(http), [http]);
  const [calisan, setCalisan] = useState<"teyit" | "kolaybi" | null>(null);
  const [mesaj, setMesaj] = useState<string | null>(null);

  const topluTeyit = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(t("bulkConfirmPrompt", { count: selectedIds.length }))) return;
    setCalisan("teyit");
    try {
      const response = await client.bulkConfirmationCalls(selectedIds, newIdempotencyKey("bulk_teyit"));
      if (response.queued_count === 0) {
        setMesaj(t("bulkNoUnconfirmed"));
      } else {
        const hatali = response.results.filter((row) => !row.queued).length;
        setMesaj(t("bulkConfirmResult", { succeeded: response.queued_count, failed: hatali }));
      }
      await onDone?.();
    } catch (error) {
      setMesaj(hataMesaji(error, t("actionFailed")));
    } finally {
      setCalisan(null);
    }
  };

  const topluKolaybi = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(t("bulkKolaybiPrompt", { count: selectedIds.length }))) return;
    setCalisan("kolaybi");
    try {
      const response = await client.bulkKolaybiTransfer(selectedIds, newIdempotencyKey("bulk_kolaybi"));
      if (response.queued_count === 0) {
        setMesaj(t("bulkNothingToTransfer"));
      } else {
        const hatali = response.results.filter((row) => !row.queued).length;
        setMesaj(t("bulkKolaybiResult", { succeeded: response.queued_count, failed: hatali }));
      }
      await onDone?.();
    } catch (error) {
      setMesaj(hataMesaji(error, t("actionFailed")));
    } finally {
      setCalisan(null);
    }
  };

  return (
    <>
      <button className="secondary-action" data-testid="orders-bulk-confirmation" disabled={selectedIds.length === 0 || calisan !== null} type="button" onClick={() => void topluTeyit()}>
        {t("bulkConfirmButton")}
      </button>
      <button className="secondary-action" data-testid="orders-bulk-kolaybi" disabled={selectedIds.length === 0 || calisan !== null} type="button" onClick={() => void topluKolaybi()}>
        {t("bulkKolaybiButton")}
      </button>
      {mesaj && (
        <span className="siparis-toplu-mesaj" role="status" data-testid="orders-bulk-message">{mesaj}</span>
      )}
    </>
  );
}
