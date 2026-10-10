import { Bot, FlaskConical, History, ListOrdered, Loader2, PackageX, Phone, PhoneOutgoing, Play, Plus, RefreshCw, Trash2, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { DataList, ErrorState, Pagination, type Column } from "@/components/data-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageHeader } from "@/layout/page-header";
import { formatDateTime } from "@/lib/format";
import { pageCount, pageSize } from "@/lib/list-params";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import type { VapiCall, VapiCargoNotReceived, VapiQueueItem } from "@/lib/voice";
import { BrandIcon } from "@/components/brand-icons";
import { Hint } from "@/components/hint";
import { enumLabel } from "@/lib/status";
import { Checkbox } from "@/components/ui/checkbox";
import { SelectAllCheckbox } from "@/components/select-all";
import { Tip } from "@/components/ui/tooltip";
import { VoiceLinks } from "./voice-pages";
import { errorText, FeedbackLine, Field, idempotencyKey, FormSelect, type Feedback } from "./accounting-shared";

type Notify = (feedback: Feedback) => void;

const statusStyle: Record<string, { tone: "info" | "success" | "warning" | "danger" | "neutral"; label: string }> = {
  basladi: { tone: "info", label: "statusCalling" },
  cevaplandi: { tone: "success", label: "statusAnswered" },
  cevapsiz: { tone: "warning", label: "statusMissed" },
  tamamlandi: { tone: "success", label: "statusCompleted" },
  hata: { tone: "danger", label: "statusError" },
  iptal: { tone: "neutral", label: "statusCancelled" },
  bekliyor: { tone: "info", label: "statusWaiting" },
  araniyor: { tone: "info", label: "statusDialing" },
  basarisiz: { tone: "danger", label: "statusFailed" },
};

function VapiStatus({ status }: { status: string | null | undefined }) {
  const { t } = useTranslation();
  const style = statusStyle[status ?? ""];
  const label = style ? t(`vapi.${style.label}` as "vapi.statusWaiting") : status ? t("common.unknownValue", { value: status }) : t("vapi.statusWaiting");
  return (
    <Hint content={t("hints.vapiStatus", { status: label })}>
      <Badge tone={style?.tone ?? "neutral"}>{label}</Badge>
    </Hint>
  );
}

function duration(seconds: number | null | undefined) {
  if (!seconds) return "—";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function CargoTag({ provider }: { provider: string | null | undefined }) {
  const { t } = useTranslation();
  const ptt = (provider ?? "").toLowerCase() === "ptt";
  return (
    <Hint content={t("hints.carrier", { carrier: ptt ? "PTT Kargo" : "Sürat Kargo" })}>
      <Badge tone={ptt ? "warning" : "info"}>
        <BrandIcon brand={ptt ? "ptt" : "surat"} title="" className="size-3.5" />
        {ptt ? "PTT" : "Sürat"}
      </Badge>
    </Hint>
  );
}

type Tab = "cargo" | "queue" | "history" | "test";

const tabIcons: Record<Tab, LucideIcon> = { cargo: PackageX, queue: ListOrdered, history: History, test: FlaskConical };

function VapiTabIcon({ tab }: { tab: Tab }) {
  const Icon = tabIcons[tab];
  return <Icon className="size-4" aria-hidden="true" />;
}
const tabs: Array<{ id: Tab; label: "tabCargoNotReceived" | "tabQueue" | "tabHistory" | "tabTest" }> = [
  { id: "cargo", label: "tabCargoNotReceived" },
  { id: "queue", label: "tabQueue" },
  { id: "history", label: "tabHistory" },
  { id: "test", label: "tabTest" },
];

/** /sesli-asistan/vapi — legacy VapiAramalarPage: cargo-not-received list, call queue, call history and the dry-run test call. VAPI is only reached by the worker behind `providers.vapi.live_mode`. */
export function VapiPage() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [tab, setTab] = useState<Tab>("cargo");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const stats = useQuery("vapi:stats", () => api.vapiStatistics());

  return (
    <section data-testid="page-vapi">
      <PageHeader title={t("vapi.pageTitle")} description={t("vapi.pageSubtitle")} />
      <VoiceLinks current="vapi" />
      {stats.data && (
        <div className="mb-4 grid grid-cols-3 gap-3" data-testid="vapi-stats">
          {(
            [
              ["statTotalCalls", String(stats.data.statistics.toplam_arama)],
              ["statSuccessRate", t("vapi.percentValue", { value: stats.data.statistics.basari_orani })],
              ["statInQueue", String(stats.data.statistics.kuyruk_bekleyen)],
            ] as const
          ).map(([label, value]) => (
            <Card key={label} className="min-w-0 p-3">
              <p className="truncate text-sm text-muted-foreground">{t(`vapi.${label}`)}</p>
              <p className="text-xl font-semibold">{value}</p>
            </Card>
          ))}
        </div>
      )}
      <div className="mb-3">
        <FeedbackLine feedback={feedback} testId="vapi-feedback" />
      </div>
      <div className="mb-3 flex gap-1 overflow-x-auto border-b" role="tablist">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={cn("inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium", tab === id ? "border-primary" : "border-transparent text-muted-foreground")}
            onClick={() => setTab(id)}
            data-testid={`vapi-tab-${id}`}
          >
            <VapiTabIcon tab={id} />
            {t(`vapi.${label}`)}
          </button>
        ))}
      </div>
      {tab === "cargo" && <CargoNotReceivedTab notify={setFeedback} />}
      {tab === "queue" && <QueueTab notify={setFeedback} onChange={stats.reload} />}
      {tab === "history" && <HistoryTab />}
      {tab === "test" && <TestCallPanel notify={setFeedback} />}
    </section>
  );
}

