/**
 * Code 128 encoder for printed cargo labels (the PTT/Sürat barcodes are numeric or short alphanumeric).
 * Digit runs of 4+ use code set C (two digits per symbol); everything else uses code set B.
 * Returns module widths (bar, space, bar, …) including the quiet-zone-free start/stop symbols.
 */

// Symbol values 0..106 as bar/space module widths (106 = stop, 7 elements).
const patterns = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
] as const;

const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;
const STOP = 106;

export function code128Pattern(value: number): string {
  const pattern = patterns[value];
  if (!pattern) throw new Error(`Invalid Code 128 symbol: ${value}`);
  return pattern;
}

/** Symbol values (start … data … checksum, stop) for `text`; only printable ASCII is supported. */
export function code128Symbols(text: string): number[] {
  if (!text) throw new Error("Barcode text is empty");
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 126) throw new Error(`Code 128 cannot encode "${char}"`);
  }

  const symbols: number[] = [];
  let set: "B" | "C" | null = null;
  let index = 0;
  const digitRun = (from: number) => {
    let end = from;
    while (end < text.length && /\d/.test(text[end]!)) end += 1;
    return end - from;
  };

  while (index < text.length) {
    const run = digitRun(index);
    // Code C pays off for 4+ digits (or a whole all-digit even value); keep an odd leading digit in B.
    const useC = run >= 4 || (index === 0 && run === text.length && run % 2 === 0 && run >= 2);
    if (useC) {
      const pairs = Math.floor(run / 2) * 2;
      if (set !== "C") {
        symbols.push(set === null ? START_C : CODE_C);
        set = "C";
      }
      for (let offset = 0; offset < pairs; offset += 2) symbols.push(Number(text.slice(index + offset, index + offset + 2)));
      index += pairs;
      continue;
    }
    if (set !== "B") {
      symbols.push(set === null ? START_B : CODE_B);
      set = "B";
    }
    symbols.push(text.charCodeAt(index) - 32);
    index += 1;
  }

  const checksum = symbols.reduce((sum, value, position) => sum + value * (position === 0 ? 1 : position), 0) % 103;
  symbols.push(checksum, STOP);
  return symbols;
}

/** Bar/space widths in modules, alternating bar first. */
export function code128Modules(text: string): number[] {
  return code128Symbols(text).flatMap((symbol) => code128Pattern(symbol).split("").map(Number));
}
