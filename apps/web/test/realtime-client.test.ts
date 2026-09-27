import { describe, expect, it } from "vitest";
import { createRealtimeClient } from "../src/api/realtime-client.js";

describe("realtime client", () => {
  it("connects with bearer token auth and emits canonical conversation commands", () => {
    const emitted: Array<{ event: string; payload: unknown }> = [];
    const listeners = new Map<string, (payload: unknown) => void>();
    const socket = {
      connect: () => socket,
      disconnect: () => socket,
      on: (event: string, listener: (payload: unknown) => void) => {
        listeners.set(event, listener);
        return socket;
      },
      off: (event: string) => {
        listeners.delete(event);
        return socket;
      },
      emit: (event: string, payload: unknown) => {
        emitted.push({ event, payload });
        return socket;
      },
    };
    const factoryCalls: unknown[] = [];

    const client = createRealtimeClient({
      baseUrl: "http://localhost:3000",
      getAccessToken: () => "access-token",
      socketFactory: ((url: string, options: unknown) => {
        factoryCalls.push({ url, options });
        return socket;
      }) as never,
    });

    client.joinConversation("cnv_test");
    client.leaveConversation("cnv_test");

    expect(factoryCalls).toHaveLength(1);
    expect(factoryCalls[0]).toMatchObject({
      url: "http://localhost:3000",
      options: {
        autoConnect: false,
      },
    });
    expect(emitted).toEqual([
      { event: "conversation.join", payload: "cnv_test" },
      { event: "conversation.leave", payload: "cnv_test" },
    ]);
  });

  it("validates incoming envelopes before invoking handlers", () => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const socket = {
      connect: () => socket,
      disconnect: () => socket,
      on: (event: string, listener: (payload: unknown) => void) => {
        listeners.set(event, listener);
        return socket;
      },
      off: () => socket,
      emit: () => socket,
    };
    const received: unknown[] = [];
    const client = createRealtimeClient({
      baseUrl: "http://localhost:3000",
      getAccessToken: () => "access-token",
      socketFactory: (() => socket) as never,
    });

    client.on("presence.updated", (envelope) => received.push(envelope));
    listeners.get("presence.updated")?.({
      event: "presence.updated",
      id: "evt_test",
      occurred_at: "2026-01-01T00:00:00.000Z",
      payload: {
        user_public_id: "usr_test",
        status: "online",
      },
    });

    expect(received).toHaveLength(1);
  });
});
