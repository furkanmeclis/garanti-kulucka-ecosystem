import { describe, expect, it } from "vitest";
import {
  PTT_BARCODE_DEFAULT_RANGE,
  PTT_BARCODE_LIMIT,
  buildPttBarcode,
  calculatePttCheckDigit,
  nextPttBarcode,
  pttSequenceFromBarcode,
  reservePttBarcode,
  type PttBarcodeLedger,
} from "../src/shipments/ptt-barcode.js";
import { calculateShipmentMeasurements, missingRecipientField } from "../src/shipments/repository.js";

/** Legacy server.js hesaplaPttCheckDigit, kept verbatim as the oracle. */
function legacyCheckDigit(barkod12: string) {
  if (!barkod12 || barkod12.length !== 12) return null;
  let toplam = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(barkod12[i] ?? "", 10);
    if (isNaN(digit)) return null;
    toplam += digit * (i % 2 === 0 ? 1 : 3);
  }
  return ((10 - (toplam % 10)) % 10).toString();
}

describe("PTT barcode Mod10 check digit", () => {
  it("matches the legacy algorithm for every sequence in the default range", () => {
    for (let sequence = 0; sequence < 10000; sequence += 1) {
      const barcode12 = `${PTT_BARCODE_DEFAULT_RANGE}${String(sequence).padStart(4, "0")}`;
      expect(calculatePttCheckDigit(barcode12)).toBe(legacyCheckDigit(barcode12));
    }
  });

  it("computes known EAN-13 style digits and rejects malformed input", () => {
    // 2+7*3+9+1*3+7+2*3+7+9*3+0+0*3+0+0*3 = 2+21+9+3+7+6+7+27 = 82 -> 8
    expect(calculatePttCheckDigit("279172790000")).toBe("8");
    expect(buildPttBarcode("27917279", 0)).toBe("2791727900008");
    expect(buildPttBarcode("27917279", 42)).toBe(`279172790042${legacyCheckDigit("279172790042")}`);
    expect(calculatePttCheckDigit("27917279000")).toBeNull();
    expect(calculatePttCheckDigit("27917279000a")).toBeNull();
    expect(() => buildPttBarcode("2791727", 1)).toThrow();
    expect(() => buildPttBarcode("27917279", 10000)).toThrow();
  });
});

describe("PTT barcode sequence allocation", () => {
  it("starts at 0000 for an unused range and continues after the highest used sequence", () => {
    expect(nextPttBarcode("27917279", -1)).toMatchObject({ sequence: 0, barcode: "2791727900008" });
    const next = nextPttBarcode("27917279", 41);
    expect(next?.sequence).toBe(42);
    expect(pttSequenceFromBarcode("27917279", next?.barcode)).toBe(42);
    expect(pttSequenceFromBarcode("27917279", "PTT-1700000000")).toBeNull();
  });

  it("honours batch-reserved barcodes like legacy batchKullanilan", () => {
    const used = [buildPttBarcode("27917279", 10), buildPttBarcode("27917279", 12)];
    expect(nextPttBarcode("27917279", 5, used)?.sequence).toBe(13);
  });

  it("keeps the last 10 sequences as reserve and reports the pool as exhausted", () => {
    expect(PTT_BARCODE_LIMIT).toBe(9990);
    expect(nextPttBarcode("27917279", 9988)?.sequence).toBe(9989);
    expect(nextPttBarcode("27917279", 9989)).toBeNull();
    expect(nextPttBarcode("27917279", 9999)).toBeNull();
  });

  it("never hands out the same barcode to concurrent creates while the range lock is held", async () => {
    const stored: string[] = [];
    let chain = Promise.resolve();
    const ledger: PttBarcodeLedger<string[]> = {
      // Mutex per range, released only after the callback (the shipment insert) finished: same contract as
      // pg_advisory_xact_lock held until the shipment transaction commits.
      withRangeLock: (_range, callback) => {
        const run = chain.then(() => callback(stored));
        chain = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      },
      highestSequence: async (rows, range) => {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 3));
        return rows.reduce((max, barcode) => Math.max(max, pttSequenceFromBarcode(range, barcode) ?? -1), -1);
      },
    };

    const results = await Promise.all(
      Array.from({ length: 40 }, () =>
        reservePttBarcode(ledger, "27917279", async (rows, reservation) => {
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 3));
          if (reservation) rows.push(reservation.barcode);
          return reservation?.barcode ?? null;
        }),
      ),
    );

    expect(new Set(results).size).toBe(40);
    expect(results.map((barcode) => pttSequenceFromBarcode("27917279", barcode)).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
      Array.from({ length: 40 }, (_, index) => index),
    );
  });

  it("would duplicate barcodes without the lock (guards the test above)", async () => {
    const stored: string[] = [];
    const unlocked: PttBarcodeLedger<string[]> = {
      withRangeLock: (_range, callback) => callback(stored),
      highestSequence: async (rows, range) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return rows.reduce((max, barcode) => Math.max(max, pttSequenceFromBarcode(range, barcode) ?? -1), -1);
      },
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        reservePttBarcode(unlocked, "27917279", async (rows, reservation) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          if (reservation) rows.push(reservation.barcode);
          return reservation?.barcode;
        }),
      ),
    );
    expect(new Set(results).size).toBeLessThan(5);
  });
});

describe("legacy kargo create helpers", () => {
  it("computes weight/desi like legacy _kargoOlusturInternal", () => {
    const items = [
      { name: "48'li Kuluçka Makinesi", quantity: 2 },
      { name: "Yedek fan", quantity: 3 },
    ];
    expect(calculateShipmentMeasurements(items, "ptt")).toEqual({ weight_kg: 4, desi: 33 });
    expect(calculateShipmentMeasurements(items, "surat")).toEqual({ weight_kg: 4, desi: 39 });
    expect(calculateShipmentMeasurements([], "ptt")).toEqual({ weight_kg: 1, desi: 1 });
  });

  it("reports the first missing recipient field in legacy order", () => {
    const base = {
      recipient_name: "Ayşe",
      recipient_phone: "5551112233",
      recipient_address: "Atatürk Cad. 1",
      recipient_city: "İzmir",
      recipient_district: "Bornova",
      order_number: "ORD-1",
    };
    expect(missingRecipientField(base)).toBeNull();
    expect(missingRecipientField({ ...base, recipient_phone: " " })).toBe("Müşteri telefonu eksik (ORD-1)");
    expect(missingRecipientField({ ...base, recipient_city: null, recipient_district: null })).toBe("İl bilgisi eksik (ORD-1)");
    expect(missingRecipientField({ ...base, recipient_district: "" })).toBe("İlçe bilgisi eksik (ORD-1)");
  });
});
