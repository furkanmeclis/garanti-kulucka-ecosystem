import type { AppDatabase } from "@garanti-kulucka/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const realtimeAuthMocks = vi.hoisted(() => {
  const state = {
    user: {
      id: 10,
      public_id: "usr_socket",
      role_name: "admin",
    },
    session: {
      id: 20,
      public_id: "ses_socket",
      user_id: 10,
    },
  };

  const repository = {
    findUserByPublicId: vi.fn(async (publicId: string) =>
      publicId === state.user.public_id ? state.user : null,
    ),
    findSessionByPublicId: vi.fn(async (publicId: string) =>
      publicId === state.session.public_id ? state.session : null,
    ),
  };

  return { state, repository };
});

vi.mock("../src/auth/repository.js", () => ({
  AuthRepository: vi.fn(function AuthRepository() {
    return realtimeAuthMocks.repository;
  }),
}));

const {
  authenticateRealtimeToken,
  disconnectStaleRealtimeSessions,
  handleRealtimeConnection,
} = await import("../src/realtime.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "realtime-auth-test-secret",
  encryptionKey: "realtime-auth-encryption-key",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

async function validToken() {
  return signAccessToken(
    {
      user_public_id: "usr_socket",
      session_public_id: "ses_socket",
      role: "admin",
    },
    config,
  );
}

describe("realtime auth boundary", () => {
  beforeEach(() => {
    realtimeAuthMocks.state.user = {
      id: 10,
      public_id: "usr_socket",
      role_name: "admin",
    };
    realtimeAuthMocks.state.session = {
      id: 20,
      public_id: "ses_socket",
      user_id: 10,
    };
    vi.clearAllMocks();
  });

  it("rejects missing, invalid, and expired Socket.IO tokens", async () => {
    await expect(authenticateRealtimeToken(null, config, {} as AppDatabase)).rejects.toThrow("unauthorized");
    await expect(authenticateRealtimeToken("not-a-jwt", config, {} as AppDatabase)).rejects.toThrow();

    const expired = await signAccessToken(
      {
        user_public_id: "usr_socket",
        session_public_id: "ses_socket",
        role: "admin",
      },
      { ...config, accessTokenTtlSeconds: -1 },
    );
    await expect(authenticateRealtimeToken(expired, config, {} as AppDatabase)).rejects.toThrow();
  });

  it("rejects valid JWTs when the backing user or session is stale", async () => {
    const token = await validToken();
    realtimeAuthMocks.state.session = {
      id: 20,
      public_id: "ses_socket",
      user_id: 999,
    };

    await expect(authenticateRealtimeToken(token, config, {} as AppDatabase)).rejects.toThrow("unauthorized");
  });

  it("keeps conversation room membership commands stable across reconnects", () => {
    const firstSocket = fakeSocket("sock_before_restart");
    handleRealtimeConnection(firstSocket);
    firstSocket.listeners.get("conversation.join")?.("cnv_socket");

    const reconnectedSocket = fakeSocket("sock_after_restart");
    handleRealtimeConnection(reconnectedSocket);
    reconnectedSocket.listeners.get("conversation.join")?.("cnv_socket");

    expect(firstSocket.joined).toContain("user:usr_socket");
    expect(firstSocket.joined).toContain("conversation:cnv_socket");
    expect(reconnectedSocket.joined).toContain("user:usr_socket");
    expect(reconnectedSocket.joined).toContain("conversation:cnv_socket");
  });

  it("disconnects sockets whose session has been revoked after connection", async () => {
    const staleSocket = {
      data: {
        user_public_id: "usr_socket",
        session_public_id: "ses_socket",
      },
      disconnect: vi.fn(),
    };
    realtimeAuthMocks.state.session = {
      id: 20,
      public_id: "ses_socket",
      user_id: 999,
    };

    const disconnected = await disconnectStaleRealtimeSessions(
      {
        sockets: {
          sockets: new Map([["sock_stale", staleSocket]]),
        },
      } as never,
      {} as AppDatabase,
    );

    expect(disconnected).toBe(1);
    expect(staleSocket.disconnect).toHaveBeenCalledWith(true);
  });
});

function fakeSocket(id: string) {
  return {
    id,
    data: { user_public_id: "usr_socket" },
    joined: [] as string[],
    left: [] as string[],
    emitted: [] as Array<{ event: string; payload: unknown }>,
    listeners: new Map<string, (conversationPublicId: string) => void>(),
    join(room: string) {
      this.joined.push(room);
    },
    leave(room: string) {
      this.left.push(room);
    },
    emit(event: string, payload: unknown) {
      this.emitted.push({ event, payload });
    },
    on(event: string, listener: (conversationPublicId: string) => void) {
      this.listeners.set(event, listener);
    },
  };
}
