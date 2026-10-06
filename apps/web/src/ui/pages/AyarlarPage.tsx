import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Bot,
  FileText,
  Instagram,
  Key,
  Loader2,
  Lock,
  MessageCircle,
  Package,
  Phone,
  Plug,
  RefreshCw,
  Save,
  Settings,
  User,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { BackendHttpClient } from "../../api/http-client.js";
import { createAdminClient } from "../../api/admin-client.js";
import { createSettingsClient, type AdminLogEntry } from "../../api/settings-client.js";
import { useLanguage, useT } from "../i18n/index.js";
import { settingsMessages } from "../i18n/messages/settings.js";
import { MesajBanner, hataMetni, tarihSaatFormatla, useMesaj } from "./AyarlarShared.js";
import { EntegrasyonAyarlar, KullanicilarSekmesi } from "./AyarlarAdminTabs.js";
import { KargoPipelineAyarlar, SantralAyarlar, VapiAyarlar } from "./AyarlarProviderTabs.js";

/**
 * Legacy parity: garanti-kulucka/frontend/src/pages/ayarlar/AyarlarPage.jsx.
 * Tüm okuma/yazmalar backend üzerinden: profil/şifre `/auth/account/*`, AI ve provider ayarları
 * `/admin/settings/*` (zod registry + secret maskeleme), kullanıcılar/loglar `/admin/users|logs`.
 */

export interface AyarlarUser {
  public_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
}

type SekmeId = "profil" | "genel" | "kullanicilar" | "loglar" | "entegrasyonlar" | "santral" | "vapi" | "kargo-pipeline";

const islemRenkleri: Record<string, string> = {
  olustur: "green",
  create: "green",
  guncelle: "blue",
  update: "blue",
  settings_change: "blue",
  sil: "red",
  delete: "red",
  giris: "purple",
  login: "purple",
  cikis: "slate",
  logout: "slate",
};

