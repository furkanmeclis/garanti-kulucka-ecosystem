import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createCanonicalTableVerificationReport,
  migrationApplyDisabledMessage,
  parseMigratorCliCommand,
  parseMigratorCommand,
  resolveMigrationRunId,
  resolveTargetDatabaseUrl,
  runMigratorCommand,
  type MigratorCommandDependencies,
} from "../src/commands.js";

describe("migrator commands", () => {
  it("parses dry-run", () => {
    expect(parseMigratorCommand(["migrate", "--dry-run"])).toBe("migrate:dry-run");
  });

  it("parses apply", () => {
    expect(parseMigratorCommand(["migrate", "--apply"])).toBe("migrate:apply");
  });

  it("parses verify", () => {
    expect(parseMigratorCommand(["verify"])).toBe("verify");
  });

  it("parses optional report files without changing the command contract", () => {
    expect(parseMigratorCliCommand(["migrate", "--dry-run", "--report-file", "reports/dry_run.json"])).toEqual({
      command: "migrate:dry-run",
      options: { reportFile: "reports/dry_run.json" },
    });
    expect(parseMigratorCliCommand(["verify", "--report-file", "reports/verify.json"])).toEqual({
      command: "verify",
      options: { reportFile: "reports/verify.json" },
    });
  });

  it("requires only source database configuration for dry-run", async () => {
    await expect(runMigratorCommand("migrate:dry-run", {})).rejects.toThrow(
      "SOURCE_DATABASE_URL is required",
    );

    const executeMigration = vi.fn().mockResolvedValue(undefined);
    await expect(
      runMigratorCommand(
        "migrate:dry-run",
        { SOURCE_DATABASE_URL: "postgres://source/legacy" },
        {},
        commandDependencies(executeMigration),
      ),
    ).resolves.toBeUndefined();
    expect(executeMigration).toHaveBeenCalledWith({
      mode: "dry-run",
      sourceDatabaseUrl: "postgres://source/legacy",
      sourceSystem: "legacy_postgres",
      batchSize: 500,
    });
  });

  it("uses DATABASE_URL only as the documented target compatibility fallback", () => {
    expect(resolveTargetDatabaseUrl({ TARGET_DATABASE_URL: "postgres://target", DATABASE_URL: "postgres://old" })).toBe(
      "postgres://target",
    );
    expect(resolveTargetDatabaseUrl({ DATABASE_URL: "postgres://old" })).toBe("postgres://old");
    expect(() => resolveTargetDatabaseUrl({})).toThrow("compatibility fallback");
  });

  it("requires an explicit run id before apply can be enabled", async () => {
    const executeMigration = vi.fn().mockResolvedValue(undefined);
    const dependencies = commandDependencies(executeMigration);

    await expect(
      runMigratorCommand("migrate:apply", { SOURCE_DATABASE_URL: "postgres://source/legacy" }, {}, dependencies),
    ).rejects.toThrow("MIGRATION_RUN_ID is required");
    expect(executeMigration).not.toHaveBeenCalled();
    expect(() => resolveMigrationRunId({})).toThrow("MIGRATION_RUN_ID is required");
    expect(resolveMigrationRunId({ MIGRATION_RUN_ID: " legacy-import-2026-09 " })).toBe(
      "legacy-import-2026-09",
    );
  });

  it("fails apply closed before resolving or opening a target", async () => {
    const executeMigration = vi.fn().mockResolvedValue(undefined);

    await expect(
      runMigratorCommand(
        "migrate:apply",
        {
          SOURCE_DATABASE_URL: "postgres://source/legacy",
          MIGRATION_RUN_ID: "legacy-import-2026-09",
        },
        {},
        commandDependencies(executeMigration),
      ),
    ).rejects.toThrow(migrationApplyDisabledMessage);
    expect(executeMigration).not.toHaveBeenCalled();
  });

  it("writes a failed command report without leaking database configuration", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "garanti-migrator-"));
    const reportFile = join(tempDir, "nested", "report.json");

    try {
      await expect(runMigratorCommand("migrate:dry-run", {}, { reportFile })).rejects.toThrow(
        "SOURCE_DATABASE_URL is required",
      );

      const report = JSON.parse(await readFile(reportFile, "utf8")) as Record<string, unknown>;
      expect(report).toMatchObject({
        command: "migrate:dry-run",
        status: "failed",
        error: { message: "SOURCE_DATABASE_URL is required for migration commands" },
      });
      expect(report).not.toHaveProperty("databaseUrl");
      expect(report).not.toHaveProperty("DATABASE_URL");
      expect(typeof report.startedAt).toBe("string");
      expect(typeof report.finishedAt).toBe("string");
      expect(typeof report.durationMs).toBe("number");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects invalid migration batch sizes before opening a database", async () => {
    const executeMigration = vi.fn().mockResolvedValue(undefined);

    await expect(
      runMigratorCommand(
        "migrate:dry-run",
        {
          SOURCE_DATABASE_URL: "postgres://source",
          TARGET_DATABASE_URL: "postgres://target",
          MIGRATION_BATCH_SIZE: "0",
        },
        {},
        commandDependencies(executeMigration),
      ),
    ).rejects.toThrow("MIGRATION_BATCH_SIZE must be a positive integer");
    expect(executeMigration).not.toHaveBeenCalled();
  });

  it("redacts database URLs and password parameters from command reports and thrown errors", async () => {
    const directory = await mkdtemp(join(tmpdir(), "migrator-report-"));
    const reportFile = join(directory, "failure.json");
    const secret = "postgres://admin:top-secret@db.internal:5432/legacy?sslmode=require";
    const executeMigration = vi.fn().mockRejectedValue(new Error(`connection failed for ${secret} password=top-secret`));

    try {
      await expect(
        runMigratorCommand(
          "migrate:dry-run",
          { SOURCE_DATABASE_URL: secret },
          { reportFile },
          commandDependencies(executeMigration),
        ),
      ).rejects.toThrow("connection failed for [REDACTED_DATABASE_URL] password=[REDACTED]");

      const report = await readFile(reportFile, "utf8");
      expect(report).not.toContain("top-secret");
      expect(report).not.toContain("db.internal");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves failed verification details in the single failure report", async () => {
    const directory = await mkdtemp(join(tmpdir(), "migrator-verify-report-"));
    const reportFile = join(directory, "verification.json");
    const verification = {
      status: "failed" as const,
      checks: [{ name: "canonical_table.users", status: "failed" as const, expected: 1, actual: 0 }],
      totals: { passed: 0, failed: 1 },
      generatedAt: "2026-09-28T00:00:00.000Z",
    };

    try {
      await expect(
        runMigratorCommand(
          "verify",
          { TARGET_DATABASE_URL: "postgres://target/canonical" },
          { reportFile },
          {
            executeMigration: vi.fn(),
            verifyTarget: vi.fn().mockResolvedValue(verification),
          },
        ),
      ).rejects.toThrow("Canonical database verification failed");

      expect(JSON.parse(await readFile(reportFile, "utf8"))).toMatchObject({
        command: "verify",
        status: "failed",
        verification,
        error: { message: "Canonical database verification failed" },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves the safe migration error when writing its failure report fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "migrator-report-write-"));

    try {
      await expect(
        runMigratorCommand("migrate:dry-run", {}, { reportFile: directory }),
      ).rejects.toThrow("SOURCE_DATABASE_URL is required for migration commands");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("creates canonical table verification reports without leaking connection details", () => {
    const report = createCanonicalTableVerificationReport([
      "users",
      "roles",
      "customers",
      "conversations",
      "messages",
      "orders",
      "shipments",
      "integration_providers",
      "integration_accounts",
      "settings",
    ]);

    expect(report.status).toBe("failed");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "canonical_table.customer_external_identities",
        status: "failed",
        expected: 1,
        actual: 0,
      }),
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "canonical_table.legacy_id_map",
        status: "failed",
        expected: 1,
        actual: 0,
      }),
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "canonical_table.migration_batches",
        status: "failed",
        expected: 1,
        actual: 0,
      }),
    );
    expect(JSON.stringify(report)).not.toContain("DATABASE_URL");
    expect(JSON.stringify(report)).not.toContain("postgres://");
  });
});

function commandDependencies(
  executeMigration: MigratorCommandDependencies["executeMigration"],
): MigratorCommandDependencies {
  return {
    executeMigration,
    verifyTarget: vi.fn().mockResolvedValue({
      status: "passed",
      checks: [],
      totals: { passed: 0, failed: 0 },
      generatedAt: "2026-09-28T00:00:00.000Z",
    }),
  };
}
