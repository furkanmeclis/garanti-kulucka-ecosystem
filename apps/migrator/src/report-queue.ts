import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { MigratorCommand } from "./commands.js";
import type { DryRunReport, MigrationBatchApplyResult, MigrationPlan, MigratorCommandReport, VerificationReport } from "./types.js";

/**
 * Sends every migrator command report to the worker's `migration-reports` queue as a
 * `migration.report` job, so `migration_rows` / `migration_report_last_received_timestamp_seconds`
 * (and the MigrationRunStalled alert) follow dry-runs, applies and verifies without an operator step.
 * Only aggregate counts leave the migrator: no warnings, row data, URLs or identities.
 * Publishing is best effort and never changes the command result.
 */

export interface MigrationQueueReport {
  readonly run_id: string;
  readonly report_type: "dry-run" | "apply" | "verify";
  readonly report: {
    readonly status: string;
    readonly generatedAt: string;
    readonly durationMs: number;
    readonly totals: { readonly plannedRows: number; readonly blockedRows: number; readonly appliedRows: number; readonly failed: number };
    readonly entities: ReadonlyArray<{ readonly entity: string; readonly plannedRows: number; readonly blockedRows: number; readonly appliedRows?: number; readonly insertedRows?: number }>;
    readonly checks: ReadonlyArray<{ readonly name: string; readonly status: string }>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const reportTypes: Record<MigratorCommand, MigrationQueueReport["report_type"]> = {
  "migrate:dry-run": "dry-run",
  "migrate:apply": "apply",
  verify: "verify",
};

function entitySummaries(migration: unknown): MigrationQueueReport["report"]["entities"] {
  if (!isRecord(migration)) return [];
  const dryRun = migration.dryRunReport as DryRunReport | undefined;
  if (dryRun && Array.isArray(dryRun.entities)) {
    return dryRun.entities.map((entity) => ({ entity: entity.entity, plannedRows: entity.plannedRows, blockedRows: entity.blockedRows }));
  }
  const plan = migration.plan as MigrationPlan | undefined;
  const batches = Array.isArray(migration.batches) ? (migration.batches as MigrationBatchApplyResult[]) : [];
  const byEntity = new Map<string, { plannedRows: number; blockedRows: number; appliedRows: number; insertedRows: number }>();
  for (const entity of plan?.entities ?? []) {
    byEntity.set(entity.entity, { plannedRows: entity.totalRows, blockedRows: 0, appliedRows: 0, insertedRows: 0 });
  }
  for (const batch of batches) {
    const current = byEntity.get(batch.entity) ?? { plannedRows: 0, blockedRows: 0, appliedRows: 0, insertedRows: 0 };
    current.appliedRows += batch.writtenRows;
    current.insertedRows += batch.idMapCreated;
    current.blockedRows += batch.skippedRows;
    byEntity.set(batch.entity, current);
  }
  return [...byEntity].map(([entity, counts]) => ({ entity, ...counts }));
}

function verificationChecks(verification: VerificationReport | undefined) {
  return (verification?.checks ?? []).map((check) => ({ name: check.name, status: check.status }));
}

export function migrationQueueReportFrom(command: MigratorCommand, report: MigratorCommandReport, runId: string): MigrationQueueReport {
  const entities = entitySummaries(report.migration);
  const checks = verificationChecks(report.verification);
  return {
    run_id: runId,
    report_type: reportTypes[command],
    report: {
      status: report.status,
      generatedAt: report.finishedAt,
      durationMs: report.durationMs,
      totals: {
        plannedRows: entities.reduce((sum, entity) => sum + entity.plannedRows, 0),
        blockedRows: entities.reduce((sum, entity) => sum + entity.blockedRows, 0),
        appliedRows: entities.reduce((sum, entity) => sum + (entity.appliedRows ?? 0), 0),
        failed: checks.filter((check) => check.status === "failed").length,
      },
      entities,
      checks,
    },
  };
}

/** MIGRATION_RUN_ID, or a timestamped id for dry-runs that do not need one. */
export function reportRunId(env: NodeJS.ProcessEnv, command: MigratorCommand, startedAt: string) {
  const configured = env.MIGRATION_RUN_ID?.trim();
  if (configured) return configured;
  return `${reportTypes[command]}-${startedAt.replace(/[^0-9]/g, "").slice(0, 14)}`;
}

export type MigrationReportPublisher = (job: {
  job_id: string;
  queue: "migration-reports";
  name: "migration.report";
  payload: MigrationQueueReport;
  requested_at: string;
}) => Promise<void>;

/** BullMQ publisher on REDIS_URL; `null` when the queue is not configured or explicitly disabled. */
export function createMigrationReportPublisher(env: NodeJS.ProcessEnv): MigrationReportPublisher | null {
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl || env.MIGRATION_REPORT_QUEUE_ENABLED === "false") return null;
  return async (job) => {
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 5_000, retryStrategy: () => null });
    // An unreachable Redis must surface as a rejected publish, never as an unhandled "error" event that
    // would crash the migrator after its real work is done.
    let connectionError: Error | null = null;
    connection.on("error", (error: Error) => {
      connectionError = error;
    });
    const queue = new Queue("migration-reports", { connection });
    queue.on("error", () => undefined);
    try {
      await queue.add(job.name, job, { jobId: job.job_id, removeOnComplete: 100, removeOnFail: 500 });
    } catch (error) {
      throw connectionError ?? error;
    } finally {
      await queue.close().catch(() => undefined);
      connection.disconnect();
    }
  };
}

export async function publishMigrationReport(input: {
  command: MigratorCommand;
  report: MigratorCommandReport;
  env: NodeJS.ProcessEnv;
  publisher: MigrationReportPublisher | null;
}): Promise<"published" | "skipped" | "failed"> {
  if (!input.publisher) return "skipped";
  const payload = migrationQueueReportFrom(input.command, input.report, reportRunId(input.env, input.command, input.report.startedAt));
  const stamp = input.report.finishedAt.replace(/[^0-9]/g, "");
  try {
    await input.publisher({
      job_id: `migration_report_${payload.run_id.replace(/[^A-Za-z0-9_-]/g, "_")}_${payload.report_type}_${stamp}`,
      queue: "migration-reports",
      name: "migration.report",
      payload,
      requested_at: new Date().toISOString(),
    });
    return "published";
  } catch {
    return "failed";
  }
}
