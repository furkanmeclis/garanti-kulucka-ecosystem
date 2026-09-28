import { applyMigrationBatchWithState, createCanonicalEntityTransformer } from "./apply.js";
import { createMigrationPlan, defaultMigrationEntities } from "./plan.js";
import { createDryRunReport } from "./reports.js";
import type {
  DryRunReport,
  LegacySource,
  MigrationBatchApplyResult,
  MigrationEntity,
  MigrationPlan,
  MigrationTarget,
} from "./types.js";

interface RunMigrationInputBase {
  readonly source: LegacySource;
  readonly batchSize: number;
  readonly entities?: MigrationEntity[];
  readonly now?: Date;
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
  readonly dryRunReport?: DryRunReport;
  readonly batches: MigrationBatchApplyResult[];
}

export async function runMigration(input: RunMigrationInput): Promise<MigrationRunResult> {
  const entities = input.entities ?? defaultMigrationEntities;
  const plan = await createMigrationPlan({
    source: input.source,
    mode: input.mode,
    batchSize: input.batchSize,
    entities,
    ...(input.now ? { now: input.now } : {}),
  });

  if (input.mode === "dry-run") {
    return {
      mode: input.mode,
      plan,
      dryRunReport: createDryRunReport({ plan, ...(input.now ? { now: input.now } : {}) }),
      batches: [],
    };
  }

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
    batches,
  };
}
