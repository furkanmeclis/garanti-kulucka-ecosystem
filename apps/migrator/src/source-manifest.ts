import { createHash } from "node:crypto";
import type {
  MigrationPlan,
  MigrationRunState,
  MigrationTarget,
  SourceDatabaseIdentity,
  SourceManifest,
  SourceTableSnapshot,
} from "./types.js";

export interface CreateSourceManifestInput {
  readonly sourceSystem: string;
  readonly databaseIdentity: SourceDatabaseIdentity;
  readonly tables: SourceTableSnapshot[];
  readonly plan: MigrationPlan;
  readonly mappingCatalogVersion: string;
}

export function createSourceManifest(input: CreateSourceManifestInput): SourceManifest {
  const sourceSystem = input.sourceSystem.trim();
  if (!sourceSystem) {
    throw new Error("sourceSystem must not be blank");
  }
  const catalogVersion = input.mappingCatalogVersion.trim();
  if (!catalogVersion) {
    throw new Error("mappingCatalogVersion must not be blank");
  }
  assertTableSnapshotCoverage(input.tables, input.plan);

  const tables = [...input.tables]
    .map((table) => ({
      ...table,
      columns: [...table.columns].sort(
        (left, right) => left.ordinalPosition - right.ordinalPosition || compareStrings(left.name, right.name),
      ),
    }))
    .sort((left, right) => compareStrings(left.entity, right.entity));
  const rowCounts = [...input.plan.entities]
    .map(({ entity, totalRows }) => ({ entity, rows: totalRows }))
    .sort((left, right) => compareStrings(left.entity, right.entity));
  const planFingerprint = hashCanonical({
    batchSize: input.plan.batchSize,
    mappingCatalogVersion: catalogVersion,
    entities: input.plan.entities,
    batches: input.plan.batches,
  });
  const manifestWithoutHash = {
    sourceSystem,
    databaseIdentity: input.databaseIdentity,
    tables,
    rowCounts,
    batchSize: input.plan.batchSize,
    mappingCatalogVersion: catalogVersion,
    planFingerprint,
  };

  return {
    ...manifestWithoutHash,
    sourceManifestHash: hashCanonical(manifestWithoutHash),
  };
}

function assertTableSnapshotCoverage(tables: SourceTableSnapshot[], plan: MigrationPlan): void {
  const expected = new Set(plan.entities.map(({ entity }) => entity));
  const actual = new Set(tables.map(({ entity }) => entity));
  if (actual.size !== tables.length || actual.size !== expected.size) {
    throw new Error("Source table snapshot must contain exactly one table per planned entity");
  }
  for (const entity of expected) {
    if (!actual.has(entity)) {
      throw new Error(`Source table snapshot is missing planned entity: ${entity}`);
    }
  }
}

export async function registerMigrationRun(
  target: MigrationTarget,
  runId: string,
  manifest: SourceManifest,
): Promise<MigrationRunState> {
  assertMigrationRunId(runId);
  const persisted = await target.registerMigrationRun({ runId, manifest });
  assertResumeManifestMatches(runId, persisted.manifest, manifest);
  return persisted;
}

export function assertMigrationRunId(runId: string): void {
  if (!runId.trim()) {
    throw new Error("runId must not be blank");
  }
}

export function assertResumeManifestMatches(
  runId: string,
  persisted: SourceManifest,
  requested: SourceManifest,
): void {
  const mismatches: string[] = [];
  if (persisted.sourceManifestHash !== calculateSourceManifestHash(persisted)) {
    mismatches.push("persisted source manifest integrity");
  }
  if (requested.sourceManifestHash !== calculateSourceManifestHash(requested)) {
    mismatches.push("requested source manifest integrity");
  }
  if (canonicalJson(persisted.databaseIdentity) !== canonicalJson(requested.databaseIdentity)) {
    mismatches.push("source database identity");
  }
  if (persisted.sourceSystem !== requested.sourceSystem) mismatches.push("source system identity");
  if (canonicalJson(persisted.tables) !== canonicalJson(requested.tables)) mismatches.push("table snapshot");
  if (canonicalJson(persisted.rowCounts) !== canonicalJson(requested.rowCounts)) mismatches.push("row counts");
  if (persisted.mappingCatalogVersion !== requested.mappingCatalogVersion) mismatches.push("mapping catalog version");
  if (persisted.batchSize !== requested.batchSize) mismatches.push("batch size");
  if (persisted.planFingerprint !== requested.planFingerprint) mismatches.push("plan fingerprint");
  if (persisted.sourceManifestHash !== requested.sourceManifestHash) mismatches.push("source manifest hash");

  if (mismatches.length > 0) {
    throw new Error(`Migration run ${runId} cannot resume: ${mismatches.join(", ")} changed`);
  }
}

export function calculateSourceManifestHash(manifest: Omit<SourceManifest, "sourceManifestHash">): string {
  return hashCanonical({
    sourceSystem: manifest.sourceSystem,
    databaseIdentity: manifest.databaseIdentity,
    tables: manifest.tables,
    rowCounts: manifest.rowCounts,
    batchSize: manifest.batchSize,
    mappingCatalogVersion: manifest.mappingCatalogVersion,
    planFingerprint: manifest.planFingerprint,
  });
}

function hashCanonical(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = sortValue((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }
  return value;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
