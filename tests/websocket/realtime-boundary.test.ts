import { describe, expect, it } from "vitest";
import { realtimeEnvelopeSchema } from "../../packages/shared/src/index.js";

describe("websocket gate", () => {
  it("validates realtime envelopes before fanout", () => {
    expect(
      realtimeEnvelopeSchema.safeParse({
        event: "message.created",
        id: "evt_ws",
        occurred_at: new Date("2026-01-01T00:00:00.000Z").toISOString(),
        payload: { conversation_public_id: "cnv_test" },
      }).success,
    ).toBe(true);
  });
});
