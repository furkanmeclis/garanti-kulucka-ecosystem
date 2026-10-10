import { AlertTriangle, HelpCircle } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  tone?: "default" | "danger";
}

type Request = ConfirmOptions & { message: string; resolve: (ok: boolean) => void };

const ConfirmContext = createContext<((message: string, options?: ConfirmOptions) => Promise<boolean>) | null>(null);

/** `if (!(await confirm(text))) return;` — the AlertDialog replacement for `window.confirm`. */
export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return confirm;
}

/** App-wide confirmation dialog (testids `confirm-dialog`, `confirm-dialog-action`, `confirm-dialog-cancel`). */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [request, setRequest] = useState<Request | null>(null);
  const confirm = useCallback((message: string, options: ConfirmOptions = {}) => new Promise<boolean>((resolve) => setRequest({ ...options, message, resolve })), []);
  const close = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };
  const danger = request?.tone === "danger";
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={request !== null} onOpenChange={(open) => !open && close(false)}>
        <AlertDialogContent data-testid="confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {danger ? <AlertTriangle className="size-5 text-destructive" aria-hidden="true" /> : <HelpCircle className="size-5 text-primary" aria-hidden="true" />}
              {request?.title ?? t("confirm.title")}
            </AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line" data-testid="confirm-dialog-message">{request?.message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11 lg:min-h-9" data-testid="confirm-dialog-cancel">
              {t("confirm.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction className={danger ? buttonVariants({ variant: "destructive", className: "min-h-11 lg:min-h-9" }) : "min-h-11 lg:min-h-9"} onClick={() => close(true)} data-testid="confirm-dialog-action">
              {request?.confirmLabel ?? (danger ? t("confirm.delete") : t("confirm.ok"))}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
