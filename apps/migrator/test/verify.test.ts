import { describe, expect, it } from "vitest";
import {
  createMigrationVerificationReport,
  verifyLegacyIdMapCoverage,
  verifyCustomerExternalIdentityReferences,
  verifyConversationIntegrationAccounts,
  verifyMessageConversations,
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

  it("detects orphan messages without a migrated conversation", () => {
    expect(
      verifyMessageConversations({
        sourceCounts: {},
        targetCounts: {},
        customers: [],
        customerExternalIdentities: [],
        conversations: [
          {
            public_id: "cnv_1",
            customer_public_id: null,
            integration_account_public_id: null,
            has_integration_account: false,
          },
        ],
        messages: [
          {
            public_id: "msg_1",
            conversation_public_id: "cnv_missing",
            sent_at: "2026-01-01T00:00:00.000Z",
          },
        ],
        orders: [],
        orderItems: [],
        shipments: [],
      }),
    ).toMatchObject({
      name: "referential_integrity.messages.conversation",
      status: "failed",
      actual: 1,
    });
  });

  it("detects orphan customer identities and conversation integration accounts", () => {
    const snapshot = {
      sourceCounts: {},
      targetCounts: {},
      customers: [{ public_id: "cus_1", phone: null, email: null }],
      customerExternalIdentities: [
        {
          public_id: "cei_1",
          customer_public_id: null,
          integration_account_public_id: null,
          external_id: "42",
        },
      ],
      conversations: [
        {
          public_id: "cnv_1",
          customer_public_id: "cus_1",
          integration_account_public_id: null,
          has_integration_account: true,
        },
      ],
      messages: [],
      orders: [],
      orderItems: [],
      shipments: [],
    };

    expect(verifyCustomerExternalIdentityReferences(snapshot)).toMatchObject({
      status: "failed",
      actual: 1,
    });
    expect(verifyConversationIntegrationAccounts(snapshot)).toMatchObject({
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
            public_id: "oit_1",
            order_public_id: "ord_1",
            quantity: 1,
            unit_price: "40.00",
            total_amount: "40.00",
          },
          {
            public_id: "oit_2",
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

  it("detects missing legacy id map coverage and dangling target references", () => {
    const checks = verifyLegacyIdMapCoverage({
      sourceCounts: { customers: 2, customer_external_identities: 1, orders: 1, order_items: 1 },
      targetCounts: { customers: 2, customer_external_identities: 0, orders: 1, order_items: 1 },
      customers: [{ public_id: "cus_1", phone: null, email: "customer@example.com" }],
      customerExternalIdentities: [],
      conversations: [],
      messages: [],
      orders: [{ public_id: "ord_1", customer_public_id: "cus_1", total_amount: "10.00" }],
      orderItems: [
        {
          public_id: "oit_1",
          order_public_id: "ord_1",
          quantity: 1,
          unit_price: "10.00",
          total_amount: "10.00",
        },
      ],
      shipments: [],
      legacyIdMaps: [
        {
          source_system: "legacy",
          source_table: "legacy.musteriler",
          source_id: "1",
          target_table: "customers",
          mapping_role: "primary",
          target_id: "cus_1",
        },
        {
          source_system: "legacy",
          source_table: "legacy.siparisler",
          source_id: "10",
          target_table: "orders",
          mapping_role: "primary",
          target_id: "ord_missing",
        },
        {
          source_system: "legacy",
          source_table: "legacy.musteriler",
          source_id: "1",
          target_table: "customer_external_identities",
          mapping_role: "woocommerce_identity",
          target_id: "cei_missing",
        },
        {
          source_system: "legacy",
          source_table: "legacy.siparis_kalemleri",
          source_id: "11",
          target_table: "order_items",
          mapping_role: "primary",
          target_id: "oit_missing",
        },
      ],
    });

    expect(checks).toContainEqual(
      expect.objectContaining({
        name: "legacy_id_map.customers",
        status: "failed",
        expected: 2,
        actual: 1,
      }),
    );
    expect(checks).toContainEqual(
      expect.objectContaining({
        name: "legacy_id_map.orders",
        status: "passed",
      }),
    );
    expect(checks).toContainEqual(
      expect.objectContaining({
        name: "legacy_id_map.customer_external_identities",
        status: "passed",
      }),
    );
    expect(checks).toContainEqual(
      expect.objectContaining({
        name: "legacy_id_map.order_items",
        status: "passed",
      }),
    );
    expect(checks).toContainEqual(
      expect.objectContaining({
        name: "legacy_id_map.target_references",
        status: "failed",
        actual: 3,
      }),
    );
  });

  it("creates a failed report for orphan, duplicate, ordering, and total issues", () => {
    const report = createMigrationVerificationReport({
      sourceCounts: { customers: 2, orders: 1 },
      targetCounts: { customers: 2, orders: 1 },
      customers: [
        { public_id: "cus_1", phone: "555", email: null },
        { public_id: "cus_2", phone: "555", email: null },
      ],
      customerExternalIdentities: [],
      conversations: [
        {
          public_id: "cnv_1",
          customer_public_id: "cus_missing",
          integration_account_public_id: null,
          has_integration_account: false,
        },
      ],
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
          public_id: "oit_1",
          order_public_id: "ord_1",
          quantity: 1,
          unit_price: "20.00",
          total_amount: "20.00",
        },
      ],
      shipments: [{ public_id: "shp_1", order_public_id: "ord_missing", customer_public_id: "cus_1" }],
      legacyIdMaps: [
        {
          source_system: "legacy",
          source_table: "legacy.musteriler",
          source_id: "1",
          target_table: "customers",
          mapping_role: "primary",
          target_id: "cus_1",
        },
        {
          source_system: "legacy",
          source_table: "legacy.siparisler",
          source_id: "10",
          target_table: "orders",
          mapping_role: "primary",
          target_id: "ord_1",
        },
      ],
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(report.status).toBe("failed");
    expect(report.totals.failed).toBe(7);
    expect(report.checks.map((check) => check.name)).toContain("referential_integrity.shipments");
    expect(report.generatedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
