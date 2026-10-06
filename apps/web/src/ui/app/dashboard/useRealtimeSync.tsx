import { useEffect, useState, type MutableRefObject } from "react";
import type { RealtimeEnvelope } from "@garanti-kulucka/shared";
import { createRealtimeClient, type RealtimeClient } from "../../../api/realtime-client.js";
import { uiMessage } from "../../i18n/messages/status.js";
import { backendBaseUrl, readStoredToken } from "../shared.js";
import type { DashboardCore } from "./types.js";

interface RealtimeSyncOptions {
  token: string | null;
  authChecked: boolean;
  user: DashboardCore["user"];
  setStatus: DashboardCore["setStatus"];
  pushNotification: (envelope: RealtimeEnvelope) => void;
  refreshConversations: () => Promise<void>;
  refreshMessages: (conversationPublicId: string) => Promise<void>;
  refreshShipments: () => Promise<unknown>;
  selectedConversationId: string | null;
  selectedConversationIdRef: MutableRefObject<string | null>;
}

/** Socket.IO session: refreshes conversations/messages/shipments on events and joins the open conversation room. */
export function useRealtimeSync(options: RealtimeSyncOptions) {
  const { token, authChecked, user, setStatus, pushNotification, refreshConversations, refreshMessages, refreshShipments, selectedConversationId, selectedConversationIdRef } = options;
  const [realtimeClient, setRealtimeClient] = useState<RealtimeClient | null>(null);

  useEffect(() => {
    if (!token || !authChecked || !user) {
      setRealtimeClient(null);
      return;
    }

    const realtime = createRealtimeClient({
      baseUrl: backendBaseUrl,
      getAccessToken: () => readStoredToken(),
    });
    const offMessageCreated = realtime.on("message.created", (envelope) => {
      pushNotification(envelope);
      const conversationPublicId = String(envelope.payload.conversation_public_id ?? "");
      if (!conversationPublicId) return;

      void (async () => {
        await refreshConversations();
        if (selectedConversationIdRef.current === conversationPublicId) {
          await refreshMessages(conversationPublicId);
          setStatus(uiMessage("realtimeNewMessage"));
        } else {
          setStatus(uiMessage("realtimeNewConversation"));
        }
      })();
    });
    const offConversationUpdated = realtime.on("conversation.updated", (envelope) => {
      const conversationPublicId = String(envelope.payload.conversation_public_id ?? "");
      if (!conversationPublicId) return;

      void (async () => {
        await refreshConversations();
        if (selectedConversationIdRef.current === conversationPublicId) {
          setStatus(uiMessage("realtimeConversationUpdated"));
        }
      })();
    });
    const offShipmentUpdated = realtime.on("shipment.updated", (envelope) => {
      pushNotification(envelope);
      void (async () => {
        await refreshShipments();
        setStatus(uiMessage("realtimeShipmentUpdated"));
      })();
    });

    realtime.connect();
    setRealtimeClient(realtime);

    return () => {
      offMessageCreated();
      offConversationUpdated();
      offShipmentUpdated();
      realtime.disconnect();
      setRealtimeClient((current) => (current === realtime ? null : current));
    };
  }, [authChecked, pushNotification, refreshConversations, refreshMessages, refreshShipments, token, user]);

  useEffect(() => {
    if (!realtimeClient || !selectedConversationId) return;

    realtimeClient.joinConversation(selectedConversationId);
    return () => realtimeClient.leaveConversation(selectedConversationId);
  }, [realtimeClient, selectedConversationId]);

  return { realtimeClient, setRealtimeClient };
}
