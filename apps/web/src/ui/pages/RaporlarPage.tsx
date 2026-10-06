import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BarChart3,
  Building2,
  CheckCircle,
  Filter,
  Loader2,
  Package,
  Percent,
  RefreshCw,
  RotateCcw,
  TrendingUp,
  Truck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BackendRequestError, type BackendHttpClient } from "../../api/http-client.js";
import {
  createReportsClient,
  type LegacyOrderStatusKey,
  type ReportAnalysis,
  type ReportCargoProvider,
  type ReportMetrics,
} from "../../api/reports-client.js";

/**
 * Legacy frontend/src/pages/raporlar/RaporlarPage.jsx ("İş Analizi") parity. Every KPI, rate and
 * chart series comes from the backend SQL aggregate `GET /api/reports/analysis`.
 */

const DURUM_ETIKETLERI: Record<LegacyOrderStatusKey, string> = {
  olusturuldu: "Oluşturuldu",
  teyit_bekliyor: "Teyit Bekliyor",
  teyit_edildi: "Teyit Edildi",
  hazirlaniyor: "Hazırlanıyor",
  kargoya_verildi: "Kargoya Verildi",
  sevk_edildi: "Yoldaki Kargolar",
  teslim_edildi: "Teslim Edildi",
  iptal: "İptal",
  iade: "İade",
};

const DURUM_RENKLERI: Record<LegacyOrderStatusKey, string> = {
  olusturuldu: "#3b82f6",
  teyit_bekliyor: "#eab308",
  teyit_edildi: "#22c55e",
  hazirlaniyor: "#a855f7",
  kargoya_verildi: "#f97316",
  sevk_edildi: "#10b981",
  teslim_edildi: "#059669",
  iptal: "#ef4444",
  iade: "#f59e0b",
};

const TARIH_PRESETLERI = [
  { id: "7", gun: 7, label: "Son 7 gün" },
  { id: "30", gun: 30, label: "Son 30 gün" },
  { id: "90", gun: 90, label: "Son 90 gün" },
];

const tooltipStil = {
  backgroundColor: "#1e293b",
  borderRadius: "8px",
  border: "1px solid #334155",
  color: "#f1f5f9",
  fontSize: "12px",
};

function bosMetrikler(): ReportMetrics {
  return {
    toplam: 0,
    ciro: 0,
    aktif: 0,
    sevk_edildi: 0,
    teslim_edildi: 0,
    kargoya_giden: 0,
    iptal: 0,
    iade: 0,
    ptt: 0,
    surat: 0,
    ptt_subede: 0,
    surat_subede: 0,
    subede_toplam: 0,
    teyit_edildi: 0,
    teyit_bekliyor: 0,
    kargo_iade: 0,
    ptt_kargo_iade: 0,
    surat_kargo_iade: 0,
    kargo_takip_iade: 0,
  };
}

function yerelTarih(date: Date) {
  const yil = date.getFullYear();
  const ay = String(date.getMonth() + 1).padStart(2, "0");
  const gun = String(date.getDate()).padStart(2, "0");
  return `${yil}-${ay}-${gun}`;
}

function gunOnce(gun: number) {
  const date = new Date();
  date.setDate(date.getDate() - gun);
  return yerelTarih(date);
}

function tarihKisa(tarihStr: string) {
  const [yil, ay, gun] = tarihStr.split("-").map(Number);
  if (!yil || !ay || !gun) return tarihStr;
  return new Date(yil, ay - 1, gun).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}

function paraFormatla(miktar: number) {
  const formatli = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(miktar);
  return `${formatli} ₺`;
}

function errorMessage(error: unknown) {
  if (error instanceof BackendRequestError) {
    const body = error.body as { error?: { message?: unknown } } | null | undefined;
    if (typeof body?.error?.message === "string" && body.error.message.length > 0) return body.error.message;
  }
  return error instanceof Error && error.message ? error.message : "Bilinmeyen hata";
}

function KpiKart(props: {
  baslik: string;
  deger: ReactNode;
  alt?: string;
  ikon: LucideIcon;
  renk: string;
  yukleniyor: boolean;
}) {
  const Ikon = props.ikon;
  return (
    <div className="rapor-kpi" data-testid="rapor-kpi">
      <div className="rapor-kpi-icerik">
        <p className="rapor-kpi-baslik">{props.baslik}</p>
        <p className="rapor-kpi-deger">{props.yukleniyor ? "…" : props.deger}</p>
        {props.alt && <p className="rapor-kpi-alt">{props.alt}</p>}
      </div>
      <div className={`rapor-kpi-ikon rapor-ton-${props.renk}`}>
        <Ikon size={22} />
      </div>
    </div>
  );
}

