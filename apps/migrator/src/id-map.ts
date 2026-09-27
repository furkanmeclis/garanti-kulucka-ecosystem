import type { LegacyIdMapEntry, LegacyIdMapKey, LegacyIdMapWrite, MigrationTarget } from "./types.js";

export type LegacyIdMapUpsertStatus = "created" | "unchanged" | "updated";

export interface LegacyIdMapUpsertResult {
  readonly status: LegacyIdMapUpsertStatus;
  readonly entry: LegacyIdMapEntry;
}

export async function upsertLegacyIdMap(
  target: MigrationTarget,
  input: LegacyIdMapWrite,
): Promise<LegacyIdMapUpsertResult> {
  const existing = await target.findLegacyIdMap(toLegacyIdMapKey(input));

  if (
    existing &&
    existing.targetTable === input.targetTable &&
    existing.targetId === input.targetId &&
    existing.checksum === input.checksum
  ) {
    return { status: "unchanged", entry: existing };
  }

  const entry = await target.upsertLegacyIdMap(input);
  return { status: existing ? "updated" : "created", entry };
}

export function toLegacyIdMapKey(input: LegacyIdMapWrite): LegacyIdMapKey {
  return {
    sourceSystem: input.sourceSystem,
    sourceTable: input.sourceTable,
    sourceId: input.sourceId,
  };
}

export function legacyIdMapKey(input: LegacyIdMapKey): string {
  return `${input.sourceSystem}:${input.sourceTable}:${input.sourceId}`;
}
