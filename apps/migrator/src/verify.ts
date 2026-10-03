import { createVerificationReport } from "./reports.js";
import { canonicalMigrationEntities } from "./plan.js";
import { calculateSourceManifestHash } from "./source-manifest.js";
import type { MigrationEntity, SourceManifest, VerificationCheck, VerificationReport } from "./types.js";

export interface MigrationVerificationSnapshot {
  readonly runId: string;
  readonly sourceManifest: SourceManifest | null;
  readonly targetPublicIds: Record<MigrationEntity, readonly string[]>;
  readonly customers: VerificationCustomer[];
  readonly customerExternalIdentities: VerificationCustomerExternalIdentity[];
  readonly conversations: VerificationConversation[];
  readonly messages: VerificationMessage[];
  readonly orders: VerificationOrder[];
  readonly orderItems: VerificationOrderItem[];
  readonly shipments: VerificationShipment[];
  readonly legacyIdMaps?: VerificationLegacyIdMapEntry[];
  readonly now?: Date;
}

export interface VerificationCustomer {
  readonly public_id: string;
  readonly phone: string | null;
  readonly email: string | null;
}

export interface VerificationCustomerExternalIdentity {
  readonly public_id: string;
  readonly customer_public_id: string | null;
  readonly integration_account_public_id: string | null;
  readonly external_id: string;
}

export interface VerificationConversation {
  readonly public_id: string;
  readonly customer_public_id: string | null;
  readonly integration_account_public_id: string | null;
  readonly has_integration_account: boolean;
}

export interface VerificationMessage {
  readonly public_id: string;
  readonly conversation_public_id: string;
  readonly sent_at: string;
}

export interface VerificationOrder {
  readonly public_id: string;
  readonly customer_public_id: string | null;
  readonly total_amount: string;
}

export interface VerificationOrderItem {
  readonly public_id: string;
  readonly order_public_id: string;
  readonly quantity: number;
  readonly unit_price: string;
  readonly total_amount: string;
}

export interface VerificationShipment {
  readonly public_id: string;
  readonly order_public_id: string | null;
  readonly customer_public_id: string | null;
}

export interface VerificationLegacyIdMapEntry {
  readonly run_id: string;
  readonly source_system: string;
  readonly source_table: string;
  readonly source_id: string;
  readonly target_table: string;
  readonly mapping_role: string;
  readonly target_id: string;
}

export function createMigrationVerificationReport(
  snapshot: MigrationVerificationSnapshot,
): VerificationReport {
  return createVerificationReport({
    checks: [
      verifySourceManifestPresence(snapshot.sourceManifest),
      verifySourceManifestIntegrity(snapshot.sourceManifest),
      verifySourceManifestEntityCoverage(snapshot.sourceManifest),
      verifyCustomerExternalIdentityReferences(snapshot),
      verifyConversationCustomers(snapshot),
      verifyConversationIntegrationAccounts(snapshot),
      verifyMessageConversations(snapshot),
      verifyOrderCustomers(snapshot),
      verifyShipmentReferences(snapshot),
      verifyDuplicateCustomers(snapshot.customers),
      verifyMessageOrdering(snapshot.messages),
      verifyOrderTotals(snapshot.orders, snapshot.orderItems),
      ...verifyLegacyIdMapCoverage(snapshot),
    ],
    ...(snapshot.now ? { now: snapshot.now } : {}),
  });
}

export function verifySourceManifestPresence(manifest: SourceManifest | null): VerificationCheck {
  return countCheck("source_manifest.present", 1, manifest ? 1 : 0);
}

export function verifySourceManifestIntegrity(manifest: SourceManifest | null): VerificationCheck {
  const valid = isSourceManifestIntegrityValid(manifest);
  return {
    name: "source_manifest.integrity",
    status: valid ? "passed" : "failed",
    expected: 1,
    actual: valid ? 1 : 0,
    ...(valid ? {} : { message: "Persisted source manifest hash does not match its contents" }),
  };
}

