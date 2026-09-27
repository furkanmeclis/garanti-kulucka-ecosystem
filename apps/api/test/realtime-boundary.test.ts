import { describe, expect, it } from "vitest";
import {
  parseRealtimeEnvelope,
  realtimeConversationRoom,
  realtimeUserRoom,
  type RealtimeEnvelope,
} from "@garanti-kulucka/shared";
import { createRealtimePublisher } from "../src/realtime.js";

const envelope: RealtimeEnvelope = {
  event: "message.created",
  id: "evt_test",
  occurred_at: "2026-01-01T00:00:00.000Z",
  payload: {
    message_public_id: "msg_test",
    conversation_public_id: "cnv_test",
    sender_type: "customer",
  },
};

describe("realtime boundary", () => {
  it("validates event payloads by event name", () => {
    expect(parseRealtimeEnvelope(envelope)).toEqual(envelope);
    expect(() =>
      parseRealtimeEnvelope({
        ...envelope,
        payload: {
          conversation_public_id: "cnv_test",
        },
      }),
    ).toThrow(/Invalid payload/);
  });

  it("creates canonical room names", () => {
    expect(realtimeUserRoom("usr_test")).toBe("user:usr_test");
    expect(realtimeConversationRoom("cnv_test")).toBe("conversation:cnv_test");
    expect(() => realtimeUserRoom("legacy id")).toThrow();
  });

  it("publishes validated envelopes to the requested room", () => {
    const emitted: Array<{ room: string; event: string; payload: unknown }> = [];
    const io = {
      emit: (event: string, payload: unknown) => {
        emitted.push({ room: "broadcast", event, payload });
      },
      to: (room: string) => ({
        emit: (event: string, payload: unknown) => {
          emitted.push({ room, event, payload });
        },
      }),
    };

    createRealtimePublisher(io).publishToConversation("cnv_test", envelope);

    expect(emitted).toEqual([
      {
        room: "conversation:cnv_test",
        event: "message.created",
        payload: envelope,
      },
    ]);
  });
});
