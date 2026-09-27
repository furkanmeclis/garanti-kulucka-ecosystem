import { createVerificationReport } from "./reports.js";
import type { VerificationCheck, VerificationReport } from "./types.js";

export interface MigrationVerificationSnapshot {
  readonly sourceCounts: Record<string, number>;
  readonly targetCounts: Record<string, number>;
  readonly customers: VerificationCustomer[];
  readonly conversations: VerificationConversation[];
  readonly messages: VerificationMessage[];
  readonly orders: VerificationOrder[];
  readonly orderItems: VerificationOrderItem[];
  readonly shipments: VerificationShipment[];
  readonly now?: Date;
}

export interface VerificationCustomer {
  readonly public_id: string;
  readonly phone: string | null;
  readonly email: string | null;
}

export interface VerificationConversation {
  readonly public_id: string;
  readonly customer_public_id: string | null;
}

export interface VerificationMessage {
  readonly public_id: string;
  readonly conversation_public_id: string;
  readonly sent_at: string;
}

export interface VerificationOrder {
  readonly public_id: string;
  readonly customer_public_id: string | null;
  readonly total_amount: string;
}

export interface VerificationOrderItem {
  readonly order_public_id: string;
  readonly quantity: number;
  readonly unit_price: string;
  readonly total_amount: string;
}

export interface VerificationShipment {
  readonly public_id: string;
  readonly order_public_id: string | null;
  readonly customer_public_id: string | null;
}

export function createMigrationVerificationReport(
  snapshot: MigrationVerificationSnapshot,
): VerificationReport {
  return createVerificationReport({
    checks: [
      ...verifyRowCounts(snapshot.sourceCounts, snapshot.targetCounts),
      verifyConversationCustomers(snapshot),
      verifyOrderCustomers(snapshot),
      verifyShipmentReferences(snapshot),
      verifyDuplicateCustomers(snapshot.customers),
      verifyMessageOrdering(snapshot.messages),
      verifyOrderTotals(snapshot.orders, snapshot.orderItems),
    ],
    ...(snapshot.now ? { now: snapshot.now } : {}),
  });
}

export function verifyRowCounts(
  sourceCounts: Record<string, number>,
  targetCounts: Record<string, number>,
): VerificationCheck[] {
  return Object.entries(sourceCounts).map(([entity, expected]) => {
    const actual = targetCounts[entity] ?? 0;
    return {
      name: `row_count.${entity}`,
      status: actual === expected ? "passed" : "failed",
      expected,
      actual,
      ...(actual === expected ? {} : { message: `Expected ${expected} ${entity} rows, found ${actual}` }),
    };
  });
}

export function verifyConversationCustomers(snapshot: MigrationVerificationSnapshot): VerificationCheck {
  const customerIds = new Set(snapshot.customers.map((customer) => customer.public_id));
  const orphanCount = snapshot.conversations.filter(
    (conversation) =>
      conversation.customer_public_id !== null && !customerIds.has(conversation.customer_public_id),
  ).length;

  return countCheck("referential_integrity.conversations.customer", 0, orphanCount);
}

export function verifyOrderCustomers(snapshot: MigrationVerificationSnapshot): VerificationCheck {
  const customerIds = new Set(snapshot.customers.map((customer) => customer.public_id));
  const orphanCount = snapshot.orders.filter(
    (order) => order.customer_public_id !== null && !customerIds.has(order.customer_public_id),
  ).length;

  return countCheck("referential_integrity.orders.customer", 0, orphanCount);
}

export function verifyShipmentReferences(snapshot: MigrationVerificationSnapshot): VerificationCheck {
  const customerIds = new Set(snapshot.customers.map((customer) => customer.public_id));
  const orderIds = new Set(snapshot.orders.map((order) => order.public_id));
  const orphanCount = snapshot.shipments.filter((shipment) => {
    const missingOrder = shipment.order_public_id !== null && !orderIds.has(shipment.order_public_id);
    const missingCustomer =
      shipment.customer_public_id !== null && !customerIds.has(shipment.customer_public_id);
    return missingOrder || missingCustomer;
  }).length;

  return countCheck("referential_integrity.shipments", 0, orphanCount);
}

export function verifyDuplicateCustomers(customers: VerificationCustomer[]): VerificationCheck {
  const seen = new Set<string>();
  let duplicateCount = 0;

  for (const customer of customers) {
    const identity = customer.email?.toLowerCase() ?? customer.phone ?? customer.public_id;
    if (seen.has(identity)) {
      duplicateCount += 1;
    }
    seen.add(identity);
  }

  return countCheck("duplicates.customers", 0, duplicateCount);
}

export function verifyMessageOrdering(messages: VerificationMessage[]): VerificationCheck {
  const byConversation = new Map<string, VerificationMessage[]>();
  for (const message of messages) {
    byConversation.set(message.conversation_public_id, [
      ...(byConversation.get(message.conversation_public_id) ?? []),
      message,
    ]);
  }

  let outOfOrderCount = 0;
  for (const conversationMessages of byConversation.values()) {
    for (let index = 1; index < conversationMessages.length; index += 1) {
      const previous = Date.parse(conversationMessages[index - 1]?.sent_at ?? "");
      const current = Date.parse(conversationMessages[index]?.sent_at ?? "");
      if (Number.isNaN(previous) || Number.isNaN(current) || current < previous) {
        outOfOrderCount += 1;
      }
    }
  }

  return countCheck("ordering.messages", 0, outOfOrderCount);
}

export function verifyOrderTotals(
  orders: VerificationOrder[],
  items: VerificationOrderItem[],
): VerificationCheck {
  let mismatchCount = 0;

  for (const order of orders) {
    const itemTotal = items
      .filter((item) => item.order_public_id === order.public_id)
      .reduce((sum, item) => sum + moneyToCents(item.total_amount), 0);
    if (moneyToCents(order.total_amount) !== itemTotal) {
      mismatchCount += 1;
    }
  }

  return countCheck("totals.orders", 0, mismatchCount);
}

function countCheck(name: string, expected: number, actual: number): VerificationCheck {
  return {
    name,
    status: actual === expected ? "passed" : "failed",
    expected,
    actual,
    ...(actual === expected ? {} : { message: `${name} expected ${expected}, found ${actual}` }),
  };
}

function moneyToCents(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return Number.NaN;
  }

  return Math.round(parsed * 100);
}
