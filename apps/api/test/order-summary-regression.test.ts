import { describe, expect, it } from "vitest";
import type { AppDatabase } from "@garanti-kulucka/database";
import { DomainRepository } from "../src/domain/repository.js";

const date = new Date("2026-01-01T00:00:00.000Z");

class BalanceSummaryOrderQuery {
  leftJoin() {
    return this;
  }

  selectAll() {
    return this;
  }

  select(selection?: unknown) {
    if (typeof selection === "function") {
      throw new Error("balance summary must not run order pagination count query");
    }
    return this;
  }

  $if(condition: boolean, callback: (builder: this) => this) {
    return condition ? callback(this) : this;
  }

  where() {
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

  async execute() {
    return [
      {
        id: 1,
        public_id: "ord_pending",
        customer_id: null,
        conversation_id: null,
        created_by_user_id: null,
        order_number: "ORD-PENDING",
        status: "draft",
        source: "manual",
        total_amount: "125.50",
        currency: "TRY",
        confirmation_status: null,
        notes: null,
        external_order_id: null,
        created_at: date,
        updated_at: date,
        customer_full_name: "Pending Customer",
        created_by_user_public_id: null,
        created_by_user_email: null,
        cargo_provider: null,
      },
      {
        id: 2,
        public_id: "ord_cancelled",
        customer_id: null,
        conversation_id: null,
        created_by_user_id: null,
        order_number: "ORD-CANCELLED",
        status: "cancelled",
        source: "manual",
        total_amount: "75.00",
        currency: "TRY",
        confirmation_status: "confirmed",
        notes: null,
        external_order_id: null,
        created_at: date,
        updated_at: date,
        customer_full_name: "Cancelled Customer",
        created_by_user_public_id: null,
        created_by_user_email: null,
        cargo_provider: null,
      },
    ];
  }
}

describe("order-backed summaries", () => {
  it("builds balance summary from row-only order reads, not paginated count queries", async () => {
    const db = {
      selectFrom(table: string) {
        if (table !== "orders") {
          throw new Error(`Unexpected table: ${table}`);
        }
        return new BalanceSummaryOrderQuery();
      },
    } as unknown as AppDatabase;

    await expect(new DomainRepository(db).getBalanceSummary()).resolves.toMatchObject({
      total_commission: 12.55,
      total_deduction: 7.5,
      pending_payment: 12.55,
      available_balance: 0,
      pending_request_count: 1,
    });
  });
});
