import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BarChart3,
  Filter,
  Loader2,
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
  return (
    <section className="arama-page" data-testid="calls-flow">
      <div>
        <h1>Arama</h1>
        <p className="arama-muted">NetGSM otomatik teyit araması ve görüşme kayıtları</p>
      </div>
      <NetgsmAyarlar client={client} />
      <GorusmeDetay client={client} />
    </section>
  );
}

function NetgsmAyarlar(props: { client: VoiceClient }) {
  const { client } = props;
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
      setMesaj({ tip: "basari", metin: "Ayarlar kaydedildi." });
    } catch (error) {
      setMesaj({ tip: "hata", metin: "Kaydedilemedi: " + hataMesaji(error, "bilinmeyen hata") });
    } finally {
      setKaydediliyor(false);
    }
  };

  const set = (alan: keyof NetgsmTeyitSettings, deger: number | boolean) => setAyarlar((prev) => ({ ...prev, [alan]: deger }));

  if (yukleniyor) {
    return (
      <div className="arama-loading">
        <Loader2 size={16} className="arama-spin" />
        <span>Yükleniyor...</span>
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
          <h3>Otomatik Teyit Araması</h3>
          <p className="arama-muted">Yeni siparişler için otomatik IVR araması</p>
        </div>
      </div>

      <div className="arama-toggle-row">
        <div>
          <p className="arama-strong">Otomatik arama aktif</p>
          <p className="arama-muted">Yeni sipariş geldiğinde belirtilen süre sonra otomatik arar</p>
        </div>
        <button type="button" className="arama-toggle" aria-label="Otomatik arama aktif" aria-pressed={ayarlar.aktif} onClick={() => set("aktif", !ayarlar.aktif)}>
          {ayarlar.aktif ? <ToggleRight size={32} className="arama-green" /> : <ToggleLeft size={32} />}
        </button>
      </div>

      <div className="arama-number-grid">
        <label>
          <span>İlk arama (dakika sonra)</span>
          <input type="number" min={1} max={60} value={ayarlar.ilk_arama_dakika} onChange={(e) => set("ilk_arama_dakika", Math.max(1, Number.parseInt(e.target.value, 10) || 1))} />
          <small>Sipariş oluşturulduktan kaç dakika sonra aransın</small>
        </label>
        <label>
          <span>Maksimum deneme sayısı</span>
          <input type="number" min={1} max={10} value={ayarlar.max_deneme} onChange={(e) => set("max_deneme", Math.max(1, Number.parseInt(e.target.value, 10) || 1))} />
          <small>Ulaşılamazsa kaç kez tekrar denesin</small>
        </label>
        <label>
          <span>Denemeler arası (dakika)</span>
          <input type="number" min={1} max={120} value={ayarlar.deneme_arasi_dakika} onChange={(e) => set("deneme_arasi_dakika", Math.max(1, Number.parseInt(e.target.value, 10) || 1))} />
          <small>Ulaşılamazsa kaç dakika sonra tekrar denesin</small>
        </label>
      </div>

      {ayarlar.aktif && (
        <div className="arama-summary">
          Sipariş oluşturulduktan <strong>{ayarlar.ilk_arama_dakika} dakika</strong> sonra aranacak. Ulaşılamazsa{" "}
          <strong>{ayarlar.deneme_arasi_dakika} dakika</strong> arayla en fazla <strong>{ayarlar.max_deneme} kez</strong> tekrar denenecek.
        </div>
      )}

      {mesaj && <div className={`arama-message ${mesaj.tip === "basari" ? "arama-message-ok" : "arama-message-error"}`}>{mesaj.metin}</div>}

      <button type="button" className="arama-save" onClick={() => void handleKaydet()} disabled={kaydediliyor}>
        {kaydediliyor ? <Loader2 size={16} className="arama-spin" /> : <Save size={16} />}
        Kaydet
      </button>
    </div>
  );
}

type GorusmeTab = "gelen" | "giden" | "istatistik";

