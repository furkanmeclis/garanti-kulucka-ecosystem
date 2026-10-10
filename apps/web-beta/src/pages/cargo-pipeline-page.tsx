import { defaultCargoPipelineMessageTemplate, fillCargoPipelineTemplate, panelRoleOf } from "@garanti-kulucka/shared";
import { AlertCircle, AudioLines, Ban, CheckCircle, CheckCircle2, Clock, FlaskConical, Loader2, MessageSquare, MessageSquareText, PackageCheck, Phone, Play, RefreshCw, Save, Send, Settings2, SkipForward, Trash2, X, Zap, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "@/app/auth";
import { DataList, ErrorState, Pagination, type Column } from "@/components/data-list";
import { Hint } from "@/components/hint";
import { carrierBrand, channelBrand, ProviderLabel } from "@/components/provider-label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageHeader } from "@/layout/page-header";
import { carrierLabel, channelLabel, formatDateTime } from "@/lib/format";
import { cargoPipelineStatuses, type CargoPipelineAction, type CargoPipelineConfig, type CargoPipelineItem, type CargoPipelineStatus, type CargoPipelineTestType } from "@/lib/cargo-pipeline";
import { pageCount, pageSize } from "@/lib/list-params";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { TimeSelect } from "@/components/ui/date-picker";
import { NumberInput } from "@/components/ui/number-input";
import { useConfirm } from "@/components/confirm-dialog";
import { Tip } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { errorText, FeedbackLine, Field, idempotencyKey, FormSelect, type Feedback } from "./accounting-shared";

type Tone = "warning" | "info" | "success" | "danger" | "neutral";

const statusTone: Record<CargoPipelineStatus, Tone> = { bekliyor: "info", isleniyor: "warning", tamamlandi: "success", teslim: "success", hata: "danger", iptal: "neutral" };
const statusIcon: Record<CargoPipelineStatus, LucideIcon> = { bekliyor: Clock, isleniyor: RefreshCw, tamamlandi: CheckCircle2, teslim: PackageCheck, hata: AlertCircle, iptal: Ban };
const stepIcon: Record<string, LucideIcon> = { mesaj: MessageSquare, sms: MessageSquareText, vapi: AudioLines, tamamlandi: CheckCircle2, teslim: PackageCheck };
const finished = (row: CargoPipelineItem) => row.status === "tamamlandi" || row.status === "teslim" || row.status === "iptal";

/** Legacy KargoPipelineAyarlar inside a sheet (manager only). */
function ConfigSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [config, setConfig] = useState<CargoPipelineConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    if (!open) return;
    setFeedback(null);
    setConfig(null);
    api
      .cargoPipelineConfig()
      .then((response) => setConfig(response.config))
      .catch((error: unknown) => setFeedback({ tone: "error", text: t("cargoPipeline.actionFailed", { error: errorText(error) }) }));
  }, [open, api, t]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!config) return;
    setSaving(true);
    setFeedback(null);
    try {
      const response = await api.saveCargoPipelineConfig(config);
      setConfig(response.config);
      setFeedback({ tone: "success", text: t("cargoPipeline.configSaved") });
    } catch (error) {
      setFeedback({ tone: "error", text: t("cargoPipeline.actionFailed", { error: errorText(error) }) });
    } finally {
      setSaving(false);
    }
  }

  const number = (key: "mesaj_gecikme_dk" | "sms_gecikme_dk" | "vapi_gecikme_dk" | "max_deneme", min: number, max: number) =>
    config && (
      <Field label={t(`cargoPipeline.config_${key}`)}>
        <NumberInput
          min={min}
          max={max}
          className="h-11 lg:h-9"
          value={config[key]}
          onValueChange={(value) => setConfig({ ...config, [key]: Math.round(value) })}
          data-testid={`pipeline-config-${key}`}
        />
      </Field>
    );

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" closeLabel={t("cargoPipeline.close")} className="w-[min(30rem,100vw)] overflow-y-auto p-0" data-testid="pipeline-config-sheet">
        <SheetHeader className="border-b p-4 pr-14">
          <SheetTitle>{t("cargoPipeline.configTitle")}</SheetTitle>
          <SheetDescription>{t("cargoPipeline.configSubtitle")}</SheetDescription>
        </SheetHeader>
        {!config ? (
          <div className="p-4">
            {feedback ? <FeedbackLine feedback={feedback} testId="pipeline-config-feedback" /> : <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" aria-hidden="true" />}
          </div>
        ) : (
          <form className="flex flex-col gap-3 p-4" onSubmit={(event) => void save(event)}>
            <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
              <Switch checked={config.aktif} onCheckedChange={(next) => setConfig({ ...config, aktif: next })} data-testid="pipeline-config-active" />
              <span>
                {t("cargoPipeline.configActive")}
                <span className="block text-xs font-normal text-muted-foreground">{t("cargoPipeline.configActiveHint")}</span>
              </span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("cargoPipeline.configStart")}>
                <TimeSelect value={config.baslangic_saati} label={t("cargoPipeline.configStart")} onChange={(value) => setConfig({ ...config, baslangic_saati: value })} testId="pipeline-config-start" />
              </Field>
              <Field label={t("cargoPipeline.configEnd")}>
                <TimeSelect value={config.bitis_saati} label={t("cargoPipeline.configEnd")} onChange={(value) => setConfig({ ...config, bitis_saati: value })} testId="pipeline-config-end" />
              </Field>
              {number("mesaj_gecikme_dk", 0, 1440)}
              {number("sms_gecikme_dk", 0, 1440)}
              {number("vapi_gecikme_dk", 0, 1440)}
              {number("max_deneme", 1, 10)}
            </div>
            <Field label={t("cargoPipeline.configTemplate")}>
              <Textarea
                className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:text-sm dark:bg-input/30"
                maxLength={2000}
                value={config.mesaj_sablonu}
                onChange={(event) => setConfig({ ...config, mesaj_sablonu: event.target.value })}
                data-testid="pipeline-config-template"
              />
            </Field>
            <p className="text-xs text-muted-foreground">{t("cargoPipeline.configPlaceholders")}</p>
            <FeedbackLine feedback={feedback} testId="pipeline-config-feedback" />
            <Button type="submit" className="min-h-11" disabled={saving} data-testid="pipeline-config-save">
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
              {t("cargoPipeline.configSave")}
            </Button>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Legacy KargoPipelineTestPaneli (manager only): one SMS / channel message / VAPI test with the filled template. */
function TestSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [form, setForm] = useState({ customer: "", phone: "", tracking: "TEST-000", lastMove: "şubede bekliyor", provider: "PTT", conversation: "" });
  const [template, setTemplate] = useState(defaultCargoPipelineMessageTemplate);
  const [busy, setBusy] = useState<CargoPipelineTestType | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    if (!open) return;
    setFeedback(null);
    api
      .cargoPipelineConfig()
      .then((response) => setTemplate(response.config.mesaj_sablonu))
      .catch(() => undefined);
  }, [open, api]);

  const preview = useMemo(
    () => fillCargoPipelineTemplate(template, { customerName: form.customer || "Test Müşteri", trackingNumber: form.tracking || "TEST-000", lastEventText: form.lastMove || "şubede bekliyor", cargoProvider: form.provider }),
    [template, form],
  );

  async function send(type: CargoPipelineTestType) {
    if (!form.phone.trim()) return setFeedback({ tone: "error", text: t("cargoPipeline.testPhoneRequired") });
    if (type === "mesaj" && !form.conversation.trim()) return setFeedback({ tone: "error", text: t("cargoPipeline.testConversationRequired") });
    setBusy(type);
    setFeedback(null);
    try {
      const result = await api.testCargoPipeline({
        type,
        phone: form.phone.trim(),
        customer_name: form.customer.trim() || "Test Müşteri",
        tracking_number: form.tracking.trim() || "TEST-000",
        last_event_text: form.lastMove.trim() || "şubede bekliyor",
        cargo_provider: form.provider,
        ...(type === "mesaj" ? { conversation_public_id: form.conversation.trim() } : {}),
        idempotency_key: idempotencyKey(`pipeline-test-${type}`),
      });
      setFeedback(result.queued ? { tone: "success", text: t("cargoPipeline.testQueued", { gate: result.live_gate }) } : { tone: "error", text: t("cargoPipeline.testNotQueued") });
    } catch (error) {
      setFeedback({ tone: "error", text: t("cargoPipeline.testFailed", { error: errorText(error) }) });
    } finally {
      setBusy(null);
    }
  }

  const text = (key: keyof typeof form, label: string, testId?: string) => (
    <Field label={label}>
      <Input className="h-11 md:h-9" value={form[key]} onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))} {...(testId ? { "data-testid": testId } : {})} />
    </Field>
  );

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" closeLabel={t("cargoPipeline.close")} className="w-[min(30rem,100vw)] overflow-y-auto p-0" data-testid="pipeline-test-sheet">
        <SheetHeader className="border-b p-4 pr-14">
          <SheetTitle>{t("cargoPipeline.testTitle")}</SheetTitle>
          <SheetDescription>{t("cargoPipeline.testSubtitle")}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 p-4">
          {text("customer", t("cargoPipeline.testCustomer"))}
          {text("phone", t("cargoPipeline.testPhone"), "pipeline-test-phone")}
          <div className="grid grid-cols-2 gap-3">
            {text("tracking", t("cargoPipeline.testTracking"))}
            <Field label={t("cargoPipeline.testProvider")}>
              <FormSelect value={form.provider} onChange={(event) => setForm((prev) => ({ ...prev, provider: event.target.value }))}>
                <option value="PTT">PTT</option>
                <option value="Sürat">Sürat</option>
              </FormSelect>
            </Field>
          </div>
          {text("lastMove", t("cargoPipeline.testLastMove"))}
          {text("conversation", t("cargoPipeline.testConversation"), "pipeline-test-conversation")}
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="mb-1 text-xs font-medium text-muted-foreground">{t("cargoPipeline.testPreview")}</p>
            <p className="whitespace-pre-wrap break-words" data-testid="pipeline-test-preview">
              {preview}
            </p>
          </div>
          <FeedbackLine feedback={feedback} testId="pipeline-test-feedback" />
          <div className="grid gap-2 sm:grid-cols-3">
            <Button variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void send("sms")} data-testid="pipeline-test-sms">
              {busy === "sms" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
              {t("cargoPipeline.testSms")}
            </Button>
            <Button variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void send("mesaj")} data-testid="pipeline-test-message">
              {busy === "mesaj" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <MessageSquare className="size-4" aria-hidden="true" />}
              {t("cargoPipeline.testMessage")}
            </Button>
            <Button variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void send("vapi")} data-testid="pipeline-test-vapi">
              {busy === "vapi" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Phone className="size-4" aria-hidden="true" />}
              {t("cargoPipeline.testVapi")}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** /kargolar/pipeline — legacy KargoPipelinePage: teslim alınmayan kargo mesaj → SMS → VAPI akışı. */
