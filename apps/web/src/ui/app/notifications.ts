import { useCallback, useEffect, useReducer } from "react";
import type { RealtimeEnvelope } from "@garanti-kulucka/shared";

/**
 * Legacy `uiStore.bildirimler`: client-side, session-only notification list fed by realtime events
 * (max 50, newest first, `okundu` flag). There is no backend notification store.
 */
export const notificationLimit = 50;

export type AppNotification =
  | {
      id: string;
      kind: "message";
      occurredAt: string;
      read: boolean;
      conversationPublicId: string;
    }
  | {
      id: string;
      kind: "shipment";
      occurredAt: string;
      read: boolean;
      shipmentPublicId: string;
      status: string;
      trackingNumber: string | null;
    };

type NotificationAction =
  | { type: "add"; notification: AppNotification }
  | { type: "markRead"; id: string }
  | { type: "markAllRead" }
  | { type: "clear" };

export function notificationsReducer(state: AppNotification[], action: NotificationAction): AppNotification[] {
  switch (action.type) {
    case "add":
      // message.created reaches the client from both the conversation room and the broadcast room.
      if (state.some((item) => item.id === action.notification.id)) return state;
      return [action.notification, ...state].slice(0, notificationLimit);
    case "markRead":
      return state.map((item) => (item.id === action.id && !item.read ? { ...item, read: true } : item));
    case "markAllRead":
      return state.some((item) => !item.read) ? state.map((item) => (item.read ? item : { ...item, read: true })) : state;
    case "clear":
      return state.length === 0 ? state : [];
  }
}

/** Maps a realtime envelope to a notification; outgoing (user/ai) messages and other events are ignored. */
export function notificationFromEnvelope(envelope: RealtimeEnvelope): AppNotification | null {
  const payload = envelope.payload;
  if (envelope.event === "message.created") {
    const senderType = String(payload.sender_type ?? "");
    const conversationPublicId = String(payload.conversation_public_id ?? "");
    if (!conversationPublicId || senderType === "user" || senderType === "ai") return null;
    return { id: envelope.id, kind: "message", occurredAt: envelope.occurred_at, read: false, conversationPublicId };
  }
  if (envelope.event === "shipment.updated") {
    const shipmentPublicId = String(payload.shipment_public_id ?? "");
    if (!shipmentPublicId) return null;
    return {
      id: envelope.id,
      kind: "shipment",
      occurredAt: envelope.occurred_at,
      read: false,
      shipmentPublicId,
      status: String(payload.status ?? ""),
      trackingNumber: typeof payload.tracking_number === "string" ? payload.tracking_number : null,
    };
  }
  return null;
}

export function unreadNotificationCount(notifications: AppNotification[]) {
  return notifications.filter((item) => !item.read).length;
}

/** Legacy badge: `okunmamisSayisi > 9 ? "9+" : okunmamisSayisi`. */
export function unreadBadgeLabel(count: number) {
  return count > 9 ? "9+" : String(count);
}

/** Session-scoped notification state; cleared whenever `sessionKey` changes (login/logout/user switch). */
export function useNotifications(sessionKey: string | null) {
  const [items, dispatch] = useReducer(notificationsReducer, []);

  useEffect(() => {
    dispatch({ type: "clear" });
  }, [sessionKey]);

  const pushEnvelope = useCallback((envelope: RealtimeEnvelope) => {
    const notification = notificationFromEnvelope(envelope);
    if (notification) dispatch({ type: "add", notification });
  }, []);
  const markRead = useCallback((id: string) => dispatch({ type: "markRead", id }), []);
  const markAllRead = useCallback(() => dispatch({ type: "markAllRead" }), []);

  return { items, unreadCount: unreadNotificationCount(items), pushEnvelope, markRead, markAllRead };
}

export type NotificationsState = ReturnType<typeof useNotifications>;
