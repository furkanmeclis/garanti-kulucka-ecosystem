/**
 * Invoice money rules (legacy FaturaOlusturPage): line prices are VAT-exclusive, VAT is computed per line
 * and rounded to kuruş; totals are the sum of the rounded lines. All arithmetic runs on integer kuruş.
 */

export const invoiceStatuses = ["issued", "partially_paid", "paid", "cancelled"] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];
export const paymentMethods = ["cash", "bank_transfer", "credit_card", "other"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];
export const syncStatuses = ["local", "queued", "synced", "failed"] as const;
export type SyncStatus = (typeof syncStatuses)[number];

export interface InvoiceLineInput {
  quantity: number;
  unitPrice: string;
  vatRate: number;
}

export interface InvoiceLineAmounts {
  lineSubtotal: string;
  lineVat: string;
  lineTotal: string;
}

export function toKurus(value: string | number): number {
  const text = typeof value === "number" ? value.toFixed(2) : value.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) throw new Error(`Invalid money amount: ${value}`);
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  const kurus = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return negative ? -kurus : kurus;
}

export function fromKurus(kurus: number): string {
  const negative = kurus < 0;
  const absolute = Math.abs(kurus);
  return `${negative ? "-" : ""}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

/** Half-up rounding of `kurus * factor` to whole kuruş (factor may be fractional, e.g. a quantity). */
function roundKurus(value: number) {
  return Math.sign(value) * Math.round(Math.abs(value) + Number.EPSILON);
}

export function lineAmounts(line: InvoiceLineInput): InvoiceLineAmounts {
  const subtotal = roundKurus(toKurus(line.unitPrice) * line.quantity);
  const vat = roundKurus((subtotal * line.vatRate) / 100);
  return { lineSubtotal: fromKurus(subtotal), lineVat: fromKurus(vat), lineTotal: fromKurus(subtotal + vat) };
}

export function invoiceTotals(lines: InvoiceLineAmounts[]) {
  const subtotal = lines.reduce((sum, line) => sum + toKurus(line.lineSubtotal), 0);
  const vat = lines.reduce((sum, line) => sum + toKurus(line.lineVat), 0);
  return { subtotal: fromKurus(subtotal), vatTotal: fromKurus(vat), grandTotal: fromKurus(subtotal + vat) };
}

/** Status after a payment: fully paid → paid, some paid → partially_paid, none → issued. */
export function statusForPaidTotal(grandTotal: string, paidTotal: string): InvoiceStatus {
  const paid = toKurus(paidTotal);
  if (paid <= 0) return "issued";
  return paid >= toKurus(grandTotal) ? "paid" : "partially_paid";
}

/** Remaining amount on an invoice (never negative). */
export function openAmount(grandTotal: string, paidTotal: string) {
  return fromKurus(Math.max(0, toKurus(grandTotal) - toKurus(paidTotal)));
}

/** Legacy invoice numbers looked like "GK2026000123": prefix + issue year + 6-digit sequence. */
export function invoiceNumberFor(issueDate: string, sequence: number) {
  return `GK${issueDate.slice(0, 4)}${String(sequence).padStart(6, "0")}`;
}

/** SQL DATE columns come back from node-postgres as a local-midnight Date; normalise to YYYY-MM-DD. */
export function sqlDate(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}
