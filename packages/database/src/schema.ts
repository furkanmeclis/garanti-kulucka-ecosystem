import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type Json = unknown;

export type Id = Generated<number>;

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "login"
  | "logout"
  | "provider_call"
  | "settings_change";

export interface Database {
  roles: RolesTable;
  permissions: PermissionsTable;
  role_permissions: RolePermissionsTable;
  users: UsersTable;
  user_sessions: UserSessionsTable;
  refresh_tokens: RefreshTokensTable;
  login_attempts: LoginAttemptsTable;
  customers: CustomersTable;
  customer_external_identities: CustomerExternalIdentitiesTable;
  customer_addresses: CustomerAddressesTable;
  conversations: ConversationsTable;
  messages: MessagesTable;
  message_attachments: MessageAttachmentsTable;
  message_shortcuts: MessageShortcutsTable;
  message_shortcut_attachments: MessageShortcutAttachmentsTable;
  products: ProductsTable;
  stock_movements: StockMovementsTable;
  orders: OrdersTable;
  order_items: OrderItemsTable;
  shipments: ShipmentsTable;
  shipment_tracking_events: ShipmentTrackingEventsTable;
  integration_providers: IntegrationProvidersTable;
  integration_accounts: IntegrationAccountsTable;
  integration_tokens: IntegrationTokensTable;
  integration_settings: IntegrationSettingsTable;
  integration_settings_versions: IntegrationSettingsVersionsTable;
  webhook_subscriptions: WebhookSubscriptionsTable;
  webhook_events: WebhookEventsTable;
  provider_attempts: ProviderAttemptsTable;
  files: FilesTable;
  audit_logs: AuditLogsTable;
  settings: SettingsTable;
  settings_versions: SettingsVersionsTable;
  job_runs: JobRunsTable;
  migration_runs: MigrationRunsTable;
  migration_batches: MigrationBatchesTable;
  legacy_id_map: LegacyIdMapTable;
  migration_deferred_reconciliations: MigrationDeferredReconciliationsTable;
}

