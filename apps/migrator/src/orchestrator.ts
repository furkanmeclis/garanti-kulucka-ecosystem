import { createMigrationPlan } from "./plan.js";
import { createDryRunReport } from "./reports.js";
import {
  createLegacyMappingCatalog,
  dryRunMigrationEntities,
  validateLegacySourceSnapshots,
  type LegacyMappingCatalog,
} from "./mapping-catalog.js";
import { createSourceManifest } from "./source-manifest.js";
import type {
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
    throw new Error("Apply mode is unavailable until the mapping catalog declares apply-ready transforms");
  }

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
    return {
      mode: input.mode,
      plan,
      sourceManifest,
      dryRunReport: createDryRunReport({ plan, ...(input.now ? { now: input.now } : {}) }),
      batches: [],
    };
  }

  throw new Error("Apply mode is unavailable until the mapping catalog declares apply-ready transforms");
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
