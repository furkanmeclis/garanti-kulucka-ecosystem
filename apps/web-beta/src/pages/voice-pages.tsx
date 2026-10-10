import { BarChart3, BookUser, Bot, FileAudio, FileBarChart, Loader2, MessageSquare, Phone, PhoneIncoming, PhoneOutgoing, RefreshCw, Save, Send, Type } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "@/app/auth";
import { DataList, ErrorState, Pagination, type Column } from "@/components/data-list";
import { FilterSelect, ListToolbar } from "@/components/list-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageHeader } from "@/layout/page-header";
import { formatDateTime } from "@/lib/format";
import { pageCount, pageSize, useListParams } from "@/lib/list-params";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import type { NetgsmCdrRecord, NetgsmTeyitSettings, PhonebookEntry, VoiceMessage, VoiceMessageStatus } from "@/lib/voice";
import { Hint } from "@/components/hint";
import { enumLabel } from "@/lib/status";
import { Switch } from "@/components/ui/switch";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { errorText, FeedbackLine, Field, idempotencyKey, FormSelect, type Feedback } from "./accounting-shared";

export function VoiceLinks({ current }: { current: "calls" | "voiceMessages" | "vapi" | "phonebook" }) {
  const { t } = useTranslation();
  const links = [
    { key: "calls", to: "/sesli-asistan", icon: Phone },
    { key: "voiceMessages", to: "/sesli-asistan/sesli-mesajlar", icon: MessageSquare },
    { key: "vapi", to: "/sesli-asistan/vapi", icon: Bot },
    { key: "phonebook", to: "/sesli-asistan/rehber", icon: BookUser },
  ] as const;
  return (
    <nav className="mb-4 flex flex-wrap gap-2" aria-label={t("nav.calls")} data-testid="voice-links">
      {links.map((link) => (
        <Button key={link.key} asChild variant={current === link.key ? "default" : "outline"} className="min-h-11">
          <Link to={link.to} aria-current={current === link.key ? "page" : undefined} data-testid={`voice-link-${link.key}`}>
            <link.icon className="size-4" aria-hidden="true" />
            {t(`nav.${link.key}`)}
          </Link>
        </Button>
      ))}
    </nav>
  );
}

