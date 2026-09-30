import { describe, expect, it } from "vitest";
import { transformLegacyProduct } from "../src/product-mapping.js";
import { calculateSourcePayloadChecksum } from "../src/legacy-source.js";
import type { LegacyRecord } from "../src/types.js";

const productId = 42;
const secretName = "Gizli Kulucka Makinesi Alpha";
const secretSku = "SKU-SECRET-4242";
const secretKolaybiId = "kb-product-999";

function fixture(overrides: Record<string, unknown> = {}, recordOverrides: Partial<LegacyRecord> = {}): LegacyRecord {
  const payload = {
    id: productId,
    ad: "  Kulucka Makinesi  ",
    kod: " KM-100 ",
    kategori: "kulucka",
    birim: " adet ",
    satis_fiyati: "129.5",
    stok_miktari: 7,
    kritik_seviye: 2,
    aciklama: "  Yedek termostat dahil  ",
    aktif: true,
    olusturma_tarihi: "2024-01-02T03:04:05+03:00",
    guncelleme_tarihi: new Date("2025-06-07T08:09:10.123Z"),
    kolaybi_product_id: "kb-42",
    ...overrides,
  };
  const sourceId = Object.hasOwn(overrides, "id")
    ? canonicalIntegerId(overrides.id)
    : String(productId);
  return {
    sourceSystem: "legacy_supabase",
    sourceTable: "public.urunler",
    sourceId,
    checksum: calculateSourcePayloadChecksum(payload),
    payload,
    ...recordOverrides,
  };
}

function canonicalIntegerId(value: unknown): string {
  return typeof value === "number" && Number.isInteger(value) ? String(value) : "invalid-id";
}

function captureError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected operation to throw");
}

