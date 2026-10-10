import { ChevronLeft, ChevronRight, Eraser, FileText, History, Loader2, Pencil, PenLine, Plus, RefreshCw, Save, Send, Trash2 } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { DataList, ErrorState, type Column } from "@/components/data-list";
import { FilterSelect, ListToolbar } from "@/components/list-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PageHeader } from "@/layout/page-header";
import { formatDateTime } from "@/lib/format";
import type { SmsHistoryType, SmsMessage, SmsTemplate } from "@/lib/sms-comments";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { BrandIcon } from "@/components/brand-icons";
import { Hint } from "@/components/hint";
import { useConfirm } from "@/components/confirm-dialog";
import { Tip } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { errorText, FeedbackLine, Field, idempotencyKey, FormSelect, type Feedback } from "./accounting-shared";

const variables = [
  { label: "variableCustomerName", value: "{musteri_adi}", example: "Ahmet Yılmaz" },
  { label: "variableTrackingNumber", value: "{takip_no}", example: "123456789" },
  { label: "variableCargoProvider", value: "{kargo_firmasi}", example: "PTT" },
] as const;
const historyPageSize = 25;
type Tab = "manual" | "history" | "templates" | "automatic";

/** Legacy SMS counter: Turkish-only letters force UCS-2 (70 / 67 chars per part), otherwise 160 / 153. */
export function smsInfo(text: string) {
  const unicode = /[şıİŞĞğ]/.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const length = text.length;
  return { length, parts: length <= single ? 1 : Math.ceil(length / multi), unicode, single };
}

export function parsePhones(text: string) {
  return [...new Set(text.split(/[\n,;]+/).map((value) => value.replace(/[^\d+]/g, "")).filter((value) => /^\+?\d{10,15}$/.test(value)))];
}

const textareaClass =
  "min-h-28 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:text-sm dark:bg-input/30";

/** /sms — legacy SmsGonderPage: manual send with templates and variables, history, template management and the PTT/Sürat sweep. */
export function SmsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("manual");
  const tabs: Array<[Tab, "tabManual" | "tabHistory" | "tabTemplates" | "tabAutomatic"]> = [
    ["manual", "tabManual"],
    ["history", "tabHistory"],
    ["templates", "tabTemplates"],
    ["automatic", "tabAutomatic"],
  ];
  return (
    <section data-testid="page-sms">
      <PageHeader brand="netgsm" title={t("sms.title")} description={t("sms.subtitle")} />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b" role="tablist">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={cn("inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap", tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground")}
            onClick={() => setTab(key)}
            data-testid={`sms-tab-${key}`}
          >
            <SmsTabIcon tab={key} />
            {t(`sms.${label}`)}
          </button>
        ))}
      </div>
      {tab === "manual" && <ManualTab />}
      {tab === "history" && <HistoryTab />}
      {tab === "templates" && <TemplatesTab />}
      {tab === "automatic" && <AutomaticTab />}
    </section>
  );
}

