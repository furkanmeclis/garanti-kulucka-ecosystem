import { createHash } from "node:crypto";
import type { BatchReadOptions, LegacyRecord, LegacySource, MigrationEntity } from "./types.js";

export interface LegacyQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: Row[];
}

export interface LegacyQueryDatabase {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<LegacyQueryResult<Row>>;
}

export interface LegacySourceTableConfig {
  readonly tableName: string;
  readonly idColumn?: string;
}

export type LegacySourceTableMap = Partial<Record<MigrationEntity, string | LegacySourceTableConfig>>;

export interface CreateLegacyDatabaseSourceInput {
  readonly db: LegacyQueryDatabase;
  readonly sourceSystem: string;
  readonly tables: LegacySourceTableMap;
  readonly defaultIdColumn?: string;
}

interface ResolvedLegacyTable {
  readonly tableName: string;
  readonly idColumn: string;
}

const defaultSourceIdColumn = "id";

export class LegacyDatabaseSource implements LegacySource {
  private readonly tables: Partial<Record<MigrationEntity, ResolvedLegacyTable>>;
  private readonly sourceSystem: string;
  private readonly db: LegacyQueryDatabase;

  constructor(input: CreateLegacyDatabaseSourceInput) {
    this.db = input.db;
    this.sourceSystem = input.sourceSystem;
    this.tables = resolveTableMap(input.tables, input.defaultIdColumn ?? defaultSourceIdColumn);
  }

  async count(entity: MigrationEntity): Promise<number> {
    const table = this.resolveTable(entity);
    const result = await this.db.query<{ count: string | number | bigint }>(
      `select count(*) as count from ${quoteQualifiedIdentifier(table.tableName)}`,
    );
    const count = result.rows[0]?.count;
    const parsed = typeof count === "bigint" ? Number(count) : Number.parseInt(String(count ?? ""), 10);

    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new Error(`Legacy source returned invalid count for ${entity}`);
    }

    return parsed;
  }

  async readBatch(entity: MigrationEntity, options: BatchReadOptions): Promise<LegacyRecord[]> {
    if (!Number.isInteger(options.limit) || options.limit < 1) {
      throw new Error("limit must be a positive integer");
    }
    if (options.offset !== undefined && (!Number.isInteger(options.offset) || options.offset < 0)) {
      throw new Error("offset must be a non-negative integer");
    }
    if (options.offset !== undefined && options.afterSourceId !== undefined) {
      throw new Error("offset and afterSourceId cannot be combined");
    }

    const table = this.resolveTable(entity);
    const tableName = quoteQualifiedIdentifier(table.tableName);
    const idColumn = quoteIdentifier(table.idColumn);
    const parameters: unknown[] = [options.limit];
    const cursorPredicate = options.afterSourceId ? ` where ${idColumn}::text > $2` : "";
    const offsetClause = options.offset !== undefined && options.offset > 0 ? " offset $2" : "";

    if (options.afterSourceId) {
      parameters.push(options.afterSourceId);
    } else if (options.offset !== undefined && options.offset > 0) {
      parameters.push(options.offset);
    }

    const result = await this.db.query(
      `select * from ${tableName}${cursorPredicate} order by ${idColumn} asc limit $1${offsetClause}`,
      parameters,
    );

    return result.rows.map((row) => this.toLegacyRecord(table, row));
  }

  private resolveTable(entity: MigrationEntity): ResolvedLegacyTable {
    const table = this.tables[entity];
    if (!table) {
      throw new Error(`No legacy source table configured for ${entity}`);
    }

    return table;
  }

  private toLegacyRecord(table: ResolvedLegacyTable, row: Record<string, unknown>): LegacyRecord {
    const rawSourceId = row[table.idColumn];
    if (rawSourceId === null || rawSourceId === undefined) {
      throw new Error(`Legacy row from ${table.tableName} is missing source id column ${table.idColumn}`);
    }

    const payload = normalizePayload(row);

    return {
      sourceSystem: this.sourceSystem,
      sourceTable: table.tableName,
      sourceId: String(rawSourceId),
      payload,
      checksum: checksumPayload(payload),
    };
  }
}

export function resolveTableMap(
  tables: LegacySourceTableMap,
  defaultIdColumn = defaultSourceIdColumn,
): Partial<Record<MigrationEntity, ResolvedLegacyTable>> {
  const resolved: Partial<Record<MigrationEntity, ResolvedLegacyTable>> = {};

  for (const [entity, config] of Object.entries(tables) as [MigrationEntity, string | LegacySourceTableConfig][]) {
    const tableName = typeof config === "string" ? config : config.tableName;
    const idColumn = typeof config === "string" ? defaultIdColumn : (config.idColumn ?? defaultIdColumn);
    assertIdentifierPath(tableName);
    assertIdentifierPath(idColumn);
    resolved[entity] = { tableName, idColumn };
  }

  return resolved;
}

function quoteQualifiedIdentifier(identifier: string): string {
  assertIdentifierPath(identifier);
  return identifier.split(".").map(quoteIdentifier).join(".");
}

function quoteIdentifier(identifier: string): string {
  assertIdentifierPath(identifier);
  return `"${identifier.replaceAll('"', '""')}"`;
}

function assertIdentifierPath(identifier: string): void {
  const valid = identifier
    .split(".")
    .every((part) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(part));

  if (!valid) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
}

function normalizePayload(row: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(row)
    .sort()
    .reduce<Record<string, unknown>>((payload, key) => {
      payload[key] = normalizeValue(row[key]);
      return payload;
    }, {});
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object") return normalizePayload(value as Record<string, unknown>);
  return value;
}

function checksumPayload(payload: Record<string, unknown>): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
}