describe("transformLegacyProduct", () => {
  it("maps a legacy urunler row onto a product draft, keeping deferred columns", () => {
    const result = transformLegacyProduct(fixture());

    expect(result.sourcePayloadChecksum).toBe(fixture().checksum);
    expect(result.product).toEqual({
      kind: "legacy_product_draft",
      targetTable: "products",
      publicId: expect.stringMatching(/^prd_[0-9a-f]{24}$/),
      mappingRole: "primary",
      name: "Kulucka Makinesi",
      sku: "KM-100",
      category: "incubator",
      unitPrice: "129.50",
      stockQuantity: 7,
      isActive: true,
      externalProductId: "kb-42",
      unit: "adet",
      reorderLevel: 2,
      description: "Yedek termostat dahil",
      legacyTimestamps: {
        createdAt: "2024-01-02T00:04:05.000000Z",
        updatedAt: "2025-06-07T08:09:10.123000Z",
      },
    });
    expect(result.product).not.toHaveProperty("sourceId");
    expect(transformLegacyProduct(fixture()).product.publicId).toBe(result.product.publicId);
  });

  it.each([
    [null, "other"],
    ["diger", "other"],
    ["kulucka", "incubator"],
    ["yedek_parca", "spare_part"],
  ] as const)("maps kategori %j to %s", (kategori, category) => {
    expect(transformLegacyProduct(fixture({ kategori })).product.category).toBe(category);
  });

  it.each(["other", "spare_part", "incubator", "yedek parca", "KULUCKA", ""])(
    "fails closed for kategori %j",
    (kategori) => {
      expect(() => transformLegacyProduct(fixture({ kategori }))).toThrow(
        "Invalid legacy product row: field kategori has an unsupported value",
      );
    },
  );

  it("defaults null money to 0.00 and null stock to 0", () => {
    const result = transformLegacyProduct(fixture({ satis_fiyati: null, stok_miktari: null }));
    expect(result.product.unitPrice).toBe("0.00");
    expect(result.product.stockQuantity).toBe(0);
  });

  it("emits unitPrice as a two-decimal decimal string", () => {
    expect(transformLegacyProduct(fixture({ satis_fiyati: 10 })).product.unitPrice).toBe("10.00");
    expect(transformLegacyProduct(fixture({ satis_fiyati: "10.5" })).product.unitPrice).toBe("10.50");
    expect(transformLegacyProduct(fixture({ satis_fiyati: "0.00" })).product.unitPrice).toBe("0.00");
  });

  it("turns a blank sku into null", () => {
    expect(transformLegacyProduct(fixture({ kod: " " })).product.sku).toBeNull();
    expect(transformLegacyProduct(fixture({ kod: "" })).product.sku).toBeNull();
    expect(transformLegacyProduct(fixture({ kod: null })).product.sku).toBeNull();
  });

  it("defaults null aktif to true and keeps null reorderLevel and timestamps", () => {
    const result = transformLegacyProduct(fixture({
      aktif: null,
      kritik_seviye: null,
      aciklama: " ",
      birim: "",
      kolaybi_product_id: "  ",
      olusturma_tarihi: null,
      guncelleme_tarihi: null,
    }));
    expect(result.product).toMatchObject({
      isActive: true,
      reorderLevel: null,
      description: null,
      unit: null,
      externalProductId: null,
      legacyTimestamps: { createdAt: null, updatedAt: null },
    });
  });

  it("stores integer source ids as canonical decimal strings in the public id identity", () => {
    const zero = transformLegacyProduct(fixture({ id: 0 }));
    const twelve = transformLegacyProduct(fixture({ id: 12 }));
    expect(zero.product.publicId).toMatch(/^prd_[0-9a-f]{24}$/);
    expect(twelve.product.publicId).not.toBe(zero.product.publicId);
    expect(() => transformLegacyProduct({ ...fixture({ id: 12 }), sourceId: "012" }))
      .toThrow("sourceId does not match payload id");
  });

  it("fails when the source payload checksum does not match", () => {
    const record = fixture();
    record.payload.ad = "changed-after-read";
    expect(() => transformLegacyProduct(record)).toThrow(
      "Invalid legacy product row: source payload checksum does not match payload",
    );
    expect(() => transformLegacyProduct({ ...fixture(), checksum: "sha256:legacy" })).toThrow(
      "Invalid legacy product row: source payload checksum is invalid",
    );
  });

  it("fails closed on unknown payload fields", () => {
    expect(() => transformLegacyProduct(fixture({ gizli: secretName }))).toThrow(
      "Invalid legacy product row: payload contains unknown fields",
    );
  });

  it("does not echo the product name, sku, or KolayBi id in row errors", () => {
    const errors = [
      captureError(() => transformLegacyProduct(fixture({
        ad: secretName,
        kod: secretSku,
        kolaybi_product_id: secretKolaybiId,
        kategori: secretName,
      }))),
      captureError(() => transformLegacyProduct(fixture({
        ad: secretName,
        kod: secretSku,
        kolaybi_product_id: secretKolaybiId,
        satis_fiyati: -1,
      }))),
      captureError(() => transformLegacyProduct(fixture({ ad: " " }))),
      captureError(() => transformLegacyProduct(fixture({ gizli: secretName }))),
    ];
    for (const error of errors) {
      expect(error.message).toMatch(/^Invalid legacy product row: /);
      expect(error.message).not.toContain(secretName);
      expect(error.message).not.toContain(secretSku);
      expect(error.message).not.toContain(secretKolaybiId);
    }
  });

  it.each([
    ["negative price", { satis_fiyati: -0.01 }, "satis_fiyati"],
    ["negative stock", { stok_miktari: -1 }, "stok_miktari"],
    ["fractional stock", { stok_miktari: 1.5 }, "stok_miktari"],
    ["negative reorder level", { kritik_seviye: -1 }, "kritik_seviye"],
    ["fractional reorder level", { kritik_seviye: 0.5 }, "kritik_seviye"],
    ["wrong table", { sourceTable: "public.products" } as Partial<LegacyRecord>, "source table"],
  ])("fails closed for %s", (_label, override, message) => {
    const record = "sourceTable" in override
      ? { ...fixture(), ...override }
      : fixture(override as Record<string, unknown>);
    expect(() => transformLegacyProduct(record)).toThrow(message);
  });
});
