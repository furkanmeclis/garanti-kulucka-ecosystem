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

export interface SourceEntityRowContentChecksum {
  readonly entity: MigrationEntity;
  readonly rows: number;
  readonly checksum: string;
}

export interface SourceManifest {
  readonly sourceSystem: string;
  readonly databaseIdentity: SourceDatabaseIdentity;
  readonly tables: SourceTableSnapshot[];
  readonly rowCounts: SourceEntityRowCount[];
  readonly rowContentChecksums?: SourceEntityRowContentChecksum[];
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
  runWithMigrationRunLock?<T>(
    runId: string,
    operation: (target: MigrationTarget) => Promise<T>,
  ): Promise<T>;
  runInTransaction?<T>(operation: (target: MigrationTarget) => Promise<T>): Promise<T>;
  writeCanonicalRecord(input: CanonicalRecord): Promise<CanonicalWriteResult>;
  writeCustomerAddressRecord?(input: CustomerAddressCanonicalRecord): Promise<CanonicalWriteResult>;
  writeCustomerExternalIdentityRecord?(input: CustomerExternalIdentityCanonicalRecord): Promise<CanonicalWriteResult>;
  writeConversationRecord?(input: ConversationCanonicalRecord): Promise<CanonicalWriteResult>;
  writeMessageRecord?(input: MessageCanonicalRecord): Promise<CanonicalWriteResult>;
  writeFileRecord?(input: FileCanonicalRecord): Promise<CanonicalWriteResult>;
  writeMessageAttachmentRecord?(input: MessageAttachmentCanonicalRecord): Promise<CanonicalWriteResult>;
  writeOrderRecord?(input: OrderCanonicalRecord): Promise<CanonicalWriteResult>;
  writeOrderItemRecord?(input: OrderItemCanonicalRecord): Promise<CanonicalWriteResult>;
  writeShipmentRecord?(input: ShipmentCanonicalRecord): Promise<CanonicalWriteResult>;
  writeShipmentTrackingEventRecord?(input: ShipmentTrackingEventCanonicalRecord): Promise<CanonicalWriteResult>;
  findProductPublicIdBySku?(sku: string): Promise<string | null>;
  findProductPublicIdByExternalId?(externalProductId: string): Promise<string | null>;
  recordDeferredReconciliation?(input: DeferredReconciliationWrite): Promise<DeferredReconciliationEntry>;
  reconcileDeferredReconciliations?(runId: string): Promise<DeferredReconciliationResult>;
  assertOrderTotalsConsistent?(input: OrderTotalConsistencyCheck): Promise<void>;
  calculateOrderTotalAdjustment?(input: OrderTotalConsistencyCheck): Promise<OrderTotalAdjustmentResult>;
  recordOrderManualAdjustment?(input: OrderManualAdjustmentWrite): Promise<void>;
  findLegacyIdMap(input: LegacyIdMapKey): Promise<LegacyIdMapEntry | null>;
  findLegacyIdMapsByMappingRole?(input: LegacyIdMapRoleLookup): Promise<readonly LegacyIdMapEntry[]>;
  upsertLegacyIdMap(input: LegacyIdMapWrite): Promise<LegacyIdMapEntry>;
  findMigrationBatchState(input: MigrationBatchStateKey): Promise<MigrationBatchState | null>;
  recordMigrationBatchStarted(input: MigrationBatchStateStart): Promise<MigrationBatchState>;
  recordMigrationBatchSucceeded(input: MigrationBatchStateSuccess): Promise<MigrationBatchState>;
  recordMigrationBatchFailed(input: MigrationBatchStateFailure): Promise<MigrationBatchState>;
  registerMigrationRun(input: MigrationRunRegistration): Promise<MigrationRunState>;
}

export interface CustomerAddressCanonicalRecord {
  readonly targetTable: "customer_addresses";
  readonly targetId: string;
  readonly customerPublicId: string;
  readonly payload: {
    readonly label: string | null;
    readonly address_line: string;
    readonly district: string | null;
    readonly city: string | null;
    readonly country: string;
    readonly postal_code: string | null;
    readonly is_default: boolean;
  };
  readonly checksum: string;
}

