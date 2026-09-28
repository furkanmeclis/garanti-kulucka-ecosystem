import { applyMigrationBatchWithState, createCanonicalEntityTransformer } from "./apply.js";
import { canonicalMigrationEntities, createMigrationPlan, defaultMigrationEntities } from "./plan.js";
import { createDryRunReport } from "./reports.js";
import { createSourceManifest, mappingCatalogVersion, registerMigrationRun } from "./source-manifest.js";
import type {
  DryRunReport,
  LegacySource,
  MigrationBatchApplyResult,
  MigrationEntity,
  MigrationPlan,
  MigrationTarget,
  SourceDatabaseIdentity,
  SourceManifest,
} from "./types.js";

interface RunMigrationInputBase {
  readonly source: LegacySource;
  readonly batchSize: number;
  readonly entities?: MigrationEntity[];
  readonly now?: Date;
  readonly sourceSystem: string;
  readonly sourceDatabaseIdentity: SourceDatabaseIdentity;
  readonly mappingCatalogVersion?: string;
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
  const entities = input.entities ?? defaultMigrationEntities;
  if (input.mode === "apply") {
    assertCompleteCanonicalEntitySelection(entities);
  }

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
    tables: await input.source.describeTables(entities),
    plan,
    mappingCatalogVersion: input.mappingCatalogVersion ?? mappingCatalogVersion,
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

  await registerMigrationRun(input.target, input.runId, sourceManifest);

  const batches: MigrationBatchApplyResult[] = [];
  for (const batch of plan.batches) {
    batches.push(
      await applyMigrationBatchWithState({
        source: input.source,
        target: input.target,
        runId: input.runId,
        batch,
        transform: createCanonicalEntityTransformer(batch.entity),
      }),
    );
  }

  return {
    mode: input.mode,
    runId: input.runId,
    plan,
    sourceManifest,
    batches,
  };
}

function assertCompleteCanonicalEntitySelection(entities: readonly MigrationEntity[]): void {
  const selected = new Set<MigrationEntity>(entities);
  const isComplete = entities.length === canonicalMigrationEntities.length
    && selected.size === canonicalMigrationEntities.length
    && canonicalMigrationEntities.every((entity) => selected.has(entity));

  if (!isComplete) {
    throw new Error("Apply mode requires each canonical migration entity exactly once");
  }
}
