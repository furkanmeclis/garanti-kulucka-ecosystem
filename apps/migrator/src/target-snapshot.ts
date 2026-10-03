import type { Client } from "pg";
import { canonicalMigrationEntities } from "./plan.js";
import type {
  MigrationEntity,
  SourceDatabaseIdentity,
  SourceEntityRowCount,
  SourceManifest,
  SourceTableSnapshot,
} from "./types.js";
import type { MigrationVerificationSnapshot } from "./verify.js";

export async function createTargetVerificationSnapshot(
  client: Client,
  runId: string,
): Promise<MigrationVerificationSnapshot> {
  const sourceManifest = await selectSourceManifest(client, runId);
  const legacyIdMaps = await selectLegacyIdMaps(client, runId);
  const targetPublicIds = await selectReferencedTargetPublicIds(client, legacyIdMaps);
  const [customers, customerExternalIdentities, conversations, messages, orders, orderItems, shipments] =
    await Promise.all([
      selectCustomers(client, targetPublicIds.customers),
      selectCustomerExternalIdentities(client, targetPublicIds.customer_external_identities),
      selectConversations(client, targetPublicIds.conversations),
      selectMessages(client, targetPublicIds.messages),
      selectOrders(client, targetPublicIds.orders),
      selectOrderItems(client, targetPublicIds.order_items),
      selectShipments(client, targetPublicIds.shipments),
    ]);

  return {
    runId,
    sourceManifest,
    targetPublicIds,
    customers,
    customerExternalIdentities,
    conversations,
    messages,
    orders,
    orderItems,
    shipments,
    legacyIdMaps,
  };
}

async function selectReferencedTargetPublicIds(
  client: Client,
  legacyIdMaps: NonNullable<MigrationVerificationSnapshot["legacyIdMaps"]>,
): Promise<Record<MigrationEntity, string[]>> {
  const referencedIds = new Map<MigrationEntity, Set<string>>();
  const canonicalEntities = new Set<string>(canonicalMigrationEntities);
  for (const entry of legacyIdMaps) {
    if (!canonicalEntities.has(entry.target_table)) continue;
    const entity = entry.target_table as MigrationEntity;
    const ids = referencedIds.get(entity) ?? new Set<string>();
    ids.add(entry.target_id);
    referencedIds.set(entity, ids);
  }

  const entries = await Promise.all(canonicalMigrationEntities.map(async (entity) => {
    const requestedIds = [...(referencedIds.get(entity) ?? [])];
    if (requestedIds.length === 0) return [entity, []] as const;
    const result = await client.query<{ public_id: string }>(
      `select public_id from ${entity} where public_id = any($1::text[]) order by id asc`,
      [requestedIds],
    );
    const requestedIdSet = new Set(requestedIds);
    if (result.rows.some(
      (row) =>
        typeof row.public_id !== "string" ||
        row.public_id.length === 0 ||
        !requestedIdSet.has(row.public_id),
    )) {
      throw new Error(`Canonical target returned invalid public_id set for ${entity}`);
    }
    return [entity, result.rows.map((row) => row.public_id)] as const;
  }));

  return Object.fromEntries(entries) as Record<MigrationEntity, string[]>;
}

async function selectCustomerExternalIdentities(client: Client, publicIds: readonly string[]) {
  if (publicIds.length === 0) return [];
  const result = await client.query<{
    public_id: string;
    customer_public_id: string | null;
    integration_account_public_id: string | null;
    external_id: string;
  }>(`
    select customer_external_identities.public_id,
           customers.public_id as customer_public_id,
           integration_accounts.public_id as integration_account_public_id,
           customer_external_identities.external_id
    from customer_external_identities
    left join customers on customers.id = customer_external_identities.customer_id
    left join integration_accounts on integration_accounts.id = customer_external_identities.integration_account_id
    where customer_external_identities.public_id = any($1::text[])
    order by customer_external_identities.id asc
  `, [publicIds]);
  return result.rows;
}

