/**
 * Minimal PDF 1.4 writer for server-rendered documents (invoices, cargo labels). It only uses the
 * built-in Helvetica / Helvetica-Bold fonts, so nothing is embedded. Turkish letters missing from
 * WinAnsiEncoding (Ğ ğ İ ı Ş ş) are mapped through a `/Differences` array onto the standard glyph
 * names every PDF viewer ships with the base-14 fonts.
 */

export type PdfFont = "regular" | "bold";
export type PdfAlign = "left" | "right" | "center";

const turkishCodes: Record<string, { code: number; glyph: string }> = {
  Ğ: { code: 0x80, glyph: "Gbreve" },
  ğ: { code: 0x81, glyph: "gbreve" },
  İ: { code: 0x82, glyph: "Idotaccent" },
  ı: { code: 0x83, glyph: "dotlessi" },
  Ş: { code: 0x84, glyph: "Scedilla" },
  ş: { code: 0x85, glyph: "scedilla" },
};

/** cp1252 punctuation outside Latin-1 that commonly shows up in documents (0x80-0x85 hold the Turkish glyphs). */
const cp1252Extras: Record<string, number> = {
  "–": 0x96,
  "—": 0x97,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
};

const differences = `[${Object.values(turkishCodes)
  .sort((a, b) => a.code - b.code)
  .map((entry, index) => (index === 0 ? `${entry.code} /${entry.glyph}` : `/${entry.glyph}`))
  .join(" ")}]`;

/** Encodes text to the font's single-byte encoding; unsupported characters become "?". */
export function encodePdfText(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text.normalize("NFC")) {
    const turkish = turkishCodes[char];
    if (turkish) {
      bytes.push(turkish.code);
      continue;
    }
    if (char === "…") {
      bytes.push(0x2e, 0x2e, 0x2e);
      continue;
    }
    const extra = cp1252Extras[char];
    if (extra !== undefined) {
      bytes.push(extra);
      continue;
    }
    const code = char.codePointAt(0) ?? 0x3f;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) bytes.push(code);
    else if (code === 0x09) bytes.push(0x20);
    else bytes.push(0x3f);
  }
  return bytes;
}

// Helvetica / Helvetica-Bold advance widths (1/1000 em) for ASCII 32..126 from the base-14 AFM files.
const regularWidths = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const boldWidths = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611,
  611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Accented letters use the width of their base letter (the base-14 AFMs agree for all of them). */
function baseLetter(char: string) {
  if (char === "ı") return "i";
  if (char === "İ") return "I";
  return char.normalize("NFD").replace(/[̀-ͯ]/g, "") || char;
}

export function textWidth(text: string, font: PdfFont, size: number) {
  const widths = font === "bold" ? boldWidths : regularWidths;
  let total = 0;
  for (const char of text) {
    const base = baseLetter(char);
    const code = base.charCodeAt(0);
    total += code >= 32 && code <= 126 ? widths[code - 32] ?? 556 : 556;
  }
  return (total * size) / 1000;
}

/** Cuts `text` to fit `maxWidth`, adding "..." when it had to shorten it. */
export function fitText(text: string, font: PdfFont, size: number, maxWidth: number) {
  if (textWidth(text, font, size) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 0 && textWidth(`${cut}...`, font, size) > maxWidth) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}...`;
}

/** Greedy word wrap into lines no wider than `maxWidth`. */
export function wrapText(text: string, font: PdfFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, font, size) <= maxWidth || !line) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function hex(bytes: number[]) {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function num(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export class PdfPage {
  readonly operations: string[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  /** Draws text with its baseline at `y` measured from the top of the page. */
  text(x: number, y: number, value: string, options: { size?: number; font?: PdfFont; align?: PdfAlign; gray?: number } = {}) {
    const size = options.size ?? 10;
    const font = options.font ?? "regular";
    const width = textWidth(value, font, size);
    const left = options.align === "right" ? x - width : options.align === "center" ? x - width / 2 : x;
    const color = options.gray !== undefined ? `${num(options.gray)} g ` : "0 g ";
    this.operations.push(`BT ${color}/${font === "bold" ? "F2" : "F1"} ${num(size)} Tf ${num(left)} ${num(this.height - y)} Td <${hex(encodePdfText(value))}> Tj ET`);
    return this;
  }

  line(x1: number, y1: number, x2: number, y2: number, options: { width?: number; gray?: number } = {}) {
    this.operations.push(`${num(options.gray ?? 0)} G ${num(options.width ?? 0.5)} w ${num(x1)} ${num(this.height - y1)} m ${num(x2)} ${num(this.height - y2)} l S`);
    return this;
  }

  /** Rectangle with its top-left corner at (x, y). */
  rect(x: number, y: number, width: number, height: number, options: { fillGray?: number; strokeGray?: number; lineWidth?: number } = {}) {
    const box = `${num(x)} ${num(this.height - y - height)} ${num(width)} ${num(height)} re`;
    if (options.fillGray !== undefined) this.operations.push(`${num(options.fillGray)} g ${box} f`);
    if (options.strokeGray !== undefined) this.operations.push(`${num(options.strokeGray)} G ${num(options.lineWidth ?? 0.5)} w ${box} S`);
    return this;
  }
}

export class PdfDocument {
  private readonly pages: PdfPage[] = [];

  constructor(private readonly info: { title?: string; author?: string } = {}) {}

  /** A4 portrait by default (points). */
  addPage(width = 595.28, height = 841.89) {
    const page = new PdfPage(width, height);
    this.pages.push(page);
    return page;
  }

  toBuffer(): Buffer {
    if (this.pages.length === 0) this.addPage();
    const objects: string[] = [];
    const add = (body: string) => {
      objects.push(body);
      return objects.length;
    };
    const fontEncoding = `<< /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences ${differences} >>`;
    const regular = add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding ${fontEncoding} >>`);
    const bold = add(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding ${fontEncoding} >>`);
    const pagesId = objects.length + 1;
    objects.push("");
    const pageIds: number[] = [];
    for (const page of this.pages) {
      const content = page.operations.join("\n");
      const contentId = add(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
      pageIds.push(
        add(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${contentId} 0 R >>`,
        ),
      );
    }
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
    const infoEntries = [
      this.info.title ? `/Title <FEFF${Buffer.from(this.info.title, "utf16le").swap16().toString("hex")}>` : "",
      this.info.author ? `/Author <FEFF${Buffer.from(this.info.author, "utf16le").swap16().toString("hex")}>` : "",
      "/Producer (Garanti Kulucka)",
    ].filter(Boolean);
    const infoId = add(`<< ${infoEntries.join(" ")} >>`);
    const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

    let output = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
    const offsets: number[] = [];
    objects.forEach((body, index) => {
      offsets.push(Buffer.byteLength(output, "latin1"));
      output += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(output, "latin1");
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) output += `${String(offset).padStart(10, "0")} 00000 n \n`;
    output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(output, "latin1");
  }
}
