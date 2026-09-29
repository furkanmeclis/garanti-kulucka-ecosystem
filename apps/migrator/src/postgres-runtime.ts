import { Client, TypeOverrides } from "pg";
import type { ExecutePostgresMigrationInput } from "./commands.js";
import { migrationApplyDisabledMessage } from "./errors.js";
import { normalizePostgresDatabaseIdentity } from "./database-identity.js";
import { LegacyDatabaseSource, type LegacyQueryDatabase, type LegacySourceTableMap } from "./legacy-source.js";
import {
  dryRunMigrationEntities,
  legacyMappingCatalog,
  validateLegacyMappingCatalog,
  type LegacyMappingCatalog,
} from "./mapping-catalog.js";
import { runMigration, type MigrationRunResult } from "./orchestrator.js";
import {
  withReadonlyRepeatableReadTransaction,
  type PostgresSourceClient,
} from "./source-transaction.js";

const postgresInt8Oid = 20;
const postgresTimestampOid = 1114;
const postgresTimestampWithTimezoneOid = 1184;

export async function executePostgresMigration(
  input: ExecutePostgresMigrationInput,
): Promise<MigrationRunResult> {
  if (input.mode === "apply") {
    throw new Error(migrationApplyDisabledMessage);
  }

  const sourceClient = new Client({
    connectionString: input.sourceDatabaseUrl,
    types: createLegacyPostgresTypeOverrides(),
  });
  return withReadonlyRepeatableReadTransaction(sourceClient, async () => {
    const source = new LegacyDatabaseSource({
      db: postgresLegacyQueryDatabase(sourceClient),
      sourceSystem: input.sourceSystem,
      tables: canonicalSourceTableMap(legacyMappingCatalog),
      mappingCatalog: legacyMappingCatalog,
    });

    return runMigration({
      mode: input.mode,
      source,
      mappingCatalog: legacyMappingCatalog,
      batchSize: input.batchSize,
      sourceSystem: input.sourceSystem,
      sourceDatabaseIdentity: normalizePostgresDatabaseIdentity(input.sourceDatabaseUrl),
      entities: dryRunMigrationEntities(legacyMappingCatalog),
    });
  });
}

export function createLegacyPostgresTypeOverrides(): TypeOverrides {
  const overrides = new TypeOverrides();
  overrides.setTypeParser(postgresInt8Oid, parseSafePostgresInt8);
  overrides.setTypeParser(postgresTimestampOid, preservePostgresTimestampText);
  overrides.setTypeParser(postgresTimestampWithTimezoneOid, preservePostgresTimestampText);
  return overrides;
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

export function preservePostgresTimestampText(value: string): string {
  return value;
}

export function canonicalSourceTableMap(catalog: LegacyMappingCatalog): LegacySourceTableMap {
  validateLegacyMappingCatalog(catalog);
  const tables: LegacySourceTableMap = {};
  for (const mapping of catalog.tables) {
    for (const target of mapping.targetEntities) {
      if (target.readiness !== "dry-run") continue;
      tables[target.entity] = { tableName: mapping.sourceTable, idColumn: mapping.idColumn };
    }
  }
  return tables;
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
