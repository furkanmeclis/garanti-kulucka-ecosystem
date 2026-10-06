import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Phone, Printer, RefreshCw, RotateCcw, Trash2, XCircle } from "lucide-react";
import { BackendRequestError, type BackendHttpClient } from "../../api/http-client.js";
import {
  createOrderActionsClient,
  newIdempotencyKey,
  type OrderActionState,
  type OrderProviderStep,
} from "../../api/order-actions-client.js";

/**
 * Legacy SiparislerPage order detail actions (Durumu Değiştir, iptal/iade, geri al, kalıcı sil, KolayBi KB1,
 * e-Fatura, teyit arama, notlar, yazdır) and the bulk toolbar actions (Toplu teyit ara, Toplu KolayBi aktar).
 * Every provider action is queued through the backend; labels and confirm texts follow the legacy page.
 */

type Bildirim = { tip: "basari" | "hata" | "bilgi"; mesaj: string } | null;

const durumEtiketleri: Record<string, string> = {
  draft: "Oluşturuldu",
  created: "Oluşturuldu",
  olusturuldu: "Oluşturuldu",
  pending_confirmation: "Teyit Bekliyor",
  confirmed: "Teyit Edildi",
  preparing: "Hazırlanıyor",
  shipped: "Yoldaki Kargolar",
  delivered: "Teslim Edildi",
  cancelled: "İptal",
  returned: "İade",
};

function durumEtiketi(status: string) {
  return durumEtiketleri[status] ?? status;
}

function hataMesaji(error: unknown, fallback: string) {
  if (error instanceof BackendRequestError) {
    const body = error.body as { error?: { message?: string } } | null;
    return body?.error?.message ?? fallback;
  }
  return fallback;
}

/** Legacy teyit badge order: 9'a Bastı → Teyitli → Aranıyor... → Geçersiz Numara → Ulaşılamadı → Bekliyor. */
export function teyitRozeti(order: Pick<OrderActionState, "confirmation_status" | "confirmation_call">) {
  const call = order.confirmation_call;
  if (call.pressed_key === "9" || order.confirmation_status === "iptal_istegi") return { etiket: "9'a Bastı", sinif: "iptal" };
  if (order.confirmation_status === "teyit_edildi") return { etiket: "Teyitli", sinif: "teyitli" };
  if (call.status === "araniyor") return { etiket: "Aranıyor...", sinif: "araniyor" };
  if (order.confirmation_status === "gecersiz_numara" || call.status === "gecersiz_numara") return { etiket: "Geçersiz Numara", sinif: "gecersiz" };
  if (order.confirmation_status === "ulasilamadi" || ["cevaplanmadi", "ulasilamadi", "mesgul"].includes(call.status ?? "")) {
    return { etiket: "Ulaşılamadı", sinif: "ulasilamadi" };
  }
  return { etiket: "Bekliyor", sinif: "bekliyor" };
}

/** Legacy KolayBi badge: KB İptal Edildi / Aktarıldı / Cari Hazır / Bekliyor (+ Aktarım Başarısız). */
export function kolaybiRozeti(order: Pick<OrderActionState, "status" | "kolaybi">) {
  const kb = order.kolaybi;
  if (kb.invoice_id && (order.status === "cancelled" || kb.status === "cancelled")) return { etiket: "KB İptal Edildi", alt: "Fatura silindi", sinif: "iptal" };
  if (kb.invoice_id) return { etiket: "Aktarıldı", alt: "Gönderime Hazır", sinif: "aktarildi" };
  if (kb.status && ["contact_lookup", "contact_create", "invoice_create"].includes(kb.status)) return { etiket: "Aktarılıyor...", alt: null, sinif: "bekliyor" };
  if (kb.contact_id) return { etiket: "Cari Hazır", alt: null, sinif: "cari" };
  return { etiket: "Bekliyor", alt: null, sinif: "bekliyor" };
}

