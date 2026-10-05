import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  CheckCircle,
  EyeOff,
  Facebook,
  Inbox,
  Instagram,
  Loader2,
  MessageSquareText,
  Play,
  RefreshCw,
  Save,
  Send,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import type { BackendHttpClient } from "../../api/http-client.js";
import {
  createCommentsClient,
  type CommentControlReport,
  type CommentModerationConfig,
  type CommentPlatform,
  type CommentReplyType,
  type CommentStatus,
  type SocialComment,
} from "../../api/comments-client.js";

/**
 * Legacy parity: garanti-kulucka/frontend/src/pages/yorumlar/YorumlarPage.jsx.
 * Every action goes through the backend `/api/comments*` routes; provider calls are queued by the API.
 */

const SAYFA_BOYUTU = 30;

type DurumFiltre = CommentStatus | "tumu";
type PlatformFiltre = CommentPlatform | "tumu";

const DURUM_ETIKET: Record<CommentStatus, { label: string; tone: string }> = {
  pending: { label: "Bekliyor", tone: "slate" },
  manual: { label: "Manuel", tone: "amber" },
  auto_replied: { label: "Otomatik", tone: "emerald" },
  replied: { label: "Cevaplandı", tone: "sky" },
  deleted: { label: "Silindi", tone: "red" },
  hidden: { label: "Gizlendi", tone: "violet" },
  error: { label: "Hata", tone: "rose" },
};

const FILTRELER: Array<{ id: DurumFiltre; label: string }> = [
  { id: "manual", label: "Manuel bekleyen" },
  { id: "auto_replied", label: "Otomatik" },
  { id: "deleted", label: "Silinen" },
  { id: "hidden", label: "Gizlenen" },
  { id: "tumu", label: "Tümü" },
];

const OZET_KARTLARI: Array<[CommentStatus, string, LucideIcon]> = [
  ["manual", "Manuel", Inbox],
  ["auto_replied", "Otomatik", Bot],
  ["replied", "Cevaplı", CheckCircle],
  ["deleted", "Silinen", Trash2],
  ["hidden", "Gizli", EyeOff],
  ["pending", "Bekleyen", Loader2],
  ["error", "Hata", AlertCircle],
];

const VARSAYILAN_AYAR: CommentModerationConfig = {
  enabled: true,
  platforms: { instagram: true, facebook: true },
  reply_type: "public",
  delete_profanity: true,
  delete_brand_disparagement: true,
  risk_manual_examples: [],
  auto_reply_topics: [],
  min_confidence: 0.55,
};

interface Bildirim {
  tip: "success" | "error";
  mesaj: string;
}