export interface BaseTable {
  id: Id;
  public_id: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface RolesTable extends BaseTable {
  name: string;
  description: string | null;
  is_system: boolean;
}

export interface PermissionsTable extends BaseTable {
  key: string;
  description: string | null;
}

export interface RolePermissionsTable {
  role_id: number;
  permission_id: number;
  created_at: Timestamp;
}

export interface UsersTable extends BaseTable {
  role_id: number;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  is_active: boolean;
  is_online: boolean;
  last_seen_at: Timestamp | null;
  sip_username: string | null;
  sip_password_encrypted: string | null;
}

export interface UserSessionsTable extends BaseTable {
  user_id: number;
  user_agent: string | null;
  ip_address: string | null;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
}

export interface RefreshTokensTable extends BaseTable {
  session_id: number;
  token_hash: string;
  expires_at: Timestamp;
  used_at: Timestamp | null;
  revoked_at: Timestamp | null;
}

export interface LoginAttemptsTable {
  id: Id;
  email: string;
  ip_address: string | null;
  user_agent: string | null;
  success: boolean;
  failure_reason: string | null;
  created_at: Timestamp;
}

export interface CustomersTable extends BaseTable {
  full_name: string;
  phone: string | null;
  email: string | null;
  username: string | null;
  notes: string | null;
}

export interface CustomerExternalIdentitiesTable extends BaseTable {
  customer_id: number;
  integration_account_id: number;
  external_id: string;
  metadata: Json;
}

export interface CustomerAddressesTable extends BaseTable {
  customer_id: number;
  label: string | null;
  address_line: string;
  district: string | null;
  city: string | null;
  country: string;
  postal_code: string | null;
  is_default: boolean;
}

export interface ConversationsTable extends BaseTable {
  customer_id: number | null;
  assigned_user_id: number | null;
  integration_account_id: number | null;
  channel: string;
  external_thread_id: string | null;
  status: string;
  is_in_pool: boolean;
  human_agent_enabled: boolean;
  unread_count: number;
  last_message_text: string | null;
  last_message_sender_type: string | null;
  last_message_at: Timestamp | null;
  notes: string | null;
}

export interface MessagesTable extends BaseTable {
  conversation_id: number;
  sender_type: string;
  sender_name: string | null;
  body: string | null;
  external_message_id: string | null;
  is_read: boolean;
  sent_at: Timestamp;
  raw_payload: Json | null;
}

export interface MessageAttachmentsTable extends BaseTable {
  message_id: number;
  file_id: number;
  attachment_type: string;
}

export interface MessageShortcutsTable extends BaseTable {
  code: string;
  message: string | null;
  type: string;
  is_active: boolean;
  sort_order: number;
  created_by_user_id: number | null;
}

export interface MessageShortcutAttachmentsTable extends BaseTable {
  shortcut_id: number;
  file_id: number;
  attachment_type: string;
  sort_order: number;
}

export interface ProductsTable extends BaseTable {
  sku: string | null;
  name: string;
  category: string | null;
  unit_price: string;
  stock_quantity: number;
  is_active: boolean;
  external_product_id: string | null;
  unit: ColumnType<string, string | undefined, string>;
  description: ColumnType<string | null, string | null | undefined, string | null>;
}

export type StockMovementType = "in" | "out" | "adjustment";

export interface StockMovementsTable extends BaseTable {
  product_id: number;
  movement_type: StockMovementType;
  quantity: number;
  previous_quantity: number;
  new_quantity: number;
  notes: string | null;
  created_by_user_id: number | null;
}

export interface OrdersTable extends BaseTable {
  customer_id: number | null;
  conversation_id: number | null;
  created_by_user_id: number | null;
  order_number: string;
  status: string;
  source: string;
  total_amount: string;
  currency: string;
  confirmation_status: string | null;
  notes: string | null;
  external_order_id: string | null;
}

export interface OrderItemsTable extends BaseTable {
  order_id: number;
  product_id: number | null;
  name: string;
  quantity: number;
  unit_price: string;
  total_amount: string;
  external_product_id: string | null;
}

export interface ShipmentsTable extends BaseTable {
  order_id: number | null;
  customer_id: number | null;
  provider: string;
  tracking_number: string | null;
  barcode_number: string | null;
  status: string;
  recipient_name: string;
  recipient_phone: string | null;
  recipient_address: string;
  recipient_city: string | null;
  recipient_district: string | null;
  last_event_text: string | null;
  shipped_at: Timestamp | null;
  delivered_at: Timestamp | null;
  raw_payload: Json | null;
}

export interface ShipmentTrackingEventsTable extends BaseTable {
  shipment_id: number;
  status: string;
  description: string | null;
  location: string | null;
  occurred_at: Timestamp;
  raw_payload: Json | null;
}

export interface IntegrationProvidersTable extends BaseTable {
  key: string;
  name: string;
  is_active: boolean;
}

export interface IntegrationAccountsTable extends BaseTable {
  provider_id: number;
  display_name: string;
  external_account_id: string | null;
  status: string;
  metadata: Json;
}

export interface IntegrationTokensTable extends BaseTable {
  account_id: number;
  token_type: string;
  encrypted_value: string;
  expires_at: Timestamp | null;
  last_refreshed_at: Timestamp | null;
}

export interface IntegrationSettingsTable extends BaseTable {
  account_id: number | null;
  provider_id: number;
  key: string;
  value: Json;
  is_secret: boolean;
}

export interface IntegrationSettingsVersionsTable {
  id: Id;
  public_id: string;
  integration_settings_id: number;
  version_number: number;
  value: Json;
  is_secret: boolean;
  created_by_user_id: number | null;
  created_at: Timestamp;
}

export interface WebhookSubscriptionsTable extends BaseTable {
  provider_id: number;
  account_id: number | null;
  callback_path: string;
  verify_token_hash: string | null;
  is_active: boolean;
  metadata: Json;
}

export interface WebhookEventsTable extends BaseTable {
  provider_id: number;
  account_id: number | null;
  event_type: string;
  external_event_id: string | null;
  received_at: Timestamp;
  processed_at: Timestamp | null;
  status: string;
  payload_hash: string;
  raw_payload: Json;
}

export interface ProviderAttemptsTable extends BaseTable {
  provider_id: number;
  account_id: number | null;
  request_id: string;
  operation: string;
  direction: string;
  status: string;
  status_code: number | null;
  duration_ms: number;
  retry_decision: string;
  next_retry_at: Timestamp | null;
  idempotency_key: string | null;
  request_metadata: Json;
  response_metadata: Json;
  error_code: string | null;
  error_message: string | null;
  started_at: Timestamp;
}

export interface FilesTable extends BaseTable {
  bucket: string;
  object_key: string;
  original_name: string | null;
  mime_type: string | null;
  byte_size: number | null;
  checksum: string | null;
  upload_status: "pending" | "available" | "abandoned";
  scan_status: "pending" | "clean" | "infected" | "skipped";
  upload_type: "singlepart" | "multipart";
  multipart_upload_id: string | null;
  completed_at: Timestamp | null;
  abandoned_at: Timestamp | null;
  created_by_user_id: number | null;
}

export interface AuditLogsTable {
  id: Id;
  actor_user_id: number | null;
  action: AuditAction | string;
  entity_type: string;
  entity_id: string | null;
  old_value: Json | null;
  new_value: Json | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Timestamp;
}

export interface SettingsTable extends BaseTable {
  key: string;
  value: Json;
  scope: string;
  is_secret: boolean;
}

export interface SettingsVersionsTable {
  id: Id;
  public_id: string;
  settings_id: number;
  version_number: number;
  value: Json;
  is_secret: boolean;
  created_by_user_id: number | null;
  created_at: Timestamp;
}

export interface JobRunsTable extends BaseTable {
  queue_name: string;
  job_name: string;
  external_job_id: string | null;
  status: string;
  attempts: number;
  payload: Json;
  error_message: string | null;
  started_at: Timestamp | null;
  finished_at: Timestamp | null;
}

export interface MigrationBatchesTable extends BaseTable {
  run_id: string;
  entity: string;
  batch_number: number;
  status: string;
  limit_rows: number;
  offset_rows: number;
  expected_rows: number;
  read_rows: number;
  written_rows: number;
  skipped_rows: number;
  id_map_created: number;
  id_map_updated: number;
  id_map_unchanged: number;
  warnings: Json;
  error_message: string | null;
  started_at: Timestamp | null;
  finished_at: Timestamp | null;
}

export interface MigrationRunsTable {
  id: Id;
  public_id: string;
  run_id: string;
  source_system: string;
  source_database_identity: Json;
  table_snapshot: Json;
  row_counts: Json;
  row_content_checksums: Json;
  batch_size: number;
  mapping_catalog_version: string;
  plan_fingerprint: string;
  source_manifest_hash: string;
  created_at: Timestamp;
}

export interface LegacyIdMapTable {
  id: Id;
  run_id: string;
  source_system: string;
  source_table: string;
  source_id: string;
  target_table: string;
  mapping_role: string;
  target_id: string;
  checksum: string | null;
  migrated_at: Timestamp;
}

export interface MigrationDeferredReconciliationsTable extends BaseTable {
  run_id: string;
  source_system: string;
  source_table: string;
  source_id: string;
  target_table: string;
  target_id: string;
  target_column: string;
  lookup_source_table: string;
  lookup_source_id: string;
  lookup_target_table: string;
  lookup_mapping_role: string;
  status: string;
  resolved_target_id: string | null;
  resolved_at: Timestamp | null;
  error_message: string | null;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type CustomerExternalIdentity = Selectable<CustomerExternalIdentitiesTable>;
export type NewCustomerExternalIdentity = Insertable<CustomerExternalIdentitiesTable>;
export type CustomerExternalIdentityUpdate = Updateable<CustomerExternalIdentitiesTable>;
