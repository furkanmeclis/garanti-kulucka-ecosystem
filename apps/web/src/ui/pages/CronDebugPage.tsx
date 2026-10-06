import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bug,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Trash2,
  Truck,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import type { BackendHttpClient } from "../../api/http-client.js";
import { createAdminClient, toProviderAttemptViewModel, type ProviderAttemptViewModel } from "../../api/admin-client.js";
import { hataMetni } from "./AyarlarShared.js";
import { compactJson, useAutoRefresh } from "./SuratDebugPage.js";

/**
 * Legacy parity: garanti-kulucka/frontend/src/pages/kargo/CronDebugPage.jsx.
 * Cron logları `/admin/integrations/provider-attempts` (operation `shipment.track`) üzerinden okunur;
 * tetikleme `/admin/integrations/provider-cron-triggers/{ptt|surat}` backend dry-run'ıdır (canlı provider kapalı).
 */

type Firma = "ptt" | "surat";

function cronKey(provider: Firma) {
  return `cron_debug_${provider}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function zamanFormatla(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("tr-TR");
}

function basarili(attempt: ProviderAttemptViewModel) {
  return attempt.status !== "failed" && attempt.status !== "error";
}

export function CronDebugPage({ http }: { http: BackendHttpClient }) {
  const adminClient = useMemo(() => createAdminClient(http), [http]);
  const [loglar, setLoglar] = useState<ProviderAttemptViewModel[]>([]);
  const [hata, setHata] = useState<string | null>(null);
  const [sonYenileme, setSonYenileme] = useState<string | null>(null);
  const [otomatikYenile, setOtomatikYenile] = useState(false);
  const [tetikleniyor, setTetikleniyor] = useState<Firma | "hepsi" | null>(null);
  const [temizlemeZamani, setTemizlemeZamani] = useState<string | null>(null);
  const [arama, setArama] = useState("");
  const [firmaFiltre, setFirmaFiltre] = useState<"hepsi" | Firma>("hepsi");
  const [acikLog, setAcikLog] = useState<string | null>(null);

  const loglariGetir = useCallback(async () => {
    try {
      const [ptt, surat] = await Promise.all([
        adminClient.listProviderAttempts({ provider_key: "ptt", limit: 100 }),
        adminClient.listProviderAttempts({ provider_key: "surat", limit: 100 }),
      ]);
      const tum = [...ptt.data, ...surat.data]
        .filter((attempt) => (attempt.provider_key === "ptt" || attempt.provider_key === "surat") && attempt.operation === "shipment.track")
        .map(toProviderAttemptViewModel)
        .sort((a, b) => b.started_at.localeCompare(a.started_at));
      const benzersiz = [...new Map(tum.map((attempt) => [attempt.public_id, attempt])).values()];
      setLoglar(benzersiz);
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

  async function cronTetikle(hedef: Firma | "hepsi") {
    setTetikleniyor(hedef);
    try {
      const firmalar: Firma[] = hedef === "hepsi" ? ["ptt", "surat"] : [hedef];
      const sonuclar = await Promise.all(
        firmalar.map((firma) => adminClient.triggerProviderCronDebug(firma, { idempotency_key: cronKey(firma) })),
      );
      const yeni = sonuclar.map(toProviderAttemptViewModel);
      setLoglar((current) => [...yeni, ...current.filter((log) => !yeni.some((item) => item.public_id === log.public_id))]);
      setHata(null);
    } catch (error) {
      setHata(hataMetni(error));
    } finally {
      setTetikleniyor(null);
    }
  }

  const tumLoglar = useMemo(
    () => loglar.filter((log) => !temizlemeZamani || log.started_at > temizlemeZamani),
    [loglar, temizlemeZamani],
  );

  const ozet = (firma: Firma) => {
    const firmaLoglari = tumLoglar.filter((log) => log.provider_key === firma);
    return {
      son: firmaLoglari[0]?.started_at ?? null,
      guncellenen: firmaLoglari.filter(basarili).length,
      hata: firmaLoglari.filter((log) => !basarili(log)).length,
    };
  };

  const filtrelenmisLoglar = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr-TR");
    return tumLoglar.filter((log) => {
      if (firmaFiltre !== "hepsi" && log.provider_key !== firmaFiltre) return false;
      if (!q) return true;
      return [log.request_id, log.error_message, log.provider_request_preview?.path, compactJson(log.response_metadata)]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("tr-TR").includes(q));
    });
  }, [tumLoglar, arama, firmaFiltre]);

  const ptt = ozet("ptt");
  const surat = ozet("surat");

  return (
    <div className="debug-page" data-testid="cron-debug-flow">
      <div className="debug-header">
        <div className="debug-title">
          <Bug size={24} className="debug-purple" />
          <div>
            <h1>Kargo Takip Cron Debug</h1>
            <p className="debug-mono">PTT + Sürat | Son yenileme: {sonYenileme ? new Date(sonYenileme).toLocaleString("tr-TR") : "-"}</p>
          </div>
        </div>
        <div className="debug-actions" data-testid="cron-debug-actions">
          <button type="button" className="debug-btn purple" onClick={() => void cronTetikle("hepsi")} disabled={tetikleniyor !== null}>
            {tetikleniyor === "hepsi" ? <Loader2 size={14} className="ayarlar-spin" /> : <Play size={14} />}
            Hepsini Çalıştır
          </button>
          <button type="button" className="debug-btn blue" onClick={() => void cronTetikle("ptt")} disabled={tetikleniyor !== null}>
            {tetikleniyor === "ptt" ? <Loader2 size={14} className="ayarlar-spin" /> : <Truck size={14} />}
            PTT Cron
          </button>
          <button type="button" className="debug-btn orange" onClick={() => void cronTetikle("surat")} disabled={tetikleniyor !== null}>
            {tetikleniyor === "surat" ? <Loader2 size={14} className="ayarlar-spin" /> : <Truck size={14} />}
            Sürat Cron
          </button>
          <span className="debug-divider" />
          <button type="button" className={`debug-btn ${otomatikYenile ? "live" : ""}`} onClick={() => setOtomatikYenile((v) => !v)}>
            {otomatikYenile ? <Wifi size={14} /> : <WifiOff size={14} />}
            {otomatikYenile ? "Canlı (2sn)" : "Canlı Kapalı"}
          </button>
          <button type="button" className="debug-btn blue" onClick={() => void loglariGetir()}>
            <RefreshCw size={14} />
            Yenile
          </button>
          <button type="button" className="debug-btn red" onClick={() => setTemizlemeZamani(new Date().toISOString())}>
            <Trash2 size={14} />
            Temizle
          </button>
        </div>
      </div>

      {hata && (
        <div className="debug-error">
          <XCircle size={16} />
          API Hatası: {hata}
        </div>
      )}

      <div className="debug-cron-cards" data-testid="cron-debug-detail">
        {([
          ["PTT Kargo Cron", ptt, "ptt"],
          ["Sürat Kargo Cron", surat, "surat"],
        ] as const).map(([baslik, veri, firma]) => (
          <div key={firma} className={`debug-cron-card ${firma}`}>
            <div className="debug-row">
              <Truck size={16} />
              <span className="debug-strong">{baslik}</span>
            </div>
            <div className="debug-cron-stats">
              <span>
                <span className="debug-muted">Son çalışma:</span> {zamanFormatla(veri.son)}
              </span>
              <span>
                <span className="debug-muted">Güncellenen:</span> <strong className="debug-green">{veri.guncellenen}</strong>
              </span>
              <span>
                <span className="debug-muted">Hata:</span> <strong className="debug-red">{veri.hata}</strong>
              </span>
            </div>
            <p className="debug-small">providers.{firma}.live_mode kapalı — cron-takip-guncelle canlı çağrı yok (dry-run)</p>
          </div>
        ))}
      </div>

      <div className="debug-filters">
        <label className="debug-search">
          <Search size={16} />
          <input
            type="text"
            placeholder="Tüm loglarda ara (takip no, hata mesajı, son hareket...)"
            value={arama}
            onChange={(e) => setArama(e.target.value)}
          />
        </label>
        <select aria-label="Firma" value={firmaFiltre} onChange={(e) => setFirmaFiltre(e.target.value as "hepsi" | Firma)}>
          <option value="hepsi">Tüm Firmalar</option>
          <option value="ptt">PTT</option>
          <option value="surat">Sürat</option>
        </select>
      </div>

      <div className="debug-small">
        {filtrelenmisLoglar.length} / {tumLoglar.length} cron çalışması gösteriliyor
      </div>

      {filtrelenmisLoglar.length === 0 ? (
        <div className="debug-empty">
          <Bug size={40} />
          <p>Henüz cron logu yok</p>
          <p className="debug-small">Cron job çalıştığında veya manuel tetiklendiğinde loglar burada görünecek</p>
        </div>
      ) : (
        <div className="debug-log-list">
          {filtrelenmisLoglar.map((log) => {
            const acik = acikLog === log.public_id;
            const firma = log.provider_key as Firma;
            return (
              <div key={log.public_id} className={`debug-log cron ${firma}`}>
                <button type="button" className="debug-log-head" onClick={() => setAcikLog(acik ? null : log.public_id)}>
                  {acik ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {basarili(log) ? <CheckCircle size={14} className="debug-green" /> : <XCircle size={14} className="debug-red" />}
                  <span className={`debug-badge firm ${firma}`}>{firma === "ptt" ? "PTT" : "Sürat"}</span>
                  <span className="debug-badge">
                    {log.status} / {log.retry_decision}
                  </span>
                  <span className="debug-mono">{log.request_id}</span>
                  <span className="debug-mono">{zamanFormatla(log.started_at)}</span>
                  <span className="debug-mono">{(log.duration_ms / 1000).toFixed(1)}s toplam</span>
                  {log.error_message && <span className="debug-red debug-truncate">{log.error_message}</span>}
                </button>
                {acik && (
                  <div className="debug-log-body">
                    <p>
                      <strong>Endpoint:</strong>{" "}
                      {log.provider_request_preview ? `${log.provider_request_preview.method} ${log.provider_request_preview.path}` : "-"}
                    </p>
                    <p>
                      <strong>Body:</strong> <code>{compactJson(log.provider_request_preview?.body)}</code>
                    </p>
                    <p>
                      <strong>Yanıt:</strong> <code>{compactJson(log.response_metadata)}</code>
                    </p>
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
