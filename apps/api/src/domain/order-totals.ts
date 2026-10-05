export interface OrderTotalInputItem {
  name: string;
  quantity: number;
  unit_price: string;
  product_public_id?: string | null | undefined;
  external_product_id?: string | null | undefined;
}

export interface CalculatedOrderItem {
  productPublicId: string | null;
  name: string;
  quantity: number;
  unitPrice: string;
  totalAmount: string;
  externalProductId: string | null;
}

export function moneyToCents(value: string) {
  const [whole = "0", fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

export function centsToMoneyString(cents: number) {
  return `${Math.floor(cents / 100)}.${String(Math.abs(cents % 100)).padStart(2, "0")}`;
}

export function calculateVatInclusiveOrder(inputItems: OrderTotalInputItem[]) {
  const items = inputItems.map((item) => {
    const unitPriceCents = moneyToCents(item.unit_price);
    return {
      productPublicId: item.product_public_id ?? null,
      name: item.name,
      quantity: item.quantity,
      unitPrice: centsToMoneyString(unitPriceCents),
      totalAmount: centsToMoneyString(unitPriceCents * item.quantity),
      externalProductId: item.external_product_id ?? null,
    };
  });
  const totalCents = items.reduce((sum, item) => sum + moneyToCents(item.totalAmount), 0);
  const araToplamCents = Math.round(totalCents / 1.2);
  return {
    items,
    totalAmount: centsToMoneyString(totalCents),
    araToplam: centsToMoneyString(araToplamCents),
    kdvToplam: centsToMoneyString(totalCents - araToplamCents),
  };
}
