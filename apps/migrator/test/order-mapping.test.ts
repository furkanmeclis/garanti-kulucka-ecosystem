import { describe, expect, it } from "vitest";
import { transformLegacyOrder, type OrderTransformContext } from "../src/order-mapping.js";
import { calculateSourcePayloadChecksum } from "../src/legacy-source.js";
import type { LegacyRecord } from "../src/types.js";

const orderId = "6F1C2B3A-4D5E-4F60-8172-93A4B5C6D7E8";
const customerId = "0a32ce63-4c3b-4fd4-917d-726d540a7216";
const conversationId = "1A2B3C4D-5E6F-4A7B-8C9D-0E1F2A3B4C5D";
const userId = "b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e";
const customerPublicId = "cus_0123456789abcdef01234567";
const conversationPublicId = "conv_89abcdef0123456789abcdef";
const userPublicId = "usr_agent_1";
const secretPhone = "+90 555 000 00 01";
const secretName = "Gizli Musteri Alpha";
const secretOrderNumber = "GK-SECRET-4242";
const secretKolaybiId = "kb-order-999";
const secretTracking = "TRK-SECRET-555";
const secretCancelReason = "Iptal sebebi gizli";

function orderContext(overrides: Partial<OrderTransformContext> = {}): OrderTransformContext {
  return {
    customerPublicIds: new Map([[customerId, customerPublicId]]),
    conversationPublicIds: new Map([[conversationId.toLowerCase(), conversationPublicId]]),
    userPublicIds: new Map([[userId, userPublicId]]),
    ...overrides,
  };
}