function GrafikKart(props: { baslik: string; alt?: string; children: ReactNode; className?: string; testId?: string }) {
  return (
    <div className={`rapor-grafik ${props.className ?? ""}`} data-testid={props.testId}>
      <div className="rapor-grafik-baslik">
        <h2>{props.baslik}</h2>
        {props.alt && <p>{props.alt}</p>}
      </div>
      {props.children}
    </div>
  );
}

function VeriYok() {
  return <div className="rapor-veri-yok">Veri yok</div>;
}

export function RaporlarPage(props: { http: BackendHttpClient }) {
  const client = useMemo(() => createReportsClient(props.http), [props.http]);
  const bugun = yerelTarih(new Date());
  const [tarihBaslangic, setTarihBaslangic] = useState(gunOnce(29));
  const [tarihBitis, setTarihBitis] = useState(bugun);
  const [personelId, setPersonelId] = useState("");
  const [kargoFirmasi, setKargoFirmasi] = useState<ReportCargoProvider>("tumu");
  const [aktifPreset, setAktifPreset] = useState<string | null>("30");
  const [analiz, setAnaliz] = useState<ReportAnalysis | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);

  const verileriGetir = useCallback(async () => {
    try {
      setYukleniyor(true);
      setHata(null);
      const sonuc = await client.getAnalysis({
        startDate: tarihBaslangic,
        endDate: tarihBitis,
        cargoProvider: kargoFirmasi,
        ...(personelId ? { personnelPublicId: personelId } : {}),
      });
      setAnaliz(sonuc);
    } catch (error) {
      setHata(`Raporlar yüklenemedi: ${errorMessage(error)}`);
    } finally {
      setYukleniyor(false);
    }
  }, [client, tarihBaslangic, tarihBitis, kargoFirmasi, personelId]);

  useEffect(() => {
    void verileriGetir();
  }, [verileriGetir]);

  const metrikler = analiz?.metrics ?? bosMetrikler();
  const oranlar = analiz?.rates ?? { teslim: 0, iptal: 0, iade: 0, kargo_iade: 0, teyit: 0, sube: 0 };
  const personeller = analiz?.personnel_options ?? [];

  const gunlukVeri = useMemo(
    () =>
      (analiz?.daily ?? []).map((gun) => ({
        tarih: gun.date,
        label: tarihKisa(gun.date),
        siparis: gun.orders,
        ciro: gun.revenue,
        iptal: gun.cancelled,
        iade: gun.returned,
      })),
    [analiz],
  );

  const durumDagilimi = useMemo(
    () =>
      (analiz?.status_distribution ?? []).map((satir) => ({
        name: DURUM_ETIKETLERI[satir.status] ?? satir.status,
        value: satir.count,
        fill: DURUM_RENKLERI[satir.status] ?? "#64748b",
      })),
    [analiz],
  );

  const kargoFirmaVeri = useMemo(
    () => [
      { name: "PTT", aktif: metrikler.ptt, iade: metrikler.ptt_kargo_iade },
      { name: "Sürat", aktif: metrikler.surat, iade: metrikler.surat_kargo_iade },
    ],
    [metrikler.ptt, metrikler.surat, metrikler.ptt_kargo_iade, metrikler.surat_kargo_iade],
  );

  const personelDagilimi = useMemo(
    () =>
      (analiz?.personnel_performance ?? []).map((satir) => ({
        ad: satir.name,
        siparis: satir.orders,
        ciro: satir.revenue,
        iptal: satir.cancelled,
      })),
    [analiz],
  );

  const presetSec = (gun: number, id: string) => {
    setAktifPreset(id);
    setTarihBitis(yerelTarih(new Date()));
    setTarihBaslangic(gunOnce(gun - 1));
  };

  const oranOzeti = [
    { baslik: "Teslim Oranı", deger: oranlar.teslim, renk: "green", aciklama: "Teslim / (Sevk + Teslim)" },
    { baslik: "Kargo İade Oranı", deger: oranlar.kargo_iade, renk: "orange", aciklama: "Kargo iadesi / Kargoya verilenler" },
    { baslik: "İptal Oranı", deger: oranlar.iptal, renk: "red", aciklama: "İptal / Toplam" },
    { baslik: "İade Oranı", deger: oranlar.iade, renk: "orange", aciklama: "İade / Toplam" },
    { baslik: "Şubede Bekleme", deger: oranlar.sube, renk: "amber", aciklama: "Şubede / Kargolanan" },
  ];

  return (
    <div className="rapor-sayfa" data-testid="raporlar-page">
      <div className="rapor-baslik-satir">
        <div>
          <div className="rapor-baslik">
            <BarChart3 size={28} />
            <h1>İş Analizi</h1>
          </div>
          <p className="rapor-alt-baslik">Sipariş, kargo, fatura ve sonuçlanma metrikleri — filtreli görünüm</p>
        </div>
        <button type="button" className="rapor-yenile" onClick={() => void verileriGetir()} disabled={yukleniyor}>
          {yukleniyor ? <Loader2 size={16} className="rapor-spin" /> : <RefreshCw size={16} />}
          Yenile
        </button>
      </div>

      {hata && (
        <div className="rapor-hata" role="alert">
          {hata}
        </div>
      )}

      <div className="rapor-filtreler" data-testid="rapor-filtreler">
        <div className="rapor-filtre-baslik">
          <Filter size={16} />
          Filtreler
        </div>
        <div className="rapor-presetler">
          {TARIH_PRESETLERI.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={aktifPreset === preset.id ? "aktif" : ""}
              onClick={() => presetSec(preset.gun, preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="rapor-filtre-grid">
          <label>
            <span>Başlangıç</span>
            <input
              type="date"
              value={tarihBaslangic}
              onChange={(event) => {
                setTarihBaslangic(event.target.value);
                setAktifPreset(null);
              }}
            />
          </label>
          <label>
            <span>Bitiş</span>
            <input
              type="date"
              value={tarihBitis}
              onChange={(event) => {
                setTarihBitis(event.target.value);
                setAktifPreset(null);
              }}
            />
          </label>
          <label>
            <span>Personel</span>
            <select value={personelId} onChange={(event) => setPersonelId(event.target.value)}>
              <option value="">Tüm personel</option>
              {personeller.map((personel) => (
                <option key={personel.public_id} value={personel.public_id}>
                  {personel.first_name} {personel.last_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Kargo firması</span>
            <select value={kargoFirmasi} onChange={(event) => setKargoFirmasi(event.target.value as ReportCargoProvider)}>
              <option value="tumu">Tümü</option>
              <option value="ptt">PTT</option>
              <option value="surat">Sürat</option>
            </select>
          </label>
        </div>
      </div>

      <section>
        <h2 className="rapor-bolum-baslik">Sipariş Özeti</h2>
        <div className="rapor-kpi-grid rapor-kpi-grid-5" data-testid="rapor-siparis-ozeti">
          <KpiKart baslik="Toplam Sipariş" deger={metrikler.toplam} ikon={Package} renk="blue" yukleniyor={yukleniyor} />
          <KpiKart baslik="Aktif Sipariş" deger={metrikler.aktif} ikon={TrendingUp} renk="emerald" yukleniyor={yukleniyor} />
          <KpiKart baslik="Toplam Ciro" deger={paraFormatla(metrikler.ciro)} ikon={TrendingUp} renk="green" yukleniyor={yukleniyor} />
          <KpiKart baslik="İptal" deger={metrikler.iptal} alt={`%${oranlar.iptal} iptal oranı`} ikon={XCircle} renk="red" yukleniyor={yukleniyor} />
          <KpiKart baslik="İade" deger={metrikler.iade} alt={`%${oranlar.iade} iade oranı`} ikon={RotateCcw} renk="orange" yukleniyor={yukleniyor} />
        </div>
      </section>

      <section>
        <h2 className="rapor-bolum-baslik">Kargo Durumu</h2>
        <div className="rapor-kpi-grid rapor-kpi-grid-6" data-testid="rapor-kargo-durumu">
          <KpiKart baslik="Kargoya Verilenler" deger={metrikler.kargoya_giden} ikon={Truck} renk="indigo" yukleniyor={yukleniyor} />
          <KpiKart baslik="Yoldaki Kargolar" deger={metrikler.sevk_edildi} ikon={Truck} renk="emerald" yukleniyor={yukleniyor} />
          <KpiKart
            baslik="Teslim Edildi"
            deger={metrikler.teslim_edildi}
            alt={`%${oranlar.teslim} teslim oranı`}
            ikon={CheckCircle}
            renk="green"
            yukleniyor={yukleniyor}
          />
          <KpiKart
            baslik="Kargo İadesi"
            deger={metrikler.kargo_iade}
            alt={`PTT: ${metrikler.ptt_kargo_iade} · Sürat: ${metrikler.surat_kargo_iade} · %${oranlar.kargo_iade} iade oranı`}
            ikon={RotateCcw}
            renk="orange"
            yukleniyor={yukleniyor}
          />
          <KpiKart
            baslik="Şubede Bekleyen"
            deger={metrikler.subede_toplam}
            alt={`PTT: ${metrikler.ptt_subede} · Sürat: ${metrikler.surat_subede}`}
            ikon={Building2}
            renk="amber"
            yukleniyor={yukleniyor}
          />
          <KpiKart
            baslik="Takipte İade"
            deger={metrikler.kargo_takip_iade}
            alt="Kargo hareketinde iade görünen"
            ikon={RotateCcw}
            renk="red"
            yukleniyor={yukleniyor}
          />
          <KpiKart
            baslik="Teyit Oranı"
            deger={`%${oranlar.teyit}`}
            alt={`${metrikler.teyit_bekliyor} teyit bekliyor`}
            ikon={Percent}
            renk="purple"
            yukleniyor={yukleniyor}
          />
        </div>
      </section>

      <div className="rapor-grafik-satir rapor-grafik-satir-3">
        <GrafikKart
          baslik="Günlük Sipariş Trendi"
          alt="Seçilen tarih aralığında günlük sipariş sayısı"
          className="rapor-grafik-genis"
          testId="rapor-gunluk-trend"
        >
          <div className="rapor-grafik-alan">
            {gunlukVeri.length === 0 && !yukleniyor ? (
              <VeriYok />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={gunlukVeri} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="siparisGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} width={36} />
                  <Tooltip contentStyle={tooltipStil} formatter={(value) => [value, "Sipariş"]} />
                  <Area type="monotone" dataKey="siparis" stroke="#3b82f6" strokeWidth={2} fill="url(#siparisGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </GrafikKart>

        <GrafikKart baslik="Sipariş Durumu" alt="Durum dağılımı" testId="rapor-durum-dagilimi">
          <div className="rapor-grafik-alan">
            {durumDagilimi.length === 0 && !yukleniyor ? (
              <VeriYok />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={durumDagilimi} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value" nameKey="name">
                    {durumDagilimi.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStil} />
                  <Legend wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }} layout="horizontal" verticalAlign="bottom" />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </GrafikKart>
      </div>

      <div className="rapor-grafik-satir rapor-grafik-satir-2">
        <GrafikKart baslik="Günlük Ciro" alt="Aktif siparişlerin günlük toplam tutarı" testId="rapor-gunluk-ciro">
          <div className="rapor-grafik-alan rapor-grafik-alan-kisa">
            {gunlukVeri.length === 0 && !yukleniyor ? (
              <VeriYok />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={gunlukVeri} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#94a3b8", fontSize: 11 }}
                    width={48}
                    tickFormatter={(value: number) => (value >= 1000 ? `${(value / 1000).toFixed(0)}k` : String(value))}
                  />
                  <Tooltip contentStyle={tooltipStil} formatter={(value) => [paraFormatla(Number(value)), "Ciro"]} />
                  <Bar dataKey="ciro" fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </GrafikKart>

        <GrafikKart baslik="Kargo Firması" alt="Aktif kargolar ve kargo iadeleri (iptal/iade hariç aktif sayım)" testId="rapor-kargo-firmasi">
          <div className="rapor-grafik-alan rapor-grafik-alan-kisa">
            {kargoFirmaVeri.every((kargo) => kargo.aktif === 0 && kargo.iade === 0) && !yukleniyor ? (
              <VeriYok />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={kargoFirmaVeri} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} width={36} />
                  <Tooltip contentStyle={tooltipStil} />
                  <Legend wrapperStyle={{ fontSize: "12px", color: "#94a3b8" }} />
                  <Bar dataKey="aktif" name="Aktif Kargo" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="iade" name="Kargo İadesi" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </GrafikKart>
      </div>

      {personelDagilimi.length > 0 && (
        <GrafikKart
          baslik="Personel Performansı"
          alt="Seçilen tarih aralığında personel bazlı sipariş dağılımı"
          testId="rapor-personel-performansi"
        >
          <div className="rapor-personel-kaydir">
            <div style={{ minWidth: Math.max(320, personelDagilimi.length * 72) }}>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={personelDagilimi} margin={{ top: 10, right: 10, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                  <XAxis
                    dataKey="ad"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#94a3b8", fontSize: 11 }}
                    angle={-35}
                    textAnchor="end"
                    height={60}
                    interval={0}
                  />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 11 }} width={36} />
                  <Tooltip contentStyle={tooltipStil} />
                  <Legend wrapperStyle={{ fontSize: "12px", color: "#94a3b8" }} />
                  <Bar dataKey="siparis" name="Sipariş" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="iptal" name="İptal" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </GrafikKart>
      )}

      <div className="rapor-oran-grid" data-testid="rapor-oran-ozeti">
        {oranOzeti.map((oran) => (
          <div key={oran.baslik} className="rapor-oran">
            <p className="rapor-oran-baslik">{oran.baslik}</p>
            <p className={`rapor-oran-deger rapor-yazi-${oran.renk}`}>{yukleniyor ? "…" : `%${oran.deger}`}</p>
            <p className="rapor-oran-aciklama">{oran.aciklama}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
