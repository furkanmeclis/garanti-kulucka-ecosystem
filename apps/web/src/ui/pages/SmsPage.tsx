import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle,
  ChevronDown,
  Clock,
  Edit3,
  Eye,
  FileText,
  Filter,
  History,
  Info,
  MessageSquare,
  Phone,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Trash2,
  X,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { BackendHttpClient } from "../../api/http-client.js";
import {
  createSmsClient,
  type SmsClient,
  type SmsHistoryType,
  type SmsMessage,
  type SmsTemplate,
} from "../../api/sms-client.js";

/**
 * Legacy parity: garanti-kulucka/frontend/src/pages/sms/SmsGonderPage.jsx.
 * Sends, templates, history and the PTT/Sürat sweep all go through the backend `/api/sms/*` routes;
 * NetGSM is only reached by the worker through the provider-delivery queue.
 */

// ─── Değişkenler ──────────────────────────────────────────────────────────────
const DEGISKENLER = [
  { etiket: "Müşteri Adı", deger: "{musteri_adi}", ornek: "Ahmet Yılmaz" },
  { etiket: "Takip No", deger: "{takip_no}", ornek: "123456789" },
  { etiket: "Kargo Firması", deger: "{kargo_firmasi}", ornek: "PTT" },
] as const;

const SAYFA_BOYUTU = 25;

type Bildirim = { tip: "success" | "error" | "warning"; mesaj: string };
type Bildir = (tip: Bildirim["tip"], mesaj: string) => void;

function onizlemeUret(metin: string) {
  let s = metin;
  DEGISKENLER.forEach(({ deger, ornek }) => {
    s = s.replaceAll(deger, `[${ornek}]`);
  });
  return s;
}

function degiskenVarMi(metin: string) {
  return DEGISKENLER.some((d) => metin.includes(d.deger));
}

function cursorEkle(ref: RefObject<HTMLTextAreaElement | null>, eklenecek: string, mevcutDeger: string, onChange: (value: string) => void) {
  const el = ref.current;
  if (!el) return;
  const bas = el.selectionStart;
  const son = el.selectionEnd;
  const yeni = mevcutDeger.slice(0, bas) + eklenecek + mevcutDeger.slice(son);
  onChange(yeni);
  setTimeout(() => {
    el.selectionStart = el.selectionEnd = bas + eklenecek.length;
    el.focus();
  }, 0);
}

// SMS karakter sayacı (Türkçe özel karakterler UCS-2 → 70 karakter/SMS)
const UCS2_REGEX = /[şıİŞĞğ]/;
function smsBilgisi(metin: string) {
  const unicode = UCS2_REGEX.test(metin);
  const tekLimit = unicode ? 70 : 160;
  const cokluLimit = unicode ? 67 : 153;
  const len = metin.length;
  const sayisi = len === 0 ? 1 : len <= tekLimit ? 1 : Math.ceil(len / cokluLimit);
  return { len, sayisi, unicode, tekLimit, cokluLimit };
}

