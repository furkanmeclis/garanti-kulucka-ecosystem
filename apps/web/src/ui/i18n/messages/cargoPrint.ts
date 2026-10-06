import { defineMessages } from "../index.js";

/** Barcode label + e-invoice print view (screen chrome and messages). */
export const cargoPrintMessages = defineMessages({
  tr: {
    unknownError: "Bilinmeyen hata",
    printError: "Yazdırma hatası: {message}",
    barcodeRenderError: "Barkod render hatası: {message}",
    barTitle: "Kargo Etiketi + e-Fatura",
    printed: "Yazdırıldı",
    print: "Yazdir",
    close: "Kapat",
    transferFirst: "Önce kargoya aktarın",
    download: "Etiketi {format} olarak indir",
    downloadError: "Etiket indirilemedi: {message}",
  },
  en: {
    unknownError: "Unknown error",
    printError: "Print error: {message}",
    barcodeRenderError: "Barcode render error: {message}",
    barTitle: "Shipping Label + e-Invoice",
    printed: "Printed",
    print: "Print",
    close: "Close",
    transferFirst: "Transfer to carrier first",
    download: "Download label as {format}",
    downloadError: "Could not download the label: {message}",
  },
});
