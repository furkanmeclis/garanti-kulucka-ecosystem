import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, EyeOff, Globe, Hand, Loader2, Lock, MessageSquareReply, Save, Send, Settings2, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { ErrorState } from "@/components/data-list";
import { FilterSelect, ListToolbar } from "@/components/list-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/layout/page-header";
import { formatDateTime } from "@/lib/format";
import type { CommentModerationConfig, CommentPlatform, CommentReplyType, CommentStatus, SocialComment } from "@/lib/sms-comments";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { BrandIcon } from "@/components/brand-icons";
import { Hint } from "@/components/hint";
import { ProviderLabel } from "@/components/provider-label";
import { Switch } from "@/components/ui/switch";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { errorText, FeedbackLine, Field, FormSelect, idempotencyKey, type Feedback } from "./accounting-shared";

const pageSize = 30;
const filters: Array<[CommentStatus | "all", "filterManual" | "filterAutoReplied" | "filterDeleted" | "filterHidden" | "filterAll"]> = [
  ["manual", "filterManual"],
  ["auto_replied", "filterAutoReplied"],
  ["deleted", "filterDeleted"],
  ["hidden", "filterHidden"],
  ["all", "filterAll"],
];
const statusLabel: Record<CommentStatus, "statusPending" | "statusManual" | "statusAutoReplied" | "statusReplied" | "statusDeleted" | "statusHidden" | "statusError"> = {
  pending: "statusPending",
  manual: "statusManual",
  auto_replied: "statusAutoReplied",
  replied: "statusReplied",
  deleted: "statusDeleted",
  hidden: "statusHidden",
  error: "statusError",
};

