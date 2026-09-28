import { describe, expect, it } from "vitest";
import { canonicalMigrationEntities } from "../../apps/migrator/src/plan.js";
import { calculateSourceManifestHash } from "../../apps/migrator/src/source-manifest.js";
import { createTargetVerificationSnapshot } from "../../apps/migrator/src/target-snapshot.js";
import type { MigrationEntity, SourceManifest } from "../../apps/migrator/src/types.js";
import { createMigrationVerificationReport } from "../../apps/migrator/src/verify.js";

describe("migration gate", () => {
  it("keeps migration execution manual-only", () => {
    expect(["migrate --dry-run", "migrate --apply", "verify"]).toContain("migrate --apply");
  });

  it("fails verification reports when migrated relation checks do not pass", () => {
    const report = createMigrationVerificationReport({
      runId: "run_2026_09",
      sourceManifest: sourceManifest({ customers: 1 }),
      targetPublicIds: targetPublicIds({ customers: ["cus_1"] }),
      customers: [{ public_id: "cus_1", phone: null, email: "customer@example.com" }],
      customerExternalIdentities: [],
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
    const persistedManifest = sourceManifest({ customers: 1, orders: 1, order_items: 1 });
    const client = {
      query: async (sql: string, parameters?: unknown[]) => {
        if (sql.includes("from migration_runs")) {
          return {
            rows: [{
              source_system: "legacy_postgres",
              source_database_identity: { host: "source", port: "5432", database: "legacy" },
              table_snapshot: persistedManifest.tables,
              row_counts: persistedManifest.rowCounts,
              batch_size: 500,
              mapping_catalog_version: "p1-foundation-v1",
              plan_fingerprint: "sha256:plan",
              source_manifest_hash: persistedManifest.sourceManifestHash,
            }],
          };
        }
        const publicIdTable = sql.match(
          /^select public_id from ([a-z_]+) where public_id = any\(\$1::text\[\]\) order by id asc$/,
        )?.[1];
        if (publicIdTable) {
          const publicIds: Record<string, string> = {
            customers: "cus_1",
            conversations: "cnv_1",
            messages: "msg_1",
            orders: "ord_1",
            order_items: "oit_1",
            shipments: "shp_1",
          };
          expect(parameters).toEqual([[publicIds[publicIdTable]]]);
          return { rows: [{ public_id: publicIds[publicIdTable] }] };
        }
        if (sql.includes("from customers where")) {
          expect(parameters).toEqual([["cus_1"]]);
          return { rows: [{ public_id: "cus_1", phone: "555", email: "customer@example.com" }] };
        }
        if (sql.includes("from customer_external_identities")) {
          return { rows: [] };
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
          expect(parameters).toEqual([["ord_1"]]);
          return { rows: [{ public_id: "ord_1", customer_public_id: "cus_1", total_amount: "10.00" }] };
        }
        if (sql.includes("from order_items")) {
          expect(parameters).toEqual([["oit_1"]]);
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
          expect(parameters).toEqual(["run_2026_09"]);
          return {
            rows: [
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
              {
                run_id: "run_2026_09",
                source_system: "legacy_postgres",
                source_table: "legacy.siparis_kalemleri",
                source_id: "11",
                target_table: "order_items",
                mapping_role: "primary",
                target_id: "oit_1",
              },
            ],
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      },
    };

    const report = createMigrationVerificationReport(
      await createTargetVerificationSnapshot(client as never, "run_2026_09"),
    );

    expect(report.status).toBe("passed");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "legacy_id_map.source_coverage.customers",
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
        name: "legacy_id_map.source_coverage.order_items",
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

function sourceManifest(counts: Record<string, number>): SourceManifest {
  const manifestWithoutHash = {
    sourceSystem: "legacy_postgres",
    databaseIdentity: { host: "source", port: "5432", database: "legacy" },
    tables: canonicalMigrationEntities.map((entity) => sourceTable(
      entity,
      { customers: "musteriler", orders: "siparisler", order_items: "siparis_kalemleri" }[entity] ?? entity,
    )),
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

function sourceTable(
  entity: MigrationEntity,
  table: string,
): SourceManifest["tables"][number] {
  return {
    entity,
    schema: "legacy",
    table,
    idColumn: "id",
    columns: [{
      name: "id",
      ordinalPosition: 1,
      dataType: "bigint",
      udtName: "int8",
      nullable: false,
    }],
  };
}
