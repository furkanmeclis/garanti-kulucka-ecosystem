import { Client, types } from "pg";
import type { ExecutePostgresMigrationInput } from "./commands.js";
import { migrationApplyDisabledMessage } from "./errors.js";
import { normalizePostgresDatabaseIdentity } from "./database-identity.js";
import { LegacyDatabaseSource, type LegacyQueryDatabase, type LegacySourceTableMap } from "./legacy-source.js";
import { runMigration, type MigrationRunResult } from "./orchestrator.js";
import { canonicalMigrationEntities } from "./plan.js";
import {
  withReadonlyRepeatableReadTransaction,
  type PostgresSourceClient,
} from "./source-transaction.js";

const postgresInt8Oid = 20;
let safeIntegerParsersInstalled = false;

export async function executePostgresMigration(
  input: ExecutePostgresMigrationInput,
): Promise<MigrationRunResult> {
  if (input.mode === "apply") {
    throw new Error(migrationApplyDisabledMessage);
  }

  installSafeIntegerTypeParsers();
  const sourceClient = new Client({ connectionString: input.sourceDatabaseUrl });
  return withReadonlyRepeatableReadTransaction(sourceClient, async () => {
    const source = new LegacyDatabaseSource({
      db: postgresLegacyQueryDatabase(sourceClient),
      sourceSystem: input.sourceSystem,
      tables: canonicalSourceTableMap(),
    });

    return runMigration({
      mode: input.mode,
      source,
      batchSize: input.batchSize,
      sourceSystem: input.sourceSystem,
      sourceDatabaseIdentity: normalizePostgresDatabaseIdentity(input.sourceDatabaseUrl),
    });
  });
}

export function installSafeIntegerTypeParsers(): void {
  if (safeIntegerParsersInstalled) return;
  types.setTypeParser(postgresInt8Oid, parseSafePostgresInt8);
  safeIntegerParsersInstalled = true;
}

export function parseSafePostgresInt8(value: string): number {
  if (!/^-?\d+$/.test(value)) {
    throw new TypeError(`Invalid PostgreSQL int8 value: ${value}`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(`PostgreSQL int8 value is outside JavaScript safe integer range: ${value}`);
  }

  return parsed;
}

export function canonicalSourceTableMap(): LegacySourceTableMap {
  return Object.fromEntries(canonicalMigrationEntities.map((entity) => [entity, entity])) as LegacySourceTableMap;
}

function postgresLegacyQueryDatabase(client: PostgresSourceClient): LegacyQueryDatabase {
  return {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      parameters: readonly unknown[] = [],
    ): Promise<{ rows: Row[] }> {
      const result = await client.query(sql, [...parameters]);
      return { rows: result.rows as Row[] };
    },
  };
}