function fixture(overrides: Record<string, unknown> = {}, recordOverrides: Partial<LegacyRecord> = {}): LegacyRecord {
  const payload = {
    id: orderId,
    musteri_id: customerId.toUpperCase(),
    olusturan_id: userId,
    konusma_id: conversationId,
    musteri_ad: "  Ayşe Yılmaz  ",
    musteri_telefon: "  +90 532 111 22 33  ",
    musteri_adres: "  Atatürk Cad. 1  ",
    musteri_il: "  İstanbul  ",
    musteri_ilce: "  Kadıköy  ",
    musteri_posta_kodu: "  34710  ",
    siparis_no: "  GK-1001  ",
    siparis_tipi: "normal",
    durum: "olusturuldu",
    ara_toplam: "100.5",
    kdv_toplam: "18",
    kargo_ucreti: 25,
    genel_toplam: "143.5",
    kargo_takip_no: null,
    kargo_firmasi: null,
    teyit_durumu: "bekliyor",
    teyit_tarihi: null,
    teyit_eden_id: null,
    notlar: "  Kapıda bırakılsın  ",
    iptal_nedeni: null,
    iade_nedeni: null,
    olusturma_tarihi: "2024-01-02T03:04:05+03:00",
    guncelleme_tarihi: new Date("2025-06-07T08:09:10.123Z"),
    kolaybi_siparis_id: " kb-42 ",
    ivr_bulk_id: null,
    ivr_tus: null,
    ivr_arama_durumu: null,
    ivr_arama_tarihi: null,
    kolaybi_contact_id: null,
    kolaybi_address_id: null,
    ivr_dinleme_suresi: null,
    kargo_yazdirildi: null,
    kargo_son_hareket: null,
    kargo_son_hareket_tarihi: null,
    kargoya_aktarilma_tarihi: null,
    efatura_durumu: null,
    sevk_edilme_tarihi: null,
    durum_oncelik: null,
    mukerrer: false,
    teyit_arama_deneme: 0,
    kaynak: "manuel",
    mukerrer_ad: false,
    at_disi: null,
    ...overrides,
  };
  const sourceId = Object.hasOwn(overrides, "id")
    ? canonicalUuid(overrides.id)
    : orderId.toLowerCase();
  return {
    sourceSystem: "legacy_supabase",
    sourceTable: "public.siparisler",
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

describe("transformLegacyOrder", () => {
  it("maps a legacy siparisler row onto an order draft, keeping deferred order type and money parts", () => {
    const result = transformLegacyOrder(fixture(), orderContext());

    expect(result.sourcePayloadChecksum).toBe(fixture().checksum);
    expect(result.reconciliation).toEqual([]);
    expect(result.order).toEqual({
      kind: "legacy_order_draft",
      targetTable: "orders",
      publicId: expect.stringMatching(/^ord_[0-9a-f]{24}$/),
      mappingRole: "primary",
      customerPublicId,
      conversationPublicId,
      createdByUserPublicId: userPublicId,
      orderNumber: "GK-1001",
      status: "created",
      source: "manual",
      orderType: "standard",
      cargoProvider: null,
      totalAmount: "143.50",
      subtotal: "100.50",
      taxTotal: "18.00",
      shippingAmount: "25.00",
      currency: "TRY",
      confirmationStatus: "pending",
      customerName: "Ayşe Yılmaz",
      customerPhone: "+90 532 111 22 33",
      customerAddress: "Atatürk Cad. 1",
      customerCity: "İstanbul",
      customerDistrict: "Kadıköy",
      customerPostalCode: "34710",
      customerCountry: null,
      externalOrderId: "kb-42",
      notes: "Kapıda bırakılsın",
      legacyTimestamps: {
        createdAt: "2024-01-02T00:04:05.000000Z",
        updatedAt: "2025-06-07T08:09:10.123000Z",
      },
      sourceRemainder: {
        id: orderId.toLowerCase(),
        kargo_takip_no: null,
        teyit_tarihi: null,
        teyit_eden_id: null,
        iptal_nedeni: null,
        iade_nedeni: null,
        ivr_bulk_id: null,
        ivr_tus: null,
        ivr_arama_durumu: null,
        ivr_arama_tarihi: null,
        kolaybi_contact_id: null,
        kolaybi_address_id: null,
        ivr_dinleme_suresi: null,
        kargo_yazdirildi: null,
        kargo_son_hareket: null,
        kargo_son_hareket_tarihi: null,
        kargoya_aktarilma_tarihi: null,
        efatura_durumu: null,
        sevk_edilme_tarihi: null,
        durum_oncelik: null,
        mukerrer: false,
        teyit_arama_deneme: 0,
        mukerrer_ad: false,
        at_disi: null,
      },
    });
    expect(Object.isFrozen(result.order.sourceRemainder)).toBe(true);
    expect(result.order).not.toHaveProperty("sourceId");
    expect(transformLegacyOrder(fixture(), orderContext()).order.publicId).toBe(result.order.publicId);
  });

  it.each([
    [null, "created"],
    ["olusturuldu", "created"],
    ["teyit_bekliyor", "awaiting_confirmation"],
    ["teyit_edildi", "confirmed"],
    ["hazirlaniyor", "preparing"],
    ["kargoya_verildi", "shipped"],
    ["sevk_edildi", "dispatched"],
    ["teslim_edildi", "delivered"],
    ["iptal", "cancelled"],
    ["iade", "returned"],
  ] as const)("maps durum %j to status %s", (durum, status) => {
    expect(transformLegacyOrder(fixture({ durum }), orderContext()).order.status).toBe(status);
  });

  it.each(["created", "draft", "OLUSTURULDU", " teyit_bekliyor", "unknown", ""])(
    "fails closed for durum %j",
    (durum) => {
      expect(() => transformLegacyOrder(fixture({ durum }), orderContext())).toThrow(
        "Invalid legacy order row: field durum has an unsupported value",
      );
    },
  );

  it("creates a deterministic synthetic customer when musteri_id is null", () => {
    const result = transformLegacyOrder(fixture({ musteri_id: null }), orderContext());
    expect(result.order.customerPublicId).toMatch(/^cus_[0-9a-f]{24}$/);
    expect(result.customerResolution).toEqual({ path: "synthetic", reason: "unmatched_phone" });
    expect(() => transformLegacyOrder(fixture(), orderContext({ customerPublicIds: new Map() }))).toThrow(
      "Invalid legacy order row: field musteri_id does not resolve to a migrated customer",
    );
  });

  it("keeps a row with an unresolved conversation and records reconciliation", () => {
    const result = transformLegacyOrder(
      fixture({ konusma_id: conversationId.toUpperCase() }),
      orderContext({ conversationPublicIds: new Map() }),
    );
    expect(result.order.conversationPublicId).toBeNull();
    expect(result.reconciliation).toEqual([
      { code: "unresolved_conversation", legacyConversationId: conversationId.toLowerCase() },
    ]);
  });

  it("stores no conversation when konusma_id is null", () => {
    const result = transformLegacyOrder(fixture({ konusma_id: null }), orderContext());
    expect(result.order.conversationPublicId).toBeNull();
    expect(result.reconciliation).toEqual([]);
  });

  it("keeps a row with an unresolved created-by user and records reconciliation", () => {
    const result = transformLegacyOrder(
      fixture({ olusturan_id: userId.toUpperCase() }),
      orderContext({ userPublicIds: new Map() }),
    );
    expect(result.order.createdByUserPublicId).toBeNull();
    expect(result.reconciliation).toEqual([
      { code: "unresolved_created_by", legacyUserId: userId },
    ]);
  });

  it.each([
    ["manuel", "manual"],
    ["panel", "manual"],
    ["ai", "ai"],
    ["webhook", "webhook"],
  ] as const)("maps kaynak %j to source %s", (kaynak, source) => {
    expect(transformLegacyOrder(fixture({ kaynak }), orderContext()).order.source).toBe(source);
  });

  it.each([
    [null, "standard"],
    ["normal", "standard"],
    ["yedek_parca", "spare_part"],
  ] as const)("maps siparis_tipi %j to orderType %s", (siparisTipi, orderType) => {
    expect(transformLegacyOrder(fixture({ siparis_tipi: siparisTipi }), orderContext()).order.orderType)
      .toBe(orderType);
  });

  it.each([
    [null, null],
    ["PTT Kargo", "ptt"],
    ["Sürat Kargo", "surat"],
  ] as const)("maps kargo_firmasi %j to cargoProvider %s", (kargoFirmasi, cargoProvider) => {
    expect(transformLegacyOrder(fixture({ kargo_firmasi: kargoFirmasi }), orderContext()).order.cargoProvider)
      .toBe(cargoProvider);
  });

  it.each([
    [null, null],
    ["bekliyor", "pending"],
    ["teyit_edildi", "confirmed"],
    ["ulasilamadi", "unreachable"],
    ["iptal_istegi", "cancellation_requested"],
    ["gecersiz_numara", "invalid_number"],
  ] as const)("maps teyit_durumu %j to confirmationStatus %s", (teyitDurumu, confirmationStatus) => {
    expect(transformLegacyOrder(fixture({ teyit_durumu: teyitDurumu }), orderContext()).order.confirmationStatus)
      .toBe(confirmationStatus);
  });

  it("defaults null money fields to 0.00", () => {
    const result = transformLegacyOrder(fixture({
      genel_toplam: null,
      ara_toplam: null,
      kdv_toplam: null,
      kargo_ucreti: null,
    }), orderContext());
    expect(result.order).toMatchObject({
      totalAmount: "0.00",
      subtotal: "0.00",
      taxTotal: "0.00",
      shippingAmount: "0.00",
    });
  });

  it("keeps a non-null kargo_takip_no and iptal_nedeni on sourceRemainder", () => {
    const result = transformLegacyOrder(fixture({
      kargo_takip_no: "  TRK-998877  ",
      iptal_nedeni: "  Musteri vazgecti  ",
    }), orderContext());
    expect(result.order.sourceRemainder).toMatchObject({
      kargo_takip_no: "TRK-998877",
      iptal_nedeni: "Musteri vazgecti",
    });
  });

  it("does not echo the customer phone, name, order number, or KolayBi id in row errors", () => {
    const errors = [
      captureError(() => transformLegacyOrder(fixture({
        musteri_ad: secretName,
        musteri_telefon: secretPhone,
        siparis_no: secretOrderNumber,
        kolaybi_siparis_id: secretKolaybiId,
        kargo_takip_no: secretTracking,
        iptal_nedeni: secretCancelReason,
        durum: secretPhone,
      }), orderContext())),
      captureError(() => transformLegacyOrder(fixture({
        musteri_ad: secretName,
        musteri_telefon: secretPhone,
        genel_toplam: -1,
      }), orderContext())),
      captureError(() => transformLegacyOrder(fixture({
        musteri_ad: secretName,
        musteri_telefon: " ",
      }), orderContext())),
      captureError(() => transformLegacyOrder(fixture({ gizli: secretPhone }), orderContext())),
    ];
    for (const error of errors) {
      expect(error.message).toMatch(/^Invalid legacy order row: /);
      expect(error.message).not.toContain(secretPhone);
      expect(error.message).not.toContain(secretName);
      expect(error.message).not.toContain(secretOrderNumber);
      expect(error.message).not.toContain(secretKolaybiId);
      expect(error.message).not.toContain(secretTracking);
      expect(error.message).not.toContain(secretCancelReason);
    }
  });
});
