import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { engineConfigFrom, sipTarget, type CallSnapshot } from "../src/ui/softphone/engine.js";

const jssip = vi.hoisted(() => ({ instances: [] as unknown[] }));

vi.mock("jssip", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  class FakeSession extends Emitter {
    ended = false;
    remote_identity: { uri: { user: string }; display_name: string };
    connection = undefined;
    calls: string[] = [];
    constructor(user: string, name = "") {
      super();
      this.remote_identity = { uri: { user }, display_name: name };
    }
    isEnded() {
      return this.ended;
    }
    answer() {
      this.calls.push("answer");
    }
    terminate(options?: { status_code?: number }) {
      this.calls.push(`terminate${options?.status_code ? `:${options.status_code}` : ""}`);
      this.ended = true;
      this.emit("ended", { cause: "Terminated" });
    }
    hold() {
      this.calls.push("hold");
      this.emit("hold");
    }
    unhold() {
      this.calls.push("unhold");
      this.emit("unhold");
    }
    mute() {
      this.calls.push("mute");
      this.emit("muted");
    }
    unmute() {
      this.calls.push("unmute");
      this.emit("unmuted");
    }
    sendDTMF(tone: string) {
      this.calls.push(`dtmf:${tone}`);
    }
  }
  class UA extends Emitter {
    started = false;
    lastCall: { uri: string; session: FakeSession } | null = null;
    constructor(readonly config: Record<string, unknown>) {
      super();
      jssip.instances.push(this);
    }
    start() {
      this.started = true;
    }
    stop() {
      this.started = false;
    }
    call(uri: string) {
      const session = new FakeSession(uri.replace(/^sip:/, "").split("@")[0] ?? "");
      this.lastCall = { uri, session };
      return session;
    }
  }
  class WebSocketInterface {
    constructor(readonly url: string) {}
  }
  return { default: { UA, WebSocketInterface }, FakeSession };
});

const { createJsSipEngine } = await import("../src/ui/softphone/jssip-engine.js");
const { FakeSession } = (await import("jssip")) as unknown as { FakeSession: new (user: string, name?: string) => EventEmitter & { calls: string[]; ended: boolean } };

type FakeUa = EventEmitter & { config: Record<string, unknown>; started: boolean; lastCall: { uri: string; session: EventEmitter & { calls: string[] } } | null };

const config = { websocketUrl: "wss://pbx.example.com/ws", domain: "pbx.example.com", username: "1001", password: "sip-secret", iceServers: [] };

function setup() {
  const calls: Array<CallSnapshot | null> = [];
  const registrations: string[] = [];
  const engine = createJsSipEngine(config, {
    onRegistration: (state, reason) => registrations.push(reason ? `${state}:${reason}` : state),
    onCall: (call) => calls.push(call),
    onRemoteStream: () => undefined,
  });
  const ua = jssip.instances.at(-1) as FakeUa;
  return { engine, ua, calls, registrations, last: () => calls.at(-1) ?? null };
}

describe("softphone engine helpers", () => {
  it("builds the engine config only for an enabled PBX with a full SIP account", () => {
    const base = { enabled: true, sip_websocket_url: "wss://pbx/ws", sip_domain: "pbx", sip_username: "1001", sip_password: "x", ice_servers: [{ urls: "stun:a" }, "junk"], media_proxy_enabled: false as const, transport: "direct_sip_over_webrtc" as const };
    expect(engineConfigFrom(base)).toEqual({ websocketUrl: "wss://pbx/ws", domain: "pbx", username: "1001", password: "x", iceServers: [{ urls: "stun:a" }] });
    expect(engineConfigFrom({ ...base, enabled: false })).toBeNull();
    expect(engineConfigFrom({ ...base, sip_password: null })).toBeNull();
    expect(engineConfigFrom(null)).toBeNull();
  });

  it("turns dial strings into SIP URIs", () => {
    expect(sipTarget("0555 111 22 33", "pbx")).toBe("sip:05551112233@pbx");
    expect(sipTarget("+90 (555) 111", "pbx")).toBe("sip:+90555111@pbx");
    expect(sipTarget("*72#", "pbx")).toBe("sip:*72#@pbx");
    expect(sipTarget("sip:1002@other", "pbx")).toBe("sip:1002@other");
    expect(sipTarget("abc", "pbx")).toBeNull();
  });
});

describe("JsSIP engine", () => {
  beforeEach(() => {
    jssip.instances.length = 0;
  });

  it("registers the user's SIP account and maps UA registration events", () => {
    const { engine, ua, registrations } = setup();
    expect(ua.config).toMatchObject({ uri: "sip:1001@pbx.example.com", password: "sip-secret", register: true });
    engine.start();
    expect(ua.started).toBe(true);
    ua.emit("connecting");
    ua.emit("registered");
    ua.emit("registrationFailed", { cause: "Authentication Error" });
    expect(registrations).toEqual(["connecting", "registered", "failed:Authentication Error"]);
  });

  it("runs an outgoing call with hold, mute, DTMF and hangup", () => {
    const { engine, ua, last } = setup();
    engine.call("0555 111 22 33");
    expect(ua.lastCall?.uri).toBe("sip:05551112233@pbx.example.com");
    const session = ua.lastCall!.session;
    expect(last()).toMatchObject({ direction: "outgoing", remote: "05551112233", phase: "connecting" });
    session.emit("progress");
    expect(last()?.phase).toBe("ringing");
    engine.setHold(true);
    expect(session.calls).toEqual([]);
    session.emit("confirmed");
    expect(last()).toMatchObject({ phase: "active" });
    engine.setHold(true);
    engine.setHold(false);
    engine.setMuted(true);
    engine.sendDtmf("5");
    expect(last()).toMatchObject({ held: false, muted: true });
    engine.hangup();
    expect(session.calls).toEqual(["hold", "unhold", "mute", "dtmf:5", "terminate"]);
    expect(last()).toMatchObject({ phase: "ended", endReason: "Terminated" });
  });

  it("rings incoming calls, answers them and rejects a second one as busy", () => {
    const { engine, ua, last } = setup();
    const incoming = new FakeSession("05559998877", "Müşteri");
    ua.emit("newRTCSession", { originator: "remote", session: incoming });
    expect(last()).toMatchObject({ direction: "incoming", remote: "05559998877", remoteName: "Müşteri", phase: "ringing" });
    engine.answer();
    expect(incoming.calls).toEqual(["answer"]);

    const second = new FakeSession("05550000000");
    ua.emit("newRTCSession", { originator: "remote", session: second });
    expect(second.calls).toEqual(["terminate:486"]);
    expect(last()?.remote).toBe("05559998877");

    ua.emit("newRTCSession", { originator: "local", session: new FakeSession("x") });
    expect(last()?.remote).toBe("05559998877");
  });
});
