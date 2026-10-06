import { code128Modules } from "../documents/code128.js";
import { PdfDocument, fitText, wrapText } from "../documents/pdf.js";
import type { DocumentSender } from "../documents/sender.js";
import type { ShipmentPrintData } from "./repository.js";

/**
 * PTT / Sürat cargo label downloads (legacy KargolarPage "etiket indir"): a 100×150 mm PDF for office
 * printers and ZPL / EPL2 command files for 4×6" thermal printers at 203 dpi. All three print the same
 * Code 128 barcode (barcode value → barcode number → tracking number).
 */

export const labelFormats = ["pdf", "zpl", "epl"] as const;
export type LabelFormat = (typeof labelFormats)[number];

export class LabelBarcodeMissingError extends Error {
  constructor() {
    super("Barkod henüz oluşmadı");
    this.name = "LabelBarcodeMissingError";
  }
}

export function labelBarcode(data: ShipmentPrintData) {
  const value = (data.barcode_value ?? data.barcode_number ?? data.tracking_number ?? "").trim();
  if (!value) throw new LabelBarcodeMissingError();
  return value;
}

export function providerLabel(provider: string) {
  const normalized = provider.toLocaleLowerCase("tr-TR");
  if (normalized.includes("sürat") || normalized.includes("surat")) return "Sürat Kargo";
  if (normalized.includes("ptt")) return "PTT Kargo";
  return provider || "Kargo";
}

function paymentLabel(paymentType: string | null) {
  return paymentType === "cash_on_delivery" ? "KARŞI ÖDEMELİ" : "ÖDEMELİ DEĞİL (PEŞİN)";
}

function joinParts(...parts: Array<string | null | undefined>) {
  return parts.filter((part) => part && part.trim()).join(" / ");
}

function itemsSummary(data: ShipmentPrintData) {
  return data.items.map((item) => `${item.quantity} x ${item.name}`).join(", ");
}

const mm = (value: number) => (value * 72) / 25.4;

export function renderLabelPdf(data: ShipmentPrintData, sender: DocumentSender): Buffer {
  const barcode = labelBarcode(data);
  const doc = new PdfDocument({ title: `Kargo etiketi ${barcode}`, author: sender.name });
  const page = doc.addPage(mm(100), mm(150));
  const left = mm(5);
  const right = page.width - mm(5);
  const width = right - left;
  let y = mm(10);

  page.text(left, y, providerLabel(data.provider), { size: 16, font: "bold" });
  page.text(right, y, paymentLabel(data.payment_type), { size: 8, font: "bold", align: "right" });
  y += mm(3);
  page.line(left, y, right, y, { width: 1.2 });

  y += mm(6);
  page.text(left, y, "GÖNDERİCİ", { size: 7, font: "bold", gray: 0.35 });
  for (const line of [sender.name, joinParts(sender.address, sender.district, sender.city), sender.phone ?? ""].filter(Boolean)) {
    y += mm(4);
    page.text(left, y, fitText(line, "regular", 8, width), { size: 8 });
  }

  y += mm(4);
  page.line(left, y, right, y, { width: 0.4, gray: 0.5 });
  y += mm(6);
  page.text(left, y, "ALICI", { size: 7, font: "bold", gray: 0.35 });
  y += mm(6);
  page.text(left, y, fitText(data.recipient_name, "bold", 13, width), { size: 13, font: "bold" });
  if (data.recipient_phone) {
    y += mm(5);
    page.text(left, y, data.recipient_phone, { size: 10 });
  }
  for (const line of wrapText(data.recipient_address, "regular", 9, width).slice(0, 4)) {
    y += mm(4.5);
    page.text(left, y, line, { size: 9 });
  }
  const place = joinParts(data.recipient_district, data.recipient_city);
  if (place) {
    y += mm(5.5);
    page.text(left, y, place.toLocaleUpperCase("tr-TR"), { size: 11, font: "bold" });
  }

  // Code 128 barcode: quiet zone of 10 modules on both sides, scaled to the label width.
  const modules = code128Modules(barcode);
  const totalModules = modules.reduce((sum, value) => sum + value, 0) + 20;
  const moduleWidth = Math.min(width / totalModules, 1.6);
  const barcodeWidth = moduleWidth * totalModules;
  const barcodeTop = page.height - mm(55);
  const barcodeHeight = mm(22);
  let x = left + (width - barcodeWidth) / 2 + moduleWidth * 10;
  modules.forEach((widthInModules, index) => {
    if (index % 2 === 0) page.rect(x, barcodeTop, widthInModules * moduleWidth, barcodeHeight, { fillGray: 0 });
    x += widthInModules * moduleWidth;
  });
  page.text(page.width / 2, barcodeTop + barcodeHeight + mm(5), barcode, { size: 11, font: "bold", align: "center" });

  let footer = page.height - mm(20);
  page.line(left, footer - mm(5), right, footer - mm(5), { width: 0.4, gray: 0.5 });
  if (data.order_number) {
    page.text(left, footer, `Sipariş: ${data.order_number}`, { size: 9, font: "bold" });
  }
  if (data.tracking_number && data.tracking_number !== barcode) {
    page.text(right, footer, `Takip: ${data.tracking_number}`, { size: 8, align: "right" });
  }
  const items = itemsSummary(data);
  if (items) {
    for (const line of wrapText(items, "regular", 7, width).slice(0, 2)) {
      footer += mm(3.6);
      page.text(left, footer, line, { size: 7, gray: 0.25 });
    }
  }
  return doc.toBuffer();
}

/** ZPL field data: ^ and ~ are command prefixes, so they are replaced; UTF-8 is enabled with ^CI28. */
function zplText(value: string) {
  return value.replace(/[\^~]/g, " ").replace(/\s+/g, " ").trim();
}

