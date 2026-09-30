import { canonicalMigrationEntities } from "./plan.js";
import type { MigrationEntity, SourceColumnSnapshot, SourceTableSnapshot } from "./types.js";

export interface LegacyColumnContract {
  readonly name: string;
  readonly dataType: string;
  readonly udtName: string;
  readonly nullable: boolean;
  readonly required: boolean;
}

export interface LegacyTableMapping {
  readonly sourceTable: string;
  readonly idColumn: string;
  readonly targetEntities: readonly {
    readonly entity: MigrationEntity;
    readonly mapping: "direct" | "synthetic";
    readonly readiness: "dry-run" | "descriptive";
  }[];
  readonly columns: readonly LegacyColumnContract[];
}

export interface LegacyMappingCatalog {
  readonly version: string;
  readonly tables: readonly LegacyTableMapping[];
}

export const mappingCatalogVersion = "p2-customer-catalog-v1";

const canonicalMigrationEntitySet = new Set<string>(canonicalMigrationEntities);
const targetMappingValues = new Set<string>(["direct", "synthetic"]);
const targetReadinessValues = new Set<string>(["dry-run", "descriptive"]);
const applyPrerequisites: Partial<Record<MigrationEntity, readonly MigrationEntity[]>> = {
  // Customer drafts clear social placeholder phones; only the external identity target carries those ids.
  customers: ["customer_external_identities"],
};

export const legacyMappingCatalog = createLegacyMappingCatalog({
  version: mappingCatalogVersion,
  tables: [
    {
      sourceTable: "public.musteriler",
      idColumn: "id",
      targetEntities: [
        { entity: "customers", mapping: "direct", readiness: "dry-run" },
        { entity: "customer_addresses", mapping: "synthetic", readiness: "descriptive" },
        { entity: "customer_external_identities", mapping: "synthetic", readiness: "descriptive" },
      ],
      columns: [
        column("id", "uuid", "uuid", false),
        column("ad", "character varying", "varchar", false),
        column("soyad", "character varying", "varchar", true),
        column("email", "character varying", "varchar", true),
        column("telefon", "character varying", "varchar", false),
        column("adres", "text", "text", true),
        column("il", "character varying", "varchar", true),
        column("ilce", "character varying", "varchar", true),
        column("posta_kodu", "character varying", "varchar", true),
        column("notlar", "text", "text", true),
        column("woocommerce_id", "integer", "int4", true),
        column("kolaybi_id", "character varying", "varchar", true),
        column("olusturma_tarihi", "timestamp with time zone", "timestamptz", true),
        column("guncelleme_tarihi", "timestamp with time zone", "timestamptz", true),
        column("username", "text", "text", true),
      ],
    },
  ],
});

export function createLegacyMappingCatalog(catalog: LegacyMappingCatalog): LegacyMappingCatalog {
  validateLegacyMappingCatalog(catalog);
  return Object.freeze({
    version: catalog.version,
    tables: Object.freeze(catalog.tables.map((table) => Object.freeze({
      sourceTable: table.sourceTable,
      idColumn: table.idColumn,
      targetEntities: Object.freeze(table.targetEntities.map((target) => Object.freeze({ ...target }))),
      columns: Object.freeze(table.columns.map((contract) => Object.freeze({ ...contract }))),
    }))),
  });
}

