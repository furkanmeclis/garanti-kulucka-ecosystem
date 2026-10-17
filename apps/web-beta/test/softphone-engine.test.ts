import { beforeEach, expect, it, vi } from "vitest";
import type { CallSnapshot } from "../src/softphone/engine";

const fake = vi.hoisted(() => {
  const listeners = new Map<string, (...args: never[]) => void>();
  const uaListeners = new Map<string, (...args: never[]) => void>();
  const session = { remote_identity: { uri: { user: "555" }, display_name: "Caller" }, connection: null, on: vi.fn((event, callback) => listeners.set(event, callback)), isEnded: vi.fn(() => false), terminate: vi.fn(), answer: vi.fn(), hold: vi.fn(), unhold: vi.fn(), mute: vi.fn(), unmute: vi.fn(), sendDTMF: vi.fn() };
  return { listeners, uaListeners, session, start: vi.fn(), stop: vi.fn(), call: vi.fn(() => session) };
});
vi.mock("jssip", () => ({ default: {
  WebSocketInterface: class {},
  UA: class {
    on = (event: string, callback: (...args: never[]) => void) => fake.uaListeners.set(event, callback);
    call = fake.call;
    start = fake.start;
    stop = fake.stop;
  },
} }));
import { createJsSipEngine } from "../src/softphone/jssip-engine";

beforeEach(() => { vi.clearAllMocks(); fake.listeners.clear(); fake.uaListeners.clear(); });
function setup() {
  const calls: CallSnapshot[] = [];
  const registration = vi.fn();
  const engine = createJsSipEngine({ websocketUrl: "wss://invalid", domain: "invalid", username: "1", password: "test", iceServers: [] }, {
    onCall: (call) => { if (call) calls.push(call); }, onRegistration: registration, onRemoteStream: vi.fn(),
  });
  const emit = (event: string, value: unknown = {}) => fake.listeners.get(event)?.(value as never);
  return { engine, calls, registration, emit };
}
it("registers and follows connecting → ringing → active → ended without a SIP connection", () => {
  const { engine, calls, registration, emit } = setup();
  engine.start();
  fake.uaListeners.get("registered")?.();
  expect(registration).toHaveBeenCalledWith("registered");
  engine.call("555");
  emit("progress");
  emit("confirmed");
  expect(calls.at(-1)?.startedAt).toEqual(expect.any(Number));
  engine.setHold?.(true);
  engine.setMuted(true);
  engine.sendDtmf("5");
  expect(fake.session.hold).toHaveBeenCalled();
  expect(fake.session.mute).toHaveBeenCalledWith({ audio: true });
  expect(fake.session.sendDTMF).toHaveBeenCalledWith("5");
  emit("ended", { cause: "BYE" });
  expect(calls.map((call) => call.phase)).toEqual(["connecting", "ringing", "active", "ended"]);
});
it.each([["Busy", false], ["No Answer", false], ["Canceled", false], ["WebRTC Error", true]] as const)("classifies %s at the engine boundary", (cause, error) => {
  const { engine, calls, emit } = setup();
  engine.call("555");
  emit("failed", { cause });
  expect(calls.at(-1)).toMatchObject({ phase: "ended", endReason: cause, error });
});
it("answers incoming calls and rejects a second concurrent caller", () => {
  const { engine, calls } = setup();
  fake.uaListeners.get("newRTCSession")?.({ originator: "remote", session: fake.session } as never);
  expect(calls.at(-1)).toMatchObject({ direction: "incoming", phase: "ringing", remote: "555" });
  engine.answer();
  expect(fake.session.answer).toHaveBeenCalled();
  const second = { terminate: vi.fn() };
  fake.uaListeners.get("newRTCSession")?.({ originator: "remote", session: second } as never);
  expect(second.terminate).toHaveBeenCalledWith({ status_code: 486, reason_phrase: "Busy Here" });
  engine.stop();
  expect(fake.session.terminate).toHaveBeenCalled();
});
