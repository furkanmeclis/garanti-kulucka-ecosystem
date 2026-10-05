import {
  applyConversationMigrationBatchWithState,
  applyCustomerMigrationBatchWithState,
  applyMessageMigrationBatchWithState,
  applyOrderItemMigrationBatchWithState,
  applyOrderMigrationBatchWithState,
  applyProductMigrationBatchWithState,
  applyShipmentMigrationBatchWithState,
  applyShipmentTrackingEventMigrationBatchWithState,
  reconcileDeferredReconciliations,
  type ApplyConversationMigrationBatchInput,
  type ApplyCustomerMigrationBatchInput,
  type ApplyMessageMigrationBatchInput,
  type ApplyOrderItemMigrationBatchInput,
  type ApplyOrderMigrationBatchInput,
  type ApplyProductMigrationBatchInput,
  type ApplyShipmentMigrationBatchInput,
  type ApplyShipmentTrackingEventMigrationBatchInput,
} from "./apply.js";
import { assertMigrationApplyApproval, type MigrationApplyApproval } from "./apply-approval.js";
import {
  assertVerifiedConversationAccounts,
  legacyConversationTable,
  legacyMessageTable,
  transformLegacyConversation,
  transformLegacyMessage,
  type VerifiedConversationAccount,
} from "./conversation-mapping.js";
import {
  assertVerifiedIntegrationAccounts,
  legacyCustomerTable,
  resolveCustomerExternalIdentities,
  transformLegacyCustomer,
  type UnresolvedCustomerExternalIdentity,
  type VerifiedIntegrationAccount,
} from "./customer-mapping.js";
import { canonicalMigrationEntities, createMigrationPlan } from "./plan.js";
import { legacyOrderItemTable, transformLegacyOrderItem } from "./order-item-mapping.js";
import { legacyOrderTable, transformLegacyOrder } from "./order-mapping.js";
import { legacyProductTable, transformLegacyProduct } from "./product-mapping.js";
import { createDryRunReport } from "./reports.js";
import { legacyShipmentTable, normalizeShipmentTrackingNumber, transformLegacyShipment } from "./shipment-mapping.js";
import type { MigratorMediaStorage } from "./media-storage.js";
import {
  assertApplyPrerequisites,
  createLegacyMappingCatalog,
  dryRunMigrationEntities,
  normalizeSourceTable,
  validateLegacySourceSnapshots,
  type LegacyMappingCatalog,
} from "./mapping-catalog.js";
import { createSourceManifest, createSourceRowContentChecksum, registerMigrationRun } from "./source-manifest.js";
import type {
  ConversationTransformSummary,
  CustomerTransformSummary,
  DryRunReport,
  LegacyRecord,
  LegacySource,
  MessageTransformSummary,
  DeferredReconciliationResult,
  MigrationBatch,
  MigrationBatchApplyResult,
  MigrationEntity,
  MigrationPlan,
  MigrationTarget,
  OrderItemTransformSummary,
  OrderTransformSummary,
  ProductTransformSummary,
  ShipmentTrackingEventTransformSummary,
  ShipmentTransformSummary,
  SourceDatabaseIdentity,
  SourceManifest,
  SourceTableSnapshot,
} from "./types.js";

interface RunMigrationInputBase {
  readonly source: LegacySource;
  readonly mappingCatalog: LegacyMappingCatalog;
  readonly batchSize: number;
  readonly entities?: MigrationEntity[];
  readonly now?: Date;
  readonly sourceSystem: string;
  readonly sourceDatabaseIdentity: SourceDatabaseIdentity;
}

export interface RunMigrationDryRunInput extends RunMigrationInputBase {
  readonly mode: "dry-run";
  readonly integrationAccounts?: readonly VerifiedIntegrationAccount[];
  readonly conversationAccounts?: readonly VerifiedConversationAccount[];
  readonly userPublicIds?: ReadonlyMap<string, string>;
}

export interface RunMigrationApplyInput extends RunMigrationInputBase {
  readonly mode: "apply";
  readonly target: MigrationTarget;
  readonly runId: string;
  readonly applyApproval?: MigrationApplyApproval;
  readonly integrationAccounts?: readonly VerifiedIntegrationAccount[];
  readonly conversationAccounts?: readonly VerifiedConversationAccount[];
  readonly userPublicIds?: ReadonlyMap<string, string>;
  readonly mediaStorage?: MigratorMediaStorage;
}

export type RunMigrationInput = RunMigrationDryRunInput | RunMigrationApplyInput;

export interface MigrationRunResult {
  readonly mode: "dry-run" | "apply";
  readonly runId?: string;
  readonly plan: MigrationPlan;
  readonly sourceManifest: SourceManifest;
  readonly dryRunReport?: DryRunReport;
  readonly batches: MigrationBatchApplyResult[];
  readonly deferredReconciliation?: DeferredReconciliationResult;
}

