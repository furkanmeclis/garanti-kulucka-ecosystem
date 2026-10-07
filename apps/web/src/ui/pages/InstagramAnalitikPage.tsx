import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Eye, Instagram, Loader2, RefreshCw, TrendingUp, Users } from "lucide-react";
import { BackendRequestError, type BackendHttpClient } from "../../api/http-client.js";
import { createInstagramClient, type InstagramAccountInsights } from "../../api/instagram-client.js";
import { localeFor, useLanguage, useT, type UiLanguage } from "../i18n/index.js";
import { instagramAnalyticsMessages } from "../i18n/messages/instagramAnalytics.js";

/**
 * Legacy frontend/src/pages/instagram/AnalitikPage.jsx parity (admin, calisan). Account insights
 * come from `GET /api/instagram/insights/account?days=N` (backend boundary, never Meta directly);
 * "Yenile" also queues the worker's live `instagram.insights.account` refresh.
 */

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof BackendRequestError) {
    const body = error.body as { error?: { message?: unknown } } | null | undefined;
    if (typeof body?.error?.message === "string" && body.error.message.length > 0) return body.error.message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatNumber(value: number | null | undefined, language: UiLanguage) {
  return (value || 0).toLocaleString(localeFor(language));
}

export function InstagramAnalitikPage(props: { http: BackendHttpClient }) {
  const t = useT(instagramAnalyticsMessages);
  const { language } = useLanguage();
  const client = useMemo(() => createInstagramClient(props.http), [props.http]);
  const [days, setDays] = useState(7);
  const [accountData, setAccountData] = useState<InstagramAccountInsights | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [bilgi, setBilgi] = useState<string | null>(null);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    setHata(null);
    try {
      const data = await client.getAccountInsights(days);
      if (data.success) {
        setAccountData(data);
      } else {
        setHata(t("insightsLoadFailed"));
      }
    } catch (error) {
      setHata(errorMessage(error, t("insightsLoadFailed")));
    } finally {
      setYukleniyor(false);
    }
  }, [client, days, t]);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  async function yenile() {
    setBilgi(null);
    try {
      await client.refreshAccountInsights();
      setBilgi(t("refreshQueued"));
    } catch (error) {
      setHata(errorMessage(error, t("insightsLoadFailed")));
    }
    await yukle();
  }

  const ozet = useMemo(
    () =>
      (accountData?.data ?? []).reduce<Record<string, number>>((acc, metric) => {
        acc[metric.name] = (metric.values ?? []).reduce((sum, value) => sum + (value.value || 0), 0);
        return acc;
      }, {}),
    [accountData],
  );

  const chartData = accountData?.data?.[0]?.values ?? [];
  const maxValue = Math.max(1, ...chartData.map((value) => value.value || 0));

  return (
    <div className="ig-sayfa ig-sayfa-genis" data-testid="instagram-analitik-page">
      <div className="ig-analitik-ust">
        <div className="ig-baslik">
          <div className="ig-baslik-ikon">
            <BarChart3 size={28} />
          </div>
          <div>
            <h1>{t("title")}</h1>
            <p>{t("subtitle")}</p>
          </div>
        </div>
        <div className="ig-analitik-kontroller">
          <select value={days} onChange={(event) => setDays(Number.parseInt(event.target.value, 10))} aria-label={t("dayRangeAria")}>
            <option value={7}>{t("last7Days")}</option>
            <option value={14}>{t("last14Days")}</option>
            <option value={28}>{t("last28Days")}</option>
          </select>
          <button type="button" onClick={() => void yenile()}>
            <RefreshCw size={16} className={yukleniyor ? "ig-spin" : ""} /> {t("refresh")}
          </button>
        </div>
      </div>

      {hata && (
        <div className="ig-mesaj ig-mesaj-hata" role="alert">
          <p>{hata}</p>
        </div>
      )}
      {accountData && (
        <p className="ig-senkron" data-testid="instagram-senkron">
          {accountData.synced_at
            ? t("syncedAt", { date: new Date(accountData.synced_at).toLocaleString(localeFor(language), { dateStyle: "medium", timeStyle: "short" }) })
            : t("notSynced", { gate: accountData.live_gate ?? "providers.instagram.live_mode" })}
          {bilgi && <span role="status"> {bilgi}</span>}
        </p>
      )}

      <div className="ig-ozet-grid" data-testid="instagram-ozet-kartlari">
        <div className="ig-ozet-kart">
          <div className="ig-ozet-etiket">
            <Users size={16} /> {t("followers")}
          </div>
          <p className="ig-ozet-deger">{formatNumber(accountData?.followers?.followers_count, language)}</p>
          <p className="ig-ozet-alt">{t("totalFollowers")}</p>
        </div>
        <div className="ig-ozet-kart">
          <div className="ig-ozet-etiket">
            <Eye size={16} /> {t("reach")}
          </div>
          <p className="ig-ozet-deger ig-yazi-pink">{formatNumber(ozet.reach, language)}</p>
          <p className="ig-ozet-alt">{t("lastNDays", { count: days })}</p>
        </div>
        <div className="ig-ozet-kart">
          <div className="ig-ozet-etiket">
            <TrendingUp size={16} /> {t("impressions")}
          </div>
          <p className="ig-ozet-deger ig-yazi-orange">{formatNumber(ozet.impressions, language)}</p>
          <p className="ig-ozet-alt">{t("lastNDays", { count: days })}</p>
        </div>
        <div className="ig-ozet-kart">
          <div className="ig-ozet-etiket">
            <Instagram size={16} /> {t("profileViews")}
          </div>
          <p className="ig-ozet-deger ig-yazi-purple">{formatNumber(ozet.profile_views, language)}</p>
          <p className="ig-ozet-alt">{t("lastNDays", { count: days })}</p>
        </div>
      </div>

      <div className="ig-kart" data-testid="instagram-gunluk-performans">
        <h2 className="ig-kart-baslik">{t("dailyPerformance")}</h2>
        {yukleniyor ? (
          <div className="ig-yukleniyor">
            <Loader2 size={16} className="ig-spin" /> {t("loading")}
          </div>
        ) : chartData.length === 0 ? (
          <p className="ig-bos">{t("noData")}</p>
        ) : (
          <div className="ig-gunluk-liste">
            {chartData.map((value, index) => (
              <div key={`${value.end_time}-${index}`} className="ig-gunluk-satir">
                <span className="ig-gunluk-tarih">
                  {new Date(value.end_time).toLocaleDateString(localeFor(language), { day: "2-digit", month: "short" })}
                </span>
                <div className="ig-gunluk-bar">
                  <div style={{ width: `${(value.value / maxValue) * 100}%` }} />
                </div>
                <span className="ig-gunluk-deger">{formatNumber(value.value, language)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {(accountData?.data?.length ?? 0) > 0 && (
        <div className="ig-kart" data-testid="instagram-tum-metrikler">
          <h2 className="ig-kart-baslik">{t("allMetrics")}</h2>
          <div className="ig-metrik-liste">
            {accountData?.data.map((metric) => (
              <div key={metric.name} className="ig-metrik">
                <div className="ig-metrik-ust">
                  <span className="ig-metrik-ad">{metric.name.replace(/_/g, " ")}</span>
                  <span className="ig-metrik-periyot">{metric.period}</span>
                </div>
                {metric.description && <p className="ig-metrik-aciklama">{metric.description}</p>}
                <p className="ig-metrik-deger">
                  {formatNumber((metric.values ?? []).reduce((sum, value) => sum + (value.value || 0), 0), language)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
