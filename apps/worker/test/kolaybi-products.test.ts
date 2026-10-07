import { describe, expect, it } from "vitest";
import type { ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { kolaybiProductsFrom } from "../src/kolaybi-products.js";

function envelope(overrides: Partial<ProviderRequestEnvelope> = {}): ProviderRequestEnvelope {
  return {
    request_id: "req_products_1",
    provider: "kolaybi",
    operation: "product.list",
    direction: "outbound",
    channel: "accounting",
    account_public_id: "iac_kolaybi",
    occurred_at: "2026-10-07T00:00:00.000Z",
    payload: {},
    ...overrides,
  };
}

describe("KolayBi product list write-back", () => {
  it("maps a live product.list result to the stored snapshot", () => {
    const result = kolaybiProductsFrom(envelope(), {
      success: true,
      toplam: 2,
      urunler: [
        { id: 11, name: "Kuluçka 48", sale_price: "4500", stock_quantity: 3, unit: "Adet", category: "Makine" },
        { id: null, name: "kimliksiz" },
        { id: "12", name: "Termostat", sale_price: 150 },
      ],
    });
    expect(result?.accountPublicId).toBe("iac_kolaybi");
    expect(result?.snapshot).toMatchObject({
      total: 2,
      request_id: "req_products_1",
      products: [
        { id: "11", name: "Kuluçka 48", sale_price: "4500", stock_quantity: 3, unit: "Adet", category: "Makine" },
        { id: "12", name: "Termostat", sale_price: 150, stock_quantity: null, unit: null, category: null },
      ],
    });
  });

  it("ignores other operations and failed payloads", () => {
    expect(kolaybiProductsFrom(envelope({ operation: "invoice.get" }), { success: true, urunler: [] })).toBeNull();
    expect(kolaybiProductsFrom(envelope(), { success: false })).toBeNull();
    expect(kolaybiProductsFrom(envelope({ provider: "ptt" }), { success: true, urunler: [] })).toBeNull();
  });
});
