import { useCallback, useEffect, useMemo, useState } from "react";
import { Bug, ChevronDown, ChevronRight, RefreshCw, Search, Trash2, Wifi, WifiOff, XCircle } from "lucide-react";
import type { BackendHttpClient } from "../../api/http-client.js";
import {
  createAdminClient,
  toProviderAttemptViewModel,
  type ProviderAttemptViewModel,
  type ProviderCatalogItem,
} from "../../api/admin-client.js";
import { localeFor, useLanguage, useT, type UiLanguage } from "../i18n/index.js";
import { suratDebugMessages } from "../i18n/messages/suratDebug.js";
import { hataMetni } from "./AyarlarShared.js";

/**
 * Legacy parity: garanti-kulucka/frontend/src/pages/kargo/SuratKargoDebugPage.jsx.
 * Kaynak `/admin/integrations/provider-attempts?provider_key=surat` (admin-only); istek önizlemeleri
 * backend tarafından redakte edilir, canlı Sürat çağrısı tarayıcıdan yapılmaz.
 */

const LOG_LIMIT = 200;

type DurumFiltre = "hepsi" | "basarili" | "hata" | "kurtarildi";

export function attemptDurumu(attempt: ProviderAttemptViewModel): Exclude<DurumFiltre, "hepsi"> {
  if (attempt.status === "failed" || attempt.status === "error") return "hata";
  if (attempt.retry_decision === "retry" || attempt.retry_decision === "retried") return "kurtarildi";
  return "basarili";
}

const sensitiveKeyPattern = /authorization|token|secret|password|credential|api[_-]?key/i;

function redacted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redacted);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, sensitiveKeyPattern.test(key) ? "[redacted]" : redacted(entry)]),
  );
}

/** Defense in depth: backend zaten redakte eder; UI yine de hassas anahtarları maskeler. */
export function compactJson(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(redacted(value));
  } catch {
    return String(value);
  }
}

export function saatFormatla(value: string | null | undefined, language: UiLanguage = "tr") {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleTimeString(localeFor(language));
}

export function useAutoRefresh(enabled: boolean, callback: () => void, intervalMs = 2000) {
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setInterval(callback, intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, callback, intervalMs]);
}

