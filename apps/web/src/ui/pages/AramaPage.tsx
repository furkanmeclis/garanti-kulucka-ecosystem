import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  BarChart3,
  BookUser,
  Filter,
  Loader2,
  MessageSquare,
  Pause,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Play,
  RefreshCw,
  Save,
  Search,
  SkipForward,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { BackendRequestError, type BackendHttpClient } from "../../api/http-client.js";
import {
  createVoiceClient,
  type NetgsmCdrRecord,
  type NetgsmCdrStatistics,
  type NetgsmTeyitSettings,
  type VoiceClient,
} from "../../api/voice-client.js";
import { useT } from "../i18n/index.js";
import { callsMessages } from "../i18n/messages/calls.js";
import { voiceMessagesMessages } from "../i18n/messages/voiceMessages.js";

/**
 * Legacy parity: garanti-kulucka/frontend/src/pages/sesli-asistan/AramaPage.jsx
 * (= ayarlar/NetgsmAyarlar + sesli-asistan/GorusmeDetayPage). Teyit settings live in backend settings;
 * NetGSM CDR reports are fetched by the worker (`netgsm.call.report`) and served from `/api/netgsm/cdr*`.
 */

const VARSAYILAN: NetgsmTeyitSettings = { aktif: false, ilk_arama_dakika: 5, max_deneme: 3, deneme_arasi_dakika: 10 };

