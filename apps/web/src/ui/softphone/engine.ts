import type { WebphoneConfig } from "../../api/webphone-client.js";

/**
 * Browser softphone engine (legacy SoftphoneWidget / GelenCagriModal on JsSIP). The UI only talks to
 * this interface; the JsSIP implementation is loaded lazily and tests replace it through
 * `window.__GARANTI_SIP_ENGINE_FACTORY__` (same pattern as the realtime socket factory), so no test
 * ever opens a SIP WebSocket.
 */

export type RegistrationState = "disconnected" | "connecting" | "registered" | "failed";
export type CallDirection = "incoming" | "outgoing";
export type CallPhase = "ringing" | "connecting" | "active" | "ended";

export interface CallSnapshot {
  id: string;
  direction: CallDirection;
  remote: string;
  remoteName: string | null;
  phase: CallPhase;
  held: boolean;
  muted: boolean;
  startedAt: number | null;
  endReason: string | null;
}

export interface SoftphoneEvents {
  onRegistration: (state: RegistrationState, reason?: string) => void;
  onCall: (call: CallSnapshot | null) => void;
  onRemoteStream: (stream: MediaStream | null) => void;
}

export interface SoftphoneEngine {
  start: () => void;
  stop: () => void;
  call: (target: string) => void;
  answer: () => void;
  hangup: () => void;
  setHold: (held: boolean) => void;
  setMuted: (muted: boolean) => void;
  sendDtmf: (tone: string) => void;
}

export interface SoftphoneEngineConfig {
  websocketUrl: string;
  domain: string;
  username: string;
  password: string;
  iceServers: RTCIceServer[];
}

export type SoftphoneEngineFactory = (config: SoftphoneEngineConfig, events: SoftphoneEvents) => SoftphoneEngine | Promise<SoftphoneEngine>;

declare global {
  interface Window {
    __GARANTI_SIP_ENGINE_FACTORY__?: SoftphoneEngineFactory;
  }
}

function isIceServer(value: unknown): value is RTCIceServer {
  return !!value && typeof value === "object" && "urls" in value;
}

/** `null` when the user has no SIP account or the PBX is disabled. */
export function engineConfigFrom(config: WebphoneConfig | null | undefined): SoftphoneEngineConfig | null {
  if (!config?.enabled || !config.sip_websocket_url || !config.sip_domain || !config.sip_username || !config.sip_password) return null;
  return {
    websocketUrl: config.sip_websocket_url,
    domain: config.sip_domain,
    username: config.sip_username,
    password: config.sip_password,
    iceServers: config.ice_servers.filter(isIceServer),
  };
}

/** Dial string → SIP URI: keeps extensions/numbers (+ and digits, *, #) and appends the PBX domain. */
export function sipTarget(target: string, domain: string) {
  const trimmed = target.trim();
  if (trimmed.startsWith("sip:")) return trimmed;
  const dialable = trimmed.replace(/[^\d+*#]/g, "");
  return dialable ? `sip:${dialable}@${domain}` : null;
}

export async function createSoftphoneEngine(config: SoftphoneEngineConfig, events: SoftphoneEvents): Promise<SoftphoneEngine> {
  if (typeof window !== "undefined" && window.__GARANTI_SIP_ENGINE_FACTORY__) {
    return window.__GARANTI_SIP_ENGINE_FACTORY__(config, events);
  }
  const { createJsSipEngine } = await import("./jssip-engine.js");
  return createJsSipEngine(config, events);
}
