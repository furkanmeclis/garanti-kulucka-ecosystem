import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Phone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { createSoftphoneEngine, engineConfigFrom, type CallSnapshot, type RegistrationState, type SoftphoneEngine } from "./engine";
import { callPhaseKey, clientCallEvent } from "./state";
import type { CallContext } from "./types";

interface PhoneContext {
  registration: RegistrationState;
  call: CallSnapshot | null;
  dial: (number: string, context?: CallContext) => void;
  open: () => void;
}
const Context = createContext<PhoneContext | null>(null);
export const useSoftphone = () => useContext(Context);

export function SoftphoneProvider({ children }: { children: ReactNode }) {
  const { api, status, user } = useAuth();
  // Keep the phone mounted across route transitions; destroy it on logout/account changes.
  return status === "authenticated" && user
    ? <AccountPhone key={user.public_id} api={api}>{children}</AccountPhone>
    : <>{children}</>;
}

function AccountPhone({ children, api }: { children: ReactNode; api: ReturnType<typeof useAuth>["api"] }) {
  const { t } = useTranslation();
  const engine = useRef<SoftphoneEngine | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const session = useRef<{ id: string; beganAt: number; context: CallContext; logged: boolean } | null>(null);
  const pendingContext = useRef<CallContext>({});
  const currentCall = useRef<CallSnapshot | null>(null);
  const registrationRef = useRef<RegistrationState>("disconnected");
  const [available, setAvailable] = useState(false);
  const [registration, setRegistration] = useState<RegistrationState>("disconnected");
  const [call, setCall] = useState<CallSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [callerName, setCallerName] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [controlError, setControlError] = useState(false);

  useEffect(() => {
    let disposed = false;
    let instance: SoftphoneEngine | null = null;
    void api.getWebphoneConfig().then(async (response) => {
      const config = engineConfigFrom(response);
      if (disposed || !config) return;
      setAvailable(true);
      setRegistration("connecting");
      instance = await createSoftphoneEngine(config, {
        onRegistration: (state) => {
          if (disposed) return;
          registrationRef.current = state;
          setRegistration(state);
        },
        onCall: (snapshot) => {
          if (disposed) return;
          currentCall.current = snapshot;
          setCall(snapshot);
          setControlError(false);
          if (!snapshot) return;
          if (session.current?.id !== snapshot.id) {
            session.current = { id: snapshot.id, beganAt: Date.now(), context: snapshot.direction === "outgoing" ? pendingContext.current : {}, logged: false };
            pendingContext.current = {};
            setCallerName(null);
            if (!session.current.context.customer_public_id) {
              const tracked = session.current;
              void api.lookupCustomerByPhone(snapshot.remote).then(({ customer }) => {
                if (disposed || session.current !== tracked || tracked.logged) return;
                setCallerName(customer?.full_name ?? null);
                tracked.context = { ...tracked.context, customer_public_id: customer?.public_id ?? null };
              }).catch(() => {});
            }
            if (snapshot.direction === "outgoing") setOpen(true);
          }
          if (snapshot.phase === "ended" && !session.current.logged) {
            session.current.logged = true;
            const body = clientCallEvent(snapshot, session.current.context, session.current.beganAt, Date.now());
            // Telemetry must never interrupt calling, including while the endpoint returns 404.
            void api.postClientCallEvent(body).catch(() => {});
          }
        },
        onRemoteStream: (stream) => {
          if (disposed || !audio.current) return;
          audio.current.srcObject = stream;
          if (stream) void audio.current.play().catch(() => {});
        },
      });
      if (disposed) { instance.stop(); return; }
      engine.current = instance;
      instance.start();
    }).catch(() => { if (!disposed) setRegistration("failed"); });
    return () => { disposed = true; engine.current = null; instance?.stop(); };
  }, [api]);

  useEffect(() => {
    if (call?.phase !== "active") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [call?.phase]);
  useEffect(() => {
    if (call?.phase !== "ended") return;
    const timer = window.setTimeout(() => {
      currentCall.current = null;
      setCall(null);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [call]);

  function control(action: () => void) {
    try { action(); } catch { setControlError(true); }
  }
  function dial(number: string, context: CallContext = {}) {
    if (!number.trim() || registrationRef.current !== "registered" || (currentCall.current && currentCall.current.phase !== "ended")) return;
    pendingContext.current = context;
    setTarget(number);
    setOpen(true);
    control(() => engine.current?.call(number));
  }
  const live = !!call && call.phase !== "ended";
  const incoming = call?.direction === "incoming" && call.phase === "ringing";
  const elapsed = call?.startedAt == null ? 0 : Math.max(0, Math.floor((now - call.startedAt) / 1000));
  const timer = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const controls = (
    <div className="grid gap-3 p-4 pt-0">
      {call && <div className="grid gap-1 break-words" aria-live="polite" data-testid="softphone-call">
        <strong>{callerName ?? call.remoteName ?? call.remote}</strong>
        <span>{call.remote}</span>
        <span data-testid="softphone-call-state">{t(`softphone.${callPhaseKey(call)}`)} {call.phase === "active" && timer}</span>
      </div>}
      {controlError && <p role="alert">{t("softphone.error")}</p>}
      {!live && <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); dial(target); }}>
        <label htmlFor="softphone-number">{t("softphone.numberLabel")}</label>
        <Input id="softphone-number" type="tel" inputMode="tel" className="min-h-11" value={target} onChange={(event) => setTarget(event.target.value)} data-testid="softphone-number" />
        <Button className="min-h-11" disabled={registration !== "registered" || !target.trim()} data-testid="softphone-call-button">{t("softphone.call")}</Button>
      </form>}
      {call?.phase === "active" && <>
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" variant="outline" aria-pressed={call.muted} onClick={() => control(() => engine.current?.setMuted(!call.muted))} data-testid="softphone-mute">{t(call.muted ? "softphone.unmute" : "softphone.mute")}</Button>
          {engine.current?.setHold && <Button className="min-h-11" variant="outline" aria-pressed={call.held} onClick={() => control(() => engine.current?.setHold?.(!call.held))} data-testid="softphone-hold">{t(call.held ? "softphone.resume" : "softphone.hold")}</Button>}
        </div>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label={t("softphone.keypad")}>
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((tone) => <Button key={tone} className="min-h-11" variant="outline" onClick={() => control(() => engine.current?.sendDtmf(tone))}>{tone}</Button>)}
        </div>
      </>}
      {live && <Button className="min-h-11" variant="destructive" onClick={() => control(() => engine.current?.hangup())} data-testid="softphone-hangup">{t("softphone.hangup")}</Button>}
    </div>
  );
  return <Context.Provider value={available ? { registration, call, dial, open: () => setOpen(true) } : null}>
    {children}
    {available && <>
      <audio ref={audio} autoPlay data-testid="softphone-audio" />
      <Sheet open={open && !incoming} onOpenChange={setOpen}>
        <SheetContent side="bottom" closeLabel={t("softphone.close")} className="mx-auto max-w-md overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]" data-testid="softphone-panel">
          <SheetHeader><SheetTitle>{t("softphone.title")}</SheetTitle><SheetDescription>{t(`softphone.${registration}`)}</SheetDescription></SheetHeader>
          {controls}
        </SheetContent>
      </Sheet>
      <Sheet open={incoming}>
        <SheetContent side="bottom" closeLabel={t("softphone.reject")} onEscapeKeyDown={(event) => event.preventDefault()} onPointerDownOutside={(event) => event.preventDefault()} className="mx-auto max-w-md pb-[max(1rem,env(safe-area-inset-bottom))] [&>button:last-child]:hidden" data-testid="softphone-incoming">
          <SheetHeader><SheetTitle>{t("softphone.incomingTitle")}</SheetTitle><SheetDescription asChild><div className="break-words"><p data-testid="softphone-incoming-caller">{callerName ?? call?.remoteName}</p><p>{call?.remote}</p></div></SheetDescription></SheetHeader>
          <div className="grid grid-cols-2 gap-3 p-4">
            <Button className="min-h-11" variant="destructive" onClick={() => control(() => engine.current?.hangup())} data-testid="softphone-reject">{t("softphone.reject")}</Button>
            <Button className="min-h-11" onClick={() => { setOpen(true); control(() => engine.current?.answer()); }} data-testid="softphone-answer">{t("softphone.answer")}</Button>
          </div>
        </SheetContent>
      </Sheet>
    </>}
  </Context.Provider>;
}

export function SoftphoneStatus() {
  const phone = useSoftphone();
  const { t } = useTranslation();
  if (!phone) return null;
  return <Button variant="ghost" size="icon" className="relative shrink-0" onClick={phone.open} aria-label={`${t("softphone.title")}: ${t(`softphone.${phone.registration}`)}`} title={t(`softphone.${phone.registration}`)} data-testid="softphone-toggle">
    <Phone className="size-5" /><span data-testid="softphone-registration" data-state={phone.registration} className={`absolute top-1 right-1 size-2 rounded-full ${phone.registration === "registered" ? "bg-green-500" : phone.registration === "failed" ? "bg-red-500" : "bg-amber-500"}`} /><span className="sr-only">{t(`softphone.${phone.registration}`)}</span>
  </Button>;
}

export function ClickToCall({ number, ...context }: CallContext & { number: string | null | undefined }) {
  const phone = useSoftphone();
  const { t } = useTranslation();
  if (!phone || !number) return null;
  return <Button type="button" variant="outline" className="min-h-11" disabled={phone.registration !== "registered" || !!(phone.call && phone.call.phase !== "ended")} onClick={() => phone.dial(number, context)} data-testid="click-to-call"><Phone className="size-4" />{t("softphone.call")}</Button>;
}