function adimEtiketi(step: OrderProviderStep) {
  const durum = step.status === "queued" ? "kuyrukta" : step.status === "succeeded" ? "tamamlandı" : "başarısız";
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
      setBildirim({ tip: "hata", mesaj: hataMesaji(error, "Sipariş yüklenemedi") });
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
        <div className="siparis-aksiyon-bildirim basari" role="status" data-testid="order-action-message">Sipariş kalıcı olarak silindi</div>
      </div>
    );
  }

  if (yukleniyor && !order) {
    return (
      <div className="siparis-aksiyon siparis-aksiyon-yukleniyor" data-testid="order-actions">
        <Loader2 size={16} className="spin" aria-hidden="true" /> Yükleniyor...
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
      return `Sipariş durumu güncellendi: ${durumEtiketi(yeniDurum)}`;
    }, "Durum güncellenirken hata oluştu");

  const iptalEt = (status: "cancelled" | "returned") => {
    const metin = faturali
      ? `"${order.order_number}" siparişi iptal edilecek.\nKolayBi faturası silinecek ve e-Fatura iptal edilecek.\n\nDevam etmek istiyor musunuz?`
      : `"${order.order_number}" siparişi iptal edilecek.\n\nDevam etmek istiyor musunuz?`;
    if (status === "cancelled" && !window.confirm(metin)) return;
    void calistir(status, async () => {
      const response = await client.cancel(order.public_id, status, newIdempotencyKey("order_cancel"), status === "returned" ? "Manuel iade" : undefined);
      if (status === "returned") return `Sipariş durumu güncellendi: ${durumEtiketi("returned")}`;
      return response.e_document_cancel ? "KolayBi faturası ve e-Fatura iptal ediliyor..." : "Sipariş iptal edildi";
    }, status === "cancelled" ? "Sipariş iptal edilirken hata oluştu" : "Durum güncellenirken hata oluştu");
  };

  const geriAl = () => {
    if (!window.confirm(`"${order.order_number}" siparişi geri alınacak ve "Oluşturuldu" durumuna çevrilecek.\n\nDevam etmek istiyor musunuz?`)) return;
    void calistir("geri-al", async () => {
      await client.restore(order.public_id);
      return "Sipariş geri alındı ve 'Oluşturuldu' durumuna döndürüldü";
    }, "Geri alma yapılamadı");
  };

  const sil = () => {
    const metin = faturali
      ? `"${order.order_number}" siparişi kalıcı olarak silinecek!\n\nKolayBi faturası silinecek, e-Fatura iptal edilecek ve sipariş panelden kaldırılacak.\n\nBu işlem geri alınamaz. Devam etmek istiyor musunuz?`
      : `"${order.order_number}" siparişi kalıcı olarak silinecek!\n\nBu işlem geri alınamaz. Devam etmek istiyor musunuz?`;
    if (!window.confirm(metin)) return;
    setIslem("sil");
    void (async () => {
      try {
        await client.remove(order.public_id, newIdempotencyKey("order_delete"));
        setSilindi(true);
        await onChanged?.();
      } catch (error) {
        setBildirim({ tip: "hata", mesaj: hataMesaji(error, "Silme yapılamadı") });
      } finally {
        setIslem(null);
      }
    })();
  };

  const kolaybiAktar = () =>
    calistir("kolaybi", async () => {
      const response = await client.kolaybiTransfer(order.public_id, newIdempotencyKey("order_kolaybi"));
      return response.replayed ? "Aktarılıyor..." : "KolayBi aktarımı kuyruğa alındı";
    }, "Aktarım başarısız");

  const eFaturaGonder = () =>
    calistir("e-fatura", async () => {
      await client.eDocument(order.public_id, "create", newIdempotencyKey("order_edoc"));
      return "e-Fatura GİB'e gönderiliyor...";
    }, "e-Fatura gönderilemedi");

  const faturaGoruntule = () =>
    calistir("fatura", async () => {
      const response = await client.invoice(order.public_id, newIdempotencyKey("order_invoice"));
      return `Fatura ID: ${response.invoice_id ?? order.kolaybi.invoice_id}`;
    }, "Fatura yüklenemedi");

  const ara = () =>
    calistir("ara", async () => {
      await client.confirmationCall(order.public_id, newIdempotencyKey("order_call"));
      return `Arama başlatıldı! (${order.customer_full_name ?? "-"} - ${order.customer_phone ?? "-"})`;
    }, "Arama başlatılamadı");

  const kontrolEt = () =>
    calistir("kontrol", async () => {
      await client.confirmationStatus(order.public_id, newIdempotencyKey("order_call_status"));
      return "Henüz sonuç yok";
    }, "Henüz sonuç yok");

  const durumYenile = () =>
    calistir("senkron", async () => {
      const response = await client.syncProviderSteps(order.public_id);
      return response.advanced_count > 0 ? "Durum güncellendi" : null;
    }, "Durum güncellenemedi");

  const manuelTeyit = (value: "teyit_edildi" | "ulasilamadi" | "bekliyor") =>
    calistir(`teyit-${value}`, async () => {
      await client.setConfirmation(order.public_id, value);
      return value === "teyit_edildi" ? `${order.customer_full_name ?? order.order_number} - Manuel teyit edildi` : null;
    }, "İşlem yapılamadı");

  const notKaydet = () =>
    calistir("not", async () => {
      await client.updateNotes(order.public_id, not.trim() ? not : null);
      return "Not kaydedildi";
    }, "Not kaydedilemedi");

  return (
    <div className="siparis-aksiyon" data-testid="order-actions">
      {bildirim && (
        <div className={`siparis-aksiyon-bildirim ${bildirim.tip}`} role="status" data-testid="order-action-message">
          {bildirim.mesaj}
        </div>
      )}

      <div className="siparis-aksiyon-rozetler">
        <span className={`siparis-rozet teyit-${teyit.sinif}`} data-testid="order-teyit-badge">{teyit.etiket}</span>
        {order.confirmation_call.call_count > 0 && (
          <span className="siparis-rozet-alt" title={`${order.confirmation_call.call_count} kez arandı`}>x{order.confirmation_call.call_count}</span>
        )}
        {order.confirmation_call.listen_seconds ? <span className="siparis-rozet-alt">{order.confirmation_call.listen_seconds}sn dinledi</span> : null}
        <span className={`siparis-rozet kb-${kb.sinif}`} data-testid="order-kolaybi-badge">{kb.etiket}</span>
        {kb.alt && <span className="siparis-rozet-alt">{kb.alt}</span>}
        {order.kolaybi.status === "failed" && <span className="siparis-rozet kb-hata" data-testid="order-kolaybi-failed">Aktarım Başarısız</span>}
      </div>

      {faturali && (
        <p className="siparis-aksiyon-bilgi" data-testid="order-kolaybi-info">
          {order.kolaybi.status === "cancelled" || durum === "cancelled"
            ? `KolayBi faturası iptal edildi · Eski Fatura ID: ${order.kolaybi.invoice_id}`
            : `KolayBi'ye aktarılmış · Fatura ID: ${order.kolaybi.invoice_id}`}
        </p>
      )}
      {order.kolaybi.error && <p className="siparis-aksiyon-hata" data-testid="order-kolaybi-error">{order.kolaybi.error}</p>}

      <section className="siparis-aksiyon-bolum">
        <h4>Durumu Değiştir</h4>
        <div className="siparis-aksiyon-butonlar">
          {(durum === "draft" || durum === "created" || durum === "olusturuldu") && (
            <button type="button" className="secondary-action" disabled={mesgul} data-testid="order-status-confirmed" onClick={() => void durumDegistir("confirmed")}>Teyit Edildi</button>
          )}
          {["draft", "created", "olusturuldu", "confirmed"].includes(durum) && (
            <button type="button" className="secondary-action" disabled={mesgul} data-testid="order-status-preparing" onClick={() => void durumDegistir("preparing")}>Hazırlanıyor</button>
          )}
          {(durum === "preparing" || durum === "shipped") && (
            <button type="button" className="secondary-action" disabled={mesgul} data-testid="order-status-delivered" onClick={() => void durumDegistir("delivered")}>Teslim Edildi</button>
          )}
          {!iptalVeyaIade && durum !== "delivered" && (
            <button type="button" className="secondary-action danger" disabled={mesgul} data-testid="order-cancel" title="Siparişi İptal Et" onClick={() => iptalEt("cancelled")}>
              <XCircle size={14} aria-hidden="true" /> İptal Et
            </button>
          )}
          {!iptalVeyaIade && (
            <button type="button" className="secondary-action" disabled={mesgul} data-testid="order-return" onClick={() => iptalEt("returned")}>İade Et</button>
          )}
          {iptalVeyaIade && (
            <button type="button" className="secondary-action" disabled={mesgul} data-testid="order-restore" title="Siparişi Geri Al" onClick={geriAl}>
              <RotateCcw size={14} aria-hidden="true" /> Siparişi Geri Al (Oluşturuldu yapılacak)
            </button>
          )}
          <button type="button" className="secondary-action danger" disabled={mesgul} data-testid="order-delete" title="Panelden Kalıcı Sil" onClick={sil}>
            <Trash2 size={14} aria-hidden="true" /> Panelden Kalıcı Sil
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
            title={order.kolaybi.status === "failed" ? "KolayBi'ye Tekrar Aktar" : "KolayBi'ye Aktar"}
            onClick={() => void kolaybiAktar()}
          >
            {islem === "kolaybi" ? "Aktarılıyor..." : "KolayBi'ye Aktar (Cari + Fatura)"}
          </button>
          <button type="button" className="secondary-action" disabled={mesgul} data-testid="order-invoice-view" onClick={() => void faturaGoruntule()}>Fatura Görüntüle</button>
          <button type="button" className="secondary-action" disabled={mesgul} data-testid="order-e-document-send" onClick={() => void eFaturaGonder()}>e-Fatura Gönder</button>
          <button type="button" className="secondary-action icon-action" disabled={mesgul} data-testid="order-provider-sync" onClick={() => void durumYenile()}>
            <RefreshCw size={14} aria-hidden="true" /> <span>Durumu Yenile</span>
          </button>
        </div>
        {order.kolaybi.e_document_status && (
          <p className="siparis-aksiyon-bilgi" data-testid="order-e-document-status">e-Fatura: {order.kolaybi.e_document_status}</p>
        )}
      </section>

      <section className="siparis-aksiyon-bolum">
        <h4>Teyit</h4>
        <div className="siparis-aksiyon-butonlar">
          <button type="button" className="secondary-action icon-action" disabled={mesgul} data-testid="order-confirmation-call" onClick={() => void ara()}>
            <Phone size={14} aria-hidden="true" /> <span>Ara</span>
          </button>
          <button type="button" className="secondary-action" disabled={mesgul || !order.confirmation_call.bulk_id} data-testid="order-confirmation-check" title="NetGSM'den durumu tekrar sorgula" onClick={() => void kontrolEt()}>Kontrol Et</button>
          <button type="button" className="secondary-action" disabled={mesgul} data-testid="order-manual-confirm" title="Manuel aradıktan sonra teyit et" onClick={() => void manuelTeyit("teyit_edildi")}>Teyit Edildi</button>
          <button type="button" className="secondary-action" disabled={mesgul} data-testid="order-manual-unreachable" onClick={() => void manuelTeyit("ulasilamadi")}>Ulaşılamadı</button>
          <button type="button" className="secondary-action" disabled={mesgul} data-testid="order-manual-pending" onClick={() => void manuelTeyit("bekliyor")}>Bekliyor</button>
        </div>
      </section>

      <section className="siparis-aksiyon-bolum">
        <h4>Not</h4>
        <textarea className="siparis-aksiyon-not" data-testid="order-notes-input" rows={3} value={not} onChange={(event) => setNot(event.target.value)} />
        <div className="siparis-aksiyon-butonlar">
          <button type="button" className="secondary-action" disabled={mesgul} data-testid="order-notes-save" onClick={() => void notKaydet()}>Kaydet</button>
          <button type="button" className="secondary-action icon-action" data-testid="order-print" onClick={() => window.print()}>
            <Printer size={14} aria-hidden="true" /> <span>Yazdır</span>
          </button>
        </div>
      </section>

      {steps.length > 0 && (
        <ul className="siparis-aksiyon-adimlar" data-testid="order-provider-steps">
          {steps.map((step) => (
            <li key={step.public_id} className={`adim-${step.status}`}>
              {adimEtiketi(step)}
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
  const client = useMemo(() => createOrderActionsClient(http), [http]);
  const [calisan, setCalisan] = useState<"teyit" | "kolaybi" | null>(null);
  const [mesaj, setMesaj] = useState<string | null>(null);

  const topluTeyit = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`${selectedIds.length} adet teyit edilmemiş siparişe arama yapılacak. Devam?`)) return;
    setCalisan("teyit");
    try {
      const response = await client.bulkConfirmationCalls(selectedIds, newIdempotencyKey("bulk_teyit"));
      if (response.queued_count === 0) {
        setMesaj("Seçili siparişler arasında teyit edilmemiş sipariş yok");
      } else {
        const hatali = response.results.filter((row) => !row.queued).length;
        setMesaj(`Toplu Teyit Araması: ${response.queued_count} başarılı, ${hatali} hatalı`);
      }
      await onDone?.();
    } catch (error) {
      setMesaj(hataMesaji(error, "İşlem yapılamadı"));
    } finally {
      setCalisan(null);
    }
  };

  const topluKolaybi = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`${selectedIds.length} adet sipariş KolayBi'ye aktarılacak. Devam?`)) return;
    setCalisan("kolaybi");
    try {
      const response = await client.bulkKolaybiTransfer(selectedIds, newIdempotencyKey("bulk_kolaybi"));
      if (response.queued_count === 0) {
        setMesaj("Seçili siparişler arasında aktarılacak sipariş yok (hepsi zaten aktarılmış)");
      } else {
        const hatali = response.results.filter((row) => !row.queued).length;
        setMesaj(`Toplu KolayBi Aktarım: ${response.queued_count} başarılı, ${hatali} hatalı`);
      }
      await onDone?.();
    } catch (error) {
      setMesaj(hataMesaji(error, "İşlem yapılamadı"));
    } finally {
      setCalisan(null);
    }
  };

  return (
    <>
      <button className="secondary-action" data-testid="orders-bulk-confirmation" disabled={selectedIds.length === 0 || calisan !== null} type="button" onClick={() => void topluTeyit()}>
        Toplu teyit ara
      </button>
      <button className="secondary-action" data-testid="orders-bulk-kolaybi" disabled={selectedIds.length === 0 || calisan !== null} type="button" onClick={() => void topluKolaybi()}>
        Toplu KolayBi aktar
      </button>
      {mesaj && (
        <span className="siparis-toplu-mesaj" role="status" data-testid="orders-bulk-message">{mesaj}</span>
      )}
    </>
  );
}
