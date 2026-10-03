import { describe, expect, it } from "vitest";
import { calculateSourcePayloadChecksum } from "../src/legacy-source.js";
import { transformLegacyOrderItem, type OrderItemTransformContext } from "../src/order-item-mapping.js";
import type { LegacyRecord } from "../src/types.js";

const orderItemId = "8a100000-0000-4000-8000-000000000001";
const orderId = "a1000000-0000-4000-8000-000000000001";
const stockId = "7f100000-0000-4000-8000-000000000001";
const orderPublicId = "ord_0123456789abcdef01234567";
const skuProductPublicId = "prd_0123456789abcdef01234567";
const externalProductPublicId = "prd_89abcdef0123456789abcdef";
const secretName = "Gizli Yedek Parca Alpha";
const secretSku = "SKU-SECRET-4242";
const secretKolaybiId = "kb-product-secret";

function context(overrides: Partial<OrderItemTransformContext> = {}): OrderItemTransformContext {
  return {
    orderPublicIds: new Map([[orderId, orderPublicId]]),
    productPublicIdsBySku: new Map([["SKU-1", skuProductPublicId]]),
    productPublicIdsByExternalId: new Map([["kb-1", skuProductPublicId]]),
    ...overrides,
  };
}

function fixture(overrides: Record<string, unknown> = {}, recordOverrides: Partial<LegacyRecord> = {}): LegacyRecord {
  const payload = {
    id: orderItemId,
    siparis_id: orderId.toUpperCase(),
    stok_id: stockId,
    urun_adi: "  Yedek Fan  ",
    urun_kodu: " SKU-1 ",
    miktar: 2,
    birim: " adet ",
    birim_fiyat: "10.5",
    kdv_orani: "20",
    toplam_fiyat: 21,
    olusturma_tarihi: "2024-01-02T03:04:05+03:00",
    kolaybi_product_id: null,
    ...overrides,
  };
  const sourceId = Object.hasOwn(overrides, "id")
    ? canonicalUuid(overrides.id)
    : orderItemId.toLowerCase();
  return {
    sourceSystem: "legacy_supabase",
    sourceTable: "public.siparis_kalemleri",
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

describe("transformLegacyOrderItem", () => {
  it("maps a legacy siparis_kalemleri row onto an order item draft using SKU product matching", () => {
    const result = transformLegacyOrderItem(fixture(), context());

    expect(result.sourcePayloadChecksum).toBe(fixture().checksum);
    expect(result.reconciliation).toEqual([]);
    expect(result.orderItem).toEqual({
      kind: "legacy_order_item_draft",
      targetTable: "order_items",
      publicId: expect.stringMatching(/^oit_[0-9a-f]{24}$/),
      mappingRole: "primary",
      orderPublicId,
      productPublicId: skuProductPublicId,
      productLookup: "sku",
      name: "Yedek Fan",
      quantity: 2,
      unitPrice: "10.50",
      totalAmount: "21.00",
      externalProductId: null,
      unit: "adet",
      taxRate: "20.0000",
      legacyTimestamps: {
        createdAt: "2024-01-02T00:04:05.000000Z",
      },
    });
    expect(transformLegacyOrderItem(fixture(), context()).orderItem.publicId).toBe(result.orderItem.publicId);
  });

  it("matches products by KolayBi product id when SKU is blank", () => {
    const result = transformLegacyOrderItem(
      fixture({ urun_kodu: " ", kolaybi_product_id: " kb-external " }),
      context({
        productPublicIdsBySku: new Map(),
        productPublicIdsByExternalId: new Map([["kb-external", externalProductPublicId]]),
      }),
    );

    expect(result.orderItem.productPublicId).toBe(externalProductPublicId);
    expect(result.orderItem.productLookup).toBe("external_product_id");
    expect(result.orderItem.externalProductId).toBe("kb-external");
    expect(result.reconciliation).toEqual([]);
  });

  it("ignores stok_id and keeps the row when product lookup is unresolved", () => {
    const result = transformLegacyOrderItem(
      fixture({ stok_id: "00000000-0000-4000-8000-000000000000", urun_kodu: "UNKNOWN" }),
      context({ productPublicIdsBySku: new Map(), productPublicIdsByExternalId: new Map() }),
    );

    expect(result.orderItem.productPublicId).toBeNull();
    expect(result.orderItem.productLookup).toBeNull();
    expect(result.reconciliation).toEqual([{ code: "unresolved_product", lookup: "sku" }]);
  });

  it("fails when SKU and KolayBi product id resolve to different products", () => {
    expect(() => transformLegacyOrderItem(
      fixture({ kolaybi_product_id: "kb-2" }),
      context({ productPublicIdsByExternalId: new Map([["kb-2", externalProductPublicId]]) }),
    )).toThrow("Invalid order item transform context: sku and external product id resolve to different products");
  });

  it("fails when siparis_id is unresolved", () => {
    expect(() => transformLegacyOrderItem(fixture(), context({ orderPublicIds: new Map() }))).toThrow(
      "Invalid legacy order item row: field siparis_id does not resolve to a migrated order",
    );
  });

  it.each([
    [0],
    [-1],
    [1.5],
    ["1.5"],
    [null],
  ])("fails closed for non-positive or non-integer miktar %j", (miktar) => {
    expect(() => transformLegacyOrderItem(fixture({ miktar }), context())).toThrow(
      "Invalid legacy order item row: field miktar must be a positive integer",
    );
  });

  it("fails when the source payload checksum does not match", () => {
    const record = fixture();
    record.payload.urun_adi = "changed-after-read";
    expect(() => transformLegacyOrderItem(record, context())).toThrow(
      "Invalid legacy order item row: source payload checksum does not match payload",
    );
  });

  it("fails closed on unknown payload fields without echoing secret item values", () => {
    const errors = [
      captureError(() => transformLegacyOrderItem(fixture({
        urun_adi: secretName,
        urun_kodu: secretSku,
        kolaybi_product_id: secretKolaybiId,
        birim_fiyat: -1,
      }), context())),
      captureError(() => transformLegacyOrderItem(fixture({
        urun_adi: secretName,
        urun_kodu: secretSku,
        kolaybi_product_id: secretKolaybiId,
        gizli: secretName,
      }), context())),
    ];
    for (const error of errors) {
      expect(error.message).toMatch(/^Invalid legacy order item row: /);
      expect(error.message).not.toContain(secretName);
      expect(error.message).not.toContain(secretSku);
      expect(error.message).not.toContain(secretKolaybiId);
    }
  });
});
