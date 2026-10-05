import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  it("passes conversation account and user public id snapshot files into the dry-run", async () => {
    const directory = await mkdtemp(join(tmpdir(), "migrator-snapshots-"));
    const accountsFile = join(directory, "accounts.json");
    const userPublicIdsFile = join(directory, "users.json");
    const accounts = [
      { publicId: "iac_whatsapp_main", providerKey: "whatsapp", status: "active", externalAccountId: null },
      { publicId: "iac_instagram_main", providerKey: "instagram", status: "active", externalAccountId: "ig-17841" },
    ];
    const executeMigration = vi.fn().mockResolvedValue(undefined);

    try {
      await writeFile(accountsFile, JSON.stringify(accounts));
      await writeFile(userPublicIdsFile, JSON.stringify({ "7b98c4c9-ac91-4e3a-9f83-d8c2ba6e3870": "usr_agent_1" }));

      await runMigratorCommand(
        "migrate:dry-run",
        {
          SOURCE_DATABASE_URL: "postgres://source/legacy",
          MIGRATION_CONVERSATION_ACCOUNTS_FILE: accountsFile,
          MIGRATION_USER_PUBLIC_IDS_FILE: userPublicIdsFile,
        },
        {},
        commandDependencies(executeMigration),
      );

      expect(executeMigration).toHaveBeenCalledWith({
        mode: "dry-run",
        sourceDatabaseUrl: "postgres://source/legacy",
        sourceSystem: "legacy_postgres",
        batchSize: 500,
        conversationAccounts: accounts,
        userPublicIds: new Map([["7b98c4c9-ac91-4e3a-9f83-d8c2ba6e3870", "usr_agent_1"]]),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects invalid snapshot files with fixed messages that do not echo their contents", async () => {
    const directory = await mkdtemp(join(tmpdir(), "migrator-snapshots-invalid-"));
    const reportFile = join(directory, "report.json");
    const invalidAccountsFile = join(directory, "invalid-accounts.json");
    const malformedAccountsFile = join(directory, "malformed-accounts.json");
    const invalidUsersFile = join(directory, "invalid-users.json");
    const executeMigration = vi.fn().mockResolvedValue(undefined);
    const run = (env: Record<string, string>) => runMigratorCommand(
      "migrate:dry-run",
      { SOURCE_DATABASE_URL: "postgres://source/legacy", ...env },
      { reportFile },
      commandDependencies(executeMigration),
    ).then(() => null, (reason: unknown) => reason as Error);

    try {
      await writeFile(invalidAccountsFile, JSON.stringify([
        { publicId: "iac_instagram_main", providerKey: "tiktok", status: "active", externalAccountId: "ig-secret-account" },
      ]));
      await writeFile(malformedAccountsFile, "[{\"externalAccountId\": \"ig-secret-account\"");
      await writeFile(invalidUsersFile, JSON.stringify({ "not-a-uuid": "usr_secret_user" }));

      const cases: { env: Record<string, string>; message: string }[] = [
        {
          env: { MIGRATION_CONVERSATION_ACCOUNTS_FILE: invalidAccountsFile },
          message: "MIGRATION_CONVERSATION_ACCOUNTS_FILE must contain a valid conversation account array",
        },
        {
          env: { MIGRATION_CONVERSATION_ACCOUNTS_FILE: malformedAccountsFile },
          message: "MIGRATION_CONVERSATION_ACCOUNTS_FILE must contain valid JSON",
        },
        {
          env: { MIGRATION_USER_PUBLIC_IDS_FILE: invalidUsersFile },
          message: "MIGRATION_USER_PUBLIC_IDS_FILE must map legacy user UUIDs to nonblank public ids",
        },
      ];
      for (const { env, message } of cases) {
        const error = await run(env);
        expect(error?.message).toBe(message);
        const report = await readFile(reportFile, "utf8");
        for (const secret of ["ig-secret-account", "iac_instagram_main", "usr_secret_user", "not-a-uuid"]) {
          expect(error?.message).not.toContain(secret);
          expect(report).not.toContain(secret);
        }
      }
      expect(executeMigration).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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

  it.each([
    {
      name: "missing explicit enable flag",
      env: {},
      message: migrationApplyDisabledMessage,
    },
    {
      name: "missing backup evidence path",
      env: { MIGRATION_APPLY_ENABLED: "true" },
      message: "MIGRATION_BACKUP_EVIDENCE is required",
    },
    {
      name: "unreadable backup evidence",
      env: { MIGRATION_APPLY_ENABLED: "true", MIGRATION_BACKUP_EVIDENCE: "/tmp/not-a-real-backup-evidence.json" },
      message: "MIGRATION_BACKUP_EVIDENCE could not be read",
    },
    {
      name: "same source and target database",
      env: {
        MIGRATION_APPLY_ENABLED: "true",
        MIGRATION_BACKUP_EVIDENCE: "same",
        TARGET_DATABASE_URL: "postgres://db.example/legacy",
      },
      message: "Source and target database identities must be different",
    },
  ])("refuses apply gate when $name without opening migration connections", async ({ env, message }) => {
    const directory = await mkdtemp(join(tmpdir(), "migrator-apply-gate-"));
    const evidenceFile = join(directory, "backup.json");
    const executeMigration = vi.fn().mockResolvedValue(undefined);
    const verifyTarget = vi.fn();

    try {
      await writeFile(evidenceFile, JSON.stringify({
        targetDatabaseIdentity: { host: "db.example", port: "5432", database: "canonical" },
        createdAt: new Date().toISOString(),
      }));
      const resolvedEnv = Object.fromEntries(
        Object.entries(env).map(([key, value]) => [key, value === "same" ? evidenceFile : value]),
      );

      await expect(runMigratorCommand(
        "migrate:apply",
        {
          SOURCE_DATABASE_URL: "postgres://db.example/legacy",
          TARGET_DATABASE_URL: "postgres://db.example/canonical",
          MIGRATION_RUN_ID: "legacy-import-2026-10",
          ...resolvedEnv,
        },
        {},
        { executeMigration, verifyTarget },
      )).rejects.toThrow(message);
      expect(executeMigration).not.toHaveBeenCalled();
      expect(verifyTarget).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "malformed backup evidence",
      evidence: "{",
      message: "MIGRATION_BACKUP_EVIDENCE must contain valid JSON",
    },
    {
      name: "invalid backup manifest",
      evidence: JSON.stringify({ createdAt: "2026-10-05T00:00:00.000Z" }),
      message: "MIGRATION_BACKUP_EVIDENCE must contain a backup manifest",
    },
    {
      name: "stale backup manifest",
      evidence: JSON.stringify({
        targetDatabaseIdentity: { host: "db.example", port: "5432", database: "canonical" },
        createdAt: "2000-01-01T00:00:00.000Z",
      }),
      message: "MIGRATION_BACKUP_EVIDENCE is older than 24 hours",
    },
    {
      name: "wrong target identity",
      evidence: JSON.stringify({
        targetDatabaseIdentity: { host: "db.example", port: "5432", database: "other" },
        createdAt: new Date().toISOString(),
      }),
      message: "MIGRATION_BACKUP_EVIDENCE target database identity does not match",
    },
  ])("refuses apply gate for $name without opening migration connections", async ({ evidence, message }) => {
    const directory = await mkdtemp(join(tmpdir(), "migrator-apply-evidence-"));
    const evidenceFile = join(directory, "backup.json");
    const executeMigration = vi.fn().mockResolvedValue(undefined);
    const verifyTarget = vi.fn();

    try {
      await writeFile(evidenceFile, evidence);
      await expect(runMigratorCommand(
        "migrate:apply",
        {
          SOURCE_DATABASE_URL: "postgres://db.example/legacy",
          TARGET_DATABASE_URL: "postgres://db.example/canonical",
          MIGRATION_RUN_ID: "legacy-import-2026-10",
          MIGRATION_APPLY_ENABLED: "true",
          MIGRATION_BACKUP_EVIDENCE: evidenceFile,
        },
        {},
        { executeMigration, verifyTarget },
      )).rejects.toThrow(message);
      expect(executeMigration).not.toHaveBeenCalled();
      expect(verifyTarget).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("runs apply, then verify, and writes a secret-free operation report when both gates pass", async () => {
    const directory = await mkdtemp(join(tmpdir(), "migrator-apply-report-"));
    const evidenceFile = join(directory, "backup.json");
    const reportFile = join(directory, "report.json");
    const executeMigration = vi.fn().mockResolvedValue({
      mode: "apply",
      deferredReconciliation: { examined: 1, resolved: 1, pending: 0 },
      batches: [{ entity: "customers", batchNumber: 1, readRows: 1, writtenRows: 2 }],
    });
    const verifyTarget = vi.fn().mockResolvedValue({
      status: "passed",
      checks: [],
      totals: { passed: 0, failed: 0 },
      generatedAt: "2026-10-05T00:00:00.000Z",
    });

    try {
      await writeFile(evidenceFile, JSON.stringify({
        targetDatabaseIdentity: { host: "db.example", port: "5432", database: "canonical" },
        createdAt: new Date().toISOString(),
      }));
      await expect(runMigratorCommand(
        "migrate:apply",
        {
          SOURCE_DATABASE_URL: "postgres://source-secret:pass@db.example/legacy",
          TARGET_DATABASE_URL: "postgres://target-secret:pass@db.example/canonical",
          MIGRATION_RUN_ID: "legacy-import-2026-10",
          MIGRATION_APPLY_ENABLED: "true",
          MIGRATION_BACKUP_EVIDENCE: evidenceFile,
        },
        { reportFile },
        { executeMigration, verifyTarget },
      )).resolves.toBeUndefined();

      expect(executeMigration).toHaveBeenCalledWith(expect.objectContaining({
        mode: "apply",
        runId: "legacy-import-2026-10",
        applyApproval: expect.objectContaining({
          runId: "legacy-import-2026-10",
          backupEvidenceCreatedAt: expect.any(String),
        }),
      }));
      expect(verifyTarget).toHaveBeenCalledWith(
        "postgres://target-secret:pass@db.example/canonical",
        "legacy-import-2026-10",
      );
      const report = await readFile(reportFile, "utf8");
      expect(report).toContain("\"status\": \"passed\"");
      expect(report).toContain("\"reconciliation\"");
      expect(report).not.toContain("source-secret");
      expect(report).not.toContain("target-secret");
      expect(report).not.toContain("postgres://");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
    const secret = "postgres://admin:top-secret@db.internal:5432/legacy?sslmode=require&access_token=query-secret";
    const error = Object.assign(
      new Error(`connection failed for ${secret} password=top-secret Authorization: Bearer provider-secret`),
      { cause: new Error("nested cause access_token=nested-secret") },
    );
    const executeMigration = vi.fn().mockRejectedValue(error);

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
      expect(report).not.toContain("query-secret");
      expect(report).not.toContain("provider-secret");
      expect(report).not.toContain("nested-secret");
      expect(report).not.toContain("db.internal");
      expect(report).not.toContain("cause");
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
          { TARGET_DATABASE_URL: "postgres://target/canonical", MIGRATION_RUN_ID: "run_2026_09" },
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
        name: "canonical_table.customer_addresses",
        status: "failed",
      }),
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "canonical_table.products",
        status: "failed",
      }),
    );
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "canonical_table.shipment_tracking_events",
        status: "failed",
      }),
    );
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
        name: "canonical_table.migration_deferred_reconciliations",
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
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "canonical_table.migration_runs",
        status: "failed",
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
