import { verifyShortcutMediaMappings, type VerificationShortcutAttachment } from "./communication-verify.js";
import { conversationMergedIntoMappingRole } from "./conversation-merge.js";
import { createVerificationReport } from "./reports.js";
import { canonicalMigrationEntities } from "./plan.js";
import { calculateSourceManifestHash } from "./source-manifest.js";
import type { MigrationEntity, SourceManifest, VerificationCheck, VerificationReport } from "./types.js";

export interface MigrationVerificationSnapshot {
  readonly shortcutAttachments?: VerificationShortcutAttachment[];
  readonly communicationChecks?: VerificationCheck[];
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
  /** Source rows apply skipped on purpose per entity (e.g. future-dated tracking rows), from migration_batches. */
  readonly skippedSourceRows?: Partial<Record<MigrationEntity, number>>;
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
  readonly manual_adjustment_amount?: string | null;
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
      verifyShortcutMediaMappings(snapshot),
      ...(snapshot.communicationChecks ?? []),
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

  const itemTotals = new Map<string, number>();
  for (const item of items) {
    itemTotals.set(item.order_public_id, (itemTotals.get(item.order_public_id) ?? 0) + moneyToCents(item.total_amount));
  }
  for (const order of orders) {
    const itemTotal = itemTotals.get(order.public_id);
    // Item-less legacy orders keep their own total (owner decision 9c); there is nothing to reconcile.
    if (itemTotal === undefined) continue;
    // The legacy order total is authoritative; the difference lives in manual_adjustment_amount (decision 9a).
    const adjustment = moneyToCents(order.manual_adjustment_amount ?? "0");
    if (moneyToCents(order.total_amount) !== itemTotal + adjustment) {
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
        isCoverageMappingRole(entity as MigrationEntity, entry.mapping_role),
    );
    // Merged-away legacy conversations map to their winner instead of owning a target row:
    // source rows = distinct primary targets + merged-away rows.
    const mergedAwayMaps = entity === "conversations"
      ? scopedMaps.filter(
        (entry) =>
          entry.source_system === manifest?.sourceSystem &&
          sourceTables.has(entry.source_table) &&
          entry.target_table === targetTable &&
          entry.mapping_role === conversationMergedIntoMappingRole,
      )
      : [];
    const distinctSourceIds = new Set([...expectedPrimaryMaps, ...mergedAwayMaps].map((entry) => entry.source_id)).size;
    const distinctTargetIds = new Set(expectedPrimaryMaps.map((entry) => entry.target_id)).size;
    const mergedAwaySourceIds = new Set(mergedAwayMaps.map((entry) => entry.source_id)).size;
    // Only tracking events skip source rows by design (future-dated); merged-away conversations are counted above.
    const skipped = entity === "shipment_tracking_events" ? snapshot.skippedSourceRows?.shipment_tracking_events ?? 0 : 0;
    return [
      countCheck(`legacy_id_map.source_coverage.${entity}`, expected - skipped, distinctSourceIds),
      countCheck(`legacy_id_map.target_coverage.${entity}`, expected - skipped - mergedAwaySourceIds, distinctTargetIds),
    ];
  });

  return [
    verifyLegacyIdMapFoundationRules(snapshot),
    ...countChecks,
    verifyMergedConversationTargets(snapshot),
    verifyLegacyIdMapTargetReferences(snapshot),
  ];
}

/**
 * Every merged-away conversation must point at a conversation that is itself a primary migrated row
 * of the same run, and no legacy conversation may be both primary and merged away.
 */
function verifyMergedConversationTargets(snapshot: MigrationVerificationSnapshot): VerificationCheck {
  const scopedMaps = (snapshot.legacyIdMaps ?? []).filter(
    (entry) => entry.run_id === snapshot.runId && entry.target_table === "conversations",
  );
  const primaryTargets = new Set(
    scopedMaps.filter((entry) => entry.mapping_role === "primary").map((entry) => entry.target_id),
  );
  const primarySources = new Set(
    scopedMaps.filter((entry) => entry.mapping_role === "primary").map((entry) => entry.source_id),
  );
  const invalidCount = scopedMaps.filter(
    (entry) =>
      entry.mapping_role === conversationMergedIntoMappingRole &&
      (!primaryTargets.has(entry.target_id) || primarySources.has(entry.source_id)),
  ).length;

  return countCheck("legacy_id_map.merged_conversations", 0, invalidCount);
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

  return tableEntities.length > 0 &&
    tableEntities.length === rowCountEntities.length &&
    tableSet.size === tableEntities.length &&
    rowCountSet.size === rowCountEntities.length &&
    (rowContentEntities === null || rowContentSet?.size === rowContentEntities.length) &&
    tableEntities.every((entity) =>
      rowCountSet.has(entity) &&
      (rowContentSet === null || rowContentSet.has(entity))) &&
    rowCountEntities.every((entity) =>
      tableSet.has(entity) &&
      (rowContentSet === null || rowContentSet.has(entity))) &&
    (rowContentEntities === null || rowContentEntities.every((entity) => tableSet.has(entity) && rowCountSet.has(entity))) &&
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
      return sourceTables.has(entry.source_table) && isAllowedLegacyIdMapForEntity(entity, entry);
    });
  }).length ?? 0;

  return countCheck("legacy_id_map.foundation_rules", 0, invalidCount);
}

/** Deduplicated tracking events map per event group ("provider"/"first_seen"), not "primary". */
const trackingEventMappingRoles = new Set(["provider", "first_seen"]);

function isCoverageMappingRole(entity: MigrationEntity, mappingRole: string): boolean {
  return entity === "shipment_tracking_events" ? trackingEventMappingRoles.has(mappingRole) : mappingRole === "primary";
}

function isAllowedLegacyIdMapForEntity(entity: MigrationEntity, entry: VerificationLegacyIdMapEntry): boolean {
  if (entry.target_table === legacyEntityTargetTable(entity) && isCoverageMappingRole(entity, entry.mapping_role)) return true;
  if (entity === "message_shortcuts") {
    return (entry.target_table === "files" && /^media:\d+$/.test(entry.mapping_role))
      || (entry.target_table === "message_shortcut_attachments" && /^attachment:\d+$/.test(entry.mapping_role));
  }
  if (entity === "customers") {
    return (entry.target_table === "customer_addresses" && entry.mapping_role === "address:default")
      || (entry.target_table === "customer_external_identities"
        && entry.mapping_role.startsWith("external_identity:"));
  }
  if (entity === "orders") {
    return (entry.target_table === "orders" && entry.mapping_role.startsWith("tracking_number:"))
      || (entry.target_table === "customers" && entry.mapping_role === "synthetic_customer")
      || (entry.target_table === "customer_addresses" && entry.mapping_role === "synthetic_customer_address");
  }
  if (entity === "conversations") {
    return entry.target_table === "conversations" && entry.mapping_role === conversationMergedIntoMappingRole;
  }
  return false;
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
    message_shortcuts: "message_shortcuts",
    message_shortcut_attachments: "message_shortcut_attachments",
    sms_messages: "sms_messages",
    vapi_calls: "vapi_calls",
    call_logs: "call_logs",
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
