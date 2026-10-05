import { describe, expect, it } from "vitest";
import {
  serializeConversation,
  serializeMessage,
  serializeOrder,
  serializeShipment,
  type ConversationRecord,
  type MessageRecord,
  type OrderRecord,
  type ShipmentRecord,
} from "../src/domain/repository.js";

const date = new Date("2026-01-01T00:00:00.000Z");

describe("domain serialization", () => {
  it("serializes conversation summaries for inbox views", () => {
    const conversation: ConversationRecord = {
      id: 1,
      public_id: "cnv_test",
      customer_id: 1,
      assigned_user_id: null,
      channel: "instagram",
      external_thread_id: "thread_1",
      status: "open",
      is_in_pool: true,
      human_agent_enabled: false,
      unread_count: 2,
      last_message_text: "Merhaba",
      last_message_sender_type: "customer",
      last_message_at: date,
      created_at: date,
      updated_at: date,
      customer_full_name: "Customer Name",
      customer_phone: "555",
      assigned_user_email: null,
    };

    expect(serializeConversation(conversation)).toMatchObject({
      public_id: "cnv_test",
      channel: "instagram",
      unread_count: 2,
      customer: {
        full_name: "Customer Name",
      },
    });
  });

  it("keeps provider raw payloads out of message responses", () => {
    const message: MessageRecord = {
      id: 1,
      public_id: "msg_test",
      conversation_id: 1,
      sender_type: "customer",
      sender_name: null,
      body: "hello",
      external_message_id: "external_1",
      is_read: false,
      sent_at: date,
      raw_payload: { provider_secret: "nope" },
      created_at: date,
      updated_at: date,
    };

    expect(serializeMessage(message)).not.toHaveProperty("raw_payload");
  });

  it("serializes order summaries", () => {
    const order: OrderRecord = {
      id: 1,
      public_id: "ord_test",
      customer_id: null,
      conversation_id: null,
      created_by_user_id: null,
      order_number: "ORD-1",
      status: "draft",
      source: "manual",
      total_amount: "100.00",
      currency: "TRY",
      confirmation_status: null,
      notes: null,
      external_order_id: null,
      created_at: date,
      updated_at: date,
      customer_full_name: null,
      created_by_user_public_id: "usr_test",
      created_by_user_email: "personel@example.com",
      cargo_provider: "ptt",
    };

    expect(serializeOrder(order)).toMatchObject({
      order_number: "ORD-1",
      total_amount: "100.00",
      created_by_user_email: "personel@example.com",
      cargo_provider: "ptt",
    });
  });

  it("serializes shipment summaries", () => {
    const shipment: ShipmentRecord = {
      id: 1,
      public_id: "shp_test",
      order_id: null,
      customer_id: null,
      provider: "ptt",
      tracking_number: "TRK",
      barcode_number: null,
      status: "created",
      recipient_name: "Recipient",
      recipient_phone: null,
      recipient_address: "Address",
      recipient_city: "Istanbul",
      recipient_district: null,
      last_event_text: null,
      shipped_at: null,
      delivered_at: null,
      raw_payload: null,
      created_at: date,
      updated_at: date,
      order_number: "ORD-1",
      customer_full_name: "Customer Name",
    };

    expect(serializeShipment(shipment)).toMatchObject({
      provider: "ptt",
      tracking_number: "TRK",
      order_number: "ORD-1",
    });
  });
});
