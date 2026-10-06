import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle,
  Clock,
  DollarSign,
  Eye,
  FileText,
  Loader2,
  Package,
  Send,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { BackendRequestError, type BackendHttpClient } from "../../api/http-client.js";
import {
  createBalancesClient,
  type BalanceMovement,
  type BalancePaymentRequest,
  type LedgerBalanceSummary,
  type StaffBalance,
  type StaffOrder,
} from "../../api/balances-client.js";
import { localeFor, useLanguage, useT, type UiLanguage } from "../i18n/index.js";
import { balancesMessages } from "../i18n/messages/balances.js";

type BalancesKey = keyof (typeof balancesMessages)["tr"];

/** Legacy frontend/src/pages/bakiye/BakiyePage.jsx parity on backend-owned balance routes. */

const PAGE_SIZE = 50;

const HAREKET_CONFIG: Record<string, { label: BalancesKey; tone: string; icon: LucideIcon }> = {
  commission: { label: "movementCommission", tone: "emerald", icon: TrendingUp },
  cancellation: { label: "movementCancellation", tone: "red", icon: TrendingDown },
  return: { label: "movementReturn", tone: "orange", icon: TrendingDown },
  payment: { label: "movementPayment", tone: "blue", icon: DollarSign },
  adjustment: { label: "movementAdjustment", tone: "purple", icon: AlertCircle },
  rollback: { label: "movementRollback", tone: "cyan", icon: TrendingUp },
};

const ODEME_DURUM_CONFIG: Record<string, { label: BalancesKey; tone: string; icon: LucideIcon }> = {
  pending: { label: "paymentPending", tone: "yellow", icon: Clock },
  seen: { label: "paymentSeen", tone: "blue", icon: Eye },
  approved: { label: "paymentApproved", tone: "emerald", icon: CheckCircle },
  rejected: { label: "paymentRejected", tone: "red", icon: XCircle },
};

const SIPARIS_DURUM: Record<string, { label: BalancesKey; tone: string }> = {
  draft: { label: "orderCreated", tone: "blue" },
  pending: { label: "orderCreated", tone: "blue" },
  pending_confirmation: { label: "orderPendingConfirmation", tone: "yellow" },
  confirmed: { label: "orderConfirmed", tone: "green" },
  preparing: { label: "orderPreparing", tone: "purple" },
  shipped: { label: "orderShipped", tone: "indigo" },
  delivered: { label: "orderDelivered", tone: "emerald" },
  cancelled: { label: "orderCancelled", tone: "red" },
  returned: { label: "orderReturned", tone: "orange" },
};