function GorusmeDetay(props: { client: VoiceClient }) {
  const { client } = props;
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
        setHata("Ses kaydı oynatılamadı");
        setOynatilan(null);
      });
      audio.play().catch(() => {
        setHata("Ses kaydı oynatılamadı");
        setOynatilan(null);
      });
    },
    [oynatilan],
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
          setHata(data.error || "API hatası");
          setAramalar([]);
          setToplamKayit(0);
          return;
        }
        setAramalar(data.data?.kayitlar ?? []);
        setToplamKayit(data.data?.toplamKayit ?? 0);
        setToplamSure(data.data?.toplamSure ?? "00:00:00");
      } catch (error) {
        setHata(hataMesaji(error, "Veriler yüklenirken bir hata oluştu"));
        setAramalar([]);
        setToplamKayit(0);
      } finally {
        setYukleniyor(false);
      }
    },
    [client, yapilandirilmis, aktifTab, sayfa, sayfaBoyutu, filtreler.baslangicTarih, filtreler.bitisTarih],
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
        <h2>Net GSM Yapılandırılmamış</h2>
        <p>Görüşme detaylarını görebilmek için Net GSM API bilgilerinin sunucu ortam değişkenlerinde tanımlanması gerekiyor.</p>
        <div className="arama-code">
          NETGSM_USERCODE=...
          <br />
          NETGSM_PASSWORD=...
        </div>
      </div>
    );
  }

  const tabs: Array<{ id: GorusmeTab; label: string; icon: typeof Phone }> = [
    { id: "gelen", label: "Gelen Arama", icon: PhoneIncoming },
    { id: "giden", label: "Giden Arama", icon: PhoneOutgoing },
    { id: "istatistik", label: "İstatistik", icon: BarChart3 },
  ];
  const toplamSayfa = toplamKayit > 0 ? Math.ceil(toplamKayit / sayfaBoyutu) : sayfa;

  return (
    <div className="arama-gorusme" data-testid="netgsm-gorusme">
      <div className="arama-gorusme-head">
        <h2>Görüşme Kayıtları</h2>
        <p className="arama-muted">Net GSM sabit telefon arama kayıtları</p>
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
            Filtrele
          </button>
          <button type="button" className="arama-filter-button" onClick={() => void verileriYukle(true)} disabled={yukleniyor}>
            <RefreshCw size={16} className={yukleniyor ? "arama-spin" : undefined} />
            Yenile
          </button>
        </div>
        <div className="arama-totals">
          <span>
            Kayıt Sayısı: <strong>{toplamKayit}</strong>
          </span>
          <span>
            Toplam Süre: <strong>{toplamSure}</strong>
          </span>
        </div>
      </div>

      {filtreAcik && (
        <div className="arama-filter-panel">
          <label>
            <span>Başlangıç Tarihi</span>
            <input type="date" value={filtreler.baslangicTarih} onChange={(e) => setFiltreler({ ...filtreler, baslangicTarih: e.target.value })} />
          </label>
          <label>
            <span>Bitiş Tarihi</span>
            <input type="date" value={filtreler.bitisTarih} onChange={(e) => setFiltreler({ ...filtreler, bitisTarih: e.target.value })} />
          </label>
          <label>
            <span>Numara Ara</span>
            <div className="arama-search">
              <Search size={16} />
              <input type="text" placeholder="Numara ara..." value={filtreler.arama} onChange={(e) => setFiltreler({ ...filtreler, arama: e.target.value })} />
            </div>
          </label>
          <div className="arama-filter-submit">
            <button type="button" onClick={() => void verileriYukle(true)}>
              Filtrele
            </button>
          </div>
        </div>
      )}

      {hata && (
        <div className="arama-error">
          <AlertCircle size={20} />
          <div>
            <h3>API Hatası</h3>
            <p>{hata}</p>
          </div>
        </div>
      )}

      {aktifTab === "istatistik" ? (
        yukleniyor ? (
          <div className="arama-loading arama-loading-center">
            <Loader2 size={32} className="arama-spin" />
            <span>İstatistikler yükleniyor...</span>
          </div>
        ) : (
          <div className="arama-stats" data-testid="netgsm-cdr-stats">
            <div className="arama-stat-grid">
              <div className="arama-stat">
                <PhoneIncoming size={24} className="arama-green" />
                <div>
                  <p className="arama-muted">Gelen Aramalar</p>
                  <strong>{istatistikler?.gelenArama || 0}</strong>
                  <small>
                    Cevaplı: {istatistikler?.gelenCevapli || 0} | Cevapsız: {istatistikler?.gelenCevapsiz || 0}
                  </small>
                </div>
              </div>
              <div className="arama-stat">
                <PhoneOutgoing size={24} className="arama-blue" />
                <div>
                  <p className="arama-muted">Giden Aramalar</p>
                  <strong>{istatistikler?.gidenArama || 0}</strong>
                  <small>Toplam giden arama sayısı</small>
                </div>
              </div>
              <div className="arama-stat">
                <Phone size={24} className="arama-purple" />
                <div>
                  <p className="arama-muted">Toplam Süre</p>
                  <strong>{istatistikler?.toplamSure || "00:00:00"}</strong>
                  <small>Ortalama: {istatistikler?.ortalamaSure || "00:00:00"}</small>
                </div>
              </div>
              <div className="arama-stat">
                <BarChart3 size={24} className="arama-orange" />
                <div>
                  <p className="arama-muted">Cevaplanan Oran</p>
                  <strong>%{istatistikler?.cevaplananOran || 0}</strong>
                  <small>Gelen aramalardan</small>
                </div>
              </div>
            </div>
            <div className="arama-card">
              <h3>Özet</h3>
              <div className="arama-summary-grid">
                <div>
                  <p className="arama-muted">Toplam Görüşme</p>
                  <strong>{istatistikler?.toplamGorisme || 0}</strong>
                </div>
                <div>
                  <p className="arama-muted">Gelen (Cevaplı)</p>
                  <strong className="arama-green">{istatistikler?.gelenCevapli || 0}</strong>
                </div>
                <div>
                  <p className="arama-muted">Gelen (Cevapsız)</p>
                  <strong className="arama-red">{istatistikler?.gelenCevapsiz || 0}</strong>
                </div>
                <div>
                  <p className="arama-muted">Giden</p>
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
                    <input type="checkbox" aria-label="Tümünü seç" />
                  </th>
                  <th>Yön</th>
                  <th>Tarih</th>
                  <th>Arayan Numara</th>
                  <th>Aranan Numara</th>
                  <th>Durum</th>
                  <th>Süre</th>
                  <th>Ses Kaydı</th>
                </tr>
              </thead>
              <tbody>
                {yukleniyor ? (
                  <tr>
                    <td colSpan={8} className="arama-empty">
                      <Loader2 size={32} className="arama-spin" />
                      <span>Net GSM verileri yükleniyor...</span>
                    </td>
                  </tr>
                ) : aramalar.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="arama-empty">
                      {hata ? "API hatası nedeniyle veri yüklenemedi" : "Kayıt bulunamadı"}
                    </td>
                  </tr>
                ) : (
                  aramalar.map((arama, index) => {
                    const anahtar = arama.id || String(index);
                    const aktif = oynatilan === anahtar;
                    return (
                      <tr key={`${anahtar}_${index}`}>
                        <td>
                          <input type="checkbox" aria-label="Seç" />
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
                                title={aktif ? "Duraklat" : "Oynat"}
                                aria-label={aktif ? "Duraklat" : "Oynat"}
                                onClick={() => sesOynat(anahtar, arama.sesKaydi!)}
                              >
                                {aktif ? <Pause size={14} /> : <Play size={14} />}
                              </button>
                              <button type="button" className="arama-skip" title="10sn İleri" aria-label="10sn İleri" disabled={!aktif} onClick={ileriSar}>
                                <SkipForward size={12} />
                              </button>
                              {aktif && kalanSure[anahtar] !== undefined && (
                                <span className="arama-remaining">
                                  {Math.floor(kalanSure[anahtar]! / 60)}:{String(kalanSure[anahtar]! % 60).padStart(2, "0")}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="arama-muted">Kayıt Yok</span>
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
            <select aria-label="Satır sayısı" value={sayfaBoyutu} onChange={(e) => setSayfaBoyutu(Number(e.target.value))}>
              <option value={10}>10 Satır</option>
              <option value={25}>25 Satır</option>
              <option value={50}>50 Satır</option>
            </select>
          </div>
          {toplamSayfa > 1 && (
            <div className="arama-pagination">
              <span>
                Sayfa {sayfa} / {toplamSayfa}
              </span>
              <button type="button" disabled={sayfa <= 1} onClick={() => setSayfa(sayfa - 1)}>
                Önceki
              </button>
              <button type="button" disabled={sayfa >= toplamSayfa} onClick={() => setSayfa(sayfa + 1)}>
                Sonraki
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