function CargoNotReceivedTab({ notify }: { notify: Notify }) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [provider, setProvider] = useState("tumu");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const list = useQuery(`vapi:cargo:${provider}:${page}`, () => api.listVapiCargoNotReceived({ provider, page, page_size: pageSize }));
  const rows = list.data?.data ?? [];
  const total = list.data?.total ?? 0;

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  async function addToQueue() {
    const picked = rows.filter((row) => selected.has(row.id));
    if (picked.length === 0) return notify({ tone: "error", text: t("vapi.selectAtLeastOneCargo") });
    setAdding(true);
    try {
      const result = await api.addToVapiQueue(
        picked.map((row) => ({
          shipment_public_id: row.shipment_public_id,
          customer_phone: row.alici_telefon,
          customer_name: row.alici_ad,
          cargo_provider: row.kargo_firmasi,
          ...(row.takip_no ? { tracking_number: row.takip_no } : {}),
          last_event_text: row.son_hareket,
        })),
        idempotencyKey("vapi_queue"),
      );
      notify({ tone: "success", text: result.atlanan ? t("vapi.addedToQueueSkipped", { added: result.eklenen, skipped: result.atlanan }) : t("vapi.addedToQueue", { added: result.eklenen }) });
      setSelected(new Set());
      list.reload();
    } catch (error) {
      notify({ tone: "error", text: `${t("vapi.addError")} ${errorText(error)}` });
    } finally {
      setAdding(false);
    }
  }

  const columns: Column<VapiCargoNotReceived>[] = [
    {
      key: "customer",
      header: t("vapi.colCustomer"),
      mobile: "title",
      cell: (row) => (
        <label className="flex min-h-11 items-center gap-3 md:min-h-0">
          <Checkbox aria-label={t("vapi.selectRow", { name: row.alici_ad })} checked={selected.has(row.id)} onCheckedChange={() => toggle(row.id)} data-testid="vapi-cargo-select" />
          <span className="min-w-0">
            <span className="block font-medium">{row.alici_ad || "—"}</span>
            <span className="block text-xs text-muted-foreground">{row.alici_telefon}</span>
          </span>
        </label>
      ),
    },
    {
      key: "status",
      header: t("vapi.colStatus"),
      mobile: "badge",
      cell: (row) => (row.kuyrukta ? <VapiStatus status={row.kuyruk_durumu} /> : <span className="text-xs text-muted-foreground">{row.son_24s_arandi ? t("vapi.calledLast24h") : t("vapi.notCalled")}</span>),
    },
    {
      key: "cargo",
      header: t("vapi.colCargo"),
      cell: (row) => (
        <span className="flex items-center gap-2">
          <CargoTag provider={row.kargo_firmasi} />
          <span className="font-mono text-xs">{row.takip_no || "—"}</span>
        </span>
      ),
    },
    {
      key: "event",
      header: t("vapi.colLastEvent"),
      cell: (row) => (
        <span className="block min-w-0">
          <span className="block break-words">{row.son_hareket || "—"}</span>
          <span className="block text-xs text-muted-foreground">{row.son_hareket_tarihi ? formatDateTime(row.son_hareket_tarihi, i18n.language) : "—"}</span>
        </span>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FormSelect className="sm:w-48" aria-label={t("vapi.cargoProvider")} value={provider} onChange={(event) => { setProvider(event.target.value); setPage(1); }} data-testid="vapi-cargo-provider">
          <option value="tumu">{t("vapi.allCargo")}</option>
          <option value="ptt">{t("vapi.pttCargo")}</option>
          <option value="surat">{t("vapi.suratCargo")}</option>
        </FormSelect>
        <Button variant="outline" className="min-h-11" onClick={list.reload} disabled={list.loading}>
          <RefreshCw className={cn("size-4", list.loading && "animate-spin")} aria-hidden="true" />
          {t("vapi.refresh")}
        </Button>
        {rows.length > 0 && (
          <SelectAllCheckbox
            total={rows.length}
            selected={rows.filter((row) => selected.has(row.id)).length}
            onChange={(all) => setSelected(all ? new Set(rows.map((row) => row.id)) : new Set())}
            label={t("vapi.selectAll")}
            testId="vapi-cargo-select-all"
          />
        )}
        {selected.size > 0 && (
          <Button className="min-h-11" onClick={() => void addToQueue()} disabled={adding} data-testid="vapi-add-queue">
            {adding ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
            {t("vapi.addPeopleToQueue", { count: selected.size })}
          </Button>
        )}
        <span className="text-sm text-muted-foreground sm:ml-auto" data-testid="vapi-cargo-count">{t("vapi.cargoNotReceivedCount", { count: total })}</span>
      </div>
      {list.error && !list.data ? (
        <ErrorState onRetry={list.reload} />
      ) : (
        <>
          <DataList testId="vapi-cargo" rows={rows} columns={columns} rowKey={(row) => row.id} loading={list.loading} />
          {total > pageSize && <Pagination page={page} pages={pageCount(total)} total={total} onPage={setPage} />}
        </>
      )}
    </div>
  );
}

function QueueTab({ notify, onChange }: { notify: Notify; onChange: () => void }) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [status, setStatus] = useState("tumu");
  const [page, setPage] = useState(1);
  const [bulkBusy, setBulkBusy] = useState(false);
  const list = useQuery(`vapi:queue:${status}:${page}`, () => api.listVapiQueue({ status, page, page_size: pageSize }));
  const rows = list.data?.data ?? [];
  const total = list.data?.total ?? 0;
  const waiting = rows.filter((row) => row.durum === "bekliyor").length;
  const refresh = () => {
    list.reload();
    onChange();
  };

  async function call(item: VapiQueueItem) {
    try {
      await api.startVapiCall({
        queue_public_id: item.public_id,
        customer_phone: item.musteri_telefon,
        ...(item.musteri_adi ? { customer_name: item.musteri_adi } : {}),
        ...(item.kargo_firmasi ? { cargo_provider: item.kargo_firmasi } : {}),
        ...(item.takip_no ? { tracking_number: item.takip_no } : {}),
        ...(item.son_hareket ? { last_event_text: item.son_hareket } : {}),
        idempotency_key: `vapi_call_${item.public_id}_${item.deneme_sayisi + 1}`,
      });
      notify({ tone: "success", text: t("vapi.callingCustomer", { name: item.musteri_adi || item.musteri_telefon }) });
      refresh();
    } catch (error) {
      notify({ tone: "error", text: `${t("vapi.callStartFailed")} ${errorText(error)}` });
    }
  }

  async function remove(item: VapiQueueItem) {
    try {
      await api.deleteVapiQueueItem(item.public_id);
      notify({ tone: "success", text: t("vapi.removedFromQueue") });
      refresh();
    } catch {
      notify({ tone: "error", text: t("vapi.deleteError") });
    }
  }

  async function bulk() {
    setBulkBusy(true);
    try {
      const result = await api.startVapiBulkCalls(idempotencyKey("vapi_bulk"));
      notify({ tone: "success", text: result.hatali ? t("vapi.bulkCalledWithErrors", { called: result.aranan, failed: result.hatali }) : t("vapi.bulkCalled", { called: result.aranan }) });
      refresh();
    } catch (error) {
      notify({ tone: "error", text: `${t("vapi.bulkCallStartFailed")} ${errorText(error)}` });
    } finally {
      setBulkBusy(false);
    }
  }

  const columns: Column<VapiQueueItem>[] = [
    {
      key: "customer",
      header: t("vapi.colCustomer"),
      mobile: "title",
      cell: (row) => (
        <span className="block min-w-0">
          <span className="block font-medium">{row.musteri_adi || "—"}</span>
          <span className="block text-xs text-muted-foreground">{row.musteri_telefon}</span>
        </span>
      ),
    },
    {
      key: "status",
      header: t("vapi.colStatus"),
      mobile: "badge",
      cell: (row) => <VapiStatus status={row.durum} />,
    },
    {
      key: "cargo",
      header: t("vapi.colCargo"),
      cell: (row) => (
        <span className="flex items-center gap-2">
          <CargoTag provider={row.kargo_firmasi} />
          <span className="font-mono text-xs">{row.takip_no || "—"}</span>
        </span>
      ),
    },
    { key: "event", header: t("vapi.colLastEvent"), cell: (row) => row.son_hareket || "—" },
    {
      key: "attempt",
      header: t("vapi.colAttempt"),
      cell: (row) => (
        <span>
          {row.deneme_sayisi}/{row.max_deneme || 3}
          {row.son_arama_zamani && <span className="block text-xs text-muted-foreground">{t("vapi.lastCall", { date: formatDateTime(row.son_arama_zamani, i18n.language) })}</span>}
        </span>
      ),
    },
    {
      key: "actions",
      header: t("vapi.colAction"),
      cell: (row) => (
        <span className="flex gap-2">
          {row.durum === "bekliyor" && (
            <Tip label={t("vapi.callNow")}><Button size="icon" variant="outline" className="size-11 md:size-9" aria-label={t("vapi.callNow")} onClick={() => void call(row)} data-testid="vapi-call-now">
              <PhoneOutgoing className="size-4" aria-hidden="true" />
            </Button></Tip>
          )}
          <Tip label={t("vapi.removeFromQueue")}><Button size="icon" variant="outline" className="size-11 text-destructive md:size-9" aria-label={t("vapi.removeFromQueue")} onClick={() => void remove(row)} data-testid="vapi-queue-delete">
            <Trash2 className="size-4" aria-hidden="true" />
          </Button></Tip>
        </span>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FormSelect className="sm:w-48" aria-label={t("vapi.queueStatus")} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} data-testid="vapi-queue-status">
          <option value="tumu">{t("vapi.allStatuses")}</option>
          <option value="bekliyor">{t("vapi.statusWaiting")}</option>
          <option value="araniyor">{t("vapi.statusDialing")}</option>
          <option value="tamamlandi">{t("vapi.statusCompleted")}</option>
          <option value="basarisiz">{t("vapi.statusFailed")}</option>
        </FormSelect>
        <Button variant="outline" className="min-h-11" onClick={refresh} disabled={list.loading}>
          <RefreshCw className={cn("size-4", list.loading && "animate-spin")} aria-hidden="true" />
          {t("vapi.refresh")}
        </Button>
        {waiting > 0 && (
          <Button className="min-h-11 sm:ml-auto" onClick={() => void bulk()} disabled={bulkBusy} data-testid="vapi-bulk-call">
            {bulkBusy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
            {t("vapi.startBulkCall", { count: waiting })}
          </Button>
        )}
      </div>
      {list.error && !list.data ? (
        <ErrorState onRetry={list.reload} />
      ) : (
        <>
          <DataList testId="vapi-queue" rows={rows} columns={columns} rowKey={(row) => row.public_id} loading={list.loading} />
          {total > pageSize && <Pagination page={page} pages={pageCount(total)} total={total} onPage={setPage} />}
        </>
      )}
    </div>
  );
}

function HistoryTab() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [status, setStatus] = useState("tumu");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<VapiCall | null>(null);
  const list = useQuery(`vapi:calls:${status}:${query}:${page}`, () => api.listVapiCalls({ status, page, page_size: pageSize, ...(query.trim() ? { q: query.trim() } : {}) }));
  const rows = list.data?.data ?? [];
  const total = list.data?.total ?? 0;

  async function open(row: VapiCall) {
    setSelected(row);
    try {
      setSelected((await api.getVapiCall(row.public_id)).call);
    } catch {
      // The list row stays visible when the detail backfill fails.
    }
  }

  const columns: Column<VapiCall>[] = [
    {
      key: "customer",
      header: t("vapi.colCustomer"),
      mobile: "title",
      cell: (row) => (
        <button type="button" className="inline-flex min-h-11 flex-col items-start text-left md:min-h-0" onClick={() => void open(row)} data-testid="vapi-call-open">
          <span className="font-medium text-primary underline-offset-4 hover:underline">{row.musteri_adi || "—"}</span>
          <span className="text-xs text-muted-foreground">{row.musteri_telefon}</span>
        </button>
      ),
    },
    { key: "status", header: t("vapi.colStatus"), mobile: "badge", cell: (row) => <VapiStatus status={row.durum} /> },
    { key: "date", header: t("vapi.colDate"), cell: (row) => formatDateTime(row.baslangic, i18n.language) },
    {
      key: "cargo",
      header: t("vapi.colCargo"),
      cell: (row) => (
        <span className="flex items-center gap-2">
          <CargoTag provider={row.kargo_firmasi} />
          <span className="font-mono text-xs">{row.takip_no || "—"}</span>
        </span>
      ),
    },
    { key: "duration", header: t("vapi.colDuration"), cell: (row) => <span className="font-mono">{duration(row.sure_sn)}</span> },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          className="h-11 sm:w-64 md:h-9"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder={t("vapi.historySearchPlaceholder")}
          aria-label={t("vapi.historySearchLabel")}
          data-testid="vapi-calls-search"
        />
        <FormSelect className="sm:w-48" aria-label={t("vapi.callStatus")} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} data-testid="vapi-calls-status">
          <option value="tumu">{t("vapi.allStatuses")}</option>
          <option value="tamamlandi">{t("vapi.statusCompleted")}</option>
          <option value="cevaplandi">{t("vapi.statusAnswered")}</option>
          <option value="cevapsiz">{t("vapi.statusMissed")}</option>
          <option value="hata">{t("vapi.statusError")}</option>
        </FormSelect>
        <Button variant="outline" size="icon" className="size-11 md:size-9" onClick={list.reload} aria-label={t("vapi.refresh")}>
          <RefreshCw className={cn("size-4", list.loading && "animate-spin")} aria-hidden="true" />
        </Button>
        <span className="text-sm text-muted-foreground sm:ml-auto" data-testid="vapi-calls-count">{t("vapi.callRecordCount", { count: total })}</span>
      </div>
      {list.error && !list.data ? (
        <ErrorState onRetry={list.reload} />
      ) : (
        <>
          <DataList testId="vapi-calls" rows={rows} columns={columns} rowKey={(row) => row.public_id} loading={list.loading} />
          {total > pageSize && <Pagination page={page} pages={pageCount(total)} total={total} onPage={setPage} />}
        </>
      )}
      <CallDetail call={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function transcriptLines(transcript: unknown): Array<Record<string, unknown>> | null {
  return Array.isArray(transcript) ? (transcript as Array<Record<string, unknown>>) : null;
}

function CallDetail({ call, onClose }: { call: VapiCall | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const lines = call ? transcriptLines(call.transkript) : null;
  return (
    <Sheet open={call !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" closeLabel={t("vapi.close")} className="w-[min(32rem,100vw)] overflow-y-auto p-0" data-testid="vapi-call-detail">
        <SheetHeader className="border-b p-4 pr-14">
          <SheetTitle>{t("vapi.callDetail")}</SheetTitle>
          <SheetDescription className="break-all">{call?.vapi_call_id || call?.public_id}</SheetDescription>
        </SheetHeader>
        {call && (
          <div className="flex flex-col gap-4 px-4 pb-4 text-sm">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
              <dt className="text-muted-foreground">{t("vapi.colCustomer")}</dt>
              <dd>
                {call.musteri_adi || "—"} · {call.musteri_telefon}
              </dd>
              <dt className="text-muted-foreground">{t("vapi.colCargo")}</dt>
              <dd>
                {(call.kargo_firmasi ?? "").toLowerCase() === "ptt" ? t("vapi.pttCargo") : t("vapi.suratCargo")} · <span className="font-mono">{call.takip_no || "—"}</span>
              </dd>
              <dt className="text-muted-foreground">{t("vapi.colStatus")}</dt>
              <dd data-testid="vapi-detail-status">
                <VapiStatus status={call.durum} />
              </dd>
              <dt className="text-muted-foreground">{t("vapi.colDuration")}</dt>
              <dd className="font-mono" data-testid="vapi-detail-duration">
                {duration(call.sure_sn)}
                {call.maliyet && ` · $${Number.parseFloat(call.maliyet).toFixed(4)}`}
              </dd>
              <dt className="text-muted-foreground">{t("vapi.start")}</dt>
              <dd>{formatDateTime(call.baslangic, i18n.language)}</dd>
              <dt className="text-muted-foreground">{t("vapi.end")}</dt>
              <dd>{call.bitis ? formatDateTime(call.bitis, i18n.language) : "—"}</dd>
            </dl>
            {call.son_hareket && (
              <div>
                <p className="text-muted-foreground">{t("vapi.cargoStatusAtCall")}</p>
                <p className="text-amber-700 dark:text-amber-300">{call.son_hareket}</p>
              </div>
            )}
            {call.hata_mesaji && <p className="text-destructive">{call.hata_mesaji}</p>}
            {call.arama_ozeti && (
              <div className="rounded-md bg-violet-500/10 p-3" data-testid="vapi-detail-summary">
                <p className="mb-1 flex items-center gap-1.5 font-medium text-violet-800 dark:text-violet-200">
                  <Bot className="size-4" aria-hidden="true" />
                  {t("vapi.aiCallSummary")}
                </p>
                <p>{call.arama_ozeti}</p>
              </div>
            )}
            {call.transkript != null && call.transkript !== "" && (
              <div data-testid="vapi-detail-transcript">
                <p className="mb-2 text-muted-foreground">{t("vapi.transcript")}</p>
                <div className="flex flex-col gap-2">
                  {lines ? (
                    lines.map((line, index) => {
                      const ai = line.role === "assistant" || line.speaker === "assistant";
                      const text = line.text ?? line.content ?? line.message ?? JSON.stringify(line);
                      return (
                        <div key={index} className={cn("max-w-[85%] rounded-lg px-3 py-2", ai ? "self-start bg-muted" : "self-end bg-primary/10")}>
                          <span className="block text-xs font-medium text-muted-foreground">{ai ? "AI" : t("vapi.speakerCustomer")}</span>
                          {String(text)}
                        </div>
                      );
                    })
                  ) : (
                    <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">{typeof call.transkript === "string" ? call.transkript : JSON.stringify(call.transkript, null, 2)}</pre>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function TestCallPanel({ notify }: { notify: Notify }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);

  async function start() {
    if (!phone.trim()) return notify({ tone: "error", text: t("vapi.enterTestPhone") });
    setBusy(true);
    try {
      const attempt = await api.createVapiTestCall({
        customer_name: name.trim() || "Test Müşteri",
        customer_phone: phone.trim(),
        cargo_provider: "PTT",
        tracking_number: "279172790012",
        last_event_text: "şubede bekliyor",
        idempotency_key: `vapi_test_${phone.trim().replace(/[^0-9a-zA-Z_-]+/g, "_")}`,
      });
      setLast(`${enumLabel(t, "operation", attempt.operation)} ${attempt.request_id}`);
      notify({ tone: "success", text: t("vapi.testCallStarted") });
    } catch (error) {
      notify({ tone: "error", text: `${t("vapi.testCallFailed")} ${errorText(error)}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4" data-testid="vapi-test">
      <h2 className="flex items-center gap-2 font-semibold">
        <Phone className="size-4" aria-hidden="true" />
        {t("vapi.quickTestCall")}
      </h2>
      <p className="mb-3 text-sm text-muted-foreground">{t("vapi.quickTestCallDescription")}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t("vapi.testCustomerName")}>
          <Input className="h-11 md:h-9" value={name} onChange={(event) => setName(event.target.value)} placeholder={t("vapi.testCustomerNamePlaceholder")} data-testid="vapi-test-name" />
        </Field>
        <Field label={t("vapi.testPhone")}>
          <Input className="h-11 md:h-9" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={t("vapi.testPhonePlaceholder")} data-testid="vapi-test-phone" />
        </Field>
      </div>
      <Button className="mt-3 min-h-11" onClick={() => void start()} disabled={busy} data-testid="vapi-test-call">
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Phone className="size-4" aria-hidden="true" />}
        {t("vapi.call")}
      </Button>
      {last && (
        <p className="mt-2 text-sm text-muted-foreground" data-testid="vapi-test-last">
          {last} · {t("vapi.liveCallDisabled")} (providers.vapi.live_mode)
        </p>
      )}
    </Card>
  );
}
