import { io, type Socket } from "socket.io-client";
import {
  parseRealtimeEnvelope,
  realtimeClientCommandSchema,
  type RealtimeEnvelope,
  type RealtimeEventName,
} from "@garanti-kulucka/shared";
import { assertBackendBaseUrl } from "./backend-boundary.js";

export interface RealtimeClientOptions {
  baseUrl: string;
  getAccessToken: () => string | null;
  socketFactory?: typeof io;
}

declare global {
  interface Window {
    __GARANTI_REALTIME_SOCKET_FACTORY__?: typeof io;
  }
}

export interface RealtimeClient {
  socket: Socket;
  connect: () => void;
  disconnect: () => void;
  on: (event: RealtimeEventName, handler: (envelope: RealtimeEnvelope) => void) => () => void;
  joinConversation: (conversationPublicId: string) => void;
  leaveConversation: (conversationPublicId: string) => void;
}

export function createRealtimeClient(options: RealtimeClientOptions): RealtimeClient {
  assertBackendBaseUrl(options.baseUrl);
  const socketFactory =
    options.socketFactory ??
    (typeof window !== "undefined" ? window.__GARANTI_REALTIME_SOCKET_FACTORY__ : undefined) ??
    io;
  const socket = socketFactory(options.baseUrl, {
    autoConnect: false,
    auth: () => ({
      token: options.getAccessToken(),
    }),
  });

  return {
    socket,
    connect: () => socket.connect(),
    disconnect: () => socket.disconnect(),
    on: (event, handler) => {
      const listener = (input: unknown) => handler(parseRealtimeEnvelope(input));
      socket.on(event, listener);
      return () => socket.off(event, listener);
    },
    joinConversation: (conversationPublicId) => {
      const command = realtimeClientCommandSchema.parse({
        command: "conversation.join",
        conversation_public_id: conversationPublicId,
      });
      socket.emit(command.command, command.conversation_public_id);
    },
    leaveConversation: (conversationPublicId) => {
      const command = realtimeClientCommandSchema.parse({
        command: "conversation.leave",
        conversation_public_id: conversationPublicId,
      });
      socket.emit(command.command, command.conversation_public_id);
    },
  };
}
