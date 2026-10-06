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
import { localeFor, useLanguage, useT, type UiLanguage } from "../i18n/index.js";
import { vapiCallsMessages } from "../i18n/messages/vapiCalls.js";

type VapiMessageKey = keyof (typeof vapiCallsMessages)["tr"];

/**
 * Legacy parity: garanti-kulucka/frontend/src/pages/sesli-asistan/VapiAramalarPage.jsx (+ components/vapi/TestAramaPaneli).
 * Queue, calls and statistics go through backend `/api/vapi/*`; VAPI is only reached by the worker
 * (`vapi.call.create` / `vapi.call.get`) behind `providers.vapi.live_mode`. The test panel keeps the
 * existing `/api/webphone/test-call` dry-run.
 */

type Bildirim = { tip: "success" | "error" | "warning"; mesaj: string };
type Bildir = (tip: Bildirim["tip"], mesaj: string) => void;

const DURUM_STIL: Record<string, { sinif: string; ikon: LucideIcon; etiket: VapiMessageKey }> = {
  basladi: { sinif: "vapi-badge-blue", ikon: Phone, etiket: "statusCalling" },
  cevaplandi: { sinif: "vapi-badge-green", ikon: CheckCircle, etiket: "statusAnswered" },
  cevapsiz: { sinif: "vapi-badge-amber", ikon: PhoneMissed, etiket: "statusMissed" },
  tamamlandi: { sinif: "vapi-badge-emerald", ikon: CheckCircle, etiket: "statusCompleted" },
  hata: { sinif: "vapi-badge-red", ikon: XCircle, etiket: "statusError" },
  iptal: { sinif: "vapi-badge-slate", ikon: XCircle, etiket: "statusCancelled" },
  bekliyor: { sinif: "vapi-badge-cyan", ikon: Clock, etiket: "statusWaiting" },
  araniyor: { sinif: "vapi-badge-blue", ikon: PhoneOutgoing, etiket: "statusDialing" },
  basarisiz: { sinif: "vapi-badge-red", ikon: XCircle, etiket: "statusFailed" },
};

function DurumBadge(props: { durum: string | null | undefined }) {
  const t = useT(vapiCallsMessages);
  const stil = DURUM_STIL[props.durum ?? ""] ?? DURUM_STIL.bekliyor!;
  const Ikon = stil.ikon;
  return (
    <span className={`vapi-badge ${stil.sinif}`}>
      <Ikon size={12} />
      {t(stil.etiket)}
    </span>
  );
}

function sureFormatla(sn: number | null | undefined) {
  if (!sn) return "—";
  const dk = Math.floor(sn / 60);
  const saniye = sn % 60;
  return `${dk}:${String(saniye).padStart(2, "0")}`;
}

