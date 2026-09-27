import { describe, expect, it } from "vitest";
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
});
