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
import { localeFor, useLanguage, useT, type Translator, type UiLanguage } from "../i18n/index.js";
import { reportsMessages } from "../i18n/messages/reports.js";

type ReportsKey = keyof (typeof reportsMessages)["tr"];
type ReportsT = Translator<ReportsKey>;

/**
 * Legacy frontend/src/pages/raporlar/RaporlarPage.jsx ("İş Analizi") parity. Every KPI, rate and
 * chart series comes from the backend SQL aggregate `GET /api/reports/analysis`.
 */

const DURUM_ETIKETLERI = {
  olusturuldu: "statusCreated",
  teyit_bekliyor: "statusAwaitingConfirmation",
  teyit_edildi: "statusConfirmed",
  hazirlaniyor: "statusPreparing",
  kargoya_verildi: "statusHandedToCargo",
  sevk_edildi: "statusInTransit",
  teslim_edildi: "statusDelivered",
  iptal: "statusCancelled",
  iade: "statusReturned",
} as const satisfies Record<LegacyOrderStatusKey, ReportsKey>;

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
  { id: "7", gun: 7, label: "presetLast7" },
  { id: "30", gun: 30, label: "presetLast30" },
  { id: "90", gun: 90, label: "presetLast90" },
] as const satisfies readonly { id: string; gun: number; label: ReportsKey }[];

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

function tarihKisa(tarihStr: string, language: UiLanguage) {
  const [yil, ay, gun] = tarihStr.split("-").map(Number);
  if (!yil || !ay || !gun) return tarihStr;
  return new Date(yil, ay - 1, gun).toLocaleDateString(localeFor(language), { day: "numeric", month: "short" });
}

