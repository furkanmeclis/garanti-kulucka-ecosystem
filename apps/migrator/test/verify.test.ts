import { describe, expect, it } from "vitest";
import { canonicalMigrationEntities } from "../src/plan.js";
import { calculateSourceManifestHash } from "../src/source-manifest.js";
import {
  createMigrationVerificationReport,
  verifyLegacyIdMapCoverage,
  verifyCustomerExternalIdentityReferences,
  verifyConversationIntegrationAccounts,
  verifyMessageConversations,
  verifyMessageOrdering,
  verifyOrderTotals,
  verifySourceManifestEntityCoverage,
  verifySourceManifestIntegrity,
} from "../src/verify.js";
import type { MigrationEntity, SourceManifest } from "../src/types.js";

describe("migration verification", () => {
  it("ignores unrelated global target rows and detects source rows collapsing onto one target", () => {
    const report = createMigrationVerificationReport({
      runId: "run_2026_09",
      sourceManifest: manifest({ customers: 2 }),
      targetPublicIds: targetPublicIds({ customers: ["cus_1"] }),
      customers: [
        { public_id: "cus_1", phone: null, email: "one@example.com" },
        { public_id: "cus_unrelated", phone: null, email: "unrelated@example.com" },
      ],
      customerExternalIdentities: [],
      conversations: [],
      messages: [],
      orders: [],
      orderItems: [],
      shipments: [],
      legacyIdMaps: ["1", "2"].map((sourceId) => ({
        run_id: "run_2026_09",
        source_system: "legacy_postgres",
        source_table: "legacy.musteriler",
        source_id: sourceId,
        target_table: "customers",
        mapping_role: "primary",
        target_id: "cus_1",
      })),
    });

    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "legacy_id_map.source_coverage.customers",
      status: "passed",
      expected: 2,
      actual: 2,
    }));
    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "legacy_id_map.target_coverage.customers",
      status: "failed",
      expected: 2,
      actual: 1,
    }));
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
        runId: "run_2026_09",
        sourceManifest: manifest({}),
        targetPublicIds: targetPublicIds(),
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
      runId: "run_2026_09",
      sourceManifest: manifest({}),
      targetPublicIds: targetPublicIds(),
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
      runId: "run_2026_09",
      sourceManifest: manifest({ customers: 2, customer_external_identities: 1, orders: 1, order_items: 1 }),
      targetPublicIds: targetPublicIds({ customers: ["cus_1"], orders: ["ord_1"], order_items: ["oit_1"] }),
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
          run_id: "run_2026_09",
          source_system: "legacy_postgres",
          source_table: "legacy.musteriler",
          source_id: "1",
          target_table: "customers",
          mapping_role: "primary",
          target_id: "cus_1",
        },
        {
          run_id: "run_2026_09",
          source_system: "legacy_postgres",
          source_table: "legacy.siparisler",
          source_id: "10",
          target_table: "orders",
          mapping_role: "primary",
          target_id: "ord_missing",
        },
        {
          run_id: "run_2026_09",
          source_system: "legacy_postgres",
          source_table: "legacy.musteriler",
          source_id: "1",
          target_table: "customer_external_identities",
          mapping_role: "woocommerce_identity",
          target_id: "cei_missing",
        },
        {
          run_id: "run_2026_09",
          source_system: "legacy_postgres",
          source_table: "legacy.siparis_kalemleri",
          source_id: "11",
          target_table: "order_items",
          mapping_role: "primary",
          target_id: "oit_missing",
        },
        {
          run_id: "another_run",
          source_system: "legacy_postgres",
          source_table: "legacy.musteriler",
          source_id: "2",
          target_table: "customers",
          mapping_role: "primary",
          target_id: "cus_cross_run",
        },
      ],
    });

    expect(checks).toContainEqual(
      expect.objectContaining({
        name: "legacy_id_map.source_coverage.customers",
        status: "failed",
        expected: 2,
        actual: 1,
      }),
    );
    expect(checks).toContainEqual(
      expect.objectContaining({
        name: "legacy_id_map.source_coverage.orders",
        status: "passed",
      }),
    );
    expect(checks).toContainEqual(
      expect.objectContaining({
        name: "legacy_id_map.source_coverage.customer_external_identities",
        status: "failed",
        actual: 0,
      }),
    );
    expect(checks).toContainEqual(
      expect.objectContaining({
        name: "legacy_id_map.source_coverage.order_items",
        status: "passed",
      }),
    );
    expect(checks).toContainEqual(
      expect.objectContaining({
        name: "legacy_id_map.foundation_rules",
        status: "failed",
        actual: 1,
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

  it("detects dangling id maps in canonical tables outside the richer relation snapshots", () => {
    const checks = verifyLegacyIdMapCoverage({
      runId: "run_2026_09",
      sourceManifest: manifest({ products: 1 }),
      targetPublicIds: targetPublicIds({ products: [] }),
      customers: [],
      customerExternalIdentities: [],
      conversations: [],
      messages: [],
      orders: [],
      orderItems: [],
      shipments: [],
      legacyIdMaps: [{
        run_id: "run_2026_09",
        source_system: "legacy_postgres",
        source_table: "legacy.urunler",
        source_id: "7",
        target_table: "products",
        mapping_role: "primary",
        target_id: "prd_missing",
      }],
    });

    expect(checks).toContainEqual(expect.objectContaining({
      name: "legacy_id_map.source_coverage.products",
      status: "passed",
    }));
    expect(checks).toContainEqual(expect.objectContaining({
      name: "legacy_id_map.target_references",
      status: "failed",
      actual: 1,
    }));
  });

  it("keeps malformed same-run mappings visible and fails the foundation rules", () => {
    const checks = verifyLegacyIdMapCoverage({
      runId: "run_2026_09",
      sourceManifest: manifest({ customers: 1 }),
      targetPublicIds: targetPublicIds({ customers: ["cus_1"] }),
      customers: [],
      customerExternalIdentities: [],
      conversations: [],
      messages: [],
      orders: [],
      orderItems: [],
      shipments: [],
      legacyIdMaps: [
        {
          run_id: "run_2026_09",
          source_system: "unexpected_source",
          source_table: "legacy.musteriler",
          source_id: "1",
          target_table: "customers",
          mapping_role: "primary",
          target_id: "cus_1",
        },
        {
          run_id: "run_2026_09",
          source_system: "legacy_postgres",
          source_table: "legacy.unexpected_table",
          source_id: "2",
          target_table: "unknown_targets",
          mapping_role: "synthetic",
          target_id: "unknown_1",
        },
      ],
    });

    expect(checks).toContainEqual(expect.objectContaining({
      name: "legacy_id_map.foundation_rules",
      status: "failed",
      actual: 2,
    }));
    expect(checks).toContainEqual(expect.objectContaining({
      name: "legacy_id_map.target_references",
      status: "failed",
      actual: 1,
    }));
  });

  it("fails manifest integrity before deriving row-count checks", () => {
    const invalidManifest = { ...manifest({ customers: 1 }), sourceManifestHash: "sha256:invalid" };
    expect(verifySourceManifestIntegrity(invalidManifest)).toMatchObject({ status: "failed" });

    const report = createMigrationVerificationReport({
      runId: "run_2026_09",
      sourceManifest: invalidManifest,
      targetPublicIds: targetPublicIds({ customers: ["cus_1"] }),
      customers: [{ public_id: "cus_1", phone: null, email: null }],
      customerExternalIdentities: [],
      conversations: [],
      messages: [],
      orders: [],
      orderItems: [],
      shipments: [],
      legacyIdMaps: [],
    });

    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "source_manifest.integrity",
      status: "failed",
    }));
    expect(report.checks.some((check) => check.name.includes("coverage.customers"))).toBe(false);
  });

  it.each([
    ["duplicate entity", (value: SourceManifest) => ({
      ...value,
      tables: [...value.tables.slice(0, -1), value.tables[0]!],
      rowCounts: [...value.rowCounts.slice(0, -1), value.rowCounts[0]!],
    })],
    ["unknown entity", (value: SourceManifest) => ({
      ...value,
      tables: [...value.tables.slice(0, -1), { ...value.tables.at(-1)!, entity: "unknown_entity" }],
      rowCounts: [...value.rowCounts.slice(0, -1), { ...value.rowCounts.at(-1)!, entity: "unknown_entity" }],
    })],
    ["disagreeing sets", (value: SourceManifest) => ({
      ...value,
      tables: [...value.tables.slice(0, -1), value.tables[0]!],
    })],
    ["missing row content entity", (value: SourceManifest) => ({
      ...value,
      rowContentChecksums: value.rowCounts.slice(1).map(({ entity, rows }) => ({
        entity,
        rows,
        checksum: `sha256:${entity}`,
      })),
    })],
    ["duplicate row content entity", (value: SourceManifest) => ({
      ...value,
      rowContentChecksums: [
        ...value.rowCounts.slice(0, -1).map(({ entity, rows }) => ({
          entity,
          rows,
          checksum: `sha256:${entity}`,
        })),
        {
          entity: value.rowCounts[0]!.entity,
          rows: value.rowCounts[0]!.rows,
          checksum: `sha256:${value.rowCounts[0]!.entity}`,
        },
      ],
    })],
    ["unknown row content entity", (value: SourceManifest) => ({
      ...value,
      rowContentChecksums: [
        ...value.rowCounts.slice(0, -1).map(({ entity, rows }) => ({
          entity,
          rows,
          checksum: `sha256:${entity}`,
        })),
        {
          entity: "unknown_entity",
          rows: 0,
          checksum: "sha256:unknown",
        },
      ],
    })],
  ])("fails source manifest entity coverage for a %s", (_case, mutate) => {
    const changed = mutate(manifest({}));
    const invalid = {
      ...changed,
      sourceManifestHash: calculateSourceManifestHash(changed),
    } as SourceManifest;

    expect(verifySourceManifestEntityCoverage(invalid)).toMatchObject({
      name: "source_manifest.entity_coverage",
      status: "failed",
      actual: 0,
    });
  });

  it("accepts a manifest containing its planned entities exactly once in both sets", () => {
    expect(verifySourceManifestEntityCoverage(manifest({ customers: 1 }))).toMatchObject({
      status: "passed",
      actual: 1,
    });
    const base = manifest({ customers: 1 });
    const changed = {
      ...base,
      tables: base.tables.filter((table) => table.entity === "customers"),
      rowCounts: base.rowCounts.filter((count) => count.entity === "customers"),
    };
    expect(verifySourceManifestEntityCoverage({
      ...changed,
      sourceManifestHash: calculateSourceManifestHash(changed),
    })).toMatchObject({
      status: "passed",
      actual: 1,
    });
  });

  it("creates a failed report for orphan, duplicate, ordering, and total issues", () => {
    const report = createMigrationVerificationReport({
      runId: "run_2026_09",
      sourceManifest: manifest({ customers: 2, orders: 1 }),
      targetPublicIds: targetPublicIds({ customers: ["cus_1", "cus_2"], orders: ["ord_1"] }),
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
          run_id: "run_2026_09",
          source_system: "legacy_postgres",
          source_table: "legacy.musteriler",
          source_id: "1",
          target_table: "customers",
          mapping_role: "primary",
          target_id: "cus_1",
        },
        {
          run_id: "run_2026_09",
          source_system: "legacy_postgres",
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
    expect(report.totals.failed).toBe(8);
    expect(report.checks.map((check) => check.name)).toContain("referential_integrity.shipments");
    expect(report.generatedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

function manifest(counts: Record<string, number>): SourceManifest {
  const manifestWithoutHash = {
    sourceSystem: "legacy_postgres",
    databaseIdentity: { host: "source", port: "5432", database: "legacy" },
    tables: canonicalMigrationEntities.map((entity) => ({
      entity,
      schema: "legacy",
      table: sourceTableName(entity),
      idColumn: "id",
      columns: [],
    })),
    rowCounts: canonicalMigrationEntities.map((entity) => ({
      entity,
      rows: counts[entity] ?? 0,
    })),
    batchSize: 500,
    mappingCatalogVersion: "p1-foundation-v1",
    planFingerprint: "sha256:plan",
  };
  return { ...manifestWithoutHash, sourceManifestHash: calculateSourceManifestHash(manifestWithoutHash) };
}

function targetPublicIds(
  overrides: Partial<Record<MigrationEntity, readonly string[]>> = {},
): Record<MigrationEntity, readonly string[]> {
  return Object.fromEntries(
    canonicalMigrationEntities.map((entity) => [entity, overrides[entity] ?? []]),
  ) as Record<MigrationEntity, readonly string[]>;
}

function sourceTableName(entity: MigrationEntity): string {
  const names: Partial<Record<MigrationEntity, string>> = {
    customers: "musteriler",
    customer_external_identities: "musteri_hesaplari",
    orders: "siparisler",
    order_items: "siparis_kalemleri",
    products: "urunler",
  };
  return names[entity] ?? entity;
}
