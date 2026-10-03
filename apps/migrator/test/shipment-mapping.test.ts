import { describe, expect, it } from "vitest";
import { calculateSourcePayloadChecksum } from "../src/legacy-source.js";
import { transformLegacyShipment, type ShipmentTransformContext } from "../src/shipment-mapping.js";
import type { LegacyRecord } from "../src/types.js";

const shipmentId = "c1000000-0000-4000-8000-000000000001";
const customerId = "0a32ce63-4c3b-4fd4-917d-726d540a7216";
const customerPublicId = "cus_0123456789abcdef01234567";
const secretName = "Gizli Alici Alpha";
const secretPhone = "+90 555 000 00 01";
const secretTracking = "TRK-SECRET-4242";

function context(overrides: Partial<ShipmentTransformContext> = {}): ShipmentTransformContext {
  return {
    customerPublicIds: new Map([[customerId, customerPublicId]]),
    ...overrides,
  };
}

function fixture(overrides: Record<string, unknown> = {}, recordOverrides: Partial<LegacyRecord> = {}): LegacyRecord {
  const payload = {
    id: shipmentId,
    musteri_id: customerId.toUpperCase(),
    kargo_firmasi: "Sürat Kargo",
    takip_no: " TRK-123 ",
    barkod_url: " https://cdn.example.test/barcode.pdf ",
    alici_ad: "  Ayşe Yılmaz  ",
    alici_telefon: "  +90 532 111 22 33  ",
    alici_adres: "  Atatürk Cad. 1  ",
    alici_il: "  İstanbul  ",
    alici_ilce: "  Kadıköy  ",
    alici_posta_kodu: "  34710  ",
    gonderi_tipi: "standart",
    agirlik: "1.5",
    desi: null,
    ucret: 99.5,
    odeme_tipi: "gonderici",
    durum: "yolda",
    notlar: "  Kapıda bırakılsın  ",
    olusturan_id: null,
    olusturma_tarihi: "2024-01-02T03:04:05+03:00",
    guncelleme_tarihi: null,
    alici_email: null,
    kargo_turu: null,
    tasima_sekli: null,
    teslim_sekli: null,
    adet: 1,
    kapida_odeme_tutari: null,
    kargo_icerigi: "yedek parca",
    son_hareket: "  Transfer merkezinde  ",
    son_hareket_tarihi: "2024-01-03T03:04:05+03:00",
    surat_web_siparis_kodu: " web-1 ",
    surat_kargo_takip_no: " surat-trk-1 ",
    surat_hesap_tipi: "standart",
    surat_barkod_no: " barcode-1 ",
    ...overrides,
  };
  const sourceId = Object.hasOwn(overrides, "id")
    ? canonicalUuid(overrides.id)
    : shipmentId.toLowerCase();
  return {
    sourceSystem: "legacy_supabase",
    sourceTable: "public.kargo_gonderimleri",
    sourceId,
    checksum: calculateSourcePayloadChecksum(payload),
    payload,
    ...recordOverrides,
  };
}

function canonicalUuid(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "invalid-id";
}

function captureError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected operation to throw");
}

describe("transformLegacyShipment", () => {
  it("maps a legacy kargo_gonderimleri row onto a shipment draft and preserves raw payload details", () => {
    const result = transformLegacyShipment(fixture(), context());

    expect(result.sourcePayloadChecksum).toBe(fixture().checksum);
    expect(result.reconciliation).toEqual([]);
    expect(result.shipment).toMatchObject({
      kind: "legacy_shipment_draft",
      targetTable: "shipments",
      publicId: expect.stringMatching(/^shp_[0-9a-f]{24}$/),
      mappingRole: "primary",
      orderPublicId: null,
      customerPublicId,
      provider: "surat",
      trackingNumber: "TRK-123",
      barcodeNumber: "barcode-1",
      status: "in_transit",
      recipientName: "Ayşe Yılmaz",
      recipientPhone: "+90 532 111 22 33",
      recipientAddress: "Atatürk Cad. 1",
      recipientCity: "İstanbul",
      recipientDistrict: "Kadıköy",
      lastEventText: "Transfer merkezinde",
      shippedAt: null,
      deliveredAt: null,
      legacyTimestamps: {
        createdAt: "2024-01-02T00:04:05.000000Z",
        updatedAt: null,
        lastEventAt: "2024-01-03T00:04:05.000000Z",
      },
    });
    expect(result.shipment.rawPayload).toMatchObject({
      barkod_url: "https://cdn.example.test/barcode.pdf",
      agirlik: "1.5",
      ucret: "99.5",
      adet: 1,
      surat_web_siparis_kodu: "web-1",
    });
    expect(transformLegacyShipment(fixture(), context()).shipment.publicId).toBe(result.shipment.publicId);
  });

  it.each([
    ["ptt", "ptt"],
    ["PTT KARGO", "ptt"],
    ["manuel", "manual"],
    ["Sürat Kargo", "surat"],
  ] as const)("maps kargo_firmasi %j to provider %s", (kargoFirmasi, provider) => {
    expect(transformLegacyShipment(fixture({ kargo_firmasi: kargoFirmasi }), context()).shipment.provider)
      .toBe(provider);
  });

  it.each([
    [null, "created"],
    ["beklemede", "created"],
    ["teslim_edildi", "delivered"],
    ["iptal", "cancelled"],
  ] as const)("maps durum %j to status %s", (durum, status) => {
    expect(transformLegacyShipment(fixture({ durum }), context()).shipment.status).toBe(status);
  });

  it("records unresolved customer reconciliation instead of inventing a customer link", () => {
    const result = transformLegacyShipment(fixture(), context({ customerPublicIds: new Map() }));
    expect(result.shipment.customerPublicId).toBeNull();
    expect(result.reconciliation).toEqual([
      { code: "unresolved_customer", legacyCustomerId: customerId },
    ]);
  });

  it("uses Surat tracking number when takip_no is blank", () => {
    const result = transformLegacyShipment(fixture({ takip_no: " ", surat_kargo_takip_no: " surat-fallback " }), context());
    expect(result.shipment.trackingNumber).toBe("surat-fallback");
  });

  it("fails closed for unsupported provider or status", () => {
    expect(() => transformLegacyShipment(fixture({ kargo_firmasi: "aras" }), context())).toThrow(
      "Invalid legacy shipment row: field kargo_firmasi has an unsupported value",
    );
    expect(() => transformLegacyShipment(fixture({ durum: "bilinmeyen" }), context())).toThrow(
      "Invalid legacy shipment row: field durum has an unsupported value",
    );
  });

  it("fails when the source payload checksum does not match", () => {
    const record = fixture();
    record.payload.alici_ad = "changed-after-read";
    expect(() => transformLegacyShipment(record, context())).toThrow(
      "Invalid legacy shipment row: source payload checksum does not match payload",
    );
  });

  it("does not echo recipient or tracking secrets in row errors", () => {
    const errors = [
      captureError(() => transformLegacyShipment(fixture({
        alici_ad: secretName,
        alici_telefon: secretPhone,
        takip_no: secretTracking,
        durum: secretTracking,
      }), context())),
      captureError(() => transformLegacyShipment(fixture({
        alici_ad: secretName,
        alici_telefon: secretPhone,
        gizli: secretName,
      }), context())),
    ];
    for (const error of errors) {
      expect(error.message).toMatch(/^Invalid legacy shipment row: /);
      expect(error.message).not.toContain(secretName);
      expect(error.message).not.toContain(secretPhone);
      expect(error.message).not.toContain(secretTracking);
    }
  });
});
