import { createHash } from "node:crypto";
import type {
  BatchReadOptions,
  LegacyRecord,
  LegacySource,
  MigrationEntity,
  SourceColumnSnapshot,
  SourceTableSnapshot,
} from "./types.js";

declare const sourcePayloadChecksumBrand: unique symbol;
export type SourcePayloadChecksum = `sha256:${string}` & {
  readonly [sourcePayloadChecksumBrand]: true;
};
import {
  validateLegacyTableColumns,
  validateLegacyMappingCatalog,
  type LegacyMappingCatalog,
  type LegacyTableMapping,
} from "./mapping-catalog.js";

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
  readonly mappingCatalog?: LegacyMappingCatalog;
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
  private readonly mappingsByTable: ReadonlyMap<string, LegacyTableMapping>;

  constructor(input: CreateLegacyDatabaseSourceInput) {
    this.db = input.db;
    this.sourceSystem = input.sourceSystem;
    this.tables = resolveTableMap(input.tables, input.defaultIdColumn ?? defaultSourceIdColumn);
    if (input.mappingCatalog) {
      validateLegacyMappingCatalog(input.mappingCatalog);
      validateCatalogRouting(this.tables, input.mappingCatalog);
    }
    this.mappingsByTable = new Map(
      (input.mappingCatalog?.tables ?? []).map((mapping) => [normalizeTableName(mapping.sourceTable), mapping]),
    );
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

  async describeTables(entities: readonly MigrationEntity[]): Promise<SourceTableSnapshot[]> {
    const columnsByTable = new Map<string, SourceColumnSnapshot[]>();
    for (const entity of entities) {
      const table = this.resolveTable(entity);
      const identity = splitTableIdentity(table.tableName);
      const physicalTableName = `${identity.schema}.${identity.table}`;
      if (columnsByTable.has(physicalTableName)) continue;
      const result = await this.db.query<{
        column_name: string;
        ordinal_position: number | string;
        data_type: string;
        udt_name: string;
        is_nullable: string;
      }>(
        `select column_name, ordinal_position, data_type, udt_name, is_nullable
         from information_schema.columns
         where table_schema = $1 and table_name = $2
         order by ordinal_position asc`,
        [identity.schema, identity.table],
      );
      if (result.rows.length === 0) {
        throw new Error(`Legacy source table introspection returned no columns for ${physicalTableName}`);
      }
      const columns: SourceColumnSnapshot[] = result.rows.map((column) => {
        const ordinalPosition = Number(column.ordinal_position);
        if (!Number.isSafeInteger(ordinalPosition) || ordinalPosition < 1) {
          throw new Error(`Legacy source returned invalid column ordinal for ${physicalTableName}.${column.column_name}`);
        }
        if (column.is_nullable !== "YES" && column.is_nullable !== "NO") {
          throw new Error(
            `Legacy source returned invalid nullability for ${physicalTableName}.${column.column_name}`,
          );
        }
        return {
          name: column.column_name,
          ordinalPosition,
          dataType: column.data_type,
          udtName: column.udt_name,
          nullable: column.is_nullable === "YES",
        };
      });
      const mapping = this.mappingsByTable.get(physicalTableName);
      if (mapping) validateLegacyTableColumns(physicalTableName, columns, mapping);
      columnsByTable.set(physicalTableName, columns);
    }

    return entities.map((entity) => {
      const table = this.resolveTable(entity);
      const identity = splitTableIdentity(table.tableName);
      const physicalTableName = `${identity.schema}.${identity.table}`;
      const columns = columnsByTable.get(physicalTableName);
      if (!columns) {
        throw new Error(`Legacy source table introspection missing snapshot for ${physicalTableName}`);
      }
      if (!columns.some((column) => column.name === table.idColumn)) {
        throw new Error(`Legacy source table ${physicalTableName} is missing configured id column ${table.idColumn}`);
      }
      return {
        entity,
        schema: identity.schema,
        table: identity.table,
        idColumn: table.idColumn,
        columns,
      };
    });
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
      checksum: calculateSourcePayloadChecksum(payload),
    };
  }
}

function validateCatalogRouting(
  tables: Partial<Record<MigrationEntity, ResolvedLegacyTable>>,
  catalog: LegacyMappingCatalog,
): void {
  const expected = new Map<MigrationEntity, ResolvedLegacyTable>();
  for (const mapping of catalog.tables) {
    for (const target of mapping.targetEntities) {
      if (target.readiness !== "dry-run") continue;
      expected.set(target.entity, {
        tableName: normalizeTableName(mapping.sourceTable),
        idColumn: mapping.idColumn,
      });
    }
  }

  const configuredEntities = Object.keys(tables) as MigrationEntity[];
  for (const entity of configuredEntities) {
    if (!expected.has(entity)) {
      throw new Error(`Legacy source table routing contains catalog-unready target ${entity}`);
    }
  }
  for (const [entity, route] of expected) {
    const configured = tables[entity];
    if (!configured) {
      throw new Error(`Legacy source table routing is missing dry-run-ready target ${entity}`);
    }
    if (normalizeTableName(configured.tableName) !== route.tableName || configured.idColumn !== route.idColumn) {
      throw new Error(
        `Legacy source table routing for ${entity} must be ${route.tableName}.${route.idColumn}`,
      );
    }
  }
}