export async function runMigration(input: RunMigrationInput): Promise<MigrationRunResult> {
  const catalog = createLegacyMappingCatalog(input.mappingCatalog);
  const readyEntities = dryRunMigrationEntities(catalog);
  const requestedEntities = input.entities ?? readyEntities;
  assertDryRunReadyEntitySelection(requestedEntities, readyEntities);
  const entities = orderMigrationEntities(requestedEntities);
  if (input.mode === "apply") {
    assertMigrationApplyApproval(input.applyApproval, { runId: input.runId });
    assertApplyPrerequisites(catalog, entities);
  }

  assertDryRunEntityDependencies(entities);
  const validateCustomerRows = entities.includes("customers");
  const validateConversationRows = entities.includes("conversations");
  const validateMessageRows = entities.includes("messages");
  const validateProductRows = entities.includes("products");
  const validateOrderRows = entities.includes("orders");
  const validateOrderItemRows = entities.includes("order_items");
  const validateShipmentRows = entities.includes("shipments");
  const validateShipmentTrackingEventRows = entities.includes("shipment_tracking_events");
  if (validateCustomerRows) assertEntityRoutesFromLegacyTable(catalog, "customers", legacyCustomerTable, "Customer");
  if (validateConversationRows) {
    assertEntityRoutesFromLegacyTable(catalog, "conversations", legacyConversationTable, "Conversation");
  }
  if (validateMessageRows) assertEntityRoutesFromLegacyTable(catalog, "messages", legacyMessageTable, "Message");
  if (validateProductRows) assertEntityRoutesFromLegacyTable(catalog, "products", legacyProductTable, "Product");
  if (validateOrderRows) assertEntityRoutesFromLegacyTable(catalog, "orders", legacyOrderTable, "Order");
  if (validateOrderItemRows) {
    assertEntityRoutesFromLegacyTable(catalog, "order_items", legacyOrderItemTable, "Order item");
  }
  if (validateShipmentRows) assertEntityRoutesFromLegacyTable(catalog, "shipments", legacyShipmentTable, "Shipment");
  if (validateShipmentTrackingEventRows) {
    assertEntityRoutesFromLegacyTable(catalog, "shipment_tracking_events", legacyShipmentTrackingEventTable, "Shipment tracking event");
  }
  const integrationAccounts = ownIntegrationAccounts(input.integrationAccounts);
  const conversationAccounts = ownConversationAccounts(input.conversationAccounts);
  const userPublicIds = ownUserPublicIds(input.userPublicIds);

  const tables = ownSourceTableSnapshots(await input.source.describeTables(entities));
  validateLegacySourceSnapshots(catalog, tables, entities);
  const plan = await createMigrationPlan({
    source: input.source,
    mode: input.mode,
    batchSize: input.batchSize,
    entities,
    ...(input.now ? { now: input.now } : {}),
  });

  const rowContentRecords = createRowContentRecordMap(entities);
  const source = trackSourceRowContent(input.source, rowContentRecords);

  if (input.mode === "dry-run") {
    const customers = validateCustomerRows
      ? await validateCustomerBatches(source, plan, integrationAccounts)
      : undefined;
    const customerPhoneIndex = customers?.publicIdsByPhone ?? new Map();
    const conversations = validateConversationRows
      ? await validateConversationBatches(source, plan, {
        customerPublicIds: requireDependencyPublicIds(customers, "Conversation", "customers"),
        userPublicIds,
        accounts: conversationAccounts,
      })
      : undefined;
    const messageTransform = validateMessageRows
      ? await validateMessageBatches(
        source,
        plan,
        requireDependencyPublicIds(conversations, "Message", "conversations"),
      )
      : undefined;
    const productTransform = validateProductRows
      ? await validateProductBatches(source, plan)
      : undefined;
    const orders = validateOrderRows
      ? await validateOrderBatches(source, plan, {
        customerPublicIds: requireDependencyPublicIds(customers, "Order", "customers"),
        customerPublicIdsByPhone: customerPhoneIndex,
        conversationPublicIds: conversations?.publicIds ?? new Map(),
        userPublicIds,
      })
      : undefined;
    const orderItemTransform = validateOrderItemRows
      ? await validateOrderItemBatches(source, plan, {
        orderPublicIds: requireDependencyPublicIds(orders, "Order item", "orders"),
        productPublicIdsBySku: requireProductDependency(productTransform).publicIdsBySku,
        productPublicIdsByExternalId: requireProductDependency(productTransform).publicIdsByExternalProductId,
        orderTotalsByPublicId: orders?.totalsByOrderPublicId ?? new Map(),
      })
      : undefined;
    const shipmentTransform = validateShipmentRows
      ? await validateShipmentBatches(
        source,
        plan,
        {
          customerPublicIds: requireDependencyPublicIds(customers, "Shipment", "customers"),
          orderPublicIds: orders?.publicIds ?? new Map(),
          orderCustomerPublicIds: orders?.customerPublicIds ?? new Map(),
        },
      )
      : undefined;
    const shipmentTrackingEventTransform = validateShipmentTrackingEventRows
      ? await validateShipmentTrackingEventBatches(source, plan, {
        shipmentPublicIds: shipmentTransform?.publicIds ?? new Map(),
      })
      : undefined;
    const sourceManifest = createSourceManifest({
      sourceSystem: input.sourceSystem,
      databaseIdentity: input.sourceDatabaseIdentity,
      tables,
      plan,
      mappingCatalogVersion: catalog.version,
      rowContentChecksums: createRowContentChecksums(entities, rowContentRecords),
    });
    return {
      mode: input.mode,
      plan,
      sourceManifest,
      dryRunReport: createDryRunReport({
        plan,
        ...(customers ? { customerTransform: customers.summary } : {}),
        ...(conversations ? { conversationTransform: conversations.summary } : {}),
        ...(messageTransform ? { messageTransform } : {}),
        ...(productTransform ? { productTransform: productTransform.summary } : {}),
        ...(orders ? { orderTransform: orders.summary } : {}),
        ...(orderItemTransform ? { orderItemTransform } : {}),
        ...(shipmentTransform ? { shipmentTransform: shipmentTransform.summary } : {}),
        ...(shipmentTrackingEventTransform ? { shipmentTrackingEventTransform } : {}),
        ...(input.now ? { now: input.now } : {}),
      }),
      batches: [],
    };
  }

  const sourceManifest = createSourceManifest({
    sourceSystem: input.sourceSystem,
    databaseIdentity: input.sourceDatabaseIdentity,
    tables,
    plan,
    mappingCatalogVersion: catalog.version,
    rowContentChecksums: await createApplyRowContentChecksums(source, plan, entities, rowContentRecords),
  });
  await registerMigrationRun(input.target, input.runId, sourceManifest);

  const batches: MigrationBatchApplyResult[] = [];
  for (const batch of plan.batches) {
    batches.push(await applyPlannedBatch({
      source,
      target: input.target,
      runId: input.runId,
      batch,
      integrationAccounts,
      conversationAccounts,
      userPublicIds,
      ...(input.mediaStorage ? { mediaStorage: input.mediaStorage } : {}),
    }));
  }
  const deferredReconciliation = await reconcileDeferredReconciliations(input.target, input.runId);

  return {
    mode: input.mode,
    runId: input.runId,
    plan,
    sourceManifest,
    batches,
    deferredReconciliation,
  };
}

