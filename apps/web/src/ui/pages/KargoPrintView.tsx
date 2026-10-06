import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import { BackendRequestError, type BackendHttpClient } from "../../api/http-client.js";
import { createShipmentsClient, type ShipmentPrintData } from "../../api/shipments-client.js";

/**
 * Legacy barkodlu fatura print (SiparislerPage `handleBarkodluPdfYazdir` + KargolarPage popup):
 * top bar "Kargo Etiketi + e-Fatura" with "Yazdir", A4 page with the fatura block and the
 * "{firma} - Kargo Takip" barkod section rendered by JsBarcode CODE128 (legacy options). The popup's
 * `beforeprint` → `kargo-yazdirildi` message is reproduced as POST /api/shipments/:id/printed.
 */

const legacyBarcodeOptions = {
  format: "CODE128",
  width: 2.5,
  height: 70,
  displayValue: true,
  fontSize: 16,
  fontOptions: "bold",
  textMargin: 8,
  margin: 5,
  background: "#ffffff",
  lineColor: "#000000",
} as const;

function errorMessage(error: unknown) {
  if (error instanceof BackendRequestError) {
    const body = error.body as { error?: { message?: string } } | null;
    return body?.error?.message ?? error.message;
  }
  return error instanceof Error ? error.message : "Bilinmeyen hata";
}

export function KargoPrintView(props: {
  http: BackendHttpClient;
  shipmentPublicId: string;
  onClose: () => void;
  onPrinted?: (labelPrintedAt: string) => void;
}) {
  const client = useMemo(() => createShipmentsClient(props.http), [props.http]);
  const [data, setData] = useState<ShipmentPrintData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printedAt, setPrintedAt] = useState<string | null>(null);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const reported = useRef(false);
  const onPrintedRef = useRef(props.onPrinted);
  onPrintedRef.current = props.onPrinted;

  useEffect(() => {
    let active = true;
    reported.current = false;
    setData(null);
    setError(null);
    client
      .getShipmentPrint(props.shipmentPublicId)
      .then((next) => {
        if (!active) return;
        setData(next);
        setPrintedAt(next.label_printed_at);
      })
      .catch((reason: unknown) => {
        if (active) setError(`Yazdırma hatası: ${errorMessage(reason)}`);
      });
    return () => {
      active = false;
    };
  }, [client, props.shipmentPublicId]);

  useEffect(() => {
    const barcode = data?.barcode_value;
    const svg = svgRef.current;
    if (!barcode || !svg) return;
    let active = true;
    import("jsbarcode")
      .then((module) => {
        if (!active) return;
        const JsBarcode = module.default;
        JsBarcode(svg, barcode, legacyBarcodeOptions);
        setBarcodeError(null);
      })
      .catch((reason: unknown) => {
        if (active) setBarcodeError(`Barkod render hatası: ${errorMessage(reason)}`);
      });
    return () => {
      active = false;
    };
  }, [data?.barcode_value]);

  useEffect(() => {
    document.body.classList.add("kargo-print-active");
    return () => document.body.classList.remove("kargo-print-active");
  }, []);

  useEffect(() => {
    if (!data) return;
    const bildir = () => {
      if (reported.current) return;
      reported.current = true;
      client
        .markShipmentPrinted(data.shipment_public_id, `print_${data.shipment_public_id}`)
        .then((result) => {
          setPrintedAt(result.label_printed_at);
          onPrintedRef.current?.(result.label_printed_at);
        })
        .catch(() => {
          reported.current = false;
        });
    };
    window.addEventListener("beforeprint", bildir);
    return () => window.removeEventListener("beforeprint", bildir);
  }, [client, data]);

  const content = (
    <div className="kargo-print-root" data-testid="kargo-print-view">
      <div className="kargo-print-bar">
        <span>Kargo Etiketi + e-Fatura</span>
        {printedAt && (
          <em className="kargo-print-done" data-testid="kargo-print-done">
            Yazdırıldı
          </em>
        )}
        <button className="kargo-print-button" data-testid="kargo-print-button" disabled={!data} type="button" onClick={() => window.print()}>
          <Printer size={14} aria-hidden="true" /> Yazdir
        </button>
        <button className="kargo-print-close" data-testid="kargo-print-close" type="button" aria-label="Kapat" onClick={props.onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="kargo-print-scroll">
        {error && <p className="kargo-print-error">{error}</p>}
        {data && (
          <div className="kargo-print-page" data-testid="kargo-print-page">
            <div className="kargo-print-fatura">
              <p className="kargo-print-fatura-title">{data.invoice_title}</p>
              <p className="kargo-print-alici">
                {data.recipient.name}
                {data.recipient.phone ? ` · ${data.recipient.phone}` : ""}
              </p>
              <p className="kargo-print-alici">
                {[data.recipient.address, data.recipient.district, data.recipient.city].filter(Boolean).join(" ")}
              </p>
              {data.items.length > 0 && (
                <table className="kargo-print-items">
                  <tbody>
                    {data.items.map((item, index) => (
                      <tr key={`${item.name}-${index}`}>
                        <td>{item.quantity}</td>
                        <td>{item.name}</td>
                        <td>{Number.parseFloat(item.total_amount).toLocaleString("tr-TR")} TRY</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {data.barcode_value ? (
              <>
                <hr className="kargo-print-separator" />
                <div className="kargo-print-barkod-section" data-testid="kargo-print-barkod">
                  <div>
                    <div className="kargo-print-firma">{data.provider_label} - Kargo Takip</div>
                    <div className="kargo-print-takip-no" data-testid="kargo-print-takip-no">
                      {data.barcode_value}
                    </div>
                  </div>
                  <div>
                    <svg ref={svgRef} data-testid="kargo-print-barcode-svg" />
                  </div>
                </div>
                {barcodeError && <p className="kargo-print-error">{barcodeError}</p>}
              </>
            ) : (
              <p className="kargo-print-error">Önce kargoya aktarın</p>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