/** /sesli-asistan — legacy AramaPage: NetGSM auto-confirmation call settings and call detail records (worker `netgsm.call.report`). */
export function CallsPage() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const settings = useQuery("calls:teyit", () => api.teyitSettings());
  const [form, setForm] = useState<NetgsmTeyitSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    if (settings.data) setForm(settings.data.settings);
  }, [settings.data]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setFeedback(null);
    try {
      setForm((await api.saveTeyitSettings(form)).settings);
      setFeedback({ tone: "success", text: t("calls.settingsSaved") });
    } catch (error) {
      setFeedback({ tone: "error", text: t("calls.saveFailed", { error: errorText(error) }) });
    } finally {
      setSaving(false);
    }
  }

  const number = (field: "ilk_arama_dakika" | "max_deneme" | "deneme_arasi_dakika", label: string, hint: string, max: number) => (
    <Field label={label}>
      <NumberInput
        min={1}
        max={max}
        value={form?.[field] ?? 1}
        onValueChange={(value) => form && setForm({ ...form, [field]: Math.round(value) })}
        className="h-11 lg:h-9"
        data-testid={`teyit-${field}`}
      />
      <span className="text-xs font-normal text-muted-foreground">{hint}</span>
    </Field>
  );

  return (
    <section data-testid="page-calls">
      <PageHeader brand="netgsm" title={t("calls.pageTitle")} description={t("calls.pageSubtitle")} />
      <VoiceLinks current="calls" />
      <Card className="mb-4 p-4">
        <h2 className="font-semibold">{t("calls.autoCallTitle")}</h2>
        <p className="mb-3 text-sm text-muted-foreground">{t("calls.autoCallSubtitle")}</p>
        {settings.error && !form ? (
          <ErrorState onRetry={settings.reload} />
        ) : !form ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t("calls.loading")} />
        ) : (
          <form className="flex flex-col gap-3" onSubmit={(event) => void save(event)} data-testid="teyit-form">
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <Switch checked={form.aktif} onCheckedChange={(next) => setForm({ ...form, aktif: next })} data-testid="teyit-aktif" />
              <span>
                <span className="font-medium">{t("calls.autoCallActive")}</span>
                <span className="block text-xs text-muted-foreground">{t("calls.autoCallActiveHint")}</span>
              </span>
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {number("ilk_arama_dakika", t("calls.firstCallLabel"), t("calls.firstCallHint"), 60)}
              {number("max_deneme", t("calls.maxAttemptsLabel"), t("calls.maxAttemptsHint"), 10)}
              {number("deneme_arasi_dakika", t("calls.retryIntervalLabel"), t("calls.retryIntervalHint"), 120)}
            </div>
            {form.aktif && (
              <p className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200" data-testid="teyit-summary">
                {t("calls.summaryLead")} {t("calls.summaryMinutes", { count: form.ilk_arama_dakika })} {t("calls.summaryAfterFirst")} {t("calls.summaryMinutes", { count: form.deneme_arasi_dakika })} {t("calls.summaryInterval")}{" "}
                {t("calls.summaryTimes", { count: form.max_deneme })} {t("calls.summaryTail")}
              </p>
            )}
            <FeedbackLine feedback={feedback} testId="teyit-feedback" />
            <Button type="submit" className="min-h-11 self-start" disabled={saving} data-testid="teyit-save">
              <Save className="size-4" aria-hidden="true" />
              {t("calls.save")}
            </Button>
          </form>
        )}
      </Card>
      <CallRecords />
    </section>
  );
}