function tarihFormatla(tarih: string | null | undefined, language: UiLanguage) {
  if (!tarih) return "-";
  return new Date(tarih).toLocaleDateString(localeFor(language), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function tl(value: number, language: UiLanguage) {
  return value.toLocaleString(localeFor(language));
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof BackendRequestError) {
    const body = error.body as { error?: { message?: unknown } } | null | undefined;
    if (typeof body?.error?.message === "string" && body.error.message.length > 0) return body.error.message;
  }
  return fallback;
}

function Pagination(props: { sayfa: number; toplamSayfa: number; sayfaDegistir: (sayfa: number) => void }) {
  const t = useT(balancesMessages);
  if (props.toplamSayfa <= 1) return null;
  return (
    <div className="bakiye-pagination">
      <button type="button" disabled={props.sayfa <= 1} onClick={() => props.sayfaDegistir(props.sayfa - 1)}>{t("previous")}</button>
      <span>{props.sayfa} / {props.toplamSayfa}</span>
      <button type="button" disabled={props.sayfa >= props.toplamSayfa} onClick={() => props.sayfaDegistir(props.sayfa + 1)}>{t("next")}</button>
    </div>
  );
}

export function BakiyePage(props: { http: BackendHttpClient; role: string | undefined }) {
  const isAdmin = props.role === "admin" || props.role === "owner";
  const client = useMemo(() => createBalancesClient(props.http), [props.http]);
  const t = useT(balancesMessages);
  const { language } = useLanguage();
  /** Latest translator for async callbacks, so a language switch does not re-create them (and refetch). */
  const tRef = useRef(t);
  tRef.current = t;

  const [hareketler, setHareketler] = useState<BalanceMovement[]>([]);
  const [odemeIstekleri, setOdemeIstekleri] = useState<BalancePaymentRequest[]>([]);
  const [personelBakiyeleri, setPersonelBakiyeleri] = useState<StaffBalance[]>([]);
  const [bakiyeOzeti, setBakiyeOzeti] = useState<LedgerBalanceSummary | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [odemeModalAcik, setOdemeModalAcik] = useState(false);
  const [odemeTutar, setOdemeTutar] = useState("");
  const [aktifTab, setAktifTab] = useState<"hareketler" | "odeme_istekleri">("hareketler");
  const [detayPersonel, setDetayPersonel] = useState<StaffBalance | null>(null);
  const [detaySiparisler, setDetaySiparisler] = useState<StaffOrder[]>([]);
  const [detayYukleniyor, setDetayYukleniyor] = useState(false);
  const [sifirlamaYapiliyor, setSifirlamaYapiliyor] = useState<string | null>(null);
  const [odemeIslemYapiliyor, setOdemeIslemYapiliyor] = useState<string | null>(null);
  const [odemeGonderiliyor, setOdemeGonderiliyor] = useState(false);
  const [bildirim, setBildirim] = useState<{ tip: "success" | "error" | "info"; mesaj: string } | null>(null);
  const [hareketSayfa, setHareketSayfa] = useState(1);
  const [odemeSayfa, setOdemeSayfa] = useState(1);

  const sifirlamaLock = useRef(false);
  const odemeIslemLock = useRef(false);
  const odemeGondermeLock = useRef(false);

  const bildir = useCallback((tip: "success" | "error" | "info", mesaj: string) => {
    setBildirim({ tip, mesaj });
  }, []);

  useEffect(() => {
    if (!bildirim) return undefined;
    const timer = window.setTimeout(() => setBildirim(null), 4000);
    return () => window.clearTimeout(timer);
  }, [bildirim]);

  const verileriGetir = useCallback(async () => {
    try {
      const [hareketRes, odemeRes, ozet, personel] = await Promise.all([
        client.listMovements({ limit: 500 }),
        client.listPaymentRequests({ limit: 200 }),
        client.getSummary(),
        isAdmin ? client.listStaff() : Promise.resolve({ data: [] as StaffBalance[] }),
      ]);
      setHareketler(hareketRes.data);
      setOdemeIstekleri(odemeRes.data);
      setBakiyeOzeti(ozet);
      setPersonelBakiyeleri(personel.data);
    } catch {
      bildir("error", tRef.current("loadError"));
    } finally {
      setYukleniyor(false);
    }
  }, [bildir, client, isAdmin]);

  useEffect(() => {
    void verileriGetir();
  }, [verileriGetir]);

  const guncelBakiye = bakiyeOzeti?.balance ?? 0;

  const istatistikler = useMemo(() => {
    const bekleyenOdeme = odemeIstekleri
      .filter((istek) => istek.status === "pending")
      .reduce((toplam, istek) => toplam + istek.amount, 0);
    return {
      toplamKomisyon: bakiyeOzeti?.total_commission ?? 0,
      toplamKesinti: bakiyeOzeti?.total_deduction ?? 0,
      toplamOdeme: bakiyeOzeti?.total_payment ?? 0,
      bekleyenOdeme: Math.round(bekleyenOdeme * 100) / 100,
    };
  }, [bakiyeOzeti, odemeIstekleri]);

  const bekleyenOdemeSayisi = useMemo(
    () => odemeIstekleri.filter((istek) => istek.status === "pending").length,
    [odemeIstekleri],
  );

  const kullanilabilirBakiye = useMemo(
    () => Math.max(0, Math.round((guncelBakiye - istatistikler.bekleyenOdeme) * 100) / 100),
    [guncelBakiye, istatistikler.bekleyenOdeme],
  );

  const hareketToplamSayfa = Math.max(1, Math.ceil(hareketler.length / PAGE_SIZE));
  const gorunenHareketler = useMemo(
    () => hareketler.slice((hareketSayfa - 1) * PAGE_SIZE, hareketSayfa * PAGE_SIZE),
    [hareketler, hareketSayfa],
  );
  const odemeToplamSayfa = Math.max(1, Math.ceil(odemeIstekleri.length / PAGE_SIZE));
  const gorunenOdemeIstekleri = useMemo(
    () => odemeIstekleri.slice((odemeSayfa - 1) * PAGE_SIZE, odemeSayfa * PAGE_SIZE),
    [odemeIstekleri, odemeSayfa],
  );

  useEffect(() => {
    if (hareketSayfa > hareketToplamSayfa) setHareketSayfa(1);
  }, [hareketSayfa, hareketToplamSayfa]);
  useEffect(() => {
    if (odemeSayfa > odemeToplamSayfa) setOdemeSayfa(1);
  }, [odemeSayfa, odemeToplamSayfa]);

  const bakiyeSifirla = useCallback(async (personel: StaffBalance) => {
    if (!isAdmin || sifirlamaLock.current) return;
    const personelAd = `${personel.first_name} ${personel.last_name}`;
    if (!window.confirm(tRef.current("confirmReset", { name: personelAd }))) return;
    sifirlamaLock.current = true;
    setSifirlamaYapiliyor(personel.user_public_id);
    try {
      const result = await client.resetStaffBalance(personel.user_public_id);
      bildir("success", tRef.current("resetDone", { name: personelAd, amount: result.previous_balance }));
      await verileriGetir();
    } catch (error) {
      bildir("info", errorMessage(error, tRef.current("operationFailed")));
    } finally {
      sifirlamaLock.current = false;
      setSifirlamaYapiliyor(null);
    }
  }, [bildir, client, isAdmin, verileriGetir]);

  const personelDetayAc = useCallback(async (personel: StaffBalance) => {
    setDetayPersonel(personel);
    setDetaySiparisler([]);
    setDetayYukleniyor(true);
    try {
      const result = await client.listStaffOrders(personel.user_public_id);
      setDetaySiparisler(result.data);
    } catch {
      bildir("error", tRef.current("ordersLoadError"));
    } finally {
      setDetayYukleniyor(false);
    }
  }, [bildir, client]);

  const odemeIstegiOlustur = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (odemeGondermeLock.current) return;
    const tutar = Number.parseFloat(odemeTutar);
    if (!tutar || tutar <= 0) {
      bildir("error", tRef.current("invalidAmount"));
      return;
    }
    odemeGondermeLock.current = true;
    setOdemeGonderiliyor(true);
    try {
      await client.createPaymentRequest({
        amount: tutar.toFixed(2),
        idempotency_key: `odeme_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      });
      bildir("success", tRef.current("paymentRequestSent"));
      setOdemeModalAcik(false);
      setOdemeTutar("");
      await verileriGetir();
    } catch (error) {
      bildir("error", errorMessage(error, tRef.current("paymentRequestError")));
    } finally {
      odemeGondermeLock.current = false;
      setOdemeGonderiliyor(false);
    }
  }, [bildir, client, odemeTutar, verileriGetir]);

  const odemeIstegiIsle = useCallback(async (istekId: string, karar: "approve" | "reject") => {
    if (odemeIslemLock.current) return;
    odemeIslemLock.current = true;
    setOdemeIslemYapiliyor(istekId);
    try {
      const result = await client.processPaymentRequest(istekId, karar);
      bildir("success", result.message);
    } catch (error) {
      bildir("info", errorMessage(error, tRef.current("operationFailed")));
    } finally {
      odemeIslemLock.current = false;
      setOdemeIslemYapiliyor(null);
      await verileriGetir();
    }
  }, [bildir, client, verileriGetir]);

  if (yukleniyor) {
    return (
      <section className="bakiye-page" data-testid="balances-flow" aria-busy="true">
        <div className="bakiye-loading"><Loader2 size={24} className="bakiye-spin" /></div>
      </section>
    );
  }

  return (
    <section className="bakiye-page" data-testid="balances-flow">
      {bildirim && (
        <div className={`bakiye-toast bakiye-toast-${bildirim.tip}`} role="status" data-testid="bakiye-toast">
          {bildirim.mesaj}
        </div>
      )}

      <div className="bakiye-header">
        <div>
          <h1><Wallet size={28} />{isAdmin ? t("adminTitle") : t("staffTitle")}</h1>
          <p className="bakiye-muted">
            {isAdmin
              ? t("adminSubtitle")
              : t("staffSubtitle")}
          </p>
        </div>
        {!isAdmin && (
          <button
            type="button"
            className="bakiye-primary"
            data-testid="bakiye-odeme-iste"
            disabled={kullanilabilirBakiye <= 0}
            onClick={() => setOdemeModalAcik(true)}
          >
            <Send size={16} />
            {t("requestPayment")}
          </button>
        )}
      </div>

      {!isAdmin ? (
        <div className="bakiye-stats" data-testid="bakiye-stats">
          <div className="bakiye-stat bakiye-stat-main">
            <p className="bakiye-stat-label">{t("currentBalance")}</p>
            <p className={`bakiye-stat-value-lg ${guncelBakiye >= 0 ? "bakiye-pos" : "bakiye-neg"}`}>
              {guncelBakiye >= 0 ? "+" : ""}₺{tl(guncelBakiye, language)}
            </p>
          </div>
          <div className="bakiye-stat">
            <p className="bakiye-stat-label"><ArrowUpRight size={16} className="bakiye-pos" />{t("totalCommission")}</p>
            <p className="bakiye-stat-value bakiye-pos">+₺{tl(istatistikler.toplamKomisyon, language)}</p>
          </div>
          <div className="bakiye-stat">
            <p className="bakiye-stat-label"><ArrowDownRight size={16} className="bakiye-neg" />{t("totalDeduction")}</p>
            <p className="bakiye-stat-value bakiye-neg">-₺{tl(istatistikler.toplamKesinti, language)}</p>
          </div>
          <div className="bakiye-stat">
            <p className="bakiye-stat-label"><DollarSign size={16} className="bakiye-blue" />{t("paid")}</p>
            <p className="bakiye-stat-value bakiye-blue">₺{tl(istatistikler.toplamOdeme, language)}</p>
          </div>
        </div>
      ) : (
        <div data-testid="bakiye-personel-bakiyeleri">
          <h2 className="bakiye-section-title"><Users size={20} />{t("staffBalances")}</h2>
          <div className="bakiye-staff-grid">
            {personelBakiyeleri.map((personel) => (
              <div key={personel.user_public_id} className="bakiye-staff-card" data-testid={`bakiye-personel-${personel.user_public_id}`}>
                <div className="bakiye-staff-head">
                  <span className={`bakiye-dot ${personel.is_online ? "online" : ""}`} />
                  <p className="bakiye-staff-name">{personel.first_name} {personel.last_name}</p>
                  {personel.pending_payment > 0 && <span className="bakiye-badge-pending">{t("pendingBadge")}</span>}
                </div>
                <p className={`bakiye-staff-balance ${personel.balance >= 0 ? "bakiye-pos" : "bakiye-neg"}`}>
                  {personel.balance >= 0 ? "+" : ""}₺{tl(personel.balance, language)}
                </p>
                <div className="bakiye-staff-actions">
                  <button type="button" className="bakiye-detail-button" onClick={() => void personelDetayAc(personel)}>
                    <FileText size={12} />
                    {t("detail")}
                  </button>
                  {personel.balance !== 0 && (
                    <button
                      type="button"
                      className="bakiye-reset-button"
                      disabled={sifirlamaYapiliyor !== null}
                      onClick={() => void bakiyeSifirla(personel)}
                    >
                      {sifirlamaYapiliyor === personel.user_public_id ? t("resetting") : t("resetBalance")}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {personelBakiyeleri.length === 0 && <p className="bakiye-muted">{t("noStaff")}</p>}
          </div>
        </div>
      )}

      <div className="bakiye-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={aktifTab === "hareketler"}
          className={aktifTab === "hareketler" ? "active" : ""}
          onClick={() => setAktifTab("hareketler")}
        >
          {t("tabMovements")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={aktifTab === "odeme_istekleri"}
          className={aktifTab === "odeme_istekleri" ? "active" : ""}
          onClick={() => setAktifTab("odeme_istekleri")}
        >
          {t("tabPaymentRequests")}
          {isAdmin && bekleyenOdemeSayisi > 0 && <span className="bakiye-tab-badge">{bekleyenOdemeSayisi}</span>}
        </button>
      </div>

      {aktifTab === "hareketler" && (
        <div className="bakiye-table-card" data-testid="bakiye-hareketler">
          {hareketler.length === 0 ? (
            <div className="bakiye-empty"><Wallet size={48} /><p>{t("noMovements")}</p></div>
          ) : (
            <>
              <div className="bakiye-table-scroll">
                <table className="bakiye-table">
                  <thead>
                    <tr>
                      <th>{t("columnType")}</th>
                      <th>{t("columnAmount")}</th>
                      <th>{t("columnOrder")}</th>
                      <th>{t("columnBalanceAfter")}</th>
                      <th>{t("columnDescription")}</th>
                      {isAdmin && <th>{t("columnStaff")}</th>}
                      <th>{t("columnDate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gorunenHareketler.map((hareket) => {
                      const conf = HAREKET_CONFIG[hareket.kind];
                      const Ikon = conf?.icon ?? AlertCircle;
                      return (
                        <tr key={hareket.public_id}>
                          <td>
                            <span className="bakiye-kind">
                              <span className={`bakiye-kind-icon tone-${conf?.tone ?? "slate"}`}><Ikon size={14} /></span>
                              {conf ? t(conf.label) : hareket.kind}
                            </span>
                          </td>
                          <td className={hareket.amount >= 0 ? "bakiye-pos bakiye-strong" : "bakiye-neg bakiye-strong"}>
                            {hareket.amount >= 0 ? "+" : ""}₺{tl(Math.abs(hareket.amount), language)}
                          </td>
                          <td>
                            {hareket.order_number ? (
                              <span className="bakiye-order">
                                <span>{hareket.customer_full_name ?? "-"}</span>
                                <small>{hareket.order_number}</small>
                              </span>
                            ) : (
                              <span className="bakiye-muted">-</span>
                            )}
                          </td>
                          <td>₺{tl(hareket.balance_after, language)}</td>
                          <td className="bakiye-desc">{hareket.description || "-"}</td>
                          {isAdmin && <td>{hareket.user_full_name || "-"}</td>}
                          <td className="bakiye-date">{tarihFormatla(hareket.created_at, language)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination sayfa={hareketSayfa} toplamSayfa={hareketToplamSayfa} sayfaDegistir={setHareketSayfa} />
            </>
          )}
        </div>
      )}

      {aktifTab === "odeme_istekleri" && (
        <div className="bakiye-table-card" data-testid="bakiye-odeme-istekleri">
          {odemeIstekleri.length === 0 ? (
            <div className="bakiye-empty"><Send size={48} /><p>{t("noPaymentRequests")}</p></div>
          ) : (
            <>
              <div className="bakiye-table-scroll">
                <table className="bakiye-table">
                  <thead>
                    <tr>
                      {isAdmin && <th>{t("columnStaff")}</th>}
                      <th>{t("columnAmount")}</th>
                      <th>{t("columnStatus")}</th>
                      <th>{t("columnDate")}</th>
                      {isAdmin && <th>{t("columnAction")}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {gorunenOdemeIstekleri.map((istek) => {
                      const durum = ODEME_DURUM_CONFIG[istek.status];
                      const DurumIkon = durum?.icon ?? Clock;
                      const buIslemde = odemeIslemYapiliyor === istek.public_id;
                      return (
                        <tr key={istek.public_id} data-testid={`bakiye-istek-${istek.public_id}`}>
                          {isAdmin && <td>{istek.user_full_name ?? "-"}</td>}
                          <td className="bakiye-primary-text bakiye-strong">₺{tl(istek.amount, language)}</td>
                          <td>
                            <span className={`bakiye-status tone-${durum?.tone ?? "slate"}`}>
                              <DurumIkon size={12} />
                              {durum ? t(durum.label) : istek.status}
                            </span>
                          </td>
                          <td className="bakiye-date">{tarihFormatla(istek.created_at, language)}</td>
                          {isAdmin && (
                            <td>
                              {istek.status === "pending" && (
                                <div className="bakiye-row-actions">
                                  <button
                                    type="button"
                                    className="bakiye-approve"
                                    disabled={odemeIslemYapiliyor !== null}
                                    onClick={() => void odemeIstegiIsle(istek.public_id, "approve")}
                                  >
                                    {buIslemde ? <Loader2 size={12} className="bakiye-spin" /> : t("approve")}
                                  </button>
                                  <button
                                    type="button"
                                    className="bakiye-reject"
                                    disabled={odemeIslemYapiliyor !== null}
                                    onClick={() => void odemeIstegiIsle(istek.public_id, "reject")}
                                  >
                                    {t("reject")}
                                  </button>
                                </div>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination sayfa={odemeSayfa} toplamSayfa={odemeToplamSayfa} sayfaDegistir={setOdemeSayfa} />
            </>
          )}
        </div>
      )}

      {detayPersonel && (
        <div className="bakiye-overlay" role="dialog" aria-modal="true" data-testid="bakiye-detay-modal">
          <div className="bakiye-modal bakiye-modal-wide">
            <div className="bakiye-modal-head">
              <div>
                <h2><Package size={20} />{t("staffOrdersTitle", { name: `${detayPersonel.first_name} ${detayPersonel.last_name}` })}</h2>
                <p className="bakiye-muted">
                  {t("balanceLabel")}<span className={detayPersonel.balance >= 0 ? "bakiye-pos bakiye-strong" : "bakiye-neg bakiye-strong"}>₺{tl(detayPersonel.balance, language)}</span>
                </p>
              </div>
              <button type="button" className="bakiye-icon-button" aria-label={t("close")} onClick={() => setDetayPersonel(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="bakiye-modal-body">
              {detayYukleniyor ? (
                <div className="bakiye-loading"><Loader2 size={24} className="bakiye-spin" /></div>
              ) : detaySiparisler.length === 0 ? (
                <div className="bakiye-empty"><Package size={40} /><p>{t("noStaffOrders")}</p></div>
              ) : (
                <div className="bakiye-table-scroll">
                  <table className="bakiye-table">
                    <thead>
                      <tr>
                        <th>{t("columnOrderNumber")}</th>
                        <th>{t("columnCustomer")}</th>
                        <th>{t("columnStatus")}</th>
                        <th>{t("columnAmount")}</th>
                        <th>{t("columnDate")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detaySiparisler.map((siparis) => {
                        const durum = SIPARIS_DURUM[siparis.status];
                        return (
                          <tr key={siparis.public_id}>
                            <td className="bakiye-mono">{siparis.order_number}</td>
                            <td>
                              <span className="bakiye-order">
                                <span>{siparis.customer_full_name ?? "-"}</span>
                                {siparis.customer_phone && <small>{siparis.customer_phone}</small>}
                              </span>
                            </td>
                            <td><span className={`bakiye-status tone-${durum?.tone ?? "slate"}`}>{durum ? t(durum.label) : siparis.status}</span></td>
                            <td className="bakiye-strong">₺{tl(siparis.total_amount, language)}</td>
                            <td className="bakiye-date">{tarihFormatla(siparis.created_at, language)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {odemeModalAcik && (
        <div className="bakiye-overlay" role="dialog" aria-modal="true" data-testid="bakiye-odeme-modal">
          <div className="bakiye-modal">
            <button type="button" className="bakiye-icon-button bakiye-modal-close" aria-label={t("close")} onClick={() => setOdemeModalAcik(false)}>
              <X size={20} />
            </button>
            <h2><Send size={20} />{t("requestPayment")}</h2>
            <div className="bakiye-available">
              <p className="bakiye-stat-label">{t("availableBalance")}</p>
              <p className="bakiye-available-value">₺{tl(kullanilabilirBakiye, language)}</p>
              {istatistikler.bekleyenOdeme > 0 && (
                <p className="bakiye-pending-note">{t("pendingPaymentNote", { amount: tl(istatistikler.bekleyenOdeme, language) })}</p>
              )}
            </div>
            <form onSubmit={(event) => void odemeIstegiOlustur(event)} className="bakiye-form">
              <label>
                <span>{t("requestedAmount")}</span>
                <input
                  type="number"
                  min="1"
                  max={kullanilabilirBakiye}
                  step="0.01"
                  value={odemeTutar}
                  onChange={(event) => setOdemeTutar(event.target.value)}
                  placeholder="0.00"
                  required
                  disabled={odemeGonderiliyor}
                />
              </label>
              <div className="bakiye-quick-amounts">
                {[25, 50, 100].map((miktar) => (
                  <button
                    key={miktar}
                    type="button"
                    disabled={odemeGonderiliyor}
                    onClick={() => setOdemeTutar(Math.min(miktar, kullanilabilirBakiye).toString())}
                  >
                    ₺{miktar}
                  </button>
                ))}
                <button
                  type="button"
                  className="bakiye-quick-all"
                  disabled={odemeGonderiliyor}
                  onClick={() => setOdemeTutar(kullanilabilirBakiye.toString())}
                >
                  {t("all")}
                </button>
              </div>
              <button type="submit" className="bakiye-primary bakiye-full" disabled={odemeGonderiliyor}>
                {odemeGonderiliyor ? (<><Loader2 size={16} className="bakiye-spin" />{t("sending")}</>) : t("sendPaymentRequest")}
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