/** /yorumlar — legacy YorumlarPage: AI comment moderation queue with reply / hide / delete / manual, the readiness check and settings. */
export function CommentsPage() {
  const { t, i18n } = useTranslation();
  const commentStatus = (value: CommentStatus) => (statusLabel[value] ? t(`comments.${statusLabel[value]}`) : t("common.unknownValue", { value }));
  const { api } = useAuth();
  const [status, setStatus] = useState<CommentStatus | "all">("manual");
  const [platform, setPlatform] = useState<CommentPlatform | "all">("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const key = JSON.stringify({ status, platform, query, page });
  const list = useQuery(`comments:${key}`, () =>
    api.listComments({ page, page_size: pageSize, ...(status !== "all" ? { status } : {}), ...(platform !== "all" ? { platform } : {}), ...(query ? { q: query } : {}) }),
  );
  const stats = useQuery("comments:stats", () => api.commentStats());
  const control = useQuery("comments:control", () => api.commentControl());
  const [rows, setRows] = useState<SocialComment[]>([]);
  const [replying, setReplying] = useState<SocialComment | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    if (list.data) setRows(list.data.data);
  }, [list.data]);

  const replace = (comment: SocialComment) => {
    setRows((current) => current.map((row) => (row.public_id === comment.public_id ? comment : row)));
    stats.reload();
  };

  async function act(comment: SocialComment, action: "hide" | "delete" | "manual") {
    setBusy(comment.public_id);
    setFeedback(null);
    try {
      const result = await api.commentAction(comment.public_id, action, idempotencyKey(`comment_${action}`));
      replace(result.comment);
      setFeedback({ tone: "success", text: t(action === "hide" ? "comments.hiddenToast" : action === "delete" ? "comments.deletedOrHidden" : "comments.queuedManual") });
    } catch (error) {
      setFeedback({ tone: "error", text: `${t("comments.actionFailed")}: ${errorText(error)}` });
    } finally {
      setBusy(null);
    }
  }

  const counts = stats.data?.counts;
  const report = control.data;
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section data-testid="page-comments">
      <PageHeader
        title={t("comments.title")}
        description={t("comments.subtitle")}
        actions={
          <Button variant="outline" className="min-h-11" onClick={() => setSettingsOpen(true)} data-testid="comments-settings-open">
            <Settings2 className="size-4" aria-hidden="true" />
            {t("comments.settings")}
          </Button>
        }
      />
      {report && (
        <Card
          className={cn(
            "mb-4 flex flex-col gap-1 p-4 text-sm",
            report.status === "critical" && "border-destructive/50 bg-destructive/5",
            report.status === "warning" && "border-amber-500/40 bg-amber-500/5",
          )}
          data-testid="comments-control"
        >
          <p className="flex items-center gap-2 font-medium">
            {report.status === "ready" ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" /> : <AlertTriangle className="size-4 text-amber-600" aria-hidden="true" />}
            {t(report.status === "ready" ? "comments.controlReady" : report.status === "critical" ? "comments.controlCritical" : "comments.controlWarning")}
          </p>
          {report.status !== "ready" && (
            <>
              <p className="text-muted-foreground">{t("comments.controlSummary", { error: report.summary.error, warning: report.summary.warning, ok: report.summary.ok })}</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {report.warnings.map((check) => (
                  <li key={check.id}>
                    {check.title} — {check.detail}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
      <div className="mb-3 flex gap-1 overflow-x-auto" role="tablist" data-testid="comments-tabs">
        {filters.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={status === value}
            className={cn("inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap", status === value ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50")}
            onClick={() => {
              setStatus(value);
              setPage(1);
            }}
            data-testid={`comments-tab-${value}`}
          >
            {t(`comments.${label}`)}
            {value !== "all" && counts && <Badge tone="neutral">{counts[value] ?? 0}</Badge>}
          </button>
        ))}
      </div>
      <ListToolbar
        query={query}
        placeholder={t("comments.searchPlaceholder")}
        onQuery={(value) => {
          setQuery(value);
          setPage(1);
        }}
        hasFilters={query !== "" || platform !== "all"}
        onClear={() => {
          setQuery("");
          setPlatform("all");
        }}
      >
        <FilterSelect
          testId="filter-platform"
          label={t("comments.platforms")}
          value={platform}
          onChange={(value) => {
            setPlatform(value as CommentPlatform | "all");
            setPage(1);
          }}
          options={[
            { value: "all", label: t("comments.allPlatforms") },
            { value: "instagram", label: "Instagram", icon: <BrandIcon brand="instagram" title="" /> },
            { value: "facebook", label: "Facebook", icon: <BrandIcon brand="facebook" title="" /> },
          ]}
        />
      </ListToolbar>
      <div className="mb-3">
        <FeedbackLine feedback={feedback} testId="comments-feedback" />
      </div>
      {list.error && !list.data ? (
        <ErrorState onRetry={list.reload} />
      ) : list.loading && rows.length === 0 ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground" data-testid="comments-empty">
          {t("comments.noComments")}
        </Card>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="comments-list">
          {rows.map((comment) => {
            const closed = comment.status === "deleted" || comment.status === "hidden";
            return (
              <li key={comment.public_id}>
                <Card className="flex flex-col gap-2 p-4" data-testid="comment-card">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">@{comment.username ?? t("comments.fallbackUser")}</span>
                    <Hint content={t("hints.commentPlatform", { platform: comment.platform === "instagram" ? "Instagram" : "Facebook" })}>
                      <Badge tone="outline">
                        <BrandIcon brand={comment.platform === "instagram" ? "instagram" : "facebook"} title="" className="size-3.5" />
                        {comment.platform === "instagram" ? "Instagram" : "Facebook"}
                      </Badge>
                    </Hint>
                    <Hint content={t("hints.commentStatus", { status: commentStatus(comment.status) })}>
                      <Badge tone={comment.status === "error" ? "danger" : comment.status === "manual" || comment.status === "pending" ? "warning" : closed ? "neutral" : "success"}>{commentStatus(comment.status)}</Badge>
                    </Hint>
                    {comment.confidence !== null && (
                      <Hint content={t("hints.commentConfidence")}>
                        <span className="text-xs text-muted-foreground">{t("comments.confidence", { value: comment.confidence.toFixed(2) })}</span>
                      </Hint>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(comment.received_at, i18n.language)}</span>
                  </div>
                  <p className="break-words">{comment.text || t("comments.emptyComment")}</p>
                  {comment.classification_reason && <p className="text-xs text-muted-foreground">{t("comments.reason", { reason: comment.classification_reason })}</p>}
                  {(comment.manual_reply || comment.ai_reply_draft) && (
                    <p className="rounded-md bg-muted/50 p-2 text-sm break-words">{comment.manual_reply ?? t("comments.draft", { draft: comment.ai_reply_draft })}</p>
                  )}
                  {comment.error_message && <p className="text-sm text-destructive">{comment.error_message}</p>}
                  {!closed && (
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" className="min-h-11 md:min-h-8" disabled={busy !== null} onClick={() => setReplying(comment)} data-testid="comment-reply">
                        <MessageSquareReply className="size-4" aria-hidden="true" />
                        {t("comments.reply")}
                      </Button>
                      <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" disabled={busy !== null} onClick={() => void act(comment, "hide")} data-testid="comment-hide">
                        <EyeOff className="size-4" aria-hidden="true" />
                        {t("comments.hide")}
                      </Button>
                      <Button size="sm" variant="outline" className="min-h-11 text-destructive md:min-h-8" disabled={busy !== null} onClick={() => void act(comment, "delete")} data-testid="comment-delete">
                        <Trash2 className="size-4" aria-hidden="true" />
                        {t("comments.delete")}
                      </Button>
                      {comment.status !== "manual" && (
                        <Button size="sm" variant="ghost" className="min-h-11 md:min-h-8" disabled={busy !== null} onClick={() => void act(comment, "manual")} data-testid="comment-manual">
                          <Hand className="size-4" aria-hidden="true" />
                          {t("comments.manual")}
                        </Button>
                      )}
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {total > pageSize && (
        <div className="mt-3 flex items-center justify-between gap-2 text-sm">
          <Button variant="outline" className="min-h-11" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="size-4" aria-hidden="true" />
            {t("comments.previous")}
          </Button>
          <span className="text-muted-foreground">{t("comments.pageOf", { page, total: pages })}</span>
          <Button variant="outline" className="min-h-11" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            {t("comments.next")}
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}
      <ReplySheet
        comment={replying}
        onClose={() => setReplying(null)}
        onSent={(comment) => {
          setReplying(null);
          replace(comment);
          setFeedback({ tone: "success", text: t("comments.replySent") });
        }}
      />
      <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={() => control.reload()} />
    </section>
  );
}

function ReplySheet({ comment, onClose, onSent }: { comment: SocialComment | null; onClose: () => void; onSent: (comment: SocialComment) => void }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [message, setMessage] = useState("");
  const [replyType, setReplyType] = useState<CommentReplyType>("public");
  const [busy, setBusy] = useState<"send" | "ai" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    setMessage(comment?.ai_reply_draft ?? "");
    setReplyType(comment?.reply_type ?? "public");
    setFeedback(null);
  }, [comment]);

  async function suggest() {
    if (!comment) return;
    setBusy("ai");
    setFeedback(null);
    try {
      const result = await api.suggestCommentReply(comment.public_id);
      setMessage(result.suggestion);
      setFeedback({ tone: "success", text: t("comments.reprocessed", { action: result.action }) });
    } catch (error) {
      setFeedback({ tone: "error", text: `${t("comments.actionFailed")}: ${errorText(error)}` });
    } finally {
      setBusy(null);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!comment || !message.trim()) return;
    setBusy("send");
    setFeedback(null);
    try {
      const result = await api.replyComment(comment.public_id, { message: message.trim(), reply_type: replyType, idempotency_key: idempotencyKey("comment_reply") });
      onSent(result.comment);
    } catch (error) {
      setFeedback({ tone: "error", text: `${t("comments.sendFailed")}: ${errorText(error)}` });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={comment !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="bottom" closeLabel={t("comments.close")} className="mx-auto w-full max-w-xl p-0" data-testid="comment-reply-sheet">
        <SheetHeader className="border-b p-4 pr-14">
          <SheetTitle>{t("comments.replyToComment")}</SheetTitle>
          <SheetDescription className="break-words">
            @{comment?.username ?? t("comments.fallbackUser")}: {comment?.text || t("comments.emptyComment")}
          </SheetDescription>
        </SheetHeader>
        <form className="flex flex-col gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]" onSubmit={(event) => void submit(event)}>
          <div className="flex gap-2" role="radiogroup" aria-label={t("comments.replyType")}>
            {(["public", "private"] as const).map((value) => (
              <Button key={value} type="button" variant={replyType === value ? "default" : "outline"} className="min-h-11 flex-1" aria-pressed={replyType === value} onClick={() => setReplyType(value)} data-testid={`comment-reply-type-${value}`}>
                {value === "public" ? <Globe className="size-4" aria-hidden="true" /> : <Lock className="size-4" aria-hidden="true" />}
                {t(value === "public" ? "comments.replyTypePublic" : "comments.replyTypePrivate")}
              </Button>
            ))}
          </div>
          <Textarea
            className="min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:text-sm dark:bg-input/30"
            rows={4}
            aria-label={t("comments.replyPlaceholder")}
            placeholder={t("comments.replyPlaceholder")}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            data-testid="comment-reply-message"
          />
          <FeedbackLine feedback={feedback} testId="comment-reply-feedback" />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-11" disabled={busy !== null} onClick={() => void suggest()} data-testid="comment-ai-suggest">
              {busy === "ai" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
              {t("comments.reprocessWithAi")}
            </Button>
            <Button type="submit" className="min-h-11 flex-1" disabled={busy !== null || !message.trim()} data-testid="comment-reply-send">
              {busy === "send" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
              {t("comments.send")}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function SettingsSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const { api } = useAuth();
  const settings = useQuery("comments:settings", () => api.commentSettings(), { enabled: open });
  const [config, setConfig] = useState<CommentModerationConfig | null>(null);
  const [risk, setRisk] = useState("");
  const [topics, setTopics] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    if (!settings.data) return;
    setConfig(settings.data.config);
    setRisk(settings.data.config.risk_manual_examples.join("\n"));
    setTopics(settings.data.config.auto_reply_topics.join("\n"));
  }, [settings.data]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!config) return;
    setSaving(true);
    setFeedback(null);
    const lines = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean);
    try {
      const result = await api.saveCommentSettings({ ...config, risk_manual_examples: lines(risk), auto_reply_topics: lines(topics) });
      setConfig(result.config);
      setFeedback({ tone: "success", text: t("comments.settingsSaved") });
      onSaved();
    } catch (error) {
      setFeedback({ tone: "error", text: `${t("comments.saveFailed")}: ${errorText(error)}` });
    } finally {
      setSaving(false);
    }
  }

  const toggle = (label: ReactNode, checked: boolean, onChange: (value: boolean) => void, testId: string) => (
    <label className="flex min-h-11 items-center gap-3 text-sm">
      <Switch checked={checked} onCheckedChange={onChange} data-testid={testId} />
      {label}
    </label>
  );
  const area = "min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:text-sm dark:bg-input/30";

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" closeLabel={t("comments.close")} className="w-[min(30rem,100vw)] overflow-y-auto p-0" data-testid="comments-settings">
        <SheetHeader className="border-b p-4 pr-14">
          <SheetTitle>{t("comments.settingsTitle")}</SheetTitle>
          <SheetDescription>{t("comments.subtitle")}</SheetDescription>
        </SheetHeader>
        {!config ? (
          <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" aria-label={t("common.refresh")} />
        ) : (
          <form className="flex flex-col gap-2 px-4 pb-4" onSubmit={(event) => void save(event)}>
            {toggle(t("comments.pipelineEnabled"), config.enabled, (value) => setConfig({ ...config, enabled: value }), "comments-enabled")}
            <p className="mt-2 text-sm font-medium">{t("comments.platforms")}</p>
            {toggle(<ProviderLabel brand="instagram">Instagram</ProviderLabel>, config.platforms.instagram, (value) => setConfig({ ...config, platforms: { ...config.platforms, instagram: value } }), "comments-platform-instagram")}
            {toggle(<ProviderLabel brand="facebook">Facebook</ProviderLabel>, config.platforms.facebook, (value) => setConfig({ ...config, platforms: { ...config.platforms, facebook: value } }), "comments-platform-facebook")}
            <Field label={t("comments.replyType")} className="mt-2">
              <FormSelect value={config.reply_type} aria-label={t("comments.replyType")} onChange={(event) => setConfig({ ...config, reply_type: event.target.value as CommentReplyType })}>
                <option value="public">{t("comments.replyTypePublicLong")}</option>
                <option value="private">{t("comments.replyTypePrivateLong")}</option>
              </FormSelect>
            </Field>
            {toggle(t("comments.deleteProfanity"), config.delete_profanity, (value) => setConfig({ ...config, delete_profanity: value }), "comments-delete-profanity")}
            {toggle(t("comments.deleteBrandDisparagement"), config.delete_brand_disparagement, (value) => setConfig({ ...config, delete_brand_disparagement: value }), "comments-delete-brand")}
            <Field label={t("comments.minConfidence")}>
              <NumberInput
                decimal
                min={0}
                max={1}
                value={config.min_confidence}
                onValueChange={(value) => setConfig({ ...config, min_confidence: value })}
                className="h-11 lg:h-9"
                data-testid="comments-min-confidence"
              />
            </Field>
            <Field label={t("comments.riskManualExamples")}>
              <Textarea className={area} rows={3} value={risk} placeholder={t("comments.riskManualPlaceholder")} onChange={(event) => setRisk(event.target.value)} />
            </Field>
            <Field label={t("comments.autoReplyTopics")}>
              <Textarea className={area} rows={3} value={topics} placeholder={t("comments.autoReplyTopicsPlaceholder")} onChange={(event) => setTopics(event.target.value)} data-testid="comments-topics" />
            </Field>
            <FeedbackLine feedback={feedback} testId="comments-settings-feedback" />
            <Button type="submit" className="min-h-11" disabled={saving} data-testid="comments-settings-save">
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
              {t("comments.save")}
            </Button>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