function CallRecords() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [direction, setDirection] = useState<"gelen" | "giden" | "stats">("gelen");
  const [page, setPage] = useState(1);
  const [syncing, setSyncing] = useState(false);
  const records = useQuery(`calls:cdr:${direction}:${page}`, () => api.listCdr({ yon: direction === "giden" ? "giden" : "gelen", sayfa: page, sayfa_boyutu: pageSize }), { enabled: direction !== "stats" });
  const stats = useQuery("calls:cdr-stats", () => api.cdrStatistics(), { enabled: direction === "stats" });
  const data = records.data?.data;

  async function sync() {
    setSyncing(true);
    try {
      await api.syncCdr(idempotencyKey("cdr"));
    } catch {
      // The snapshot below still reloads; a failed queue call shows up as unchanged data.
    } finally {
      setSyncing(false);
      records.reload();
      stats.reload();
    }
  }

  const columns: Column<NetgsmCdrRecord>[] = [
    {
      key: "caller",
      header: t("calls.colCaller"),
      mobile: "title",
      cell: (row) => (
        <span className="flex items-center gap-1.5">
          {row.yonKod === 0 ? <PhoneOutgoing className="size-4 text-sky-600" aria-hidden="true" /> : <PhoneIncoming className="size-4 text-emerald-600" aria-hidden="true" />}
          <span className="font-medium">{row.arayanNumara ?? t("common.none")}</span>
        </span>
      ),
    },
    { key: "status", header: t("calls.colStatus"), mobile: "badge", cell: (row) => {
        const direction = row.yonKod === null ? (row.yon ?? t("common.none")) : enumLabel(t, "cdrDirection", row.yonKod);
        return (
          <Hint content={t("hints.cdrDirection", { direction })}>
            <Badge tone={row.yonKod === 2 ? "warning" : row.yonKod === 0 ? "info" : "success"}>{direction}</Badge>
          </Hint>
        );
      },
    },
    { key: "callee", header: t("calls.colCallee"), cell: (row) => row.arananNumara ?? t("common.none") },
    { key: "date", header: t("calls.colDate"), cell: (row) => row.tarih ?? t("common.none") },
    { key: "duration", header: t("calls.colDuration"), cell: (row) => row.sure },
    {
      key: "recording",
      header: t("calls.colRecording"),
      className: "max-w-none overflow-visible",
      cell: (row) => (row.sesKaydi ? <audio controls preload="none" src={row.sesKaydi} className="h-9 max-w-56" aria-label={t("calls.play")} /> : <span className="text-muted-foreground">{t("calls.noRecording")}</span>),
    },
  ];

  return (
    <Card className="p-4" data-testid="cdr">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">{t("calls.recordsTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("calls.recordsSubtitle")}</p>
        </div>
        <Button variant="outline" className="min-h-11" disabled={syncing} onClick={() => void sync()} data-testid="cdr-sync">
          <RefreshCw className={cn("size-4", syncing && "animate-spin")} aria-hidden="true" />
          {t("calls.refresh")}
        </Button>
      </div>
      <div className="mb-3 flex gap-1 overflow-x-auto border-b" role="tablist">
        {(
          [
            ["gelen", "tabIncoming"],
            ["giden", "tabOutgoing"],
            ["stats", "tabStatistics"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={direction === key}
            className={cn("inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium", direction === key ? "border-primary" : "border-transparent text-muted-foreground")}
            onClick={() => {
              setDirection(key);
              setPage(1);
            }}
            data-testid={`cdr-tab-${key}`}
          >
            {key === "gelen" ? <PhoneIncoming className="size-4" aria-hidden="true" /> : key === "giden" ? <PhoneOutgoing className="size-4" aria-hidden="true" /> : <BarChart3 className="size-4" aria-hidden="true" />}
            {t(`calls.${label}`)}
          </button>
        ))}
      </div>
      {direction === "stats" ? (
        stats.data ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="cdr-stats">
            {(
              [
                ["incomingCalls", String(stats.data.data.gelenArama), t("calls.answeredMissed", { answered: stats.data.data.gelenCevapli, missed: stats.data.data.gelenCevapsiz })],
                ["outgoingCalls", String(stats.data.data.gidenArama), t("calls.outgoingCallsHint")],
                ["totalDurationStat", stats.data.data.toplamSure, t("calls.averageDuration", { value: stats.data.data.ortalamaSure })],
                ["answerRate", t("calls.percentValue", { value: stats.data.data.cevaplananOran }), t("calls.answerRateHint")],
              ] as const
            ).map(([label, value, hint]) => (
              <div key={label} className="min-w-0 rounded-md border p-3">
                <p className="truncate text-sm text-muted-foreground">{t(`calls.${label}`)}</p>
                <p className="text-xl font-semibold">{value}</p>
                <p className="text-xs text-muted-foreground">{hint}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("calls.statisticsLoading")}</p>
        )
      ) : records.error && !records.data ? (
        <ErrorState onRetry={records.reload} />
      ) : records.data && !records.data.success ? (
        <p role="alert" className="text-sm text-destructive" data-testid="cdr-error">
          {t("calls.apiErrorTitle")}: {records.data.error ?? t("calls.apiError")}
        </p>
      ) : (
        <>
          {data && (
            <p className="mb-2 text-sm text-muted-foreground" data-testid="cdr-summary">
              {t("calls.recordCount")} <strong className="text-foreground">{data.toplamKayit}</strong> · {t("calls.totalDuration")} <strong className="text-foreground">{data.toplamSure}</strong>
              {records.data?.synced_at && ` · ${formatDateTime(records.data.synced_at, i18n.language)}`}
            </p>
          )}
          <DataList testId="cdr" rows={data?.kayitlar ?? []} columns={columns} rowKey={(row) => `${row.id ?? ""}${row.tarih ?? ""}${row.arayanNumara ?? ""}`} loading={records.loading} />
          {(data?.toplamKayit ?? 0) > pageSize && <Pagination page={page} pages={pageCount(data!.toplamKayit)} total={data!.toplamKayit} onPage={setPage} />}
        </>
      )}
    </Card>
  );
}

