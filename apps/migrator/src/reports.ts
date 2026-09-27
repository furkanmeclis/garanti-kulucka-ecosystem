import type {
  DryRunReport,
  MigrationPlan,
  MigrationWarning,
  VerificationCheck,
  VerificationReport,
} from "./types.js";

export function createDryRunReport(input: {
  readonly plan: MigrationPlan;
  readonly warnings?: MigrationWarning[];
  readonly now?: Date;
}): DryRunReport {
  const warnings = input.warnings ?? [];
  const entities = input.plan.entities.map((entityPlan) => {
    const blockedRows = warnings.filter((warning) => warning.entity === entityPlan.entity).length;
    return {
      entity: entityPlan.entity,
      plannedRows: entityPlan.totalRows,
      plannedBatches: entityPlan.batches,
      blockedRows,
    };
  });

  return {
    mode: "dry-run",
    plan: input.plan,
    totals: {
      plannedRows: input.plan.totalRows,
      plannedBatches: input.plan.batches.length,
      blockedRows: entities.reduce((sum, entity) => sum + entity.blockedRows, 0),
    },
    entities,
    warnings,
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}

export function createVerificationReport(input: {
  readonly checks: VerificationCheck[];
  readonly now?: Date;
}): VerificationReport {
  const failed = input.checks.filter((check) => check.status === "failed").length;

  return {
    status: failed > 0 ? "failed" : "passed",
    checks: input.checks,
    totals: {
      passed: input.checks.length - failed,
      failed,
    },
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}
