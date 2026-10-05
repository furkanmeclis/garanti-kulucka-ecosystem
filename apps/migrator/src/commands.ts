import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Client } from "pg";
import { createMigrationApplyApproval, type MigrationApplyApproval } from "./apply-approval.js";
import { assertVerifiedConversationAccounts, type VerifiedConversationAccount } from "./conversation-mapping.js";
import { normalizePostgresDatabaseIdentity } from "./database-identity.js";
import { migrationApplyDisabledMessage, toSafeMigratorError } from "./errors.js";
import { canonicalMigrationEntities } from "./plan.js";
import { createVerificationReport } from "./reports.js";
import { createTargetVerificationSnapshot } from "./target-snapshot.js";
import type {
  DeferredReconciliationResult,
  MigratorCommandReport,
  MigratorCommandReportError,
  SourceDatabaseIdentity,
  VerificationReport,
} from "./types.js";
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
  readonly applyApproval?: MigrationApplyApproval;
  readonly conversationAccounts?: readonly VerifiedConversationAccount[];
  readonly userPublicIds?: ReadonlyMap<string, string>;
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
const defaultBackupEvidenceMaxAgeHours = 24;
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
  let commandMigration: unknown;
  let commandReconciliation: DeferredReconciliationResult | undefined;
  let commandVerification: VerificationReport | undefined;

  try {
    if (command === "verify") {
      const targetDatabaseUrl = resolveTargetDatabaseUrl(env);
      const verification = await dependencies.verifyTarget(targetDatabaseUrl, resolveMigrationRunId(env));
      if (verification.status === "failed") {
        failedVerification = verification;
        throw new Error("Canonical database verification failed");
      }

      await writeMigratorCommandReport(
        options,
        createCommandReport(command, "passed", startedAt, undefined, { verification }),
      );
      return;
    }

    const sourceDatabaseUrl = env.SOURCE_DATABASE_URL;
    if (!sourceDatabaseUrl) {
      throw new Error("SOURCE_DATABASE_URL is required for migration commands");
    }

    const sourceSystem = env.MIGRATION_SOURCE_SYSTEM?.trim() || defaultMigrationSourceSystem;
    const batchSize = parseMigrationBatchSize(env.MIGRATION_BATCH_SIZE);

    const conversationAccountsFile = env.MIGRATION_CONVERSATION_ACCOUNTS_FILE?.trim();
    const userPublicIdsFile = env.MIGRATION_USER_PUBLIC_IDS_FILE?.trim();
    const conversationAccounts = conversationAccountsFile
      ? await readConversationAccountsFile(conversationAccountsFile)
      : undefined;
    const userPublicIds = userPublicIdsFile ? await readUserPublicIdsFile(userPublicIdsFile) : undefined;

    if (command === "migrate:apply") {
      const runId = resolveMigrationRunId(env);
      const applyApproval = await assertMigrationApplyGateWithEvidence(env, sourceDatabaseUrl, runId, startedAt);
      const targetDatabaseUrl = resolveTargetDatabaseUrl(env);
      commandMigration = await dependencies.executeMigration({
        mode: "apply",
        sourceDatabaseUrl,
        targetDatabaseUrl,
        sourceSystem,
        runId,
        batchSize,
        applyApproval,
        ...(conversationAccounts ? { conversationAccounts } : {}),
        ...(userPublicIds ? { userPublicIds } : {}),
      });
      commandReconciliation = extractDeferredReconciliation(commandMigration);
      commandVerification = await dependencies.verifyTarget(targetDatabaseUrl, runId);
      if (commandVerification.status === "failed") {
        failedVerification = commandVerification;
        throw new Error("Canonical database verification failed");
      }
      await writeMigratorCommandReport(
        options,
        createCommandReport(command, "passed", startedAt, undefined, {
          migration: commandMigration,
          verification: commandVerification,
          ...(commandReconciliation ? { reconciliation: commandReconciliation } : {}),
        }),
      );
      return;
    }

    commandMigration = await dependencies.executeMigration({
      mode: "dry-run",
      sourceDatabaseUrl,
      sourceSystem,
      batchSize,
      ...(conversationAccounts ? { conversationAccounts } : {}),
      ...(userPublicIds ? { userPublicIds } : {}),
    });
    await writeMigratorCommandReport(
      options,
      createCommandReport(command, "passed", startedAt, undefined, { migration: commandMigration }),
    );
  } catch (error) {
    const safeError = toSafeMigratorError(error);
    try {
      await writeMigratorCommandReport(
        options,
        createCommandReport(command, "failed", startedAt, safeError, {
          ...(commandMigration ? { migration: commandMigration } : {}),
          ...(commandReconciliation ? { reconciliation: commandReconciliation } : {}),
          ...(failedVerification ?? commandVerification
            ? { verification: (failedVerification ?? commandVerification)! }
            : {}),
        }),
      );
    } catch {
      // Reporting is best-effort; the safe migration error remains the command result.
    }
    throw safeError;
  }
}

export interface MigrationBackupEvidence {
  readonly targetDatabaseIdentity: SourceDatabaseIdentity;
  readonly createdAt: string;
}

