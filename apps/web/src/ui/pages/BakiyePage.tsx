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

/** Legacy frontend/src/pages/bakiye/BakiyePage.jsx parity on backend-owned balance routes. */

const PAGE_SIZE = 50;

const HAREKET_CONFIG: Record<string, { label: string; tone: string; icon: LucideIcon }> = {
  commission: { label: "Komisyon", tone: "emerald", icon: TrendingUp },
  cancellation: { label: "İptal Kesintisi", tone: "red", icon: TrendingDown },
  return: { label: "İade Kesintisi", tone: "orange", icon: TrendingDown },
  payment: { label: "Ödeme", tone: "blue", icon: DollarSign },
  adjustment: { label: "Düzeltme", tone: "purple", icon: AlertCircle },
  rollback: { label: "Geri Alma", tone: "cyan", icon: TrendingUp },
};

const ODEME_DURUM_CONFIG: Record<string, { label: string; tone: string; icon: LucideIcon }> = {
  pending: { label: "Bekliyor", tone: "yellow", icon: Clock },
  seen: { label: "Görüldü", tone: "blue", icon: Eye },
  approved: { label: "Ödeme Yapıldı", tone: "emerald", icon: CheckCircle },
  rejected: { label: "Reddedildi", tone: "red", icon: XCircle },
};

const SIPARIS_DURUM: Record<string, { label: string; tone: string }> = {
  draft: { label: "Oluşturuldu", tone: "blue" },
  pending: { label: "Oluşturuldu", tone: "blue" },
  pending_confirmation: { label: "Teyit Bekliyor", tone: "yellow" },
  confirmed: { label: "Teyit Edildi", tone: "green" },
  preparing: { label: "Hazırlanıyor", tone: "purple" },
  shipped: { label: "Kargoda", tone: "indigo" },
  delivered: { label: "Teslim Edildi", tone: "emerald" },
  cancelled: { label: "İptal", tone: "red" },
  returned: { label: "İade", tone: "orange" },
};

function tarihFormatla(tarih: string | null | undefined) {
  if (!tarih) return "-";
  return new Date(tarih).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function tl(value: number) {
  return value.toLocaleString("tr-TR");
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof BackendRequestError) {
    const body = error.body as { error?: { message?: unknown } } | null | undefined;
    if (typeof body?.error?.message === "string" && body.error.message.length > 0) return body.error.message;
  }
  return fallback;
}

function Pagination(props: { sayfa: number; toplamSayfa: number; sayfaDegistir: (sayfa: number) => void }) {
  if (props.toplamSayfa <= 1) return null;
  return (
    <div className="bakiye-pagination">
      <button type="button" disabled={props.sayfa <= 1} onClick={() => props.sayfaDegistir(props.sayfa - 1)}>Önceki</button>
      <span>{props.sayfa} / {props.toplamSayfa}</span>
      <button type="button" disabled={props.sayfa >= props.toplamSayfa} onClick={() => props.sayfaDegistir(props.sayfa + 1)}>Sonraki</button>
    </div>
  );
}