export function validateLegacyMappingCatalog(catalog: LegacyMappingCatalog): void {
  assertNonblank("catalog version", catalog.version);
  if (catalog.tables.length === 0) {
    throw new Error("Legacy mapping catalog must declare at least one target");
  }

  const sourceTables = new Set<string>();
  const targetEntities = new Set<MigrationEntity>();
  let dryRunTargetCount = 0;
  for (const table of catalog.tables) {
    assertSafeQualifiedIdentifier("source table", table.sourceTable);
    assertSafeIdentifier(`id column for ${table.sourceTable}`, table.idColumn);
    const normalizedTable = normalizeSourceTable(table.sourceTable);
    if (sourceTables.has(normalizedTable)) {
      throw new Error(`Legacy mapping catalog contains duplicate source table ${normalizedTable}`);
    }
    sourceTables.add(normalizedTable);

    if (table.targetEntities.length === 0) {
      throw new Error(`Legacy mapping catalog source table ${normalizedTable} must declare at least one target`);
    }
    for (const target of table.targetEntities) {
      if (!canonicalMigrationEntitySet.has(target.entity)) {
        throw new Error("Legacy mapping catalog target entity is invalid");
      }
      if (!targetMappingValues.has(target.mapping)) {
        throw new Error(`Legacy mapping catalog target ${target.entity} mapping is invalid`);
      }
      if (!targetReadinessValues.has(target.readiness)) {
        throw new Error(`Legacy mapping catalog target ${target.entity} readiness is invalid`);
      }
      if (targetEntities.has(target.entity)) {
        throw new Error(`Legacy mapping catalog contains duplicate target entity ${target.entity}`);
      }
      targetEntities.add(target.entity);
      if (target.readiness === "dry-run") dryRunTargetCount += 1;
      if (target.mapping === "synthetic" && target.readiness === "dry-run") {
        throw new Error(`Legacy mapping catalog synthetic target ${target.entity} cannot be dry-run-ready`);
      }
      if (target.mapping === "direct" && target.readiness === "descriptive") {
        throw new Error(`Legacy mapping catalog direct target ${target.entity} cannot be descriptive`);
      }
    }

    const columnNames = new Set<string>();
    for (const contract of table.columns) {
      assertSafeIdentifier(`column name for ${normalizedTable}`, contract.name);
      assertNonblank(`data type for ${normalizedTable}.${contract.name}`, contract.dataType);
      assertNonblank(`UDT name for ${normalizedTable}.${contract.name}`, contract.udtName);
      assertBoolean(`nullable for ${normalizedTable}.${contract.name}`, contract.nullable);
      assertBoolean(`required for ${normalizedTable}.${contract.name}`, contract.required);
      if (columnNames.has(contract.name)) {
        throw new Error(`Legacy mapping catalog contains duplicate column ${normalizedTable}.${contract.name}`);
      }
      columnNames.add(contract.name);
    }

    const idContract = table.columns.find((contract) => contract.name === table.idColumn);
    if (!idContract) {
      throw new Error(`Legacy mapping catalog id column ${normalizedTable}.${table.idColumn} is not declared`);
    }
    if (!idContract.required) {
      throw new Error(`Legacy mapping catalog id column ${normalizedTable}.${table.idColumn} must be required`);
    }
    if (idContract.nullable) {
      throw new Error(`Legacy mapping catalog id column ${normalizedTable}.${table.idColumn} must not be nullable`);
    }
  }
  if (dryRunTargetCount === 0) {
    throw new Error("Legacy mapping catalog must declare at least one dry-run-ready target");
  }
}

export function dryRunMigrationEntities(catalog: LegacyMappingCatalog): MigrationEntity[] {
  validateLegacyMappingCatalog(catalog);
  return catalog.tables.flatMap((table) => table.targetEntities
    .filter((target) => target.readiness === "dry-run")
    .map((target) => target.entity));
}

export function assertApplyPrerequisites(
  catalog: LegacyMappingCatalog,
  entities: readonly MigrationEntity[],
): void {
  validateLegacyMappingCatalog(catalog);
  const readiness = new Map<MigrationEntity, string>();
  for (const table of catalog.tables) {
    for (const target of table.targetEntities) readiness.set(target.entity, target.readiness);
  }
  for (const entity of entities) {
    for (const prerequisite of applyPrerequisites[entity] ?? []) {
      const prerequisiteReadiness = readiness.get(prerequisite);
      if (prerequisiteReadiness === undefined || prerequisiteReadiness === "descriptive") {
        throw new Error(
          `Migration entity ${entity} cannot be applied while ${prerequisite} is ${prerequisiteReadiness ?? "undeclared"} in catalog`,
        );
      }
    }
  }
}

export function validateLegacyTableColumns(
  tableName: string,
  columns: readonly SourceColumnSnapshot[],
  mapping: LegacyTableMapping,
): void {
  const columnNames = new Set<string>();
  const ordinalPositions = new Set<number>();
  for (const column of columns) {
    if (typeof column.name !== "string" || !column.name.trim() || !isSafeIdentifier(column.name)) {
      throw schemaMismatch(tableName, `column name ${String(column.name)} is invalid`);
    }
    if (!Number.isSafeInteger(column.ordinalPosition) || column.ordinalPosition < 1) {
      throw schemaMismatch(
        tableName,
        `column ${column.name} ordinal position ${String(column.ordinalPosition)} is invalid`,
      );
    }
    if (columnNames.has(column.name)) {
      throw schemaMismatch(tableName, `duplicate column name ${column.name}`);
    }
    if (ordinalPositions.has(column.ordinalPosition)) {
      throw schemaMismatch(tableName, `duplicate ordinal position ${column.ordinalPosition}`);
    }
    if (typeof column.dataType !== "string" || !column.dataType.trim()) {
      throw schemaMismatch(tableName, `column ${column.name} data type must not be blank`);
    }
    if (typeof column.udtName !== "string" || !column.udtName.trim()) {
      throw schemaMismatch(tableName, `column ${column.name} UDT name must not be blank`);
    }
    if (typeof column.nullable !== "boolean") {
      throw schemaMismatch(tableName, `column ${column.name} nullable must be a boolean`);
    }
    columnNames.add(column.name);
    ordinalPositions.add(column.ordinalPosition);
  }

  const actualByName = new Map(columns.map((column) => [column.name, column]));
  const expectedByName = new Map(mapping.columns.map((column) => [column.name, column]));
  const unexpected = columns
    .map((column) => column.name)
    .filter((name) => !expectedByName.has(name))
    .sort(compareStrings);
  if (unexpected.length > 0) {
    throw schemaMismatch(tableName, `unexpected columns [${unexpected.join(", ")}]`);
  }

  if (!actualByName.has(mapping.idColumn)) {
    throw schemaMismatch(tableName, `missing id column ${mapping.idColumn}`);
  }

  const missing = mapping.columns
    .filter((column) => column.required && !actualByName.has(column.name))
    .map((column) => column.name)
    .sort(compareStrings);
  if (missing.length > 0) {
    throw schemaMismatch(tableName, `missing required columns [${missing.join(", ")}]`);
  }

  for (const expected of mapping.columns) {
    const actual = actualByName.get(expected.name);
    if (!actual) continue;
    if (actual.dataType !== expected.dataType || actual.udtName !== expected.udtName) {
      throw schemaMismatch(
        tableName,
        `column ${expected.name} expected type ${expected.dataType}/${expected.udtName}, received ${actual.dataType}/${actual.udtName}`,
      );
    }
    if (actual.nullable !== expected.nullable) {
      throw schemaMismatch(
        tableName,
        `column ${expected.name} expected nullable=${String(expected.nullable)}, received nullable=${String(actual.nullable)}`,
      );
    }
  }
}

