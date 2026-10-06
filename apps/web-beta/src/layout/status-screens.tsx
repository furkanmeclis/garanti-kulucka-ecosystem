import { Loader2, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function SplashScreen() {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-dvh place-items-center p-6" role="status" aria-live="polite" data-testid="splash">
      <div className="flex flex-col items-center gap-4">
        <img src="/favicon.svg" alt="" className="size-14" width={56} height={56} />
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">{t("app.loading")}</span>
      </div>
    </div>
  );
}

/** Offline launch screen: the cached shell opened but the API is unreachable. */
export function OfflineScreen({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-dvh place-items-center p-6" data-testid="offline-screen">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <span className="grid size-16 place-items-center rounded-full bg-muted">
          <WifiOff className="size-7 text-muted-foreground" aria-hidden="true" />
        </span>
        <h1 className="text-xl font-semibold">{t("app.offlineTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("app.offlineDescription")}</p>
        <Button onClick={onRetry}>{t("app.retry")}</Button>
      </div>
    </div>
  );
}
