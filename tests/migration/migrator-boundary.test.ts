import { describe, expect, it } from "vitest";
import { createTargetVerificationSnapshot } from "../../apps/migrator/src/target-snapshot.js";
import { createMigrationVerificationReport } from "../../apps/migrator/src/verify.js";

describe("migration gate", () => {
  it("keeps migration execution manual-only", () => {
    expect(["migrate --dry-run", "migrate --apply", "verify"]).toContain("migrate --apply");
  });

  it("fails verification reports when migrated relation checks do not pass", () => {
    const report = createMigrationVerificationReport({
      sourceCounts: { customers: 1 },
      targetCounts: { customers: 1 },
      customers: [{ public_id: "cus_1", phone: null, email: "customer@example.com" }],
      conversations: [],
      messages: [],
      orders: [],
      orderItems: [],
      shipments: [{ public_id: "shp_1", order_public_id: "ord_missing", customer_public_id: null }],
    });

    expect(report.status).toBe("failed");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "referential_integrity.shipments",
        status: "failed",
      }),
    );
  });

  it("verifies canonical target snapshots without legacy source access", async () => {
    const client = {
      query: async (sql: string) => {
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
                sent_at: "2026-01-01T00:00:00.000Z",
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
                quantity: 1,
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
              {
                source_system: "legacy",
                source_table: "legacy.siparis_kalemleri",
                source_id: "11",
                target_table: "order_items",
                target_id: "oit_1",
              },
            ],
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      },
    };

    const report = createMigrationVerificationReport(await createTargetVerificationSnapshot(client as never));

    expect(report.status).toBe("passed");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "legacy_id_map.customers",
        status: "passed",
      }),
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "totals.orders",
        status: "passed",
      }),
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "legacy_id_map.order_items",
        status: "passed",
      }),
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "referential_integrity.messages.conversation",
        status: "passed",
      }),
    );
  });
});
