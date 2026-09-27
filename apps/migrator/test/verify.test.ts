import { describe, expect, it } from "vitest";
import {
  createMigrationVerificationReport,
  verifyMessageOrdering,
  verifyOrderTotals,
  verifyRowCounts,
} from "../src/verify.js";

describe("migration verification", () => {
  it("reports row count mismatches by entity", () => {
    expect(verifyRowCounts({ customers: 2, messages: 3 }, { customers: 2, messages: 1 })).toEqual([
      {
        name: "row_count.customers",
        status: "passed",
        expected: 2,
        actual: 2,
      },
      {
        name: "row_count.messages",
        status: "failed",
        expected: 3,
        actual: 1,
        message: "Expected 3 messages rows, found 1",
      },
    ]);
  });

  it("detects message ordering regressions inside a conversation", () => {
    expect(
      verifyMessageOrdering([
        {
          public_id: "msg_1",
          conversation_public_id: "cnv_1",
          sent_at: "2026-01-01T00:02:00.000Z",
        },
        {
          public_id: "msg_2",
          conversation_public_id: "cnv_1",
          sent_at: "2026-01-01T00:01:00.000Z",
        },
      ]),
    ).toMatchObject({
      name: "ordering.messages",
      status: "failed",
      actual: 1,
    });
  });

  it("detects order total mismatches", () => {
    expect(
      verifyOrderTotals(
        [{ public_id: "ord_1", customer_public_id: "cus_1", total_amount: "100.00" }],
        [
          {
            order_public_id: "ord_1",
            quantity: 1,
            unit_price: "40.00",
            total_amount: "40.00",
          },
          {
            order_public_id: "ord_1",
            quantity: 2,
            unit_price: "20.00",
            total_amount: "40.00",
          },
        ],
      ),
    ).toMatchObject({
      name: "totals.orders",
      status: "failed",
      actual: 1,
    });
  });

  it("creates a failed report for orphan, duplicate, ordering, and total issues", () => {
    const report = createMigrationVerificationReport({
      sourceCounts: { customers: 2, orders: 1 },
      targetCounts: { customers: 2, orders: 1 },
      customers: [
        { public_id: "cus_1", phone: "555", email: null },
        { public_id: "cus_2", phone: "555", email: null },
      ],
      conversations: [{ public_id: "cnv_1", customer_public_id: "cus_missing" }],
      messages: [
        {
          public_id: "msg_1",
          conversation_public_id: "cnv_1",
          sent_at: "2026-01-01T00:02:00.000Z",
        },
        {
          public_id: "msg_2",
          conversation_public_id: "cnv_1",
          sent_at: "2026-01-01T00:01:00.000Z",
        },
      ],
      orders: [{ public_id: "ord_1", customer_public_id: "cus_missing", total_amount: "50.00" }],
      orderItems: [
        {
          order_public_id: "ord_1",
          quantity: 1,
          unit_price: "20.00",
          total_amount: "20.00",
        },
      ],
      shipments: [{ public_id: "shp_1", order_public_id: "ord_missing", customer_public_id: "cus_1" }],
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(report.status).toBe("failed");
    expect(report.totals.failed).toBe(6);
    expect(report.checks.map((check) => check.name)).toContain("referential_integrity.shipments");
    expect(report.generatedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
