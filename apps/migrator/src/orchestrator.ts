import {
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
  CustomerTransformSummary,
  DryRunReport,
  LegacySource,
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

  const validateCustomerRows = entities.includes("customers");
  if (validateCustomerRows) assertCustomersRouteFromLegacyTable(catalog);
  const integrationAccounts = ownIntegrationAccounts(input.integrationAccounts);

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
    const customerTransform = validateCustomerRows
      ? await validateCustomerBatches(input.source, plan, integrationAccounts)
      : undefined;
    return {
      mode: input.mode,
      plan,
      sourceManifest,
      dryRunReport: createDryRunReport({
        plan,
        ...(customerTransform ? { customerTransform } : {}),
        ...(input.now ? { now: input.now } : {}),
      }),
      batches: [],
    };
  }

  throw new Error("Apply mode is unavailable until the mapping catalog declares apply-ready transforms");
}

function assertCustomersRouteFromLegacyTable(catalog: LegacyMappingCatalog): void {
  const route = catalog.tables.find((table) => table.targetEntities.some((target) => target.entity === "customers"));
  const sourceTable = route ? normalizeSourceTable(route.sourceTable) : "undeclared";
  if (sourceTable !== legacyCustomerTable) {
    throw new Error(
      `Customer dry-run requires catalog source table ${legacyCustomerTable}; catalog routes customers from ${sourceTable}`,
    );
  }
}

function ownIntegrationAccounts(
  accounts: readonly VerifiedIntegrationAccount[] | undefined,
): readonly VerifiedIntegrationAccount[] {
  if (accounts === undefined) return Object.freeze([]);
  resolveCustomerExternalIdentities([], accounts);
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
): Promise<CustomerTransformSummary> {
  let transformedRows = 0;
  let addressDrafts = 0;
  let resolvedIdentities = 0;
  let unresolvedIdentities = 0;
  let nameFallbackWarnings = 0;

  for (const batch of plan.batches) {
    if (batch.entity !== "customers") continue;
    const rows = await source.readBatch(batch.entity, { limit: batch.limit, offset: batch.offset });
    const rowCount = Array.isArray(rows) ? rows.length : null;
    if (rowCount !== batch.expectedRows) {
      throw new Error(
        `Customer dry-run batch ${batch.batchNumber} returned ${rowCount ?? "a non-array"} rows; expected ${batch.expectedRows}`,
      );
    }

    const candidates: UnresolvedCustomerExternalIdentity[] = [];
    for (const row of rows) {
      const result = transformLegacyCustomer(row);
      transformedRows += 1;
      if (result.address) addressDrafts += 1;
      nameFallbackWarnings += result.warnings.filter((warning) => warning.code === "customer_name_fallback").length;
      candidates.push(...result.externalIdentityCandidates);
    }
    const resolution = resolveCustomerExternalIdentities(candidates, accounts);
    resolvedIdentities += resolution.resolved.length;
    unresolvedIdentities += resolution.unresolved.length;
  }

  return Object.freeze({
    transformedRows,
    addressDrafts,
    resolvedIdentities,
    unresolvedIdentities,
    nameFallbackWarnings,
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