export interface CustomerExternalIdentityCanonicalRecord {
  readonly targetTable: "customer_external_identities";
  readonly targetId: string;
  readonly customerPublicId: string;
  readonly integrationAccountPublicId: string;
  readonly payload: {
    readonly external_id: string;
    readonly metadata: Record<string, unknown>;
  };
  readonly checksum: string;
}

export interface ConversationCanonicalRecord {
  readonly targetTable: "conversations";
  readonly targetId: string;
  readonly customerPublicId: string;
  readonly assignedUserPublicId: string | null;
  readonly integrationAccountPublicId: string | null;
  readonly checksum: string;
  readonly payload: {
    readonly channel: string;
    readonly external_thread_id: string | null;
    readonly status: string;
    readonly is_in_pool: boolean;
    readonly human_agent_enabled: boolean;
    readonly unread_count: number;
    readonly last_message_text: string | null;
    readonly last_message_sender_type: string | null;
    readonly last_message_at: string | null;
  };
}

export interface MessageCanonicalRecord {
  readonly targetTable: "messages";
  readonly targetId: string;
  readonly conversationPublicId: string;
  readonly checksum: string;
  readonly payload: {
    readonly sender_type: string;
    readonly body: string;
    readonly external_message_id: string | null;
    readonly is_read: boolean;
    readonly sent_at: string;
    readonly raw_payload: Record<string, unknown> | null;
  };
}

export interface FileCanonicalRecord {
  readonly targetTable: "files";
  readonly targetId: string;
  readonly checksum: string;
  readonly payload: {
    readonly bucket: string;
    readonly object_key: string;
    readonly original_name: string | null;
    readonly mime_type: string;
    readonly byte_size: number;
    readonly checksum: string;
    readonly upload_status: "available";
    readonly scan_status: "pending" | "clean" | "infected" | "skipped";
    readonly upload_type: "singlepart";
    readonly completed_at: string;
  };
}

export interface MessageAttachmentCanonicalRecord {
  readonly targetTable: "message_attachments";
  readonly targetId: string;
  readonly messagePublicId: string;
  readonly filePublicId: string;
  readonly checksum: string;
  readonly payload: {
    readonly attachment_type: string;
  };
}

export interface OrderCanonicalRecord {
  readonly targetTable: "orders";
  readonly targetId: string;
  readonly customerPublicId: string;
  readonly conversationPublicId: string | null;
  readonly createdByUserPublicId: string | null;
  readonly checksum: string;
  readonly payload: {
    readonly order_number: string;
    readonly status: string;
    readonly source: string;
    readonly total_amount: string;
    readonly manual_adjustment_amount: string;
    readonly currency: string;
    readonly confirmation_status: string | null;
    readonly notes: string | null;
    readonly external_order_id: string | null;
  };
}

export interface OrderItemCanonicalRecord {
  readonly targetTable: "order_items";
  readonly targetId: string;
  readonly orderPublicId: string;
  readonly productPublicId: string;
  readonly checksum: string;
  readonly payload: {
    readonly name: string;
    readonly quantity: number;
    readonly unit_price: string;
    readonly total_amount: string;
    readonly external_product_id: string | null;
  };
}

export interface ShipmentCanonicalRecord {
  readonly targetTable: "shipments";
  readonly targetId: string;
  readonly orderPublicId: string | null;
  readonly customerPublicId: string | null;
  readonly checksum: string;
  readonly payload: {
    readonly provider: string;
    readonly tracking_number: string | null;
    readonly barcode_number: string | null;
    readonly status: string;
    readonly recipient_name: string;
    readonly recipient_phone: string | null;
    readonly recipient_address: string;
    readonly recipient_city: string | null;
    readonly recipient_district: string | null;
    readonly last_event_text: string | null;
    readonly shipped_at: string | null;
    readonly delivered_at: string | null;
    readonly raw_payload: Record<string, unknown> | null;
  };
}