function hataMesaji(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function yeniAnahtar(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function DegiskenButonlari(props: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  metin: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="sms-variables" data-testid="sms-variable-buttons">
      <span className="sms-variables-label">Değişken ekle:</span>
      {DEGISKENLER.map((d) => (
        <button
          key={d.deger}
          type="button"
          className="sms-variable"
          data-testid={`sms-variable-${d.deger.slice(1, -1).replaceAll("_", "-")}`}
          onClick={() => cursorEkle(props.textareaRef, d.deger, props.metin, props.onChange)}
        >
          {d.deger}
        </button>
      ))}
    </div>
  );
}

function SmsKarakterSayaci(props: { metin: string; testId?: string }) {
  const { len, sayisi, unicode, tekLimit } = smsBilgisi(props.metin);
  return (
    <div className="sms-counter" data-testid={props.testId}>
      <span>{len} karakter</span>
      <span className={sayisi > 1 ? "sms-counter-multi" : "sms-counter-single"}>{sayisi} SMS</span>
      {unicode && (
        <span className="sms-counter-unicode">
          <AlertCircle size={12} />
          Türkçe karakter → {tekLimit} karakter/SMS
        </span>
      )}
    </div>
  );
}

function OnizlemeKutusu(props: { metin: string }) {
  if (!props.metin || !degiskenVarMi(props.metin)) return null;
  return (
    <div className="sms-preview" data-testid="sms-preview">
      <p className="sms-preview-title">
        <Eye size={12} /> Önizleme (örnek değerlerle)
      </p>
      <p className="sms-preview-text">{onizlemeUret(props.metin)}</p>
    </div>
  );
}

// ─── Manuel Tab ──────────────────────────────────────────────────────────────
interface OturumKaydi {
  id: string;
  telefon: string;
  metin: string;
  durum: "basarili" | "hata";
  bulkId: string | null;
  kuyrukta: boolean;
  hata?: string;
  zaman: string;
}

function ManuelTab(props: { client: SmsClient; sablonlar: SmsTemplate[]; bildir: Bildir }) {
  const [telefonlar, setTelefonlar] = useState<Array<{ id: number; numara: string }>>([{ id: 1, numara: "" }]);
  const [metin, setMetin] = useState("");
  const [sablon, setSablon] = useState<SmsTemplate | null>(null);
  const [sablonAcik, setSablonAcik] = useState(false);
  const [gonderilenler, setGonderilenler] = useState<OturumKaydi[]>([]);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const telefonEkle = () => setTelefonlar((prev) => [...prev, { id: Date.now(), numara: "" }]);
  const telefonKaldir = (id: number) => setTelefonlar((prev) => prev.filter((t) => t.id !== id));
  const telefonGuncelle = (id: number, numara: string) =>
    setTelefonlar((prev) => prev.map((t) => (t.id === id ? { ...t, numara } : t)));

  const sablonSec = (s: SmsTemplate) => {
    setMetin(s.body);
    setSablon(s);
    setSablonAcik(false);
  };

  const handleGonder = async () => {
    const gecerliNumaralar = telefonlar.map((t) => t.numara.trim()).filter(Boolean);
    if (gecerliNumaralar.length === 0) {
      props.bildir("error", "En az bir telefon numarası girin");
      return;
    }
    if (!metin.trim()) {
      props.bildir("error", "Mesaj boş olamaz");
      return;
    }
    if (degiskenVarMi(metin)) {
      props.bildir("error", "Mesajda doldurulmamış değişken var ({musteri_adi} vb.)");
      return;
    }
    setGonderiliyor(true);
    const zaman = new Date().toLocaleTimeString("tr-TR");
    let sonuclar: OturumKaydi[];
    try {
      const response = await props.client.sendManual({
        recipients: gecerliNumaralar,
        message: metin.trim(),
        idempotency_key: yeniAnahtar("sms_manual"),
        ...(sablon ? { template_public_id: sablon.public_id } : {}),
      });
      sonuclar = response.messages.map((message, index) => ({
        id: message.public_id,
        telefon: gecerliNumaralar[index] ?? message.recipient_phone,
        metin: message.message,
        durum: message.status === "failed" ? "hata" : "basarili",
        bulkId: message.provider_bulk_id,
        kuyrukta: message.queued,
        ...(message.status === "failed" && message.error_message ? { hata: message.error_message } : {}),
        zaman,
      }));
    } catch (error) {
      const hata = hataMesaji(error, "SMS gönderilemedi");
      sonuclar = gecerliNumaralar.map((numara, index) => ({
        id: `${Date.now()}_${index}`,
        telefon: numara,
        metin: metin.trim(),
        durum: "hata",
        bulkId: null,
        kuyrukta: false,
        hata,
        zaman,
      }));
    }
    setGonderilenler((prev) => [...sonuclar, ...prev]);
    const basarili = sonuclar.filter((s) => s.durum === "basarili").length;
    const hatali = sonuclar.filter((s) => s.durum === "hata").length;
    if (basarili > 0 && hatali === 0) {
      props.bildir("success", `${basarili} SMS başarıyla gönderildi`);
      setTelefonlar([{ id: 1, numara: "" }]);
      setMetin("");
      setSablon(null);
    } else if (basarili > 0 && hatali > 0) {
      props.bildir("warning", `${basarili} gönderildi, ${hatali} başarısız`);
    } else {
      props.bildir("error", "SMS gönderilemedi");
    }
    setGonderiliyor(false);
  };

  const degiskenVar = degiskenVarMi(metin);

  return (
    <div className="sms-manual-grid" data-testid="sms-manual-tab">
      <div className="sms-card sms-form">
        <div>
          <label className="sms-label">Alıcı Telefon Numaraları</label>
          <div className="sms-phone-list">
            {telefonlar.map((t) => (
              <div key={t.id} className="sms-phone-row">
                <div className="sms-input-icon">
                  <Phone size={16} />
                  <input
                    type="tel"
                    placeholder="05XX XXX XX XX"
                    value={t.numara}
                    data-testid="sms-phone-input"
                    onChange={(event) => telefonGuncelle(t.id, event.target.value)}
                  />
                </div>
                {telefonlar.length > 1 && (
                  <button
                    type="button"
                    className="sms-icon-button sms-icon-danger"
                    aria-label="Numarayı kaldır"
                    onClick={() => telefonKaldir(t.id)}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button type="button" className="sms-link-button" data-testid="sms-add-phone" onClick={telefonEkle}>
            <Plus size={16} />
            Numara Ekle
          </button>
        </div>

        <div>
          <label className="sms-label">Hazır Şablon (opsiyonel)</label>
          <div className="sms-dropdown">
            <button
              type="button"
              className="sms-dropdown-toggle"
              data-testid="sms-template-select"
              onClick={() => setSablonAcik(!sablonAcik)}
            >
              <span className={sablon ? undefined : "sms-placeholder"}>{sablon?.title || "Şablon seç..."}</span>
              <ChevronDown size={16} className={sablonAcik ? "sms-rotate" : undefined} />
            </button>
            {sablonAcik && (
              <>
                <div className="sms-dropdown-backdrop" onClick={() => setSablonAcik(false)} />
                <div className="sms-dropdown-menu" data-testid="sms-template-menu">
                  {props.sablonlar
                    .filter((s) => s.is_active !== false)
                    .map((s) => (
                      <button key={s.public_id} type="button" className="sms-dropdown-item" onClick={() => sablonSec(s)}>
                        <p className="sms-dropdown-title">{s.title}</p>
                        <p className="sms-dropdown-body">{s.body}</p>
                      </button>
                    ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="sms-stack">
          <div className="sms-row-between">
            <label className="sms-label sms-label-inline">Mesaj</label>
            <SmsKarakterSayaci metin={metin} testId="sms-manual-counter" />
          </div>
          <DegiskenButonlari textareaRef={textareaRef} metin={metin} onChange={setMetin} />
          <textarea
            ref={textareaRef}
            value={metin}
            data-testid="sms-message-input"
            onChange={(event) => setMetin(event.target.value)}
            rows={5}
            maxLength={480}
            placeholder="Mesajınızı buraya yazın veya şablon seçin..."
          />
          <OnizlemeKutusu metin={metin} />
          {degiskenVar && (
            <p className="sms-warning-text">
              <AlertCircle size={12} />
              Değişkenleri göndermeden önce doldurun veya silin
            </p>
          )}
        </div>

        <button
          type="button"
          className="sms-primary sms-full"
          data-testid="sms-send-button"
          disabled={gonderiliyor}
          onClick={() => void handleGonder()}
        >
          {gonderiliyor ? (
            <>
              <RefreshCw size={16} className="sms-spin" /> Gönderiliyor...
            </>
          ) : (
            <>
              <Send size={16} /> Gönder
            </>
          )}
        </button>
      </div>

      <div className="sms-card sms-session" data-testid="sms-session">
        <div className="sms-row-between sms-session-head">
          <h2>
            <MessageSquare size={16} />
            Bu Oturum
          </h2>
          {gonderilenler.length > 0 && (
            <button type="button" className="sms-text-button" onClick={() => setGonderilenler([])}>
              Temizle
            </button>
          )}
        </div>
        {gonderilenler.length === 0 ? (
          <div className="sms-empty">
            <Clock size={32} />
            <p>Henüz SMS gönderilmedi</p>
          </div>
        ) : (
          <div className="sms-session-list">
            {gonderilenler.map((g) => (
              <div
                key={g.id}
                className={`sms-session-item ${g.durum === "basarili" ? "sms-session-ok" : "sms-session-error"}`}
                data-testid="sms-session-item"
              >
                <div className="sms-row-between">
                  <div className="sms-session-phone">
                    {g.durum === "basarili" ? <CheckCircle size={16} className="sms-ok" /> : <XCircle size={16} className="sms-err" />}
                    <span>{g.telefon}</span>
                  </div>
                  <span className="sms-session-time">{g.zaman}</span>
                </div>
                <p className="sms-session-text">{g.metin}</p>
                {g.durum === "basarili" && g.bulkId && <p className="sms-session-meta">BulkID: {g.bulkId}</p>}
                {g.durum === "basarili" && !g.bulkId && g.kuyrukta && <p className="sms-session-meta">Kuyruğa alındı</p>}
                {g.durum === "hata" && <p className="sms-session-error-text">{g.hata}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Geçmiş Tab ──────────────────────────────────────────────────────────────
const TUR_SECENEKLERI: Array<{ id: SmsHistoryType; label: string }> = [
  { id: "all", label: "Hepsi" },
  { id: "manual", label: "Manuel" },
  { id: "automatic", label: "Otomatik" },
];

function GecmisTab(props: { client: SmsClient; bildir: Bildir }) {
  const { client, bildir } = props;
  const [kayitlar, setKayitlar] = useState<SmsMessage[]>([]);
  const [toplam, setToplam] = useState(0);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [aramaMetni, setAramaMetni] = useState("");
  const [tur, setTur] = useState<SmsHistoryType>("all");
  const [sayfa, setSayfa] = useState(1);

  const getir = useCallback(async () => {
    setYukleniyor(true);
    try {
      const response = await client.listHistory({
        type: tur,
        page: sayfa,
        pageSize: SAYFA_BOYUTU,
        ...(aramaMetni.trim() ? { q: aramaMetni.trim() } : {}),
      });
      setKayitlar(response.data ?? []);
      setToplam(response.total ?? 0);
    } catch (error) {
      bildir("error", `Geçmiş yüklenemedi: ${hataMesaji(error, "bilinmeyen hata")}`);
    } finally {
      setYukleniyor(false);
    }
  }, [client, bildir, tur, sayfa, aramaMetni]);

  useEffect(() => {
    void getir();
  }, [getir]);

  const toplamSayfa = Math.max(1, Math.ceil(toplam / SAYFA_BOYUTU));

  return (
    <div className="sms-stack-lg" data-testid="sms-history-tab">
      <div className="sms-history-toolbar">
        <div className="sms-input-icon sms-history-search">
          <Search size={16} />
          <input
            type="text"
            placeholder="Telefon, müşteri adı veya takip no..."
            value={aramaMetni}
            data-testid="sms-history-search"
            onChange={(event) => {
              setAramaMetni(event.target.value);
              setSayfa(1);
            }}
          />
        </div>
        <div className="sms-segment">
          {TUR_SECENEKLERI.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tur === t.id ? "selected" : undefined}
              data-testid={`sms-history-type-${t.id}`}
              aria-pressed={tur === t.id}
              onClick={() => {
                setTur(t.id);
                setSayfa(1);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" className="sms-secondary" disabled={yukleniyor} onClick={() => void getir()}>
          <RefreshCw size={16} className={yukleniyor ? "sms-spin" : undefined} />
          Yenile
        </button>
      </div>

      <div className="sms-card sms-table-card">
        {yukleniyor && kayitlar.length === 0 ? (
          <div className="sms-empty">
            <RefreshCw size={24} className="sms-spin" />
          </div>
        ) : kayitlar.length === 0 ? (
          <div className="sms-empty">
            <History size={32} />
            <p>Kayıt bulunamadı</p>
          </div>
        ) : (
          <div className="sms-table-scroll">
            <table className="sms-table" data-testid="sms-history-table">
              <thead>
                <tr>
                  <th>Zaman</th>
                  <th>Telefon</th>
                  <th>Müşteri</th>
                  <th>Mesaj</th>
                  <th>Tür</th>
                  <th>Durum</th>
                </tr>
              </thead>
              <tbody>
                {kayitlar.map((k) => (
                  <tr key={k.public_id} data-testid="sms-history-row">
                    <td className="sms-nowrap sms-muted-cell">
                      {new Date(k.created_at).toLocaleString("tr-TR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="sms-nowrap sms-mono">{k.recipient_phone}</td>
                    <td>
                      <div>{k.customer_name || <span className="sms-dim">—</span>}</div>
                      {k.tracking_number && <div className="sms-subtle">{k.tracking_number}</div>}
                    </td>
                    <td className="sms-message-cell">
                      <p>{k.message}</p>
                    </td>
                    <td>
                      <span className={`sms-badge ${k.is_automatic ? "sms-badge-auto" : "sms-badge-manual"}`}>
                        {k.is_automatic ? <Bot size={12} /> : <Send size={12} />}
                        {k.is_automatic ? "Otomatik" : "Manuel"}
                      </span>
                    </td>
                    <td data-testid="sms-history-status">
                      {k.status === "sent" ? (
                        <span className="sms-badge sms-badge-ok">
                          <CheckCircle size={12} /> Gönderildi
                        </span>
                      ) : k.status === "failed" ? (
                        <span className="sms-badge sms-badge-error" title={k.error_message ?? ""}>
                          <XCircle size={12} /> Hata
                        </span>
                      ) : (
                        <span className="sms-badge sms-badge-queued">
                          <Clock size={12} /> Kuyrukta
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {toplamSayfa > 1 && (
        <div className="sms-pagination" data-testid="sms-history-pagination">
          <span>
            {toplam} kayıttan {(sayfa - 1) * SAYFA_BOYUTU + 1}–{Math.min(sayfa * SAYFA_BOYUTU, toplam)} gösteriliyor
          </span>
          <div className="sms-pagination-buttons">
            <button type="button" disabled={sayfa === 1} aria-label="Önceki sayfa" onClick={() => setSayfa((p) => p - 1)}>
              ‹
            </button>
            <span>
              {sayfa} / {toplamSayfa}
            </span>
            <button
              type="button"
              disabled={sayfa === toplamSayfa}
              aria-label="Sonraki sayfa"
              data-testid="sms-history-next"
              onClick={() => setSayfa((p) => p + 1)}
            >
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Şablon Form (yeni + düzenle için ortak) ──────────────────────────────────
function SablonForm(props: {
  baslik: string;
  metin: string;
  onBaslikChange: (value: string) => void;
  onMetinChange: (value: string) => void;
  onKaydet: () => void;
  onIptal: () => void;
  kaydediliyor: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  return (
    <div className="sms-stack" data-testid="sms-template-form">
      <input
        type="text"
        className="sms-text-input"
        placeholder="Şablon başlığı"
        value={props.baslik}
        data-testid="sms-template-title-input"
        onChange={(event) => props.onBaslikChange(event.target.value)}
      />
      <div className="sms-stack">
        <DegiskenButonlari textareaRef={textareaRef} metin={props.metin} onChange={props.onMetinChange} />
        <textarea
          ref={textareaRef}
          rows={4}
          placeholder="Şablon metni"
          value={props.metin}
          data-testid="sms-template-body-input"
          onChange={(event) => props.onMetinChange(event.target.value)}
        />
        <SmsKarakterSayaci metin={props.metin} />
        <OnizlemeKutusu metin={props.metin} />
      </div>
      <div className="sms-actions">
        <button type="button" className="sms-primary sms-small" disabled={props.kaydediliyor} onClick={props.onKaydet}>
          <Save size={14} /> Kaydet
        </button>
        <button type="button" className="sms-secondary sms-small" onClick={props.onIptal}>
          <X size={14} /> İptal
        </button>
      </div>
    </div>
  );
}

// ─── Şablonlar Tab ────────────────────────────────────────────────────────────
function SablonlarTab(props: { client: SmsClient; sablonlar: SmsTemplate[]; getirSablonlar: () => void; bildir: Bildir }) {
  const { client, bildir, getirSablonlar } = props;
  const [duzenleniyor, setDuzenleniyor] = useState<{ id: string; baslik: string; metin: string } | null>(null);
  const [yeniSablon, setYeniSablon] = useState({ baslik: "", metin: "" });
  const [yeniAcik, setYeniAcik] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  const handleKaydet = async () => {
    if (!duzenleniyor) return;
    if (!duzenleniyor.baslik.trim() || !duzenleniyor.metin.trim()) {
      bildir("error", "Başlık ve metin boş olamaz");
      return;
    }
    setKaydediliyor(true);
    try {
      await client.updateTemplate(duzenleniyor.id, { title: duzenleniyor.baslik, body: duzenleniyor.metin });
      bildir("success", "Şablon güncellendi");
      setDuzenleniyor(null);
      getirSablonlar();
    } catch (error) {
      bildir("error", hataMesaji(error, "Güncellenemedi"));
    } finally {
      setKaydediliyor(false);
    }
  };

  const handleSil = async (id: string, sistem: boolean) => {
    if (sistem) {
      bildir("error", "Sistem şablonları silinemez");
      return;
    }
    if (!window.confirm("Bu şablonu silmek istediğinizden emin misiniz?")) return;
    try {
      await client.deleteTemplate(id);
      bildir("success", "Şablon silindi");
      getirSablonlar();
    } catch (error) {
      bildir("error", hataMesaji(error, "Silinemedi"));
    }
  };

  const handleYeniEkle = async () => {
    if (!yeniSablon.baslik.trim() || !yeniSablon.metin.trim()) {
      bildir("error", "Başlık ve metin boş olamaz");
      return;
    }
    setKaydediliyor(true);
    try {
      await client.createTemplate({ title: yeniSablon.baslik, body: yeniSablon.metin });
      bildir("success", "Şablon eklendi");
      setYeniSablon({ baslik: "", metin: "" });
      setYeniAcik(false);
      getirSablonlar();
    } catch (error) {
      bildir("error", hataMesaji(error, "Eklenemedi"));
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <div className="sms-stack-lg" data-testid="sms-templates-tab">
      <div className="sms-variables-help">
        <p className="sms-variables-help-title">Kullanılabilir Değişkenler</p>
        <div className="sms-variables-help-list">
          {DEGISKENLER.map((d) => (
            <div key={d.deger} className="sms-variables-help-item">
              <span className="sms-variable sms-variable-static">{d.deger}</span>
              <span>
                → {d.etiket} (örn: {d.ornek})
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="sms-row-between">
        <p className="sms-muted" data-testid="sms-template-count">
          {props.sablonlar.length} şablon • Sistem şablonları düzenlenebilir ama silinemez
        </p>
        <button type="button" className="sms-primary" data-testid="sms-template-new" onClick={() => setYeniAcik(!yeniAcik)}>
          <Plus size={16} />
          Yeni Şablon
        </button>
      </div>

      {yeniAcik && (
        <div className="sms-card sms-card-accent">
          <h3 className="sms-card-title">Yeni Şablon Ekle</h3>
          <SablonForm
            baslik={yeniSablon.baslik}
            metin={yeniSablon.metin}
            onBaslikChange={(v) => setYeniSablon((p) => ({ ...p, baslik: v }))}
            onMetinChange={(v) => setYeniSablon((p) => ({ ...p, metin: v }))}
            onKaydet={() => void handleYeniEkle()}
            onIptal={() => {
              setYeniAcik(false);
              setYeniSablon({ baslik: "", metin: "" });
            }}
            kaydediliyor={kaydediliyor}
          />
        </div>
      )}

      <div className="sms-stack">
        {props.sablonlar.map((s) => (
          <div key={s.public_id} className="sms-card sms-template-card" data-testid="sms-template-card">
            {duzenleniyor?.id === s.public_id ? (
              <SablonForm
                baslik={duzenleniyor.baslik}
                metin={duzenleniyor.metin}
                onBaslikChange={(v) => setDuzenleniyor((p) => (p ? { ...p, baslik: v } : p))}
                onMetinChange={(v) => setDuzenleniyor((p) => (p ? { ...p, metin: v } : p))}
                onKaydet={() => void handleKaydet()}
                onIptal={() => setDuzenleniyor(null)}
                kaydediliyor={kaydediliyor}
              />
            ) : (
              <div className="sms-template-row">
                <div className="sms-template-main">
                  <div className="sms-template-head">
                    <h3>{s.title}</h3>
                    {s.is_system && <span className="sms-pill">Sistem</span>}
                    {s.is_active === false && <span className="sms-pill sms-pill-passive">Pasif</span>}
                  </div>
                  <p className="sms-template-body">{s.body}</p>
                  {degiskenVarMi(s.body) && <p className="sms-template-preview">{onizlemeUret(s.body)}</p>}
                  <div className="sms-template-counter">
                    <SmsKarakterSayaci metin={s.body} />
                  </div>
                </div>
                <div className="sms-template-actions">
                  <button
                    type="button"
                    className="sms-icon-button"
                    title="Düzenle"
                    aria-label="Düzenle"
                    data-testid="sms-template-edit"
                    onClick={() => setDuzenleniyor({ id: s.public_id, baslik: s.title, metin: s.body })}
                  >
                    <Edit3 size={16} />
                  </button>
                  {!s.is_system && (
                    <button
                      type="button"
                      className="sms-icon-button sms-icon-danger"
                      title="Sil"
                      aria-label="Sil"
                      data-testid="sms-template-delete"
                      onClick={() => void handleSil(s.public_id, s.is_system)}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Otomatik SMS Tab ─────────────────────────────────────────────────────────
const KEYWORDS = [
  "işyerinde bekliyor",
  "şubede bekliyor",
  "adreste yok",
  "adreste bulunam",
  "kapalı-",
  "teslim edilemedi",
  "haber kağıdı",
  "teslimat gerçekleştirilemedi",
  "müşteri bulunamadı",
  "teslimat yapılamadı",
  "teslim alınmadı",
  "telefon ihbarlı",
  "alıcı kabul etmedi",
  "müşteri şubeden alacak",
];

function OtomatikTab(props: { client: SmsClient; bildir: Bildir }) {
  const [tetikleniyorPtt, setTetikleniyorPtt] = useState(false);
  const [tetikleniyorSurat, setTetikleniyorSurat] = useState(false);

  const tetikle = async (firma: "ptt" | "surat") => {
    const setFn = firma === "ptt" ? setTetikleniyorPtt : setTetikleniyorSurat;
    setFn(true);
    try {
      await props.client.triggerAutomatic(firma, yeniAnahtar(`sms_auto_${firma}`));
      props.bildir("success", `${firma === "ptt" ? "PTT" : "Sürat"} takip güncelleme başlatıldı`);
    } catch (error) {
      props.bildir("error", hataMesaji(error, "Başlatılamadı"));
    } finally {
      setFn(false);
    }
  };

  return (
    <div className="sms-stack-lg sms-auto" data-testid="sms-automatic-tab">
      <div className="sms-info">
        <Info size={20} />
        <div>
          <h3>Otomatik SMS Nasıl Çalışır?</h3>
          <p>
            PTT ve Sürat kargo takip cron job'ları çalıştığında, son harekette aşağıdaki anahtar kelimelerden biri varsa
            müşteriye otomatik SMS gönderilir. Aynı kargo için 24 saat içinde tekrar gönderilmez.
          </p>
        </div>
      </div>

      <div className="sms-card">
        <h3 className="sms-card-title">
          <Filter size={16} />
          Tetikleyen Anahtar Kelimeler
        </h3>
        <div className="sms-keywords" data-testid="sms-keywords">
          {KEYWORDS.map((k) => (
            <span key={k} className="sms-keyword">
              {k}
            </span>
          ))}
        </div>
      </div>

      <div className="sms-card">
        <h3 className="sms-card-title">
          <Play size={16} />
          Manuel Tetikleme
        </h3>
        <p className="sms-subtle sms-auto-note">
          Cron job'u hemen çalıştırır — otomatik SMS dahil tüm takip güncellemeleri yapılır.
        </p>
        <div className="sms-actions">
          <button
            type="button"
            className="sms-secondary sms-trigger"
            data-testid="sms-trigger-ptt"
            disabled={tetikleniyorPtt}
            onClick={() => void tetikle("ptt")}
          >
            {tetikleniyorPtt ? <RefreshCw size={16} className="sms-spin" /> : <Play size={16} className="sms-ptt" />}
            PTT Takip Güncelle
          </button>
          <button
            type="button"
            className="sms-secondary sms-trigger"
            data-testid="sms-trigger-surat"
            disabled={tetikleniyorSurat}
            onClick={() => void tetikle("surat")}
          >
            {tetikleniyorSurat ? <RefreshCw size={16} className="sms-spin" /> : <Play size={16} className="sms-surat" />}
            Sürat Takip Güncelle
          </button>
        </div>
        <p className="sms-subtle sms-auto-footnote">
          <AlertCircle size={14} />
          Güncellemeler arka planda çalışır; tamamlanması birkaç dakika sürebilir.
        </p>
      </div>
    </div>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
type TabId = "manuel" | "gecmis" | "sablonlar" | "otomatik";
const TABS: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: "manuel", label: "Manuel Gönder", icon: Send },
  { id: "gecmis", label: "Geçmiş", icon: History },
  { id: "sablonlar", label: "Şablonlar", icon: FileText },
  { id: "otomatik", label: "Otomatik SMS", icon: Zap },
];

// ─── Ana Sayfa ────────────────────────────────────────────────────────────────
export function SmsPage(props: { http: BackendHttpClient }) {
  const client = useMemo(() => createSmsClient(props.http), [props.http]);
  const [aktifTab, setAktifTab] = useState<TabId>("manuel");
  const [sablonlar, setSablonlar] = useState<SmsTemplate[]>([]);
  const [bildirim, setBildirim] = useState<Bildirim | null>(null);

  const bildir = useCallback<Bildir>((tip, mesaj) => setBildirim({ tip, mesaj }), []);

  const getirSablonlar = useCallback(async () => {
    try {
      const response = await client.listTemplates();
      setSablonlar(response.data ?? []);
    } catch {
      /* sessiz */
    }
  }, [client]);

  useEffect(() => {
    void getirSablonlar();
  }, [getirSablonlar]);

  return (
    <section className="sms-page" data-testid="sms-flow">
      <div>
        <h1>SMS</h1>
        <p className="sms-muted">Manuel gönderim, geçmiş kayıtlar, şablon yönetimi ve otomatik SMS ayarları</p>
      </div>

      {bildirim && (
        <div className={`sms-toast sms-toast-${bildirim.tip}`} role="status" data-testid="sms-toast">
          <span>{bildirim.mesaj}</span>
          <button type="button" className="sms-icon-button" onClick={() => setBildirim(null)} aria-label="Kapat">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="sms-tabs" role="tablist">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={aktifTab === id}
            className={aktifTab === id ? "selected" : undefined}
            data-testid={`sms-tab-${id}`}
            onClick={() => setAktifTab(id)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {aktifTab === "manuel" && <ManuelTab client={client} sablonlar={sablonlar} bildir={bildir} />}
      {aktifTab === "gecmis" && <GecmisTab client={client} bildir={bildir} />}
      {aktifTab === "sablonlar" && (
        <SablonlarTab client={client} sablonlar={sablonlar} getirSablonlar={() => void getirSablonlar()} bildir={bildir} />
      )}
      {aktifTab === "otomatik" && <OtomatikTab client={client} bildir={bildir} />}
    </section>
  );
}
