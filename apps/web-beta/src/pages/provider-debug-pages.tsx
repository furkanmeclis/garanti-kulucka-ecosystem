import { Bug, CheckCircle, ChevronDown, ChevronRight, Loader2, Play, RefreshCw, Search, Trash2, Truck, Wifi, WifiOff, XCircle } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/layout/page-header";
import { attemptOutcome, compactJson, requestPreview, type AttemptOutcome, type CronProvider, type ProviderAttempt } from "@/lib/debug";
import { formatDateTime } from "@/lib/format";
import { localeFor } from "@/i18n";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { errorText, FeedbackLine, idempotencyKey, NativeSelect, type Feedback } from "./accounting-shared";
import { StatTile } from "./debug-pages";

/**
 * Provider-attempt debug pages (web SuratDebugPage / CronDebugPage). Logs come from
 * `GET /admin/integrations/provider-attempts` (previews are redacted by the backend and again here);
 * the cron buttons call the backend dry-run trigger, never a live carrier API.
 */

const liveRefreshMs = 2000;
const logLimit = 200;
const outcomeTone: Record<AttemptOutcome, "success" | "danger" | "warning"> = { success: "success", error: "danger", recovered: "warning" };

function timeOf(value: string | null | undefined, language: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleTimeString(localeFor(language));
}

function LogActions({ live, onLive, loading, onRefresh, onClear, children }: { live: boolean; onLive: () => void; loading: boolean; onRefresh: () => void; onClear: () => void; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      {children}
      <Button variant={live ? "default" : "outline"} className="min-h-11" aria-pressed={live} onClick={onLive} data-testid="debug-live">
        {live ? <Wifi className="size-4" aria-hidden="true" /> : <WifiOff className="size-4" aria-hidden="true" />}
        {live ? t("debugPages.logs.liveAutoOn") : t("debugPages.logs.liveAutoOff")}
      </Button>
      <Button variant="outline" className="min-h-11" onClick={onRefresh} disabled={loading} data-testid="debug-refresh">
        <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" />
        {t("debugPages.refresh")}
      </Button>
      <Button variant="outline" className="min-h-11 text-destructive" onClick={onClear} data-testid="debug-clear">
        <Trash2 className="size-4" aria-hidden="true" />
        {t("debugPages.logs.clear")}
      </Button>
    </>
  );
}

function ApiError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <p role="alert" className="mb-4 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" data-testid="debug-api-error">
      <XCircle className="size-4 shrink-0" aria-hidden="true" />
      {t("debugPages.logs.apiError", { message: errorText(error) })}
    </p>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const { t } = useTranslation();
  return (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input type="search" className="h-11 pl-9 md:h-9" aria-label={t("debugPages.logs.search")} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} data-testid="debug-search" />
    </div>
  );
}

function EmptyLogs({ title, hint }: { title: string; hint: string }) {
  return (
    <Card className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground" data-testid="debug-logs-empty">
      <Bug className="size-8" aria-hidden="true" />
      <p className="font-medium">{title}</p>
      <p className="text-xs">{hint}</p>
    </Card>
  );
}

function DetailLine({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <p className={cn("min-w-0 break-words", className)}>
      <strong>{label}</strong> {children}
    </p>
  );
}

function JsonCode({ value }: { value: unknown }) {
  return <code className="font-mono text-xs break-all">{compactJson(value)}</code>;
}

