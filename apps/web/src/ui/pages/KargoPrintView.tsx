import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Printer, X } from "lucide-react";
import { BackendRequestError, type BackendHttpClient } from "../../api/http-client.js";
import { createShipmentsClient, type ShipmentPrintData } from "../../api/shipments-client.js";
import { translate, useLanguage, useT, type UiLanguage } from "../i18n/index.js";
import { cargoPrintMessages } from "../i18n/messages/cargoPrint.js";

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

function errorMessage(error: unknown, language: UiLanguage) {
  if (error instanceof BackendRequestError) {
    const body = error.body as { error?: { message?: string } } | null;
    return body?.error?.message ?? error.message;
  }
  return error instanceof Error ? error.message : translate(cargoPrintMessages, language, "unknownError");
}

/** One A4 page: fatura block + "{firma} - Kargo Takip" CODE128 barkod (JsBarcode, legacy options). */
function KargoPrintPage({ data }: { data: ShipmentPrintData }) {
  const t = useT(cargoPrintMessages);
  const { language } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;
  const languageRef = useRef(language);
  languageRef.current = language;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);

  useEffect(() => {
    const barcode = data.barcode_value;
    const svg = svgRef.current;
    if (!barcode || !svg) return;
    let active = true;
    import("jsbarcode")
      .then((module) => {
        if (!active) return;
        module.default(svg, barcode, legacyBarcodeOptions);
        setBarcodeError(null);
      })
      .catch((reason: unknown) => {
        if (active) setBarcodeError(tRef.current("barcodeRenderError", { message: errorMessage(reason, languageRef.current) }));
      });
    return () => {
      active = false;
    };
  }, [data.barcode_value]);

  return (
    <div className="kargo-print-page" data-testid="kargo-print-page">
      <div className="kargo-print-fatura">
        <p className="kargo-print-fatura-title">{data.invoice_title}</p>
        <p className="kargo-print-alici">
          {data.recipient.name}
          {data.recipient.phone ? ` · ${data.recipient.phone}` : ""}
        </p>
        <p className="kargo-print-alici">{[data.recipient.address, data.recipient.district, data.recipient.city].filter(Boolean).join(" ")}</p>
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
        <p className="kargo-print-error">{t("transferFirst")}</p>
      )}
    </div>
  );
}

/**
 * One shipment (detail "Yazdır") or several (legacy "Toplu Barkodlu Fatura PDF"): one A4 page per shipment,
 * printed together. Label downloads (PDF/ZPL/EPL) are offered when a single shipment is shown.
 */
export function KargoPrintView(props: {
  http: BackendHttpClient;
  shipmentPublicIds: string[];
  onClose: () => void;
  onPrinted?: (labelPrintedAt: string) => void;
}) {
  const t = useT(cargoPrintMessages);
  const { language } = useLanguage();
  const tRef = useRef(t);
  tRef.current = t;
  const languageRef = useRef(language);
  languageRef.current = language;
  const client = useMemo(() => createShipmentsClient(props.http), [props.http]);
  const [pages, setPages] = useState<ShipmentPrintData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printedAt, setPrintedAt] = useState<string | null>(null);
  const reported = useRef(false);
  const onPrintedRef = useRef(props.onPrinted);
  onPrintedRef.current = props.onPrinted;
  const idsKey = props.shipmentPublicIds.join(",");

  useEffect(() => {
    let active = true;
    reported.current = false;
    setPages(null);
    setError(null);
    Promise.allSettled(idsKey.split(",").filter(Boolean).map((id) => client.getShipmentPrint(id)))
      .then((results) => {
        if (!active) return;
        const loaded = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
        const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (failed) setError(tRef.current("printError", { message: errorMessage(failed.reason, languageRef.current) }));
        setPages(loaded);
        setPrintedAt(loaded.length === 1 ? (loaded[0]?.label_printed_at ?? null) : null);
      });
    return () => {
      active = false;
    };
  }, [client, idsKey]);

  useEffect(() => {
    document.body.classList.add("kargo-print-active");
    return () => document.body.classList.remove("kargo-print-active");
  }, []);

  useEffect(() => {
    if (!pages || pages.length === 0) return;
    const bildir = () => {
      if (reported.current) return;
      reported.current = true;
      Promise.all(pages.map((page) => client.markShipmentPrinted(page.shipment_public_id, `print_${page.shipment_public_id}`)))
        .then((results) => {
          const last = results.at(-1)?.label_printed_at ?? null;
          setPrintedAt(last);
          if (last) onPrintedRef.current?.(last);
        })
        .catch(() => {
          reported.current = false;
        });
    };
    window.addEventListener("beforeprint", bildir);
    return () => window.removeEventListener("beforeprint", bildir);
  }, [client, pages]);

  const single = pages && pages.length === 1 ? pages[0] : null;
  const content = (
    <div className="kargo-print-root" data-testid="kargo-print-view">
      <div className="kargo-print-bar">
        <span>{t("barTitle")}</span>
        {pages && pages.length > 1 && <span data-testid="kargo-print-count">· {pages.length}</span>}
        {printedAt && (
          <em className="kargo-print-done" data-testid="kargo-print-done">
            {t("printed")}
          </em>
        )}
        <button className="kargo-print-button" data-testid="kargo-print-button" disabled={!pages || pages.length === 0} type="button" onClick={() => window.print()}>
          <Printer size={14} aria-hidden="true" /> {t("print")}
        </button>
        {single &&
          (["pdf", "zpl", "epl"] as const).map((format) => (
            <button
              key={format}
              className="kargo-print-button"
              data-testid={`kargo-label-${format}`}
              disabled={!single.barcode_value}
              type="button"
              aria-label={t("download", { format: format.toUpperCase() })}
              onClick={() => {
                client
                  .downloadShipmentLabel(single.shipment_public_id, format)
                  .then((blob) => {
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = `etiket-${single.barcode_value ?? single.shipment_public_id}.${format}`;
                    link.click();
                    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
                  })
                  .catch((reason: unknown) => setError(t("downloadError", { message: errorMessage(reason, language) })));
              }}
            >
              <Download size={14} aria-hidden="true" /> {format.toUpperCase()}
            </button>
          ))}
        <button className="kargo-print-close" data-testid="kargo-print-close" type="button" aria-label={t("close")} onClick={props.onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="kargo-print-scroll">
        {error && <p className="kargo-print-error">{error}</p>}
        {pages?.map((page) => <KargoPrintPage key={page.shipment_public_id} data={page} />)}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
