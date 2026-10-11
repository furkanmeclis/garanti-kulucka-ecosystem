import { createHash } from "node:crypto";
import type {
  BatchReadOptions,
  LegacyRecord,
  LegacySource,
  MigrationEntity,
  ShipmentTrackingEventSourceRowAccounting,
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
  /**
   * Set only when `db` is a single connection inside an open REPEATABLE READ transaction (the runtime source
   * transaction). Every read then sees the same snapshot, which makes two optimisations exact:
   * - plain tables continue a sequential offset scan with keyset (`id > last id`) instead of OFFSET;
   * - the shipment tracking event aggregate is computed once into a SCROLL cursor instead of once per batch.
   * The cursor lives in the transaction and needs no write access, so the source stays read-only.
   */
  readonly repeatableReadSnapshot?: boolean;
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
  private readonly repeatableReadSnapshot: boolean;
  private readonly keysetContinuations = new Map<MigrationEntity, KeysetContinuation>();
  private trackingEventCursor: Promise<TrackingEventCursorState> | undefined;

  constructor(input: CreateLegacyDatabaseSourceInput) {
    this.db = input.db;
    this.repeatableReadSnapshot = input.repeatableReadSnapshot === true;
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
    if (entity === "shipment_tracking_events" && this.repeatableReadSnapshot) {
      return (await this.openTrackingEventCursor(table)).eventRows;
    }
    const result = await this.db.query<{ count: string | number | bigint }>(
      entity === "shipment_tracking_events"
        ? shipmentTrackingEventAggregateCountSql(table)
        : `select count(*) as count from ${quoteQualifiedIdentifier(table.tableName)}`,
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
    if (entity === "shipment_tracking_events") {
      if (options.afterSourceId !== undefined) {
        throw new Error("Shipment tracking event aggregate reads are offset based");
      }
      if (this.repeatableReadSnapshot) {
        const cursor = await this.openTrackingEventCursor(table);
        await this.db.query(`move absolute ${options.offset ?? 0} in ${cursor.name}`);
        const result = await this.db.query(`fetch forward ${options.limit} from ${cursor.name}`);
        return result.rows.map((row) => this.toLegacyRecord(table, withoutCursorAccountingColumns(row)));
      }
      const result = await this.db.query(
        shipmentTrackingEventAggregateReadSql(table),
        [options.limit, options.offset ?? 0],
      );
      return result.rows.map((row) => this.toLegacyRecord(table, row));
    }

    const tableName = quoteQualifiedIdentifier(table.tableName);
    const idColumn = quoteIdentifier(table.idColumn);
    const offset = options.offset ?? 0;
    // A sequential offset scan continues from the previous batch's last id: the same rows as OFFSET in a stable
    // snapshot, but an index range scan instead of re-reading every earlier row. Any other offset (first batch
    // after a resume, re-reads, out-of-order reads) falls back to OFFSET.
    const continuation = options.afterSourceId === undefined && offset > 0 && this.repeatableReadSnapshot
      ? this.keysetContinuations.get(entity)
      : undefined;
    const keysetAfter = options.afterSourceId !== undefined
      ? options.afterSourceId
      : continuation !== undefined && continuation.nextOffset === offset
        ? continuation.lastId
        : undefined;
    const parameters: unknown[] = [options.limit];
    let predicate = "";
    let offsetClause = "";
    if (keysetAfter !== undefined) {
      predicate = ` where ${idColumn} > $2`;
      parameters.push(keysetAfter);
    } else if (offset > 0) {
      offsetClause = " offset $2";
      parameters.push(offset);
    }

    const result = await this.db.query(
      `select * from ${tableName}${predicate} order by ${idColumn} asc limit $1${offsetClause}`,
      parameters,
    );

    if (this.repeatableReadSnapshot && options.afterSourceId === undefined) {
      this.rememberKeysetContinuation(entity, table, offset, result.rows);
    }

    return result.rows.map((row) => this.toLegacyRecord(table, row));
  }

  async describeShipmentTrackingEventSourceRows(): Promise<ShipmentTrackingEventSourceRowAccounting> {
    const table = this.resolveTable("shipment_tracking_events");
    if (this.repeatableReadSnapshot) {
      const cursor = await this.openTrackingEventCursor(table);
      if (cursor.accounting !== null) return cursor.accounting;
    }
    const result = await this.db.query(shipmentTrackingEventAccountingSql(table));
    const row = result.rows[0];
    if (!row) throw new Error("Legacy source returned no shipment tracking event row accounting");
    return parseTrackingEventAccounting(row, "");
  }

  private rememberKeysetContinuation(
    entity: MigrationEntity,
    table: ResolvedLegacyTable,
    offset: number,
    rows: readonly Record<string, unknown>[],
  ): void {
    const lastId = rows.length > 0 ? rows[rows.length - 1]?.[table.idColumn] : undefined;
    if (typeof lastId === "string" || typeof lastId === "number" || typeof lastId === "bigint") {
      this.keysetContinuations.set(entity, { nextOffset: offset + rows.length, lastId });
    } else {
      this.keysetContinuations.delete(entity);
    }
  }

  private openTrackingEventCursor(table: ResolvedLegacyTable): Promise<TrackingEventCursorState> {
    this.trackingEventCursor ??= this.declareTrackingEventCursor(table);
    return this.trackingEventCursor;
  }

  private async declareTrackingEventCursor(table: ResolvedLegacyTable): Promise<TrackingEventCursorState> {
    const name = trackingEventCursorName;
    // SCROLL keeps the sorted aggregate in the cursor's tuplestore, so count, every batch and re-reads
    // (apply checksum pass, then apply) are served from one aggregation over the raw table.
    await this.db.query(`declare ${name} scroll cursor without hold for ${shipmentTrackingEventCursorSql(table)}`);
    const first = await this.db.query(`fetch absolute 1 from ${name}`);
    const row = first.rows[0];
    if (!row) return { name, eventRows: 0, accounting: null };
    const eventRows = parseNonNegativeInteger(row[cursorAccountingColumns.eventRows], "tracking event aggregate rows");
    return { name, eventRows, accounting: parseTrackingEventAccounting(row, cursorAccountingPrefix) };
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

interface KeysetContinuation {
  readonly nextOffset: number;
  readonly lastId: string | number | bigint;
}

interface TrackingEventCursorState {
  readonly name: string;
  readonly eventRows: number;
  readonly accounting: ShipmentTrackingEventSourceRowAccounting | null;
}

const trackingEventCursorName = "migrator_shipment_tracking_events";
const cursorAccountingPrefix = "__migrator_";
const cursorAccountingColumns = {
  eventRows: `${cursorAccountingPrefix}event_rows`,
  sourceRows: `${cursorAccountingPrefix}source_rows`,
  supersededInsertTimeRows: `${cursorAccountingPrefix}superseded_insert_time_rows`,
  undatedRows: `${cursorAccountingPrefix}undated_rows`,
} as const;

function withoutCursorAccountingColumns(row: Record<string, unknown>): Record<string, unknown> {
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!key.startsWith(cursorAccountingPrefix)) stripped[key] = value;
  }
  return stripped;
}

function parseTrackingEventAccounting(
  row: Record<string, unknown>,
  prefix: string,
): ShipmentTrackingEventSourceRowAccounting {
  return {
    sourceRows: parseNonNegativeInteger(row[`${prefix}source_rows`], "tracking source rows"),
    supersededInsertTimeRows: parseNonNegativeInteger(
      row[`${prefix}superseded_insert_time_rows`],
      "tracking superseded insert-time rows",
    ),
    undatedRows: parseNonNegativeInteger(row[`${prefix}undated_rows`], "tracking undated rows"),
  };
}

function parseNonNegativeInteger(value: unknown, label: string): number {
  const text = typeof value === "number" || typeof value === "bigint" ? String(value) : value;
  if (typeof text !== "string" || !/^\d+$/.test(text)) {
    throw new Error(`Legacy source returned invalid ${label}`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Legacy source returned invalid ${label}`);
  return parsed;
}

function shipmentTrackingEventAggregateCountSql(table: ResolvedLegacyTable): string {
  return `select count(*) as count from (${shipmentTrackingEventAggregateSql(table)}) shipment_tracking_event_groups`;
}

function shipmentTrackingEventAggregateReadSql(table: ResolvedLegacyTable): string {
  return `${shipmentTrackingEventAggregateSql(table)} order by id asc limit $1 offset $2`;
}

function shipmentTrackingEventAggregateSql(table: ResolvedLegacyTable): string {
  return `${shipmentTrackingEventCtes(table)}
${shipmentTrackingEventSelect}`;
}

/**
 * The same aggregate rows in the order the OFFSET reader uses, plus per-run accounting columns (stripped before
 * payloads are built) so one aggregation also answers the plan count and the raw-row accounting.
 */
function shipmentTrackingEventCursorSql(table: ResolvedLegacyTable): string {
  return `${shipmentTrackingEventCtes(table)},
events as (
${shipmentTrackingEventSelect}
),
accounting as (
${shipmentTrackingEventAccountingSelect}
)
select
  events.*,
  count(*) over () as ${cursorAccountingColumns.eventRows},
  accounting.source_rows as ${cursorAccountingColumns.sourceRows},
  accounting.superseded_insert_time_rows as ${cursorAccountingColumns.supersededInsertTimeRows},
  accounting.undated_rows as ${cursorAccountingColumns.undatedRows}
from events
cross join accounting
order by events.id asc`;
}

function shipmentTrackingEventAccountingSql(table: ResolvedLegacyTable): string {
  return `${shipmentTrackingEventCtes(table)}
${shipmentTrackingEventAccountingSelect}`;
}

// Every raw row is in exactly one bucket: an event's raw_row_count (provider second, first_seen group, future
// row), an insert-time copy of a group that also has a provider-time row (superseded), or undated (null tarih).
const shipmentTrackingEventAccountingSelect = `select
  (select count(*) from source_rows) as source_rows,
  (select coalesce(sum(insert_time_row_count), 0) from group_rollup where has_real_provider_time)
    as superseded_insert_time_rows,
  (select count(*) from source_rows where tarih is null) as undated_rows`;

const shipmentTrackingEventSelect = `select *
from provider_events
union all
select *
from first_seen_events
union all
select *
from future_rows`;

function shipmentTrackingEventCtes(table: ResolvedLegacyTable): string {
  const tableName = quoteQualifiedIdentifier(table.tableName);
  return `
with source_rows as (
  select
    id,
    kargo_id,
    durum,
    aciklama,
    lokasyon,
    tarih,
    date_trunc('second', tarih) = tarih as is_real_provider_time,
    tarih > now() + interval '5 minutes' as is_future
  from ${tableName}
),
valid_rows as (
  select *
  from source_rows
  where not is_future
),
provider_events as (
  select
    'provider:' || coalesce(kargo_id::text, 'no-shipment') || ':' || md5(
      concat_ws(chr(31), coalesce(kargo_id::text, ''), durum, coalesce(lokasyon, ''), coalesce(aciklama, ''), date_trunc('second', tarih)::text)
    ) as id,
    min(id::text) as representative_source_id,
    kargo_id,
    durum,
    aciklama,
    lokasyon,
    date_trunc('second', tarih) as event_time,
    'provider'::text as time_source,
    count(*)::int as raw_row_count,
    false as is_future
  from valid_rows
  where is_real_provider_time
  group by kargo_id, durum, lokasyon, aciklama, date_trunc('second', tarih)
),
group_rollup as (
  select
    kargo_id,
    durum,
    aciklama,
    lokasyon,
    min(tarih) as first_seen_at,
    min(id::text) as representative_source_id,
    count(*)::int as raw_row_count,
    count(*) filter (where not is_real_provider_time) as insert_time_row_count,
    bool_or(is_real_provider_time) as has_real_provider_time
  from valid_rows
  group by kargo_id, durum, lokasyon, aciklama
),
first_seen_events as (
  select
    'first_seen:' || coalesce(kargo_id::text, 'no-shipment') || ':' || md5(
      concat_ws(chr(31), coalesce(kargo_id::text, ''), durum, coalesce(lokasyon, ''), coalesce(aciklama, ''))
    ) as id,
    representative_source_id,
    kargo_id,
    durum,
    aciklama,
    lokasyon,
    first_seen_at as event_time,
    'first_seen'::text as time_source,
    raw_row_count,
    false as is_future
  from group_rollup
  where not has_real_provider_time
),
future_rows as (
  select
    'future:' || id::text as id,
    id::text as representative_source_id,
    kargo_id,
    durum,
    aciklama,
    lokasyon,
    tarih as event_time,
    'future_excluded'::text as time_source,
    1::int as raw_row_count,
    true as is_future
  from source_rows
  where is_future
)`;
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