function ManualTab() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const templates = useQuery("sms:templates", () => api.listSmsTemplates());
  const [phones, setPhones] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [session, setSession] = useState<SmsMessage[]>([]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const info = smsInfo(message);
  const recipients = parsePhones(phones);
  const hasVariables = variables.some((variable) => message.includes(variable.value));

  function insert(value: string) {
    const element = textarea.current;
    const start = element?.selectionStart ?? message.length;
    const end = element?.selectionEnd ?? message.length;
    setMessage(message.slice(0, start) + value + message.slice(end));
    window.setTimeout(() => {
      element?.focus();
      element?.setSelectionRange(start + value.length, start + value.length);
    }, 0);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFeedback(null);
    if (recipients.length === 0) return setFeedback({ tone: "error", text: t("sms.errorPhoneRequired") });
    if (!message.trim()) return setFeedback({ tone: "error", text: t("sms.errorMessageEmpty") });
    if (hasVariables) return setFeedback({ tone: "error", text: t("sms.errorUnfilledVariables") });
    setSending(true);
    try {
      const result = await api.sendManualSms({ recipients, message: message.trim(), idempotency_key: idempotencyKey("sms"), ...(templateId ? { template_public_id: templateId } : {}) });
      const failed = result.messages.filter((entry) => entry.status === "failed").length;
      setFeedback(failed > 0 ? { tone: "error", text: t("sms.sendPartial", { sent: result.queued_count, failed }) } : { tone: "success", text: t("sms.sendSuccess", { count: result.queued_count }) });
      setSession((current) => [...result.messages, ...current].slice(0, 50));
      setPhones("");
    } catch (error) {
      setFeedback({ tone: "error", text: `${t("sms.sendFailed")}: ${errorText(error)}` });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card className="p-4">
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} data-testid="sms-form">
          <Field label={t("sms.recipientPhones")}>
            <Textarea className={textareaClass} rows={3} value={phones} onChange={(event) => setPhones(event.target.value)} placeholder="05551112233" data-testid="sms-phones" />
          </Field>
          <Field label={t("sms.templateOptional")}>
            <FormSelect
              value={templateId}
              onChange={(event) => {
                setTemplateId(event.target.value);
                const template = templates.data?.data.find((entry) => entry.public_id === event.target.value);
                if (template) setMessage(template.body);
              }}
              data-testid="sms-template"
            >
              <option value="">{t("sms.selectTemplate")}</option>
              {(templates.data?.data ?? [])
                .filter((template) => template.is_active)
                .map((template) => (
                  <option key={template.public_id} value={template.public_id}>
                    {template.title}
                  </option>
                ))}
            </FormSelect>
          </Field>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sms-message" className="text-sm font-medium">
              {t("sms.message")}
            </label>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">{t("sms.addVariable")}</span>
              {variables.map((variable) => (
                <Button key={variable.value} type="button" variant="outline" size="sm" className="min-h-11 md:min-h-8" onClick={() => insert(variable.value)} data-testid={`sms-variable-${variable.value.slice(1, -1)}`}>
                  <Plus className="size-4" aria-hidden="true" />
                  {variable.value}
                </Button>
              ))}
            </div>
            <Textarea id="sms-message" ref={textarea} className={textareaClass} rows={5} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={t("sms.messagePlaceholder")} data-testid="sms-message" />
            <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground" data-testid="sms-counter">
              <span>{t("sms.characterCount", { count: info.length })}</span>
              <span>{t("sms.smsCount", { count: info.parts })}</span>
              {info.unicode && <span>{t("sms.unicodeLimit", { limit: info.single })}</span>}
            </p>
            {hasVariables && <p className="text-xs text-amber-700 dark:text-amber-300">{t("sms.fillVariablesWarning")}</p>}
          </div>
          <FeedbackLine feedback={feedback} testId="sms-feedback" />
          <Button type="submit" className="min-h-11" disabled={sending} data-testid="sms-send">
            {sending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
            {sending ? t("sms.sending") : t("sms.send")}
          </Button>
        </form>
      </Card>
      <Card className="flex flex-col gap-2 p-4" data-testid="sms-session">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{t("sms.thisSession")}</h2>
          {session.length > 0 && (
            <Button variant="ghost" size="sm" className="min-h-11 md:min-h-8" onClick={() => setSession([])}>
              <Eraser className="size-4" aria-hidden="true" />
              {t("sms.clear")}
            </Button>
          )}
        </div>
        {session.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("sms.noSmsSent")}</p>
        ) : (
          <ul className="flex flex-col divide-y text-sm">
            {session.map((entry) => (
              <li key={entry.public_id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block font-medium">{entry.recipient_phone}</span>
                  <span className="block truncate text-xs text-muted-foreground">{formatDateTime(entry.created_at, i18n.language)}</span>
                </span>
                <StatusBadge status={entry.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: SmsMessage["status"] }) {
  const { t } = useTranslation();
  const label = t(status === "sent" ? "sms.statusSent" : status === "failed" ? "sms.statusFailed" : "sms.statusQueued");
  return (
    <Hint content={t("hints.smsStatus", { status: label })}>
      <Badge tone={status === "sent" ? "success" : status === "failed" ? "danger" : "info"}>{label}</Badge>
    </Hint>
  );
}

function HistoryTab() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [type, setType] = useState<SmsHistoryType>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const history = useQuery(`sms:history:${type}:${query}:${page}`, () => api.listSmsHistory({ type, page, page_size: historyPageSize, ...(query ? { q: query } : {}) }));
  const rows = history.data?.data ?? [];
  const total = history.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / historyPageSize));
  const columns: Column<SmsMessage>[] = [
    { key: "phone", header: t("sms.columnPhone"), mobile: "title", cell: (row) => <span className="font-medium">{row.recipient_phone}</span> },
    { key: "status", header: t("sms.columnStatus"), mobile: "badge", cell: (row) => <StatusBadge status={row.status} /> },
    { key: "customer", header: t("sms.columnCustomer"), cell: (row) => row.customer_name ?? t("common.none") },
    { key: "message", header: t("sms.columnMessage"), cell: (row) => <Tip label={row.message}><span>{row.message}</span></Tip> },
    { key: "type", header: t("sms.columnType"), cell: (row) => t(row.is_automatic ? "sms.historyTypeAutomatic" : "sms.historyTypeManual") },
    { key: "time", header: t("sms.columnTime"), cell: (row) => formatDateTime(row.created_at, i18n.language) },
  ];
  return (
    <div>
      <ListToolbar
        query={query}
        placeholder={t("sms.historySearchPlaceholder")}
        onQuery={(value) => {
          setQuery(value);
          setPage(1);
        }}
        hasFilters={query !== "" || type !== "all"}
        onClear={() => {
          setQuery("");
          setType("all");
          setPage(1);
        }}
      >
        <FilterSelect
          testId="filter-sms-type"
          label={t("sms.columnType")}
          value={type}
          onChange={(value) => {
            setType(value as SmsHistoryType);
            setPage(1);
          }}
          options={[
            { value: "all", label: t("sms.historyTypeAll") },
            { value: "manual", label: t("sms.historyTypeManual") },
            { value: "automatic", label: t("sms.historyTypeAutomatic") },
          ]}
        />
      </ListToolbar>
      {history.error && !history.data ? (
        <ErrorState onRetry={history.reload} />
      ) : (
        <>
          <DataList testId="sms-history" rows={rows} columns={columns} rowKey={(row) => row.public_id} loading={history.loading} />
          {total > historyPageSize && (
            <div className="mt-3 flex items-center justify-between gap-2 text-sm">
              <Button variant="outline" className="min-h-11" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="size-4" aria-hidden="true" />
                {t("sms.previousPage")}
              </Button>
              <span className="text-muted-foreground">{t("sms.paginationSummary", { total, from: (page - 1) * historyPageSize + 1, to: Math.min(page * historyPageSize, total) })}</span>
              <Button variant="outline" className="min-h-11" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                {t("sms.nextPage")}
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TemplatesTab() {
  const confirm = useConfirm();
  const { t } = useTranslation();
  const { api } = useAuth();
  const templates = useQuery("sms:templates", () => api.listSmsTemplates());
  const [editing, setEditing] = useState<SmsTemplate | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [saving, setSaving] = useState(false);

  function open(template: SmsTemplate | "new") {
    setEditing(template);
    setTitle(template === "new" ? "" : template.title);
    setBody(template === "new" ? "" : template.body);
    setFeedback(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !body.trim()) return setFeedback({ tone: "error", text: t("sms.errorTitleBodyRequired") });
    setSaving(true);
    try {
      if (editing === "new") await api.createSmsTemplate({ title: title.trim(), body: body.trim() });
      else if (editing) await api.updateSmsTemplate(editing.public_id, { title: title.trim(), body: body.trim() });
      setFeedback({ tone: "success", text: editing === "new" ? t("sms.templateAdded") : t("sms.templateUpdated") });
      setEditing(null);
      templates.reload();
    } catch (error) {
      setFeedback({ tone: "error", text: `${editing === "new" ? t("sms.addFailed") : t("sms.updateFailed")}: ${errorText(error)}` });
    } finally {
      setSaving(false);
    }
  }

  async function remove(template: SmsTemplate) {
    if (template.is_system) return setFeedback({ tone: "error", text: t("sms.systemTemplateNotDeletable") });
    if (!(await confirm(t("sms.confirmDeleteTemplate"), { tone: "danger" }))) return;
    try {
      await api.deleteSmsTemplate(template.public_id);
      setFeedback({ tone: "success", text: t("sms.templateDeleted") });
      templates.reload();
    } catch (error) {
      setFeedback({ tone: "error", text: `${t("sms.deleteFailed")}: ${errorText(error)}` });
    }
  }

  const rows = templates.data?.data ?? [];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("sms.templateCount", { count: rows.length })}</p>
        <Button className="min-h-11" onClick={() => open("new")} data-testid="sms-template-new">
          <Plus className="size-4" aria-hidden="true" />
          {t("sms.newTemplate")}
        </Button>
      </div>
      <FeedbackLine feedback={feedback} testId="sms-template-feedback" />
      {templates.error && !templates.data ? (
        <ErrorState onRetry={templates.reload} />
      ) : (
        <ul className="grid gap-2 md:grid-cols-2" data-testid="sms-templates">
          {rows.map((template) => (
            <li key={template.public_id}>
              <Card className="flex h-full flex-col gap-2 p-4" data-testid="sms-template-card">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{template.title}</span>
                  {template.is_system && (
                    <Hint content={t("hints.templateSystem")}>
                      <Badge tone="info">{t("sms.badgeSystem")}</Badge>
                    </Hint>
                  )}
                  {!template.is_active && (
                    <Hint content={t("hints.templateInactive")}>
                      <Badge tone="warning">{t("sms.badgeInactive")}</Badge>
                    </Hint>
                  )}
                </div>
                <p className="text-sm break-words whitespace-pre-wrap text-muted-foreground">{template.body}</p>
                <div className="mt-auto flex gap-2">
                  <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" onClick={() => open(template)} data-testid="sms-template-edit">
                    <Pencil className="size-4" aria-hidden="true" />
                    {t("sms.edit")}
                  </Button>
                  {!template.is_system && (
                    <Button size="sm" variant="outline" className="min-h-11 text-destructive md:min-h-8" onClick={() => void remove(template)} data-testid="sms-template-delete">
                      <Trash2 className="size-4" aria-hidden="true" />
                      {t("sms.delete")}
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Card className="p-4 text-sm">
        <p className="mb-1 font-medium">{t("sms.availableVariables")}</p>
        <ul className="flex flex-col gap-0.5 text-muted-foreground">
          {variables.map((variable) => (
            <li key={variable.value}>
              <code>{variable.value}</code> {t("sms.variableExample", { label: t(`sms.${variable.label}`), example: variable.example })}
            </li>
          ))}
        </ul>
      </Card>
      <Sheet open={editing !== null} onOpenChange={(next) => !next && setEditing(null)}>
        <SheetContent side="right" closeLabel={t("sms.close")} className="w-[min(30rem,100vw)] overflow-y-auto p-0" data-testid="sms-template-sheet">
          <SheetHeader className="border-b p-4 pr-14">
            <SheetTitle>{editing === "new" ? t("sms.addNewTemplate") : t("sms.edit")}</SheetTitle>
            <SheetDescription>{t("sms.availableVariables")}</SheetDescription>
          </SheetHeader>
          <form className="flex flex-col gap-3 px-4 pb-4" onSubmit={(event) => void save(event)}>
            <Field label={t("sms.templateTitlePlaceholder")}>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} className="h-11 md:h-9" data-testid="sms-template-title" />
            </Field>
            <Field label={t("sms.templateBodyPlaceholder")}>
              <Textarea className={textareaClass} rows={5} value={body} onChange={(event) => setBody(event.target.value)} data-testid="sms-template-body" />
            </Field>
            <Button type="submit" className="min-h-11" disabled={saving} data-testid="sms-template-save">
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
              {t("sms.save")}
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function AutomaticTab() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [busy, setBusy] = useState<"ptt" | "surat" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function trigger(provider: "ptt" | "surat") {
    setBusy(provider);
    setFeedback(null);
    try {
      await api.triggerAutomaticSms(provider, idempotencyKey(`sms_${provider}`));
      setFeedback({ tone: "success", text: t("sms.triggerStarted", { provider: provider === "ptt" ? "PTT" : "Sürat" }) });
    } catch (error) {
      setFeedback({ tone: "error", text: `${t("sms.triggerFailed")}: ${errorText(error)}` });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="sms-automatic">
      <h2 className="font-semibold">{t("sms.manualTrigger")}</h2>
      <p className="text-sm text-muted-foreground">{t("sms.manualTriggerNote")}</p>
      <div className="flex flex-wrap gap-2">
        {(["ptt", "surat"] as const).map((provider) => (
          <Button key={provider} variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void trigger(provider)} data-testid={`sms-trigger-${provider}`}>
            {busy === provider ? <RefreshCw className="size-4 animate-spin" aria-hidden="true" /> : <BrandIcon brand={provider} title="" />}
            {t(provider === "ptt" ? "sms.updatePttTracking" : "sms.updateSuratTracking")}
          </Button>
        ))}
      </div>
      <FeedbackLine feedback={feedback} testId="sms-automatic-feedback" />
      <p className="text-xs text-muted-foreground">{t("sms.backgroundNote")}</p>
    </Card>
  );
}

function SmsTabIcon({ tab }: { tab: Tab }) {
  const Icon = tab === "manual" ? PenLine : tab === "history" ? History : tab === "templates" ? FileText : RefreshCw;
  return <Icon className="size-4" aria-hidden="true" />;
}
