import type { AppDatabase } from "@garanti-kulucka/database";
import type { ProviderRequestEnvelope } from "@garanti-kulucka/shared";

/**
 * Writes the results of live PTT / Sürat calls back to the shipment row (legacy server.js updated
 * `kargo_gonderimleri.takip_no / durum / son_hareket` right after the carrier answered):
 * - `shipment.create` → the carrier's tracking number (PTT barkod / Sürat KargoTakipNo)
 * - `shipment.track`  → canonical status, last event text and delivered_at / shipped_at
 * Dry runs never reach this code (only results with `live_call_performed: true`).
 */

export interface ShipmentWriteback {
  shipmentPublicId: string;
  trackingNumber: string | null;
  status: string | null;
  lastEventText: string | null;
}

export interface ShipmentWritebackRepository {
  apply: (update: ShipmentWriteback) => Promise<boolean>;
}

// Legacy kargo durum codes (and the PTT/Sürat adapters' outputs) → canonical shipment statuses.
const statusAliases: Record<string, string> = {
  olusturuldu: "created",
  beklemede: "created",
  hazirlaniyor: "preparing",
  kargoya_verildi: "shipped",
  sevk_edildi: "shipped",
  yolda: "in_transit",
  dagitimda: "out_for_delivery",
  teslim_edildi: "delivered",
  iptal: "cancelled",
  iade: "returned",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function canonicalShipmentStatus(value: unknown): string | null {
  const raw = text(value)?.toLocaleLowerCase("tr-TR");
  if (!raw) return null;
  return statusAliases[raw] ?? (Object.values(statusAliases).includes(raw) ? raw : null);
}

function pttLastEvent(payload: Record<string, unknown>) {
  const movements = Array.isArray(payload.hareketler) ? payload.hareketler.filter(isRecord) : [];
  const last = movements.at(-1);
  const description = last ? text(last.islem ?? last.aciklama ?? last.olay) : null;
  const place = last ? text(last.yer ?? last.merkez ?? last.islemYeri) : null;
  if (description) return place ? `${description} — ${place}` : description;
  return text(payload.durum);
}

/** Maps a successful live response to the shipment update; null when there is nothing to write. */
export function shipmentWritebackFrom(envelope: ProviderRequestEnvelope, response: Record<string, unknown> | null | undefined): ShipmentWriteback | null {
  if (!response || (envelope.provider !== "ptt" && envelope.provider !== "surat")) return null;
  if (envelope.operation !== "shipment.create" && envelope.operation !== "shipment.track") return null;
  const shipmentPublicId = text(envelope.payload.shipment_public_id);
  if (!shipmentPublicId) return null;

  if (envelope.provider === "ptt") {
    if (envelope.operation === "shipment.create") {
      // The adapter falls back to "PTT-<timestamp>" when the barcode could not be parsed: never store that.
      const tracking = response.barkodParseFailed === true ? null : text(response.takipNo ?? response.barkodNo);
      return tracking ? { shipmentPublicId, trackingNumber: tracking, status: null, lastEventText: null } : null;
    }
    const status = canonicalShipmentStatus(response.shipment_status);
    const lastEventText = pttLastEvent(response);
    const tracking = text(response.barkodNo);
    if (!status && !lastEventText && !tracking) return null;
    return { shipmentPublicId, trackingNumber: tracking, status, lastEventText };
  }

  const data = isRecord(response.data) ? response.data : response;
  if (envelope.operation === "shipment.create") {
    const tracking = text(data.kargoTakipNo ?? data.ozelKargoTakipNo);
    return tracking ? { shipmentPublicId, trackingNumber: tracking, status: null, lastEventText: null } : null;
  }
  const shipments = Array.isArray(data.gonderiler) ? data.gonderiler.filter(isRecord) : [];
  const shipment = shipments[0];
  if (!shipment) return null;
  const lastMovement = isRecord(shipment.sonHareket) ? shipment.sonHareket : null;
  const lastEventText = text(lastMovement?.metin ?? lastMovement?.aciklama ?? shipment.sonHareket) ?? text(shipment.kargonunDurumu);
  const status = canonicalShipmentStatus(shipment.shipment_status);
  const tracking = text(shipment.kargoTakipNo);
  if (!status && !lastEventText && !tracking) return null;
  return { shipmentPublicId, trackingNumber: tracking, status, lastEventText };
}

export class DatabaseShipmentWritebackRepository implements ShipmentWritebackRepository {
  constructor(private readonly db: AppDatabase) {}

  async apply(update: ShipmentWriteback): Promise<boolean> {
    const now = new Date();
    const result = await this.db
      .updateTable("shipments")
      .set((eb) => ({
        ...(update.trackingNumber ? { tracking_number: update.trackingNumber } : {}),
        ...(update.status ? { status: update.status } : {}),
        ...(update.lastEventText ? { last_event_text: update.lastEventText } : {}),
        ...(update.status === "delivered" ? { delivered_at: eb.fn.coalesce("delivered_at", eb.val(now)) } : {}),
        ...(update.status && update.status !== "created" && update.status !== "preparing" ? { shipped_at: eb.fn.coalesce("shipped_at", eb.val(now)) } : {}),
        updated_at: now,
      }))
      .where("public_id", "=", update.shipmentPublicId)
      // Terminal states set by staff (cancelled / returned) are not overwritten by a late carrier answer.
      .where("status", "not in", ["cancelled", "returned"])
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0) > 0;
  }
}