export function assertMigrationApplyGate(
  env: NodeJS.ProcessEnv,
  sourceDatabaseUrl: string,
  now = new Date(),
): void {
  if (env.MIGRATION_APPLY_ENABLED !== "true") {
    throw new Error(migrationApplyDisabledMessage);
  }

  const evidencePath = env.MIGRATION_BACKUP_EVIDENCE?.trim();
  if (!evidencePath) {
    throw new Error("MIGRATION_BACKUP_EVIDENCE is required when MIGRATION_APPLY_ENABLED=true");
  }

  const targetDatabaseUrl = resolveTargetDatabaseUrl(env);
  const sourceIdentity = normalizePostgresDatabaseIdentity(sourceDatabaseUrl);
  const targetIdentity = normalizePostgresDatabaseIdentity(targetDatabaseUrl);
  if (databaseIdentityKey(sourceIdentity) === databaseIdentityKey(targetIdentity)) {
    throw new Error("Source and target database identities must be different");
  }
}

export async function readAndValidateMigrationBackupEvidence(
  path: string,
  targetDatabaseUrl: string,
  now = new Date(),
  maxAgeHours = defaultBackupEvidenceMaxAgeHours,
): Promise<MigrationBackupEvidence> {
  const value = await readJsonSnapshotFile(path, "MIGRATION_BACKUP_EVIDENCE");
  const invalid = "MIGRATION_BACKUP_EVIDENCE must contain a backup manifest with targetDatabaseIdentity and createdAt";
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(invalid);
  const candidate = value as Record<string, unknown>;
  const targetDatabaseIdentity = candidate.targetDatabaseIdentity;
  const createdAt = candidate.createdAt;
  if (!isDatabaseIdentity(targetDatabaseIdentity) || typeof createdAt !== "string" || !createdAt.trim()) {
    throw new Error(invalid);
  }
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) throw new Error(invalid);
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    throw new Error("MIGRATION_BACKUP_MAX_AGE_HOURS must be a positive number");
  }
  const ageMs = now.getTime() - createdAtMs;
  if (ageMs < 0) throw new Error("MIGRATION_BACKUP_EVIDENCE createdAt must not be in the future");
  if (ageMs > maxAgeHours * 60 * 60 * 1000) {
    throw new Error(`MIGRATION_BACKUP_EVIDENCE is older than ${maxAgeHours} hours`);
  }
  const targetIdentity = normalizePostgresDatabaseIdentity(targetDatabaseUrl);
  if (databaseIdentityKey(targetDatabaseIdentity) !== databaseIdentityKey(targetIdentity)) {
    throw new Error("MIGRATION_BACKUP_EVIDENCE target database identity does not match TARGET_DATABASE_URL");
  }
  return { targetDatabaseIdentity, createdAt };
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
  details: {
    readonly migration?: unknown;
    readonly reconciliation?: DeferredReconciliationResult;
    readonly verification?: VerificationReport;
  } = {},
): MigratorCommandReport {
  const finishedAt = new Date();
  return {
    command,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    ...(details.migration ? { migration: details.migration } : {}),
    ...(details.reconciliation ? { reconciliation: details.reconciliation } : {}),
    ...(details.verification ? { verification: details.verification } : {}),
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

async function assertMigrationApplyGateWithEvidence(
  env: NodeJS.ProcessEnv,
  sourceDatabaseUrl: string,
  runId: string,
  now = new Date(),
): Promise<MigrationApplyApproval> {
  assertMigrationApplyGate(env, sourceDatabaseUrl, now);
  const evidencePath = env.MIGRATION_BACKUP_EVIDENCE?.trim();
  const maxAgeHours = parseBackupMaxAgeHours(env.MIGRATION_BACKUP_MAX_AGE_HOURS);
  const evidence = await readAndValidateMigrationBackupEvidence(
    evidencePath!,
    resolveTargetDatabaseUrl(env),
    now,
    maxAgeHours,
  );
  return createMigrationApplyApproval({
    runId,
    targetDatabaseIdentity: evidence.targetDatabaseIdentity,
    backupEvidenceCreatedAt: evidence.createdAt,
  });
}

function parseBackupMaxAgeHours(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return defaultBackupEvidenceMaxAgeHours;
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error("MIGRATION_BACKUP_MAX_AGE_HOURS must be a positive number");
  }
  return hours;
}

function isDatabaseIdentity(value: unknown): value is SourceDatabaseIdentity {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.host === "string" && candidate.host.trim() !== ""
    && typeof candidate.port === "string" && candidate.port.trim() !== ""
    && typeof candidate.database === "string" && candidate.database.trim() !== "";
}

function databaseIdentityKey(identity: SourceDatabaseIdentity): string {
  return `${identity.host.toLowerCase().replace(/\.$/, "")}:${identity.port}/${identity.database}`;
}

function extractDeferredReconciliation(value: unknown): DeferredReconciliationResult | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const reconciliation = (value as { deferredReconciliation?: unknown }).deferredReconciliation;
  if (reconciliation === null || typeof reconciliation !== "object") return undefined;
  const candidate = reconciliation as Partial<DeferredReconciliationResult>;
  return typeof candidate.examined === "number"
    && typeof candidate.resolved === "number"
    && typeof candidate.pending === "number"
    ? candidate as DeferredReconciliationResult
    : undefined;
}
