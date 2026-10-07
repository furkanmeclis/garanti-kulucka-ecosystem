import { BarChart3, ExternalLink, Eye, Loader2, RefreshCw, Send, TrendingUp, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { ErrorState } from "@/components/data-list";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/layout/page-header";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import type { InstagramPublication } from "@/lib/reports-instagram";
import { useQuery } from "@/lib/use-query";
import { cn } from "@/lib/utils";
import { errorText, FeedbackLine, Field, idempotencyKey, NativeSelect, type Feedback } from "./accounting-shared";

/** /instagram/analitik — legacy AnalitikPage: day range, summary cards, daily performance and all metrics; "Yenile" also queues the worker's live refresh. */
export function InstagramAnalyticsPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [days, setDays] = useState(7);
  const insights = useQuery(`instagram:insights:${days}`, () => api.instagramInsights(days));
  const [feedback, setFeedback] = useState<Feedback>(null);
  const data = insights.data;
  const totals = useMemo(() => Object.fromEntries((data?.data ?? []).map((metric) => [metric.name, metric.values.reduce((sum, value) => sum + (value.value || 0), 0)])), [data]);
  const series = data?.data[0]?.values ?? [];
  const max = Math.max(1, ...series.map((value) => value.value || 0));

  async function refresh() {
    setFeedback(null);
    try {
      await api.refreshInstagramInsights();
      setFeedback({ tone: "success", text: t("instagramAnalytics.refreshQueued") });
    } catch (error) {
      setFeedback({ tone: "error", text: `${t("instagramAnalytics.insightsLoadFailed")}: ${errorText(error)}` });
    }
    insights.reload();
  }

  const cards = [
    { key: "followers", icon: Users, label: t("instagramAnalytics.followers"), value: data?.followers?.followers_count ?? 0, detail: t("instagramAnalytics.totalFollowers") },
    { key: "reach", icon: TrendingUp, label: t("instagramAnalytics.reach"), value: totals.reach ?? 0, detail: t("instagramAnalytics.lastNDays", { count: days }) },
    { key: "impressions", icon: Eye, label: t("instagramAnalytics.impressions"), value: totals.impressions ?? 0, detail: t("instagramAnalytics.lastNDays", { count: days }) },
    { key: "profile_views", icon: BarChart3, label: t("instagramAnalytics.profileViews"), value: totals.profile_views ?? 0, detail: t("instagramAnalytics.lastNDays", { count: days }) },
  ];

  return (
    <section data-testid="page-instagram-analytics">
      <PageHeader
        title={t("instagramAnalytics.title")}
        description={t("instagramAnalytics.subtitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            <NativeSelect value={String(days)} onChange={(event) => setDays(Number(event.target.value))} aria-label={t("instagramAnalytics.dayRangeAria")} className="w-auto" data-testid="instagram-days">
              <option value="7">{t("instagramAnalytics.last7Days")}</option>
              <option value="14">{t("instagramAnalytics.last14Days")}</option>
              <option value="28">{t("instagramAnalytics.last28Days")}</option>
            </NativeSelect>
            <Button variant="outline" className="min-h-11" onClick={() => void refresh()} data-testid="instagram-refresh">
              <RefreshCw className={cn("size-4", insights.loading && "animate-spin")} aria-hidden="true" />
              {t("instagramAnalytics.refresh")}
            </Button>
          </div>
        }
      />
      {data && (
        <p className="mb-3 text-sm text-muted-foreground" data-testid="instagram-sync">
          {data.synced_at
            ? t("instagramAnalytics.syncedAt", { date: formatDateTime(data.synced_at, i18n.language) })
            : t("instagramAnalytics.notSynced", { gate: data.live_gate ?? "providers.instagram.live_mode" })}
        </p>
      )}
      <div className="mb-3">
        <FeedbackLine feedback={feedback} testId="instagram-feedback" />
      </div>
      {insights.error && !data ? (
        <ErrorState onRetry={insights.reload} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="instagram-cards">
            {cards.map((card) => (
              <Card key={card.key} className="min-w-0 p-4">
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <card.icon className="size-4" aria-hidden="true" />
                  {card.label}
                </p>
                <p className="text-xl font-semibold" data-testid={`instagram-card-${card.key}`}>{formatNumber(card.value, i18n.language)}</p>
                <p className="text-xs text-muted-foreground">{card.detail}</p>
              </Card>
            ))}
          </div>
          <Card className="mb-4 p-4">
            <h2 className="mb-3 font-semibold">{t("instagramAnalytics.dailyPerformance")}</h2>
            {series.length === 0 ? (
              <p className="text-sm text-muted-foreground">{insights.loading ? t("instagramAnalytics.loading") : t("instagramAnalytics.noData")}</p>
            ) : (
              <ul className="flex flex-col gap-1.5" data-testid="instagram-daily">
                {series.map((value) => (
                  <li key={value.end_time} className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-2 text-sm">
                    <span className="text-muted-foreground">{formatDate(value.end_time, i18n.language)}</span>
                    <span className="h-2.5 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-gradient-to-r from-purple-500 to-pink-500" style={{ width: `${((value.value || 0) / max) * 100}%` }} />
                    </span>
                    <span className="font-medium tabular-nums">{formatNumber(value.value, i18n.language)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {(data?.data.length ?? 0) > 0 && (
            <Card className="p-4">
              <h2 className="mb-3 font-semibold">{t("instagramAnalytics.allMetrics")}</h2>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="instagram-metrics">
                {data!.data.map((metric) => (
                  <li key={metric.name} className="min-w-0 rounded-md border p-3">
                    <p className="truncate text-sm text-muted-foreground">{metric.description ?? metric.name.replaceAll("_", " ")}</p>
                    <p className="text-lg font-semibold">{formatNumber(totals[metric.name] ?? 0, i18n.language)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </section>
  );
}

const captionLimit = 2200;
const pollInterval = 3000;
const pollMax = 20;

/** /instagram/yayinla — legacy YayinlaPage (image URL + caption): queues `instagram.media.publish` and polls the publication. */
export function InstagramPublishPage() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [imageUrl, setImageUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [result, setResult] = useState<InstagramPublication | null>(null);
  const key = useRef<string | null>(null);
  const alive = useRef(true);

  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  async function waitFor(publicId: string) {
    for (let attempt = 0; attempt < pollMax; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, pollInterval));
      if (!alive.current) return;
      const publication = await api.getInstagramPublication(publicId).catch(() => null);
      if (!publication || !alive.current) return;
      if (publication.status === "published") {
        setResult(publication);
        return setFeedback({ tone: "success", text: t("instagramPublish.published") });
      }
      if (publication.status === "failed") return setFeedback({ tone: "error", text: publication.error_message || t("instagramPublish.publishFailed") });
      if (publication.status === "dry_run") return setFeedback({ tone: "success", text: t("instagramPublish.dryRunProcessed") });
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!imageUrl.trim()) return setFeedback({ tone: "error", text: t("instagramPublish.enterImageUrl") });
    if (caption.length > captionLimit) return setFeedback({ tone: "error", text: t("instagramPublish.captionTooLong") });
    setBusy(true);
    setFeedback(null);
    setResult(null);
    key.current ??= idempotencyKey("ig_publish");
    try {
      const response = await api.publishInstagram({ image_url: imageUrl.trim(), caption: caption.trim(), idempotency_key: key.current });
      key.current = null;
      setImageUrl("");
      setCaption("");
      if (response.publication.status === "published") {
        setResult(response.publication);
        setFeedback({ tone: "success", text: t("instagramPublish.published") });
      } else if (response.publication.status === "dry_run") {
        setFeedback({ tone: "success", text: t("instagramPublish.dryRunProcessed") });
      } else {
        setFeedback({ tone: "success", text: t("instagramPublish.queued") });
        void waitFor(response.publication.public_id);
      }
    } catch (error) {
      setFeedback({ tone: "error", text: `${t("instagramPublish.publishFailed")}: ${errorText(error)}` });
    } finally {
      setBusy(false);
    }
  }

  const preview = /^https?:\/\//.test(imageUrl.trim()) ? imageUrl.trim() : null;
  return (
    <section data-testid="page-instagram-publish">
      <PageHeader title={t("instagramPublish.title")} description={t("instagramPublish.subtitle")} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="p-4">
          <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} data-testid="instagram-publish-form">
            <Field label={t("instagramPublish.imageUrlLabel")}>
              <Input type="url" inputMode="url" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://" className="h-11 md:h-9" data-testid="instagram-image-url" />
              <span className="text-xs font-normal text-muted-foreground">{t("instagramPublish.imageUrlHelp")}</span>
            </Field>
            <Field label={t("instagramPublish.captionLabel")}>
              <textarea
                className="min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
                rows={6}
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                placeholder={t("instagramPublish.captionPlaceholder")}
                data-testid="instagram-caption"
              />
              <span className={cn("text-xs font-normal", caption.length > captionLimit ? "text-destructive" : "text-muted-foreground")} data-testid="instagram-caption-count">
                {t("instagramPublish.charCount", { count: caption.length })}
              </span>
            </Field>
            <FeedbackLine feedback={feedback} testId="instagram-publish-feedback" />
            {result?.media_id && (
              <p className="text-sm" data-testid="instagram-publish-result">
                {t("instagramPublish.mediaId", { id: result.media_id })}{" "}
                <a className="inline-flex items-center gap-1 text-primary underline" href={`https://www.instagram.com/`} target="_blank" rel="noreferrer">
                  {t("instagramPublish.viewOnInstagram")}
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              </p>
            )}
            <Button type="submit" className="min-h-11" disabled={busy} data-testid="instagram-publish">
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
              {busy ? t("instagramPublish.publishing") : t("instagramPublish.publishToInstagram")}
            </Button>
          </form>
        </Card>
        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <h2 className="mb-2 font-semibold">{t("instagramPublish.preview")}</h2>
            {preview ? (
              <img src={preview} alt={t("instagramPublish.previewAlt")} className="aspect-[4/5] w-full rounded-md object-cover" />
            ) : (
              <div className="flex aspect-[4/5] items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Send className="size-8" aria-hidden="true" />
              </div>
            )}
            {caption && <p className="mt-2 text-sm break-words whitespace-pre-wrap">{caption}</p>}
          </Card>
          <Card className="p-4 text-sm">
            <h2 className="mb-2 font-semibold">{t("instagramPublish.requirementsTitle")}</h2>
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              {(["requirementFormat", "requirementAspect", "requirementCaption", "requirementPublicUrl", "requirementDailyLimit", "requirementPermission"] as const).map((item) => (
                <li key={item}>{t(`instagramPublish.${item}`)}</li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </section>
  );
}
