/**
 * PTT barcode allocation reproduced from legacy server.js (`hesaplaPttCheckDigit`, `uretPttBarkod`,
 * `enYuksekPttBarkodSirasiGetir`): barcode = range(8) + sequence(4) + Mod10 check digit (EAN-13 style,
 * weights 1/3). The next sequence is the highest used sequence in the range + 1; the last 10 sequences
 * are a reserve (`PTT_BARKOD_LIMIT = 9990`) and the pool is reported as exhausted from there on, in which
 * case legacy sends no barkodNo and lets PTT assign one.
 */

export const PTT_BARCODE_DEFAULT_RANGE = "27917279";
export const PTT_BARCODE_LIMIT = 9990;
export const PTT_BARCODE_POOL_SIZE = 10000;

export function calculatePttCheckDigit(barcode12: string): string | null {
  if (!/^\d{12}$/.test(barcode12)) {
    return null;
  }
  let total = 0;
  for (let index = 0; index < 12; index += 1) {
    total += Number.parseInt(barcode12[index] ?? "0", 10) * (index % 2 === 0 ? 1 : 3);
  }
  return String((10 - (total % 10)) % 10);
}

export function isValidPttBarcodeRange(range: string): boolean {
  return /^\d{8}$/.test(range);
}

export function buildPttBarcode(range: string, sequence: number): string {
  if (!isValidPttBarcodeRange(range) || !Number.isInteger(sequence) || sequence < 0 || sequence >= PTT_BARCODE_POOL_SIZE) {
    throw new Error("PTT barcode range and sequence must create 12 digits");
  }
  const barcode12 = `${range}${String(sequence).padStart(4, "0")}`;
  const checkDigit = calculatePttCheckDigit(barcode12);
  if (checkDigit === null) {
    throw new Error("PTT barcode range and sequence must create 12 digits");
  }
  return `${barcode12}${checkDigit}`;
}

export function pttSequenceFromBarcode(range: string, barcode: string | null | undefined): number | null {
  if (!barcode || !barcode.startsWith(range)) return null;
  const sequence = Number.parseInt(barcode.substring(range.length, range.length + 4), 10);
  return Number.isFinite(sequence) ? sequence : null;
}

export interface PttBarcodeReservation {
  barcode: string;
  sequence: number;
  remaining: number;
}

/**
 * Returns the next barcode after `highestSequence` (-1 when the range is unused), or null when the
 * reserve limit is reached. `batchUsed` mirrors legacy `batchKullanilan` for barcodes reserved earlier in
 * the same batch but not yet visible in storage.
 */
export function nextPttBarcode(range: string, highestSequence: number, batchUsed: Iterable<string> = []): PttBarcodeReservation | null {
  let highest = highestSequence;
  for (const barcode of batchUsed) {
    const sequence = pttSequenceFromBarcode(range, barcode);
    if (sequence !== null && sequence > highest) highest = sequence;
  }
  const sequence = highest + 1;
  if (sequence >= PTT_BARCODE_POOL_SIZE || sequence >= PTT_BARCODE_LIMIT) {
    return null;
  }
  return { barcode: buildPttBarcode(range, sequence), sequence, remaining: PTT_BARCODE_LIMIT - sequence - 1 };
}

/**
 * Storage contract used by allocation. `withRangeLock` must hold an exclusive lock for the range until the
 * callback's writes are committed (PostgreSQL: `pg_advisory_xact_lock` inside the shipment insert
 * transaction), so two concurrent creates can never read the same highest sequence.
 */
export interface PttBarcodeLedger<TTx> {
  withRangeLock<T>(range: string, callback: (tx: TTx) => Promise<T>): Promise<T>;
  highestSequence(tx: TTx, range: string): Promise<number>;
}

export async function reservePttBarcode<TTx, T>(
  ledger: PttBarcodeLedger<TTx>,
  range: string,
  persist: (tx: TTx, reservation: PttBarcodeReservation | null) => Promise<T>,
): Promise<T> {
  return ledger.withRangeLock(range, async (tx) => {
    const highest = await ledger.highestSequence(tx, range);
    return persist(tx, nextPttBarcode(range, highest));
  });
}

export function pttBarcodeLockKey(range: string) {
  return `ptt_barcode_range:${range}`;
}
