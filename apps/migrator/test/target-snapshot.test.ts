import { describe, expect, it } from "vitest";
import { createTargetVerificationSnapshot } from "../src/target-snapshot.js";

describe("target verification snapshot", () => {
  it("reads canonical target rows and derives source counts from legacy id maps", async () => {
    const queries: string[] = [];
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes("from customers order by")) {
          return { rows: [{ public_id: "cus_1", phone: "555", email: "customer@example.com" }] };
        }
        if (sql.includes("from conversations")) {
          return { rows: [{ public_id: "cnv_1", customer_public_id: "cus_1" }] };
        }
        if (sql.includes("from messages")) {
          return {
            rows: [
              {
                public_id: "msg_1",
                conversation_public_id: "cnv_1",
                sent_at: new Date("2026-01-01T00:00:00.000Z"),
              },
            ],
          };
        }
        if (sql.includes("from orders") && !sql.includes("join orders")) {
          return { rows: [{ public_id: "ord_1", customer_public_id: "cus_1", total_amount: "10.00" }] };
        }
        if (sql.includes("from order_items")) {
          return {
            rows: [
              {
                public_id: "oit_1",
                order_public_id: "ord_1",
                quantity: "1",
                unit_price: "10.00",
                total_amount: "10.00",
              },
            ],
          };
        }
        if (sql.includes("from shipments")) {
          return { rows: [{ public_id: "shp_1", order_public_id: "ord_1", customer_public_id: "cus_1" }] };
        }
        if (sql.includes("from legacy_id_map")) {
          return {
            rows: [
              {
                source_system: "legacy",
                source_table: "legacy.musteriler",
                source_id: "1",
                target_table: "customers",
                target_id: "cus_1",
              },
              {
                source_system: "legacy",
                source_table: "legacy.siparisler",
                source_id: "10",
                target_table: "orders",
                target_id: "ord_1",
              },
            ],
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      },
    };

    const snapshot = await createTargetVerificationSnapshot(client as never);

    expect(queries).toHaveLength(7);
    expect(snapshot.sourceCounts).toEqual({ customers: 1, orders: 1 });
    expect(snapshot.targetCounts).toMatchObject({
      customers: 1,
      conversations: 1,
      messages: 1,
      orders: 1,
      order_items: 1,
      shipments: 1,
    });
    expect(snapshot.messages[0]?.sent_at).toBe("2026-01-01T00:00:00.000Z");
    expect(snapshot.orderItems[0]?.public_id).toBe("oit_1");
    expect(snapshot.orderItems[0]?.quantity).toBe(1);
    expect(snapshot.legacyIdMaps).toHaveLength(2);
  });
});
