import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Client } from "pg";
import { assertVerifiedConversationAccounts, type VerifiedConversationAccount } from "./conversation-mapping.js";
import { migrationApplyDisabledMessage, toSafeMigratorError } from "./errors.js";
import { canonicalMigrationEntities } from "./plan.js";
import { createVerificationReport } from "./reports.js";
import { createTargetVerificationSnapshot } from "./target-snapshot.js";
import type { MigratorCommandReport, MigratorCommandReportError, VerificationReport } from "./types.js";
import { createMigrationVerificationReport } from "./verify.js";

export type MigratorCommand = "migrate:dry-run" | "migrate:apply" | "verify";

export interface ParsedMigratorCommand {
  readonly command: MigratorCommand;
  readonly options: MigratorCommandOptions;
}

export interface MigratorCommandOptions {
  readonly reportFile?: string;
}

export interface MigratorCommandDependencies {
  readonly executeMigration: (input: ExecutePostgresMigrationInput) => Promise<unknown>;
  readonly verifyTarget: (databaseUrl: string, runId: string) => Promise<VerificationReport>;
}

export interface ExecutePostgresDryRunInput {
  readonly mode: "dry-run";
  readonly sourceDatabaseUrl: string;
  readonly sourceSystem: string;
  readonly batchSize: number;
  readonly conversationAccounts?: readonly VerifiedConversationAccount[];
  readonly userPublicIds?: ReadonlyMap<string, string>;
}

export interface ExecutePostgresApplyInput {
  readonly mode: "apply";
  readonly sourceDatabaseUrl: string;
  readonly targetDatabaseUrl: string;
  readonly sourceSystem: string;
  readonly runId: string;
  readonly batchSize: number;
}

export type ExecutePostgresMigrationInput = ExecutePostgresDryRunInput | ExecutePostgresApplyInput;

const defaultCommandDependencies: MigratorCommandDependencies = {
  executeMigration: async (input) => {
    const { executePostgresMigration } = await import("./postgres-runtime.js");
    return executePostgresMigration(input);
  },
  verifyTarget: verifyTargetDatabase,
};

const defaultMigrationBatchSize = 500;
const defaultMigrationSourceSystem = "legacy_postgres";
export { migrationApplyDisabledMessage } from "./errors.js";

const requiredCanonicalTables = [
  "users",
  "roles",
  "integration_providers",
  ...canonicalMigrationEntities,
  "migration_runs",
  "migration_batches",
  "legacy_id_map",
  "migration_deferred_reconciliations",
];

export function parseMigratorCommand(args: string[]): MigratorCommand {
  return parseMigratorCliCommand(args).command;
}

export function parseMigratorCliCommand(args: string[]): ParsedMigratorCommand {
  const [command, flag, ...rest] = args;
  const options = parseMigratorOptions(command === "verify" ? [flag, ...rest] : rest);

  if (command === "verify") return { command: "verify", options };
  if (command === "migrate" && flag === "--dry-run") return { command: "migrate:dry-run", options };
  if (command === "migrate" && flag === "--apply") return { command: "migrate:apply", options };

  throw new Error(usage);
}

export async function runMigratorCommand(
  command: MigratorCommand,
  env = process.env,
  options: MigratorCommandOptions = {},
  dependencies: MigratorCommandDependencies = defaultCommandDependencies,
): Promise<void> {
  const startedAt = new Date();
  let failedVerification: VerificationReport | undefined;

  try {
    if (command === "verify") {
      const targetDatabaseUrl = resolveTargetDatabaseUrl(env);
      const verification = await dependencies.verifyTarget(targetDatabaseUrl, resolveMigrationRunId(env));
      if (verification.status === "failed") {
        failedVerification = verification;
        throw new Error("Canonical database verification failed");
      }

      await writeMigratorCommandReport(options, createCommandReport(command, "passed", startedAt, undefined, verification));
      return;
    }

    const sourceDatabaseUrl = env.SOURCE_DATABASE_URL;
    if (!sourceDatabaseUrl) {
      throw new Error("SOURCE_DATABASE_URL is required for migration commands");
    }

    const sourceSystem = env.MIGRATION_SOURCE_SYSTEM?.trim() || defaultMigrationSourceSystem;
    const batchSize = parseMigrationBatchSize(env.MIGRATION_BATCH_SIZE);

    if (command === "migrate:apply") {
      resolveMigrationRunId(env);
      throw new Error(migrationApplyDisabledMessage);
    }

    const conversationAccountsFile = env.MIGRATION_CONVERSATION_ACCOUNTS_FILE?.trim();
    const userPublicIdsFile = env.MIGRATION_USER_PUBLIC_IDS_FILE?.trim();
    const conversationAccounts = conversationAccountsFile
      ? await readConversationAccountsFile(conversationAccountsFile)
      : undefined;
    const userPublicIds = userPublicIdsFile ? await readUserPublicIdsFile(userPublicIdsFile) : undefined;

    await dependencies.executeMigration({
      mode: "dry-run",
      sourceDatabaseUrl,
      sourceSystem,
      batchSize,
      ...(conversationAccounts ? { conversationAccounts } : {}),
      ...(userPublicIds ? { userPublicIds } : {}),
    });
    await writeMigratorCommandReport(options, createCommandReport(command, "passed", startedAt));
  } catch (error) {
    const safeError = toSafeMigratorError(error);
    try {
      await writeMigratorCommandReport(
        options,
        createCommandReport(command, "failed", startedAt, safeError, failedVerification),
      );
    } catch {
      // Reporting is best-effort; the safe migration error remains the command result.
    }
    throw safeError;
  }
}