async function createApplyRowContentChecksums(
  source: LegacySource,
  plan: MigrationPlan,
  entities: readonly MigrationEntity[],
  recordsByEntity: ReadonlyMap<MigrationEntity, readonly LegacyRecord[]>,
) {
  for (const batch of plan.batches) {
    await source.readBatch(batch.entity, { limit: batch.limit, offset: batch.offset });
  }
  return createRowContentChecksums(entities, recordsByEntity);
}

async function applyPlannedBatch(input:
  & Pick<ApplyCustomerMigrationBatchInput, "source" | "target" | "runId" | "batch">
  & {
    readonly integrationAccounts: readonly VerifiedIntegrationAccount[];
    readonly conversationAccounts: readonly VerifiedConversationAccount[];
    readonly userPublicIds: ReadonlyMap<string, string>;
    readonly mediaStorage?: MigratorMediaStorage;
  },
): Promise<MigrationBatchApplyResult> {
  switch (input.batch.entity) {
    case "customers":
      return applyCustomerMigrationBatchWithState({
        ...input,
        integrationAccounts: input.integrationAccounts,
      } satisfies ApplyCustomerMigrationBatchInput);
    case "conversations":
      return applyConversationMigrationBatchWithState({
        ...input,
        integrationAccounts: input.conversationAccounts,
        userPublicIds: input.userPublicIds,
      } satisfies ApplyConversationMigrationBatchInput);
    case "messages":
      return applyMessageMigrationBatchWithState(input satisfies ApplyMessageMigrationBatchInput);
    case "products":
      return applyProductMigrationBatchWithState(input satisfies ApplyProductMigrationBatchInput);
    case "orders":
      return applyOrderMigrationBatchWithState({
        ...input,
        userPublicIds: input.userPublicIds,
      } satisfies ApplyOrderMigrationBatchInput);
    case "order_items":
      return applyOrderItemMigrationBatchWithState(input satisfies ApplyOrderItemMigrationBatchInput);
    case "shipments":
      return applyShipmentMigrationBatchWithState(input satisfies ApplyShipmentMigrationBatchInput);
    case "shipment_tracking_events":
      return applyShipmentTrackingEventMigrationBatchWithState(
        input satisfies ApplyShipmentTrackingEventMigrationBatchInput,
      );
    default:
      throw new Error(`No executable apply writer for ${input.batch.entity}`);
  }
}

function createRowContentRecordMap(
  entities: readonly MigrationEntity[],
): Map<MigrationEntity, LegacyRecord[]> {
  return new Map(entities.map((entity) => [entity, []]));
}

function trackSourceRowContent(
  source: LegacySource,
  recordsByEntity: Map<MigrationEntity, LegacyRecord[]>,
): LegacySource {
  return {
    count: (entity) => source.count(entity),
    describeTables: (entities) => source.describeTables(entities),
    readBatch: async (entity, options) => {
      const records = await source.readBatch(entity, options);
      recordsByEntity.get(entity)?.push(...records);
      return records;
    },
  };
}

function createRowContentChecksums(
  entities: readonly MigrationEntity[],
  recordsByEntity: ReadonlyMap<MigrationEntity, readonly LegacyRecord[]>,
) {
  return entities.map((entity) => createSourceRowContentChecksum(entity, dedupeLegacyRecords(recordsByEntity.get(entity) ?? [])));
}

