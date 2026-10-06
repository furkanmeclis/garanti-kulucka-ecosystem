import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle,
  Clock,
  Eye,
  Loader2,
  Package,
  Phone,
  PhoneMissed,
  PhoneOutgoing,
  Play,
  Plus,
  RefreshCw,
  Search,
  Stethoscope,
  Trash2,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { BackendRequestError, type BackendHttpClient } from "../../api/http-client.js";
import {
  createVoiceClient,
  type VapiCall,
  type VapiCargoNotReceived,
  type VapiQueueItem,
  type VapiStatistics,
  type VoiceClient,
} from "../../api/voice-client.js";
import { createWebphoneClient } from "../../api/webphone-client.js";

/**
 * Legacy parity: garanti-kulucka/frontend/src/pages/sesli-asistan/VapiAramalarPage.jsx (+ components/vapi/TestAramaPaneli).
 * Queue, calls and statistics go through backend `/api/vapi/*`; VAPI is only reached by the worker
 * (`vapi.call.create` / `vapi.call.get`) behind `providers.vapi.live_mode`. The test panel keeps the
 * existing `/api/webphone/test-call` dry-run.
 */

type Bildirim = { tip: "success" | "error" | "warning"; mesaj: string };
type Bildir = (tip: Bildirim["tip"], mesaj: string) => void;

const DURUM_STIL: Record<string, { sinif: string; ikon: LucideIcon; etiket: string }> = {
  basladi: { sinif: "vapi-badge-blue", ikon: Phone, etiket: "Arıyor" },
  cevaplandi: { sinif: "vapi-badge-green", ikon: CheckCircle, etiket: "Cevaplandı" },
  cevapsiz: { sinif: "vapi-badge-amber", ikon: PhoneMissed, etiket: "Cevapsız" },
  tamamlandi: { sinif: "vapi-badge-emerald", ikon: CheckCircle, etiket: "Tamamlandı" },
  hata: { sinif: "vapi-badge-red", ikon: XCircle, etiket: "Hata" },
  iptal: { sinif: "vapi-badge-slate", ikon: XCircle, etiket: "İptal" },
  bekliyor: { sinif: "vapi-badge-cyan", ikon: Clock, etiket: "Bekliyor" },
  araniyor: { sinif: "vapi-badge-blue", ikon: PhoneOutgoing, etiket: "Aranıyor" },
  basarisiz: { sinif: "vapi-badge-red", ikon: XCircle, etiket: "Başarısız" },
};

function DurumBadge(props: { durum: string | null | undefined }) {
  const stil = DURUM_STIL[props.durum ?? ""] ?? DURUM_STIL.bekliyor!;
  const Ikon = stil.ikon;
  return (
    <span className={`vapi-badge ${stil.sinif}`}>
      <Ikon size={12} />
      {stil.etiket}
    </span>
  );
}

function sureFormatla(sn: number | null | undefined) {
  if (!sn) return "—";
  const dk = Math.floor(sn / 60);
  const saniye = sn % 60;
  return `${dk}:${String(saniye).padStart(2, "0")}`;
}