function hataMesaji(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function idempotencyKey(action: string, comment: SocialComment) {
  return `yorum_${action}_${comment.public_id}_${comment.updated_at}`;
}

function PlatformIkon({ platform }: { platform: CommentPlatform }) {
  return platform === "instagram" ? (
    <Instagram size={14} className="yorumlar-ig" />
  ) : (
    <Facebook size={14} className="yorumlar-fb" />
  );
}

function listeMetin(arr: string[]) {
  return arr.join("\n");
}

function metinListe(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function AyarlarPanel(props: {
  config: CommentModerationConfig | null;
  onKapat: () => void;
  onKaydet: (config: CommentModerationConfig) => void;
  kaydediyor: boolean;
}) {
  const [form, setForm] = useState<CommentModerationConfig>({ ...VARSAYILAN_AYAR, ...(props.config ?? {}) });
  const guncelle = <K extends keyof CommentModerationConfig>(key: K, value: CommentModerationConfig[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <div className="yorumlar-overlay yorumlar-overlay-right" role="dialog" aria-label="Yorum AI Ayarları">
      <div className="yorumlar-drawer" data-testid="yorumlar-settings-panel">
        <div className="yorumlar-modal-head">
          <h2>
            <Settings2 size={20} />
            Yorum AI Ayarları
          </h2>
          <button type="button" className="yorumlar-icon-button" onClick={props.onKapat} aria-label="Kapat">
            <X size={20} />
          </button>
        </div>

        <div className="yorumlar-form">
          <label className="yorumlar-toggle-row">
            <span>AI pipeline açık</span>
            <input
              type="checkbox"
              data-testid="yorumlar-setting-enabled"
              checked={form.enabled}
              onChange={(event) => guncelle("enabled", event.target.checked)}
            />
          </label>

          <div className="yorumlar-box">
            <div className="yorumlar-box-title">Platformlar</div>
            <label className="yorumlar-toggle-line">
              <span>
                <Instagram size={16} className="yorumlar-ig" /> Instagram
              </span>
              <input
                type="checkbox"
                checked={form.platforms.instagram}
                onChange={(event) => guncelle("platforms", { ...form.platforms, instagram: event.target.checked })}
              />
            </label>
            <label className="yorumlar-toggle-line">
              <span>
                <Facebook size={16} className="yorumlar-fb" /> Facebook
              </span>
              <input
                type="checkbox"
                data-testid="yorumlar-setting-facebook"
                checked={form.platforms.facebook}
                onChange={(event) => guncelle("platforms", { ...form.platforms, facebook: event.target.checked })}
              />
            </label>
          </div>

          <div className="yorumlar-box">
            <div className="yorumlar-box-title">Cevap tipi</div>
            <select
              data-testid="yorumlar-setting-reply-type"
              value={form.reply_type}
              onChange={(event) => guncelle("reply_type", event.target.value as CommentReplyType)}
            >
              <option value="public">Herkese açık (yorum cevabı)</option>
              <option value="private">Özel DM (private reply)</option>
            </select>
          </div>

          <label className="yorumlar-toggle-row">
            <span>Küfür içerenleri sil</span>
            <input
              type="checkbox"
              checked={form.delete_profanity}
              onChange={(event) => guncelle("delete_profanity", event.target.checked)}
            />
          </label>

          <label className="yorumlar-toggle-row">
            <span>Marka kötülemeyi sil</span>
            <input
              type="checkbox"
              checked={form.delete_brand_disparagement}
              onChange={(event) => guncelle("delete_brand_disparagement", event.target.checked)}
            />
          </label>

          <div className="yorumlar-box">
            <div className="yorumlar-box-title">Min. güven (0–1)</div>
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={form.min_confidence}
              onChange={(event) => guncelle("min_confidence", Number.parseFloat(event.target.value) || 0.55)}
            />
          </div>

          <div className="yorumlar-box">
            <div className="yorumlar-box-title">Risk → manuel (satır satır)</div>
            <textarea
              rows={6}
              data-testid="yorumlar-setting-risk"
              value={listeMetin(form.risk_manual_examples)}
              onChange={(event) => guncelle("risk_manual_examples", metinListe(event.target.value))}
              placeholder={"kargom nerede\niade\nşikayet"}
            />
          </div>

          <div className="yorumlar-box">
            <div className="yorumlar-box-title">Otomatik cevap konuları (satır satır)</div>
            <textarea
              rows={5}
              value={listeMetin(form.auto_reply_topics)}
              onChange={(event) => guncelle("auto_reply_topics", metinListe(event.target.value))}
              placeholder={"fiyat\ngaranti\nürün özellikleri"}
            />
          </div>

          <button
            type="button"
            className="yorumlar-primary yorumlar-full"
            disabled={props.kaydediyor}
            onClick={() => props.onKaydet(form)}
          >
            {props.kaydediyor ? <Loader2 size={16} className="yorumlar-spin" /> : <Save size={16} />}
            Kaydet
          </button>
        </div>
      </div>
    </div>
  );
}

function CevapModal(props: {
  yorum: SocialComment;
  taslak: string | null;
  onKapat: () => void;
  onGonder: (mesaj: string, cevapTipi: CommentReplyType) => void;
  gonderiliyor: boolean;
}) {
  const [mesaj, setMesaj] = useState(props.taslak ?? props.yorum.ai_reply_draft ?? props.yorum.manual_reply ?? "");
  const [cevapTipi, setCevapTipi] = useState<CommentReplyType>(props.yorum.reply_type ?? "public");

  return (
    <div className="yorumlar-overlay" role="dialog" aria-label="Yoruma cevap">
      <div className="yorumlar-modal" data-testid="yorumlar-reply-modal">
        <div className="yorumlar-modal-head">
          <div>
            <h3>Yoruma cevap</h3>
            <p className="yorumlar-muted">
              @{props.yorum.username || "kullanıcı"} · {props.yorum.platform}
            </p>
          </div>
          <button type="button" className="yorumlar-icon-button" onClick={props.onKapat} aria-label="Kapat">
            <X size={20} />
          </button>
        </div>
        <div className="yorumlar-quote">{props.yorum.text || "(boş yorum)"}</div>
        <select
          data-testid="yorumlar-reply-type"
          value={cevapTipi}
          onChange={(event) => setCevapTipi(event.target.value as CommentReplyType)}
        >
          <option value="public">Herkese açık</option>
          <option value="private">Özel DM</option>
        </select>
        <textarea
          rows={4}
          data-testid="yorumlar-reply-text"
          value={mesaj}
          onChange={(event) => setMesaj(event.target.value)}
          placeholder="Cevabınızı yazın…"
        />
        <div className="yorumlar-modal-actions">
          <button type="button" className="yorumlar-secondary" onClick={props.onKapat}>
            İptal
          </button>
          <button
            type="button"
            className="yorumlar-primary"
            data-testid="yorumlar-reply-send"
            disabled={props.gonderiliyor || !mesaj.trim()}
            onClick={() => props.onGonder(mesaj.trim(), cevapTipi)}
          >
            {props.gonderiliyor ? <Loader2 size={16} className="yorumlar-spin" /> : <Send size={16} />}
            Gönder
          </button>
        </div>
      </div>
    </div>
  );
}

export function YorumlarPage(props: { http: BackendHttpClient }) {
  const client = useMemo(() => createCommentsClient(props.http), [props.http]);
  const [kayitlar, setKayitlar] = useState<SocialComment[]>([]);
  const [toplam, setToplam] = useState(0);
  const [sayfa, setSayfa] = useState(1);
  const [durumFiltre, setDurumFiltre] = useState<DurumFiltre>("manual");
  const [platformFiltre, setPlatformFiltre] = useState<PlatformFiltre>("tumu");
  const [yukleniyor, setYukleniyor] = useState(true);
  const [islemId, setIslemId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Partial<Record<CommentStatus, number>>>({});
  const [ayarAcik, setAyarAcik] = useState(false);
  const [config, setConfig] = useState<CommentModerationConfig | null>(null);
  const [ayarKaydediyor, setAyarKaydediyor] = useState(false);
  const [cevapYorum, setCevapYorum] = useState<SocialComment | null>(null);
  const [cevapGonderiliyor, setCevapGonderiliyor] = useState(false);
  const [arama, setArama] = useState("");
  const [aktifArama, setAktifArama] = useState("");
  const [kontrol, setKontrol] = useState<CommentControlReport | null>(null);
  const [kontrolYukleniyor, setKontrolYukleniyor] = useState(false);
  const [kontrolAcik, setKontrolAcik] = useState(true);
  const [taslaklar, setTaslaklar] = useState<Record<string, string>>({});
  const [bildirim, setBildirim] = useState<Bildirim | null>(null);

  const bildir = useCallback((tip: Bildirim["tip"], mesaj: string) => setBildirim({ tip, mesaj }), []);

  const ayarlariGetir = useCallback(async () => {
    try {
      const response = await client.getSettings();
      setConfig(response.config);
    } catch {
      /* legacy: console.warn */
    }
  }, [client]);

  const kontrolGetir = useCallback(async () => {
    setKontrolYukleniyor(true);
    try {
      const report = await client.getControl();
      setKontrol(report);
      if (report.status !== "ready") setKontrolAcik(true);
    } catch (error) {
      setKontrol({
        status: "critical",
        summary: { ok: 0, warning: 0, error: 1 },
        warnings: [
          {
            id: "kontrol_fail",
            level: "error",
            title: "Kontrol endpoint’ine ulaşılamadı",
            detail: hataMesaji(error, "Bilinmeyen hata"),
          },
        ],
        checks: [],
      });
    } finally {
      setKontrolYukleniyor(false);
    }
  }, [client]);

  const istatistikGetir = useCallback(async () => {
    try {
      const response = await client.getStats();
      setCounts(response.counts ?? {});
    } catch {
      /* ignore */
    }
  }, [client]);

  const listeGetir = useCallback(async () => {
    setYukleniyor(true);
    try {
      const response = await client.listComments({
        page: sayfa,
        pageSize: SAYFA_BOYUTU,
        ...(durumFiltre !== "tumu" ? { status: durumFiltre } : {}),
        ...(platformFiltre !== "tumu" ? { platform: platformFiltre } : {}),
        ...(aktifArama.trim() ? { q: aktifArama.trim() } : {}),
      });
      setKayitlar(response.data ?? []);
      setToplam(response.total ?? 0);
    } catch (error) {
      setKayitlar([]);
      setToplam(0);
      bildir("error", hataMesaji(error, "Yorumlar yüklenemedi"));
    } finally {
      setYukleniyor(false);
    }
  }, [client, sayfa, durumFiltre, platformFiltre, aktifArama, bildir]);

  useEffect(() => {
    void ayarlariGetir();
    void istatistikGetir();
    void kontrolGetir();
  }, [ayarlariGetir, istatistikGetir, kontrolGetir]);

  useEffect(() => {
    void listeGetir();
  }, [listeGetir]);

  const yenile = useCallback(() => {
    void listeGetir();
    void istatistikGetir();
    void kontrolGetir();
  }, [listeGetir, istatistikGetir, kontrolGetir]);

  const aksiyon = async (yorum: SocialComment, tip: "delete" | "hide" | "manual", okMesaj: string) => {
    setIslemId(yorum.public_id);
    try {
      const key = idempotencyKey(tip, yorum);
      if (tip === "delete") await client.remove(yorum.public_id, key);
      else if (tip === "hide") await client.hide(yorum.public_id, key);
      else await client.markManual(yorum.public_id, key);
      bildir("success", okMesaj);
      yenile();
    } catch (error) {
      bildir("error", hataMesaji(error, "İşlem başarısız"));
    } finally {
      setIslemId(null);
    }
  };

  const cevapGonder = async (mesaj: string, cevapTipi: CommentReplyType) => {
    if (!cevapYorum) return;
    setCevapGonderiliyor(true);
    try {
      await client.reply(cevapYorum.public_id, {
        message: mesaj,
        reply_type: cevapTipi,
        idempotency_key: idempotencyKey(cevapTipi === "private" ? "private_reply" : "reply", cevapYorum),
      });
      bildir("success", "Cevap gönderildi");
      setCevapYorum(null);
      yenile();
    } catch (error) {
      bildir("error", hataMesaji(error, "Gönderilemedi"));
    } finally {
      setCevapGonderiliyor(false);
    }
  };

  const ayarKaydet = async (form: CommentModerationConfig) => {
    setAyarKaydediyor(true);
    try {
      const response = await client.saveSettings(form);
      setConfig(response.config);
      bildir("success", "Ayarlar kaydedildi");
      setAyarAcik(false);
      void kontrolGetir();
    } catch (error) {
      bildir("error", hataMesaji(error, "Kaydedilemedi"));
    } finally {
      setAyarKaydediyor(false);
    }
  };

  const yenidenIsle = async (yorum: SocialComment) => {
    setIslemId(yorum.public_id);
    try {
      const response = await client.suggestReply(yorum.public_id);
      setTaslaklar((current) => ({ ...current, [yorum.public_id]: response.suggestion }));
      bildir("success", `İşlendi: ${response.action || "ok"} (dry-run)`);
    } catch (error) {
      bildir("error", hataMesaji(error, "İşlem başarısız"));
    } finally {
      setIslemId(null);
    }
  };

  const toplamSayfa = Math.max(1, Math.ceil(toplam / SAYFA_BOYUTU));

  return (
    <section className="yorumlar-page" data-testid="comments-flow">
      <div className="yorumlar-header">
        <div>
          <h1>
            <MessageSquareText size={24} />
            Yorumlar
          </h1>
          <p className="yorumlar-muted">Facebook / Instagram post yorumları — AI otomatik cevap ve manuel kuyruk</p>
        </div>
        <div className="yorumlar-header-actions">
          <button
            type="button"
            className="yorumlar-secondary"
            data-testid="yorumlar-control-button"
            onClick={() => void kontrolGetir()}
            title="AI / önkoşul kontrolünü yenile"
          >
            {kontrolYukleniyor ? (
              <Loader2 size={16} className="yorumlar-spin" />
            ) : kontrol?.status === "ready" ? (
              <ShieldCheck size={16} className="yorumlar-ok" />
            ) : (
              <ShieldAlert size={16} className="yorumlar-warn" />
            )}
            Kontrol
          </button>
          <button
            type="button"
            className="yorumlar-secondary"
            data-testid="yorumlar-settings-button"
            onClick={() => setAyarAcik(true)}
          >
            <Settings2 size={16} />
            Ayarlar
          </button>
          <button type="button" className="yorumlar-secondary" data-testid="yorumlar-refresh" onClick={yenile}>
            <RefreshCw size={16} className={yukleniyor ? "yorumlar-spin" : undefined} />
            Yenile
          </button>
        </div>
      </div>

      {bildirim && (
        <div className={`yorumlar-toast yorumlar-toast-${bildirim.tip}`} role="status" data-testid="yorumlar-toast">
          <span>{bildirim.mesaj}</span>
          <button type="button" className="yorumlar-icon-button" onClick={() => setBildirim(null)} aria-label="Kapat">
            <X size={14} />
          </button>
        </div>
      )}

      {kontrol && kontrol.status !== "ready" && kontrolAcik && (
        <div
          className={`yorumlar-control ${kontrol.status === "critical" ? "yorumlar-control-critical" : "yorumlar-control-warning"}`}
          data-testid="yorumlar-control-panel"
        >
          <div className="yorumlar-control-head">
            <div className="yorumlar-control-title">
              {kontrol.status === "critical" ? <ShieldAlert size={20} /> : <AlertTriangle size={20} />}
              <div>
                <h2>
                  {kontrol.status === "critical"
                    ? "Yorum AI hazır değil — kritik eksikler var"
                    : "Yorum AI çalışır ama uyarılar var"}
                </h2>
                <p className="yorumlar-muted">
                  {kontrol.summary.error} hata · {kontrol.summary.warning} uyarı · {kontrol.summary.ok} tamam
                </p>
              </div>
            </div>
            <button type="button" className="yorumlar-icon-button" onClick={() => setKontrolAcik(false)} aria-label="Kapat">
              <X size={16} />
            </button>
          </div>
          <ul className="yorumlar-control-list">
            {kontrol.warnings.map((uyari) => (
              <li key={uyari.id}>
                <div className="yorumlar-control-item-title">
                  <span className={`yorumlar-level yorumlar-level-${uyari.level}`}>
                    {uyari.level === "error" ? "hata" : "uyarı"}
                  </span>
                  {uyari.title}
                </div>
                <p className="yorumlar-muted">{uyari.detail}</p>
              </li>
            ))}
          </ul>
          <div className="yorumlar-control-actions">
            <button type="button" className="yorumlar-secondary yorumlar-small" onClick={() => setAyarAcik(true)}>
              Ayarları aç
            </button>
            <button type="button" className="yorumlar-secondary yorumlar-small" onClick={() => void kontrolGetir()}>
              Tekrar kontrol et
            </button>
          </div>
        </div>
      )}

      {kontrol?.status === "ready" && (
        <div className="yorumlar-ready" data-testid="yorumlar-control-ready">
          <ShieldCheck size={16} />
          Yorum AI kontrolleri tamam — sınıflandırma ve otomatik cevap için hazır.
        </div>
      )}

      <div className="yorumlar-stats" data-testid="comments-ai-summary">
        {OZET_KARTLARI.map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            data-testid={`yorumlar-stat-${key}`}
            className={`yorumlar-stat ${durumFiltre === key ? "selected" : ""}`}
            onClick={() => {
              setDurumFiltre(key);
              setSayfa(1);
            }}
          >
            <span className="yorumlar-stat-label">
              <Icon size={12} />
              {label}
            </span>
            <strong>{counts[key] ?? "—"}</strong>
          </button>
        ))}
      </div>

      <div className="yorumlar-filters">
        {FILTRELER.map((filtre) => (
          <button
            key={filtre.id}
            type="button"
            data-testid={`yorumlar-filter-${filtre.id}`}
            className={`yorumlar-chip ${durumFiltre === filtre.id ? "selected" : ""}`}
            onClick={() => {
              setDurumFiltre(filtre.id);
              setSayfa(1);
            }}
          >
            {filtre.label}
          </button>
        ))}
        <select
          data-testid="yorumlar-platform-filter"
          value={platformFiltre}
          onChange={(event) => {
            setPlatformFiltre(event.target.value as PlatformFiltre);
            setSayfa(1);
          }}
        >
          <option value="tumu">Tüm platformlar</option>
          <option value="instagram">Instagram</option>
          <option value="facebook">Facebook</option>
        </select>
        <input
          data-testid="yorumlar-search"
          value={arama}
          onChange={(event) => setArama(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setSayfa(1);
              setAktifArama(arama);
            }
          }}
          placeholder="Yorumda ara…"
          className="yorumlar-search"
        />
        {config && (
          <span className={`yorumlar-config-pill ${config.enabled ? "on" : "off"}`} data-testid="yorumlar-config-pill">
            AI {config.enabled ? "açık" : "kapalı"} · {config.reply_type === "private" ? "DM" : "public"}
          </span>
        )}
      </div>

      <div className="yorumlar-list" data-testid="yorumlar-list">
        {yukleniyor ? (
          <div className="yorumlar-empty">
            <Loader2 size={24} className="yorumlar-spin" />
          </div>
        ) : kayitlar.length === 0 ? (
          <div className="yorumlar-empty">
            <Inbox size={32} />
            <p>Bu filtrede yorum yok</p>
          </div>
        ) : (
          <ul>
            {kayitlar.map((yorum) => {
              const durum = DURUM_ETIKET[yorum.status] ?? DURUM_ETIKET.pending;
              const busy = islemId === yorum.public_id;
              const taslak = taslaklar[yorum.public_id] ?? yorum.ai_reply_draft;
              return (
                <li key={yorum.public_id} className="yorumlar-row" data-testid="yorumlar-row">
                  <div className="yorumlar-row-body">
                    <div className="yorumlar-row-meta">
                      <span className="yorumlar-platform">
                        <PlatformIkon platform={yorum.platform} />
                        {yorum.platform}
                      </span>
                      <span>@{yorum.username || "—"}</span>
                      <span className={`yorumlar-badge yorumlar-tone-${durum.tone}`} data-testid="yorumlar-status">
                        {durum.label}
                      </span>
                      {yorum.classification && <span className="yorumlar-badge yorumlar-tone-slate">{yorum.classification}</span>}
                      {yorum.confidence != null && <span className="yorumlar-tiny">güven {Number(yorum.confidence).toFixed(2)}</span>}
                    </div>
                    <p className="yorumlar-text">{yorum.text || "(boş)"}</p>
                    {yorum.classification_reason && <p className="yorumlar-muted">Neden: {yorum.classification_reason}</p>}
                    {taslak && yorum.status === "manual" && <p className="yorumlar-draft">Taslak: {taslak}</p>}
                    {yorum.error_message && <p className="yorumlar-error">{yorum.error_message}</p>}
                    <p className="yorumlar-tiny">
                      {new Date(yorum.received_at).toLocaleString("tr-TR")}
                      {yorum.media_id ? ` · media ${yorum.media_id}` : ""}
                      {yorum.post_id ? ` · post ${yorum.post_id}` : ""}
                    </p>
                  </div>
                  <div className="yorumlar-row-actions">
                    {(yorum.status === "manual" || yorum.status === "error" || yorum.status === "pending") && (
                      <button
                        type="button"
                        className="yorumlar-primary yorumlar-small"
                        data-testid="yorumlar-reply-button"
                        disabled={busy}
                        onClick={() => setCevapYorum(yorum)}
                      >
                        <Send size={14} />
                        Cevapla
                      </button>
                    )}
                    <button
                      type="button"
                      className="yorumlar-danger yorumlar-small"
                      data-testid="yorumlar-delete-button"
                      disabled={busy}
                      onClick={() => void aksiyon(yorum, "delete", "Yorum silindi/gizlendi")}
                    >
                      <Trash2 size={14} />
                      Sil
                    </button>
                    <button
                      type="button"
                      className="yorumlar-secondary yorumlar-small"
                      data-testid="yorumlar-hide-button"
                      disabled={busy}
                      onClick={() => void aksiyon(yorum, "hide", "Yorum gizlendi")}
                    >
                      <EyeOff size={14} />
                      Gizle
                    </button>
                    {yorum.status !== "manual" && (
                      <button
                        type="button"
                        className="yorumlar-warning yorumlar-small"
                        data-testid="yorumlar-manual-button"
                        disabled={busy}
                        onClick={() => void aksiyon(yorum, "manual", "Manuel kuyruğa alındı")}
                      >
                        <Inbox size={14} />
                        Manuel
                      </button>
                    )}
                    <button
                      type="button"
                      className="yorumlar-secondary yorumlar-small"
                      data-testid="yorumlar-ai-button"
                      disabled={busy}
                      onClick={() => void yenidenIsle(yorum)}
                      title="AI ile yeniden işle"
                    >
                      {busy ? <Loader2 size={14} className="yorumlar-spin" /> : <Play size={14} />}
                      AI
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="yorumlar-pagination" data-testid="yorumlar-pagination">
        <button type="button" className="yorumlar-secondary yorumlar-small" disabled={sayfa <= 1} onClick={() => setSayfa(sayfa - 1)}>
          Önceki
        </button>
        <span>
          Sayfa {sayfa} / {toplamSayfa}
        </span>
        <button
          type="button"
          className="yorumlar-secondary yorumlar-small"
          disabled={sayfa >= toplamSayfa}
          onClick={() => setSayfa(sayfa + 1)}
        >
          Sonraki
        </button>
      </div>

      {ayarAcik && (
        <AyarlarPanel
          config={config}
          onKapat={() => setAyarAcik(false)}
          onKaydet={(form) => void ayarKaydet(form)}
          kaydediyor={ayarKaydediyor}
        />
      )}

      {cevapYorum && (
        <CevapModal
          key={cevapYorum.public_id}
          yorum={cevapYorum}
          taslak={taslaklar[cevapYorum.public_id] ?? null}
          onKapat={() => setCevapYorum(null)}
          onGonder={(mesaj, cevapTipi) => void cevapGonder(mesaj, cevapTipi)}
          gonderiliyor={cevapGonderiliyor}
        />
      )}
    </section>
  );
}