function parseRecipients(text: string) {
  return [...new Set(text.split(/[\n,;]+/).map((value) => value.replace(/[^\d+]/g, "")).filter((value) => /^\+?\d{10,15}$/.test(value)))].slice(0, 500);
}

const voiceStatuses: VoiceMessageStatus[] = ["queued", "sent", "failed", "dry_run"];
const callStatuses = ["cevaplandi", "cevaplanmadi", "mesgul", "ulasilamadi", "araniyor"] as const;

function VoiceStatusBadge({ status }: { status: VoiceMessageStatus }) {
  const { t } = useTranslation();
  const label = t(`voiceMessages.status_${status}`);
  return (
    <Hint content={t("hints.voiceStatus", { status: label })}>
      <Badge tone={status === "sent" ? "success" : status === "failed" ? "danger" : status === "dry_run" ? "warning" : "info"}>{label}</Badge>
    </Hint>
  );
}

/** /sesli-asistan/sesli-mesajlar — legacy SesliMesajlarPage: queue a NetGSM voice message (text or audio id) and read the per-number report. */
export function VoiceMessagesPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const list = useListParams(["status"] as const);
  const { status } = list.filters;
  const messages = useQuery(`voice:list:${list.query}:${status}:${list.page}`, () =>
    api.listVoiceMessages({ limit: pageSize, offset: list.offset, ...(status !== "all" ? { status: status as VoiceMessageStatus } : {}), ...(list.query ? { search: list.query } : {}) }),
  );
  const [recipients, setRecipients] = useState("");
  const [mode, setMode] = useState<"text" | "audio">("text");
  const [content, setContent] = useState("");
  const [ringtime, setRingtime] = useState(20);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const parsed = parseRecipients(recipients);

  async function send(event: FormEvent) {
    event.preventDefault();
    setFeedback(null);
    if (parsed.length === 0) return setFeedback({ tone: "error", text: t("voiceMessages.invalidRecipients") });
    if (!content.trim()) return setFeedback({ tone: "error", text: t("voiceMessages.contentRequired") });
    setSending(true);
    try {
      const result = await api.sendVoiceMessage({ recipients: parsed, ringtime, idempotency_key: idempotencyKey("voice"), ...(mode === "text" ? { message: content.trim() } : { audio_id: content.trim() }) });
      setFeedback({ tone: "success", text: `${result.replayed ? t("voiceMessages.replayed") : t("voiceMessages.queued", { count: result.voice_message.recipient_count })} ${t("voiceMessages.liveGateNote", { gate: result.live_gate })}` });
      setRecipients("");
      setContent("");
      messages.reload();
    } catch (error) {
      setFeedback({ tone: "error", text: t("voiceMessages.sendFailed", { error: errorText(error) }) });
    } finally {
      setSending(false);
    }
  }

  const rows = messages.data?.data ?? [];
  const total = messages.data?.total_count ?? 0;
  const columns: Column<VoiceMessage>[] = [
    {
      key: "content",
      header: t("voiceMessages.colContent"),
      mobile: "title",
      cell: (row) => (
        <button type="button" className="inline-flex min-h-11 max-w-full items-center truncate text-left font-medium text-primary underline-offset-4 hover:underline md:min-h-0" onClick={() => setSelected(row.public_id)} data-testid="voice-details">
          {row.message ?? t("voiceMessages.audioContent", { id: row.audio_id ?? "-" })}
        </button>
      ),
    },
    { key: "status", header: t("voiceMessages.colStatus"), mobile: "badge", cell: (row) => <VoiceStatusBadge status={row.status} /> },
    { key: "recipients", header: t("voiceMessages.colRecipients"), cell: (row) => String(row.recipient_count) },
    { key: "bulk", header: t("voiceMessages.colBulkId"), cell: (row) => row.bulk_id ?? t("common.none") },
    { key: "date", header: t("voiceMessages.colDate"), cell: (row) => formatDateTime(row.created_at, i18n.language) },
  ];
  const area = "min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:text-sm dark:bg-input/30";

  return (
    <section data-testid="page-voice-messages">
      <PageHeader brand="netgsm" title={t("voiceMessages.pageTitle")} description={t("voiceMessages.pageSubtitle")} />
      <VoiceLinks current="voiceMessages" />
      <Card className="mb-4 p-4">
        <form className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={(event) => void send(event)} data-testid="voice-form">
          <Field label={t("voiceMessages.recipientsLabel")} className="md:row-span-2">
            <Textarea className={area} rows={5} value={recipients} onChange={(event) => setRecipients(event.target.value)} placeholder="05551112233" data-testid="voice-recipients" />
            <span className="text-xs font-normal text-muted-foreground">
              {t("voiceMessages.recipientsHint")} · <strong data-testid="voice-recipient-count">{t("voiceMessages.recipientsCount", { count: parsed.length })}</strong>
            </span>
          </Field>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t("voiceMessages.contentLabel")}</span>
            <div className="flex gap-2">
              {(["text", "audio"] as const).map((value) => (
                <Button key={value} type="button" variant={mode === value ? "default" : "outline"} className="min-h-11 flex-1" aria-pressed={mode === value} onClick={() => setMode(value)} data-testid={`voice-mode-${value}`}>
                  {value === "text" ? <Type className="size-4" aria-hidden="true" /> : <FileAudio className="size-4" aria-hidden="true" />}
                  {t(value === "text" ? "voiceMessages.contentText" : "voiceMessages.contentAudio")}
                </Button>
              ))}
            </div>
            {mode === "text" ? (
              <Textarea className={area} rows={3} maxLength={1000} aria-label={t("voiceMessages.messageLabel")} value={content} onChange={(event) => setContent(event.target.value)} data-testid="voice-content" />
            ) : (
              <Input aria-label={t("voiceMessages.audioIdLabel")} maxLength={64} value={content} onChange={(event) => setContent(event.target.value)} className="h-11 md:h-9" data-testid="voice-content" />
            )}
          </div>
          <Field label={t("voiceMessages.ringtimeLabel")}>
            <FormSelect value={String(ringtime)} onChange={(event) => setRingtime(Number(event.target.value))} data-testid="voice-ringtime">
              {[10, 15, 20, 25, 30].map((value) => (
                <option key={value} value={value}>
                  {t("voiceMessages.seconds", { count: value })}
                </option>
              ))}
            </FormSelect>
          </Field>
          <div className="flex flex-col gap-2 md:col-span-2">
            <FeedbackLine feedback={feedback} testId="voice-feedback" />
            <Button type="submit" className="min-h-11 md:self-start" disabled={sending} data-testid="voice-send">
              {sending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
              {sending ? t("voiceMessages.sending") : t("voiceMessages.send")}
            </Button>
          </div>
        </form>
      </Card>
      <ListToolbar query={list.query} placeholder={t("voiceMessages.searchPlaceholder")} onQuery={(q) => list.update({ q })} hasFilters={list.hasFilters} onClear={list.clear}>
        <FilterSelect
          testId="filter-status"
          label={t("voiceMessages.colStatus")}
          value={status}
          onChange={(value) => list.update({ status: value })}
          options={[{ value: "all", label: t("voiceMessages.statusAll") }, ...voiceStatuses.map((value) => ({ value, label: t(`voiceMessages.status_${value}`) }))]}
        />
      </ListToolbar>
      {messages.error && !messages.data ? (
        <ErrorState onRetry={messages.reload} />
      ) : (
        <>
          <DataList testId="voice" rows={rows} columns={columns} rowKey={(row) => row.public_id} loading={messages.loading} />
          {total > pageSize && <Pagination page={list.page} pages={pageCount(total)} total={total} onPage={(page) => list.update({ page }, false)} />}
        </>
      )}
      <VoiceDetailSheet
        publicId={selected}
        onClose={() => {
          setSelected(null);
          messages.reload();
        }}
      />
    </section>
  );
}

