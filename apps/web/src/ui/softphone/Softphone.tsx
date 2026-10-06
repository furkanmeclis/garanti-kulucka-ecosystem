import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Grid3x3, Mic, MicOff, Pause, Phone, PhoneCall, PhoneIncoming, PhoneOff, Play, X } from "lucide-react";
import type { WebphoneConfig } from "../../api/webphone-client.js";
import { useT } from "../i18n/index.js";
import { softphoneMessages } from "../i18n/messages/softphone.js";
import { createSoftphoneEngine, engineConfigFrom, type CallSnapshot, type RegistrationState, type SoftphoneEngine } from "./engine.js";

interface SoftphoneContextValue {
  available: boolean;
  registration: RegistrationState;
  registrationError: string | null;
  call: CallSnapshot | null;
  dial: (target: string) => void;
  answer: () => void;
  hangup: () => void;
  toggleHold: () => void;
  toggleMute: () => void;
  sendDtmf: (tone: string) => void;
  openDialer: (target?: string) => void;
}

const SoftphoneContext = createContext<SoftphoneContextValue | null>(null);

/** `null` outside the provider or when the user has no SIP account; pages hide click-to-call then. */
export function useSoftphone() {
  const value = useContext(SoftphoneContext);
  return value?.available ? value : null;
}

const keypad = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

