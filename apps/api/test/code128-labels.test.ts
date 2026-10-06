import { describe, expect, it } from "vitest";
import { code128Modules, code128Pattern, code128Symbols } from "../src/documents/code128.js";
import { eplText, wrapChars } from "../src/shipments/labels.js";

describe("Code 128 encoder", () => {
  it("has 11-module symbols and a 13-module stop", () => {
    for (let value = 0; value <= 105; value += 1) {
      expect(code128Pattern(value).split("").map(Number).reduce((a, b) => a + b, 0), `symbol ${value}`).toBe(11);
    }
    expect(code128Pattern(106)).toBe("2331112");
    expect(() => code128Pattern(107)).toThrow();
  });

  it("encodes text in code set B with the weighted mod-103 checksum", () => {
    // Start B (104), P J J 1 2 3 C, checksum, stop.
    const symbols = code128Symbols("PJJ123C");
    expect(symbols.slice(0, 8)).toEqual([104, 48, 42, 42, 17, 18, 19, 35]);
    const expected = (104 + [48, 42, 42, 17, 18, 19, 35].reduce((sum, value, index) => sum + value * (index + 1), 0)) % 103;
    expect(symbols.at(-2)).toBe(expected);
    expect(symbols.at(-1)).toBe(106);
  });

  it("switches to code set C for digit runs and keeps odd digits in B", () => {
    expect(code128Symbols("123456")).toEqual([105, 12, 34, 56, (105 + 12 * 1 + 34 * 2 + 56 * 3) % 103, 106]);
    const mixed = code128Symbols("KP123456789TR");
    expect(mixed.slice(0, 3)).toEqual([104, 43, 48]);
    expect(mixed[3]).toBe(99);
    expect(mixed.slice(4, 8)).toEqual([12, 34, 56, 78]);
    expect(mixed[8]).toBe(100);
    expect(mixed.slice(9, 12)).toEqual([25, 52, 50]);
    expect(code128Modules("A").reduce((a, b) => a + b, 0)).toBe(11 * 3 + 13);
    expect(() => code128Symbols("Ş")).toThrow();
    expect(() => code128Symbols("")).toThrow();
  });
});

describe("thermal label text helpers", () => {
  it("transliterates and escapes EPL text", () => {
    expect(eplText('Şükrü "Ağaçlı" İçin\\')).toBe('Sukru \\"Agacli\\" Icin\\\\');
    expect(eplText("Ünal — ödeme")).toBe("Unal ? odeme");
  });

  it("wraps by character count without splitting words", () => {
    expect(wrapChars("Atatürk Mahallesi Şehit Caddesi No 12", 18)).toEqual(["Atatürk Mahallesi", "Şehit Caddesi No", "12"]);
  });
});