function dedupeLegacyRecords(records: readonly LegacyRecord[]): LegacyRecord[] {
  const seen = new Set<string>();
  const deduped: LegacyRecord[] = [];
  for (const record of records) {
    const key = `${record.sourceTable}:${record.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(record);
  }
  return deduped;
}

interface ValidatedBatches<TSummary> {
  readonly summary: TSummary;
  readonly publicIds: ReadonlyMap<string, string>;
}

interface ValidatedCustomerBatches extends ValidatedBatches<CustomerTransformSummary> {
  readonly publicIdsByPhone: ReadonlyMap<string, readonly string[]>;
}

interface ValidatedProductBatches extends ValidatedBatches<ProductTransformSummary> {
  readonly publicIdsBySku: ReadonlyMap<string, string>;
  readonly publicIdsByExternalProductId: ReadonlyMap<string, string>;
}

interface ValidatedOrderBatches extends ValidatedBatches<OrderTransformSummary> {
  readonly customerPublicIds: ReadonlyMap<string, string>;
  readonly totalsByOrderPublicId: ReadonlyMap<string, number>;
}

interface ValidatedShipmentBatches extends ValidatedBatches<ShipmentTransformSummary> {}

const legacyShipmentTrackingEventTable = "public.kargo_takip";

function assertDryRunEntityDependencies(entities: readonly MigrationEntity[]): void {
  if (entities.includes("conversations") && !entities.includes("customers")) {
    throw new Error("Conversation dry-run requires customers in the same plan");
  }
  if (entities.includes("messages") && !entities.includes("conversations")) {
    throw new Error("Message dry-run requires conversations in the same plan");
  }
  if (entities.includes("orders") && !entities.includes("customers")) {
    throw new Error("Order dry-run requires customers in the same plan");
  }
  if (entities.includes("order_items") && !entities.includes("orders")) {
    throw new Error("Order item dry-run requires orders in the same plan");
  }
  if (entities.includes("order_items") && !entities.includes("products")) {
    throw new Error("Order item dry-run requires products in the same plan");
  }
  if (entities.includes("shipments") && !entities.includes("customers")) {
    throw new Error("Shipment dry-run requires customers in the same plan");
  }
  if (entities.includes("shipment_tracking_events") && !entities.includes("shipments")) {
    throw new Error("Shipment tracking event dry-run requires shipments in the same plan");
  }
}

function orderMigrationEntities(entities: readonly MigrationEntity[]): MigrationEntity[] {
  const selected = new Set(entities);
  return canonicalMigrationEntities.filter((entity) => selected.has(entity));
}

function requireDependencyPublicIds(
  dependency: ValidatedBatches<unknown> | undefined,
  label: string,
  entity: MigrationEntity,
): ReadonlyMap<string, string> {
  if (!dependency) throw new Error(`${label} dry-run requires ${entity} in the same plan`);
  return dependency.publicIds;
}

function requireProductDependency(
  dependency: ValidatedProductBatches | undefined,
): ValidatedProductBatches {
  if (!dependency) throw new Error("Order item dry-run requires products in the same plan");
  return dependency;
}

function assertEntityRoutesFromLegacyTable(
  catalog: LegacyMappingCatalog,
  entity: MigrationEntity,
  legacyTable: string,
  label: string,
): void {
  const route = catalog.tables.find((table) => table.targetEntities.some((target) => target.entity === entity));
  const sourceTable = route ? normalizeSourceTable(route.sourceTable) : "undeclared";
  if (sourceTable !== legacyTable) {
    throw new Error(
      `${label} dry-run requires catalog source table ${legacyTable}; catalog routes ${entity} from ${sourceTable}`,
    );
  }
}

function ownConversationAccounts(
  accounts: readonly VerifiedConversationAccount[] | undefined,
): readonly VerifiedConversationAccount[] {
  if (accounts === undefined) return Object.freeze([]);
  assertVerifiedConversationAccounts(accounts);
  return Object.freeze(accounts.map((account) => Object.freeze({
    publicId: account.publicId,
    providerKey: account.providerKey,
    status: account.status,
    externalAccountId: account.externalAccountId,
  })));
}

function ownUserPublicIds(userPublicIds: ReadonlyMap<string, string> | undefined): ReadonlyMap<string, string> {
  const owned = new Map<string, string>();
  if (userPublicIds === undefined) return owned;
  if (!(userPublicIds instanceof Map)) throw new Error("User public id snapshot must be a Map");
  for (const [legacyUserId, publicId] of userPublicIds as ReadonlyMap<unknown, unknown>) {
    if (typeof legacyUserId !== "string" || typeof publicId !== "string" || !publicId.trim()) {
      throw new Error("User public id snapshot must map legacy user ids to nonblank public ids");
    }
    owned.set(legacyUserId.toLowerCase(), publicId);
  }
  return owned;
}

async function readPlannedBatch(
  source: LegacySource,
  batch: MigrationBatch,
  label: string,
): Promise<LegacyRecord[]> {
  const rows = await source.readBatch(batch.entity, { limit: batch.limit, offset: batch.offset });
  const rowCount = Array.isArray(rows) ? rows.length : null;
  if (rowCount !== batch.expectedRows) {
    throw new Error(
      `${label} dry-run batch ${batch.batchNumber} returned ${rowCount ?? "a non-array"} rows; expected ${batch.expectedRows}`,
    );
  }
  return rows;
}

function ownIntegrationAccounts(
  accounts: readonly VerifiedIntegrationAccount[] | undefined,
): readonly VerifiedIntegrationAccount[] {
  if (accounts === undefined) return Object.freeze([]);
  assertVerifiedIntegrationAccounts(accounts);
  return Object.freeze(accounts.map((account) => Object.freeze({
    publicId: account.publicId,
    providerKey: account.providerKey,
    status: account.status,
  })));
}

async function validateCustomerBatches(
  source: LegacySource,
  plan: MigrationPlan,
  accounts: readonly VerifiedIntegrationAccount[],
): Promise<ValidatedCustomerBatches> {
  let transformedRows = 0;
  let addressDrafts = 0;
  let resolvedIdentities = 0;
  let unresolvedIdentities = 0;
  let nameFallbackWarnings = 0;
  const publicIds = new Map<string, string>();
  const publicIdsByPhone = new Map<string, string[]>();

  for (const batch of plan.batches) {
    if (batch.entity !== "customers") continue;
    const rows = await readPlannedBatch(source, batch, "Customer");

    const candidates: UnresolvedCustomerExternalIdentity[] = [];
    for (const row of rows) {
      const result = transformLegacyCustomer(row);
      transformedRows += 1;
      publicIds.set(row.sourceId.toLowerCase(), result.customer.publicId);
      const normalizedPhone = typeof row.payload.telefon === "string" ? normalizePhoneLast10(row.payload.telefon) : null;
      if (normalizedPhone !== null) {
        const matches = publicIdsByPhone.get(normalizedPhone) ?? [];
        matches.push(result.customer.publicId);
        publicIdsByPhone.set(normalizedPhone, matches);
      }
      if (result.address) addressDrafts += 1;
      nameFallbackWarnings += result.warnings.filter((warning) => warning.code === "customer_name_fallback").length;
      candidates.push(...result.externalIdentityCandidates);
    }
    const resolution = resolveCustomerExternalIdentities(candidates, accounts);
    resolvedIdentities += resolution.resolved.length;
    unresolvedIdentities += resolution.unresolved.length;
  }

  return {
    summary: Object.freeze({
      transformedRows,
      addressDrafts,
      resolvedIdentities,
      unresolvedIdentities,
      nameFallbackWarnings,
    }),
    publicIds,
    publicIdsByPhone: new Map(
      [...publicIdsByPhone].map(([phone, matches]) => [phone, Object.freeze([...new Set(matches)])]),
    ),
  };
}

async function validateConversationBatches(
  source: LegacySource,
  plan: MigrationPlan,
  context: {
    readonly customerPublicIds: ReadonlyMap<string, string>;
    readonly userPublicIds: ReadonlyMap<string, string>;
    readonly accounts: readonly VerifiedConversationAccount[];
  },
): Promise<ValidatedBatches<ConversationTransformSummary>> {
  let transformedRows = 0;
  let unresolvedAssignedUsers = 0;
  let resolvedInstagramAccounts = 0;
  const publicIds = new Map<string, string>();

  for (const batch of plan.batches) {
    if (batch.entity !== "conversations") continue;
    const rows = await readPlannedBatch(source, batch, "Conversation");

    for (const row of rows) {
      const result = transformLegacyConversation(row, context);
      transformedRows += 1;
      publicIds.set(row.sourceId.toLowerCase(), result.conversation.publicId);
      unresolvedAssignedUsers += result.reconciliation
        .filter((entry) => entry.code === "unresolved_assigned_user").length;
      if (result.conversation.channel === "instagram" && result.conversation.integrationAccountPublicId !== null) {
        resolvedInstagramAccounts += 1;
      }
    }
  }

  return {
    summary: Object.freeze({ transformedRows, unresolvedAssignedUsers, resolvedInstagramAccounts }),
    publicIds,
  };
}

async function validateMessageBatches(
  source: LegacySource,
  plan: MigrationPlan,
  conversationPublicIds: ReadonlyMap<string, string>,
): Promise<MessageTransformSummary> {
  let transformedRows = 0;
  let mediaPayloads = 0;
  let inlineMediaPayloads = 0;
  let mediaFieldConflicts = 0;
  const inlineMediaDecodedBytesByMime = new Map<string, number>();
  let previousSourceId: string | null = null;

  for (const batch of plan.batches) {
    if (batch.entity !== "messages") continue;
    const rows = await readPlannedBatch(source, batch, "Message");

    for (const row of rows) {
      const result = transformLegacyMessage(row, { conversationPublicIds });
      const sourceId = row.sourceId.toLowerCase();
      if (previousSourceId !== null && sourceId <= previousSourceId) {
        throw new Error(`Message dry-run batch ${batch.batchNumber} is not in ascending source id order`);
      }
      previousSourceId = sourceId;
      transformedRows += 1;
      mediaFieldConflicts += result.warnings.filter((warning) => warning.code === "media_field_conflict").length;
      const rawPayload = result.message.rawPayload;
      const mediaUrl = typeof rawPayload?.media_url === "string" ? rawPayload.media_url : null;
      if (mediaUrl !== null || rawPayload?.media_type !== undefined || rawPayload?.medya_url !== undefined || rawPayload?.medya_tipi !== undefined) {
        mediaPayloads += 1;
      }
      const inline = mediaUrl === null ? null : parseDataUrlStats(mediaUrl);
      if (inline !== null) {
        inlineMediaPayloads += 1;
        inlineMediaDecodedBytesByMime.set(
          inline.mimeType,
          (inlineMediaDecodedBytesByMime.get(inline.mimeType) ?? 0) + inline.decodedBytes,
        );
      }
    }
  }

  return Object.freeze({
    transformedRows,
    mediaPayloads,
    ...(inlineMediaPayloads > 0 ? { inlineMediaPayloads } : {}),
    ...(inlineMediaDecodedBytesByMime.size > 0
      ? { inlineMediaDecodedBytesByMime: Object.fromEntries([...inlineMediaDecodedBytesByMime].sort()) }
      : {}),
    ...(mediaFieldConflicts > 0 ? { mediaFieldConflicts } : {}),
  });
}

async function validateProductBatches(
  source: LegacySource,
  plan: MigrationPlan,
): Promise<ValidatedProductBatches> {
  let transformedRows = 0;
  let inactiveProducts = 0;
  let duplicateExternalProductIdGroups = 0;
  let duplicateExternalProductIdRows = 0;
  const publicIds = new Map<string, string>();
  const publicIdsBySku = new Map<string, string>();
  const publicIdsByExternalProductId = new Map<string, string>();
  const externalCandidates = new Map<string, {
    readonly sourceId: string;
    readonly publicId: string;
    readonly active: boolean;
    readonly updatedAt: string;
  }[]>();

  for (const batch of plan.batches) {
    if (batch.entity !== "products") continue;
    const rows = await readPlannedBatch(source, batch, "Product");

    for (const row of rows) {
      const result = transformLegacyProduct(row);
      transformedRows += 1;
      publicIds.set(row.sourceId.toLowerCase(), result.product.publicId);
      addUniqueProductLookup(publicIdsBySku, result.product.sku, result.product.publicId, "sku");
      if (result.product.externalProductId !== null) {
        const group = externalCandidates.get(result.product.externalProductId) ?? [];
        group.push({
          sourceId: row.sourceId,
          publicId: result.product.publicId,
          active: result.product.isActive,
          updatedAt: result.product.legacyTimestamps.updatedAt ?? "",
        });
        externalCandidates.set(result.product.externalProductId, group);
      }
      if (!result.product.isActive) inactiveProducts += 1;
    }
  }

  for (const [externalProductId, candidates] of externalCandidates) {
    const sorted = [...candidates].sort(compareProductExternalIdOwners);
    const owner = sorted[0]!;
    publicIdsByExternalProductId.set(externalProductId, owner.publicId);
    if (sorted.length > 1) {
      duplicateExternalProductIdGroups += 1;
      duplicateExternalProductIdRows += sorted.length - 1;
    }
  }

  return {
    summary: Object.freeze({
      transformedRows,
      inactiveProducts,
      ...(duplicateExternalProductIdGroups > 0 ? { duplicateExternalProductIdGroups } : {}),
      ...(duplicateExternalProductIdRows > 0 ? { duplicateExternalProductIdRows } : {}),
    }),
    publicIds,
    publicIdsBySku,
    publicIdsByExternalProductId,
  };
}

function addUniqueProductLookup(
  index: Map<string, string>,
  key: string | null,
  publicId: string,
  label: string,
): void {
  if (key === null) return;
  const existing = index.get(key);
  if (existing !== undefined && existing !== publicId) {
    throw new Error(`Product dry-run found duplicate ${label} values`);
  }
  index.set(key, publicId);
}

async function validateOrderBatches(
  source: LegacySource,
  plan: MigrationPlan,
  context: {
    readonly customerPublicIds: ReadonlyMap<string, string>;
    readonly customerPublicIdsByPhone: ReadonlyMap<string, readonly string[]>;
    readonly conversationPublicIds: ReadonlyMap<string, string>;
    readonly userPublicIds: ReadonlyMap<string, string>;
  },
): Promise<ValidatedOrderBatches> {
  let transformedRows = 0;
  let unresolvedConversations = 0;
  let unresolvedCreators = 0;
  let customerResolutionById = 0;
  let customerResolutionByPhone = 0;
  let syntheticCustomersFromOrders = 0;
  let ambiguousPhoneMatches = 0;
  const publicIds = new Map<string, string>();
  const customerPublicIds = new Map<string, string>();
  const totalsByOrderPublicId = new Map<string, number>();

  for (const batch of plan.batches) {
    if (batch.entity !== "orders") continue;
    const rows = await readPlannedBatch(source, batch, "Order");

    for (const row of rows) {
      const result = transformLegacyOrder(row, context);
      transformedRows += 1;
      publicIds.set(row.sourceId.toLowerCase(), result.order.publicId);
      customerPublicIds.set(result.order.publicId, result.order.customerPublicId);
      totalsByOrderPublicId.set(result.order.publicId, Number(result.order.totalAmount));
      if (result.customerResolution.path === "musteri_id") customerResolutionById += 1;
      if (result.customerResolution.path === "phone") customerResolutionByPhone += 1;
      if (result.customerResolution.path === "synthetic") {
        syntheticCustomersFromOrders += 1;
        if (result.customerResolution.reason === "ambiguous_phone") ambiguousPhoneMatches += 1;
      }
      for (const entry of result.reconciliation) {
        if (entry.code === "unresolved_conversation") unresolvedConversations += 1;
        if (entry.code === "unresolved_created_by") unresolvedCreators += 1;
      }
    }
  }

  return {
    summary: Object.freeze({
      transformedRows,
      unresolvedConversations,
      unresolvedCreators,
      ...(customerResolutionById > 0 ? { customerResolutionById } : {}),
      ...(customerResolutionByPhone > 0 ? { customerResolutionByPhone } : {}),
      ...(syntheticCustomersFromOrders > 0 ? { syntheticCustomersFromOrders } : {}),
      ...(ambiguousPhoneMatches > 0 ? { ambiguousPhoneMatches } : {}),
    }),
    publicIds,
    customerPublicIds,
    totalsByOrderPublicId,
  };
}

async function validateOrderItemBatches(
  source: LegacySource,
  plan: MigrationPlan,
  context: {
    readonly orderPublicIds: ReadonlyMap<string, string>;
    readonly productPublicIdsBySku: ReadonlyMap<string, string>;
    readonly productPublicIdsByExternalId: ReadonlyMap<string, string>;
    readonly orderTotalsByPublicId: ReadonlyMap<string, number>;
  },
): Promise<OrderItemTransformSummary> {
  let transformedRows = 0;
  let resolvedProducts = 0;
  let unresolvedProducts = 0;
  let skuProductMatches = 0;
  let externalProductMatches = 0;
  let totalAdjustmentWarnings = 0;
  let totalAdjustmentAmount = 0;
  const orderItemSums = new Map<string, { total: number; count: number }>();

  for (const batch of plan.batches) {
    if (batch.entity !== "order_items") continue;
    const rows = await readPlannedBatch(source, batch, "Order item");

    for (const row of rows) {
      const result = transformLegacyOrderItem(row, context);
      transformedRows += 1;
      if (result.orderItem.productPublicId === null) {
        unresolvedProducts += 1;
      } else {
        resolvedProducts += 1;
        if (result.orderItem.productLookup === "external_product_id") {
          externalProductMatches += 1;
        }
        if (result.orderItem.productLookup === "sku") {
          skuProductMatches += 1;
        }
      }
      const current = orderItemSums.get(result.orderItem.orderPublicId) ?? { total: 0, count: 0 };
      current.total += Number(result.orderItem.totalAmount);
      current.count += 1;
      orderItemSums.set(result.orderItem.orderPublicId, current);
    }
  }
  let ordersWithoutItems = 0;
  for (const [orderPublicId, orderTotal] of context.orderTotalsByPublicId) {
    const itemSummary = orderItemSums.get(orderPublicId);
    if (!itemSummary || itemSummary.count === 0) {
      ordersWithoutItems += 1;
      continue;
    }
    const adjustment = Number((orderTotal - itemSummary.total).toFixed(2));
    if (Math.abs(adjustment) > 0.01) {
      totalAdjustmentWarnings += 1;
      totalAdjustmentAmount += adjustment;
    }
  }

  return Object.freeze({
    transformedRows,
    resolvedProducts,
    unresolvedProducts,
    skuProductMatches,
    externalProductMatches,
    ...(totalAdjustmentWarnings > 0 ? { totalAdjustmentWarnings } : {}),
    ...(totalAdjustmentWarnings > 0 ? { totalAdjustmentAmount: totalAdjustmentAmount.toFixed(2) } : {}),
    ...(ordersWithoutItems > 0 ? { ordersWithoutItems } : {}),
  });
}

async function validateShipmentBatches(
  source: LegacySource,
  plan: MigrationPlan,
  context: {
    readonly customerPublicIds: ReadonlyMap<string, string>;
    readonly orderPublicIds: ReadonlyMap<string, string>;
    readonly orderCustomerPublicIds: ReadonlyMap<string, string>;
  },
): Promise<ValidatedShipmentBatches> {
  let transformedRows = 0;
  let unresolvedCustomers = 0;
  let linkedOrdersByTracking = 0;
  let ambiguousOrderTrackingMatches = 0;
  let unmatchedOrderTracking = 0;
  let pttShipments = 0;
  let suratShipments = 0;
  let manualShipments = 0;
  const shipmentTrackingNumbers = new Set<string>();
  const publicIds = new Map<string, string>();
  const orderTrackingIndex = await buildOrderTrackingIndex(source, plan, context.orderPublicIds);

  for (const batch of plan.batches) {
    if (batch.entity !== "shipments") continue;
    const rows = await readPlannedBatch(source, batch, "Shipment");

    for (const row of rows) {
      for (const tracking of shipmentTrackingCandidates(row.payload)) shipmentTrackingNumbers.add(tracking);
      const result = transformLegacyShipment(row, {
        customerPublicIds: context.customerPublicIds,
        orderPublicIdsByTracking: orderTrackingIndex,
        customerPublicIdsByOrderPublicId: context.orderCustomerPublicIds,
      });
      publicIds.set(row.sourceId.toLowerCase(), result.shipment.publicId);
      transformedRows += 1;
      const candidates = shipmentTrackingCandidates(row.payload);
      const matchedCandidates = candidates.map((candidate) => orderTrackingIndex.get(candidate) ?? []);
      if (matchedCandidates.some((matches) => matches.length > 1)) {
        ambiguousOrderTrackingMatches += 1;
      } else if (result.shipment.orderPublicId !== null) {
        linkedOrdersByTracking += 1;
      } else {
        unmatchedOrderTracking += 1;
      }
      unresolvedCustomers += result.reconciliation
        .filter((entry) => entry.code === "unresolved_customer").length;
      if (result.shipment.provider === "ptt") pttShipments += 1;
      if (result.shipment.provider === "surat") suratShipments += 1;
      if (result.shipment.provider === "manual") manualShipments += 1;
    }
  }
  const ordersWithTrackingWithoutShipment = [...orderTrackingIndex.keys()]
    .filter((tracking) => !shipmentTrackingNumbers.has(tracking))
    .length;

  return Object.freeze({
    summary: Object.freeze({
      transformedRows,
      unresolvedCustomers,
      ...(linkedOrdersByTracking > 0 ? { linkedOrdersByTracking } : {}),
      ...(ambiguousOrderTrackingMatches > 0 ? { ambiguousOrderTrackingMatches } : {}),
      ...(unmatchedOrderTracking > 0 ? { unmatchedOrderTracking } : {}),
      ...(ordersWithTrackingWithoutShipment > 0 ? { ordersWithTrackingWithoutShipment } : {}),
      pttShipments,
      suratShipments,
      manualShipments,
    }),
    publicIds,
  });
}

async function buildOrderTrackingIndex(
  source: LegacySource,
  plan: MigrationPlan,
  orderPublicIds: ReadonlyMap<string, string>,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const index = new Map<string, string[]>();
  for (const batch of plan.batches) {
    if (batch.entity !== "orders") continue;
    const rows = await readPlannedBatch(source, batch, "Order tracking index");
    for (const row of rows) {
      const publicId = orderPublicIds.get(row.sourceId.toLowerCase());
      if (publicId === undefined) continue;
      const tracking = normalizeShipmentTrackingNumber(
        typeof row.payload.kargo_takip_no === "string" ? row.payload.kargo_takip_no : null,
      );
      if (tracking === null) continue;
      const matches = index.get(tracking) ?? [];
      matches.push(publicId);
      index.set(tracking, matches);
    }
  }
  return new Map([...index].map(([tracking, matches]) => [tracking, Object.freeze(matches)]));
}

async function validateShipmentTrackingEventBatches(
  source: LegacySource,
  plan: MigrationPlan,
  context: { readonly shipmentPublicIds: ReadonlyMap<string, string> },
): Promise<ShipmentTrackingEventTransformSummary> {
  let transformedRows = 0;
  let duplicateRows = 0;
  let futureDatedRows = 0;
  let uniqueEvents = 0;
  let providerTimeEvents = 0;
  let firstSeenEvents = 0;
  let unresolvedShipments = 0;
  for (const batch of plan.batches) {
    if (batch.entity !== "shipment_tracking_events") continue;
    const rows = await readPlannedBatch(source, batch, "Shipment tracking event");
    for (const row of rows) {
      const rawRowCount = requiredPayloadInteger(row.payload, "raw_row_count");
      transformedRows += rawRowCount;
      const timeSource = requiredPayloadText(row.payload, "time_source");
      if (timeSource === "future_excluded") {
        futureDatedRows += rawRowCount;
        continue;
      }
      const legacyShipmentId = optionalPayloadText(row.payload, "kargo_id");
      if (legacyShipmentId === null || !context.shipmentPublicIds.has(legacyShipmentId.toLowerCase())) {
        unresolvedShipments += 1;
      }
      requiredPayloadText(row.payload, "durum");
      requiredPayloadText(row.payload, "event_time");
      if (timeSource === "provider") {
        providerTimeEvents += 1;
      } else if (timeSource === "first_seen") {
        firstSeenEvents += 1;
      } else {
        throw new Error(`Legacy shipment tracking event time_source is unsupported: ${timeSource}`);
      }
      uniqueEvents += 1;
      duplicateRows += Math.max(0, rawRowCount - 1);
    }
  }
  return Object.freeze({
    transformedRows,
    uniqueEvents,
    duplicateRows,
    futureDatedRows,
    providerTimeEvents,
    firstSeenEvents,
    unresolvedShipments,
  });
}

function ownSourceTableSnapshots(snapshots: readonly SourceTableSnapshot[]): SourceTableSnapshot[] {
  return Object.freeze(snapshots.map((snapshot) => Object.freeze({
    entity: snapshot.entity,
    schema: snapshot.schema,
    table: snapshot.table,
    idColumn: snapshot.idColumn,
    columns: Object.freeze(snapshot.columns.map((column) => Object.freeze({ ...column }))),
  }))) as unknown as SourceTableSnapshot[];
}

function normalizePhoneLast10(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

function shipmentTrackingCandidates(payload: Record<string, unknown>): readonly string[] {
  const candidates = ["takip_no", "surat_kargo_takip_no", "surat_barkod_no"]
    .map((field) => typeof payload[field] === "string" ? normalizeShipmentTrackingNumber(payload[field]) : null)
    .filter((value): value is string => value !== null);
  return [...new Set(candidates)];
}

function compareProductExternalIdOwners(
  left: { readonly sourceId: string; readonly active: boolean; readonly updatedAt: string },
  right: { readonly sourceId: string; readonly active: boolean; readonly updatedAt: string },
): number {
  if (left.active !== right.active) return left.active ? -1 : 1;
  const updated = right.updatedAt.localeCompare(left.updatedAt);
  if (updated !== 0) return updated;
  return left.sourceId.localeCompare(right.sourceId);
}

function parseDataUrlStats(value: string): { readonly mimeType: string; readonly decodedBytes: number } | null {
  const match = /^data:([^;,]+)(?:;[^,]*)?,(.*)$/s.exec(value);
  if (!match) return null;
  const mimeType = match[1]!.toLowerCase();
  const payload = match[2]!;
  const isBase64 = /^data:[^,]*;base64,/i.test(value);
  const decodedBytes = isBase64
    ? Buffer.byteLength(payload.replace(/\s/g, ""), "base64")
    : Buffer.byteLength(decodeURIComponent(payload), "utf8");
  return { mimeType, decodedBytes };
}

function requiredPayloadText(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Legacy shipment tracking event field ${field} is required`);
  }
  return value.trim();
}

function optionalPayloadText(payload: Record<string, unknown>, field: string): string | null {
  const value = payload[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`Legacy shipment tracking event field ${field} must be text or null`);
  const trimmed = value.trim();
  return trimmed || null;
}

function requiredPayloadInteger(payload: Record<string, unknown>, field: string): number {
  const value = payload[field];
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) return Number(value);
  throw new Error(`Legacy shipment tracking event field ${field} must be a non-negative integer`);
}

function assertDryRunReadyEntitySelection(
  entities: readonly MigrationEntity[],
  readyEntities: readonly MigrationEntity[],
): void {
  if (entities.length === 0) {
    throw new Error("Migration must select at least one entity");
  }
  const selected = new Set<MigrationEntity>(entities);
  if (selected.size !== entities.length) {
    throw new Error("Migration entities must not contain duplicates");
  }
  const ready = new Set(readyEntities);
  const unavailable = entities.filter((entity) => !ready.has(entity));
  if (unavailable.length > 0) {
    throw new Error(`Migration entities are not dry-run-ready in catalog: ${unavailable.join(", ")}`);
  }
}