export interface ShipmentTrackingEventCanonicalRecord {
  readonly targetTable: "shipment_tracking_events";
  readonly targetId: string;
  readonly shipmentPublicId: string;
  readonly checksum: string;
  readonly payload: {
    readonly status: string;
    readonly description: string | null;
    readonly location: string | null;
    readonly occurred_at: string;
    readonly raw_payload: Record<string, unknown>;
  };
}

export type DeferredReconciliationStatus = "pending" | "resolved";

export interface DeferredReconciliationWrite {
  readonly runId: string;
  readonly sourceSystem: string;
  readonly sourceTable: string;
  readonly sourceId: string;
  readonly targetTable: string;
  readonly targetId: string;
  readonly targetColumn: string;
  readonly lookupSourceTable: string;
  readonly lookupSourceId: string;
  readonly lookupTargetTable: string;
  readonly lookupMappingRole: string;
}

export interface DeferredReconciliationEntry extends DeferredReconciliationWrite {
  readonly publicId: string;
  readonly status: DeferredReconciliationStatus;
  readonly resolvedTargetId: string | null;
  readonly resolvedAt: Date | null;
  readonly errorMessage: string | null;
}

export interface DeferredReconciliationResult {
  readonly examined: number;
  readonly resolved: number;
  readonly pending: number;
}

export interface OrderTotalConsistencyCheck {
  readonly orderPublicId: string;
}

export interface OrderManualAdjustmentWrite {
  readonly orderPublicId: string;
  readonly manualAdjustmentAmount: string;
}

export interface OrderTotalAdjustmentResult {
  readonly itemCount: number;
  readonly adjustmentAmount: string;
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

export interface LegacyIdMapRoleLookup {
  readonly runId: string;
  readonly sourceSystem: string;
  readonly sourceTable: string;
  readonly targetTable: string;
  readonly mappingRole: string;
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
  readonly shipmentTrackingEventTransform?: ShipmentTrackingEventTransformSummary;
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
  readonly inlineMediaPayloads?: number;
  readonly inlineMediaDecodedBytesByMime?: Record<string, number>;
  readonly mediaFieldConflicts?: number;
}

export interface ProductTransformSummary {
  readonly transformedRows: number;
  readonly inactiveProducts: number;
  readonly duplicateExternalProductIdGroups?: number;
  readonly duplicateExternalProductIdRows?: number;
}

export interface OrderTransformSummary {
  readonly transformedRows: number;
  readonly unresolvedConversations: number;
  readonly unresolvedCreators: number;
  readonly customerResolutionById?: number;
  readonly customerResolutionByPhone?: number;
  readonly syntheticCustomersFromOrders?: number;
  readonly ambiguousPhoneMatches?: number;
}

export interface OrderItemTransformSummary {
  readonly transformedRows: number;
  readonly resolvedProducts: number;
  readonly unresolvedProducts: number;
  readonly skuProductMatches: number;
  readonly externalProductMatches: number;
  readonly totalAdjustmentWarnings?: number;
  readonly totalAdjustmentAmount?: string;
  readonly ordersWithoutItems?: number;
}

export interface ShipmentTransformSummary {
  readonly transformedRows: number;
  readonly unresolvedCustomers: number;
  readonly linkedOrdersByTracking?: number;
  readonly ambiguousOrderTrackingMatches?: number;
  readonly unmatchedOrderTracking?: number;
  readonly ordersWithTrackingWithoutShipment?: number;
  readonly pttShipments: number;
  readonly suratShipments: number;
  readonly manualShipments: number;
}

export interface ShipmentTrackingEventTransformSummary {
  readonly transformedRows: number;
  readonly uniqueEvents: number;
  readonly duplicateRows: number;
  readonly futureDatedRows: number;
  readonly providerTimeEvents: number;
  readonly firstSeenEvents: number;
  readonly unresolvedShipments: number;
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
  readonly migration?: unknown;
  readonly reconciliation?: DeferredReconciliationResult;
  readonly verification?: VerificationReport;
  readonly error?: MigratorCommandReportError;
}

export interface MigratorCommandReportError {
  readonly message: string;
}
