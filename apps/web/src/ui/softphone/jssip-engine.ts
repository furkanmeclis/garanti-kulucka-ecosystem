import JsSIP from "jssip";
import type { RTCSession } from "jssip/lib/RTCSession.js";
import type { CallSnapshot, SoftphoneEngine, SoftphoneEngineConfig, SoftphoneEvents } from "./engine.js";
import { sipTarget } from "./engine.js";

/**
 * JsSIP implementation of the softphone engine: SIP over WebSocket registration, one call at a time
 * (a second incoming call is rejected with 486 Busy like the legacy widget), remote audio exposed as a
 * MediaStream for the page's <audio> element.
 */
export function createJsSipEngine(config: SoftphoneEngineConfig, events: SoftphoneEvents): SoftphoneEngine {
  const socket = new JsSIP.WebSocketInterface(config.websocketUrl);
  const ua = new JsSIP.UA({
    sockets: [socket],
    uri: `sip:${config.username}@${config.domain}`,
    password: config.password,
    register: true,
    session_timers: false,
  });
  let session: RTCSession | null = null;
  let snapshot: CallSnapshot | null = null;
  let sequence = 0;

  const emit = (patch: Partial<CallSnapshot> | null) => {
    snapshot = patch === null || !snapshot ? (patch as CallSnapshot | null) : { ...snapshot, ...patch };
    events.onCall(snapshot);
  };

  const attachAudio = (current: RTCSession) => {
    const connection = current.connection;
    if (!connection) return;
    const publish = () => {
      const receivers = connection.getReceivers().filter((receiver) => receiver.track?.kind === "audio");
      events.onRemoteStream(receivers.length ? new MediaStream(receivers.map((receiver) => receiver.track)) : null);
    };
    connection.addEventListener("track", publish);
    publish();
  };

  const track = (current: RTCSession, direction: CallSnapshot["direction"]) => {
    session = current;
    sequence += 1;
    const identity = current.remote_identity;
    emit({
      id: `call_${sequence}`,
      direction,
      remote: identity?.uri?.user ?? "",
      remoteName: identity?.display_name || null,
      phase: direction === "incoming" ? "ringing" : "connecting",
      held: false,
      muted: false,
      startedAt: null,
      endReason: null,
    });
    current.on("peerconnection", () => attachAudio(current));
    current.on("progress", () => emit({ phase: direction === "incoming" ? "connecting" : "ringing" }));
    current.on("confirmed", () => {
      attachAudio(current);
      emit({ phase: "active", startedAt: Date.now() });
    });
    current.on("hold", () => emit({ held: true }));
    current.on("unhold", () => emit({ held: false }));
    current.on("muted", () => emit({ muted: true }));
    current.on("unmuted", () => emit({ muted: false }));
    const finish = (event: { cause?: string }) => {
      if (session === current) session = null;
      emit({ phase: "ended", endReason: event.cause ?? null });
      events.onRemoteStream(null);
    };
    current.on("ended", finish);
    current.on("failed", finish);
  };

  ua.on("connecting", () => events.onRegistration("connecting"));
  ua.on("registered", () => events.onRegistration("registered"));
  ua.on("unregistered", () => events.onRegistration("disconnected"));
  ua.on("disconnected", () => events.onRegistration("disconnected"));
  ua.on("registrationFailed", (event: { cause?: string }) => events.onRegistration("failed", event.cause));
  ua.on("newRTCSession", (event: { originator: string; session: RTCSession }) => {
    if (event.originator !== "remote") return;
    if (session && !session.isEnded()) {
      event.session.terminate({ status_code: 486, reason_phrase: "Busy Here" });
      return;
    }
    track(event.session, "incoming");
  });

  const mediaConstraints = { audio: true, video: false };
  const pcConfig = { iceServers: config.iceServers };

  return {
    start: () => ua.start(),
    stop: () => {
      session?.terminate();
      ua.stop();
    },
    call: (target) => {
      const uri = sipTarget(target, config.domain);
      if (!uri || (session && !session.isEnded())) return;
      track(ua.call(uri, { mediaConstraints, pcConfig }), "outgoing");
    },
    answer: () => {
      if (session && snapshot?.direction === "incoming" && snapshot.phase === "ringing") session.answer({ mediaConstraints, pcConfig });
    },
    hangup: () => {
      if (session && !session.isEnded()) session.terminate();
    },
    setHold: (held) => {
      if (!session || snapshot?.phase !== "active") return;
      if (held) session.hold();
      else session.unhold();
    },
    setMuted: (muted) => {
      if (!session) return;
      if (muted) session.mute({ audio: true });
      else session.unmute({ audio: true });
    },
    sendDtmf: (tone) => {
      if (session && snapshot?.phase === "active") session.sendDTMF(tone);
    },
  };
}
