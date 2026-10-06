import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Eye, Instagram, Loader2, RefreshCw, TrendingUp, Users } from "lucide-react";
import { BackendRequestError, type BackendHttpClient } from "../../api/http-client.js";
import { createInstagramClient, type InstagramAccountInsights } from "../../api/instagram-client.js";

/**
 * Legacy frontend/src/pages/instagram/AnalitikPage.jsx parity (admin, calisan). Account insights
 * come from `GET /api/instagram/insights/account?days=N` (backend boundary, never Meta directly).
 */

function errorMessage(error: unknown) {
  if (error instanceof BackendRequestError) {
    const body = error.body as { error?: { message?: unknown } } | null | undefined;
    if (typeof body?.error?.message === "string" && body.error.message.length > 0) return body.error.message;
  }
  return error instanceof Error && error.message ? error.message : "İnsights alınamadı";
}

function formatNumber(value: number | null | undefined) {
  return (value || 0).toLocaleString();
}

export function InstagramAnalitikPage(props: { http: BackendHttpClient }) {
  const client = useMemo(() => createInstagramClient(props.http), [props.http]);
  const [days, setDays] = useState(7);
  const [accountData, setAccountData] = useState<InstagramAccountInsights | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    setHata(null);
    try {
      const data = await client.getAccountInsights(days);
      if (data.success) {
        setAccountData(data);
      } else {
        setHata("İnsights alınamadı");
      }
    } catch (error) {
      setHata(errorMessage(error));
    } finally {
      setYukleniyor(false);
    }
  }, [client, days]);

  useEffect(() => {
    void yukle();
  }, [yukle]);

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
            <h1>Instagram Analitik</h1>
            <p>Hesap performans metrikleri</p>
          </div>
        </div>
        <div className="ig-analitik-kontroller">
          <select value={days} onChange={(event) => setDays(Number.parseInt(event.target.value, 10))} aria-label="Gün aralığı">
            <option value={7}>Son 7 gün</option>
            <option value={14}>Son 14 gün</option>
            <option value={28}>Son 28 gün</option>
          </select>
          <button type="button" onClick={() => void yukle()}>
            <RefreshCw size={16} className={yukleniyor ? "ig-spin" : ""} /> Yenile
          </button>
        </div>
      </div>

      {hata && (
        <div className="ig-mesaj ig-mesaj-hata" role="alert">
          <p>{hata}</p>
        </div>
      )}

      <div className="ig-ozet-grid" data-testid="instagram-ozet-kartlari">
        <div className="ig-ozet-kart">
          <div className="ig-ozet-etiket">
            <Users size={16} /> Takipçi
          </div>
          <p className="ig-ozet-deger">{formatNumber(accountData?.followers?.followers_count)}</p>
          <p className="ig-ozet-alt">Toplam takipçi</p>
        </div>
        <div className="ig-ozet-kart">
          <div className="ig-ozet-etiket">
            <Eye size={16} /> Erişim
          </div>
          <p className="ig-ozet-deger ig-yazi-pink">{formatNumber(ozet.reach)}</p>
          <p className="ig-ozet-alt">Son {days} gün</p>
        </div>
        <div className="ig-ozet-kart">
          <div className="ig-ozet-etiket">
            <TrendingUp size={16} /> Gösterim
          </div>
          <p className="ig-ozet-deger ig-yazi-orange">{formatNumber(ozet.impressions)}</p>
          <p className="ig-ozet-alt">Son {days} gün</p>
        </div>
        <div className="ig-ozet-kart">
          <div className="ig-ozet-etiket">
            <Instagram size={16} /> Profil Görüntüleme
          </div>
          <p className="ig-ozet-deger ig-yazi-purple">{formatNumber(ozet.profile_views)}</p>
          <p className="ig-ozet-alt">Son {days} gün</p>
        </div>
      </div>

      <div className="ig-kart" data-testid="instagram-gunluk-performans">
        <h2 className="ig-kart-baslik">Günlük Performans</h2>
        {yukleniyor ? (
          <div className="ig-yukleniyor">
            <Loader2 size={16} className="ig-spin" /> Yükleniyor...
          </div>
        ) : chartData.length === 0 ? (
          <p className="ig-bos">Veri bulunamadı. Instagram hesabınızda trafii olan bir gün olmalı.</p>
        ) : (
          <div className="ig-gunluk-liste">
            {chartData.map((value, index) => (
              <div key={`${value.end_time}-${index}`} className="ig-gunluk-satir">
                <span className="ig-gunluk-tarih">
                  {new Date(value.end_time).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
                </span>
                <div className="ig-gunluk-bar">
                  <div style={{ width: `${(value.value / maxValue) * 100}%` }} />
                </div>
                <span className="ig-gunluk-deger">{formatNumber(value.value)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {(accountData?.data?.length ?? 0) > 0 && (
        <div className="ig-kart" data-testid="instagram-tum-metrikler">
          <h2 className="ig-kart-baslik">Tüm Metrikler</h2>
          <div className="ig-metrik-liste">
            {accountData?.data.map((metric) => (
              <div key={metric.name} className="ig-metrik">
                <div className="ig-metrik-ust">
                  <span className="ig-metrik-ad">{metric.name.replace(/_/g, " ")}</span>
                  <span className="ig-metrik-periyot">{metric.period}</span>
                </div>
                {metric.description && <p className="ig-metrik-aciklama">{metric.description}</p>}
                <p className="ig-metrik-deger">
                  {formatNumber((metric.values ?? []).reduce((sum, value) => sum + (value.value || 0), 0))}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
