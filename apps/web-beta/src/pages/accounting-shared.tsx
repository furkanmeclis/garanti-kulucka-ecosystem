import { Ban, CheckCircle2, Clock, FileText, Loader2, type LucideIcon } from "lucide-react";
import { Children, Fragment, isValidElement, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { BrandIcon } from "@/components/brand-icons";
import { Hint } from "@/components/hint";
import { ProviderLabel } from "@/components/provider-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
    <Hint content={[t("hints.syncStatus", { status: t(`accounting.${syncLabel[sync.status]}`) }), sync.error ? t("hints.error", { error: sync.error }) : null]}>
      <Badge tone={tone}>
        <BrandIcon brand="kolaybi" title="" className="size-3.5" />
        {t(`accounting.${syncLabel[sync.status]}`)}
      </Badge>
    </Hint>
  );
}

const statusLabel = { issued: "statusIssued", partially_paid: "statusPartiallyPaid", paid: "statusPaid", cancelled: "statusCancelled" } as const;
const statusIcon: Record<InvoiceStatus, LucideIcon> = { issued: FileText, partially_paid: Clock, paid: CheckCircle2, cancelled: Ban };

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const { t } = useTranslation();
  const tone = status === "paid" ? "success" : status === "partially_paid" ? "warning" : status === "cancelled" ? "danger" : "neutral";
  const Icon = statusIcon[status];
  return (
    <Hint content={t("hints.invoiceStatus", { status: t(`accounting.${statusLabel[status]}`) })}>
      <Badge tone={tone}>
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        {t(`accounting.${statusLabel[status]}`)}
      </Badge>
    </Hint>
  );
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
        <p className="font-medium">
          <ProviderLabel brand="kolaybi">{t("accounting.kolaybiTitle")}</ProviderLabel>
        </p>
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
        {syncing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <BrandIcon brand="kolaybi" title="" />}
        {syncing ? t("accounting.kolaybiSyncing") : t("accounting.kolaybiSync")}
      </Button>
    </Card>
  );
}

interface OptionData {
  value: string;
  label: ReactNode;
  text: string;
  disabled: boolean;
}

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function collectOptions(children: ReactNode, out: OptionData[] = []): OptionData[] {
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) return;
    if (child.type === "option") {
      const label = child.props.children;
      out.push({ value: String(child.props.value ?? textOf(label)), label, text: textOf(label), disabled: Boolean(child.props.disabled) });
    } else if (child.type === Fragment || child.type === "optgroup") {
      collectOptions(child.props.children, out);
    }
  });
  return out;
}

/** Radix Select reserves "" for "no value", so empty option values travel under this sentinel. */
const emptyValue = "__empty__";

export interface FormSelectProps {
  value: string | number;
  /** Event-shaped so call sites read `event.target.value` as with a native select. */
  onChange: (event: { target: { value: string } }) => void;
  /** `<option value="…">label</option>` children, as with a native select. */
  children: ReactNode;
  className?: string | undefined;
  disabled?: boolean | undefined;
  "aria-label"?: string | undefined;
  "data-testid"?: string | undefined;
  /** Long lists (cities, products, contacts…) get a type-to-filter Combobox; defaults to more than 10 options. */
  searchable?: boolean;
}

/**
 * The beta's form select: shadcn Select (Radix) for short lists, Combobox for long ones. It takes `<option>` children so
 * screens keep their markup; every option is `[role=option][data-value]` and the trigger keeps the `data-testid`.
 */
export function FormSelect({ value, onChange, children, className, disabled, searchable, ...rest }: FormSelectProps) {
  const { t } = useTranslation();
  const options = collectOptions(children);
  const current = String(value ?? "");
  const label = rest["aria-label"] ?? "";
  const testId = rest["data-testid"];
  const emit = (next: string) => onChange({ target: { value: next } });
  const trigger = "h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:h-9 dark:bg-input/30";
  if (searchable ?? options.length > 10) {
    return (
      <Combobox
        options={options.map((option) => ({ value: option.value, label: option.text }))}
        value={current}
        onChange={emit}
        label={label}
        placeholder={options.find((option) => option.value === "")?.text ?? t("common.select")}
        emptyText={t("common.empty")}
        disabled={Boolean(disabled)}
        triggerClassName={cn(trigger, className)}
        contentClassName="bg-popover text-popover-foreground"
        itemClassName="text-sm"
        activeItemClassName="bg-accent text-accent-foreground"
        selectedItemClassName="font-medium"
        inputClassName="text-sm"
        {...(testId ? { testId } : {})}
      />
    );
  }
  const known = options.some((option) => option.value === current);
  return (
    <Select {...(known ? { value: current || emptyValue } : { value: "" })} onValueChange={(next) => emit(next === emptyValue ? "" : next)} disabled={Boolean(disabled)}>
      <SelectTrigger className={cn("lg:h-9", className)} aria-label={label || undefined} data-value={current} data-testid={testId}>
        <SelectValue placeholder={t("common.select")} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value || emptyValue} value={option.value || emptyValue} disabled={option.disabled} data-value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function Field({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string | undefined }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5 text-sm font-medium", className)}>
      <span>{label}</span>
      {children}
    </label>
  );
}