function tarihFormatla(tarih: string | null | undefined) {
  if (!tarih) return "—";
  return new Date(tarih).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function hataMesaji(error: unknown, fallback: string) {
  if (error instanceof BackendRequestError) {
    const body = error.body as { error?: { message?: unknown } } | null | undefined;
    if (typeof body?.error?.message === "string" && body.error.message.length > 0) return body.error.message;
  }
  return fallback;
}

function anahtar(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isPtt(firma: string | null | undefined) {
  return (firma ?? "").toLowerCase() === "ptt";
}

function KargoEtiketi(props: { firma: string | null | undefined }) {
  return <span className={`vapi-cargo ${isPtt(props.firma) ? "vapi-cargo-ptt" : "vapi-cargo-surat"}`}>{isPtt(props.firma) ? "PTT" : "Sürat"}</span>;
}

function Pagination(props: { sayfa: number; toplamSayfa: number; sayfaDegistir: (sayfa: number) => void }) {
  if (props.toplamSayfa <= 1) return null;
  return (
    <div className="vapi-pagination">
      <span>Sayfa {props.sayfa} / {props.toplamSayfa}</span>
      <button type="button" disabled={props.sayfa <= 1} onClick={() => props.sayfaDegistir(props.sayfa - 1)}>Önceki</button>
      <button type="button" disabled={props.sayfa >= props.toplamSayfa} onClick={() => props.sayfaDegistir(props.sayfa + 1)}>Sonraki</button>
    </div>
  );
}

type TabId = "kargo-almayan" | "kuyruk" | "gecmis" | "test";
const TABS: Array<{ id: TabId; etiket: string; ikon: LucideIcon }> = [
  { id: "kargo-almayan", etiket: "Kargo Almayan", ikon: Package },
  { id: "kuyruk", etiket: "Arama Kuyruğu", ikon: Clock },
  { id: "gecmis", etiket: "Arama Geçmişi", ikon: Phone },
  { id: "test", etiket: "Test Araması", ikon: Stethoscope },
];

export function VapiAramalarPage(props: { http: BackendHttpClient }) {
  const client = useMemo(() => createVoiceClient(props.http), [props.http]);
  const [aktifTab, setAktifTab] = useState<TabId>("kargo-almayan");
  const [bildirim, setBildirim] = useState<Bildirim | null>(null);
  const bildir = useCallback<Bildir>((tip, mesaj) => setBildirim({ tip, mesaj }), []);

  return (
    <section className="vapi-page" data-testid="vapi-flow">
      <div className="vapi-header">
        <div>
          <h1>
            <span className="vapi-logo"><Bot size={20} /></span>
            VAPI AI Aramalar
          </h1>
          <p className="vapi-muted">Kargo almayan müşterilere otomatik AI sesli arama</p>
        </div>
        <IstatistikKartlari client={client} />
      </div>

      {bildirim && (
        <div className={`vapi-toast vapi-toast-${bildirim.tip}`} role="status" data-testid="vapi-toast">
          <span>{bildirim.mesaj}</span>
          <button type="button" className="vapi-icon-button" onClick={() => setBildirim(null)} aria-label="Kapat">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="vapi-tabs" role="tablist">
        {TABS.map(({ id, etiket, ikon: Ikon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={aktifTab === id}
            className={aktifTab === id ? "selected" : undefined}
            data-testid={`vapi-tab-${id}`}
            onClick={() => setAktifTab(id)}
          >
            <Ikon size={16} />
            {etiket}
          </button>
        ))}
      </div>

      {aktifTab === "kargo-almayan" && <KargoAlmayanTab client={client} bildir={bildir} />}
      {aktifTab === "kuyruk" && <AramaKuyrukTab client={client} bildir={bildir} />}
      {aktifTab === "gecmis" && <AramaGecmisiTab client={client} bildir={bildir} />}
      {aktifTab === "test" && (
        <div className="vapi-test-wrap">
          <TestAramaPaneli http={props.http} bildir={bildir} />
        </div>
      )}
    </section>
  );
}

function IstatistikKartlari(props: { client: VoiceClient }) {
  const [data, setData] = useState<VapiStatistics | null>(null);

  useEffect(() => {
    let iptal = false;
    props.client
      .getVapiStatistics()
      .then((r) => {
        if (!iptal) setData(r.statistics);
      })
      .catch(() => undefined);
    return () => {
      iptal = true;
    };
  }, [props.client]);

  if (!data) return null;
  const kartlar = [
    { etiket: "Toplam Arama", deger: String(data.toplam_arama) },
    { etiket: "Başarı Oranı", deger: `%${data.basari_orani}` },
    { etiket: "Kuyrukta", deger: String(data.kuyruk_bekleyen) },
  ];
  return (
    <div className="vapi-stats" data-testid="vapi-stats">
      {kartlar.map((k) => (
        <div key={k.etiket} className="vapi-stat">
          <strong>{k.deger}</strong>
          <span>{k.etiket}</span>
        </div>
      ))}
    </div>
  );
}

function KargoAlmayanTab(props: { client: VoiceClient; bildir: Bildir }) {
  const { client, bildir } = props;
  const [yukleniyor, setYukleniyor] = useState(false);
  const [data, setData] = useState<VapiCargoNotReceived[]>([]);
  const [toplam, setToplam] = useState(0);
  const [sayfa, setSayfa] = useState(1);
  const sayfaBoyutu = 25;
  const [kargoFirmasi, setKargoFirmasi] = useState("tumu");
  const [seciliIds, setSeciliIds] = useState<Set<string>>(new Set());
  const [kuyrugaEkleniyor, setKuyrugaEkleniyor] = useState(false);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try {
      const r = await client.listCargoNotReceived({ provider: kargoFirmasi, page: sayfa, pageSize: sayfaBoyutu });
      setData(r.data ?? []);
      setToplam(r.total ?? 0);
    } catch (error) {
      bildir("error", hataMesaji(error, "Yükleme hatası"));
    }
    setYukleniyor(false);
  }, [client, bildir, kargoFirmasi, sayfa]);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  const tumunuSec = () => {
    if (seciliIds.size === data.length) setSeciliIds(new Set());
    else setSeciliIds(new Set(data.map((k) => k.id)));
  };

  const tekSec = (id: string) => {
    const yeni = new Set(seciliIds);
    if (yeni.has(id)) yeni.delete(id);
    else yeni.add(id);
    setSeciliIds(yeni);
  };

  const kuyrugaEkle = async () => {
    const secilenKargolar = data.filter((k) => seciliIds.has(k.id));
    if (secilenKargolar.length === 0) {
      bildir("warning", "Lütfen en az bir kargo seçin");
      return;
    }
    setKuyrugaEkleniyor(true);
    try {
      const r = await client.addToQueue(
        secilenKargolar.map((k) => ({
          shipment_public_id: k.shipment_public_id,
          customer_phone: k.alici_telefon,
          customer_name: k.alici_ad,
          cargo_provider: k.kargo_firmasi,
          ...(k.takip_no ? { tracking_number: k.takip_no } : {}),
          last_event_text: k.son_hareket,
        })),
        anahtar("vapi_queue"),
      );
      bildir("success", `${r.eklenen} kişi arama kuyruğuna eklendi${r.atlanan ? `, ${r.atlanan} atlandı` : ""}`);
      setSeciliIds(new Set());
      void yukle();
    } catch (error) {
      bildir("error", hataMesaji(error, "Ekleme hatası"));
    }
    setKuyrugaEkleniyor(false);
  };

  return (
    <div className="vapi-tab">
      <div className="vapi-toolbar">
        <select
          aria-label="Kargo firması"
          value={kargoFirmasi}
          onChange={(e) => {
            setKargoFirmasi(e.target.value);
            setSayfa(1);
          }}
        >
          <option value="tumu">Tüm Kargolar</option>
          <option value="ptt">PTT Kargo</option>
          <option value="surat">Sürat Kargo</option>
        </select>
        <button type="button" className="vapi-secondary" onClick={() => void yukle()} disabled={yukleniyor}>
          <RefreshCw size={16} className={yukleniyor ? "vapi-spin" : undefined} />
          Yenile
        </button>
        <div className="vapi-spacer" />
        {seciliIds.size > 0 && (
          <button type="button" className="vapi-primary" onClick={() => void kuyrugaEkle()} disabled={kuyrugaEkleniyor}>
            {kuyrugaEkleniyor ? <Loader2 size={16} className="vapi-spin" /> : <Plus size={16} />}
            {seciliIds.size} Kişiyi Kuyruğa Ekle
          </button>
        )}
        <span className="vapi-muted">{toplam} kargo almayan müşteri</span>
      </div>

      <div className="vapi-table-wrap">
        <table className="vapi-table" data-testid="vapi-cargo-table">
          <thead>
            <tr>
              <th>
                <input type="checkbox" aria-label="Tümünü seç" checked={data.length > 0 && seciliIds.size === data.length} onChange={tumunuSec} />
              </th>
              <th>Müşteri</th>
              <th>Kargo</th>
              <th>Son Hareket</th>
              <th>Durum</th>
            </tr>
          </thead>
          <tbody>
            {yukleniyor ? (
              <tr>
                <td colSpan={5} className="vapi-empty">
                  <Loader2 size={24} className="vapi-spin" />
                  <p>Yükleniyor...</p>
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={5} className="vapi-empty">
                  <Package size={32} />
                  <p>Kargo almayan müşteri bulunamadı</p>
                </td>
              </tr>
            ) : (
              data.map((k) => (
                <tr key={k.id} className={seciliIds.has(k.id) ? "selected" : undefined}>
                  <td>
                    <input type="checkbox" aria-label={`${k.alici_ad} seç`} checked={seciliIds.has(k.id)} onChange={() => tekSec(k.id)} />
                  </td>
                  <td>
                    <p className="vapi-strong">{k.alici_ad || "—"}</p>
                    <p className="vapi-sub">{k.alici_telefon}</p>
                  </td>
                  <td>
                    <KargoEtiketi firma={k.kargo_firmasi} />
                    <p className="vapi-sub vapi-mono">{k.takip_no || "—"}</p>
                  </td>
                  <td>
                    <p className="vapi-truncate" title={k.son_hareket}>{k.son_hareket || "—"}</p>
                    <p className="vapi-sub">{tarihFormatla(k.son_hareket_tarihi)}</p>
                  </td>
                  <td>
                    {k.kuyrukta ? (
                      <DurumBadge durum={k.kuyruk_durumu} />
                    ) : k.son_24s_arandi ? (
                      <span className="vapi-sub">Son 24s arandı</span>
                    ) : (
                      <span className="vapi-sub">Aranmadı</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {toplam > sayfaBoyutu && <Pagination sayfa={sayfa} toplamSayfa={Math.ceil(toplam / sayfaBoyutu)} sayfaDegistir={setSayfa} />}
    </div>
  );
}

function AramaKuyrukTab(props: { client: VoiceClient; bildir: Bildir }) {
  const { client, bildir } = props;
  const [yukleniyor, setYukleniyor] = useState(false);
  const [data, setData] = useState<VapiQueueItem[]>([]);
  const [toplam, setToplam] = useState(0);
  const [sayfa, setSayfa] = useState(1);
  const [durumFiltre, setDurumFiltre] = useState("tumu");
  const [topluAramaYukleniyor, setTopluAramaYukleniyor] = useState(false);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try {
      const r = await client.listQueue({ status: durumFiltre, page: sayfa, pageSize: 25 });
      setData(r.data ?? []);
      setToplam(r.total ?? 0);
    } catch {
      bildir("error", "Bağlantı hatası");
    }
    setYukleniyor(false);
  }, [client, bildir, durumFiltre, sayfa]);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  const tekAra = async (item: VapiQueueItem) => {
    try {
      await client.startCall({
        queue_public_id: item.public_id,
        customer_phone: item.musteri_telefon,
        ...(item.musteri_adi ? { customer_name: item.musteri_adi } : {}),
        ...(item.kargo_firmasi ? { cargo_provider: item.kargo_firmasi } : {}),
        ...(item.takip_no ? { tracking_number: item.takip_no } : {}),
        ...(item.son_hareket ? { last_event_text: item.son_hareket } : {}),
        idempotency_key: `vapi_call_${item.public_id}_${item.deneme_sayisi + 1}`,
      });
      bildir("success", `${item.musteri_adi || item.musteri_telefon} aranıyor...`);
      void yukle();
    } catch (error) {
      bildir("error", hataMesaji(error, "Arama başlatılamadı"));
    }
  };

  const kuyrukSil = async (id: string) => {
    try {
      await client.deleteQueueItem(id);
      bildir("success", "Kuyruktan silindi");
      void yukle();
    } catch {
      bildir("error", "Silme hatası");
    }
  };

  const topluAramaBaslat = async () => {
    setTopluAramaYukleniyor(true);
    try {
      const r = await client.startBulkCalls(anahtar("vapi_bulk"));
      bildir("success", `${r.aranan} kişi arandı${r.hatali ? `, ${r.hatali} hata` : ""}`);
      void yukle();
    } catch (error) {
      bildir("error", hataMesaji(error, "Toplu arama başlatılamadı"));
    }
    setTopluAramaYukleniyor(false);
  };

  const bekleyenSayisi = data.filter((d) => d.durum === "bekliyor").length;

  return (
    <div className="vapi-tab">
      <div className="vapi-toolbar">
        <select
          aria-label="Kuyruk durumu"
          value={durumFiltre}
          onChange={(e) => {
            setDurumFiltre(e.target.value);
            setSayfa(1);
          }}
        >
          <option value="tumu">Tüm Durumlar</option>
          <option value="bekliyor">Bekliyor</option>
          <option value="araniyor">Aranıyor</option>
          <option value="tamamlandi">Tamamlandı</option>
          <option value="basarisiz">Başarısız</option>
        </select>
        <button type="button" className="vapi-secondary" onClick={() => void yukle()} disabled={yukleniyor}>
          <RefreshCw size={16} className={yukleniyor ? "vapi-spin" : undefined} />
          Yenile
        </button>
        <div className="vapi-spacer" />
        {bekleyenSayisi > 0 && (
          <button type="button" className="vapi-primary vapi-gradient" onClick={() => void topluAramaBaslat()} disabled={topluAramaYukleniyor}>
            {topluAramaYukleniyor ? <Loader2 size={16} className="vapi-spin" /> : <Play size={16} />}
            Toplu Arama Başlat ({bekleyenSayisi} kişi)
          </button>
        )}
      </div>

      <div className="vapi-table-wrap">
        <table className="vapi-table" data-testid="vapi-queue-table">
          <thead>
            <tr>
              <th>Müşteri</th>
              <th>Kargo</th>
              <th>Son Hareket</th>
              <th className="vapi-center">Deneme</th>
              <th>Durum</th>
              <th className="vapi-right">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {yukleniyor ? (
              <tr>
                <td colSpan={6} className="vapi-empty">
                  <Loader2 size={24} className="vapi-spin" />
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={6} className="vapi-empty">
                  <Clock size={32} />
                  <p>Kuyrukta arama yok</p>
                </td>
              </tr>
            ) : (
              data.map((item) => (
                <tr key={item.id}>
                  <td>
                    <p className="vapi-strong">{item.musteri_adi || "—"}</p>
                    <p className="vapi-sub">{item.musteri_telefon}</p>
                  </td>
                  <td>
                    <KargoEtiketi firma={item.kargo_firmasi} />
                    <p className="vapi-sub vapi-mono">{item.takip_no || "—"}</p>
                  </td>
                  <td>
                    <p className="vapi-truncate" title={item.son_hareket ?? undefined}>{item.son_hareket || "—"}</p>
                  </td>
                  <td className="vapi-center">
                    <span className="vapi-pill">{item.deneme_sayisi}/{item.max_deneme || 3}</span>
                  </td>
                  <td>
                    <DurumBadge durum={item.durum} />
                    {item.son_arama_zamani && <p className="vapi-sub">Son: {tarihFormatla(item.son_arama_zamani)}</p>}
                  </td>
                  <td className="vapi-right">
                    <div className="vapi-actions">
                      {item.durum === "bekliyor" && (
                        <button type="button" className="vapi-icon-button vapi-call-button" title="Şimdi Ara" aria-label="Şimdi Ara" onClick={() => void tekAra(item)}>
                          <PhoneOutgoing size={16} />
                        </button>
                      )}
                      <button type="button" className="vapi-icon-button vapi-delete-button" title="Kuyruktan Sil" aria-label="Kuyruktan Sil" onClick={() => void kuyrukSil(item.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {toplam > 25 && <Pagination sayfa={sayfa} toplamSayfa={Math.ceil(toplam / 25)} sayfaDegistir={setSayfa} />}
    </div>
  );
}

function AramaGecmisiTab(props: { client: VoiceClient; bildir: Bildir }) {
  const { client, bildir } = props;
  const [yukleniyor, setYukleniyor] = useState(false);
  const [data, setData] = useState<VapiCall[]>([]);
  const [toplam, setToplam] = useState(0);
  const [sayfa, setSayfa] = useState(1);
  const [durumFiltre, setDurumFiltre] = useState("tumu");
  const [arama, setArama] = useState("");
  const [secilenArama, setSecilenArama] = useState<VapiCall | null>(null);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try {
      const r = await client.listCalls({ status: durumFiltre, q: arama, page: sayfa, pageSize: 20 });
      setData(r.data ?? []);
      setToplam(r.total ?? 0);
    } catch {
      bildir("error", "Bağlantı hatası");
    }
    setYukleniyor(false);
  }, [client, bildir, durumFiltre, sayfa, arama]);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  const detayAc = async (item: VapiCall) => {
    setSecilenArama(item);
    try {
      const r = await client.getCall(item.id);
      setSecilenArama(r.call);
    } catch {
      /* liste kaydı gösterilmeye devam eder */
    }
  };

  return (
    <div className="vapi-tab">
      <div className="vapi-toolbar">
        <div className="vapi-search">
          <Search size={16} />
          <input value={arama} onChange={(e) => setArama(e.target.value)} placeholder="İsim, telefon, takip no..." aria-label="Arama geçmişinde ara" />
        </div>
        <select
          aria-label="Arama durumu"
          value={durumFiltre}
          onChange={(e) => {
            setDurumFiltre(e.target.value);
            setSayfa(1);
          }}
        >
          <option value="tumu">Tüm Durumlar</option>
          <option value="tamamlandi">Tamamlandı</option>
          <option value="cevaplandi">Cevaplandı</option>
          <option value="cevapsiz">Cevapsız</option>
          <option value="hata">Hata</option>
        </select>
        <button type="button" className="vapi-secondary" onClick={() => void yukle()} disabled={yukleniyor} aria-label="Yenile">
          <RefreshCw size={16} className={yukleniyor ? "vapi-spin" : undefined} />
        </button>
        <div className="vapi-spacer" />
        <span className="vapi-muted">{toplam} arama kaydı</span>
      </div>

      <div className="vapi-table-wrap">
        <table className="vapi-table" data-testid="vapi-calls-table">
          <thead>
            <tr>
              <th>Tarih</th>
              <th>Müşteri</th>
              <th>Kargo</th>
              <th className="vapi-center">Süre</th>
              <th>Durum</th>
              <th className="vapi-right">Detay</th>
            </tr>
          </thead>
          <tbody>
            {yukleniyor ? (
              <tr>
                <td colSpan={6} className="vapi-empty">
                  <Loader2 size={24} className="vapi-spin" />
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={6} className="vapi-empty">
                  <Phone size={32} />
                  <p>Henüz arama kaydı yok</p>
                </td>
              </tr>
            ) : (
              data.map((item) => (
                <tr key={item.id} className="vapi-clickable" onClick={() => void detayAc(item)}>
                  <td>{tarihFormatla(item.baslangic)}</td>
                  <td>
                    <p className="vapi-strong">{item.musteri_adi || "—"}</p>
                    <p className="vapi-sub">{item.musteri_telefon}</p>
                  </td>
                  <td>
                    <KargoEtiketi firma={item.kargo_firmasi} />
                    <p className="vapi-sub vapi-mono">{item.takip_no || "—"}</p>
                  </td>
                  <td className="vapi-center vapi-mono">{sureFormatla(item.sure_sn)}</td>
                  <td>
                    <DurumBadge durum={item.durum} />
                  </td>
                  <td className="vapi-right">
                    <button type="button" className="vapi-icon-button" aria-label="Detay">
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {toplam > 20 && <Pagination sayfa={sayfa} toplamSayfa={Math.ceil(toplam / 20)} sayfaDegistir={setSayfa} />}
      {secilenArama && <AramaDetayModal arama={secilenArama} onKapat={() => setSecilenArama(null)} />}
    </div>
  );
}

function transkriptMesajlari(transkript: unknown): Array<Record<string, unknown>> | null {
  return Array.isArray(transkript) ? (transkript as Array<Record<string, unknown>>) : null;
}

function AramaDetayModal(props: { arama: VapiCall; onKapat: () => void }) {
  const { arama, onKapat } = props;
  const mesajlar = transkriptMesajlari(arama.transkript);
  return (
    <div className="vapi-modal-backdrop" onClick={onKapat}>
      <div className="vapi-modal" role="dialog" aria-label="Arama Detayı" data-testid="vapi-call-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="vapi-modal-header">
          <div className="vapi-modal-title">
            <span className="vapi-logo vapi-logo-sm"><Phone size={16} /></span>
            <div>
              <h2>Arama Detayı</h2>
              <p className="vapi-sub">{arama.vapi_call_id || arama.id}</p>
            </div>
          </div>
          <button type="button" className="vapi-icon-button" onClick={onKapat} aria-label="Kapat">
            <X size={20} />
          </button>
        </div>
        <div className="vapi-modal-body">
          <div className="vapi-info-grid">
            <div className="vapi-info">
              <p className="vapi-sub">Müşteri</p>
              <p className="vapi-strong">{arama.musteri_adi || "—"}</p>
              <p className="vapi-sub">{arama.musteri_telefon}</p>
            </div>
            <div className="vapi-info">
              <p className="vapi-sub">Kargo</p>
              <p className="vapi-strong">{isPtt(arama.kargo_firmasi) ? "PTT Kargo" : "Sürat Kargo"}</p>
              <p className="vapi-sub vapi-mono">{arama.takip_no || "—"}</p>
            </div>
            <div className="vapi-info">
              <p className="vapi-sub">Durum</p>
              <DurumBadge durum={arama.durum} />
            </div>
            <div className="vapi-info">
              <p className="vapi-sub">Süre</p>
              <p className="vapi-strong vapi-mono">{sureFormatla(arama.sure_sn)}</p>
              {arama.maliyet && <p className="vapi-sub">${Number.parseFloat(arama.maliyet).toFixed(4)}</p>}
            </div>
          </div>

          <div className="vapi-info">
            <p className="vapi-sub">Zaman Bilgisi</p>
            <div className="vapi-time-grid">
              <div>
                <span className="vapi-sub">Başlangıç:</span> <span>{tarihFormatla(arama.baslangic)}</span>
              </div>
              <div>
                <span className="vapi-sub">Bitiş:</span> <span>{tarihFormatla(arama.bitis)}</span>
              </div>
            </div>
          </div>

          {arama.son_hareket && (
            <div className="vapi-info">
              <p className="vapi-sub">Arama Anındaki Kargo Durumu</p>
              <p className="vapi-amber">{arama.son_hareket}</p>
            </div>
          )}

          {arama.arama_ozeti && (
            <div className="vapi-info vapi-info-violet">
              <p className="vapi-violet-label">
                <Bot size={14} /> AI Arama Özeti
              </p>
              <p>{arama.arama_ozeti}</p>
            </div>
          )}

          {arama.transkript != null && arama.transkript !== "" && (
            <div className="vapi-info">
              <p className="vapi-sub">Konuşma Transkripti</p>
              <div className="vapi-transcript">
                {mesajlar ? (
                  mesajlar.map((msg, i) => {
                    const ai = msg.role === "assistant" || msg.speaker === "assistant";
                    const metin = msg.text ?? msg.content ?? msg.message ?? JSON.stringify(msg);
                    return (
                      <div key={i} className={`vapi-bubble ${ai ? "vapi-bubble-ai" : "vapi-bubble-customer"}`}>
                        <span>{ai ? "AI" : "Müşteri"}</span>
                        {String(metin)}
                      </div>
                    );
                  })
                ) : typeof arama.transkript === "string" ? (
                  <p className="vapi-pre">{arama.transkript}</p>
                ) : (
                  <pre className="vapi-pre">{JSON.stringify(arama.transkript, null, 2)}</pre>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TestAramaPaneli(props: { http: BackendHttpClient; bildir: Bildir }) {
  const webphone = useMemo(() => createWebphoneClient(props.http), [props.http]);
  const [testTelefon, setTestTelefon] = useState("");
  const [testAd, setTestAd] = useState("");
  const [testAramaYukleniyor, setTestAramaYukleniyor] = useState(false);
  const [sonIstek, setSonIstek] = useState<string | null>(null);

  const testAramasiYap = async () => {
    if (!testTelefon) {
      props.bildir("warning", "Lütfen test telefon numarasını girin");
      return;
    }
    setTestAramaYukleniyor(true);
    try {
      const attempt = await webphone.createTestCall({
        customer_name: testAd || "Test Müşteri",
        customer_phone: testTelefon,
        cargo_provider: "PTT",
        tracking_number: "279172790012",
        last_event_text: "şubede bekliyor",
        idempotency_key: `vapi_test_${testTelefon.trim().replace(/[^0-9a-zA-Z_-]+/g, "_")}`,
      });
      setSonIstek(`${attempt.operation} ${attempt.request_id}`);
      props.bildir("success", "Test araması başlatıldı!");
    } catch (error) {
      props.bildir("error", hataMesaji(error, "Arama başlatılamadı. Ayarları ve VAPI bakiyenizi kontrol edin."));
    }
    setTestAramaYukleniyor(false);
  };

  return (
    <div className="vapi-test-panel" data-testid="vapi-test-call-detail">
      <h3>
        <Phone size={16} />
        Hızlı Test Araması
      </h3>
      <p className="vapi-sub">
        Asistan sesini ve konuşma senaryosunu kendi numaranızda test edin. Arama anında PTT kargosu şubede bekleyen bir müşteri senaryosu taklit edilir.
      </p>
      <div className="vapi-test-grid">
        <label>
          <span>Müşteri Adı (Test İçin)</span>
          <input value={testAd} onChange={(e) => setTestAd(e.target.value)} placeholder="Örn: Ahmet Yılmaz" />
        </label>
        <label>
          <span>Telefon Numarası (Test İçin)</span>
          <div className="vapi-test-row">
            <input type="tel" value={testTelefon} onChange={(e) => setTestTelefon(e.target.value)} placeholder="Örn: 05051234567" />
            <button type="button" className="vapi-call-now" onClick={() => void testAramasiYap()} disabled={testAramaYukleniyor}>
              {testAramaYukleniyor ? <Loader2 size={16} className="vapi-spin" /> : <Phone size={16} />}
              Ara
            </button>
          </div>
        </label>
      </div>
      {sonIstek && (
        <p className="vapi-sub" data-testid="vapi-test-call-last">
          {sonIstek} · canlı çağrı kapalı (providers.vapi.live_mode)
        </p>
      )}
    </div>
  );
}
