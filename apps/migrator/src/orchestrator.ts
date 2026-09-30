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
import { createMigrationPlan } from "./plan.js";
import { createDryRunReport } from "./reports.js";
import {
  assertApplyPrerequisites,
  createLegacyMappingCatalog,
  dryRunMigrationEntities,
  normalizeSourceTable,
  validateLegacySourceSnapshots,
  type LegacyMappingCatalog,
} from "./mapping-catalog.js";
import { createSourceManifest } from "./source-manifest.js";
import type {
  ConversationTransformSummary,
  CustomerTransformSummary,
  DryRunReport,
  LegacyRecord,
  LegacySource,
  MessageTransformSummary,
  MigrationBatch,
  MigrationBatchApplyResult,
  MigrationEntity,
  MigrationPlan,
  MigrationTarget,
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
}

export type RunMigrationInput = RunMigrationDryRunInput | RunMigrationApplyInput;

export interface MigrationRunResult {
  readonly mode: "dry-run" | "apply";
  readonly runId?: string;
  readonly plan: MigrationPlan;
  readonly sourceManifest: SourceManifest;
  readonly dryRunReport?: DryRunReport;
  readonly batches: MigrationBatchApplyResult[];
}

export async function runMigration(input: RunMigrationInput): Promise<MigrationRunResult> {
  const catalog = createLegacyMappingCatalog(input.mappingCatalog);
  const readyEntities = dryRunMigrationEntities(catalog);
  const entities = input.entities ?? readyEntities;
  assertDryRunReadyEntitySelection(entities, readyEntities);
  if (input.mode === "apply") {
    assertApplyPrerequisites(catalog, entities);
    throw new Error("Apply mode is unavailable until the mapping catalog declares apply-ready transforms");
  }

  assertDryRunEntityDependencies(entities);
  const validateCustomerRows = entities.includes("customers");
  const validateConversationRows = entities.includes("conversations");
  const validateMessageRows = entities.includes("messages");
  if (validateCustomerRows) assertEntityRoutesFromLegacyTable(catalog, "customers", legacyCustomerTable, "Customer");
  if (validateConversationRows) {
    assertEntityRoutesFromLegacyTable(catalog, "conversations", legacyConversationTable, "Conversation");
  }
  if (validateMessageRows) assertEntityRoutesFromLegacyTable(catalog, "messages", legacyMessageTable, "Message");
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
  const sourceManifest = createSourceManifest({
    sourceSystem: input.sourceSystem,
    databaseIdentity: input.sourceDatabaseIdentity,
    tables,
    plan,
    mappingCatalogVersion: catalog.version,
  });

  if (input.mode === "dry-run") {
    const customers = validateCustomerRows
      ? await validateCustomerBatches(input.source, plan, integrationAccounts)
      : undefined;
    const conversations = validateConversationRows
      ? await validateConversationBatches(input.source, plan, {
        customerPublicIds: requireDependencyPublicIds(customers, "Conversation", "customers"),
        userPublicIds,
        accounts: conversationAccounts,
      })
      : undefined;
    const messageTransform = validateMessageRows
      ? await validateMessageBatches(
        input.source,
        plan,
        requireDependencyPublicIds(conversations, "Message", "conversations"),
      )
      : undefined;
    return {
      mode: input.mode,
      plan,
      sourceManifest,
      dryRunReport: createDryRunReport({
        plan,
        ...(customers ? { customerTransform: customers.summary } : {}),
        ...(conversations ? { conversationTransform: conversations.summary } : {}),
        ...(messageTransform ? { messageTransform } : {}),
        ...(input.now ? { now: input.now } : {}),
      }),
      batches: [],
    };
  }

  throw new Error("Apply mode is unavailable until the mapping catalog declares apply-ready transforms");
}

interface ValidatedBatches<TSummary> {
  readonly summary: TSummary;
  readonly publicIds: ReadonlyMap<string, string>;
}

function assertDryRunEntityDependencies(entities: readonly MigrationEntity[]): void {
  if (entities.includes("conversations") && !entities.includes("customers")) {
    throw new Error("Conversation dry-run requires customers in the same plan");
  }
  if (entities.includes("messages") && !entities.includes("conversations")) {
    throw new Error("Message dry-run requires conversations in the same plan");
  }
}

function requireDependencyPublicIds(
  dependency: ValidatedBatches<unknown> | undefined,
  label: string,
  entity: MigrationEntity,
): ReadonlyMap<string, string> {
  if (!dependency) throw new Error(`${label} dry-run requires ${entity} in the same plan`);
  return dependency.publicIds;
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
): Promise<ValidatedBatches<CustomerTransformSummary>> {
  let transformedRows = 0;
  let addressDrafts = 0;
  let resolvedIdentities = 0;
  let unresolvedIdentities = 0;
  let nameFallbackWarnings = 0;
  const publicIds = new Map<string, string>();

  for (const batch of plan.batches) {
    if (batch.entity !== "customers") continue;
    const rows = await readPlannedBatch(source, batch, "Customer");

    const candidates: UnresolvedCustomerExternalIdentity[] = [];
    for (const row of rows) {
      const result = transformLegacyCustomer(row);
      transformedRows += 1;
      publicIds.set(row.sourceId.toLowerCase(), result.customer.publicId);
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
      const rawPayload = result.message.rawPayload;
      if (rawPayload?.medya_url !== undefined || rawPayload?.medya_tipi !== undefined) mediaPayloads += 1;
    }
  }

  return Object.freeze({ transformedRows, mediaPayloads });
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