function tarihFormatla(tarih: string | null | undefined, language: UiLanguage) {
  if (!tarih) return "—";
  return new Date(tarih).toLocaleString(localeFor(language), { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
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
  const t = useT(vapiCallsMessages);
  if (props.toplamSayfa <= 1) return null;
  return (
    <div className="vapi-pagination">
      <span>{t("pageOf", { page: props.sayfa, total: props.toplamSayfa })}</span>
      <button type="button" disabled={props.sayfa <= 1} onClick={() => props.sayfaDegistir(props.sayfa - 1)}>{t("previous")}</button>
      <button type="button" disabled={props.sayfa >= props.toplamSayfa} onClick={() => props.sayfaDegistir(props.sayfa + 1)}>{t("next")}</button>
    </div>
  );
}

type TabId = "kargo-almayan" | "kuyruk" | "gecmis" | "test";
const TABS: Array<{ id: TabId; etiket: VapiMessageKey; ikon: LucideIcon }> = [
  { id: "kargo-almayan", etiket: "tabCargoNotReceived", ikon: Package },
  { id: "kuyruk", etiket: "tabQueue", ikon: Clock },
  { id: "gecmis", etiket: "tabHistory", ikon: Phone },
  { id: "test", etiket: "tabTest", ikon: Stethoscope },
];

export function VapiAramalarPage(props: { http: BackendHttpClient }) {
  const client = useMemo(() => createVoiceClient(props.http), [props.http]);
  const t = useT(vapiCallsMessages);
  const [aktifTab, setAktifTab] = useState<TabId>("kargo-almayan");
  const [bildirim, setBildirim] = useState<Bildirim | null>(null);
  const bildir = useCallback<Bildir>((tip, mesaj) => setBildirim({ tip, mesaj }), []);

  return (
    <section className="vapi-page" data-testid="vapi-flow">
      <div className="vapi-header">
        <div>
          <h1>
            <span className="vapi-logo"><Bot size={20} /></span>
            {t("pageTitle")}
          </h1>
          <p className="vapi-muted">{t("pageSubtitle")}</p>
        </div>
        <IstatistikKartlari client={client} />
      </div>

      {bildirim && (
        <div className={`vapi-toast vapi-toast-${bildirim.tip}`} role="status" data-testid="vapi-toast">
          <span>{bildirim.mesaj}</span>
          <button type="button" className="vapi-icon-button" onClick={() => setBildirim(null)} aria-label={t("close")}>
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
            {t(etiket)}
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
  const t = useT(vapiCallsMessages);
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
    { etiket: t("statTotalCalls"), deger: String(data.toplam_arama) },
    { etiket: t("statSuccessRate"), deger: t("percentValue", { value: data.basari_orani }) },
    { etiket: t("statInQueue"), deger: String(data.kuyruk_bekleyen) },
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
  const t = useT(vapiCallsMessages);
  const { language } = useLanguage();
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
      bildir("error", hataMesaji(error, t("loadError")));
    }
    setYukleniyor(false);
  }, [client, bildir, kargoFirmasi, sayfa, t]);

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
      bildir("warning", t("selectAtLeastOneCargo"));
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
      bildir("success", r.atlanan ? t("addedToQueueSkipped", { added: r.eklenen, skipped: r.atlanan }) : t("addedToQueue", { added: r.eklenen }));
      setSeciliIds(new Set());
      void yukle();
    } catch (error) {
      bildir("error", hataMesaji(error, t("addError")));
    }
    setKuyrugaEkleniyor(false);
  };

  return (
    <div className="vapi-tab">
      <div className="vapi-toolbar">
        <select
          aria-label={t("cargoProvider")}
          value={kargoFirmasi}
          onChange={(e) => {
            setKargoFirmasi(e.target.value);
            setSayfa(1);
          }}
        >
          <option value="tumu">{t("allCargo")}</option>
          <option value="ptt">{t("pttCargo")}</option>
          <option value="surat">{t("suratCargo")}</option>
        </select>
        <button type="button" className="vapi-secondary" onClick={() => void yukle()} disabled={yukleniyor}>
          <RefreshCw size={16} className={yukleniyor ? "vapi-spin" : undefined} />
          {t("refresh")}
        </button>
        <div className="vapi-spacer" />
        {seciliIds.size > 0 && (
          <button type="button" className="vapi-primary" onClick={() => void kuyrugaEkle()} disabled={kuyrugaEkleniyor}>
            {kuyrugaEkleniyor ? <Loader2 size={16} className="vapi-spin" /> : <Plus size={16} />}
            {t("addPeopleToQueue", { count: seciliIds.size })}
          </button>
        )}
        <span className="vapi-muted">{t("cargoNotReceivedCount", { count: toplam })}</span>
      </div>

      <div className="vapi-table-wrap">
        <table className="vapi-table" data-testid="vapi-cargo-table">
          <thead>
            <tr>
              <th>
                <input type="checkbox" aria-label={t("selectAll")} checked={data.length > 0 && seciliIds.size === data.length} onChange={tumunuSec} />
              </th>
              <th>{t("colCustomer")}</th>
              <th>{t("colCargo")}</th>
              <th>{t("colLastEvent")}</th>
              <th>{t("colStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {yukleniyor ? (
              <tr>
                <td colSpan={5} className="vapi-empty">
                  <Loader2 size={24} className="vapi-spin" />
                  <p>{t("loading")}</p>
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={5} className="vapi-empty">
                  <Package size={32} />
                  <p>{t("noCargoNotReceived")}</p>
                </td>
              </tr>
            ) : (
              data.map((k) => (
                <tr key={k.id} className={seciliIds.has(k.id) ? "selected" : undefined}>
                  <td>
                    <input type="checkbox" aria-label={t("selectRow", { name: k.alici_ad })} checked={seciliIds.has(k.id)} onChange={() => tekSec(k.id)} />
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
                    <p className="vapi-sub">{tarihFormatla(k.son_hareket_tarihi, language)}</p>
                  </td>
                  <td>
                    {k.kuyrukta ? (
                      <DurumBadge durum={k.kuyruk_durumu} />
                    ) : k.son_24s_arandi ? (
                      <span className="vapi-sub">{t("calledLast24h")}</span>
                    ) : (
                      <span className="vapi-sub">{t("notCalled")}</span>
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
  const t = useT(vapiCallsMessages);
  const { language } = useLanguage();
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
      bildir("error", t("connectionError"));
    }
    setYukleniyor(false);
  }, [client, bildir, durumFiltre, sayfa, t]);

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
      bildir("success", t("callingCustomer", { name: item.musteri_adi || item.musteri_telefon }));
      void yukle();
    } catch (error) {
      bildir("error", hataMesaji(error, t("callStartFailed")));
    }
  };

  const kuyrukSil = async (id: string) => {
    try {
      await client.deleteQueueItem(id);
      bildir("success", t("removedFromQueue"));
      void yukle();
    } catch {
      bildir("error", t("deleteError"));
    }
  };

  const topluAramaBaslat = async () => {
    setTopluAramaYukleniyor(true);
    try {
      const r = await client.startBulkCalls(anahtar("vapi_bulk"));
      bildir("success", r.hatali ? t("bulkCalledWithErrors", { called: r.aranan, failed: r.hatali }) : t("bulkCalled", { called: r.aranan }));
      void yukle();
    } catch (error) {
      bildir("error", hataMesaji(error, t("bulkCallStartFailed")));
    }
    setTopluAramaYukleniyor(false);
  };

  const bekleyenSayisi = data.filter((d) => d.durum === "bekliyor").length;

  return (
    <div className="vapi-tab">
      <div className="vapi-toolbar">
        <select
          aria-label={t("queueStatus")}
          value={durumFiltre}
          onChange={(e) => {
            setDurumFiltre(e.target.value);
            setSayfa(1);
          }}
        >
          <option value="tumu">{t("allStatuses")}</option>
          <option value="bekliyor">{t("statusWaiting")}</option>
          <option value="araniyor">{t("statusDialing")}</option>
          <option value="tamamlandi">{t("statusCompleted")}</option>
          <option value="basarisiz">{t("statusFailed")}</option>
        </select>
        <button type="button" className="vapi-secondary" onClick={() => void yukle()} disabled={yukleniyor}>
          <RefreshCw size={16} className={yukleniyor ? "vapi-spin" : undefined} />
          {t("refresh")}
        </button>
        <div className="vapi-spacer" />
        {bekleyenSayisi > 0 && (
          <button type="button" className="vapi-primary vapi-gradient" onClick={() => void topluAramaBaslat()} disabled={topluAramaYukleniyor}>
            {topluAramaYukleniyor ? <Loader2 size={16} className="vapi-spin" /> : <Play size={16} />}
            {t("startBulkCall", { count: bekleyenSayisi })}
          </button>
        )}
      </div>

      <div className="vapi-table-wrap">
        <table className="vapi-table" data-testid="vapi-queue-table">
          <thead>
            <tr>
              <th>{t("colCustomer")}</th>
              <th>{t("colCargo")}</th>
              <th>{t("colLastEvent")}</th>
              <th className="vapi-center">{t("colAttempt")}</th>
              <th>{t("colStatus")}</th>
              <th className="vapi-right">{t("colAction")}</th>
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
                  <p>{t("queueEmpty")}</p>
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
                    {item.son_arama_zamani && <p className="vapi-sub">{t("lastCall", { date: tarihFormatla(item.son_arama_zamani, language) })}</p>}
                  </td>
                  <td className="vapi-right">
                    <div className="vapi-actions">
                      {item.durum === "bekliyor" && (
                        <button type="button" className="vapi-icon-button vapi-call-button" title={t("callNow")} aria-label={t("callNow")} onClick={() => void tekAra(item)}>
                          <PhoneOutgoing size={16} />
                        </button>
                      )}
                      <button type="button" className="vapi-icon-button vapi-delete-button" title={t("removeFromQueue")} aria-label={t("removeFromQueue")} onClick={() => void kuyrukSil(item.id)}>
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
  const t = useT(vapiCallsMessages);
  const { language } = useLanguage();
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
      bildir("error", t("connectionError"));
    }
    setYukleniyor(false);
  }, [client, bildir, durumFiltre, sayfa, arama, t]);

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
          <input value={arama} onChange={(e) => setArama(e.target.value)} placeholder={t("historySearchPlaceholder")} aria-label={t("historySearchLabel")} />
        </div>
        <select
          aria-label={t("callStatus")}
          value={durumFiltre}
          onChange={(e) => {
            setDurumFiltre(e.target.value);
            setSayfa(1);
          }}
        >
          <option value="tumu">{t("allStatuses")}</option>
          <option value="tamamlandi">{t("statusCompleted")}</option>
          <option value="cevaplandi">{t("statusAnswered")}</option>
          <option value="cevapsiz">{t("statusMissed")}</option>
          <option value="hata">{t("statusError")}</option>
        </select>
        <button type="button" className="vapi-secondary" onClick={() => void yukle()} disabled={yukleniyor} aria-label={t("refresh")}>
          <RefreshCw size={16} className={yukleniyor ? "vapi-spin" : undefined} />
        </button>
        <div className="vapi-spacer" />
        <span className="vapi-muted">{t("callRecordCount", { count: toplam })}</span>
      </div>

      <div className="vapi-table-wrap">
        <table className="vapi-table" data-testid="vapi-calls-table">
          <thead>
            <tr>
              <th>{t("colDate")}</th>
              <th>{t("colCustomer")}</th>
              <th>{t("colCargo")}</th>
              <th className="vapi-center">{t("colDuration")}</th>
              <th>{t("colStatus")}</th>
              <th className="vapi-right">{t("colDetail")}</th>
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
                  <p>{t("noCallRecords")}</p>
                </td>
              </tr>
            ) : (
              data.map((item) => (
                <tr key={item.id} className="vapi-clickable" onClick={() => void detayAc(item)}>
                  <td>{tarihFormatla(item.baslangic, language)}</td>
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
                    <button type="button" className="vapi-icon-button" aria-label={t("colDetail")}>
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
  const t = useT(vapiCallsMessages);
  const { language } = useLanguage();
  return (
    <div className="vapi-modal-backdrop" onClick={onKapat}>
      <div className="vapi-modal" role="dialog" aria-label={t("callDetail")} data-testid="vapi-call-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="vapi-modal-header">
          <div className="vapi-modal-title">
            <span className="vapi-logo vapi-logo-sm"><Phone size={16} /></span>
            <div>
              <h2>{t("callDetail")}</h2>
              <p className="vapi-sub">{arama.vapi_call_id || arama.id}</p>
            </div>
          </div>
          <button type="button" className="vapi-icon-button" onClick={onKapat} aria-label={t("close")}>
            <X size={20} />
          </button>
        </div>
        <div className="vapi-modal-body">
          <div className="vapi-info-grid">
            <div className="vapi-info">
              <p className="vapi-sub">{t("colCustomer")}</p>
              <p className="vapi-strong">{arama.musteri_adi || "—"}</p>
              <p className="vapi-sub">{arama.musteri_telefon}</p>
            </div>
            <div className="vapi-info">
              <p className="vapi-sub">{t("colCargo")}</p>
              <p className="vapi-strong">{isPtt(arama.kargo_firmasi) ? t("pttCargo") : t("suratCargo")}</p>
              <p className="vapi-sub vapi-mono">{arama.takip_no || "—"}</p>
            </div>
            <div className="vapi-info">
              <p className="vapi-sub">{t("colStatus")}</p>
              <DurumBadge durum={arama.durum} />
            </div>
            <div className="vapi-info">
              <p className="vapi-sub">{t("colDuration")}</p>
              <p className="vapi-strong vapi-mono">{sureFormatla(arama.sure_sn)}</p>
              {arama.maliyet && <p className="vapi-sub">${Number.parseFloat(arama.maliyet).toFixed(4)}</p>}
            </div>
          </div>

          <div className="vapi-info">
            <p className="vapi-sub">{t("timeInfo")}</p>
            <div className="vapi-time-grid">
              <div>
                <span className="vapi-sub">{t("start")}</span> <span>{tarihFormatla(arama.baslangic, language)}</span>
              </div>
              <div>
                <span className="vapi-sub">{t("end")}</span> <span>{tarihFormatla(arama.bitis, language)}</span>
              </div>
            </div>
          </div>

          {arama.son_hareket && (
            <div className="vapi-info">
              <p className="vapi-sub">{t("cargoStatusAtCall")}</p>
              <p className="vapi-amber">{arama.son_hareket}</p>
            </div>
          )}

          {arama.arama_ozeti && (
            <div className="vapi-info vapi-info-violet">
              <p className="vapi-violet-label">
                <Bot size={14} /> {t("aiCallSummary")}
              </p>
              <p>{arama.arama_ozeti}</p>
            </div>
          )}

          {arama.transkript != null && arama.transkript !== "" && (
            <div className="vapi-info">
              <p className="vapi-sub">{t("transcript")}</p>
              <div className="vapi-transcript">
                {mesajlar ? (
                  mesajlar.map((msg, i) => {
                    const ai = msg.role === "assistant" || msg.speaker === "assistant";
                    const metin = msg.text ?? msg.content ?? msg.message ?? JSON.stringify(msg);
                    return (
                      <div key={i} className={`vapi-bubble ${ai ? "vapi-bubble-ai" : "vapi-bubble-customer"}`}>
                        <span>{ai ? "AI" : t("speakerCustomer")}</span>
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
  const t = useT(vapiCallsMessages);
  const [testTelefon, setTestTelefon] = useState("");
  const [testAd, setTestAd] = useState("");
  const [testAramaYukleniyor, setTestAramaYukleniyor] = useState(false);
  const [sonIstek, setSonIstek] = useState<string | null>(null);

  const testAramasiYap = async () => {
    if (!testTelefon) {
      props.bildir("warning", t("enterTestPhone"));
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
      props.bildir("success", t("testCallStarted"));
    } catch (error) {
      props.bildir("error", hataMesaji(error, t("testCallFailed")));
    }
    setTestAramaYukleniyor(false);
  };

  return (
    <div className="vapi-test-panel" data-testid="vapi-test-call-detail">
      <h3>
        <Phone size={16} />
        {t("quickTestCall")}
      </h3>
      <p className="vapi-sub">
        {t("quickTestCallDescription")}
      </p>
      <div className="vapi-test-grid">
        <label>
          <span>{t("testCustomerName")}</span>
          <input value={testAd} onChange={(e) => setTestAd(e.target.value)} placeholder={t("testCustomerNamePlaceholder")} />
        </label>
        <label>
          <span>{t("testPhone")}</span>
          <div className="vapi-test-row">
            <input type="tel" value={testTelefon} onChange={(e) => setTestTelefon(e.target.value)} placeholder={t("testPhonePlaceholder")} />
            <button type="button" className="vapi-call-now" onClick={() => void testAramasiYap()} disabled={testAramaYukleniyor}>
              {testAramaYukleniyor ? <Loader2 size={16} className="vapi-spin" /> : <Phone size={16} />}
              {t("call")}
            </button>
          </div>
        </label>
      </div>
      {sonIstek && (
        <p className="vapi-sub" data-testid="vapi-test-call-last">
          {sonIstek} · {t("liveCallDisabled")} (providers.vapi.live_mode)
        </p>
      )}
    </div>
  );
}
