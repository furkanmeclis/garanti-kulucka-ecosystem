import type { CallSnapshot } from "./engine";
import type { CallContext, ClientCallEvent } from "./types";

export function callStatus(call: CallSnapshot, talkSeconds: number): ClientCallEvent["client_status"] {
  if (call.error) return "failed";
  if (talkSeconds > 0) return "answered";
  if (call.endReason === "No Answer") return "no_answer";
  if (call.endReason === "Busy") return "busy";
  return "cancelled";
}

export function callPhaseKey(call: CallSnapshot) {
  return call.error ? "error" : call.phase;
}

export function clientCallEvent(call: CallSnapshot, context: CallContext, beganAt: number, endedAt: number): ClientCallEvent {
  const talkSeconds = call.startedAt === null ? 0 : Math.max(0, Math.floor((endedAt - call.startedAt) / 1000));
  return {
    ...context,
    direction: call.direction === "incoming" ? "inbound" : "outbound",
    phone: call.remote,
    started_at: new Date(beganAt).toISOString(),
    ended_at: new Date(endedAt).toISOString(),
    client_status: callStatus(call, talkSeconds),
    talk_seconds: talkSeconds,
  };
}
