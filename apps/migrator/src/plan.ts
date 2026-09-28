import type { LegacySource, MigrationEntity, MigrationEntityPlan, MigrationMode, MigrationPlan } from "./types.js";

export const canonicalMigrationEntities: readonly MigrationEntity[] = [
  "customers",
  "customer_addresses",
  "conversations",
  "messages",
  "products",
  "orders",
  "order_items",
  "shipments",
  "shipment_tracking_events",
  "integration_accounts",
  "integration_settings",
  "webhook_subscriptions",
  "files",
  "settings",
];

export const defaultMigrationEntities: MigrationEntity[] = [...canonicalMigrationEntities];

export interface CreateMigrationPlanInput {
  readonly source: LegacySource;
  readonly mode: MigrationMode;
  readonly batchSize: number;
  readonly entities?: MigrationEntity[];
  readonly now?: Date;
}

export async function createMigrationPlan(input: CreateMigrationPlanInput): Promise<MigrationPlan> {
  if (!Number.isInteger(input.batchSize) || input.batchSize < 1) {
    throw new Error("batchSize must be a positive integer");
  }

  const entities = input.entities ?? defaultMigrationEntities;
  const entityPlans: MigrationEntityPlan[] = [];
  const batches = [];

  for (const entity of entities) {
    const totalRows = await input.source.count(entity);
    if (!Number.isInteger(totalRows) || totalRows < 0) {
      throw new Error(`Source returned invalid row count for ${entity}`);
    }

    const batchCount = Math.ceil(totalRows / input.batchSize);
    entityPlans.push({ entity, totalRows, batches: batchCount });

    for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
      const offset = batchIndex * input.batchSize;
      batches.push({
        entity,
        batchNumber: batchIndex + 1,
        limit: input.batchSize,
        offset,
        expectedRows: Math.min(input.batchSize, totalRows - offset),
      });
    }
  }

  return {
    mode: input.mode,
    batchSize: input.batchSize,
    totalRows: entityPlans.reduce((sum, entity) => sum + entity.totalRows, 0),
    batches,
    entities: entityPlans,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}