export function SuratDebugPage({ http }: { http: BackendHttpClient }) {
  const t = useT(suratDebugMessages);
  const { language } = useLanguage();
  const adminClient = useMemo(() => createAdminClient(http), [http]);
  const [loglar, setLoglar] = useState<ProviderAttemptViewModel[]>([]);
  const [catalogItem, setCatalogItem] = useState<ProviderCatalogItem | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [sonYenileme, setSonYenileme] = useState<string | null>(null);
  const [otomatikYenile, setOtomatikYenile] = useState(false);
  const [temizlemeZamani, setTemizlemeZamani] = useState<string | null>(null);
  const [arama, setArama] = useState("");
  const [endpointFiltre, setEndpointFiltre] = useState("hepsi");
  const [durumFiltre, setDurumFiltre] = useState<DurumFiltre>("hepsi");
  const [acikLog, setAcikLog] = useState<string | null>(null);

  const loglariGetir = useCallback(async () => {
    try {
      const [{ data }, catalog] = await Promise.all([
        adminClient.listProviderAttempts({ provider_key: "surat", limit: 100 }),
        adminClient.listProviderCatalog(),
      ]);
      setLoglar(data.filter((attempt) => attempt.provider_key === "surat").map(toProviderAttemptViewModel));
      setCatalogItem(catalog.data.find((item) => item.provider === "surat") ?? null);
      setHata(null);
      setSonYenileme(new Date().toISOString());
    } catch (error) {
      setHata(hataMetni(error));
    }
  }, [adminClient]);

  useEffect(() => {
    void loglariGetir();
  }, [loglariGetir]);

  const autoRefresh = useCallback(() => void loglariGetir(), [loglariGetir]);
  useAutoRefresh(otomatikYenile, autoRefresh);

  const gorunurLoglar = useMemo(
    () => loglar.filter((log) => !temizlemeZamani || log.started_at > temizlemeZamani),
    [loglar, temizlemeZamani],
  );

  const istatistikler = useMemo(() => {
    const sureler = gorunurLoglar.map((log) => log.duration_ms);
    return {
      toplam: gorunurLoglar.length,
      basarili: gorunurLoglar.filter((log) => attemptDurumu(log) === "basarili").length,
      hata: gorunurLoglar.filter((log) => attemptDurumu(log) === "hata").length,
      kurtarildi: gorunurLoglar.filter((log) => attemptDurumu(log) === "kurtarildi").length,
      ortSure: sureler.length ? Math.round(sureler.reduce((a, b) => a + b, 0) / sureler.length) : 0,
      minSure: sureler.length ? Math.min(...sureler) : 0,
      maxSure: sureler.length ? Math.max(...sureler) : 0,
    };
  }, [gorunurLoglar]);

  const filtreliLoglar = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr-TR");
    return gorunurLoglar.filter((log) => {
      const path = log.provider_request_preview?.path ?? "";
      if (endpointFiltre !== "hepsi" && !path.includes(endpointFiltre)) return false;
      if (durumFiltre !== "hepsi" && attemptDurumu(log) !== durumFiltre) return false;
      if (!q) return true;
      return [log.operation, log.request_id, log.error_message, path, compactJson(log.provider_request_preview?.body)]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("tr-TR").includes(q));
    });
  }, [gorunurLoglar, arama, endpointFiltre, durumFiltre]);

  const kartlar = [
    { baslik: t("statTotal"), deger: String(istatistikler.toplam), renk: "gray" },
    { baslik: t("statSuccess"), deger: String(istatistikler.basarili), renk: "green" },
    { baslik: t("statError"), deger: String(istatistikler.hata), renk: "red" },
    { baslik: t("statRecovered"), deger: String(istatistikler.kurtarildi), renk: "yellow" },
    { baslik: t("statAvgDuration"), deger: `${istatistikler.ortSure}ms`, renk: "blue" },
    { baslik: t("statMinDuration"), deger: `${istatistikler.minSure}ms`, renk: "indigo" },
    { baslik: t("statMaxDuration"), deger: `${istatistikler.maxSure}ms`, renk: "purple" },
  ];

  return (
    <div className="debug-page" data-testid="surat-debug-flow">
      <div className="debug-header">
        <div className="debug-title">
          <Bug size={24} className="debug-red" />
          <div>
            <h1>{t("title")}</h1>
            <p className="debug-mono">
              {t("lastRefresh", {
                time: sonYenileme ? new Date(sonYenileme).toLocaleTimeString(localeFor(language)) : "-",
                visible: gorunurLoglar.length,
                limit: LOG_LIMIT,
              })}
            </p>
          </div>
        </div>
        <div className="debug-actions">
          <button type="button" className={`debug-btn ${otomatikYenile ? "live" : ""}`} onClick={() => setOtomatikYenile((v) => !v)}>
            {otomatikYenile ? <Wifi size={14} /> : <WifiOff size={14} />}
            {otomatikYenile ? t("liveOn") : t("liveOff")}
          </button>
          <button type="button" className="debug-btn blue" onClick={() => void loglariGetir()}>
            <RefreshCw size={14} />
            {t("refresh")}
          </button>
          <button type="button" className="debug-btn red" onClick={() => setTemizlemeZamani(new Date().toISOString())}>
            <Trash2 size={14} />
            {t("clear")}
          </button>
        </div>
      </div>

      {hata && (
        <div className="debug-error">
          <XCircle size={16} />
          {t("apiError", { message: hata })}
        </div>
      )}

      <div className="debug-stats">
        {kartlar.map((kart) => (
          <div key={kart.baslik} className={`debug-stat ${kart.renk}`}>
            <div className="debug-stat-label">{kart.baslik}</div>
            <div className="debug-stat-value">{kart.deger}</div>
          </div>
        ))}
      </div>

      <div className="debug-gate" data-testid="surat-debug-detail">
        <span>{t("liveGate", { state: catalogItem?.live_call_permitted ? t("gateOpen") : t("gateClosed") })}</span>
        <span>{catalogItem?.live_feature_flag_key ?? "providers.surat.live_mode"}</span>
        <span>{catalogItem?.live_block_reason ?? "-"}</span>
      </div>

      <div className="debug-filters">
        <label className="debug-search">
          <Search size={16} />
          <input
            type="text"
            placeholder={t("searchPlaceholder")}
            value={arama}
            onChange={(e) => setArama(e.target.value)}
          />
        </label>
        <select aria-label={t("endpointLabel")} value={endpointFiltre} onChange={(e) => setEndpointFiltre(e.target.value)}>
          <option value="hepsi">{t("allEndpoints")}</option>
          <option value="/kargoya-gonder">{t("endpointSend")}</option>
          <option value="/kargo-takip">{t("endpointTrack")}</option>
          <option value="/gonderi-sil">{t("endpointDelete")}</option>
          <option value="/gonderi-geri-cek">{t("endpointWithdraw")}</option>
        </select>
        <select aria-label={t("statusLabel")} value={durumFiltre} onChange={(e) => setDurumFiltre(e.target.value as DurumFiltre)}>
          <option value="hepsi">{t("allStatuses")}</option>
          <option value="basarili">{t("statSuccess")}</option>
          <option value="hata">{t("statError")}</option>
          <option value="kurtarildi">{t("statRecovered")}</option>
        </select>
      </div>

      {filtreliLoglar.length === 0 ? (
        <div className="debug-empty">
          <Bug size={40} />
          <p>{t("emptyTitle")}</p>
          <p className="debug-small">{t("emptyHint")}</p>
        </div>
      ) : (
        <div className="debug-log-list">
          {filtreliLoglar.map((log) => {
            const durum = attemptDurumu(log);
            const acik = acikLog === log.public_id;
            return (
              <div key={log.public_id} className={`debug-log ${durum}`}>
                <button type="button" className="debug-log-head" onClick={() => setAcikLog(acik ? null : log.public_id)}>
                  {acik ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="debug-mono">{saatFormatla(log.started_at, language)}</span>
                  <span className="debug-strong">
                    {log.operation} / {log.direction}
                  </span>
                  <span className={`debug-badge ${durum}`}>
                    {log.status} / {log.retry_decision}
                  </span>
                  <span className="debug-mono">
                    {log.provider_request_preview ? `${log.provider_request_preview.method} ${log.provider_request_preview.path}` : "-"}
                  </span>
                  <span className="debug-mono">{log.duration_ms}ms</span>
                </button>
                {acik && (
                  <div className="debug-log-body">
                    <p>
                      <strong>{t("request")}</strong> {log.request_id}
                    </p>
                    {log.error_message && (
                      <p className="debug-red">
                        <strong>{t("error")}</strong> {log.error_code ?? ""} {log.error_message}
                      </p>
                    )}
                    <p>
                      <strong>Header:</strong> <code>{compactJson(log.provider_request_preview?.headers)}</code>
                    </p>
                    <p>
                      <strong>Body:</strong> <code>{compactJson(log.provider_request_preview?.body)}</code>
                    </p>
                    <p>
                      <strong>{t("response")}</strong> <code>{compactJson(log.response_metadata)}</code>
                    </p>
                    {log.provider_request_preview?.live_call_performed === false && <p className="debug-small">{t("noLiveCall")}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