export function validateLegacySourceSnapshots(
  catalog: LegacyMappingCatalog,
  snapshots: readonly SourceTableSnapshot[],
  selectedEntities: readonly MigrationEntity[],
): void {
  validateLegacyMappingCatalog(catalog);
  if (selectedEntities.length === 0) {
    throw new Error("Migration must select at least one entity");
  }

  const routes = new Map<MigrationEntity, { mapping: LegacyTableMapping; readiness: string }>();
  for (const mapping of catalog.tables) {
    for (const target of mapping.targetEntities) {
      routes.set(target.entity, { mapping, readiness: target.readiness });
    }
  }

  if (snapshots.length !== selectedEntities.length) {
    throw new Error("Source table snapshots must contain exactly one snapshot per selected entity");
  }

  for (const entity of selectedEntities) {
    const route = routes.get(entity);
    if (!route || route.readiness !== "dry-run") {
      throw new Error(`Migration entity ${entity} is not dry-run-ready in catalog`);
    }
    const matchingSnapshots = snapshots.filter((snapshot) => snapshot.entity === entity);
    if (matchingSnapshots.length !== 1) {
      throw new Error("Source table snapshots must contain exactly one snapshot per selected entity");
    }

    const snapshot = matchingSnapshots[0]!;
    const expectedTable = normalizeSourceTable(route.mapping.sourceTable);
    const actualTable = normalizeSnapshotTable(snapshot);
    if (actualTable !== expectedTable || snapshot.idColumn !== route.mapping.idColumn) {
      throw new Error(
        `Source table snapshot for ${entity} must route to ${expectedTable}.${route.mapping.idColumn}`,
      );
    }
    validateLegacyTableColumns(expectedTable, snapshot.columns, route.mapping);
  }
}

function column(
  name: string,
  dataType: string,
  udtName: string,
  nullable: boolean,
  required = true,
): LegacyColumnContract {
  return { name, dataType, udtName, nullable, required };
}

function schemaMismatch(tableName: string, mismatch: string): Error {
  return new Error(`Legacy source schema mismatch for ${tableName}: ${mismatch}`);
}

export function normalizeSourceTable(sourceTable: string): string {
  const parts = sourceTable.split(".");
  if (parts.length > 2 || parts.some((part) => !part.trim())) {
    throw new Error(`Legacy mapping catalog source table ${sourceTable} is invalid`);
  }
  if (parts.length === 1) return `public.${parts[0]}`;
  return `${parts[0]}.${parts[1]}`;
}

function normalizeSnapshotTable(snapshot: SourceTableSnapshot): string {
  if (!isSafeIdentifier(snapshot.schema) || !isSafeIdentifier(snapshot.table)) return "invalid.invalid";
  return `${snapshot.schema}.${snapshot.table}`;
}

function assertSafeQualifiedIdentifier(label: string, value: string): void {
  assertNonblank(label, value);
  const parts = value.split(".");
  if (parts.length > 2 || parts.some((part) => !isSafeIdentifier(part))) {
    throw new Error(`Legacy mapping catalog ${label} ${value} is invalid`);
  }
}

function assertSafeIdentifier(label: string, value: string): void {
  assertNonblank(label, value);
  if (!isSafeIdentifier(value)) {
    throw new Error(`Legacy mapping catalog ${label} ${value} is invalid`);
  }
}

function isSafeIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function assertNonblank(label: string, value: string): void {
  if (!value.trim()) throw new Error(`Legacy mapping catalog ${label} must not be blank`);
}

function assertBoolean(label: string, value: boolean): void {
  if (typeof value !== "boolean") {
    throw new Error(`Legacy mapping catalog ${label} must be a boolean`);
  }
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