async function selectSourceManifest(client: Client, runId: string): Promise<SourceManifest | null> {
  const result = await client.query<{
    source_system: string;
    source_database_identity: SourceDatabaseIdentity;
    table_snapshot: SourceTableSnapshot[];
    row_counts: SourceEntityRowCount[];
    row_content_checksums: SourceManifest["rowContentChecksums"];
    batch_size: number;
    mapping_catalog_version: string;
    plan_fingerprint: string;
    source_manifest_hash: string;
  }>(
    `select source_system, source_database_identity, table_snapshot, row_counts, row_content_checksums,
            batch_size, mapping_catalog_version, plan_fingerprint, source_manifest_hash
     from migration_runs
     where run_id = $1`,
    [runId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const rowContentChecksums = mapRowContentChecksums(row.row_content_checksums);

  return {
    sourceSystem: row.source_system,
    databaseIdentity: row.source_database_identity,
    tables: row.table_snapshot,
    rowCounts: row.row_counts,
    ...(rowContentChecksums ? { rowContentChecksums } : {}),
    batchSize: Number(row.batch_size),
    mappingCatalogVersion: row.mapping_catalog_version,
    planFingerprint: row.plan_fingerprint,
    sourceManifestHash: row.source_manifest_hash,
  };
}

function mapRowContentChecksums(
  value: SourceManifest["rowContentChecksums"],
): SourceManifest["rowContentChecksums"] {
  return Array.isArray(value) && value.length > 0 ? value : undefined;
}

async function selectCustomers(client: Client, publicIds: readonly string[]) {
  if (publicIds.length === 0) return [];
  const result = await client.query<{ public_id: string; phone: string | null; email: string | null }>(
    "select public_id, phone, email from customers where public_id = any($1::text[]) order by id asc",
    [publicIds],
  );
  return result.rows;
}

async function selectConversations(client: Client, publicIds: readonly string[]) {
  if (publicIds.length === 0) return [];
  const result = await client.query<{
    public_id: string;
    customer_public_id: string | null;
    integration_account_public_id: string | null;
    has_integration_account: boolean;
  }>(`
    select conversations.public_id,
           customers.public_id as customer_public_id,
           integration_accounts.public_id as integration_account_public_id,
           conversations.integration_account_id is not null as has_integration_account
    from conversations
    left join customers on customers.id = conversations.customer_id
    left join integration_accounts on integration_accounts.id = conversations.integration_account_id
    where conversations.public_id = any($1::text[])
    order by conversations.id asc
  `, [publicIds]);
  return result.rows;
}

async function selectMessages(client: Client, publicIds: readonly string[]) {
  if (publicIds.length === 0) return [];
  const result = await client.query<{
    public_id: string;
    conversation_public_id: string;
    sent_at: Date | string;
  }>(`
    select messages.public_id, conversations.public_id as conversation_public_id, messages.sent_at
    from messages
    join conversations on conversations.id = messages.conversation_id
    where messages.public_id = any($1::text[])
    order by messages.conversation_id asc, messages.sent_at asc, messages.id asc
  `, [publicIds]);

  return result.rows.map((row) => ({
    ...row,
    sent_at: row.sent_at instanceof Date ? row.sent_at.toISOString() : row.sent_at,
  }));
}

async function selectOrders(client: Client, publicIds: readonly string[]) {
  if (publicIds.length === 0) return [];
  const result = await client.query<{
    public_id: string;
    customer_public_id: string | null;
    total_amount: string;
  }>(`
    select orders.public_id, customers.public_id as customer_public_id, orders.total_amount::text as total_amount
    from orders
    left join customers on customers.id = orders.customer_id
    where orders.public_id = any($1::text[])
    order by orders.id asc
  `, [publicIds]);
  return result.rows;
}

async function selectOrderItems(client: Client, publicIds: readonly string[]) {
  if (publicIds.length === 0) return [];
  const result = await client.query<{
    public_id: string;
    order_public_id: string;
    quantity: string | number;
    unit_price: string;
    total_amount: string;
  }>(`
    select order_items.public_id,
           orders.public_id as order_public_id,
           order_items.quantity,
           order_items.unit_price::text as unit_price,
           order_items.total_amount::text as total_amount
    from order_items
    join orders on orders.id = order_items.order_id
    where order_items.public_id = any($1::text[])
    order by order_items.id asc
  `, [publicIds]);

  return result.rows.map((row) => ({
    ...row,
    quantity: typeof row.quantity === "number" ? row.quantity : Number.parseInt(row.quantity, 10),
  }));
}

async function selectShipments(client: Client, publicIds: readonly string[]) {
  if (publicIds.length === 0) return [];
  const result = await client.query<{
    public_id: string;
    order_public_id: string | null;
    customer_public_id: string | null;
  }>(`
    select shipments.public_id,
           orders.public_id as order_public_id,
           customers.public_id as customer_public_id
    from shipments
    left join orders on orders.id = shipments.order_id
    left join customers on customers.id = shipments.customer_id
    where shipments.public_id = any($1::text[])
    order by shipments.id asc
  `, [publicIds]);
  return result.rows;
}

async function selectLegacyIdMaps(client: Client, runId: string) {
  const result = await client.query<{
    run_id: string;
    source_system: string;
    source_table: string;
    source_id: string;
    target_table: string;
    mapping_role: string;
    target_id: string;
  }>(`
    select run_id, source_system, source_table, source_id, target_table, mapping_role, target_id
    from legacy_id_map
    where run_id = $1
    order by id asc
  `, [runId]);
  return result.rows;
}