export function renderLabelZpl(data: ShipmentPrintData, sender: DocumentSender): string {
  const barcode = labelBarcode(data);
  const lines: string[] = ["^XA", "^CI28", "^PW812", "^LL1218", "^LH0,0"];
  const text = (x: number, y: number, size: number, value: string, maxChars = 40) =>
    lines.push(`^FO${x},${y}^A0N,${size},${size}^FD${zplText(value).slice(0, maxChars)}^FS`);
  text(30, 30, 50, providerLabel(data.provider));
  text(470, 40, 26, paymentLabel(data.payment_type), 24);
  lines.push("^FO30,95^GB752,4,4^FS");
  text(30, 115, 22, "GÖNDERİCİ");
  text(30, 145, 26, sender.name, 50);
  text(30, 178, 22, joinParts(sender.address, sender.district, sender.city), 60);
  if (sender.phone) text(30, 206, 22, sender.phone);
  lines.push("^FO30,240^GB752,2,2^FS");
  text(30, 260, 22, "ALICI");
  text(30, 292, 44, data.recipient_name, 30);
  if (data.recipient_phone) text(30, 345, 30, data.recipient_phone);
  lines.push(`^FO30,390^FB752,4,6,L,0^A0N,28,28^FD${zplText(data.recipient_address).slice(0, 220)}^FS`);
  const place = joinParts(data.recipient_district, data.recipient_city);
  if (place) text(30, 530, 38, place.toLocaleUpperCase("tr-TR"), 36);
  lines.push(`^FO60,620^BY3,3,220^BCN,220,Y,N,N^FD${zplText(barcode)}^FS`);
  lines.push("^FO30,960^GB752,2,2^FS");
  if (data.order_number) text(30, 980, 32, `Sipariş: ${data.order_number}`);
  if (data.tracking_number && data.tracking_number !== barcode) text(430, 985, 26, `Takip: ${data.tracking_number}`, 26);
  const items = itemsSummary(data);
  if (items) lines.push(`^FO30,1030^FB752,3,4,L,0^A0N,22,22^FD${zplText(items).slice(0, 180)}^FS`);
  lines.push("^PQ1", "^XZ");
  return `${lines.join("\n")}\n`;
}

/** Word wrap by character count (EPL font 3 is fixed width). */
export function wrapChars(text: string, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ").filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= width || !line) line = candidate.slice(0, width);
    else {
      lines.push(line);
      line = word.slice(0, width);
    }
  }
  if (line) lines.push(line);
  return lines;
}

const asciiMap: Record<string, string> = { ç: "c", Ç: "C", ğ: "g", Ğ: "G", ı: "i", İ: "I", ö: "o", Ö: "O", ş: "s", Ş: "S", ü: "u", Ü: "U" };

/** EPL2 built-in fonts are ASCII only: Turkish letters are transliterated and quotes escaped. */
export function eplText(value: string) {
  return value
    .replace(/[çÇğĞıİöÖşŞüÜ]/g, (char) => asciiMap[char] ?? char)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\s+/g, " ")
    .trim();
}

export function renderLabelEpl(data: ShipmentPrintData, sender: DocumentSender): string {
  const barcode = labelBarcode(data);
  const lines: string[] = ["", "N", "q812", "Q1218,24", "S3", "D10", "ZT"];
  const text = (x: number, y: number, font: number, value: string, maxChars = 40, scale = 1) =>
    lines.push(`A${x},${y},0,${font},${scale},${scale},N,"${eplText(value).slice(0, maxChars)}"`);
  text(30, 30, 5, providerLabel(data.provider), 24);
  text(500, 50, 2, paymentLabel(data.payment_type), 24);
  lines.push("LO30,100,752,4");
  text(30, 120, 2, "GONDERICI");
  text(30, 148, 3, sender.name, 44);
  text(30, 180, 2, joinParts(sender.address, sender.district, sender.city), 60);
  if (sender.phone) text(30, 206, 2, sender.phone);
  lines.push("LO30,240,752,2");
  text(30, 260, 2, "ALICI");
  text(30, 290, 4, data.recipient_name, 30);
  if (data.recipient_phone) text(30, 340, 3, data.recipient_phone);
  wrapChars(eplText(data.recipient_address), 46)
    .slice(0, 4)
    .forEach((line, index) => text(30, 385 + index * 34, 3, line, 46));
  const place = joinParts(data.recipient_district, data.recipient_city);
  if (place) text(30, 530, 4, place.toLocaleUpperCase("tr-TR"), 32);
  lines.push(`B60,620,0,1,3,7,220,B,"${eplText(barcode)}"`);
  lines.push("LO30,960,752,2");
  if (data.order_number) text(30, 980, 4, `Siparis: ${data.order_number}`, 30);
  if (data.tracking_number && data.tracking_number !== barcode) text(430, 990, 3, `Takip: ${data.tracking_number}`, 24);
  const items = itemsSummary(data);
  if (items) text(30, 1040, 2, items, 70);
  lines.push("P1", "");
  return lines.join("\n");
}

export function renderLabel(format: LabelFormat, data: ShipmentPrintData, sender: DocumentSender) {
  const barcode = labelBarcode(data);
  if (format === "pdf") return { body: new Uint8Array(renderLabelPdf(data, sender)), contentType: "application/pdf", filename: `etiket-${barcode}.pdf` };
  if (format === "zpl") return { body: renderLabelZpl(data, sender), contentType: "application/zpl; charset=utf-8", filename: `etiket-${barcode}.zpl` };
  return { body: renderLabelEpl(data, sender), contentType: "application/epl; charset=us-ascii", filename: `etiket-${barcode}.epl` };
}
