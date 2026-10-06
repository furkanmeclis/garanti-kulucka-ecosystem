import { PdfDocument, fitText, wrapText } from "../documents/pdf.js";
import type { InvoiceDetailRecord } from "./repository.js";
import { openAmount, sqlDate } from "./rules.js";

/** Seller block printed on invoices (global settings `gonderici_*`, the same values the cargo label uses). */
export interface InvoiceIssuer {
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
}

const statusLabels: Record<string, string> = {
  issued: "Düzenlendi",
  partially_paid: "Kısmen tahsil edildi",
  paid: "Tahsil edildi",
  cancelled: "İptal",
};

const methodLabels: Record<string, string> = {
  cash: "Nakit",
  bank_transfer: "Havale / EFT",
  credit_card: "Kredi kartı",
  other: "Diğer",
};

export function formatMoneyTr(value: string, currency: string) {
  const amount = Number(value);
  const formatted = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  return `${formatted} ${currency === "TRY" ? "TL" : currency}`;
}

function formatDateTr(value: Date | string | null) {
  const date = sqlDate(value);
  if (!date) return "-";
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}`;
}

function formatQuantity(value: string) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 }).format(Number(value));
}

function escapeHtml(value: string | null | undefined) {
  return (value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function contactLines(detail: InvoiceDetailRecord) {
  const contact = detail.contact;
  return [
    contact.name,
    [contact.address_line, contact.district, contact.city].filter(Boolean).join(", "),
    contact.tax_number ? `${contact.contact_type === "corporate" ? "VKN" : "TCKN"}: ${contact.tax_number}${contact.tax_office ? ` / ${contact.tax_office}` : ""}` : "",
    [contact.phone, contact.email].filter(Boolean).join(" · "),
  ].filter((line) => line.trim());
}

function issuerLines(issuer: InvoiceIssuer) {
  return [issuer.name, [issuer.address, issuer.district, issuer.city].filter(Boolean).join(", "), issuer.phone ?? ""].filter((line) => line.trim());
}

/** Printable invoice (A4). Opened in a new tab, the browser's print dialog also saves it as PDF. */
export function renderInvoiceHtml(detail: InvoiceDetailRecord, issuer: InvoiceIssuer) {
  const { invoice } = detail;
  const rows = detail.items
    .map(
      (item, index) => `<tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item.description)}</td>
        <td class="num">${escapeHtml(formatQuantity(item.quantity))} ${escapeHtml(item.unit)}</td>
        <td class="num">${escapeHtml(formatMoneyTr(item.unit_price, invoice.currency))}</td>
        <td class="num">%${escapeHtml(formatQuantity(item.vat_rate))}</td>
        <td class="num">${escapeHtml(formatMoneyTr(item.line_vat, invoice.currency))}</td>
        <td class="num">${escapeHtml(formatMoneyTr(item.line_total, invoice.currency))}</td>
      </tr>`,
    )
    .join("");
  const payments = detail.payments
    .map(
      (payment) => `<tr><td>${escapeHtml(formatDateTr(payment.paid_at))}</td><td>${escapeHtml(methodLabels[payment.method] ?? payment.method)}</td><td class="num">${escapeHtml(formatMoneyTr(payment.amount, invoice.currency))}</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fatura ${escapeHtml(invoice.invoice_number)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f172a; background: #fff; }
  .sheet { max-width: 820px; margin: 0 auto; }
  header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px; border-bottom: 2px solid #0f172a; padding-bottom: 12px; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .muted { color: #475569; }
  .parties { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin: 16px 0; }
  .box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px 12px; }
  .box h2 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; color: #475569; letter-spacing: .04em; }
  .box p { margin: 0; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 7px 8px; border-bottom: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-size: 11px; text-transform: uppercase; color: #334155; }
  .num { text-align: right; white-space: nowrap; }
  .totals { margin-left: auto; margin-top: 12px; width: min(100%, 320px); }
  .totals td { border: 0; padding: 4px 8px; }
  .totals tr.grand td { border-top: 2px solid #0f172a; font-weight: 700; font-size: 15px; }
  .status { display: inline-block; border: 1px solid #94a3b8; border-radius: 999px; padding: 1px 10px; font-size: 12px; }
  .toolbar { display: flex; gap: 8px; justify-content: flex-end; margin-bottom: 12px; }
  .toolbar button { min-height: 44px; padding: 0 16px; border: 1px solid #0f172a; border-radius: 6px; background: #0f172a; color: #fff; font: inherit; cursor: pointer; }
  @media print { body { padding: 0; } .toolbar { display: none; } }
</style>
</head>
<body>
<main class="sheet" data-testid="invoice-document">
  <div class="toolbar"><button type="button" onclick="window.print()">Yazdır</button></div>
  <header>
    <div>
      <h1>FATURA</h1>
      <div class="muted">No: <strong data-testid="invoice-document-number">${escapeHtml(invoice.invoice_number)}</strong></div>
      <div class="muted">Tarih: ${escapeHtml(formatDateTr(invoice.issue_date))}${invoice.due_date ? ` · Vade: ${escapeHtml(formatDateTr(invoice.due_date))}` : ""}</div>
      ${invoice.order_number ? `<div class="muted">Sipariş: ${escapeHtml(invoice.order_number)}</div>` : ""}
    </div>
    <div><span class="status">${escapeHtml(statusLabels[invoice.status] ?? invoice.status)}</span></div>
  </header>
  <section class="parties">
    <div class="box"><h2>Satıcı</h2>${issuerLines(issuer).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</div>
    <div class="box"><h2>Alıcı</h2>${contactLines(detail).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</div>
  </section>
  <div class="table-wrap">
    <table>
      <thead><tr><th>#</th><th>Açıklama</th><th class="num">Miktar</th><th class="num">Birim fiyat</th><th class="num">KDV</th><th class="num">KDV tutarı</th><th class="num">Toplam</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <table class="totals">
    <tr><td>Ara toplam</td><td class="num">${escapeHtml(formatMoneyTr(invoice.subtotal, invoice.currency))}</td></tr>
    <tr><td>KDV</td><td class="num">${escapeHtml(formatMoneyTr(invoice.vat_total, invoice.currency))}</td></tr>
    <tr class="grand"><td>Genel toplam</td><td class="num" data-testid="invoice-document-total">${escapeHtml(formatMoneyTr(invoice.grand_total, invoice.currency))}</td></tr>
    <tr><td>Tahsil edilen</td><td class="num">${escapeHtml(formatMoneyTr(invoice.paid_total, invoice.currency))}</td></tr>
    <tr><td>Kalan</td><td class="num">${escapeHtml(formatMoneyTr(openAmount(invoice.grand_total, invoice.paid_total), invoice.currency))}</td></tr>
  </table>
  ${invoice.description ? `<p class="muted">${escapeHtml(invoice.description)}</p>` : ""}
  ${payments ? `<h2>Tahsilatlar</h2><div class="table-wrap"><table><thead><tr><th>Tarih</th><th>Yöntem</th><th class="num">Tutar</th></tr></thead><tbody>${payments}</tbody></table></div>` : ""}
</main>
</body>
</html>`;
}

/** Same invoice as a PDF (A4, base-14 fonts). */
export function renderInvoicePdf(detail: InvoiceDetailRecord, issuer: InvoiceIssuer): Buffer {
  const { invoice } = detail;
  const doc = new PdfDocument({ title: `Fatura ${invoice.invoice_number}`, author: issuer.name });
  const left = 40;
  const right = 555;
  let page = doc.addPage();
  let y = 60;

  page.text(left, y, "FATURA", { size: 20, font: "bold" });
  page.text(right, y - 6, statusLabels[invoice.status] ?? invoice.status, { align: "right", size: 10, gray: 0.3 });
  y += 20;
  page.text(left, y, `No: ${invoice.invoice_number}`, { size: 10, font: "bold" });
  page.text(right, y, `Tarih: ${formatDateTr(invoice.issue_date)}${invoice.due_date ? `   Vade: ${formatDateTr(invoice.due_date)}` : ""}`, { align: "right", size: 10 });
  if (invoice.order_number) {
    y += 14;
    page.text(left, y, `Sipariş: ${invoice.order_number}`, { size: 10, gray: 0.3 });
  }
  y += 12;
  page.line(left, y, right, y, { width: 1.5 });
  y += 22;

  const columnWidth = (right - left - 20) / 2;
  const partyTop = y;
  const drawParty = (x: number, title: string, lines: string[]) => {
    let lineY = partyTop;
    page.text(x, lineY, title, { size: 8, font: "bold", gray: 0.35 });
    for (const line of lines) {
      for (const wrapped of wrapText(line, "regular", 10, columnWidth)) {
        lineY += 14;
        page.text(x, lineY, wrapped, { size: 10 });
      }
    }
    return lineY;
  };
  y = Math.max(drawParty(left, "SATICI", issuerLines(issuer)), drawParty(left + columnWidth + 20, "ALICI", contactLines(detail))) + 26;

  const columns = [
    { title: "#", x: left + 4, align: "left" as const },
    { title: "Açıklama", x: left + 22, align: "left" as const },
    { title: "Miktar", x: 330, align: "right" as const },
    { title: "Birim fiyat", x: 400, align: "right" as const },
    { title: "KDV", x: 435, align: "right" as const },
    { title: "KDV tutarı", x: 490, align: "right" as const },
    { title: "Toplam", x: right - 4, align: "right" as const },
  ];
  const header = () => {
    page.rect(left, y - 12, right - left, 18, { fillGray: 0.93 });
    for (const column of columns) page.text(column.x, y, column.title, { size: 8, font: "bold", align: column.align });
    y += 18;
  };
  header();
  detail.items.forEach((item, index) => {
    if (y > 760) {
      page = doc.addPage();
      y = 60;
      header();
    }
    page.text(columns[0]!.x, y, String(index + 1), { size: 9 });
    page.text(columns[1]!.x, y, fitText(item.description, "regular", 9, 230), { size: 9 });
    page.text(columns[2]!.x, y, `${formatQuantity(item.quantity)} ${item.unit}`, { size: 9, align: "right" });
    page.text(columns[3]!.x, y, formatMoneyTr(item.unit_price, invoice.currency), { size: 9, align: "right" });
    page.text(columns[4]!.x, y, `%${formatQuantity(item.vat_rate)}`, { size: 9, align: "right" });
    page.text(columns[5]!.x, y, formatMoneyTr(item.line_vat, invoice.currency), { size: 9, align: "right" });
    page.text(columns[6]!.x, y, formatMoneyTr(item.line_total, invoice.currency), { size: 9, align: "right" });
    y += 6;
    page.line(left, y, right, y, { width: 0.3, gray: 0.8 });
    y += 14;
  });

  if (y > 700) {
    page = doc.addPage();
    y = 60;
  }
  y += 8;
  const totals: Array<[string, string, boolean]> = [
    ["Ara toplam", formatMoneyTr(invoice.subtotal, invoice.currency), false],
    ["KDV", formatMoneyTr(invoice.vat_total, invoice.currency), false],
    ["Genel toplam", formatMoneyTr(invoice.grand_total, invoice.currency), true],
    ["Tahsil edilen", formatMoneyTr(invoice.paid_total, invoice.currency), false],
    ["Kalan", formatMoneyTr(openAmount(invoice.grand_total, invoice.paid_total), invoice.currency), false],
  ];
  for (const [label, value, strong] of totals) {
    if (strong) page.line(380, y - 11, right, y - 11, { width: 1.2 });
    page.text(390, y, label, { size: strong ? 11 : 10, font: strong ? "bold" : "regular" });
    page.text(right - 4, y, value, { size: strong ? 11 : 10, font: strong ? "bold" : "regular", align: "right" });
    y += strong ? 18 : 15;
  }
  if (invoice.description) {
    y += 10;
    for (const line of wrapText(invoice.description, "regular", 9, right - left)) {
      page.text(left, y, line, { size: 9, gray: 0.3 });
      y += 12;
    }
  }
  return doc.toBuffer();
}