function normalizeTableName(tableName: string): string {
  const identity = splitTableIdentity(tableName);
  return `${identity.schema}.${identity.table}`;
}

function splitTableIdentity(tableName: string): { schema: string; table: string } {
  const parts = tableName.split(".");
  if (parts.length === 1) return { schema: "public", table: parts[0] as string };
  if (parts.length === 2) return { schema: parts[0] as string, table: parts[1] as string };
  throw new Error(`Legacy source table must be unqualified or schema-qualified: ${tableName}`);
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

const invalidChecksumPayloadMessage = "Source payload checksum requires strict JSON-like data";

type CanonicalPayloadValue = null | string | boolean | number | CanonicalPayloadValue[] | CanonicalPayloadRecord;
interface CanonicalPayloadRecord {
  [key: string]: CanonicalPayloadValue;
}

function normalizePayload(row: Record<string, unknown>): CanonicalPayloadRecord {
  return normalizePayloadRecord(row, new WeakSet<object>());
}

function normalizePayloadRecord(value: object, seen: WeakSet<object>): CanonicalPayloadRecord {
  const prototype = safeReflect(() => Object.getPrototypeOf(value));
  if (prototype !== Object.prototype && prototype !== null) rejectChecksumPayload();
  enterChecksumObject(value, seen);

  const symbols = safeReflect(() => Object.getOwnPropertySymbols(value));
  if (symbols.length > 0) rejectChecksumPayload();
  const descriptors = safeReflect(() => Object.getOwnPropertyDescriptors(value)) as Record<string, PropertyDescriptor>;
  const normalized = Object.create(null) as CanonicalPayloadRecord;
  for (const key of Object.keys(descriptors).sort(comparePayloadKeys)) {
    const descriptor = descriptors[key]!;
    if (!("value" in descriptor) || !descriptor.enumerable) rejectChecksumPayload();
    Object.defineProperty(normalized, key, {
      value: normalizePayloadValue(descriptor.value, seen),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return normalized;
}

function normalizePayloadValue(value: unknown, seen: WeakSet<object>): CanonicalPayloadValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) rejectChecksumPayload();
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") rejectChecksumPayload();

  const prototype = safeReflect(() => Object.getPrototypeOf(value));
  if (prototype === Date.prototype) return normalizePayloadDate(value, seen);
  if (Array.isArray(value)) return normalizePayloadArray(value, seen);
  return normalizePayloadRecord(value, seen);
}

function normalizePayloadDate(value: object, seen: WeakSet<object>): string {
  enterChecksumObject(value, seen);
  if (safeReflect(() => Reflect.ownKeys(value)).length > 0) rejectChecksumPayload();
  const timestamp = safeReflect(() => Date.prototype.getTime.call(value));
  if (!Number.isFinite(timestamp)) rejectChecksumPayload();
  return safeReflect(() => Date.prototype.toISOString.call(value));
}

function normalizePayloadArray(value: unknown[], seen: WeakSet<object>): CanonicalPayloadValue[] {
  if (safeReflect(() => Object.getPrototypeOf(value)) !== Array.prototype) rejectChecksumPayload();
  enterChecksumObject(value, seen);
  if (safeReflect(() => Object.getOwnPropertySymbols(value)).length > 0) rejectChecksumPayload();

  const descriptors = safeReflect(() => Object.getOwnPropertyDescriptors(value)) as Record<string, PropertyDescriptor>;
  const lengthDescriptor = descriptors.length;
  if (lengthDescriptor === undefined || lengthDescriptor.value !== value.length) {
    rejectChecksumPayload();
  }
  const allowedKeys = new Set(["length", ...Array.from({ length: value.length }, (_, index) => String(index))]);
  if (Object.keys(descriptors).some((key) => !allowedKeys.has(key))) rejectChecksumPayload();

  const normalized: CanonicalPayloadValue[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) rejectChecksumPayload();
    normalized.push(normalizePayloadValue(descriptor.value, seen));
  }
  return normalized;
}

function enterChecksumObject(value: object, seen: WeakSet<object>): void {
  if (seen.has(value)) rejectChecksumPayload();
  seen.add(value);
}

function serializeCanonicalPayload(value: CanonicalPayloadValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return `[${value.map(serializeCanonicalPayload).join(",")}]`;
  return `{${Object.keys(value)
    .map((key) => `${JSON.stringify(key)}:${serializeCanonicalPayload(value[key]!)}`)
    .join(",")}}`;
}

function safeReflect<T>(operation: () => T): T {
  try {
    return operation();
  } catch {
    rejectChecksumPayload();
  }
}

function rejectChecksumPayload(): never {
  throw new TypeError(invalidChecksumPayloadMessage);
}

function comparePayloadKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function calculateSourcePayloadChecksum(payload: Record<string, unknown>): SourcePayloadChecksum {
  const canonical = normalizePayload(payload);
  return `sha256:${createHash("sha256").update(serializeCanonicalPayload(canonical)).digest("hex")}` as
    SourcePayloadChecksum;
}
