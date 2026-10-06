import { describe, expect, it } from "vitest";
import type { RealtimeEnvelope } from "@garanti-kulucka/shared";
import {
  notificationFromEnvelope,
  notificationLimit,
  notificationsReducer,
  unreadBadgeLabel,
  unreadNotificationCount,
  type AppNotification,
} from "../src/ui/app/notifications.js";

function envelope(event: RealtimeEnvelope["event"], payload: Record<string, unknown>, id = `evt_${event}`): RealtimeEnvelope {
  return { event, id, occurred_at: "2026-10-06T10:00:00.000Z", payload };
}

function messageNotification(id: string): AppNotification {
  return { id, kind: "message", occurredAt: "2026-10-06T10:00:00.000Z", read: false, conversationPublicId: "cnv_one" };
}

describe("header notifications", () => {
  it("maps inbound messages and shipment updates, ignoring outgoing messages and other events", () => {
    expect(notificationFromEnvelope(envelope("message.created", { message_public_id: "msg_a", conversation_public_id: "cnv_a", sender_type: "customer" }))).toMatchObject({
      kind: "message",
      conversationPublicId: "cnv_a",
      read: false,
    });
    expect(notificationFromEnvelope(envelope("message.created", { message_public_id: "msg_b", conversation_public_id: "cnv_a", sender_type: "user" }))).toBeNull();
    expect(notificationFromEnvelope(envelope("message.created", { message_public_id: "msg_c", conversation_public_id: "cnv_a", sender_type: "ai" }))).toBeNull();
    expect(notificationFromEnvelope(envelope("shipment.updated", { shipment_public_id: "shp_a", status: "delivered", tracking_number: null }))).toMatchObject({
      kind: "shipment",
      shipmentPublicId: "shp_a",
      status: "delivered",
      trackingNumber: null,
    });
    expect(notificationFromEnvelope(envelope("conversation.updated", { conversation_public_id: "cnv_a" }))).toBeNull();
  });

  it("dedupes by event id, keeps newest first and caps at the legacy limit", () => {
    let state: AppNotification[] = [];
    state = notificationsReducer(state, { type: "add", notification: messageNotification("evt_1") });
    state = notificationsReducer(state, { type: "add", notification: messageNotification("evt_1") });
    expect(state).toHaveLength(1);
    for (let index = 2; index <= notificationLimit + 5; index += 1) {
      state = notificationsReducer(state, { type: "add", notification: messageNotification(`evt_${index}`) });
    }
    expect(state).toHaveLength(notificationLimit);
    expect(state[0]?.id).toBe(`evt_${notificationLimit + 5}`);
  });

  it("tracks unread state and renders the legacy 9+ badge", () => {
    let state = [messageNotification("evt_1"), messageNotification("evt_2")];
    expect(unreadNotificationCount(state)).toBe(2);
    state = notificationsReducer(state, { type: "markRead", id: "evt_1" });
    expect(unreadNotificationCount(state)).toBe(1);
    const allRead = notificationsReducer(state, { type: "markAllRead" });
    expect(unreadNotificationCount(allRead)).toBe(0);
    expect(notificationsReducer(allRead, { type: "markAllRead" })).toBe(allRead);
    expect(notificationsReducer(allRead, { type: "clear" })).toEqual([]);
    expect(unreadBadgeLabel(9)).toBe("9");
    expect(unreadBadgeLabel(10)).toBe("9+");
  });
});