function parseMigratorOptions(args: (string | undefined)[]): MigratorCommandOptions {
  const options: { reportFile?: string } = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;

    if (arg !== "--report-file") {
      throw new Error(usage);
    }

    const reportFile = args[index + 1];
    if (!reportFile || reportFile.startsWith("--")) {
      throw new Error("--report-file requires a path");
    }

    options.reportFile = reportFile;
    index += 1;
  }

  return options;
}

export function resolveTargetDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const databaseUrl = env.TARGET_DATABASE_URL ?? env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("TARGET_DATABASE_URL is required (DATABASE_URL is supported as a compatibility fallback)");
  }

  return databaseUrl;
}

export function resolveMigrationRunId(env: NodeJS.ProcessEnv): string {
  const runId = env.MIGRATION_RUN_ID?.trim();
  if (!runId) {
    throw new Error("MIGRATION_RUN_ID is required for migrate --apply and verify");
  }

  return runId;
}

function parseMigrationBatchSize(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return defaultMigrationBatchSize;

  const batchSize = Number(value);
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("MIGRATION_BATCH_SIZE must be a positive integer");
  }

  return batchSize;
}

const legacyUserIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readConversationAccountsFile(path: string): Promise<readonly VerifiedConversationAccount[]> {
  const value = await readJsonSnapshotFile(path, "MIGRATION_CONVERSATION_ACCOUNTS_FILE");
  try {
    assertVerifiedConversationAccounts(value);
  } catch {
    throw new Error("MIGRATION_CONVERSATION_ACCOUNTS_FILE must contain a valid conversation account array");
  }
  return value;
}

async function readUserPublicIdsFile(path: string): Promise<ReadonlyMap<string, string>> {
  const value = await readJsonSnapshotFile(path, "MIGRATION_USER_PUBLIC_IDS_FILE");
  const invalid = "MIGRATION_USER_PUBLIC_IDS_FILE must map legacy user UUIDs to nonblank public ids";
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(invalid);
  const userPublicIds = new Map<string, string>();
  for (const [legacyUserId, publicId] of Object.entries(value)) {
    if (!legacyUserIdPattern.test(legacyUserId) || typeof publicId !== "string" || !publicId.trim()) {
      throw new Error(invalid);
    }
    userPublicIds.set(legacyUserId, publicId);
  }
  return userPublicIds;
}

async function readJsonSnapshotFile(path: string, variable: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new Error(`${variable} could not be read`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${variable} must contain valid JSON`);
  }
}

async function writeMigratorCommandReport(
  options: MigratorCommandOptions,
  report: MigratorCommandReport,
): Promise<void> {
  if (!options.reportFile) {
    return;
  }

  await mkdir(dirname(options.reportFile), { recursive: true });
  await writeFile(options.reportFile, `${JSON.stringify(report, null, 2)}\n`);
}

function createCommandReport(
  command: MigratorCommand,
  status: MigratorCommandReport["status"],
  startedAt: Date,
  error?: unknown,
  verification?: VerificationReport,
): MigratorCommandReport {
  const finishedAt = new Date();
  return {
    command,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    ...(verification ? { verification } : {}),
    ...(error ? { error: createReportError(error) } : {}),
  };
}

function createReportError(error: unknown): MigratorCommandReportError {
  if (error instanceof Error) {
    return { message: error.message };
  }

  return { message: "Unknown migrator error" };
}

async function verifyTargetDatabase(databaseUrl: string, runId: string): Promise<VerificationReport> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const result = await client.query<{ table_name: string }>(
      `
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])
      `,
      [requiredCanonicalTables],
    );

    const tableVerification = createCanonicalTableVerificationReport(result.rows.map((row) => row.table_name));
    if (tableVerification.status === "failed") {
      return tableVerification;
    }

    return createMigrationVerificationReport(await createTargetVerificationSnapshot(client, runId));
  } finally {
    await client.end();
  }
}

export function createCanonicalTableVerificationReport(existingTables: string[]): VerificationReport {
  const existing = new Set(existingTables);

  return createVerificationReport({
    checks: requiredCanonicalTables.map((table) => ({
      name: `canonical_table.${table}`,
      status: existing.has(table) ? "passed" : "failed",
      expected: 1,
      actual: existing.has(table) ? 1 : 0,
      ...(existing.has(table) ? {} : { message: `Missing canonical table: ${table}` }),
    })),
  });
}

const usage =
  "Usage: garanti-migrator migrate --dry-run [--report-file path] | migrate --apply [--report-file path] | verify [--report-file path]";
