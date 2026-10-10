import { Loader2, Printer, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { BrandIcon } from "@/components/brand-icons";
import { providerBrand } from "@/components/provider-label";
import { Button } from "@/components/ui/button";
import type { ShipmentPrintData } from "@/lib/orders";
import { errorText } from "./accounting-shared";

const legacyBarcodeOptions = { format: "CODE128", width: 2.5, height: 70, displayValue: true, fontSize: 16, fontOptions: "bold", textMargin: 8, margin: 5, background: "#ffffff", lineColor: "#000000" } as const;

function PrintPage({ data }: { data: ShipmentPrintData }) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    const svg = svgRef.current;
    if (!data.barcode_value || !svg) return;
    let active = true;
    void import("jsbarcode").then((module) => active && module.default(svg, data.barcode_value!, legacyBarcodeOptions));
    return () => {
      active = false;
    };
  }, [data.barcode_value]);

  return (
    <article className="mx-auto w-full max-w-[210mm] break-before-page bg-white p-[8mm] text-[#1a1a2e] first:break-before-auto print:shadow-none sm:shadow" data-testid="print-page">
      <p className="text-lg font-bold">{data.invoice_title}</p>
      <p>
        {data.recipient.name}
        {data.recipient.phone ? ` · ${data.recipient.phone}` : ""}
      </p>
      <p>{[data.recipient.address, data.recipient.district, data.recipient.city].filter(Boolean).join(" ")}</p>
      {data.items.length > 0 && (
        <table className="mt-2 w-full text-sm">
          <tbody>
            {data.items.map((item, index) => (
              <tr key={`${item.name}-${index}`} className="border-b">
                <td className="py-1 pr-2">{item.quantity}</td>
                <td className="py-1 pr-2">{item.name}</td>
                <td className="py-1 text-right">{Number.parseFloat(item.total_amount).toLocaleString("tr-TR")} TRY</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.barcode_value ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t-2 border-dashed pt-4" data-testid="print-barcode">
          <div>
            <p className="flex items-center gap-2 font-semibold">
              {providerBrand(data.provider_label) && <BrandIcon brand={providerBrand(data.provider_label)!} variant="logo" title="" className="h-6" />}
              {data.provider_label} - Kargo Takip
            </p>
            <p className="font-mono text-lg" data-testid="print-barcode-value">
              {data.barcode_value}
            </p>
          </div>
          <svg ref={svgRef} className="max-w-full" />
        </div>
      ) : (
        <p className="mt-4 text-red-700">{t("cargoPrint.transferFirst")}</p>
      )}
    </article>
  );
}

/**
 * Legacy barkodlu fatura print (single shipment or "Toplu Barkodlu Fatura PDF"): one A4 page per shipment;
 * `beforeprint` reports POST /api/shipments/:id/printed for each page like the legacy popup message.
 */
export function ShipmentPrintOverlay({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [pages, setPages] = useState<ShipmentPrintData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printed, setPrinted] = useState(false);
  const reported = useRef(false);
  const key = ids.join(",");

  useEffect(() => {
    let active = true;
    reported.current = false;
    void Promise.allSettled(key.split(",").map((id) => api.getShipmentPrint(id))).then((results) => {
      if (!active) return;
      const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failed) setError(t("cargoPrint.printError", { message: errorText(failed.reason) }));
      setPages(results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])));
    });
    return () => {
      active = false;
    };
  }, [api, key, t]);

  useEffect(() => {
    if (!pages || pages.length === 0) return;
    const report = () => {
      if (reported.current) return;
      reported.current = true;
      void Promise.all(pages.map((page) => api.markShipmentPrinted(page.shipment_public_id, `print_${page.shipment_public_id}`)))
        .then(() => setPrinted(true))
        .catch(() => {
          reported.current = false;
        });
    };
    window.addEventListener("beforeprint", report);
    return () => window.removeEventListener("beforeprint", report);
  }, [api, pages]);

  useEffect(() => {
    document.body.classList.add("print-overlay-open");
    return () => document.body.classList.remove("print-overlay-open");
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-muted print:static print:bg-white" data-testid="print-overlay">
      <div className="flex flex-wrap items-center gap-2 border-b bg-background p-2 print:hidden">
        <span className="px-2 font-medium">
          {t("cargoPrint.barTitle")}
          {pages && pages.length > 1 && <span data-testid="print-count"> · {pages.length}</span>}
        </span>
        {printed && (
          <span className="text-sm text-emerald-700 dark:text-emerald-300" data-testid="print-done">
            {t("cargoPrint.printed")}
          </span>
        )}
        <Button className="ml-auto min-h-11" disabled={!pages || pages.length === 0} onClick={() => window.print()} data-testid="print-button">
          <Printer className="size-4" aria-hidden="true" />
          {t("cargoPrint.print")}
        </Button>
        <Button variant="outline" size="icon" className="size-11" aria-label={t("cargoPrint.close")} onClick={onClose} data-testid="print-close">
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 sm:p-6 print:overflow-visible print:p-0">
        {error && <p className="mb-2 text-center text-sm text-destructive">{error}</p>}
        {!pages ? <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" aria-hidden="true" /> : <div className="flex flex-col gap-4 print:gap-0">{pages.map((page) => <PrintPage key={page.shipment_public_id} data={page} />)}</div>}
      </div>
    </div>,
    document.body,
  );
}