export function verifySourceManifestEntityCoverage(manifest: SourceManifest | null): VerificationCheck {
  const valid = isSourceManifestIntegrityValid(manifest) && hasCompleteManifestEntityCoverage(manifest);
  return {
    name: "source_manifest.entity_coverage",
    status: valid ? "passed" : "failed",
    expected: 1,
    actual: valid ? 1 : 0,
    ...(valid ? {} : {
      message: "Persisted source manifest tables, rowCounts, and optional rowContentChecksums must each contain every canonical entity exactly once",
    }),
  };
}

export function verifyCustomerExternalIdentityReferences(
  snapshot: MigrationVerificationSnapshot,
): VerificationCheck {
  const customerIds = new Set(snapshot.customers.map((customer) => customer.public_id));
  const orphanCount = snapshot.customerExternalIdentities.filter((identity) => {
    const missingCustomer =
      identity.customer_public_id === null || !customerIds.has(identity.customer_public_id);
    const missingIntegrationAccount = identity.integration_account_public_id === null;
    return missingCustomer || missingIntegrationAccount;
  }).length;

  return countCheck("referential_integrity.customer_external_identities", 0, orphanCount);
}

export function verifyConversationCustomers(snapshot: MigrationVerificationSnapshot): VerificationCheck {
  const customerIds = new Set(snapshot.customers.map((customer) => customer.public_id));
  const orphanCount = snapshot.conversations.filter(
    (conversation) =>
      conversation.customer_public_id !== null && !customerIds.has(conversation.customer_public_id),
  ).length;

  return countCheck("referential_integrity.conversations.customer", 0, orphanCount);
}

export function verifyConversationIntegrationAccounts(
  snapshot: MigrationVerificationSnapshot,
): VerificationCheck {
  const orphanCount = snapshot.conversations.filter(
    (conversation) =>
      conversation.has_integration_account && conversation.integration_account_public_id === null,
  ).length;

  return countCheck("referential_integrity.conversations.integration_account", 0, orphanCount);
}

export function verifyMessageConversations(snapshot: MigrationVerificationSnapshot): VerificationCheck {
  const conversationIds = new Set(snapshot.conversations.map((conversation) => conversation.public_id));
  const orphanCount = snapshot.messages.filter(
    (message) => !conversationIds.has(message.conversation_public_id),
  ).length;

  return countCheck("referential_integrity.messages.conversation", 0, orphanCount);
}

export function verifyOrderCustomers(snapshot: MigrationVerificationSnapshot): VerificationCheck {
  const customerIds = new Set(snapshot.customers.map((customer) => customer.public_id));
  const orphanCount = snapshot.orders.filter(
    (order) => order.customer_public_id !== null && !customerIds.has(order.customer_public_id),
  ).length;

  return countCheck("referential_integrity.orders.customer", 0, orphanCount);
}

export function verifyShipmentReferences(snapshot: MigrationVerificationSnapshot): VerificationCheck {
  const customerIds = new Set(snapshot.customers.map((customer) => customer.public_id));
  const orderIds = new Set(snapshot.orders.map((order) => order.public_id));
  const orphanCount = snapshot.shipments.filter((shipment) => {
    const missingOrder = shipment.order_public_id !== null && !orderIds.has(shipment.order_public_id);
    const missingCustomer =
      shipment.customer_public_id !== null && !customerIds.has(shipment.customer_public_id);
    return missingOrder || missingCustomer;
  }).length;

  return countCheck("referential_integrity.shipments", 0, orphanCount);
}

export function verifyDuplicateCustomers(customers: VerificationCustomer[]): VerificationCheck {
  const seen = new Set<string>();
  let duplicateCount = 0;

  for (const customer of customers) {
    const identity = customer.email?.toLowerCase() ?? customer.phone ?? customer.public_id;
    if (seen.has(identity)) {
      duplicateCount += 1;
    }
    seen.add(identity);
  }

  return countCheck("duplicates.customers", 0, duplicateCount);
}