function VoiceDetailSheet({ publicId, onClose }: { publicId: string | null; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [row, setRow] = useState<VoiceMessage | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);

  const load = async (id: string) => {
    try {
      setRow((await api.getVoiceMessage(id)).voice_message);
    } catch (error) {
      setFeedback({ tone: "error", text: t("voiceMessages.loadFailed", { error: errorText(error) }) });
    }
  };

  useEffect(() => {
    setRow(null);
    setFeedback(null);
    if (publicId) void load(publicId);
  }, [publicId]);

  async function report() {
    if (!row) return;
    setBusy(true);
    setFeedback(null);
    try {
      setRow((await api.requestVoiceReport(row.public_id, idempotencyKey("voice_report"))).voice_message);
      setFeedback({ tone: "success", text: t("voiceMessages.reportQueued") });
    } catch (error) {
      setFeedback({ tone: "error", text: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  const callKey = (status: string) => `voiceMessages.call_${(callStatuses as readonly string[]).includes(status) ? (status as (typeof callStatuses)[number]) : "araniyor"}` as const;

  return (
    <Sheet open={publicId !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" closeLabel={t("voiceMessages.close")} className="w-[min(32rem,100vw)] overflow-y-auto p-0" data-testid="voice-detail">
        <SheetHeader className="border-b p-4 pr-14">
          <SheetTitle>{t("voiceMessages.detailTitle")}</SheetTitle>
          <SheetDescription>{row ? formatDateTime(row.created_at, i18n.language) : t("voiceMessages.loading")}</SheetDescription>
        </SheetHeader>
        {!row && feedback && <div className="px-4"><FeedbackLine feedback={feedback} testId="voice-detail-feedback" /></div>}
        {row && (
          <div className="flex flex-col gap-3 px-4 pb-4 text-sm">
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
              <dt className="text-muted-foreground">{t("voiceMessages.colStatus")}</dt>
              <dd data-testid="voice-detail-status">
                <VoiceStatusBadge status={row.status} />
              </dd>
              <dt className="text-muted-foreground">{t("voiceMessages.colBulkId")}</dt>
              <dd data-testid="voice-detail-bulk">{row.bulk_id ?? t("common.none")}</dd>
              <dt className="text-muted-foreground">{t("voiceMessages.colContent")}</dt>
              <dd className="break-words">{row.message ?? t("voiceMessages.audioContent", { id: row.audio_id ?? "-" })}</dd>
              <dt className="text-muted-foreground">{t("voiceMessages.colRecipients")}</dt>
              <dd className="break-words">{row.recipients.join(", ")}</dd>
            </dl>
            {row.error_message && <p className="text-destructive">{row.error_message}</p>}
            <div className="flex flex-wrap gap-2">
              <Button className="min-h-11" disabled={busy || !row.bulk_id} onClick={() => void report()} data-testid="voice-request-report">
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <FileBarChart className="size-4" aria-hidden="true" />}
                {t("voiceMessages.requestReport")}
              </Button>
              <Button variant="outline" className="min-h-11" onClick={() => void load(row.public_id)} data-testid="voice-detail-refresh">
                <RefreshCw className="size-4" aria-hidden="true" />
                {t("voiceMessages.refresh")}
              </Button>
            </div>
            {!row.bulk_id && <p className="text-muted-foreground">{t("voiceMessages.reportUnavailable")}</p>}
            <FeedbackLine feedback={feedback} testId="voice-detail-feedback" />
            <h3 className="font-semibold">{t("voiceMessages.reportTitle")}</h3>
            {!row.report || row.report.rows.length === 0 ? (
              <p className="text-muted-foreground">{row.report?.message ?? t("voiceMessages.reportPending")}</p>
            ) : (
              <ul className="flex flex-col divide-y" data-testid="voice-report">
                {row.report.rows.map((entry, index) => (
                  <li key={`${entry.phone}-${index}`} className="flex items-center justify-between gap-2 py-2">
                    <span className="font-medium">{entry.phone}</span>
                    <span className="text-muted-foreground">
                      {t(callKey(entry.status))} · {entry.listen_seconds} sn{entry.pressed_key ? ` · ${entry.pressed_key}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** /sesli-asistan/rehber — legacy RehberPage: customer phones and staff SIP extensions; numbers dial through tel: links. */
export function PhonebookPage() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const list = useListParams(["kind"] as const);
  const { kind } = list.filters;
  const book = useQuery(`phonebook:${list.query}:${kind}:${list.page}`, () =>
    api.listPhonebook({ limit: pageSize, offset: list.offset, ...(kind === "customer" || kind === "staff" ? { kind } : {}), ...(list.query ? { search: list.query } : {}) }),
  );
  const rows = book.data?.data ?? [];
  const total = book.data?.total_count ?? 0;
  const dial = (value: string | null) =>
    value ? (
      <a href={`tel:${value.replace(/[^\d+*#]/g, "")}`} className="inline-flex min-h-11 min-w-11 items-center gap-1.5 text-primary underline-offset-4 hover:underline md:min-h-0 md:min-w-0" data-testid="phonebook-dial">
        <Phone className="size-3.5" aria-hidden="true" />
        {value}
      </a>
    ) : (
      t("common.none")
    );
  const columns: Column<PhonebookEntry>[] = [
    { key: "name", header: t("voiceMessages.colName"), mobile: "title", cell: (row) => <span className="font-medium">{row.name}</span> },
    { key: "kind", header: t("voiceMessages.colKind"), mobile: "badge", cell: (row) => (
        <Hint content={t("hints.phonebookKind", { kind: t(`voiceMessages.kind_${row.kind}`) })}>
          <Badge tone={row.kind === "staff" ? "info" : "neutral"}>{t(`voiceMessages.kind_${row.kind}`)}</Badge>
        </Hint>
      ),
    },
    { key: "phone", header: t("voiceMessages.colPhone"), cell: (row) => dial(row.phone) },
    { key: "extension", header: t("voiceMessages.colExtension"), cell: (row) => (row.kind === "staff" ? dial(row.extension) : t("common.none")) },
    { key: "role", header: t("voiceMessages.colRole"), cell: (row) => row.role ?? t("common.none") },
  ];

  return (
    <section data-testid="page-phonebook">
      <PageHeader title={t("voiceMessages.phonebookTitle")} description={t("voiceMessages.phonebookSubtitle")} />
      <VoiceLinks current="phonebook" />
      <ListToolbar query={list.query} placeholder={t("voiceMessages.phonebookSearch")} onQuery={(q) => list.update({ q })} hasFilters={list.hasFilters} onClear={list.clear}>
        <FilterSelect
          testId="filter-kind"
          label={t("voiceMessages.colKind")}
          value={kind}
          onChange={(value) => list.update({ kind: value })}
          options={[
            { value: "all", label: t("voiceMessages.kindAll") },
            { value: "customer", label: t("voiceMessages.kind_customer") },
            { value: "staff", label: t("voiceMessages.kind_staff") },
          ]}
        />
      </ListToolbar>
      {book.error && !book.data ? (
        <ErrorState onRetry={book.reload} />
      ) : (
        <>
          <DataList testId="phonebook" rows={rows} columns={columns} rowKey={(row) => `${row.kind}:${row.public_id}`} loading={book.loading} />
          {total > pageSize && <Pagination page={list.page} pages={pageCount(total)} total={total} onPage={(page) => list.update({ page }, false)} />}
        </>
      )}
    </section>
  );
}
