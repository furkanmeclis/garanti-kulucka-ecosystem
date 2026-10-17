import { describe, expect, it } from "vitest";
import { engineConfigFrom, sipTarget, type CallSnapshot } from "../src/softphone/engine";
import { callPhaseKey, callStatus, clientCallEvent } from "../src/softphone/state";

const call: CallSnapshot = { id: "1", direction: "outgoing", remote: "05551234567", remoteName: null, phase: "ended", held: false, muted: false, startedAt: null, endReason: null };

describe("beta softphone", () => {
  it.each([
    [{ error: true }, 10, "failed"],
    [{ endReason: "Busy" }, 3, "answered"],
    [{ endReason: "No Answer" }, 0, "no_answer"],
    [{ endReason: "Busy" }, 0, "busy"],
    [{ endReason: "Canceled" }, 0, "cancelled"],
    [{}, 0, "cancelled"],
  ] as const)("maps end status with legacy precedence: %j", (patch, seconds, expected) => {
    expect(callStatus({ ...call, ...patch }, seconds)).toBe(expected);
  });
  it.each(["connecting", "ringing", "active", "ended"] as const)("preserves call phase %s", (phase) => {
    expect(callPhaseKey({ ...call, phase })).toBe(phase);
  });
  it("exposes an error phase", () => expect(callPhaseKey({ ...call, error: true })).toBe("error"));
  it("builds contextual inbound/outbound events with floored talk time", () => {
    const event = clientCallEvent({ ...call, startedAt: 2000 }, { order_public_id: "ord_1", customer_public_id: "cus_1" }, 1000, 4500);
    expect(event).toEqual({ direction: "outbound", phone: call.remote, order_public_id: "ord_1", customer_public_id: "cus_1", started_at: new Date(1000).toISOString(), ended_at: new Date(4500).toISOString(), client_status: "answered", talk_seconds: 2 });
    expect(clientCallEvent({ ...call, direction: "incoming" }, {}, 1000, 2000)).toMatchObject({ direction: "inbound", talk_seconds: 0 });
  });
  it("requires a complete enabled SIP account and filters ICE config", () => {
    expect(engineConfigFrom(null)).toBeNull();
    const config = { enabled: true, sip_websocket_url: "wss://invalid/ws", sip_domain: "invalid", sip_username: "100", sip_password: "secret", ice_servers: [null, { urls: "stun:invalid" }] };
    expect(engineConfigFrom({ ...config, sip_username: null })).toBeNull();
    expect(engineConfigFrom({ ...config, enabled: false })).toBeNull();
    expect(engineConfigFrom(config)?.iceServers).toEqual([{ urls: "stun:invalid" }]);
    expect(sipTarget("+90 (555) 123", "invalid")).toBe("sip:+90555123@invalid");
    expect(sipTarget(" ", "invalid")).toBeNull();
  });
});
