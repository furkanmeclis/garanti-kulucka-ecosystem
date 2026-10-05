import { describe, expect, it } from "vitest";
import { calculateVatInclusiveOrder } from "../src/domain/order-totals.js";

describe("order create legacy parity totals", () => {
  it("keeps line totals and order total VAT-inclusive like the legacy form", () => {
    const calculated = calculateVatInclusiveOrder([
      { name: "Kuluçka Pro 56", quantity: 2, unit_price: "1250.00", product_public_id: "prd_incubator" },
      { name: "Yedek Fan", quantity: 3, unit_price: "85.00", product_public_id: "prd_fan" },
    ]);

    expect(calculated.items).toEqual([
      expect.objectContaining({ name: "Kuluçka Pro 56", quantity: 2, unitPrice: "1250.00", totalAmount: "2500.00" }),
      expect.objectContaining({ name: "Yedek Fan", quantity: 3, unitPrice: "85.00", totalAmount: "255.00" }),
    ]);
    expect(calculated).toMatchObject({
      totalAmount: "2755.00",
      araToplam: "2295.83",
      kdvToplam: "459.17",
    });
  });
});
