import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, CheckCircle2, CircleDot, Clock, HelpCircle, Info, Truck, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Switch as UiSwitch } from "@/components/ui/switch";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------- toasts (legacy sonner, top-right) */

type ToastTone = "success" | "error" | "info" | "danger-alert" | "warning-alert";
interface ToastItem {
  id: number;
  tone: ToastTone;
  text: string;
}

interface ToastApi {
  success: (text: string) => void;
  error: (text: string) => void;
  info: (text: string) => void;
  /** Legacy mükerrer uyarıları: long-lived red / yellow banners at the top centre. */
  alert: (tone: "danger" | "warning", text: string) => void;
}

const ToastContext = createContext<ToastApi>({ success: () => undefined, error: () => undefined, info: () => undefined, alert: () => undefined });

export function useChatToast() {
  return useContext(ToastContext);
}

export function ChatToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setItems((prev) => prev.filter((item) => item.id !== id)), []);
  const push = useCallback(
    (tone: ToastTone, text: string, duration: number) => {
      const id = nextId.current++;
      setItems((prev) => [...prev.slice(-4), { id, tone, text }]);
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({
      success: (text) => push("success", text, 4000),
      error: (text) => push("error", text, 5000),
      info: (text) => push("info", text, 4000),
      alert: (tone, text) => push(tone === "danger" ? "danger-alert" : "warning-alert", text, 10000),
    }),
    [push],
  );
  const regular = items.filter((item) => !item.tone.endsWith("-alert"));
  const alerts = items.filter((item) => item.tone.endsWith("-alert"));
  return (
    <ToastContext.Provider value={api}>
      <TooltipProvider delayDuration={300}>
        <ConfirmProvider>{children}</ConfirmProvider>
      </TooltipProvider>
      <ol className="pointer-events-none fixed top-[calc(4.5rem+env(safe-area-inset-top))] right-4 z-[120] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite" data-testid="chat-toasts">
        {regular.map((item) => (
          <li
            key={item.id}
            role="status"
            className="pointer-events-auto flex items-start gap-2 rounded-lg border border-[#E5E7EB] bg-white px-4 py-3 text-[13px] text-slate-900 shadow-lg"
            data-testid="chat-toast"
            data-tone={item.tone}
          >
            {item.tone === "success" ? (
              <CheckCircle2 className="mt-px size-4 shrink-0 text-green-600" aria-hidden="true" />
            ) : item.tone === "error" ? (
              <XCircle className="mt-px size-4 shrink-0 text-red-600" aria-hidden="true" />
            ) : (
              <Info className="mt-px size-4 shrink-0 text-blue-600" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1 break-words whitespace-pre-line">{item.text}</span>
          </li>
        ))}
      </ol>
      <ol className="pointer-events-none fixed top-[calc(4.5rem+env(safe-area-inset-top))] left-1/2 z-[120] flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2" aria-live="assertive">
        {alerts.map((item) => (
          <li
            key={item.id}
            role="alert"
            className={cn(
              "pointer-events-auto flex items-start gap-2 rounded-lg border px-4 py-3 text-[13px] font-medium whitespace-pre-line shadow-lg",
              item.tone === "danger-alert" ? "border-[#991b1b] bg-[#7f1d1d] text-[#fecaca]" : "border-[#a16207] bg-[#854d0e] text-[#fef08a]",
            )}
            data-testid="chat-alert"
            data-tone={item.tone}
          >
            <span className="min-w-0 flex-1 break-words">{item.text}</span>
            <button type="button" className="shrink-0 rounded p-0.5 opacity-80 hover:opacity-100" aria-label={t("chat.dismiss")} onClick={() => dismiss(item.id)}>
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
    </ToastContext.Provider>
  );
}

/* ---------------------------------------------------------------- legacy pill switch (TEMSİLCİ / GPT / settings) */

/** ui/Switch with the legacy look (h-5 w-9 / h-6 w-11 pill, slate when off) and a 44px hit area below lg. */
export function Switch({
  checked,
  onChange,
  disabled,
  tone = "emerald",
  size = "sm",
  label,
  testId,
  busy,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  tone?: "emerald" | "blue";
  size?: "sm" | "md";
  label: string;
  testId?: string;
  busy?: boolean;
}) {
  return (
    <UiSwitch
      checked={checked}
      onCheckedChange={() => onChange()}
      disabled={disabled}
      aria-label={label}
      size={size}
      tone={tone}
      trackClassName="bg-msg-toggle-off"
      className={cn("focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-msg-primary max-lg:min-h-11 max-lg:min-w-11", busy && "opacity-70")}
      data-testid={testId}
    />
  );
}

/* ---------------------------------------------------------------- confirm (AlertDialog instead of window.confirm) */

type ConfirmRequest = { message: string; confirmLabel: string; tone: "default" | "danger"; resolve: (ok: boolean) => void };
const ConfirmContext = createContext<(message: string, options?: { confirmLabel?: string; tone?: "default" | "danger" }) => Promise<boolean>>(() => Promise.resolve(false));

/** `await confirm(text)` → true when the agent pressed the action button. */
export function useChatConfirm() {
  return useContext(ConfirmContext);
}

function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const confirm = useCallback(
    (message: string, options: { confirmLabel?: string; tone?: "default" | "danger" } = {}) =>
      new Promise<boolean>((resolve) => setRequest({ message, confirmLabel: options.confirmLabel ?? t("chat.confirm"), tone: options.tone ?? "default", resolve })),
    [t],
  );
  const close = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={request !== null} onOpenChange={(open) => !open && close(false)}>
        <AlertDialogContent className="border-msg-border bg-msg-base text-msg-fg" data-testid="confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-sm text-msg-fg-strong">
              {request?.tone === "danger" ? <AlertTriangle className="size-5 text-red-500" aria-hidden="true" /> : <HelpCircle className="size-5 text-msg-primary-text" aria-hidden="true" />}
              {t("chat.confirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-msg-fg-soft">{request?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-msg-border bg-msg-raised text-msg-fg hover:bg-msg-hover-raised" data-testid="confirm-dialog-cancel">
              {t("chat.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => close(true)}
              className={request?.tone === "danger" ? "bg-red-600 text-msg-on-primary hover:bg-red-700" : "bg-msg-primary text-msg-on-primary hover:bg-msg-primary/90"}
              data-testid="confirm-dialog-action"
            >
              {request?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

/* ---------------------------------------------------------------- legacy modal shell (fixed inset-0 z-[110] bg-black/70) */

export function ChatDialog({
  open,
  onClose,
  title,
  icon,
  children,
  footer,
  tone = "default",
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  tone?: "default" | "danger";
  testId?: string;
}) {
  const { t } = useTranslation();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[110] bg-black/70" />
        <div className="pointer-events-none fixed inset-0 z-[111] flex items-center justify-center p-4">
          <DialogPrimitive.Content
            className={cn(
              "pointer-events-auto relative flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col rounded-xl bg-msg-base text-msg-fg shadow-2xl outline-none",
              tone === "danger" ? "border-2 border-red-600" : "border border-msg-border",
            )}
            aria-describedby={undefined}
            data-testid={testId}
          >
            {tone === "danger" ? (
              <div className="flex items-center gap-3 rounded-t-[10px] bg-red-600 px-5 py-3">
                {icon}
                <DialogPrimitive.Title className="text-sm font-semibold text-white">{title}</DialogPrimitive.Title>
              </div>
            ) : (
              <div className="flex items-center justify-between border-b border-msg-border px-5 py-3">
                <DialogPrimitive.Title className="flex items-center gap-2 text-sm font-semibold text-msg-fg-strong">
                  {icon}
                  {title}
                </DialogPrimitive.Title>
                <DialogPrimitive.Close className="rounded-lg p-1 text-msg-muted hover:bg-msg-hover-raised max-md:inline-flex max-md:size-11 max-md:items-center max-md:justify-center" aria-label={t("chat.close")}>
                  <X className="size-5" aria-hidden="true" />
                </DialogPrimitive.Close>
              </div>
            )}
            <div className="min-h-0 overflow-y-auto px-5 py-5 msg-scrollbar">{children}</div>
            {footer && <div className="flex justify-end gap-2 border-t border-msg-border px-5 py-3">{footer}</div>}
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Closes legacy popovers on an outside mousedown. */
export function useClickOutside(ref: RefObject<HTMLElement | null>, onOutside: () => void, enabled = true) {
  const handler = useRef(onOutside);
  handler.current = onOutside;
  useEffect(() => {
    if (!enabled) return;
    const listener = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) handler.current();
    };
    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, [ref, enabled]);
}

/** Legacy `badge badge-*` status pill (DURUM_CONFIG colours). */
export function LegacyBadge({ tone, children }: { tone: "success" | "warning" | "danger" | "info" | "neutral"; children: ReactNode }) {
  const tones = {
    success: "bg-green-500/20 text-green-700 dark:text-green-400",
    warning: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400",
    danger: "bg-red-500/20 text-red-700 dark:text-red-400",
    info: "bg-blue-500/20 text-blue-700 dark:text-blue-400",
    neutral: "bg-slate-500/20 text-slate-600 dark:text-slate-400",
  } as const;
  const Icon = { success: CheckCircle2, warning: Clock, danger: XCircle, info: Truck, neutral: CircleDot }[tone];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", tones[tone])}>
      <Icon className="size-3" aria-hidden="true" />
      {children}
    </span>
  );
}