export function verifyMessageOrdering(messages: VerificationMessage[]): VerificationCheck {
  const byConversation = new Map<string, VerificationMessage[]>();
  for (const message of messages) {
    byConversation.set(message.conversation_public_id, [
      ...(byConversation.get(message.conversation_public_id) ?? []),
      message,
    ]);
  }

  let outOfOrderCount = 0;
  for (const conversationMessages of byConversation.values()) {
    for (let index = 1; index < conversationMessages.length; index += 1) {
      const previous = Date.parse(conversationMessages[index - 1]?.sent_at ?? "");
      const current = Date.parse(conversationMessages[index]?.sent_at ?? "");
      if (Number.isNaN(previous) || Number.isNaN(current) || current < previous) {
        outOfOrderCount += 1;
      }
    }
  }

  return countCheck("ordering.messages", 0, outOfOrderCount);
}

export function verifyOrderTotals(
  orders: VerificationOrder[],
  items: VerificationOrderItem[],
): VerificationCheck {
  let mismatchCount = 0;

  for (const order of orders) {
    const itemTotal = items
      .filter((item) => item.order_public_id === order.public_id)
      .reduce((sum, item) => sum + moneyToCents(item.total_amount), 0);
    if (moneyToCents(order.total_amount) !== itemTotal) {
      mismatchCount += 1;
    }
  }

  return countCheck("totals.orders", 0, mismatchCount);
}

export function verifyLegacyIdMapCoverage(snapshot: MigrationVerificationSnapshot): VerificationCheck[] {
  if (!snapshot.legacyIdMaps) {
    return [countCheck("legacy_id_map.available", 1, 0)];
  }

  const manifest = snapshot.sourceManifest;
  const scopedMaps = snapshot.legacyIdMaps.filter((entry) => entry.run_id === snapshot.runId);
  const countChecks = Object.entries(trustedSourceCountsFromManifest(manifest)).flatMap(([entity, expected]) => {
    const targetTable = legacyEntityTargetTable(entity);
    const sourceTables = manifestSourceTableIdentities(manifest, entity);
    const expectedPrimaryMaps = scopedMaps.filter(
      (entry) =>
        entry.source_system === manifest?.sourceSystem &&
        sourceTables.has(entry.source_table) &&
        entry.target_table === targetTable &&
        entry.mapping_role === "primary",
    );
    const distinctSourceIds = new Set(expectedPrimaryMaps.map((entry) => entry.source_id)).size;
    const distinctTargetIds = new Set(expectedPrimaryMaps.map((entry) => entry.target_id)).size;
    return [
      countCheck(`legacy_id_map.source_coverage.${entity}`, expected, distinctSourceIds),
      countCheck(`legacy_id_map.target_coverage.${entity}`, expected, distinctTargetIds),
    ];
  });

  return [
    verifyLegacyIdMapFoundationRules(snapshot),
    ...countChecks,
    verifyLegacyIdMapTargetReferences(snapshot),
  ];
}

function trustedSourceCountsFromManifest(manifest: SourceManifest | null): Record<string, number> {
  if (!isSourceManifestIntegrityValid(manifest) || !hasCompleteManifestEntityCoverage(manifest)) return {};
  return Object.fromEntries(manifest?.rowCounts.map(({ entity, rows }) => [entity, rows]) ?? []);
}

function isSourceManifestIntegrityValid(manifest: SourceManifest | null): manifest is SourceManifest {
  return manifest !== null && manifest.sourceManifestHash === calculateSourceManifestHash(manifest);
}