export function AyarlarPage({
  http,
  user,
  onProfileUpdated,
}: {
  http: BackendHttpClient;
  user: AyarlarUser;
  onProfileUpdated?: (firstName: string, lastName: string) => void;
}) {
  const settingsClient = useMemo(() => createSettingsClient(http), [http]);
  const adminClient = useMemo(() => createAdminClient(http), [http]);
  const isAdmin = user.role === "admin" || user.role === "owner";
  const t = useT(settingsMessages);
  const { language } = useLanguage();

  const [aktifSekme, setAktifSekme] = useState<SekmeId>("profil");
  const { mesaj, setMesaj, mesajGoster } = useMesaj();
  const [profilKaydediliyor, setProfilKaydediliyor] = useState(false);
  const [sifreKaydediliyor, setSifreKaydediliyor] = useState(false);
  const [aiKaydediliyor, setAiKaydediliyor] = useState(false);
  const [profilForm, setProfilForm] = useState({ ad: user.first_name, soyad: user.last_name, email: user.email });
  const [yeniSifre, setYeniSifre] = useState("");
  const [yeniSifreTekrar, setYeniSifreTekrar] = useState("");
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiYukleniyor, setAiYukleniyor] = useState(true);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiPromptKaynak, setAiPromptKaynak] = useState<"" | "veritabani" | "varsayilan">("");
  const [aiPromptYuklendi, setAiPromptYuklendi] = useState(false);
  const [aiPromptYukleniyor, setAiPromptYukleniyor] = useState(false);
  const [aiPromptKaydediliyor, setAiPromptKaydediliyor] = useState(false);
  const [loglar, setLoglar] = useState<AdminLogEntry[]>([]);
  const [loglarYuklendi, setLoglarYuklendi] = useState(false);
  const [loglarYukleniyor, setLoglarYukleniyor] = useState(false);
  const [entegrasyonSekme, setEntegrasyonSekme] = useState<"instagram" | "messenger">("instagram");

  useEffect(() => {
    setProfilForm({ ad: user.first_name, soyad: user.last_name, email: user.email });
  }, [user.first_name, user.last_name, user.email]);

  useEffect(() => {
    let iptal = false;
    settingsClient
      .getAiStatus()
      .then((data) => {
        if (!iptal) setAiEnabled(data.ai_enabled);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!iptal) setAiYukleniyor(false);
      });
    return () => {
      iptal = true;
    };
  }, [settingsClient]);

  useEffect(() => {
    if (aktifSekme !== "genel" || !isAdmin || aiPromptYuklendi) return;
    setAiPromptYukleniyor(true);
    adminClient
      .listSettings()
      .then(({ data }) => {
        const prompt = data.find((setting) => setting.key === "ai.system_prompt");
        const value = typeof prompt?.value === "string" ? prompt.value : "";
        setAiPrompt(value);
        setAiPromptKaynak(value.trim() ? "veritabani" : "varsayilan");
      })
      .catch(() => undefined)
      .finally(() => {
        setAiPromptYuklendi(true);
        setAiPromptYukleniyor(false);
      });
  }, [aktifSekme, isAdmin, aiPromptYuklendi, adminClient]);

  const loglariYenile = useCallback(async () => {
    if (!isAdmin) return;
    setLoglarYukleniyor(true);
    try {
      const { data } = await settingsClient.listLogs(100);
      setLoglar(data);
    } catch {
      setLoglar([]);
    } finally {
      setLoglarYuklendi(true);
      setLoglarYukleniyor(false);
    }
  }, [isAdmin, settingsClient]);

  useEffect(() => {
    if (aktifSekme === "loglar" && isAdmin && !loglarYuklendi) void loglariYenile();
  }, [aktifSekme, isAdmin, loglarYuklendi, loglariYenile]);

  async function handleProfilGuncelle(event: FormEvent) {
    event.preventDefault();
    if (!profilForm.ad.trim()) {
      mesajGoster("hata", t("nameRequired"));
      return;
    }
    setProfilKaydediliyor(true);
    try {
      const updated = await settingsClient.updateProfile({ first_name: profilForm.ad.trim(), last_name: profilForm.soyad.trim() });
      onProfileUpdated?.(updated.first_name, updated.last_name);
      mesajGoster("basari", t("profileUpdated"));
    } catch (error) {
      mesajGoster("hata", t("updateFailed", { error: hataMetni(error) }));
    } finally {
      setProfilKaydediliyor(false);
    }
  }

  async function handleSifreDegistir(event: FormEvent) {
    event.preventDefault();
    if (yeniSifre.length < 6) {
      mesajGoster("hata", t("passwordMinLength"));
      return;
    }
    if (yeniSifre !== yeniSifreTekrar) {
      mesajGoster("hata", t("passwordsDoNotMatch"));
      return;
    }
    setSifreKaydediliyor(true);
    try {
      await settingsClient.changePassword(yeniSifre, yeniSifreTekrar);
      mesajGoster("basari", t("passwordUpdated"));
      setYeniSifre("");
      setYeniSifreTekrar("");
    } catch (error) {
      mesajGoster("hata", t("passwordUpdateFailed", { error: hataMetni(error) }));
    } finally {
      setSifreKaydediliyor(false);
    }
  }

  async function handleToggleAI() {
    if (!isAdmin) {
      mesajGoster("hata", t("noPermission"));
      return;
    }
    setAiKaydediliyor(true);
    try {
      const yeni = !aiEnabled;
      await adminClient.upsertSetting("ai.auto_reply_enabled", yeni);
      setAiEnabled(yeni);
      mesajGoster("basari", t(yeni ? "aiTurnedOn" : "aiTurnedOff"));
    } catch (error) {
      mesajGoster("hata", t("updateRequestFailed", { error: hataMetni(error) }));
    } finally {
      setAiKaydediliyor(false);
    }
  }

  async function handlePromptKaydet() {
    if (aiPrompt.trim().length < 10) {
      mesajGoster("hata", t("promptMinLength"));
      return;
    }
    setAiPromptKaydediliyor(true);
    try {
      await adminClient.upsertSetting("ai.system_prompt", aiPrompt.trim());
      mesajGoster("basari", t("promptSaved"));
      setAiPromptKaynak("veritabani");
    } catch (error) {
      mesajGoster("hata", t("promptSaveFailed", { error: hataMetni(error) }));
    } finally {
      setAiPromptKaydediliyor(false);
    }
  }

  async function handlePromptSifirla() {
    setAiPromptKaydediliyor(true);
    try {
      await adminClient.upsertSetting("ai.system_prompt", "");
      setAiPrompt("");
      setAiPromptKaynak("varsayilan");
      mesajGoster("basari", t("promptReset"));
    } catch (error) {
      mesajGoster("hata", t("promptResetFailed", { error: hataMetni(error) }));
    } finally {
      setAiPromptKaydediliyor(false);
    }
  }

  const sekmeler: Array<{ id: SekmeId; baslik: string; ikon: LucideIcon }> = [
    { id: "profil", baslik: t("tabProfile"), ikon: User },
    { id: "genel", baslik: t("tabGeneral"), ikon: Settings },
    ...(isAdmin
      ? [
          { id: "kullanicilar" as const, baslik: t("tabUsers"), ikon: Users },
          { id: "loglar" as const, baslik: t("tabLogs"), ikon: FileText },
          { id: "entegrasyonlar" as const, baslik: t("tabIntegrations"), ikon: Plug },
          { id: "santral" as const, baslik: t("tabPbx"), ikon: Phone },
          { id: "vapi" as const, baslik: t("tabVapi"), ikon: Bot },
          { id: "kargo-pipeline" as const, baslik: t("tabCargoPipeline"), ikon: Package },
        ]
      : []),
  ];

  return (
    <div className="ayarlar-page" data-testid="admin-flow">
      <div className="ayarlar-header">
        <h1>{t("title")}</h1>
        <p>{t("subtitle")}</p>
      </div>

      <div className="ayarlar-tabs" role="tablist" data-testid="ayarlar-tabs">
        {sekmeler.map(({ id, baslik, ikon: Ikon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={aktifSekme === id}
            className={aktifSekme === id ? "active" : ""}
            onClick={() => {
              setAktifSekme(id);
              setMesaj(null);
            }}
          >
            <Ikon size={16} />
            {baslik}
          </button>
        ))}
      </div>

      <div className="ayarlar-content">
        <MesajBanner mesaj={mesaj} />

        {aktifSekme === "profil" && (
          <div className="ayarlar-stack" data-testid="ayarlar-profil">
            <section className="ayarlar-card">
              <h3 className="ayarlar-card-title">
                <User size={20} />
                {t("profileInfo")}
              </h3>
              <form onSubmit={(event) => void handleProfilGuncelle(event)} className="ayarlar-form">
                <div className="ayarlar-grid-2">
                  <label className="ayarlar-field">
                    <span>{t("firstName")}</span>
                    <input value={profilForm.ad} onChange={(event) => setProfilForm((form) => ({ ...form, ad: event.target.value }))} />
                  </label>
                  <label className="ayarlar-field">
                    <span>{t("lastName")}</span>
                    <input
                      value={profilForm.soyad}
                      onChange={(event) => setProfilForm((form) => ({ ...form, soyad: event.target.value }))}
                    />
                  </label>
                </div>
                <div className="ayarlar-field">
                  <span>{t("emailLocked")}</span>
                  <div className="ayarlar-locked">
                    {profilForm.email}
                    <Lock size={16} />
                  </div>
                </div>
                <div className="ayarlar-field">
                  <span>{t("role")}</span>
                  <div className="ayarlar-locked ayarlar-capitalize">
                    {user.role.replace("_", " ")}
                    <Lock size={16} />
                  </div>
                </div>
                <button type="submit" className="ayarlar-secondary-btn" disabled={profilKaydediliyor}>
                  {profilKaydediliyor ? <Loader2 size={16} className="ayarlar-spin" /> : <Save size={16} />}
                  {profilKaydediliyor ? t("loading") : t("saveChanges")}
                </button>
              </form>
            </section>

            <section className="ayarlar-card">
              <h3 className="ayarlar-card-title">
                <Key size={20} />
                {t("changePassword")}
              </h3>
              <form onSubmit={(event) => void handleSifreDegistir(event)} className="ayarlar-form ayarlar-narrow">
                <label className="ayarlar-field">
                  <span>{t("newPassword")}</span>
                  <input
                    type="password"
                    value={yeniSifre}
                    onChange={(event) => setYeniSifre(event.target.value)}
                    placeholder={t("passwordPlaceholder")}
                    required
                  />
                </label>
                <label className="ayarlar-field">
                  <span>{t("newPasswordRepeat")}</span>
                  <input
                    type="password"
                    value={yeniSifreTekrar}
                    onChange={(event) => setYeniSifreTekrar(event.target.value)}
                    placeholder={t("passwordRepeatPlaceholder")}
                    required
                  />
                </label>
                <button type="submit" className="ayarlar-primary-btn ayarlar-full" disabled={sifreKaydediliyor}>
                  {sifreKaydediliyor ? <Loader2 size={16} className="ayarlar-spin" /> : null}
                  {sifreKaydediliyor ? t("updating") : t("updatePassword")}
                </button>
              </form>
            </section>
          </div>
        )}

        {aktifSekme === "genel" && (
          <div className="ayarlar-stack" data-testid="ayarlar-genel">
            <section className="ayarlar-card">
              <div className="ayarlar-row-between">
                <div className="ayarlar-row">
                  <div className="ayarlar-icon-box">
                    <Bot size={24} />
                  </div>
                  <div>
                    <h2 className="ayarlar-h2">{t("aiAutoReply")}</h2>
                    <p className="ayarlar-muted">
                      {aiEnabled ? t("aiAutoReplyOn") : t("aiAutoReplyOff")}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={t("aiAutoReply")}
                  className={`ayarlar-switch ${aiEnabled ? "on" : ""}`}
                  onClick={() => void handleToggleAI()}
                  disabled={aiKaydediliyor || aiYukleniyor}
                >
                  <span />
                </button>
              </div>
              <div className="ayarlar-row-between ayarlar-mt">
                <span className={`ayarlar-pill ${aiEnabled ? "green" : "slate"}`}>
                  <Zap size={12} />
                  {aiEnabled ? t("aiOnBadge") : t("aiOffBadge")}
                </span>
              </div>
            </section>

            {isAdmin && (
              <section className="ayarlar-card" data-testid="ayarlar-ai-prompt">
                <div className="ayarlar-row ayarlar-mb">
                  <div className="ayarlar-icon-box purple">
                    <Bot size={24} />
                  </div>
                  <div>
                    <h2 className="ayarlar-h2">{t("aiPromptTitle")}</h2>
                    <p className="ayarlar-muted">{t("aiPromptDescription")}</p>
                    {aiPromptKaynak && (
                      <span className={`ayarlar-pill small ${aiPromptKaynak === "veritabani" ? "blue" : "slate"}`}>
                        {aiPromptKaynak === "veritabani" ? t("customPrompt") : t("defaultPrompt")}
                      </span>
                    )}
                  </div>
                </div>
                {aiPromptYukleniyor ? (
                  <div className="ayarlar-loading">
                    <Loader2 size={18} className="ayarlar-spin" /> {t("loading")}
                  </div>
                ) : (
                  <>
                    <textarea
                      className="ayarlar-textarea mono"
                      value={aiPrompt}
                      onChange={(event) => setAiPrompt(event.target.value)}
                      rows={18}
                      placeholder={t("aiPromptPlaceholder")}
                    />
                    <div className="ayarlar-row-between ayarlar-mt">
                      <p className="ayarlar-small">{t("characterCount", { count: aiPrompt.length })}</p>
                      <div className="ayarlar-row">
                        <button
                          type="button"
                          className="ayarlar-outline-btn"
                          onClick={() => void handlePromptSifirla()}
                          disabled={aiPromptKaydediliyor}
                        >
                          <RefreshCw size={16} className={aiPromptKaydediliyor ? "ayarlar-spin" : ""} />
                          {t("resetToDefault")}
                        </button>
                        <button
                          type="button"
                          className="ayarlar-purple-btn"
                          onClick={() => void handlePromptKaydet()}
                          disabled={aiPromptKaydediliyor || !aiPrompt.trim()}
                        >
                          {aiPromptKaydediliyor ? <Loader2 size={16} className="ayarlar-spin" /> : <Save size={16} />}
                          {t("save")}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </section>
            )}
          </div>
        )}

        {aktifSekme === "kullanicilar" && isAdmin && <KullanicilarSekmesi http={http} currentUserPublicId={user.public_id} />}

        {aktifSekme === "loglar" && isAdmin && (
          <div className="ayarlar-stack" data-testid="ayarlar-loglar">
            <div className="ayarlar-row-between">
              <div>
                <h2 className="ayarlar-h2">{t("logsTitle")}</h2>
                <p className="ayarlar-muted">{t("logsSubtitle")}</p>
              </div>
              <button type="button" className="ayarlar-outline-btn" onClick={() => void loglariYenile()} disabled={loglarYukleniyor}>
                <RefreshCw size={16} className={loglarYukleniyor ? "ayarlar-spin" : ""} />
                {t("refresh")}
              </button>
            </div>
            <div className="ayarlar-table-card">
              {loglarYukleniyor ? (
                <div className="ayarlar-empty">{t("loading")}</div>
              ) : loglar.length === 0 ? (
                <div className="ayarlar-empty">
                  <FileText size={48} />
                  <p>{t("noLogs")}</p>
                </div>
              ) : (
                <div className="ayarlar-table-scroll">
                  <table className="ayarlar-table">
                    <thead>
                      <tr>
                        <th>{t("colDate")}</th>
                        <th>{t("colUser")}</th>
                        <th>{t("colAction")}</th>
                        <th>{t("colModule")}</th>
                        <th>{t("colDescription")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loglar.map((log) => (
                        <tr key={log.id}>
                          <td className="ayarlar-nowrap">{tarihSaatFormatla(log.created_at, language)}</td>
                          <td>{log.actor_name ?? "-"}</td>
                          <td>
                            <span className={`ayarlar-pill ${islemRenkleri[log.action] ?? "slate"}`}>{log.action}</span>
                          </td>
                          <td className="ayarlar-capitalize">{log.module}</td>
                          <td className="ayarlar-truncate">{log.entity_id ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {aktifSekme === "entegrasyonlar" && isAdmin && (
          <div className="ayarlar-stack" data-testid="ayarlar-entegrasyonlar">
            <div>
              <h2 className="ayarlar-h2">{t("integrationsTitle")}</h2>
              <p className="ayarlar-muted">{t("integrationsSubtitle")}</p>
            </div>
            <div className="ayarlar-row">
              <button
                type="button"
                className={`ayarlar-integration-tab ${entegrasyonSekme === "instagram" ? "active instagram" : ""}`}
                onClick={() => setEntegrasyonSekme("instagram")}
              >
                <Instagram size={16} />
                Instagram
              </button>
              <button
                type="button"
                className={`ayarlar-integration-tab ${entegrasyonSekme === "messenger" ? "active messenger" : ""}`}
                onClick={() => setEntegrasyonSekme("messenger")}
              >
                <MessageCircle size={16} />
                Messenger
              </button>
            </div>
            <EntegrasyonAyarlar key={entegrasyonSekme} http={http} provider={entegrasyonSekme} />
          </div>
        )}

        {aktifSekme === "santral" && isAdmin && <SantralAyarlar http={http} />}
        {aktifSekme === "vapi" && isAdmin && <VapiAyarlar http={http} />}
        {aktifSekme === "kargo-pipeline" && isAdmin && <KargoPipelineAyarlar http={http} />}
      </div>
    </div>
  );
}
