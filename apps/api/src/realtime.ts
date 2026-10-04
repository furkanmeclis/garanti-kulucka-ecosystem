import type { ServerType } from "@hono/node-server";
import { createAdapter } from "@socket.io/redis-streams-adapter";
import {
  parseRealtimeEnvelope,
  realtimeConversationRoom,
  realtimeUserRoom,
  type RealtimeEnvelope,
  type RealtimeRoom,
} from "@garanti-kulucka/shared";
import { createClient, type RedisClientType } from "redis";
import { Server } from "socket.io";
import type { ApiConfig } from "./config.js";
import { verifyAccessToken } from "./auth/tokens.js";

export interface RealtimePublisher {
  publish: (room: RealtimeRoom, envelope: RealtimeEnvelope) => void;
  publishToUser: (userPublicId: string, envelope: RealtimeEnvelope) => void;
  publishToConversation: (conversationPublicId: string, envelope: RealtimeEnvelope) => void;
  broadcast: (envelope: RealtimeEnvelope) => void;
}

export const noopRealtimePublisher: RealtimePublisher = {
  publish: () => undefined,
  publishToUser: () => undefined,
  publishToConversation: () => undefined,
  broadcast: () => undefined,
};

export interface RealtimeHandle {
  io: Server;
  publisher: RealtimePublisher;
  close: () => Promise<void>;
}

export function createRealtimePublisher(io: Pick<Server, "emit" | "to">): RealtimePublisher {
  const emitEnvelope = (room: RealtimeRoom, envelope: RealtimeEnvelope) => {
    const parsed = parseRealtimeEnvelope(envelope);
    if (room === "broadcast") {
      io.emit(parsed.event, parsed);
      return;
    }

    io.to(room).emit(parsed.event, parsed);
  };

  return {
    publish: emitEnvelope,
    publishToUser: (userPublicId, envelope) => {
      emitEnvelope(realtimeUserRoom(userPublicId), envelope);
    },
    publishToConversation: (conversationPublicId, envelope) => {
      emitEnvelope(realtimeConversationRoom(conversationPublicId), envelope);
    },
    broadcast: (envelope) => {
      emitEnvelope("broadcast", envelope);
    },
  };
}

export async function attachRealtime(server: ServerType, config: ApiConfig): Promise<RealtimeHandle> {
  const ioOptions = config.corsOrigin
    ? {
        cors: {
          origin: config.corsOrigin,
          credentials: true,
        },
      }
    : {};

  const io = new Server(server, ioOptions);

  let redisClient: RedisClientType | null = null;
  if (config.redisUrl) {
    redisClient = createClient({ url: config.redisUrl });
    await redisClient.connect();
    io.adapter(createAdapter(redisClient));
  }

  io.use(async (socket, next) => {
    const token =
      typeof socket.handshake.auth.token === "string"
        ? socket.handshake.auth.token
        : socket.handshake.headers.authorization?.startsWith("Bearer ")
          ? socket.handshake.headers.authorization.slice("Bearer ".length)
          : null;

    if (!token) {
      next(new Error("unauthorized"));
      return;
    }

    try {
      const claims = await verifyAccessToken(token, config);
      socket.data.user_public_id = claims.user_public_id;
      socket.data.session_public_id = claims.session_public_id;
      socket.data.role = claims.role;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const userRoom = realtimeUserRoom(socket.data.user_public_id);
    socket.join(userRoom);
    socket.emit("presence.updated", {
      event: "presence.updated",
      id: socket.id,
      occurred_at: new Date().toISOString(),
      payload: {
        user_public_id: socket.data.user_public_id,
        status: "online",
      },
    });

    socket.on("conversation.join", (conversationPublicId: string) => {
      if (typeof conversationPublicId === "string" && conversationPublicId.length > 0) {
        socket.join(realtimeConversationRoom(conversationPublicId));
      }
    });

    socket.on("conversation.leave", (conversationPublicId: string) => {
      if (typeof conversationPublicId === "string" && conversationPublicId.length > 0) {
        socket.leave(realtimeConversationRoom(conversationPublicId));
      }
    });
  });

  return {
    io,
    publisher: createRealtimePublisher(io),
    close: async () => {
      await io.close();
      if (redisClient) {
        await redisClient.quit();
      }
    },
  };
}