function hasCompleteManifestEntityCoverage(manifest: SourceManifest): boolean {
  const expected = new Set<string>(canonicalMigrationEntities);
  const tableEntities = manifest.tables.map(({ entity }) => entity);
  const rowCountEntities = manifest.rowCounts.map(({ entity }) => entity);
  const rowContentEntities = manifest.rowContentChecksums?.map(({ entity }) => entity) ?? null;
  const tableSet = new Set<string>(tableEntities);
  const rowCountSet = new Set<string>(rowCountEntities);
  const rowContentSet = rowContentEntities ? new Set<string>(rowContentEntities) : null;

  return tableEntities.length === canonicalMigrationEntities.length &&
    rowCountEntities.length === canonicalMigrationEntities.length &&
    (rowContentEntities === null || rowContentEntities.length === canonicalMigrationEntities.length) &&
    tableSet.size === canonicalMigrationEntities.length &&
    rowCountSet.size === canonicalMigrationEntities.length &&
    (rowContentSet === null || rowContentSet.size === canonicalMigrationEntities.length) &&
    canonicalMigrationEntities.every((entity) =>
      tableSet.has(entity) &&
      rowCountSet.has(entity) &&
      (rowContentSet === null || rowContentSet.has(entity))) &&
    [...tableSet].every((entity) => expected.has(entity)) &&
    [...rowCountSet].every((entity) => expected.has(entity)) &&
    (rowContentSet === null || [...rowContentSet].every((entity) => expected.has(entity)));
}

function manifestSourceTableIdentities(manifest: SourceManifest | null, entity: string): Set<string> {
  const table = manifest?.tables.find((candidate) => candidate.entity === entity);
  if (!table) return new Set();
  const qualified = `${table.schema}.${table.table}`;
  return new Set(table.schema === "public" ? [qualified, table.table] : [qualified]);
}

function verifyLegacyIdMapTargetReferences(snapshot: MigrationVerificationSnapshot): VerificationCheck {
  const targetIds = new Map<string, Set<string>>();
  for (const entity of canonicalMigrationEntities) {
    const ids = snapshot.targetPublicIds[entity];
    if (!Array.isArray(ids)) continue;
    targetIds.set(entity, new Set(ids));
  }

  const danglingCount =
    snapshot.legacyIdMaps?.filter((entry) => {
      if (entry.run_id !== snapshot.runId) return false;
      const ids = targetIds.get(entry.target_table);
      return ids === undefined || !ids.has(entry.target_id);
    }).length ?? 0;

  return countCheck("legacy_id_map.target_references", 0, danglingCount);
}

function verifyLegacyIdMapFoundationRules(snapshot: MigrationVerificationSnapshot): VerificationCheck {
  const manifest = snapshot.sourceManifest;
  if (!isSourceManifestIntegrityValid(manifest)) {
    return countCheck("legacy_id_map.foundation_rules", 0, snapshot.legacyIdMaps?.length ?? 0);
  }

  const invalidCount = snapshot.legacyIdMaps?.filter((entry) => {
    if (entry.run_id !== snapshot.runId) return false;
    if (entry.source_system !== manifest.sourceSystem) return true;
    return !manifest.rowCounts.some(({ entity }) => {
      const sourceTables = manifestSourceTableIdentities(manifest, entity);
      return sourceTables.has(entry.source_table) &&
        entry.target_table === legacyEntityTargetTable(entity) &&
        entry.mapping_role === "primary";
    });
  }).length ?? 0;

  return countCheck("legacy_id_map.foundation_rules", 0, invalidCount);
}

function legacyEntityTargetTable(entity: string): string {
  const targetTables = {
    customers: "customers",
    customer_external_identities: "customer_external_identities",
    customer_addresses: "customer_addresses",
    conversations: "conversations",
    messages: "messages",
    products: "products",
    orders: "orders",
    order_items: "order_items",
    shipments: "shipments",
    shipment_tracking_events: "shipment_tracking_events",
    integration_accounts: "integration_accounts",
    integration_settings: "integration_settings",
    webhook_subscriptions: "webhook_subscriptions",
    files: "files",
    settings: "settings",
  } satisfies Record<MigrationEntity, string>;

  return targetTables[entity as MigrationEntity] ?? entity;
}

function countCheck(name: string, expected: number, actual: number): VerificationCheck {
  return {
    name,
    status: actual === expected ? "passed" : "failed",
    expected,
    actual,
    ...(actual === expected ? {} : { message: `${name} expected ${expected}, found ${actual}` }),
  };
}

function moneyToCents(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return Number.NaN;
  }

  return Math.round(parsed * 100);
}