function hataMesaji(error: unknown, fallback: string) {
  if (error instanceof BackendRequestError) {
    const body = error.body as { error?: { message?: unknown } } | null | undefined;
    if (typeof body?.error?.message === "string" && body.error.message.length > 0) return body.error.message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export function AramaPage(props: { http: BackendHttpClient }) {
  const client = useMemo(() => createVoiceClient(props.http), [props.http]);
  const t = useT(callsMessages);
  const tv = useT(voiceMessagesMessages);
  return (
    <section className="arama-page" data-testid="calls-flow">
      <div className="voice-page-head">
        <div>
          <h1>{t("pageTitle")}</h1>
          <p className="arama-muted">{t("pageSubtitle")}</p>
        </div>
        <div className="voice-actions">
          <Link to="/sesli-asistan/sesli-mesajlar" className="secondary-action voice-link" data-testid="calls-voice-messages-link">
            <MessageSquare size={16} aria-hidden="true" />
            {tv("openVoiceMessages")}
          </Link>
          <Link to="/sesli-asistan/rehber" className="secondary-action voice-link" data-testid="calls-phonebook-link">
            <BookUser size={16} aria-hidden="true" />
            {tv("openPhonebook")}
          </Link>
        </div>
      </div>
      <NetgsmAyarlar client={client} />
      <GorusmeDetay client={client} />
    </section>
  );
}

function NetgsmAyarlar(props: { client: VoiceClient }) {
  const { client } = props;
  const t = useT(callsMessages);
  const [ayarlar, setAyarlar] = useState<NetgsmTeyitSettings>(VARSAYILAN);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [mesaj, setMesaj] = useState<{ tip: "basari" | "hata"; metin: string } | null>(null);

  useEffect(() => {
    let iptal = false;
    client
      .getTeyitSettings()
      .then((r) => {
        if (!iptal) setAyarlar({ ...VARSAYILAN, ...r.settings });
      })
      .catch(() => undefined)
      .finally(() => {
        if (!iptal) setYukleniyor(false);
      });
    return () => {
      iptal = true;
    };
  }, [client]);

  useEffect(() => {
    if (!mesaj) return;
    const zamanlayici = setTimeout(() => setMesaj(null), 3000);
    return () => clearTimeout(zamanlayici);
  }, [mesaj]);

  const handleKaydet = async () => {
    setKaydediliyor(true);
    try {
      await client.updateTeyitSettings(ayarlar);
      setMesaj({ tip: "basari", metin: t("settingsSaved") });
    } catch (error) {
      setMesaj({ tip: "hata", metin: t("saveFailed", { error: hataMesaji(error, t("unknownError")) }) });
    } finally {
      setKaydediliyor(false);
    }
  };

  const set = (alan: keyof NetgsmTeyitSettings, deger: number | boolean) => setAyarlar((prev) => ({ ...prev, [alan]: deger }));

  if (yukleniyor) {
    return (
      <div className="arama-loading">
        <Loader2 size={16} className="arama-spin" />
        <span>{t("loading")}</span>
      </div>
    );
  }

  return (
    <div className="arama-card" data-testid="netgsm-teyit-settings">
      <div className="arama-card-head">
        <div className="arama-card-icon">
          <Phone size={20} />
        </div>
        <div>
          <h3>{t("autoCallTitle")}</h3>
          <p className="arama-muted">{t("autoCallSubtitle")}</p>
        </div>
      </div>

      <div className="arama-toggle-row">
        <div>
          <p className="arama-strong">{t("autoCallActive")}</p>
          <p className="arama-muted">{t("autoCallActiveHint")}</p>
        </div>
        <button type="button" className="arama-toggle" aria-label={t("autoCallActive")} aria-pressed={ayarlar.aktif} onClick={() => set("aktif", !ayarlar.aktif)}>
          {ayarlar.aktif ? <ToggleRight size={32} className="arama-green" /> : <ToggleLeft size={32} />}
        </button>
      </div>

      <div className="arama-number-grid">
        <label>
          <span>{t("firstCallLabel")}</span>
          <input type="number" min={1} max={60} value={ayarlar.ilk_arama_dakika} onChange={(e) => set("ilk_arama_dakika", Math.max(1, Number.parseInt(e.target.value, 10) || 1))} />
          <small>{t("firstCallHint")}</small>
        </label>
        <label>
          <span>{t("maxAttemptsLabel")}</span>
          <input type="number" min={1} max={10} value={ayarlar.max_deneme} onChange={(e) => set("max_deneme", Math.max(1, Number.parseInt(e.target.value, 10) || 1))} />
          <small>{t("maxAttemptsHint")}</small>
        </label>
        <label>
          <span>{t("retryIntervalLabel")}</span>
          <input type="number" min={1} max={120} value={ayarlar.deneme_arasi_dakika} onChange={(e) => set("deneme_arasi_dakika", Math.max(1, Number.parseInt(e.target.value, 10) || 1))} />
          <small>{t("retryIntervalHint")}</small>
        </label>
      </div>

      {ayarlar.aktif && (
        <div className="arama-summary">
          {t("summaryLead")} <strong>{t("summaryMinutes", { count: ayarlar.ilk_arama_dakika })}</strong> {t("summaryAfterFirst")}{" "}
          <strong>{t("summaryMinutes", { count: ayarlar.deneme_arasi_dakika })}</strong> {t("summaryInterval")}{" "}
          <strong>{t("summaryTimes", { count: ayarlar.max_deneme })}</strong> {t("summaryTail")}
        </div>
      )}

      {mesaj && <div className={`arama-message ${mesaj.tip === "basari" ? "arama-message-ok" : "arama-message-error"}`}>{mesaj.metin}</div>}

      <button type="button" className="arama-save" onClick={() => void handleKaydet()} disabled={kaydediliyor}>
        {kaydediliyor ? <Loader2 size={16} className="arama-spin" /> : <Save size={16} />}
        {t("save")}
      </button>
    </div>
  );
}

type GorusmeTab = "gelen" | "giden" | "istatistik";

function GorusmeDetay(props: { client: VoiceClient }) {
  const { client } = props;
  const t = useT(callsMessages);
  const [aktifTab, setAktifTab] = useState<GorusmeTab>("gelen");
  const [yukleniyor, setYukleniyor] = useState(false);
  const [yapilandirilmis, setYapilandirilmis] = useState<boolean | null>(null);
  const [aramalar, setAramalar] = useState<NetgsmCdrRecord[]>([]);
  const [istatistikler, setIstatistikler] = useState<NetgsmCdrStatistics | null>(null);
  const [toplamKayit, setToplamKayit] = useState(0);
  const [toplamSure, setToplamSure] = useState("00:00:00");
  const [hata, setHata] = useState<string | null>(null);
  const [filtreler, setFiltreler] = useState({ baslangicTarih: "", bitisTarih: "", arama: "" });
  const [filtreAcik, setFiltreAcik] = useState(false);
  const [sayfa, setSayfa] = useState(1);
  const [sayfaBoyutu, setSayfaBoyutu] = useState(10);
  const [kalanSure, setKalanSure] = useState<Record<string, number>>({});
  const [oynatilan, setOynatilan] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ilkSenkron = useRef(false);

  const sesOynat = useCallback(
    (aramaId: string, sesUrl: string) => {
      if (oynatilan === aramaId && audioRef.current) {
        audioRef.current.pause();
        setOynatilan(null);
        return;
      }
      audioRef.current?.pause();
      const audio = new Audio(sesUrl);
      audioRef.current = audio;
      setOynatilan(aramaId);
      audio.addEventListener("timeupdate", () => {
        const kalan = Math.max(0, Math.ceil(audio.duration - audio.currentTime));
        setKalanSure((prev) => ({ ...prev, [aramaId]: kalan }));
      });
      audio.addEventListener("ended", () => setOynatilan(null));
      audio.addEventListener("error", () => {
        setHata(t("playbackFailed"));
        setOynatilan(null);
      });
      audio.play().catch(() => {
        setHata(t("playbackFailed"));
        setOynatilan(null);
      });
    },
    [oynatilan, t],
  );

  const ileriSar = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.min(audioRef.current.currentTime + 10, audioRef.current.duration || 0);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [aktifTab, sayfa]);

  useEffect(() => {
    let iptal = false;
    client
      .getNetgsmStatus()
      .then((r) => {
        if (!iptal) setYapilandirilmis(r.configured);
      })
      .catch(() => {
        if (!iptal) setYapilandirilmis(false);
      });
    return () => {
      iptal = true;
    };
  }, [client]);

  const verileriYukle = useCallback(
    async (senkronize: boolean) => {
      if (!yapilandirilmis) return;
      setYukleniyor(true);
      setHata(null);
      try {
        if (senkronize) {
          await client.syncCdr({
            ...(filtreler.baslangicTarih ? { baslangic_tarih: filtreler.baslangicTarih } : {}),
            ...(filtreler.bitisTarih ? { bitis_tarih: filtreler.bitisTarih } : {}),
            idempotency_key: `netgsm_cdr_${filtreler.baslangicTarih || "son7"}_${filtreler.bitisTarih || "bugun"}_${Math.floor(Date.now() / 60_000)}`,
          });
        }
        if (aktifTab === "istatistik") {
          const r = await client.getCdrStatistics();
          setIstatistikler(r.data);
          return;
        }
        const data = await client.listCdr({ yon: aktifTab, sayfa, sayfaBoyutu });
        if (data.success === false) {
          setHata(data.error || t("apiError"));
          setAramalar([]);
          setToplamKayit(0);
          return;
        }
        setAramalar(data.data?.kayitlar ?? []);
        setToplamKayit(data.data?.toplamKayit ?? 0);
        setToplamSure(data.data?.toplamSure ?? "00:00:00");
      } catch (error) {
        setHata(hataMesaji(error, t("loadFailed")));
        setAramalar([]);
        setToplamKayit(0);
      } finally {
        setYukleniyor(false);
      }
    },
    [client, yapilandirilmis, aktifTab, sayfa, sayfaBoyutu, filtreler.baslangicTarih, filtreler.bitisTarih, t],
  );

  useEffect(() => {
    if (yapilandirilmis === null) return;
    const senkronize = !ilkSenkron.current;
    ilkSenkron.current = true;
    void verileriYukle(senkronize);
    // Filtre alanları yalnızca Filtrele/Yenile ile uygulanır (legacy davranışı).
  }, [yapilandirilmis, aktifTab, sayfa, sayfaBoyutu]);

  if (yapilandirilmis === false) {
    return (
      <div className="arama-unconfigured" data-testid="netgsm-unconfigured">
        <Phone size={64} />
        <h2>{t("netgsmUnconfiguredTitle")}</h2>
        <p>{t("netgsmUnconfiguredBody")}</p>
        <div className="arama-code">
          NETGSM_USERCODE=...
          <br />
          NETGSM_PASSWORD=...
        </div>
      </div>
    );
  }

  const tabs: Array<{ id: GorusmeTab; label: string; icon: typeof Phone }> = [
    { id: "gelen", label: t("tabIncoming"), icon: PhoneIncoming },
    { id: "giden", label: t("tabOutgoing"), icon: PhoneOutgoing },
    { id: "istatistik", label: t("tabStatistics"), icon: BarChart3 },
  ];
  const toplamSayfa = toplamKayit > 0 ? Math.ceil(toplamKayit / sayfaBoyutu) : sayfa;

  return (
    <div className="arama-gorusme" data-testid="netgsm-gorusme">
      <div className="arama-gorusme-head">
        <h2>{t("recordsTitle")}</h2>
        <p className="arama-muted">{t("recordsSubtitle")}</p>
      </div>

      <nav className="arama-tabs">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} type="button" className={aktifTab === tab.id ? "selected" : undefined} onClick={() => setAktifTab(tab.id)}>
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </nav>

      <div className="arama-toolbar">
        <div className="arama-toolbar-actions">
          <button type="button" className={filtreAcik ? "arama-filter-button active" : "arama-filter-button"} onClick={() => setFiltreAcik(!filtreAcik)}>
            <Filter size={16} />
            {t("filter")}
          </button>
          <button type="button" className="arama-filter-button" onClick={() => void verileriYukle(true)} disabled={yukleniyor}>
            <RefreshCw size={16} className={yukleniyor ? "arama-spin" : undefined} />
            {t("refresh")}
          </button>
        </div>
        <div className="arama-totals">
          <span>
            {t("recordCount")} <strong>{toplamKayit}</strong>
          </span>
          <span>
            {t("totalDuration")} <strong>{toplamSure}</strong>
          </span>
        </div>
      </div>

      {filtreAcik && (
        <div className="arama-filter-panel">
          <label>
            <span>{t("startDate")}</span>
            <input type="date" value={filtreler.baslangicTarih} onChange={(e) => setFiltreler({ ...filtreler, baslangicTarih: e.target.value })} />
          </label>
          <label>
            <span>{t("endDate")}</span>
            <input type="date" value={filtreler.bitisTarih} onChange={(e) => setFiltreler({ ...filtreler, bitisTarih: e.target.value })} />
          </label>
          <label>
            <span>{t("searchNumber")}</span>
            <div className="arama-search">
              <Search size={16} />
              <input type="text" placeholder={t("searchNumberPlaceholder")} value={filtreler.arama} onChange={(e) => setFiltreler({ ...filtreler, arama: e.target.value })} />
            </div>
          </label>
          <div className="arama-filter-submit">
            <button type="button" onClick={() => void verileriYukle(true)}>
              {t("filter")}
            </button>
          </div>
        </div>
      )}

      {hata && (
        <div className="arama-error">
          <AlertCircle size={20} />
          <div>
            <h3>{t("apiErrorTitle")}</h3>
            <p>{hata}</p>
          </div>
        </div>
      )}

      {aktifTab === "istatistik" ? (
        yukleniyor ? (
          <div className="arama-loading arama-loading-center">
            <Loader2 size={32} className="arama-spin" />
            <span>{t("statisticsLoading")}</span>
          </div>
        ) : (
          <div className="arama-stats" data-testid="netgsm-cdr-stats">
            <div className="arama-stat-grid">
              <div className="arama-stat">
                <PhoneIncoming size={24} className="arama-green" />
                <div>
                  <p className="arama-muted">{t("incomingCalls")}</p>
                  <strong>{istatistikler?.gelenArama || 0}</strong>
                  <small>{t("answeredMissed", { answered: istatistikler?.gelenCevapli || 0, missed: istatistikler?.gelenCevapsiz || 0 })}</small>
                </div>
              </div>
              <div className="arama-stat">
                <PhoneOutgoing size={24} className="arama-blue" />
                <div>
                  <p className="arama-muted">{t("outgoingCalls")}</p>
                  <strong>{istatistikler?.gidenArama || 0}</strong>
                  <small>{t("outgoingCallsHint")}</small>
                </div>
              </div>
              <div className="arama-stat">
                <Phone size={24} className="arama-purple" />
                <div>
                  <p className="arama-muted">{t("totalDurationStat")}</p>
                  <strong>{istatistikler?.toplamSure || "00:00:00"}</strong>
                  <small>{t("averageDuration", { value: istatistikler?.ortalamaSure || "00:00:00" })}</small>
                </div>
              </div>
              <div className="arama-stat">
                <BarChart3 size={24} className="arama-orange" />
                <div>
                  <p className="arama-muted">{t("answerRate")}</p>
                  <strong>{t("percentValue", { value: istatistikler?.cevaplananOran || 0 })}</strong>
                  <small>{t("answerRateHint")}</small>
                </div>
              </div>
            </div>
            <div className="arama-card">
              <h3>{t("summaryTitle")}</h3>
              <div className="arama-summary-grid">
                <div>
                  <p className="arama-muted">{t("totalCalls")}</p>
                  <strong>{istatistikler?.toplamGorisme || 0}</strong>
                </div>
                <div>
                  <p className="arama-muted">{t("incomingAnswered")}</p>
                  <strong className="arama-green">{istatistikler?.gelenCevapli || 0}</strong>
                </div>
                <div>
                  <p className="arama-muted">{t("incomingMissed")}</p>
                  <strong className="arama-red">{istatistikler?.gelenCevapsiz || 0}</strong>
                </div>
                <div>
                  <p className="arama-muted">{t("outgoing")}</p>
                  <strong className="arama-blue">{istatistikler?.gidenArama || 0}</strong>
                </div>
              </div>
            </div>
          </div>
        )
      ) : (
        <div className="arama-table-card">
          <div className="arama-table-scroll">
            <table className="arama-table" data-testid="netgsm-cdr-table">
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" aria-label={t("selectAll")} />
                  </th>
                  <th>{t("colDirection")}</th>
                  <th>{t("colDate")}</th>
                  <th>{t("colCaller")}</th>
                  <th>{t("colCallee")}</th>
                  <th>{t("colStatus")}</th>
                  <th>{t("colDuration")}</th>
                  <th>{t("colRecording")}</th>
                </tr>
              </thead>
              <tbody>
                {yukleniyor ? (
                  <tr>
                    <td colSpan={8} className="arama-empty">
                      <Loader2 size={32} className="arama-spin" />
                      <span>{t("netgsmLoading")}</span>
                    </td>
                  </tr>
                ) : aramalar.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="arama-empty">
                      {hata ? t("noDataDueToError") : t("noRecords")}
                    </td>
                  </tr>
                ) : (
                  aramalar.map((arama, index) => {
                    const anahtar = arama.id || String(index);
                    const aktif = oynatilan === anahtar;
                    return (
                      <tr key={`${anahtar}_${index}`}>
                        <td>
                          <input type="checkbox" aria-label={t("select")} />
                        </td>
                        <td>{arama.yonKod === 1 || arama.yonKod === 2 ? <PhoneIncoming size={20} className="arama-green" /> : <PhoneOutgoing size={20} className="arama-blue" />}</td>
                        <td>{arama.tarih}</td>
                        <td>
                          <span className="arama-caller">{arama.arayanNumara}</span>
                          {arama.arayanAdi && arama.arayanAdi !== arama.arayanNumara && <span className="arama-muted"> ({arama.arayanAdi})</span>}
                        </td>
                        <td>{arama.arananNumara}</td>
                        <td>
                          <span className={`arama-direction arama-direction-${arama.yonKod ?? "x"}`}>{arama.yon}</span>
                        </td>
                        <td className={arama.sureSaniye > 0 ? "arama-strong" : "arama-muted"}>{arama.sure}</td>
                        <td>
                          {arama.sesKaydi ? (
                            <div className="arama-player">
                              <button
                                type="button"
                                className={aktif ? "arama-play active" : "arama-play"}
                                title={aktif ? t("pause") : t("play")}
                                aria-label={aktif ? t("pause") : t("play")}
                                onClick={() => sesOynat(anahtar, arama.sesKaydi!)}
                              >
                                {aktif ? <Pause size={14} /> : <Play size={14} />}
                              </button>
                              <button type="button" className="arama-skip" title={t("skipForward")} aria-label={t("skipForward")} disabled={!aktif} onClick={ileriSar}>
                                <SkipForward size={12} />
                              </button>
                              {aktif && kalanSure[anahtar] !== undefined && (
                                <span className="arama-remaining">
                                  {Math.floor(kalanSure[anahtar]! / 60)}:{String(kalanSure[anahtar]! % 60).padStart(2, "0")}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="arama-muted">{t("noRecording")}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="arama-page-size">
            <select aria-label={t("rowsPerPage")} value={sayfaBoyutu} onChange={(e) => setSayfaBoyutu(Number(e.target.value))}>
              <option value={10}>{t("rowsOption", { count: 10 })}</option>
              <option value={25}>{t("rowsOption", { count: 25 })}</option>
              <option value={50}>{t("rowsOption", { count: 50 })}</option>
            </select>
          </div>
          {toplamSayfa > 1 && (
            <div className="arama-pagination">
              <span>{t("pageOf", { page: sayfa, total: toplamSayfa })}</span>
              <button type="button" disabled={sayfa <= 1} onClick={() => setSayfa(sayfa - 1)}>
                {t("previous")}
              </button>
              <button type="button" disabled={sayfa >= toplamSayfa} onClick={() => setSayfa(sayfa + 1)}>
                {t("next")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