export function BakiyePage(props: { http: BackendHttpClient; role: string | undefined }) {
  const isAdmin = props.role === "admin" || props.role === "owner";
  const client = useMemo(() => createBalancesClient(props.http), [props.http]);

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
      bildir("error", "Veriler yüklenirken hata oluştu");
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
    if (!window.confirm(`${personelAd} adlı personelin bakiyesi sıfırlanacak.\n\nDevam etmek istiyor musunuz?`)) return;
    sifirlamaLock.current = true;
    setSifirlamaYapiliyor(personel.user_public_id);
    try {
      const result = await client.resetStaffBalance(personel.user_public_id);
      bildir("success", `${personelAd} bakiyesi sıfırlandı (₺${result.previous_balance})`);
      await verileriGetir();
    } catch (error) {
      bildir("info", errorMessage(error, "İşlem yapılamadı"));
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
      bildir("error", "Siparişler yüklenirken hata oluştu");
    } finally {
      setDetayYukleniyor(false);
    }
  }, [bildir, client]);

  const odemeIstegiOlustur = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (odemeGondermeLock.current) return;
    const tutar = Number.parseFloat(odemeTutar);
    if (!tutar || tutar <= 0) {
      bildir("error", "Geçerli bir tutar girin");
      return;
    }
    odemeGondermeLock.current = true;
    setOdemeGonderiliyor(true);
    try {
      await client.createPaymentRequest({
        amount: tutar.toFixed(2),
        idempotency_key: `odeme_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      });
      bildir("success", "Ödeme isteğiniz admin'e iletildi!");
      setOdemeModalAcik(false);
      setOdemeTutar("");
      await verileriGetir();
    } catch (error) {
      bildir("error", errorMessage(error, "Ödeme isteği oluşturulurken hata oluştu"));
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
      bildir("info", errorMessage(error, "İşlem yapılamadı"));
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
          <h1><Wallet size={28} />{isAdmin ? "Bakiye Yönetimi" : "Bakiyem"}</h1>
          <p className="bakiye-muted">
            {isAdmin
              ? "Tüm personellerin bakiyelerini ve ödeme isteklerini yönetin"
              : "Komisyon bakiyenizi ve ödeme geçmişinizi görüntüleyin"}
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
            Ödeme İste
          </button>
        )}
      </div>

      {!isAdmin ? (
        <div className="bakiye-stats" data-testid="bakiye-stats">
          <div className="bakiye-stat bakiye-stat-main">
            <p className="bakiye-stat-label">Güncel Bakiye</p>
            <p className={`bakiye-stat-value-lg ${guncelBakiye >= 0 ? "bakiye-pos" : "bakiye-neg"}`}>
              {guncelBakiye >= 0 ? "+" : ""}₺{tl(guncelBakiye)}
            </p>
          </div>
          <div className="bakiye-stat">
            <p className="bakiye-stat-label"><ArrowUpRight size={16} className="bakiye-pos" />Toplam Komisyon</p>
            <p className="bakiye-stat-value bakiye-pos">+₺{tl(istatistikler.toplamKomisyon)}</p>
          </div>
          <div className="bakiye-stat">
            <p className="bakiye-stat-label"><ArrowDownRight size={16} className="bakiye-neg" />Toplam Kesinti</p>
            <p className="bakiye-stat-value bakiye-neg">-₺{tl(istatistikler.toplamKesinti)}</p>
          </div>
          <div className="bakiye-stat">
            <p className="bakiye-stat-label"><DollarSign size={16} className="bakiye-blue" />Ödenen</p>
            <p className="bakiye-stat-value bakiye-blue">₺{tl(istatistikler.toplamOdeme)}</p>
          </div>
        </div>
      ) : (
        <div data-testid="bakiye-personel-bakiyeleri">
          <h2 className="bakiye-section-title"><Users size={20} />Personel Bakiyeleri</h2>
          <div className="bakiye-staff-grid">
            {personelBakiyeleri.map((personel) => (
              <div key={personel.user_public_id} className="bakiye-staff-card" data-testid={`bakiye-personel-${personel.user_public_id}`}>
                <div className="bakiye-staff-head">
                  <span className={`bakiye-dot ${personel.is_online ? "online" : ""}`} />
                  <p className="bakiye-staff-name">{personel.first_name} {personel.last_name}</p>
                  {personel.pending_payment > 0 && <span className="bakiye-badge-pending">bekliyor</span>}
                </div>
                <p className={`bakiye-staff-balance ${personel.balance >= 0 ? "bakiye-pos" : "bakiye-neg"}`}>
                  {personel.balance >= 0 ? "+" : ""}₺{tl(personel.balance)}
                </p>
                <div className="bakiye-staff-actions">
                  <button type="button" className="bakiye-detail-button" onClick={() => void personelDetayAc(personel)}>
                    <FileText size={12} />
                    Detay
                  </button>
                  {personel.balance !== 0 && (
                    <button
                      type="button"
                      className="bakiye-reset-button"
                      disabled={sifirlamaYapiliyor !== null}
                      onClick={() => void bakiyeSifirla(personel)}
                    >
                      {sifirlamaYapiliyor === personel.user_public_id ? "Sıfırlanıyor..." : "Bakiye Sıfırla"}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {personelBakiyeleri.length === 0 && <p className="bakiye-muted">Personel bulunmuyor</p>}
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
          Bakiye Hareketleri
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={aktifTab === "odeme_istekleri"}
          className={aktifTab === "odeme_istekleri" ? "active" : ""}
          onClick={() => setAktifTab("odeme_istekleri")}
        >
          Ödeme İstekleri
          {isAdmin && bekleyenOdemeSayisi > 0 && <span className="bakiye-tab-badge">{bekleyenOdemeSayisi}</span>}
        </button>
      </div>

      {aktifTab === "hareketler" && (
        <div className="bakiye-table-card" data-testid="bakiye-hareketler">
          {hareketler.length === 0 ? (
            <div className="bakiye-empty"><Wallet size={48} /><p>Henüz bakiye hareketi bulunmuyor</p></div>
          ) : (
            <>
              <div className="bakiye-table-scroll">
                <table className="bakiye-table">
                  <thead>
                    <tr>
                      <th>Tür</th>
                      <th>Tutar</th>
                      <th>Sipariş</th>
                      <th>Bakiye Sonrası</th>
                      <th>Açıklama</th>
                      {isAdmin && <th>Personel</th>}
                      <th>Tarih</th>
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
                              {conf?.label ?? hareket.kind}
                            </span>
                          </td>
                          <td className={hareket.amount >= 0 ? "bakiye-pos bakiye-strong" : "bakiye-neg bakiye-strong"}>
                            {hareket.amount >= 0 ? "+" : ""}₺{tl(Math.abs(hareket.amount))}
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
                          <td>₺{tl(hareket.balance_after)}</td>
                          <td className="bakiye-desc">{hareket.description || "-"}</td>
                          {isAdmin && <td>{hareket.user_full_name || "-"}</td>}
                          <td className="bakiye-date">{tarihFormatla(hareket.created_at)}</td>
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
            <div className="bakiye-empty"><Send size={48} /><p>Henüz ödeme isteği bulunmuyor</p></div>
          ) : (
            <>
              <div className="bakiye-table-scroll">
                <table className="bakiye-table">
                  <thead>
                    <tr>
                      {isAdmin && <th>Personel</th>}
                      <th>Tutar</th>
                      <th>Durum</th>
                      <th>Tarih</th>
                      {isAdmin && <th>İşlem</th>}
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
                          <td className="bakiye-primary-text bakiye-strong">₺{tl(istek.amount)}</td>
                          <td>
                            <span className={`bakiye-status tone-${durum?.tone ?? "slate"}`}>
                              <DurumIkon size={12} />
                              {durum?.label ?? istek.status}
                            </span>
                          </td>
                          <td className="bakiye-date">{tarihFormatla(istek.created_at)}</td>
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
                                    {buIslemde ? <Loader2 size={12} className="bakiye-spin" /> : "Onayla"}
                                  </button>
                                  <button
                                    type="button"
                                    className="bakiye-reject"
                                    disabled={odemeIslemYapiliyor !== null}
                                    onClick={() => void odemeIstegiIsle(istek.public_id, "reject")}
                                  >
                                    Reddet
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
                <h2><Package size={20} />{detayPersonel.first_name} {detayPersonel.last_name} - Siparişler</h2>
                <p className="bakiye-muted">
                  Bakiye: <span className={detayPersonel.balance >= 0 ? "bakiye-pos bakiye-strong" : "bakiye-neg bakiye-strong"}>₺{tl(detayPersonel.balance)}</span>
                </p>
              </div>
              <button type="button" className="bakiye-icon-button" aria-label="Kapat" onClick={() => setDetayPersonel(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="bakiye-modal-body">
              {detayYukleniyor ? (
                <div className="bakiye-loading"><Loader2 size={24} className="bakiye-spin" /></div>
              ) : detaySiparisler.length === 0 ? (
                <div className="bakiye-empty"><Package size={40} /><p>Bu personele ait sipariş bulunamadı</p></div>
              ) : (
                <div className="bakiye-table-scroll">
                  <table className="bakiye-table">
                    <thead>
                      <tr>
                        <th>Sipariş No</th>
                        <th>Müşteri</th>
                        <th>Durum</th>
                        <th>Tutar</th>
                        <th>Tarih</th>
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
                            <td><span className={`bakiye-status tone-${durum?.tone ?? "slate"}`}>{durum?.label ?? siparis.status}</span></td>
                            <td className="bakiye-strong">₺{tl(siparis.total_amount)}</td>
                            <td className="bakiye-date">{tarihFormatla(siparis.created_at)}</td>
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
            <button type="button" className="bakiye-icon-button bakiye-modal-close" aria-label="Kapat" onClick={() => setOdemeModalAcik(false)}>
              <X size={20} />
            </button>
            <h2><Send size={20} />Ödeme İste</h2>
            <div className="bakiye-available">
              <p className="bakiye-stat-label">Kullanılabilir Bakiye</p>
              <p className="bakiye-available-value">₺{tl(kullanilabilirBakiye)}</p>
              {istatistikler.bekleyenOdeme > 0 && (
                <p className="bakiye-pending-note">(₺{tl(istatistikler.bekleyenOdeme)} bekleyen ödeme isteği)</p>
              )}
            </div>
            <form onSubmit={(event) => void odemeIstegiOlustur(event)} className="bakiye-form">
              <label>
                <span>İstenen Tutar (₺)</span>
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
                  Tümü
                </button>
              </div>
              <button type="submit" className="bakiye-primary bakiye-full" disabled={odemeGonderiliyor}>
                {odemeGonderiliyor ? (<><Loader2 size={16} className="bakiye-spin" />Gönderiliyor...</>) : "Ödeme İsteği Gönder"}
              </button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
