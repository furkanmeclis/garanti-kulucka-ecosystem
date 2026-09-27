export type MigrationMode = "dry-run" | "apply";

export type MigrationEntity =
  | "customers"
  | "customer_addresses"
  | "conversations"
  | "messages"
  | "products"
  | "orders"
  | "order_items"
  | "shipments"
  | "shipment_tracking_events"
  | "integration_accounts"
  | "integration_settings"
  | "webhook_subscriptions"
  | "files"
  | "settings";

export interface LegacyCursor {
  readonly entity: MigrationEntity;
  readonly afterSourceId?: string;
}

export interface LegacyRecord {
  readonly sourceSystem: string;
  readonly sourceTable: string;
  readonly sourceId: string;
  readonly payload: Record<string, unknown>;
  readonly checksum: string;
}

export interface CanonicalRecord {
  readonly targetTable: string;
  readonly targetId: string;
  readonly payload: Record<string, unknown>;
  readonly checksum: string;
}

export interface LegacyIdMapEntry {
  readonly sourceSystem: string;
  readonly sourceTable: string;
  readonly sourceId: string;
  readonly targetTable: string;
  readonly targetId: string;
  readonly checksum: string | null;
  readonly migratedAt: Date;
}

export interface LegacySource {
  count(entity: MigrationEntity): Promise<number>;
  readBatch(entity: MigrationEntity, options: BatchReadOptions): Promise<LegacyRecord[]>;
}

export interface BatchReadOptions {
  readonly limit: number;
  readonly afterSourceId?: string;
}

export interface MigrationTarget {
  writeCanonicalRecord(input: CanonicalRecord): Promise<CanonicalWriteResult>;
  findLegacyIdMap(input: LegacyIdMapKey): Promise<LegacyIdMapEntry | null>;
  upsertLegacyIdMap(input: LegacyIdMapWrite): Promise<LegacyIdMapEntry>;
}

export type CanonicalWriteStatus = "created" | "updated" | "unchanged";

export interface CanonicalWriteResult {
  readonly status: CanonicalWriteStatus;
  readonly record: CanonicalRecord;
}

export interface LegacyIdMapKey {
  readonly sourceSystem: string;
  readonly sourceTable: string;
  readonly sourceId: string;
}

export interface LegacyIdMapWrite extends LegacyIdMapKey {
  readonly targetTable: string;
  readonly targetId: string;
  readonly checksum: string | null;
}

export interface MigrationBatch {
  readonly entity: MigrationEntity;
  readonly batchNumber: number;
  readonly limit: number;
  readonly offset: number;
  readonly expectedRows: number;
}

export interface MigrationBatchApplyResult {
  readonly entity: MigrationEntity;
  readonly batchNumber: number;
  readonly readRows: number;
  readonly writtenRows: number;
  readonly skippedRows: number;
  readonly idMapCreated: number;
  readonly idMapUpdated: number;
  readonly idMapUnchanged: number;
  readonly warnings: MigrationWarning[];
}

export interface MigrationPlan {
  readonly mode: MigrationMode;
  readonly batchSize: number;
  readonly totalRows: number;
  readonly batches: MigrationBatch[];
  readonly entities: MigrationEntityPlan[];
  readonly createdAt: string;
}

export interface MigrationEntityPlan {
  readonly entity: MigrationEntity;
  readonly totalRows: number;
  readonly batches: number;
}

export interface DryRunReport {
  readonly mode: "dry-run";
  readonly plan: MigrationPlan;
  readonly totals: MigrationReportTotals;
  readonly entities: MigrationEntityReport[];
  readonly warnings: MigrationWarning[];
  readonly generatedAt: string;
}

export interface VerificationReport {
  readonly status: "passed" | "failed";
  readonly checks: VerificationCheck[];
  readonly totals: VerificationTotals;
  readonly generatedAt: string;
}

export interface MigrationReportTotals {
  readonly plannedRows: number;
  readonly plannedBatches: number;
  readonly blockedRows: number;
}

export interface MigrationEntityReport {
  readonly entity: MigrationEntity;
  readonly plannedRows: number;
  readonly plannedBatches: number;
  readonly blockedRows: number;
}

export interface MigrationWarning {
  readonly entity: MigrationEntity;
  readonly code: string;
  readonly message: string;
}

export interface VerificationCheck {
  readonly name: string;
  readonly status: "passed" | "failed";
  readonly expected?: number;
  readonly actual?: number;
  readonly message?: string;
}

export interface VerificationTotals {
  readonly passed: number;
  readonly failed: number;
}
