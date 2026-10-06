import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Truck, X } from "lucide-react";
import { BackendRequestError, type BackendHttpClient } from "../../api/http-client.js";
import {
  createShipmentsClient,
  type CargoProviderKey,
  type CreateShipmentResponse,
  type ShipmentDraft,
  type ShipmentPaymentStatus,
} from "../../api/shipments-client.js";

/**
 * Legacy KargolarPage kargo onay modal ("{Sürat|PTT} Kargo Barkod Oluştur") + row "Sürat'e Aktar" /
 * "PTT'ye Aktar" buttons + toplu işlem bar. Every create goes through the backend shipment API; the
 * provider call itself is queued for the worker.
 */

export const cargoFirmaAdi: Record<CargoProviderKey, string> = { ptt: "PTT Kargo", surat: "Sürat Kargo" };

function backendErrorMessage(error: unknown) {
  if (error instanceof BackendRequestError) {
    const body = error.body as { error?: { message?: string } } | null;
    return body?.error?.message ?? error.message;
  }
  return error instanceof Error ? error.message : "Bilinmeyen hata";
}

function idempotencyKey(prefix: string, id: string) {
  return `${prefix}_${id}_${Date.now().toString(36)}`;
}

function KargoToast(props: { message: { tone: "success" | "error" | "info"; text: string } | null }) {
  if (!props.message) return null;
  return (
    <p className={`kargo-toast kargo-toast-${props.message.tone}`} data-testid="kargo-toast" role="status">
      {props.message.text}
    </p>
  );
}

