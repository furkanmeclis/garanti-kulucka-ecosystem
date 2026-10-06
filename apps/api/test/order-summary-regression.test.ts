import { describe, expect, it } from "vitest";
import type { AppDatabase } from "@garanti-kulucka/database";
import { DomainRepository } from "../src/domain/repository.js";



const orderCargoProviderFilterKey = "__order_cargo_provider";

const cargoFilterDate = new Date("2026-01-02T00:00:00.000Z");

const cargoFilterOrders = [
  {
    id: 10,
    public_id: "ord_order_ptt",
    customer_id: null,
    conversation_id: null,
    created_by_user_id: null,
    order_number: "ORD-ORDER-PTT",
    status: "draft",
    source: "manual",
    total_amount: "100.00",
    currency: "TRY",
    confirmation_status: null,
    notes: null,
    external_order_id: null,
    created_at: cargoFilterDate,
    updated_at: cargoFilterDate,
    customer_full_name: "Order Provider",
    created_by_user_public_id: null,
    created_by_user_email: null,
    cargo_provider: "ptt",
  },
  {
    id: 11,
    public_id: "ord_shipment_ptt",
    customer_id: null,
    conversation_id: null,
    created_by_user_id: null,
    order_number: "ORD-SHIPMENT-PTT",
    status: "draft",
    source: "manual",
    total_amount: "150.00",
    currency: "TRY",
    confirmation_status: null,
    notes: null,
    external_order_id: null,
    created_at: cargoFilterDate,
    updated_at: cargoFilterDate,
    customer_full_name: "Shipment Provider",
    created_by_user_public_id: null,
    created_by_user_email: null,
    cargo_provider: null,
  },
  {
    id: 12,
    public_id: "ord_shipment_surat",
    customer_id: null,
    conversation_id: null,
    created_by_user_id: null,
    order_number: "ORD-SHIPMENT-SURAT",
    status: "draft",
    source: "manual",
    total_amount: "175.00",
    currency: "TRY",
    confirmation_status: null,
    notes: null,
    external_order_id: null,
    created_at: cargoFilterDate,
    updated_at: cargoFilterDate,
    customer_full_name: "Shipment Surat",
    created_by_user_public_id: null,
    created_by_user_email: null,
    cargo_provider: null,
  },
];

const cargoFilterShipments = [
  { id: 20, order_id: 11, provider: "Sürat", created_at: new Date("2026-01-02T00:00:00.000Z") },
  { id: 21, order_id: 11, provider: "ptt", created_at: new Date("2026-01-02T01:00:00.000Z") },
  { id: 22, order_id: 12, provider: "Sürat", created_at: new Date("2026-01-02T01:00:00.000Z") },
];

function latestCargoFilterShipmentProvider(orderId: number) {
  return cargoFilterShipments
    .filter((shipment) => shipment.order_id === orderId)
    .sort((left, right) =>
      right.created_at.getTime() - left.created_at.getTime() ||
      right.id - left.id,
    )[0]?.provider ?? null;
}

function resolvedCargoFilterProvider(order: typeof cargoFilterOrders[number]) {
  return order.cargo_provider ?? latestCargoFilterShipmentProvider(order.id);
}

class CargoFilterOrderQuery {
  private readonly whereValues = new Map<string, unknown>();
  private readonly whereOperators = new Map<string, string>();
  private countAlias: string | null = null;

  leftJoin() {
    return this;
  }

  selectAll() {
    return this;
  }

  select(selection?: unknown) {
    if (typeof selection === "function") {
      const [aggregate] = (selection as (expression: {
        fn: { countAll: () => { as: (alias: string) => { alias: string } } };
      }) => Array<{ alias: string }>)({
        fn: {
          countAll: () => ({ as: (alias: string) => ({ alias }) }),
        },
      });
      this.countAlias = aggregate?.alias ?? null;
    }
    return this;
  }

  $if(condition: boolean, callback: (builder: this) => this) {
    return condition ? callback(this) : this;
  }

  where(columnOrExpression: string | ((expression: unknown) => unknown) | unknown, operator?: string, value?: unknown) {
    if (typeof columnOrExpression !== "function" && operator !== undefined) {
      const key = typeof columnOrExpression === "string" ? columnOrExpression : orderCargoProviderFilterKey;
      this.whereValues.set(key, value);
      this.whereOperators.set(key, operator);
    }
    return this;
  }

  orderBy() {
    return this;
  }

  offset() {
    return this;
  }

  limit() {
    return this;
  }

  private filteredOrders() {
    const providerFilter = this.whereValues.get(orderCargoProviderFilterKey);
    const providerOperator = this.whereOperators.get(orderCargoProviderFilterKey);
    return cargoFilterOrders
      .filter((order) => {
        if (providerFilter === undefined) return true;
        const provider = resolvedCargoFilterProvider(order);
        return Array.isArray(providerFilter)
          ? providerOperator === "not in"
            ? !providerFilter.includes(provider)
            : providerFilter.includes(provider)
          : provider === providerFilter;
      })
      .map((order) => ({
        ...order,
        cargo_provider: resolvedCargoFilterProvider(order),
      }));
  }

  async execute() {
    return this.filteredOrders();
  }

  async executeTakeFirst() {
    if (this.countAlias) {
      return { [this.countAlias]: this.filteredOrders().length };
    }
    return this.filteredOrders()[0] ?? null;
  }
}

describe("order-backed summaries", () => {
  it("filters order lists by persisted cargo provider and latest shipment fallback", async () => {
    const db = {
      selectFrom(table: string) {
        if (table !== "orders") {
          throw new Error(`Unexpected table: ${table}`);
        }
        return new CargoFilterOrderQuery();
      },
    } as unknown as AppDatabase;

    await expect(new DomainRepository(db).listOrdersPage({
      cargoProvider: "ptt",
      sortBy: "order_number",
      sortDirection: "asc",
      offset: 0,
      limit: 10,
    })).resolves.toMatchObject({
      rows: [
        { public_id: "ord_order_ptt", cargo_provider: "ptt" },
        { public_id: "ord_shipment_ptt", cargo_provider: "ptt" },
      ],
      total_count: 2,
      limit: 10,
      offset: 0,
    });
  });
});
