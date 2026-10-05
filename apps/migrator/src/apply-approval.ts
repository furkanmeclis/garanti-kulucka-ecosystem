import { normalizePostgresDatabaseIdentity } from "./database-identity.js";
import { migrationApplyDisabledMessage } from "./errors.js";
import type { SourceDatabaseIdentity } from "./types.js";

const migrationApplyApprovalBrand: unique symbol = Symbol("migrationApplyApproval");

export interface MigrationApplyApproval {
  readonly [migrationApplyApprovalBrand]: true;
  readonly runId: string;
  readonly targetDatabaseIdentity: SourceDatabaseIdentity;
  readonly backupEvidenceCreatedAt: string;
}

export function createMigrationApplyApproval(input: {
  readonly runId: string;
  readonly targetDatabaseIdentity: SourceDatabaseIdentity;
  readonly backupEvidenceCreatedAt: string;
}): MigrationApplyApproval {
  return Object.freeze({
    [migrationApplyApprovalBrand]: true as const,
    runId: input.runId,
    targetDatabaseIdentity: normalizeDatabaseIdentity(input.targetDatabaseIdentity),
    backupEvidenceCreatedAt: input.backupEvidenceCreatedAt,
  });
}

export function assertMigrationApplyApproval(
  approval: MigrationApplyApproval | undefined,
  expected: {
    readonly runId: string;
    readonly targetDatabaseUrl?: string;
  },
): asserts approval is MigrationApplyApproval {
  if (!approval || approval[migrationApplyApprovalBrand] !== true) {
    throw new Error(migrationApplyDisabledMessage);
  }
  if (approval.runId !== expected.runId) {
    throw new Error("Migration apply approval does not match MIGRATION_RUN_ID");
  }
  if (expected.targetDatabaseUrl) {
    const targetIdentity = normalizePostgresDatabaseIdentity(expected.targetDatabaseUrl);
    if (databaseIdentityKey(approval.targetDatabaseIdentity) !== databaseIdentityKey(targetIdentity)) {
      throw new Error("Migration apply approval target database identity does not match TARGET_DATABASE_URL");
    }
  }
  if (!Number.isFinite(Date.parse(approval.backupEvidenceCreatedAt))) {
    throw new Error("Migration apply approval backup evidence timestamp is invalid");
  }
}

function normalizeDatabaseIdentity(identity: SourceDatabaseIdentity): SourceDatabaseIdentity {
  return {
    host: identity.host.toLowerCase().replace(/\.$/, ""),
    port: identity.port,
    database: identity.database,
  };
}

function databaseIdentityKey(identity: SourceDatabaseIdentity): string {
  return `${identity.host.toLowerCase().replace(/\.$/, "")}:${identity.port}/${identity.database}`;
}