export function KargoOlusturModal(props: {
  http: BackendHttpClient;
  orderPublicId: string;
  firma: CargoProviderKey;
  onClose: () => void;
  onCreated: (result: CreateShipmentResponse) => void;
  onError: (message: string) => void;
}) {
  const client = useMemo(() => createShipmentsClient(props.http), [props.http]);
  const [draft, setDraft] = useState<ShipmentDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [odemeDurumu, setOdemeDurumu] = useState<ShipmentPaymentStatus>("karsi_odemeli");
  const [adres, setAdres] = useState({ adres: "", il: "", ilce: "" });
  const [olusturuluyor, setOlusturuluyor] = useState(false);
  const lock = useRef(false);

  useEffect(() => {
    let active = true;
    setDraft(null);
    setLoadError(null);
    setOdemeDurumu("karsi_odemeli");
    client
      .getShipmentDraft(props.orderPublicId)
      .then((next) => {
        if (!active) return;
        setDraft(next);
        setAdres({ adres: next.recipient.address ?? "", il: next.recipient.city ?? "", ilce: next.recipient.district ?? "" });
      })
      .catch((error: unknown) => {
        if (active) setLoadError(backendErrorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [client, props.orderPublicId]);

  async function barkodOlustur() {
    if (!draft || lock.current) return;
    lock.current = true;
    setOlusturuluyor(true);
    try {
      const result = await client.createShipment(draft.order_public_id, {
        provider: props.firma,
        payment_status: odemeDurumu,
        idempotency_key: idempotencyKey(`kargo_${props.firma}`, draft.order_public_id),
        ...(adres.adres.trim() && adres.adres.trim() !== (draft.recipient.address ?? "") ? { recipient_address: adres.adres.trim() } : {}),
        ...(adres.il.trim() && adres.il.trim() !== (draft.recipient.city ?? "") ? { recipient_city: adres.il.trim() } : {}),
        ...(adres.ilce.trim() && adres.ilce.trim() !== (draft.recipient.district ?? "") ? { recipient_district: adres.ilce.trim() } : {}),
      });
      props.onCreated(result);
    } catch (error) {
      props.onError(`Kargo oluşturulurken hata oluştu: ${backendErrorMessage(error)}`);
    } finally {
      lock.current = false;
      setOlusturuluyor(false);
    }
  }

  const firmaAdi = props.firma === "surat" ? "Sürat" : "PTT";
  const eksikAdres = draft ? !draft.recipient.city || !draft.recipient.district || !draft.recipient.address : false;
  const tutar = draft ? Number.parseFloat(draft.total_amount || "0").toLocaleString("tr-TR") : "0";

  return (
    <div className="kargo-modal-backdrop" data-testid="kargo-olustur-modal">
      <div className="kargo-modal" role="dialog" aria-modal="true" aria-label={`${firmaAdi} Kargo Barkod Oluştur`}>
        <div className="kargo-modal-header">
          <h3>{firmaAdi} Kargo Barkod Oluştur</h3>
          <button className="kargo-icon-button" type="button" aria-label="Kapat" onClick={props.onClose}>
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {loadError && <p className="kargo-modal-error">{loadError}</p>}
        {!draft && !loadError && (
          <p className="kargo-modal-loading">
            <Loader2 size={16} className="kargo-spin" aria-hidden="true" /> Yükleniyor...
          </p>
        )}

        {draft && (
          <div className="kargo-modal-body">
            <div className="kargo-modal-summary">
              <p>
                <strong>Müşteri:</strong> {draft.recipient.name ?? "-"}
                {draft.items.length > 0 && <span className="kargo-muted"> - {draft.items.map((k) => `${k.quantity} ${k.name}`).join(", ")}</span>}
              </p>
              <p>
                <strong>Tutar:</strong> {tutar} TRY
              </p>
            </div>

            {draft.existing_shipment && (
              <p className="kargo-modal-error" data-testid="kargo-existing-shipment">
                Bu sipariş için gönderi daha önce oluşturulmuş.
                {draft.existing_shipment.barcode_number || draft.existing_shipment.tracking_number
                  ? ` Takip: ${draft.existing_shipment.tracking_number ?? draft.existing_shipment.barcode_number}`
                  : ""}
              </p>
            )}

            {eksikAdres && (
              <div className="kargo-missing-address" data-testid="kargo-missing-address">
                <p>Eksik adres bilgilerini tamamlayın:</p>
                {!draft.recipient.address && (
                  <input
                    data-testid="kargo-adres"
                    placeholder="Adres"
                    type="text"
                    value={adres.adres}
                    onChange={(event) => setAdres((prev) => ({ ...prev, adres: event.target.value }))}
                  />
                )}
                <div className="kargo-missing-grid">
                  {!draft.recipient.city && (
                    <input
                      data-testid="kargo-il"
                      placeholder="İl seçin"
                      type="text"
                      value={adres.il}
                      onChange={(event) => setAdres((prev) => ({ ...prev, il: event.target.value, ilce: "" }))}
                    />
                  )}
                  {!draft.recipient.district && (
                    <input
                      data-testid="kargo-ilce"
                      disabled={!adres.il && !draft.recipient.city}
                      placeholder={!(adres.il || draft.recipient.city) ? "Önce il seçin" : "İlçe seçin"}
                      type="text"
                      value={adres.ilce}
                      onChange={(event) => setAdres((prev) => ({ ...prev, ilce: event.target.value }))}
                    />
                  )}
                </div>
              </div>
            )}

            <label className="kargo-field">
              <span>Ödeme Durumu</span>
              <select
                data-testid="kargo-odeme-durumu"
                value={odemeDurumu}
                onChange={(event) => setOdemeDurumu(event.target.value as ShipmentPaymentStatus)}
              >
                <option value="karsi_odemeli">Kapıda ödemeli</option>
                <option value="odeme_alindi">Ödeme alındı</option>
              </select>
            </label>

            <div className="kargo-modal-actions">
              <button className="secondary-action" type="button" onClick={props.onClose}>
                İptal
              </button>
              <button
                className={`kargo-create-button kargo-create-${props.firma}`}
                data-testid="kargo-barkod-olustur"
                disabled={olusturuluyor || Boolean(draft.existing_shipment)}
                type="button"
                onClick={() => void barkodOlustur()}
              >
                {olusturuluyor ? (
                  <>
                    <Loader2 size={16} className="kargo-spin" aria-hidden="true" /> Oluşturuluyor...
                  </>
                ) : (
                  <>
                    <Truck size={16} aria-hidden="true" /> Barkod Oluştur
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Row buttons for one order: "Sürat'e Aktar" / "PTT'ye Aktar" opening the onay modal. */
export function KargoSiparisAksiyonlari(props: {
  http: BackendHttpClient;
  orderPublicId: string;
  onChanged: (result: CreateShipmentResponse) => void;
}) {
  const [modalFirma, setModalFirma] = useState<CargoProviderKey | null>(null);
  const [toast, setToast] = useState<{ orderPublicId: string; tone: "success" | "error" | "info"; text: string } | null>(null);
  const message = toast && toast.orderPublicId === props.orderPublicId ? toast : null;
  const orderPublicId = props.orderPublicId;
  const setMessage = (next: { tone: "success" | "error" | "info"; text: string }) => setToast({ ...next, orderPublicId });

  useEffect(() => {
    setModalFirma(null);
  }, [props.orderPublicId]);

  return (
    <div className="kargo-order-actions" data-testid="kargo-order-actions">
      <button className="kargo-aktar-button kargo-aktar-surat" data-testid="kargo-aktar-surat" title="Sürat Kargo'ya Aktar" type="button" onClick={() => setModalFirma("surat")}>
        <Truck size={12} aria-hidden="true" /> Sürat'e Aktar
      </button>
      <button className="kargo-aktar-button kargo-aktar-ptt" data-testid="kargo-aktar-ptt" title="PTT Kargo'ya Aktar" type="button" onClick={() => setModalFirma("ptt")}>
        <Truck size={12} aria-hidden="true" /> PTT'ye Aktar
      </button>
      <KargoToast message={message} />
      {modalFirma && (
        <KargoOlusturModal
          firma={modalFirma}
          http={props.http}
          orderPublicId={props.orderPublicId}
          onClose={() => setModalFirma(null)}
          onCreated={(result) => {
            setModalFirma(null);
            setMessage({ tone: "success", text: result.message });
            props.onChanged(result);
          }}
          onError={(text) => setMessage({ tone: "error", text })}
        />
      )}
    </div>
  );
}

/** Legacy toplu işlem bar: "Sürat'e Aktar" / "PTT'ye Aktar" for the selected orders (always karşı ödemeli). */
export function KargoTopluAktar(props: {
  http: BackendHttpClient;
  selectedOrderPublicIds: string[];
  onChanged: () => void;
}) {
  const client = useMemo(() => createShipmentsClient(props.http), [props.http]);
  const [yukleniyor, setYukleniyor] = useState<CargoProviderKey | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);

  async function topluKargoAktar(firma: CargoProviderKey) {
    if (yukleniyor || props.selectedOrderPublicIds.length === 0) return;
    const firmaAdi = cargoFirmaAdi[firma];
    if (!window.confirm(`${props.selectedOrderPublicIds.length} adet sipariş ${firmaAdi}'ya aktarılacak. Devam?`)) return;
    setYukleniyor(firma);
    setMessage({ tone: "info", text: `${props.selectedOrderPublicIds.length} sipariş ${firmaAdi}'ya aktarılıyor...` });
    try {
      const result = await client.bulkCreateShipments({
        provider: firma,
        order_public_ids: props.selectedOrderPublicIds,
        idempotency_key: idempotencyKey(`toplu_${firma}`, String(props.selectedOrderPublicIds.length)),
      });
      setMessage({ tone: result.created_count > 0 ? "success" : "error", text: result.message });
      props.onChanged();
    } catch (error) {
      setMessage({ tone: "error", text: backendErrorMessage(error) });
    } finally {
      setYukleniyor(null);
    }
  }

  if (props.selectedOrderPublicIds.length === 0) {
    // List refresh clears the selection; keep the last bulk result visible like the legacy toast.
    return message ? (
      <div className="kargo-toplu-bar" data-testid="kargo-toplu-bar">
        <KargoToast message={message} />
      </div>
    ) : null;
  }
  return (
    <div className="kargo-toplu-bar" data-testid="kargo-toplu-bar">
      <span className="kargo-toplu-count">{props.selectedOrderPublicIds.length} kargo seçili</span>
      <span className="kargo-toplu-divider" aria-hidden="true" />
      <button
        className="kargo-aktar-button kargo-aktar-surat"
        data-testid="kargo-toplu-surat"
        disabled={Boolean(yukleniyor)}
        type="button"
        onClick={() => void topluKargoAktar("surat")}
      >
        {yukleniyor === "surat" ? <Loader2 size={14} className="kargo-spin" aria-hidden="true" /> : <Truck size={14} aria-hidden="true" />}
        Sürat'e Aktar
      </button>
      <button
        className="kargo-aktar-button kargo-aktar-ptt"
        data-testid="kargo-toplu-ptt"
        disabled={Boolean(yukleniyor)}
        type="button"
        onClick={() => void topluKargoAktar("ptt")}
      >
        {yukleniyor === "ptt" ? <Loader2 size={14} className="kargo-spin" aria-hidden="true" /> : <Truck size={14} aria-hidden="true" />}
        PTT'ye Aktar
      </button>
      <KargoToast message={message} />
    </div>
  );
}
