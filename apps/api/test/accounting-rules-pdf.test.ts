import { describe, expect, it } from "vitest";
import { fromKurus, invoiceNumberFor, invoiceTotals, lineAmounts, openAmount, sqlDate, statusForPaidTotal, toKurus } from "../src/accounting/rules.js";
import { PdfDocument, encodePdfText, fitText, textWidth, wrapText } from "../src/documents/pdf.js";

describe("accounting money rules", () => {
  it("converts money strings to kuruş and back without float drift", () => {
    expect(toKurus("2125")).toBe(212500);
    expect(toKurus("0.1")).toBe(10);
    expect(toKurus(99.99)).toBe(9999);
    expect(fromKurus(10)).toBe("0.10");
    expect(fromKurus(-505)).toBe("-5.05");
    expect(() => toKurus("1,5")).toThrow();
  });

  it("computes VAT per line with half-up rounding and sums rounded lines", () => {
    const lines = [
      lineAmounts({ quantity: 2, unitPrice: "2125.00", vatRate: 20 }),
      lineAmounts({ quantity: 1.5, unitPrice: "99.99", vatRate: 10 }),
    ];
    expect(lines[1]).toEqual({ lineSubtotal: "149.99", lineVat: "15.00", lineTotal: "164.99" });
    expect(invoiceTotals(lines)).toEqual({ subtotal: "4399.99", vatTotal: "865.00", grandTotal: "5264.99" });
    expect(lineAmounts({ quantity: 3, unitPrice: "0.10", vatRate: 0 })).toEqual({ lineSubtotal: "0.30", lineVat: "0.00", lineTotal: "0.30" });
  });

  it("derives payment status, open amount, invoice numbers and SQL dates", () => {
    expect(statusForPaidTotal("100.00", "0.00")).toBe("issued");
    expect(statusForPaidTotal("100.00", "40.00")).toBe("partially_paid");
    expect(statusForPaidTotal("100.00", "100.00")).toBe("paid");
    expect(openAmount("100.00", "120.00")).toBe("0.00");
    expect(invoiceNumberFor("2026-10-06", 42)).toBe("GK2026000042");
    expect(sqlDate(new Date(2026, 9, 6))).toBe("2026-10-06");
    expect(sqlDate("2026-10-06T00:00:00.000Z")).toBe("2026-10-06");
    expect(sqlDate(null)).toBeNull();
  });
});

describe("PDF writer", () => {
  it("maps Turkish letters onto the base-14 glyph differences", () => {
    expect(encodePdfText("ĞğİıŞş")).toEqual([0x80, 0x81, 0x82, 0x83, 0x84, 0x85]);
    expect(encodePdfText("ÇçÖöÜü")).toEqual([0xc7, 0xe7, 0xd6, 0xf6, 0xdc, 0xfc]);
    expect(encodePdfText("a–b•₺")).toEqual([0x61, 0x96, 0x62, 0x95, 0x3f]);
  });

  it("measures, fits and wraps text with Helvetica metrics", () => {
    expect(textWidth("iii", "regular", 10)).toBeCloseTo(6.66, 2);
    expect(textWidth("W", "bold", 10)).toBeCloseTo(9.44, 2);
    expect(fitText("Çok uzun bir açıklama metni burada", "regular", 10, 60)).toMatch(/\.\.\.$/);
    expect(wrapText("bir iki üç dört beş altı", "regular", 10, 40).length).toBeGreaterThan(1);
  });

  it("writes a parseable PDF with an xref table and the Differences encoding", () => {
    const doc = new PdfDocument({ title: "Fatura" });
    doc.addPage().text(40, 40, "Garanti Kuluçka Ş", { font: "bold" }).line(40, 50, 200, 50).rect(40, 60, 50, 20, { fillGray: 0.9 });
    const pdf = doc.toBuffer().toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("/Differences [128 /Gbreve /gbreve /Idotaccent /dotlessi /Scedilla /scedilla]");
    expect(pdf).toContain("/BaseFont /Helvetica-Bold");
    const xref = Number(/startxref\n(\d+)\n%%EOF/.exec(pdf)?.[1]);
    expect(pdf.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    offsets.forEach((offset, index) => expect(pdf.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true));
  });
});
