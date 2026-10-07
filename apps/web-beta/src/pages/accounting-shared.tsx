import { CheckCircle2, UploadCloud, Loader2 } from "lucide-react";
import { useState, type ReactNode, type SelectHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { InvoiceStatus, SyncState } from "@/lib/accounting";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";

export type Feedback = { tone: "success" | "error"; text: string } | null;

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function idempotencyKey(prefix: string) {
  return `${prefix}_${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

export function FeedbackLine({ feedback, testId }: { feedback: Feedback; testId: string }) {
  if (!feedback) return null;
  return (
    <p
      role={feedback.tone === "error" ? "alert" : "status"}
      className={feedback.tone === "error" ? "text-sm text-destructive" : "flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300"}
      data-testid={testId}
    >
      {feedback.tone === "success" && <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />}
      {feedback.text}
    </p>
  );
}

const syncLabel = { local: "syncLocal", queued: "syncQueued", synced: "syncSynced", failed: "syncFailed" } as const;

export function SyncBadge({ sync }: { sync: SyncState }) {
  const { t } = useTranslation();
  const tone = sync.status === "synced" ? "success" : sync.status === "failed" ? "danger" : sync.status === "queued" ? "info" : "outline";
  return (
    <Badge tone={tone} title={sync.error ?? undefined}>
      {t(`accounting.${syncLabel[sync.status]}`)}
    </Badge>
  );
}

const statusLabel = { issued: "statusIssued", partially_paid: "statusPartiallyPaid", paid: "statusPaid", cancelled: "statusCancelled" } as const;

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const { t } = useTranslation();
  const tone = status === "paid" ? "success" : status === "partially_paid" ? "warning" : status === "cancelled" ? "danger" : "neutral";
  return <Badge tone={tone}>{t(`accounting.${statusLabel[status]}`)}</Badge>;
}

/** KolayBi live gate, pending counts and the "send to KolayBi" action (queues worker jobs, never calls KolayBi). */
export function KolaybiPanel({ onSynced }: { onSynced?: () => void }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const status = useQuery("kolaybi:status", () => api.kolaybiStatus());
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const data = status.data;
  const pending = (target: "contact" | "invoice" | "payment") => (data ? data.counts[target].local + data.counts[target].failed : 0);

  async function sync() {
    setSyncing(true);
    setFeedback(null);
    try {
      const result = await api.syncKolaybi(idempotencyKey("kolaybi_sync"));
      setFeedback({ tone: "success", text: t("accounting.kolaybiQueued", { queued: result.queued_count, total: result.requested_count }) });
      status.reload();
      onSynced?.();
    } catch (error) {
      setFeedback({ tone: "error", text: t("accounting.error", { message: errorText(error) }) });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Card className="mb-4 flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between" data-testid="kolaybi-panel">
      <div className="min-w-0 text-sm">
        <p className="font-medium">{t("accounting.kolaybiTitle")}</p>
        {data && (
          <>
            <p className={data.live_call_permitted ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"} data-testid="kolaybi-live">
              {data.live_call_permitted ? t("accounting.kolaybiLive") : t("accounting.kolaybiDryRun")}
            </p>
            <p className="text-muted-foreground">
              {data.account ? t("accounting.kolaybiAccount", { name: data.account.display_name }) : t("accounting.kolaybiNoAccount")} · {t("accounting.kolaybiGate", { gate: data.live_gate })}
            </p>
            <p className="text-muted-foreground" data-testid="kolaybi-counts">
              {t("accounting.kolaybiCounts", { contacts: pending("contact"), invoices: pending("invoice"), payments: pending("payment") })}
            </p>
          </>
        )}
        <FeedbackLine feedback={feedback} testId="kolaybi-feedback" />
      </div>
      <Button variant="outline" className="min-h-11 shrink-0" disabled={syncing || !data?.account} onClick={() => void sync()} data-testid="kolaybi-sync">
        {syncing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <UploadCloud className="size-4" aria-hidden="true" />}
        {syncing ? t("accounting.kolaybiSyncing") : t("accounting.kolaybiSync")}
      </Button>
    </Card>
  );
}

/** Native select styled like the beta inputs (forms; list filters use FilterSelect). */
export function NativeSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:h-9 dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string | undefined }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5 text-sm font-medium", className)}>
      <span>{label}</span>
      {children}
    </label>
  );
}