export function CargoPipelinePage() {
  const confirm = useConfirm();
  const { t, i18n } = useTranslation();
  const { api, user } = useAuth();
  const manager = panelRoleOf(user?.role) === "manager";
  const stepLabel = (step: string) => (i18n.exists(`cargoPipeline.step_${step}`) ? t(`cargoPipeline.step_${step}` as "cargoPipeline.step_sms") : t("common.unknownValue", { value: step }));
  const pipelineStatusLabel = (value: string) => (i18n.exists(`cargoPipeline.status_${value}`) ? t(`cargoPipeline.status_${value}` as "cargoPipeline.status_hata") : t("common.unknownValue", { value }));
  const [status, setStatus] = useState<CargoPipelineStatus | "">("");
  const [page, setPage] = useState(1);
  // Legacy: 30 sn'de bir otomatik yenile.
  const list = useQuery(`cargo-pipeline:${status}:${page}`, () => api.listCargoPipeline({ page, page_size: pageSize, ...(status ? { status } : {}) }), { refreshMs: 30_000 });
  const [rows, setRows] = useState<CargoPipelineItem[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);

  useEffect(() => {
    if (list.data) {
      setRows(list.data.data);
      setTotal(list.data.total);
    }
  }, [list.data]);

  async function act(row: CargoPipelineItem, action: CargoPipelineAction) {
    setBusy(`${row.public_id}:${action}`);
    setFeedback(null);
    try {
      const { item } = await api.cargoPipelineAction(row.public_id, action);
      setRows((prev) => prev.map((entry) => (entry.public_id === item.public_id ? item : entry)));
      setFeedback({ tone: "success", text: action === "run_now" ? t("cargoPipeline.runNowDone") : t("cargoPipeline.actionDone") });
    } catch (error) {
      setFeedback({ tone: "error", text: t("cargoPipeline.actionFailed", { error: errorText(error) }) });
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: CargoPipelineItem) {
    if (!(await confirm(t("cargoPipeline.deleteConfirm"), { tone: "danger" }))) return;
    setBusy(`${row.public_id}:delete`);
    setFeedback(null);
    try {
      await api.deleteCargoPipelineItem(row.public_id);
      setRows((prev) => prev.filter((entry) => entry.public_id !== row.public_id));
      setTotal((prev) => Math.max(0, prev - 1));
      setFeedback({ tone: "success", text: t("cargoPipeline.deleted") });
    } catch (error) {
      setFeedback({ tone: "error", text: t("cargoPipeline.actionFailed", { error: errorText(error) }) });
    } finally {
      setBusy(null);
    }
  }

  const iconButton = (row: CargoPipelineItem, action: CargoPipelineAction | "delete", Icon: typeof Play, label: string, onClick: () => void, className?: string) => (
    <Tip label={label}><span className="inline-flex"><Button
      variant="ghost"
      size="icon"
      className={cn("size-11 md:size-9", className)}
      aria-label={label}
      disabled={busy !== null}
      onClick={onClick}
      data-testid={`pipeline-${action}`}
    >
      {busy === `${row.public_id}:${action}` ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Icon className="size-4" aria-hidden="true" />}
    </Button></span></Tip>
  );

  const columns: Column<CargoPipelineItem>[] = [
    {
      key: "customer",
      header: t("cargoPipeline.colCustomer"),
      mobile: "title",
      cell: (row) => (
        <span className="block min-w-0" data-testid={`pipeline-row-${row.public_id}`}>
          <span className="block font-medium">{row.customer_name ?? t("common.none")}</span>
          <span className="block text-xs text-muted-foreground">{row.phone ?? t("common.none")}</span>
          {row.tracking_number && <span className="block font-mono text-xs text-muted-foreground">{row.tracking_number}</span>}
        </span>
      ),
    },
    {
      key: "status",
      header: t("cargoPipeline.colStep"),
      mobile: "badge",
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          <Hint content={t("hints.pipelineStep", { step: stepLabel(row.step) })}>
            <Badge tone="neutral">
              <BadgeIcon icon={stepIcon[row.step]} />
              {stepLabel(row.step)}
            </Badge>
          </Hint>
          <Hint content={t("hints.pipelineStatus", { status: pipelineStatusLabel(row.status) })}>
            <Badge tone={statusTone[row.status] ?? "neutral"}>
              <BadgeIcon icon={statusIcon[row.status]} />
              {pipelineStatusLabel(row.status)}
            </Badge>
          </Hint>
        </span>
      ),
    },
    {
      key: "attempt",
      header: t("cargoPipeline.colAttempt"),
      cell: (row) => (
        <span className="block min-w-0">
          <Hint content={t("hints.pipelineAttempts")}>
            <span className="block">{t("cargoPipeline.attempt", { count: row.attempt_count, max: row.max_attempts })}</span>
          </Hint>
          {row.error_message && <Tip label={row.error_message}><span className="block max-w-64 truncate text-xs text-destructive">{row.error_message}</span></Tip>}
        </span>
      ),
    },
    {
      key: "channel",
      header: t("cargoPipeline.colChannel"),
      cell: (row) => (
        <span>
          {row.channel ? <ProviderLabel brand={channelBrand(row.channel)}>{channelLabel(row.channel)}</ProviderLabel> : t("common.none")}
          {row.cargo_provider && (
            <span className="block text-xs uppercase text-muted-foreground">
              <ProviderLabel brand={carrierBrand(row.cargo_provider)} iconClassName="size-3.5">
                {carrierLabel(row.cargo_provider, t("shipments.otherProvider"))}
              </ProviderLabel>
            </span>
          )}
        </span>
      ),
    },
    { key: "last", header: t("cargoPipeline.colLastMove"), cell: (row) => <Tip label={row.last_event_text ?? undefined}><span className="line-clamp-2">{row.last_event_text ?? t("common.none")}</span></Tip> },
    { key: "next", header: t("cargoPipeline.colNextRun"), cell: (row) => formatDateTime(row.next_run_at, i18n.language) },
    {
      key: "actions",
      header: t("cargoPipeline.colActions"),
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          {row.conversation_public_id && (
            <Tip label={t("cargoPipeline.openConversation")}><Button asChild variant="ghost" size="icon" className="size-11 md:size-9" aria-label={t("cargoPipeline.openConversation")}>
              <Link to={`/mesajlar?konusma=${encodeURIComponent(row.conversation_public_id)}`} data-testid="pipeline-open-conversation">
                <Zap className="size-4" aria-hidden="true" />
              </Link>
            </Button></Tip>
          )}
          {manager && !finished(row) && (
            <>
              {iconButton(row, "run_now", Play, t("cargoPipeline.runNow"), () => void act(row, "run_now"))}
              {iconButton(row, "skip", SkipForward, t("cargoPipeline.skip"), () => void act(row, "skip"))}
              {iconButton(row, "complete", CheckCircle, t("cargoPipeline.complete"), () => void act(row, "complete"))}
              {iconButton(row, "cancel", X, t("cargoPipeline.cancel"), () => void act(row, "cancel"))}
            </>
          )}
          {manager && iconButton(row, "delete", Trash2, t("cargoPipeline.delete"), () => void remove(row), "text-destructive")}
        </span>
      ),
    },
  ];

  return (
    <section data-testid="page-cargo-pipeline">
      <PageHeader
        title={t("cargoPipeline.title")}
        description={t("cargoPipeline.subtitle")}
        actions={
          <>
            {manager && (
              <>
                <Button variant="outline" className="min-h-11" onClick={() => setTestOpen(true)} data-testid="pipeline-open-test">
                  <FlaskConical className="size-4" aria-hidden="true" />
                  {t("cargoPipeline.testTitle")}
                </Button>
                <Button variant="outline" className="min-h-11" onClick={() => setConfigOpen(true)} data-testid="pipeline-open-config">
                  <Settings2 className="size-4" aria-hidden="true" />
                  {t("cargoPipeline.configTitle")}
                </Button>
              </>
            )}
            <Button variant="outline" className="min-h-11" onClick={list.reload} disabled={list.loading}>
              <RefreshCw className={cn("size-4", list.loading && "animate-spin")} aria-hidden="true" />
              {t("cargoPipeline.refresh")}
            </Button>
          </>
        }
      />
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <FormSelect
          className="sm:w-56"
          aria-label={t("cargoPipeline.colStep")}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as CargoPipelineStatus | "");
            setPage(1);
          }}
          data-testid="pipeline-filter"
        >
          <option value="">{t("cargoPipeline.filterAll")}</option>
          {cargoPipelineStatuses.map((value) => (
            <option key={value} value={value}>
              {t(`cargoPipeline.status_${value}`)}
            </option>
          ))}
        </FormSelect>
        <span className="text-sm text-muted-foreground sm:ml-auto" data-testid="pipeline-total">
          {t("cargoPipeline.total", { count: total })}
        </span>
      </div>
      <FeedbackLine feedback={feedback} testId="pipeline-feedback" />
      {list.error && !list.data ? (
        <ErrorState onRetry={list.reload} />
      ) : (
        <>
          <DataList testId="pipeline" rows={rows} columns={columns} rowKey={(row) => row.public_id} loading={list.loading && !list.data} />
          {total > pageSize && <Pagination page={page} pages={pageCount(total)} total={total} onPage={setPage} />}
        </>
      )}
      {manager && <ConfigSheet open={configOpen} onClose={() => setConfigOpen(false)} />}
      {manager && <TestSheet open={testOpen} onClose={() => setTestOpen(false)} />}
    </section>
  );
}

function BadgeIcon({ icon: Icon }: { icon: LucideIcon | undefined }) {
  return Icon ? <Icon className="size-3.5 shrink-0" aria-hidden="true" /> : null;
}
