import { describe, expect, it } from "vitest";
import { canonicalMigrationEntities } from "../src/plan.js";
import { calculateSourceManifestHash } from "../src/source-manifest.js";
import { createTargetVerificationSnapshot } from "../src/target-snapshot.js";
import type { MigrationEntity, SourceManifest } from "../src/types.js";
import { createMigrationVerificationReport } from "../src/verify.js";

describe("target verification snapshot", () => {
  it("reads all run mappings and bounds canonical target lookups to referenced ids", async () => {
    const queries: string[] = [];
    const persistedManifest = manifest();
    const client = {
      query: async (sql: string, parameters?: unknown[]) => {
        queries.push(sql);
        if (sql.includes("from migration_runs")) {
          expect(parameters).toEqual(["run_2026_09"]);
          return {
            rows: [{
              source_system: "legacy_postgres",
              source_database_identity: { host: "source", port: "5432", database: "legacy" },
              table_snapshot: persistedManifest.tables,
              row_counts: persistedManifest.rowCounts,
              row_content_checksums: persistedManifest.rowContentChecksums,
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
            customer_external_identities: "cei_1",
            conversations: "cnv_1",
            messages: "msg_1",
            orders: "ord_1",
            order_items: "oit_1",
            shipments: "shp_1",
          };
          expect(parameters).toEqual([publicIdTable === "customers"
            ? ["cus_1", "cus_malformed"]
            : [publicIds[publicIdTable]]]);
          return { rows: [{ public_id: publicIds[publicIdTable] }] };
        }
        if (sql.includes("from customers where")) {
          expect(parameters).toEqual([["cus_1"]]);
          return { rows: [{ public_id: "cus_1", phone: "555", email: "customer@example.com" }] };
        }
        if (sql.includes("from customer_external_identities")) {
          expect(parameters).toEqual([["cei_1"]]);
          return {
            rows: [
              {
                public_id: "cei_1",
                customer_public_id: "cus_1",
                integration_account_public_id: "ina_1",
                external_id: "42",
              },
            ],
          };
        }
        if (sql.includes("from conversations")) {
          expect(parameters).toEqual([["cnv_1"]]);
          return {
            rows: [
              {
                public_id: "cnv_1",
                customer_public_id: "cus_1",
                integration_account_public_id: "ina_1",
                has_integration_account: true,
              },
            ],
          };
        }
        if (sql.includes("from messages")) {
          expect(parameters).toEqual([["msg_1"]]);
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
                quantity: "1",
                unit_price: "10.00",
                total_amount: "10.00",
              },
            ],
          };
        }
        if (sql.includes("from shipments")) {
          expect(parameters).toEqual([["shp_1"]]);
          return { rows: [{ public_id: "shp_1", order_public_id: "ord_1", customer_public_id: "cus_1" }] };
        }
        if (sql.includes("from legacy_id_map")) {
          expect(parameters).toEqual(["run_2026_09"]);
          return {
            rows: [
              ...[
                ["customers", "cus_1"],
                ["customer_external_identities", "cei_1"],
                ["conversations", "cnv_1"],
                ["messages", "msg_1"],
                ["orders", "ord_1"],
                ["order_items", "oit_1"],
                ["shipments", "shp_1"],
              ].map(([entity, targetId], index) => ({
                run_id: "run_2026_09",
                source_system: "legacy_postgres",
                source_table: `legacy.${entity}`,
                source_id: String(index + 1),
                target_table: entity,
                mapping_role: "primary",
                target_id: targetId,
              })),
              {
                run_id: "run_2026_09",
                source_system: "unexpected_source",
                source_table: "legacy.unexpected_table",
                source_id: "99",
                target_table: "customers",
                mapping_role: "primary",
                target_id: "cus_malformed",
              },
            ],
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      },
    };

    const snapshot = await createTargetVerificationSnapshot(client as never, "run_2026_09");

    expect(queries).toHaveLength(16);
    expect(queries.filter((query) => query.startsWith("select public_id from") && query.includes("where public_id = any"))).toEqual([
      "select public_id from customers where public_id = any($1::text[]) order by id asc",
      "select public_id from customer_external_identities where public_id = any($1::text[]) order by id asc",
      "select public_id from conversations where public_id = any($1::text[]) order by id asc",
      "select public_id from messages where public_id = any($1::text[]) order by id asc",
      "select public_id from orders where public_id = any($1::text[]) order by id asc",
      "select public_id from order_items where public_id = any($1::text[]) order by id asc",
      "select public_id from shipments where public_id = any($1::text[]) order by id asc",
    ]);
    expect(queries.some((query) => /^select public_id from [a-z_]+ order by/.test(query))).toBe(false);
    expect(canonicalMigrationEntities).toHaveLength(15);
    expect(snapshot.sourceManifest?.rowCounts).toHaveLength(15);
    expect(snapshot.sourceManifest?.rowContentChecksums).toEqual([{
      entity: "customers",
      rows: 1,
      checksum: "sha256:rows",
    }]);
    expect(snapshot.targetPublicIds.customers).toEqual(["cus_1"]);
    expect(snapshot.targetPublicIds.orders).toEqual(["ord_1"]);
    expect(snapshot.targetPublicIds.products).toEqual([]);
    expect(snapshot.customerExternalIdentities[0]?.external_id).toBe("42");
    expect(snapshot.customerExternalIdentities[0]?.integration_account_public_id).toBe("ina_1");
    expect(snapshot.conversations[0]?.integration_account_public_id).toBe("ina_1");
    expect(snapshot.messages[0]?.sent_at).toBe("2026-01-01T00:00:00.000Z");
    expect(snapshot.orderItems[0]?.public_id).toBe("oit_1");
    expect(snapshot.orderItems[0]?.quantity).toBe(1);
    expect(snapshot.legacyIdMaps).toHaveLength(8);
    expect(snapshot.legacyIdMaps?.every((entry) => entry.run_id === "run_2026_09")).toBe(true);
    expect(snapshot.legacyIdMaps?.some((entry) => entry.source_system === "unexpected_source")).toBe(true);
    expect(createMigrationVerificationReport(snapshot).checks).toContainEqual(expect.objectContaining({
      name: "legacy_id_map.foundation_rules",
      status: "failed",
      actual: 1,
    }));
  });

  it("skips rich verification queries when the run references no target ids", async () => {
    const queries: string[] = [];
    const persistedManifest = manifest();
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes("from migration_runs")) {
          return { rows: [{
            source_system: persistedManifest.sourceSystem,
            source_database_identity: persistedManifest.databaseIdentity,
            table_snapshot: persistedManifest.tables,
            row_counts: persistedManifest.rowCounts,
            row_content_checksums: persistedManifest.rowContentChecksums,
            batch_size: persistedManifest.batchSize,
            mapping_catalog_version: persistedManifest.mappingCatalogVersion,
            plan_fingerprint: persistedManifest.planFingerprint,
            source_manifest_hash: persistedManifest.sourceManifestHash,
          }] };
        }
        if (sql.includes("from legacy_id_map")) return { rows: [] };
        throw new Error(`Unexpected full-table query: ${sql}`);
      },
    };

    const snapshot = await createTargetVerificationSnapshot(client as never, "run_empty");

    expect(queries).toHaveLength(2);
    expect(snapshot.customers).toEqual([]);
    expect(snapshot.customerExternalIdentities).toEqual([]);
    expect(snapshot.conversations).toEqual([]);
    expect(snapshot.messages).toEqual([]);
    expect(snapshot.orders).toEqual([]);
    expect(snapshot.orderItems).toEqual([]);
    expect(snapshot.shipments).toEqual([]);
  });
});

function manifest(): SourceManifest {
  const manifestWithoutHash = {
    sourceSystem: "legacy_postgres",
    databaseIdentity: { host: "source", port: "5432", database: "legacy" },
    tables: canonicalMigrationEntities.map((entity) => sourceTable(entity, entity)),
    rowCounts: canonicalMigrationEntities.map((entity) => ({
      entity,
      rows: ["customers", "customer_external_identities", "conversations", "messages", "orders", "order_items", "shipments"].includes(entity) ? 1 : 0,
    })),
    rowContentChecksums: [{
      entity: "customers" as const,
      rows: 1,
      checksum: "sha256:rows",
    }],
    batchSize: 500,
    mappingCatalogVersion: "p1-foundation-v1",
    planFingerprint: "sha256:plan",
  };
  return { ...manifestWithoutHash, sourceManifestHash: calculateSourceManifestHash(manifestWithoutHash) };
}

function sourceTable(entity: MigrationEntity, table: string) {
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
