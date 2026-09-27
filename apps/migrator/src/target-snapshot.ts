import type { Client } from "pg";
import type { MigrationVerificationSnapshot } from "./verify.js";

export async function createTargetVerificationSnapshot(client: Client): Promise<MigrationVerificationSnapshot> {
  const [customers, conversations, messages, orders, orderItems, shipments, legacyIdMaps] =
    await Promise.all([
      selectCustomers(client),
      selectConversations(client),
      selectMessages(client),
      selectOrders(client),
      selectOrderItems(client),
      selectShipments(client),
      selectLegacyIdMaps(client),
    ]);

  const targetCounts = {
    customers: customers.length,
    conversations: conversations.length,
    messages: messages.length,
    orders: orders.length,
    order_items: orderItems.length,
    shipments: shipments.length,
  };

  return {
    sourceCounts: createSourceCountsFromLegacyIdMaps(legacyIdMaps),
    targetCounts,
    customers,
    conversations,
    messages,
    orders,
    orderItems,
    shipments,
    legacyIdMaps,
  };
}

function createSourceCountsFromLegacyIdMaps(
  legacyIdMaps: MigrationVerificationSnapshot["legacyIdMaps"],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of legacyIdMaps ?? []) {
    counts[entry.target_table] = (counts[entry.target_table] ?? 0) + 1;
  }
  return counts;
}

async function selectCustomers(client: Client) {
  const result = await client.query<{ public_id: string; phone: string | null; email: string | null }>(
    "select public_id, phone, email from customers order by id asc",
  );
  return result.rows;
}

async function selectConversations(client: Client) {
  const result = await client.query<{ public_id: string; customer_public_id: string | null }>(`
    select conversations.public_id, customers.public_id as customer_public_id
    from conversations
    left join customers on customers.id = conversations.customer_id
    order by conversations.id asc
  `);
  return result.rows;
}

async function selectMessages(client: Client) {
  const result = await client.query<{
    public_id: string;
    conversation_public_id: string;
    sent_at: Date | string;
  }>(`
    select messages.public_id, conversations.public_id as conversation_public_id, messages.sent_at
    from messages
    join conversations on conversations.id = messages.conversation_id
    order by messages.conversation_id asc, messages.sent_at asc, messages.id asc
  `);

  return result.rows.map((row) => ({
    ...row,
    sent_at: row.sent_at instanceof Date ? row.sent_at.toISOString() : row.sent_at,
  }));
}

async function selectOrders(client: Client) {
  const result = await client.query<{
    public_id: string;
    customer_public_id: string | null;
    total_amount: string;
  }>(`
    select orders.public_id, customers.public_id as customer_public_id, orders.total_amount::text as total_amount
    from orders
    left join customers on customers.id = orders.customer_id
    order by orders.id asc
  `);
  return result.rows;
}

async function selectOrderItems(client: Client) {
  const result = await client.query<{
    order_public_id: string;
    quantity: string | number;
    unit_price: string;
    total_amount: string;
  }>(`
    select orders.public_id as order_public_id,
           order_items.quantity,
           order_items.unit_price::text as unit_price,
           order_items.total_amount::text as total_amount
    from order_items
    join orders on orders.id = order_items.order_id
    order by order_items.id asc
  `);

  return result.rows.map((row) => ({
    ...row,
    quantity: typeof row.quantity === "number" ? row.quantity : Number.parseInt(row.quantity, 10),
  }));
}

async function selectShipments(client: Client) {
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
    order by shipments.id asc
  `);
  return result.rows;
}

async function selectLegacyIdMaps(client: Client) {
  const result = await client.query<{
    source_system: string;
    source_table: string;
    source_id: string;
    target_table: string;
    target_id: string;
  }>(`
    select source_system, source_table, source_id, target_table, target_id
    from legacy_id_map
    order by id asc
  `);
  return result.rows;
}
