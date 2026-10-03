export type MigrationMode = "dry-run" | "apply";

export type MigrationEntity =
  | "customers"
  | "customer_external_identities"
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
  readonly runId: string;
  readonly sourceSystem: string;
  readonly sourceTable: string;
  readonly sourceId: string;
  readonly targetTable: string;
  readonly mappingRole: string;
  readonly targetId: string;
  readonly checksum: string | null;
  readonly migratedAt: Date;
}

export interface LegacySource {
  count(entity: MigrationEntity): Promise<number>;
  readBatch(entity: MigrationEntity, options: BatchReadOptions): Promise<LegacyRecord[]>;
  describeTables(entities: readonly MigrationEntity[]): Promise<SourceTableSnapshot[]>;
}

export interface SourceDatabaseIdentity {
  readonly host: string;
  readonly port: string;
  readonly database: string;
}

export interface SourceColumnSnapshot {
  readonly name: string;
  readonly ordinalPosition: number;
  readonly dataType: string;
  readonly udtName: string;
  readonly nullable: boolean;
}

export interface SourceTableSnapshot {
  readonly entity: MigrationEntity;
  readonly schema: string;
  readonly table: string;
  readonly idColumn: string;
  readonly columns: SourceColumnSnapshot[];
}

export interface SourceEntityRowCount {
  readonly entity: MigrationEntity;
  readonly rows: number;
}

export interface SourceManifest {
  readonly sourceSystem: string;
  readonly databaseIdentity: SourceDatabaseIdentity;
  readonly tables: SourceTableSnapshot[];
  readonly rowCounts: SourceEntityRowCount[];
  readonly batchSize: number;
  readonly mappingCatalogVersion: string;
  readonly planFingerprint: string;
  readonly sourceManifestHash: string;
}

export interface BatchReadOptions {
  readonly limit: number;
  readonly offset?: number;
  readonly afterSourceId?: string;
}

export interface MigrationTarget {
  runInTransaction?<T>(operation: (target: MigrationTarget) => Promise<T>): Promise<T>;
  writeCanonicalRecord(input: CanonicalRecord): Promise<CanonicalWriteResult>;
  findLegacyIdMap(input: LegacyIdMapKey): Promise<LegacyIdMapEntry | null>;
  upsertLegacyIdMap(input: LegacyIdMapWrite): Promise<LegacyIdMapEntry>;
  findMigrationBatchState(input: MigrationBatchStateKey): Promise<MigrationBatchState | null>;
  recordMigrationBatchStarted(input: MigrationBatchStateStart): Promise<MigrationBatchState>;
  recordMigrationBatchSucceeded(input: MigrationBatchStateSuccess): Promise<MigrationBatchState>;
  recordMigrationBatchFailed(input: MigrationBatchStateFailure): Promise<MigrationBatchState>;
  registerMigrationRun(input: MigrationRunRegistration): Promise<MigrationRunState>;
}

export interface MigrationRunRegistration {
  readonly runId: string;
  readonly manifest: SourceManifest;
}

export interface MigrationRunState extends MigrationRunRegistration {
  readonly createdAt: Date;
}

export type CanonicalWriteStatus = "created" | "updated" | "unchanged";

export interface CanonicalWriteResult {
  readonly status: CanonicalWriteStatus;
  readonly record: CanonicalRecord;
}

export interface LegacyIdMapKey {
  readonly runId: string;
  readonly sourceSystem: string;
  readonly sourceTable: string;
  readonly sourceId: string;
  readonly targetTable: string;
  readonly mappingRole: string;
}

export interface LegacyIdMapWrite extends LegacyIdMapKey {
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

export type MigrationBatchStatus = "pending" | "running" | "succeeded" | "failed";

export interface MigrationBatchState {
  readonly runId: string;
  readonly entity: MigrationEntity;
  readonly batchNumber: number;
  readonly status: MigrationBatchStatus;
  readonly limit: number;
  readonly offset: number;
  readonly expectedRows: number;
  readonly readRows: number;
  readonly writtenRows: number;
  readonly skippedRows: number;
  readonly idMapCreated: number;
  readonly idMapUpdated: number;
  readonly idMapUnchanged: number;
  readonly warnings: MigrationWarning[];
  readonly errorMessage: string | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
}

export interface MigrationBatchStateKey {
  readonly runId: string;
  readonly batch: MigrationBatch;
}

export interface MigrationBatchStateStart {
  readonly runId: string;
  readonly batch: MigrationBatch;
  readonly startedAt?: Date;
}

export interface MigrationBatchStateSuccess {
  readonly runId: string;
  readonly batch: MigrationBatch;
  readonly result: MigrationBatchApplyResult;
  readonly finishedAt?: Date;
}

export interface MigrationBatchStateFailure {
  readonly runId: string;
  readonly batch: MigrationBatch;
  readonly error: Error;
  readonly finishedAt?: Date;
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
  readonly customerTransform?: CustomerTransformSummary;
  readonly conversationTransform?: ConversationTransformSummary;
  readonly messageTransform?: MessageTransformSummary;
  readonly productTransform?: ProductTransformSummary;
  readonly orderTransform?: OrderTransformSummary;
  readonly orderItemTransform?: OrderItemTransformSummary;
  readonly shipmentTransform?: ShipmentTransformSummary;
  readonly generatedAt: string;
}

export interface CustomerTransformSummary {
  readonly transformedRows: number;
  readonly addressDrafts: number;
  readonly resolvedIdentities: number;
  readonly unresolvedIdentities: number;
  readonly nameFallbackWarnings: number;
}

export interface ConversationTransformSummary {
  readonly transformedRows: number;
  readonly unresolvedAssignedUsers: number;
  readonly resolvedInstagramAccounts: number;
}

export interface MessageTransformSummary {
  readonly transformedRows: number;
  readonly mediaPayloads: number;
}

export interface ProductTransformSummary {
  readonly transformedRows: number;
  readonly inactiveProducts: number;
}

export interface OrderTransformSummary {
  readonly transformedRows: number;
  readonly unresolvedConversations: number;
  readonly unresolvedCreators: number;
}

export interface OrderItemTransformSummary {
  readonly transformedRows: number;
  readonly resolvedProducts: number;
  readonly unresolvedProducts: number;
  readonly skuProductMatches: number;
  readonly externalProductMatches: number;
}

export interface ShipmentTransformSummary {
  readonly transformedRows: number;
  readonly unresolvedCustomers: number;
  readonly pttShipments: number;
  readonly suratShipments: number;
  readonly manualShipments: number;
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

export type MigratorCommandStatus = "passed" | "failed";

export interface MigratorCommandReport {
  readonly command: string;
  readonly status: MigratorCommandStatus;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly verification?: VerificationReport;
  readonly error?: MigratorCommandReportError;
}

export interface MigratorCommandReportError {
  readonly message: string;
}