/** One expandable log row: summary button, then the redacted request/response detail. */
function LogRow({ attempt, open, onToggle, summary, children }: { attempt: ProviderAttempt; open: boolean; onToggle: () => void; summary: ReactNode; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <li>
      <Card className={cn("overflow-hidden border-l-4", attemptOutcome(attempt) === "error" ? "border-l-red-500" : attemptOutcome(attempt) === "recovered" ? "border-l-amber-500" : "border-l-emerald-500")} data-testid={`debug-log-${attempt.public_id}`}>
        <button
          type="button"
          className="flex min-h-11 w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm hover:bg-muted/40"
          aria-expanded={open}
          onClick={onToggle}
          data-testid="debug-log-toggle"
        >
          {open ? <ChevronDown className="size-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="size-4 shrink-0" aria-hidden="true" />}
          <span className="sr-only">{t("debugPages.logs.showDetail")}</span>
          {summary}
        </button>
        {open && (
          <div className="flex flex-col gap-1.5 border-t bg-muted/30 px-3 py-3 text-xs" data-testid="debug-log-detail">
            {children}
          </div>
        )}
      </Card>
    </li>
  );
}

type OutcomeFilter = "all" | AttemptOutcome;
const suratEndpoints = [
  ["/kargoya-gonder", "endpointSend"],
  ["/kargo-takip", "endpointTrack"],
  ["/gonderi-sil", "endpointDelete"],
  ["/gonderi-geri-cek", "endpointWithdraw"],
] as const;

/** /kargolar/surat-debug — Sürat provider attempts, stats, filters and the live gate (web SuratDebugPage). */
export function SuratDebugPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [live, setLive] = useState(false);
  const query = useQuery(
    "debug:surat",
    async () => {
      const [attempts, catalog] = await Promise.all([api.listProviderAttempts({ provider_key: "surat", limit: 100 }), api.listProviderCatalog()]);
      return { attempts: attempts.data.filter((attempt) => attempt.provider_key === "surat"), catalog: catalog.data.find((item) => item.provider === "surat") ?? null, fetchedAt: new Date().toISOString() };
    },
    live ? { refreshMs: liveRefreshMs } : {},
  );
  const [clearedAt, setClearedAt] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [endpoint, setEndpoint] = useState("all");
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const visible = useMemo(() => (query.data?.attempts ?? []).filter((log) => !clearedAt || log.started_at > clearedAt), [query.data, clearedAt]);
  const stats = useMemo(() => {
    const durations = visible.map((log) => log.duration_ms);
    return {
      total: visible.length,
      success: visible.filter((log) => attemptOutcome(log) === "success").length,
      error: visible.filter((log) => attemptOutcome(log) === "error").length,
      recovered: visible.filter((log) => attemptOutcome(log) === "recovered").length,
      avg: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      min: durations.length ? Math.min(...durations) : 0,
      max: durations.length ? Math.max(...durations) : 0,
    };
  }, [visible]);
  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr-TR");
    return visible.filter((log) => {
      const preview = requestPreview(log);
      const path = preview?.path ?? "";
      if (endpoint !== "all" && !path.includes(endpoint)) return false;
      if (outcome !== "all" && attemptOutcome(log) !== outcome) return false;
      if (!q) return true;
      return [log.operation, log.request_id, log.error_message, path, compactJson(preview?.body)]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("tr-TR").includes(q));
    });
  }, [visible, search, endpoint, outcome]);
  const catalog = query.data?.catalog ?? null;

  return (
    <section data-testid="page-surat-debug">
      <PageHeader
        title={t("debugPages.surat.title")}
        description={t("debugPages.surat.lastRefresh", { time: timeOf(query.data?.fetchedAt, i18n.language), visible: visible.length, limit: logLimit })}
        actions={<LogActions live={live} onLive={() => setLive((value) => !value)} loading={query.loading} onRefresh={query.reload} onClear={() => setClearedAt(new Date().toISOString())} />}
      />
      <ApiError error={query.error} />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" data-testid="surat-debug-stats">
        <StatTile label={t("debugPages.surat.statTotal")} value={String(stats.total)} testId="surat-stat-total" />
        <StatTile label={t("debugPages.surat.statSuccess")} value={String(stats.success)} tone="success" testId="surat-stat-success" />
        <StatTile label={t("debugPages.surat.statError")} value={String(stats.error)} tone="danger" testId="surat-stat-error" />
        <StatTile label={t("debugPages.surat.statRecovered")} value={String(stats.recovered)} tone="warning" testId="surat-stat-recovered" />
        <StatTile label={t("debugPages.surat.statAvgDuration")} value={`${stats.avg}ms`} tone="info" testId="surat-stat-avg" />
        <StatTile label={t("debugPages.surat.statMinDuration")} value={`${stats.min}ms`} testId="surat-stat-min" />
        <StatTile label={t("debugPages.surat.statMaxDuration")} value={`${stats.max}ms`} testId="surat-stat-max" />
      </div>
      <Card className="mb-4 flex flex-col gap-1 p-3 text-sm sm:flex-row sm:flex-wrap sm:gap-4" data-testid="surat-debug-gate">
        <span>{t("debugPages.surat.liveGate", { state: catalog?.live_call_permitted ? t("debugPages.surat.gateOpen") : t("debugPages.surat.gateClosed") })}</span>
        <span className="font-mono text-xs break-all text-muted-foreground">{catalog?.live_feature_flag_key ?? "providers.surat.live_mode"}</span>
        <span className="font-mono text-xs break-all text-muted-foreground">{catalog?.live_block_reason ?? "-"}</span>
      </Card>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <SearchBox value={search} onChange={setSearch} placeholder={t("debugPages.surat.searchPlaceholder")} />
        <NativeSelect className="sm:w-48" aria-label={t("debugPages.surat.endpointLabel")} value={endpoint} onChange={(event) => setEndpoint(event.target.value)} data-testid="surat-endpoint-filter">
          <option value="all">{t("debugPages.surat.allEndpoints")}</option>
          {suratEndpoints.map(([path, label]) => (
            <option key={path} value={path}>
              {t(`debugPages.surat.${label}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect className="sm:w-44" aria-label={t("debugPages.surat.statusLabel")} value={outcome} onChange={(event) => setOutcome(event.target.value as OutcomeFilter)} data-testid="surat-status-filter">
          <option value="all">{t("debugPages.surat.allStatuses")}</option>
          <option value="success">{t("debugPages.surat.statSuccess")}</option>
          <option value="error">{t("debugPages.surat.statError")}</option>
          <option value="recovered">{t("debugPages.surat.statRecovered")}</option>
        </NativeSelect>
      </div>
      {filtered.length === 0 ? (
        query.loading && !query.data ? (
          <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : (
          <EmptyLogs title={t("debugPages.surat.emptyTitle")} hint={t("debugPages.surat.emptyHint")} />
        )
      ) : (
        <ul className="flex flex-col gap-2" data-testid="surat-debug-logs">
          {filtered.map((log) => {
            const preview = requestPreview(log);
            const result = attemptOutcome(log);
            const open = openId === log.public_id;
            return (
              <LogRow
                key={log.public_id}
                attempt={log}
                open={open}
                onToggle={() => setOpenId(open ? null : log.public_id)}
                summary={
                  <>
                    <span className="font-mono text-xs text-muted-foreground">{timeOf(log.started_at, i18n.language)}</span>
                    <span className="font-medium break-all">
                      {log.operation} / {log.direction}
                    </span>
                    <Badge tone={outcomeTone[result]}>
                      {log.status} / {log.retry_decision}
                    </Badge>
                    <span className="min-w-0 font-mono text-xs break-all text-muted-foreground">{preview ? `${preview.method} ${preview.path}` : "-"}</span>
                    <span className="font-mono text-xs text-muted-foreground">{log.duration_ms}ms</span>
                  </>
                }
              >
                <DetailLine label={t("debugPages.logs.request")}>
                  <span className="font-mono break-all">{log.request_id}</span>
                </DetailLine>
                {log.error_message && (
                  <DetailLine label={t("debugPages.logs.error")} className="text-destructive">
                    {log.error_code ?? ""} {log.error_message}
                  </DetailLine>
                )}
                <DetailLine label={t("debugPages.logs.headers")}>
                  <JsonCode value={preview?.headers} />
                </DetailLine>
                <DetailLine label={t("debugPages.logs.body")}>
                  <JsonCode value={preview?.body} />
                </DetailLine>
                <DetailLine label={t("debugPages.logs.response")}>
                  <JsonCode value={log.response_metadata} />
                </DetailLine>
                {preview?.live_call_performed === false && <p className="text-muted-foreground">{t("debugPages.logs.noLiveCall")}</p>}
              </LogRow>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const succeeded = (attempt: ProviderAttempt) => attempt.status !== "failed" && attempt.status !== "error";
const carrierName: Record<CronProvider, string> = { ptt: "PTT", surat: "Sürat" };

/** /kargolar/cron-debug — shipment tracking cron runs for PTT + Sürat and the dry-run triggers (web CronDebugPage). */
export function CronDebugPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [live, setLive] = useState(false);
  const query = useQuery(
    "debug:cron",
    async () => {
      const [ptt, surat] = await Promise.all([api.listProviderAttempts({ provider_key: "ptt", limit: 100 }), api.listProviderAttempts({ provider_key: "surat", limit: 100 })]);
      return { attempts: [...ptt.data, ...surat.data], fetchedAt: new Date().toISOString() };
    },
    live ? { refreshMs: liveRefreshMs } : {},
  );
  const [triggered, setTriggered] = useState<ProviderAttempt[]>([]);
  const [running, setRunning] = useState<CronProvider | "all" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [clearedAt, setClearedAt] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState<"all" | CronProvider>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const logs = useMemo(() => {
    const merged = [...triggered, ...(query.data?.attempts ?? [])]
      .filter((attempt) => (attempt.provider_key === "ptt" || attempt.provider_key === "surat") && attempt.operation === "shipment.track")
      .filter((attempt) => !clearedAt || attempt.started_at > clearedAt);
    const unique = [...new Map(merged.map((attempt) => [attempt.public_id, attempt])).values()];
    return unique.sort((a, b) => b.started_at.localeCompare(a.started_at));
  }, [triggered, query.data, clearedAt]);

  const summary = (carrier: CronProvider) => {
    const rows = logs.filter((log) => log.provider_key === carrier);
    return { last: rows[0]?.started_at ?? null, updated: rows.filter(succeeded).length, failed: rows.filter((log) => !succeeded(log)).length };
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr-TR");
    return logs.filter((log) => {
      if (provider !== "all" && log.provider_key !== provider) return false;
      if (!q) return true;
      return [log.request_id, log.error_message, requestPreview(log)?.path, compactJson(log.response_metadata)]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("tr-TR").includes(q));
    });
  }, [logs, search, provider]);

  async function trigger(target: CronProvider | "all") {
    setRunning(target);
    setFeedback(null);
    try {
      const carriers: CronProvider[] = target === "all" ? ["ptt", "surat"] : [target];
      const results = await Promise.all(carriers.map((carrier) => api.triggerProviderCronDebug(carrier, idempotencyKey(`cron_debug_${carrier}`))));
      setTriggered((current) => [...results, ...current.filter((log) => !results.some((item) => item.public_id === log.public_id))]);
      setFeedback({ tone: "success", text: t("debugPages.cron.triggered", { count: results.length }) });
    } catch (error) {
      setFeedback({ tone: "error", text: t("debugPages.logs.apiError", { message: errorText(error) }) });
    } finally {
      setRunning(null);
    }
  }

  const triggerButton = (target: CronProvider | "all", label: string, icon: ReactNode, testId: string) => (
    <Button variant={target === "all" ? "default" : "outline"} className="min-h-11" onClick={() => void trigger(target)} disabled={running !== null} data-testid={testId}>
      {running === target ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : icon}
      {label}
    </Button>
  );

  return (
    <section data-testid="page-cron-debug">
      <PageHeader
        title={t("debugPages.cron.title")}
        description={t("debugPages.cron.lastRefresh", { time: query.data ? formatDateTime(query.data.fetchedAt, i18n.language) : "-" })}
        actions={
          <LogActions live={live} onLive={() => setLive((value) => !value)} loading={query.loading} onRefresh={query.reload} onClear={() => setClearedAt(new Date().toISOString())}>
            {triggerButton("all", t("debugPages.cron.runAll"), <Play className="size-4" aria-hidden="true" />, "cron-run-all")}
            {triggerButton("ptt", t("debugPages.cron.pttCron"), <Truck className="size-4" aria-hidden="true" />, "cron-run-ptt")}
            {triggerButton("surat", t("debugPages.cron.suratCron"), <Truck className="size-4" aria-hidden="true" />, "cron-run-surat")}
          </LogActions>
        }
      />
      <ApiError error={query.error} />
      <FeedbackLine feedback={feedback} testId="cron-feedback" />
      <div className="my-4 grid grid-cols-1 gap-2 md:grid-cols-2" data-testid="cron-debug-cards">
        {(["ptt", "surat"] as const).map((carrier) => {
          const data = summary(carrier);
          return (
            <Card key={carrier} className="flex flex-col gap-2 p-4" data-testid={`cron-card-${carrier}`}>
              <p className="flex items-center gap-2 font-medium">
                <Truck className="size-4" aria-hidden="true" />
                {carrier === "ptt" ? t("debugPages.cron.pttCardTitle") : t("debugPages.cron.suratCardTitle")}
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span>
                  <span className="text-muted-foreground">{t("debugPages.cron.lastRun")}</span> {data.last ? formatDateTime(data.last, i18n.language) : "-"}
                </span>
                <span>
                  <span className="text-muted-foreground">{t("debugPages.cron.updated")}</span> <strong className="text-emerald-700 dark:text-emerald-300" data-testid={`cron-updated-${carrier}`}>{data.updated}</strong>
                </span>
                <span>
                  <span className="text-muted-foreground">{t("debugPages.cron.error")}</span> <strong className="text-red-700 dark:text-red-300" data-testid={`cron-failed-${carrier}`}>{data.failed}</strong>
                </span>
              </div>
              <p className="text-xs break-words text-muted-foreground">{t("debugPages.cron.dryRunNote", { provider: carrier })}</p>
            </Card>
          );
        })}
      </div>
      <div className="mb-2 flex flex-col gap-2 sm:flex-row">
        <SearchBox value={search} onChange={setSearch} placeholder={t("debugPages.cron.searchPlaceholder")} />
        <NativeSelect className="sm:w-44" aria-label={t("debugPages.cron.providerLabel")} value={provider} onChange={(event) => setProvider(event.target.value as "all" | CronProvider)} data-testid="cron-provider-filter">
          <option value="all">{t("debugPages.cron.allProviders")}</option>
          <option value="ptt">PTT</option>
          <option value="surat">Sürat</option>
        </NativeSelect>
      </div>
      <p className="mb-3 text-xs text-muted-foreground" data-testid="cron-showing">
        {t("debugPages.cron.showingCount", { filtered: filtered.length, total: logs.length })}
      </p>
      {filtered.length === 0 ? (
        query.loading && !query.data ? (
          <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : (
          <EmptyLogs title={t("debugPages.cron.emptyTitle")} hint={t("debugPages.cron.emptyHint")} />
        )
      ) : (
        <ul className="flex flex-col gap-2" data-testid="cron-debug-logs">
          {filtered.map((log) => {
            const preview = requestPreview(log);
            const open = openId === log.public_id;
            const carrier = log.provider_key as CronProvider;
            return (
              <LogRow
                key={log.public_id}
                attempt={log}
                open={open}
                onToggle={() => setOpenId(open ? null : log.public_id)}
                summary={
                  <>
                    {succeeded(log) ? <CheckCircle className="size-4 shrink-0 text-emerald-600" aria-hidden="true" /> : <XCircle className="size-4 shrink-0 text-red-600" aria-hidden="true" />}
                    <Badge tone={carrier === "ptt" ? "info" : "warning"}>{carrierName[carrier]}</Badge>
                    <Badge tone="outline">
                      {log.status} / {log.retry_decision}
                    </Badge>
                    <span className="min-w-0 font-mono text-xs break-all text-muted-foreground">{log.request_id}</span>
                    <span className="font-mono text-xs text-muted-foreground">{formatDateTime(log.started_at, i18n.language)}</span>
                    <span className="font-mono text-xs text-muted-foreground">{t("debugPages.cron.totalDuration", { seconds: (log.duration_ms / 1000).toFixed(1) })}</span>
                    {log.error_message && <span className="min-w-0 truncate text-xs text-destructive">{log.error_message}</span>}
                  </>
                }
              >
                <DetailLine label={t("debugPages.logs.endpoint")}>
                  <span className="font-mono break-all">{preview ? `${preview.method} ${preview.path}` : "-"}</span>
                </DetailLine>
                <DetailLine label={t("debugPages.logs.body")}>
                  <JsonCode value={preview?.body} />
                </DetailLine>
                <DetailLine label={t("debugPages.logs.response")}>
                  <JsonCode value={log.response_metadata} />
                </DetailLine>
              </LogRow>
            );
          })}
        </ul>
      )}
    </section>
  );
}
