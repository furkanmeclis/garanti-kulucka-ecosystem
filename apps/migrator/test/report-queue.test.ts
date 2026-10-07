import { describe, expect, it, vi } from "vitest";
import { migrationProgressFromReport } from "@garanti-kulucka/shared";
import { runMigratorCommand, type MigratorCommandDependencies } from "../src/commands.js";
import { createMigrationReportPublisher, migrationQueueReportFrom, publishMigrationReport, reportRunId, type MigrationReportPublisher } from "../src/report-queue.js";
import type { MigratorCommandReport } from "../src/types.js";

const base = { startedAt: "2026-10-07T09:00:00.000Z", finishedAt: "2026-10-07T09:00:05.000Z", durationMs: 5000 };

const dryRunReport: MigratorCommandReport = {
  command: "migrate:dry-run",
  status: "passed",
  ...base,
  migration: {
    mode: "dry-run",
    dryRunReport: {
      entities: [
        { entity: "customers", plannedRows: 120, plannedBatches: 1, blockedRows: 2 },
        { entity: "orders", plannedRows: 300, plannedBatches: 1, blockedRows: 0 },
      ],
      // Warnings may carry legacy row identifiers; they must never leave the migrator.
      warnings: [{ entity: "customers", sourceId: "legacy-42", message: "Telefon numarası 0555 111 22 33 geçersiz" }],
    },
  },
};

const applyReport: MigratorCommandReport = {
  command: "migrate:apply",
  status: "passed",
  ...base,
  migration: {
    mode: "apply",
    runId: "run_2026_10_07",
    plan: { entities: [{ entity: "customers", totalRows: 120 }, { entity: "orders", totalRows: 300 }] },
    batches: [
      { entity: "customers", batchNumber: 1, readRows: 120, writtenRows: 118, skippedRows: 2, idMapCreated: 100, idMapUpdated: 18, idMapUnchanged: 0, warnings: [] },
      { entity: "orders", batchNumber: 1, readRows: 200, writtenRows: 200, skippedRows: 0, idMapCreated: 200, idMapUpdated: 0, idMapUnchanged: 0, warnings: [] },
      { entity: "orders", batchNumber: 2, readRows: 100, writtenRows: 99, skippedRows: 1, idMapCreated: 99, idMapUpdated: 0, idMapUnchanged: 0, warnings: [] },
    ],
  },
  verification: {
    status: "failed",
    checks: [
      { name: "customers.count", status: "passed", expected: 118, actual: 118 },
      { name: "orders.count", status: "failed", expected: 300, actual: 299, message: "missing 1" },
    ],
    totals: { passed: 1, failed: 1 } as never,
    generatedAt: base.finishedAt,
  },
};

describe("migration report queue payload", () => {
  it("summarises a dry-run into counts only", () => {
    const payload = migrationQueueReportFrom("migrate:dry-run", dryRunReport, "dry-run-20261007090000");
    expect(payload).toEqual({
      run_id: "dry-run-20261007090000",
      report_type: "dry-run",
      report: {
        status: "passed",
        generatedAt: base.finishedAt,
        durationMs: 5000,
        totals: { plannedRows: 420, blockedRows: 2, appliedRows: 0, failed: 0 },
        entities: [
          { entity: "customers", plannedRows: 120, blockedRows: 2 },
          { entity: "orders", plannedRows: 300, blockedRows: 0 },
        ],
        checks: [],
      },
    });
    expect(JSON.stringify(payload)).not.toContain("legacy-42");
    expect(JSON.stringify(payload)).not.toContain("0555");
  });

  it("aggregates apply batches per entity and carries verification checks without values", () => {
    const payload = migrationQueueReportFrom("migrate:apply", applyReport, "run_2026_10_07");
    expect(payload.report.entities).toEqual([
      { entity: "customers", plannedRows: 120, blockedRows: 2, appliedRows: 118, insertedRows: 100 },
      { entity: "orders", plannedRows: 300, blockedRows: 1, appliedRows: 299, insertedRows: 299 },
    ]);
    expect(payload.report.totals).toEqual({ plannedRows: 420, blockedRows: 3, appliedRows: 417, failed: 1 });
    expect(payload.report.checks).toEqual([
      { name: "customers.count", status: "passed" },
      { name: "orders.count", status: "failed" },
    ]);
    // The worker turns this into migration_rows{entity,state}.
    expect(migrationProgressFromReport(payload.report)).toContainEqual({ entity: "orders", state: "applied", rows: 299 });
    expect(migrationProgressFromReport(payload.report)).toContainEqual({ entity: "customers", state: "inserted", rows: 100 });
  });

  it("uses MIGRATION_RUN_ID or a timestamped id", () => {
    expect(reportRunId({ MIGRATION_RUN_ID: " run_7 " }, "migrate:apply", base.startedAt)).toBe("run_7");
    expect(reportRunId({}, "migrate:dry-run", base.startedAt)).toBe("dry-run-20261007090000");
  });

  it("publishes best effort and only when REDIS_URL is configured", async () => {
    expect(createMigrationReportPublisher({})).toBeNull();
    expect(createMigrationReportPublisher({ REDIS_URL: "redis://redis:6379", MIGRATION_REPORT_QUEUE_ENABLED: "false" })).toBeNull();
    expect(createMigrationReportPublisher({ REDIS_URL: "redis://redis:6379" })).toBeTypeOf("function");

    const publisher = vi.fn<MigrationReportPublisher>(async () => undefined);
    await expect(publishMigrationReport({ command: "migrate:apply", report: applyReport, env: { MIGRATION_RUN_ID: "run 7/x" }, publisher })).resolves.toBe("published");
    expect(publisher).toHaveBeenCalledWith(
      expect.objectContaining({ queue: "migration-reports", name: "migration.report", job_id: "migration_report_run_7_x_apply_20261007090005000" }),
    );
    await expect(publishMigrationReport({ command: "verify", report: applyReport, env: {}, publisher: async () => Promise.reject(new Error("redis down")) })).resolves.toBe("failed");
    await expect(publishMigrationReport({ command: "verify", report: applyReport, env: {}, publisher: null })).resolves.toBe("skipped");
  });

  it("publishes the command report from runMigratorCommand, also when the command fails", async () => {
    const published: unknown[] = [];
    const publishReport: MigrationReportPublisher = async (job) => {
      published.push(job);
    };
    const dependencies: MigratorCommandDependencies = {
      executeMigration: vi.fn().mockResolvedValue({ mode: "dry-run", dryRunReport: { entities: [{ entity: "customers", plannedRows: 3, plannedBatches: 1, blockedRows: 0 }] } }),
      verifyTarget: vi.fn().mockResolvedValue({ status: "failed", checks: [{ name: "customers.count", status: "failed" }], totals: {}, generatedAt: base.finishedAt }),
      publishReport,
    };
    await runMigratorCommand("migrate:dry-run", { SOURCE_DATABASE_URL: "postgres://source/legacy" }, {}, dependencies);
    expect(published[0]).toMatchObject({ payload: { report_type: "dry-run", report: { status: "passed", totals: { plannedRows: 3 } } } });

    await expect(runMigratorCommand("verify", { TARGET_DATABASE_URL: "postgres://target/app", MIGRATION_RUN_ID: "run_9" }, {}, dependencies)).rejects.toThrow();
    expect(published[1]).toMatchObject({ payload: { run_id: "run_9", report_type: "verify", report: { status: "failed", totals: { failed: 1 } } } });
  });
});