function useCallTimer(call: CallSnapshot | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (call?.phase !== "active") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [call?.phase]);
  if (!call?.startedAt || call.phase !== "active") return null;
  const seconds = Math.max(0, Math.floor((now - call.startedAt) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Registers the logged-in user's SIP account (from `/api/webphone/config`) and renders the floating
 * dialer, the incoming-call screen and the remote audio element. Without a SIP account it renders only
 * its children.
 */
export function SoftphoneProvider({ config, children }: { config: WebphoneConfig | null | undefined; children: ReactNode }) {
  const engineConfig = useMemo(() => engineConfigFrom(config), [config]);
  const configKey = engineConfig ? `${engineConfig.websocketUrl}|${engineConfig.username}|${engineConfig.domain}` : null;
  const engineRef = useRef<SoftphoneEngine | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [registration, setRegistration] = useState<RegistrationState>("disconnected");
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  const [call, setCall] = useState<CallSnapshot | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [target, setTarget] = useState("");

  useEffect(() => {
    if (!engineConfig) return;
    let cancelled = false;
    let engine: SoftphoneEngine | null = null;
    setRegistration("connecting");
    void createSoftphoneEngine(engineConfig, {
      onRegistration: (state, reason) => {
        if (cancelled) return;
        setRegistration(state);
        setRegistrationError(state === "failed" ? reason ?? "unknown" : null);
      },
      onCall: (snapshot) => {
        if (!cancelled) setCall(snapshot);
      },
      onRemoteStream: (stream) => {
        if (audioRef.current) audioRef.current.srcObject = stream;
      },
    })
      .then((created) => {
        if (cancelled) {
          created.stop();
          return;
        }
        engine = created;
        engineRef.current = created;
        created.start();
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRegistration("failed");
          setRegistrationError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
      engine?.stop();
      engineRef.current = null;
      setRegistration("disconnected");
      setCall(null);
    };
    // Re-register only when the account itself changes, not on every config object refresh.
  }, [configKey]);

  // An ended call stays visible briefly ("Görüşme bitti") and then clears.
  useEffect(() => {
    if (call?.phase !== "ended") return;
    const timer = window.setTimeout(() => setCall((current) => (current?.id === call.id ? null : current)), 3000);
    return () => window.clearTimeout(timer);
  }, [call]);

  const dial = useCallback((value: string) => {
    if (!value.trim()) return;
    setPanelOpen(true);
    engineRef.current?.call(value);
  }, []);

  const value = useMemo<SoftphoneContextValue>(
    () => ({
      available: Boolean(engineConfig),
      registration,
      registrationError,
      call,
      dial,
      answer: () => {
        setPanelOpen(true);
        engineRef.current?.answer();
      },
      hangup: () => engineRef.current?.hangup(),
      toggleHold: () => engineRef.current?.setHold(!call?.held),
      toggleMute: () => engineRef.current?.setMuted(!call?.muted),
      sendDtmf: (tone) => engineRef.current?.sendDtmf(tone),
      openDialer: (next) => {
        if (next !== undefined) setTarget(next);
        setPanelOpen(true);
      },
    }),
    [engineConfig, registration, registrationError, call, dial],
  );

  return (
    <SoftphoneContext.Provider value={value}>
      {children}
      {engineConfig && (
        <>
          <audio ref={audioRef} autoPlay data-testid="softphone-audio" />
          <SoftphoneWidget
            open={panelOpen}
            onOpenChange={setPanelOpen}
            target={target}
            onTargetChange={setTarget}
            extension={engineConfig.username}
          />
          {call?.direction === "incoming" && call.phase === "ringing" && <IncomingCallModal call={call} />}
        </>
      )}
    </SoftphoneContext.Provider>
  );
}

function SoftphoneWidget(props: { open: boolean; onOpenChange: (open: boolean) => void; target: string; onTargetChange: (value: string) => void; extension: string }) {
  const t = useT(softphoneMessages);
  const phone = useContext(SoftphoneContext)!;
  const [showKeypad, setShowKeypad] = useState(false);
  const timer = useCallTimer(phone.call);
  const call = phone.call;
  const inCall = Boolean(call && call.phase !== "ended");

  const statusText =
    phone.registration === "registered"
      ? t("registered")
      : phone.registration === "connecting"
        ? t("connecting")
        : phone.registration === "failed"
          ? t("failed", { reason: phone.registrationError ?? "-" })
          : t("disconnected");

  const callText = !call
    ? null
    : call.phase === "ended"
      ? t("ended")
      : call.phase === "active"
        ? `${t("active")}${timer ? ` · ${timer}` : ""}`
        : call.direction === "outgoing"
          ? call.phase === "ringing"
            ? t("ringingOut")
            : t("callingOut")
          : t("incomingTitle");

  return (
    <div className="softphone" data-testid="softphone">
      {props.open && (
        <section className="softphone-panel" role="dialog" aria-label={t("title")} data-testid="softphone-panel">
          <header className="softphone-header">
            <div>
              <strong>{t("title")}</strong>
              <span className="softphone-sub">{t("extension", { extension: props.extension })}</span>
            </div>
            <span className={`softphone-status ${phone.registration}`} data-testid="softphone-registration">
              {statusText}
            </span>
            <button type="button" className="softphone-icon" onClick={() => props.onOpenChange(false)} aria-label={t("close")}>
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          {call && (
            <div className="softphone-call" data-testid="softphone-call">
              <strong data-testid="softphone-remote">{call.remoteName ?? call.remote}</strong>
              <span data-testid="softphone-call-state">{callText}</span>
              <span className="softphone-flags">
                {call.held && <span data-testid="softphone-held">{t("held")}</span>}
                {call.muted && <span data-testid="softphone-muted">{t("muted")}</span>}
              </span>
            </div>
          )}

          {!inCall && (
            <form
              className="softphone-dial"
              onSubmit={(event) => {
                event.preventDefault();
                phone.dial(props.target);
              }}
            >
              <label>
                <span className="field-label">{t("numberLabel")}</span>
                <input
                  type="tel"
                  inputMode="tel"
                  value={props.target}
                  placeholder={t("numberPlaceholder")}
                  onChange={(event) => props.onTargetChange(event.target.value)}
                  data-testid="softphone-number"
                />
              </label>
              <button type="submit" className="softphone-btn call" disabled={phone.registration !== "registered" || !props.target.trim()} data-testid="softphone-call-button">
                <PhoneCall size={18} aria-hidden="true" /> {t("call")}
              </button>
            </form>
          )}

          {inCall && call?.phase === "active" && (
            <div className="softphone-controls">
              <button type="button" className={`softphone-btn ${call.held ? "on" : ""}`} onClick={phone.toggleHold} aria-pressed={call.held} data-testid="softphone-hold">
                {call.held ? <Play size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}
                {call.held ? t("resume") : t("hold")}
              </button>
              <button type="button" className={`softphone-btn ${call.muted ? "on" : ""}`} onClick={phone.toggleMute} aria-pressed={call.muted} data-testid="softphone-mute">
                {call.muted ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
                {call.muted ? t("unmute") : t("mute")}
              </button>
              <button type="button" className={`softphone-btn ${showKeypad ? "on" : ""}`} onClick={() => setShowKeypad((value) => !value)} aria-pressed={showKeypad}>
                <Grid3x3 size={18} aria-hidden="true" /> {t("keypad")}
              </button>
            </div>
          )}

          {inCall && call?.phase === "active" && showKeypad && (
            <div className="softphone-keypad" data-testid="softphone-keypad">
              {keypad.map((key) => (
                <button key={key} type="button" className="softphone-key" onClick={() => phone.sendDtmf(key)}>
                  {key}
                </button>
              ))}
            </div>
          )}

          {inCall && (
            <button type="button" className="softphone-btn hangup" onClick={phone.hangup} data-testid="softphone-hangup">
              <PhoneOff size={18} aria-hidden="true" /> {t("hangup")}
            </button>
          )}
        </section>
      )}
      <button
        type="button"
        className={`softphone-fab ${inCall ? "in-call" : ""} ${phone.registration}`}
        onClick={() => props.onOpenChange(!props.open)}
        aria-label={props.open ? t("close") : t("open")}
        aria-expanded={props.open}
        data-testid="softphone-toggle"
      >
        <Phone size={22} aria-hidden="true" />
      </button>
    </div>
  );
}

function IncomingCallModal({ call }: { call: CallSnapshot }) {
  const t = useT(softphoneMessages);
  const phone = useContext(SoftphoneContext)!;
  const caller = call.remoteName ?? (call.remote || t("unknownCaller"));
  return (
    <div className="softphone-incoming-backdrop">
      <section className="softphone-incoming" role="alertdialog" aria-modal="true" aria-label={t("incomingTitle")} data-testid="softphone-incoming">
        <PhoneIncoming size={36} className="softphone-ring" aria-hidden="true" />
        <h2>{t("incomingTitle")}</h2>
        <p data-testid="softphone-incoming-caller">{t("incomingFrom", { caller })}</p>
        {call.remoteName && call.remote && <p className="softphone-sub">{call.remote}</p>}
        <div className="softphone-incoming-actions">
          <button type="button" className="softphone-btn hangup" onClick={phone.hangup} data-testid="softphone-reject">
            <PhoneOff size={18} aria-hidden="true" /> {t("reject")}
          </button>
          <button type="button" className="softphone-btn call" onClick={phone.answer} data-testid="softphone-answer">
            <Phone size={18} aria-hidden="true" /> {t("answer")}
          </button>
        </div>
      </section>
    </div>
  );
}

/** Small "call this number" button for pages (customer detail, orders); hidden without a softphone. */
export function ClickToCall({ number }: { number: string | null | undefined }) {
  const phone = useSoftphone();
  const t = useT(softphoneMessages);
  if (!phone || !number) return null;
  return (
    <button
      type="button"
      className="softphone-inline"
      onClick={() => {
        phone.openDialer(number);
        phone.dial(number);
      }}
      disabled={phone.registration !== "registered" || Boolean(phone.call && phone.call.phase !== "ended")}
      aria-label={t("clickToCall", { number })}
      data-testid="click-to-call"
    >
      <PhoneCall size={14} aria-hidden="true" />
    </button>
  );
}