function paraFormatla(miktar: number, language: UiLanguage) {
  const formatli = new Intl.NumberFormat(localeFor(language), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(miktar);
  return `${formatli} ₺`;
}

function errorMessage(error: unknown, t: ReportsT) {
  if (error instanceof BackendRequestError) {
    const body = error.body as { error?: { message?: unknown } } | null | undefined;
    if (typeof body?.error?.message === "string" && body.error.message.length > 0) return body.error.message;
  }
  return error instanceof Error && error.message ? error.message : t("unknownError");
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
  const t = useT(reportsMessages);
  return <div className="rapor-veri-yok">{t("noData")}</div>;
}

export function RaporlarPage(props: { http: BackendHttpClient }) {
  const client = useMemo(() => createReportsClient(props.http), [props.http]);
  const t = useT(reportsMessages);
  const { language } = useLanguage();
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
      setHata(t("loadFailed", { error: errorMessage(error, t) }));
    } finally {
      setYukleniyor(false);
    }
  }, [client, tarihBaslangic, tarihBitis, kargoFirmasi, personelId, t]);

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
        label: tarihKisa(gun.date, language),
        siparis: gun.orders,
        ciro: gun.revenue,
        iptal: gun.cancelled,
        iade: gun.returned,
      })),
    [analiz, language],
  );

  const durumDagilimi = useMemo(
    () =>
      (analiz?.status_distribution ?? []).map((satir) => ({
        name: satir.status in DURUM_ETIKETLERI ? t(DURUM_ETIKETLERI[satir.status]) : satir.status,
        value: satir.count,
        fill: DURUM_RENKLERI[satir.status] ?? "#64748b",
      })),
    [analiz, t],
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
    { baslik: t("deliveryRate"), deger: oranlar.teslim, renk: "green", aciklama: t("deliveryRateFormula") },
    { baslik: t("cargoReturnRate"), deger: oranlar.kargo_iade, renk: "orange", aciklama: t("cargoReturnRateFormula") },
    { baslik: t("cancelRate"), deger: oranlar.iptal, renk: "red", aciklama: t("cancelRateFormula") },
    { baslik: t("returnRate"), deger: oranlar.iade, renk: "orange", aciklama: t("returnRateFormula") },
    { baslik: t("branchWaiting"), deger: oranlar.sube, renk: "amber", aciklama: t("branchWaitingFormula") },
  ];

  return (
    <div className="rapor-sayfa" data-testid="raporlar-page">
      <div className="rapor-baslik-satir">
        <div>
          <div className="rapor-baslik">
            <BarChart3 size={28} />
            <h1>{t("title")}</h1>
          </div>
          <p className="rapor-alt-baslik">{t("subtitle")}</p>
        </div>
        <button type="button" className="rapor-yenile" onClick={() => void verileriGetir()} disabled={yukleniyor}>
          {yukleniyor ? <Loader2 size={16} className="rapor-spin" /> : <RefreshCw size={16} />}
          {t("refresh")}
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
          {t("filters")}
        </div>
        <div className="rapor-presetler">
          {TARIH_PRESETLERI.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={aktifPreset === preset.id ? "aktif" : ""}
              onClick={() => presetSec(preset.gun, preset.id)}
            >
              {t(preset.label)}
            </button>
          ))}
        </div>
        <div className="rapor-filtre-grid">
          <label>
            <span>{t("startDate")}</span>
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
            <span>{t("endDate")}</span>
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
            <span>{t("personnel")}</span>
            <select value={personelId} onChange={(event) => setPersonelId(event.target.value)}>
              <option value="">{t("allPersonnel")}</option>
              {personeller.map((personel) => (
                <option key={personel.public_id} value={personel.public_id}>
                  {personel.first_name} {personel.last_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("cargoProvider")}</span>
            <select value={kargoFirmasi} onChange={(event) => setKargoFirmasi(event.target.value as ReportCargoProvider)}>
              <option value="tumu">{t("allProviders")}</option>
              <option value="ptt">PTT</option>
              <option value="surat">Sürat</option>
            </select>
          </label>
        </div>
      </div>

      <section>
        <h2 className="rapor-bolum-baslik">{t("orderSummary")}</h2>
        <div className="rapor-kpi-grid rapor-kpi-grid-5" data-testid="rapor-siparis-ozeti">
          <KpiKart baslik={t("totalOrders")} deger={metrikler.toplam} ikon={Package} renk="blue" yukleniyor={yukleniyor} />
          <KpiKart baslik={t("activeOrders")} deger={metrikler.aktif} ikon={TrendingUp} renk="emerald" yukleniyor={yukleniyor} />
          <KpiKart baslik={t("totalRevenue")} deger={paraFormatla(metrikler.ciro, language)} ikon={TrendingUp} renk="green" yukleniyor={yukleniyor} />
          <KpiKart baslik={t("statusCancelled")} deger={metrikler.iptal} alt={t("cancelRateSuffix", { rate: oranlar.iptal })} ikon={XCircle} renk="red" yukleniyor={yukleniyor} />
          <KpiKart baslik={t("statusReturned")} deger={metrikler.iade} alt={t("returnRateSuffix", { rate: oranlar.iade })} ikon={RotateCcw} renk="orange" yukleniyor={yukleniyor} />
        </div>
      </section>

      <section>
        <h2 className="rapor-bolum-baslik">{t("cargoStatus")}</h2>
        <div className="rapor-kpi-grid rapor-kpi-grid-6" data-testid="rapor-kargo-durumu">
          <KpiKart baslik={t("handedToCargo")} deger={metrikler.kargoya_giden} ikon={Truck} renk="indigo" yukleniyor={yukleniyor} />
          <KpiKart baslik={t("statusInTransit")} deger={metrikler.sevk_edildi} ikon={Truck} renk="emerald" yukleniyor={yukleniyor} />
          <KpiKart
            baslik={t("statusDelivered")}
            deger={metrikler.teslim_edildi}
            alt={t("deliveryRateSuffix", { rate: oranlar.teslim })}
            ikon={CheckCircle}
            renk="green"
            yukleniyor={yukleniyor}
          />
          <KpiKart
            baslik={t("cargoReturns")}
            deger={metrikler.kargo_iade}
            alt={t("cargoReturnsDetail", { ptt: metrikler.ptt_kargo_iade, surat: metrikler.surat_kargo_iade, rate: oranlar.kargo_iade })}
            ikon={RotateCcw}
            renk="orange"
            yukleniyor={yukleniyor}
          />
          <KpiKart
            baslik={t("waitingAtBranch")}
            deger={metrikler.subede_toplam}
            alt={t("branchDetail", { ptt: metrikler.ptt_subede, surat: metrikler.surat_subede })}
            ikon={Building2}
            renk="amber"
            yukleniyor={yukleniyor}
          />
          <KpiKart
            baslik={t("trackingReturns")}
            deger={metrikler.kargo_takip_iade}
            alt={t("trackingReturnsDetail")}
            ikon={RotateCcw}
            renk="red"
            yukleniyor={yukleniyor}
          />
          <KpiKart
            baslik={t("confirmationRate")}
            deger={`%${oranlar.teyit}`}
            alt={t("awaitingConfirmationCount", { count: metrikler.teyit_bekliyor })}
            ikon={Percent}
            renk="purple"
            yukleniyor={yukleniyor}
          />
        </div>
      </section>

      <div className="rapor-grafik-satir rapor-grafik-satir-3">
        <GrafikKart
          baslik={t("dailyOrderTrend")}
          alt={t("dailyOrderTrendDetail")}
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
                  <Tooltip contentStyle={tooltipStil} formatter={(value) => [value, t("seriesOrders")]} />
                  <Area type="monotone" dataKey="siparis" stroke="#3b82f6" strokeWidth={2} fill="url(#siparisGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </GrafikKart>

        <GrafikKart baslik={t("orderStatus")} alt={t("orderStatusDetail")} testId="rapor-durum-dagilimi">
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
        <GrafikKart baslik={t("dailyRevenue")} alt={t("dailyRevenueDetail")} testId="rapor-gunluk-ciro">
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
                  <Tooltip contentStyle={tooltipStil} formatter={(value) => [paraFormatla(Number(value), language), t("seriesRevenue")]} />
                  <Bar dataKey="ciro" fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </GrafikKart>

        <GrafikKart baslik={t("cargoProviderChart")} alt={t("cargoProviderChartDetail")} testId="rapor-kargo-firmasi">
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
                  <Bar dataKey="aktif" name={t("seriesActiveCargo")} fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="iade" name={t("cargoReturns")} fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </GrafikKart>
      </div>

      {personelDagilimi.length > 0 && (
        <GrafikKart
          baslik={t("personnelPerformance")}
          alt={t("personnelPerformanceDetail")}
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
                  <Bar dataKey="siparis" name={t("seriesOrders")} fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="iptal" name={t("statusCancelled")} fill="#ef4444" radius={[4, 4, 0, 0]} />
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
