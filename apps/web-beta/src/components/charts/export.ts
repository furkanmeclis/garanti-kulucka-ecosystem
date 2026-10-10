/** Table export without dependencies: CSV (UTF-8 BOM, `;` so Turkish Excel splits columns) and SpreadsheetML (.xls). */
export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

function csvCell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "number" ? String(value).replace(".", ",") : value;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(rows: readonly T[], columns: ReadonlyArray<ExportColumn<T>>) {
  const lines = [columns.map((column) => csvCell(column.header)).join(";"), ...rows.map((row) => columns.map((column) => csvCell(column.value(row))).join(";"))];
  return `﻿${lines.join("\r\n")}\r\n`;
}

function xml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function toSpreadsheetXml<T>(rows: readonly T[], columns: ReadonlyArray<ExportColumn<T>>, sheetName: string) {
  const cell = (value: string | number | null | undefined) =>
    typeof value === "number" && Number.isFinite(value) ? `<Cell><Data ss:Type="Number">${value}</Data></Cell>` : `<Cell><Data ss:Type="String">${xml(value === null || value === undefined ? "" : String(value))}</Data></Cell>`;
  const header = `<Row>${columns.map((column) => `<Cell ss:StyleID="h"><Data ss:Type="String">${xml(column.header)}</Data></Cell>`).join("")}</Row>`;
  const body = rows.map((row) => `<Row>${columns.map((column) => cell(column.value(row))).join("")}</Row>`).join("");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    '<Styles><Style ss:ID="h"><Font ss:Bold="1"/></Style></Styles>',
    `<Worksheet ss:Name="${xml(sheetName.slice(0, 31) || "Sheet1")}"><Table>${header}${body}</Table></Worksheet>`,
    "</Workbook>",
  ].join("");
}

/** File-name safe slug: "Şehir kırılımı" → "sehir-kirilimi". */
export function exportFileName(title: string, suffix: string, extension: "csv" | "xls") {
  const slug = title
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "rapor"}${suffix ? `-${suffix}` : ""}.${extension}`;
}

export function downloadText(content: string, fileName: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
