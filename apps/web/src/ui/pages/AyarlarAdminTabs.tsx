import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CheckCircle,
  Copy,
  Eye,
  EyeOff,
  Key,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Shield,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Users,
  X,
  XCircle,
} from "lucide-react";
import type { BackendHttpClient } from "../../api/http-client.js";
import { createAdminClient, type IntegrationAccount, type IntegrationAccountSnapshot } from "../../api/admin-client.js";
import { createSettingsClient, type ManagedRole, type ManagedUser } from "../../api/settings-client.js";
import { MesajBanner, hataMetni, tarihSaatFormatla, useMesaj } from "./AyarlarShared.js";
import { useLanguage, useT, type Translator } from "../i18n/index.js";
import { settingsAdminMessages, type SettingsAdminKey } from "../i18n/messages/settingsAdmin.js";
import { settingsMessagingMessages } from "../i18n/messages/settingsMessaging.js";

/** Legacy parity: pages/ayarlar/KullanicilarPage.jsx — `/admin/users` (admin-only RBAC). */

const ROL_ADLARI: Record<string, SettingsAdminKey> = {
  admin: "roleAdmin",
  owner: "roleAdmin",
  calisan: "roleEmployee",
  kargo_operatoru: "roleCargoOperator",
};

function rolAdiGetir(rol: string | undefined, t: Translator<SettingsAdminKey>) {
  if (!rol) return "-";
  const key = ROL_ADLARI[rol];
  return key ? t(key) : rol;
}

const BOSH_YENI = { email: "", ad: "", soyad: "", telefon: "", sifre: "", rol: "" as ManagedRole | "" };
const BOSH_DUZENLE = { ad: "", soyad: "", telefon: "", rol: "" as ManagedRole | "", sipKullanici: "", sipSifre: "" };

export function KullanicilarSekmesi({ http, currentUserPublicId }: { http: BackendHttpClient; currentUserPublicId: string }) {
  const client = useMemo(() => createSettingsClient(http), [http]);
  const t = useT(settingsAdminMessages);
  const ts = useT(settingsMessagingMessages);
  const { language } = useLanguage();
  const [kullanicilar, setKullanicilar] = useState<ManagedUser[]>([]);
  const [roller, setRoller] = useState<ManagedRole[]>(["admin", "calisan", "kargo_operatoru"]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const { mesaj, setMesaj, mesajGoster } = useMesaj();
  const [yeniModal, setYeniModal] = useState(false);
  const [yeniForm, setYeniForm] = useState(BOSH_YENI);
  const [yeniKaydediliyor, setYeniKaydediliyor] = useState(false);
  const [sifreGoster, setSifreGoster] = useState(false);
  const [duzenleId, setDuzenleId] = useState<string | null>(null);
  const [duzenleForm, setDuzenleForm] = useState(BOSH_DUZENLE);
  const [duzenleKaydediliyor, setDuzenleKaydediliyor] = useState(false);
  const [silOnayId, setSilOnayId] = useState<string | null>(null);
  const [siliniyor, setSiliniyor] = useState(false);

  const kullanicilariGetir = useCallback(async () => {
    setYukleniyor(true);
    try {
      const response = await client.listUsers();
      setKullanicilar(response.data);
      if (response.roles.length > 0) setRoller(response.roles);
    } catch (error) {
      mesajGoster("hata", t("usersLoadFailed", { error: hataMetni(error) }));
    } finally {
      setYukleniyor(false);
    }
  }, [client, mesajGoster, t]);

  useEffect(() => {
    void kullanicilariGetir();
  }, [kullanicilariGetir]);

  async function yeniKullaniciOlustur(event: FormEvent) {
    event.preventDefault();
    if (!yeniForm.email || !yeniForm.ad || !yeniForm.sifre) {
      mesajGoster("hata", t("newUserRequiredFields"));
      return;
    }
    if (yeniForm.sifre.length < 6) {
      mesajGoster("hata", t("passwordMinLength"));
      return;
    }
    setYeniKaydediliyor(true);
    try {
      await client.createUser({
        email: yeniForm.email,
        first_name: yeniForm.ad,
        last_name: yeniForm.soyad,
        phone: yeniForm.telefon || null,
        password: yeniForm.sifre,
        role: yeniForm.rol || "calisan",
      });
      setYeniModal(false);
      setYeniForm(BOSH_YENI);
      mesajGoster("basari", t("userCreated", { name: yeniForm.ad }));
      void kullanicilariGetir();
    } catch (error) {
      mesajGoster("hata", t("createFailed", { error: hataMetni(error) }));
    } finally {
      setYeniKaydediliyor(false);
    }
  }

  async function kullaniciGuncelle(publicId: string) {
    setDuzenleKaydediliyor(true);
    try {
      const { user } = await client.updateUser(publicId, {
        first_name: duzenleForm.ad,
        last_name: duzenleForm.soyad,
        phone: duzenleForm.telefon || null,
        ...(duzenleForm.rol ? { role: duzenleForm.rol } : {}),
        sip_username: duzenleForm.sipKullanici.trim() || null,
        // A blank SIP password keeps the stored (encrypted) one.
        ...(duzenleForm.sipSifre ? { sip_password: duzenleForm.sipSifre } : {}),
      });
      setKullanicilar((prev) => prev.map((item) => (item.public_id === publicId ? user : item)));
      setDuzenleId(null);
      mesajGoster("basari", t("userUpdated"));
    } catch (error) {
      mesajGoster("hata", t("updateFailed", { error: hataMetni(error) }));
    } finally {
      setDuzenleKaydediliyor(false);
    }
  }

  async function aktifToggle(kullanici: ManagedUser) {
    const yeniAktif = !kullanici.is_active;
    setKullanicilar((prev) => prev.map((item) => (item.public_id === kullanici.public_id ? { ...item, is_active: yeniAktif } : item)));
    try {
      await client.updateUser(kullanici.public_id, { is_active: yeniAktif });
    } catch (error) {
      setKullanicilar((prev) =>
        prev.map((item) => (item.public_id === kullanici.public_id ? { ...item, is_active: kullanici.is_active } : item)),
      );
      mesajGoster("hata", t("statusUpdateFailed", { error: hataMetni(error) }));
    }
  }

  async function kullaniciSil(publicId: string) {
    setSiliniyor(true);
    try {
      await client.deactivateUser(publicId);
      setKullanicilar((prev) => prev.filter((item) => item.public_id !== publicId));
      setSilOnayId(null);
      mesajGoster("basari", t("userDeleted"));
    } catch (error) {
      mesajGoster("hata", t("deleteFailed", { error: hataMetni(error) }));
    } finally {
      setSiliniyor(false);
    }
  }

  function duzenleBaslat(kullanici: ManagedUser) {
    setDuzenleId(kullanici.public_id);
    setDuzenleForm({
      ad: kullanici.first_name,
      soyad: kullanici.last_name,
      telefon: kullanici.phone ?? "",
      rol: (roller.includes(kullanici.role as ManagedRole) ? kullanici.role : "") as ManagedRole | "",
      sipKullanici: kullanici.sip_username ?? "",
      sipSifre: "",
    });
  }

  return (
    <div className="ayarlar-stack" data-testid="ayarlar-kullanicilar">
      <div className="ayarlar-row-between">
        <div className="ayarlar-row">
          <Users size={20} className="ayarlar-primary-text" />
          <div>
            <h2 className="ayarlar-h2">{t("userManagement")}</h2>
            <p className="ayarlar-muted">{t("userManagementSubtitle")}</p>
          </div>
        </div>
        <button
          type="button"
          className="ayarlar-primary-btn"
          onClick={() => {
            setYeniModal(true);
            setMesaj(null);
          }}
        >
          <Plus size={16} />
          {t("newUser")}
        </button>
      </div>

      <MesajBanner mesaj={mesaj} />

      <div className="ayarlar-table-card">
        {yukleniyor ? (
          <div className="ayarlar-empty">{t("loading")}</div>
        ) : kullanicilar.length === 0 ? (
          <div className="ayarlar-empty">
            <Users size={40} />
            <p>{t("noUsers")}</p>
          </div>
        ) : (
          <div className="ayarlar-table-scroll">
            <table className="ayarlar-table">
              <thead>
                <tr>
                  <th>{t("colUser")}</th>
                  <th>{t("colRole")}</th>
                  <th>{ts("sipColumn")}</th>
                  <th>{t("colStatus")}</th>
                  <th>{t("colLastLogin")}</th>
                  <th className="right">{t("colAction")}</th>
                </tr>
              </thead>
              <tbody>
                {kullanicilar.map((kullanici) => (
                  <tr key={kullanici.public_id} data-testid={`kullanici-${kullanici.public_id}`}>
                    <td>
                      {duzenleId === kullanici.public_id ? (
                        <div className="ayarlar-inline-edit">
                          <input placeholder={t("firstName")} value={duzenleForm.ad} onChange={(e) => setDuzenleForm((f) => ({ ...f, ad: e.target.value }))} />
                          <input
                            placeholder={t("lastName")}
                            value={duzenleForm.soyad}
                            onChange={(e) => setDuzenleForm((f) => ({ ...f, soyad: e.target.value }))}
                          />
                          <input
                            placeholder={t("phone")}
                            value={duzenleForm.telefon}
                            onChange={(e) => setDuzenleForm((f) => ({ ...f, telefon: e.target.value }))}
                          />
                          <input
                            placeholder={ts("sipUsername")}
                            aria-label={ts("sipUsername")}
                            name="sip_username"
                            value={duzenleForm.sipKullanici}
                            onChange={(e) => setDuzenleForm((f) => ({ ...f, sipKullanici: e.target.value }))}
                          />
                          <input
                            type="password"
                            autoComplete="new-password"
                            placeholder={kullanici.sip_password_configured ? ts("sipPasswordPlaceholder") : ts("sipPassword")}
                            aria-label={ts("sipPassword")}
                            name="sip_password"
                            value={duzenleForm.sipSifre}
                            onChange={(e) => setDuzenleForm((f) => ({ ...f, sipSifre: e.target.value }))}
                          />
                          <select
                            aria-label={t("role")}
                            value={duzenleForm.rol}
                            onChange={(e) => setDuzenleForm((f) => ({ ...f, rol: e.target.value as ManagedRole | "" }))}
                          >
                            <option value="">{t("selectRoleShort")}</option>
                            {roller.map((rol) => (
                              <option key={rol} value={rol}>
                                {rolAdiGetir(rol, t)}
                              </option>
                            ))}
                          </select>
                          <div className="ayarlar-row">
                            <button
                              type="button"
                              className="ayarlar-primary-btn small"
                              onClick={() => void kullaniciGuncelle(kullanici.public_id)}
                              disabled={duzenleKaydediliyor}
                            >
                              {duzenleKaydediliyor ? "..." : t("save")}
                            </button>
                            <button type="button" className="ayarlar-outline-btn small" aria-label={t("cancel")} onClick={() => setDuzenleId(null)}>
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="ayarlar-row">
                          <div className="ayarlar-avatar">
                            {kullanici.first_name.charAt(0).toUpperCase()}
                            {kullanici.last_name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="ayarlar-strong">
                              {kullanici.first_name} {kullanici.last_name}
                            </p>
                            <p className="ayarlar-small">{kullanici.email}</p>
                            {kullanici.phone && <p className="ayarlar-small">{kullanici.phone}</p>}
                          </div>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`ayarlar-pill ${kullanici.role === "admin" || kullanici.role === "owner" ? "purple" : "blue"}`}>
                        <Shield size={12} />
                        {rolAdiGetir(kullanici.role, t)}
                      </span>
                    </td>
                    <td data-testid="kullanici-sip">
                      {kullanici.sip_username ? (
                        <>
                          <p className="ayarlar-strong">{kullanici.sip_username}</p>
                          <p className="ayarlar-small">{kullanici.sip_password_configured ? ts("sipPasswordSet") : ts("sipPasswordMissing")}</p>
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="ayarlar-link-btn"
                        onClick={() => void aktifToggle(kullanici)}
                        title={kullanici.is_active ? t("deactivate") : t("activate")}
                        disabled={kullanici.public_id === currentUserPublicId}
                      >
                        {kullanici.is_active ? <ToggleRight size={20} className="ayarlar-green" /> : <ToggleLeft size={20} />}
                        <span className={kullanici.is_active ? "ayarlar-green" : "ayarlar-muted"}>{kullanici.is_active ? t("active") : t("inactive")}</span>
                      </button>
                    </td>
                    <td className="ayarlar-nowrap">{kullanici.last_seen_at ? tarihSaatFormatla(kullanici.last_seen_at, language) : "-"}</td>
                    <td className="right">
                      {duzenleId !== kullanici.public_id && (
                        <div className="ayarlar-row ayarlar-justify-end">
                          <button type="button" className="ayarlar-outline-btn small" onClick={() => duzenleBaslat(kullanici)}>
                            <Pencil size={14} />
                            {t("edit")}
                          </button>
                          {silOnayId === kullanici.public_id ? (
                            <div className="ayarlar-row">
                              <span className="ayarlar-red small">{t("confirmDelete")}</span>
                              <button
                                type="button"
                                className="ayarlar-danger-btn small"
                                onClick={() => void kullaniciSil(kullanici.public_id)}
                                disabled={siliniyor}
                              >
                                {siliniyor ? "..." : t("yes")}
                              </button>
                              <button type="button" className="ayarlar-outline-btn small" onClick={() => setSilOnayId(null)}>
                                {t("no")}
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="ayarlar-danger-outline-btn small"
                              onClick={() => setSilOnayId(kullanici.public_id)}
                              disabled={kullanici.public_id === currentUserPublicId}
                            >
                              <Trash2 size={14} />
                              {t("delete")}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {yeniModal && (
        <div className="ayarlar-overlay" role="dialog" aria-modal="true" aria-label={t("newUser")}>
          <form className="ayarlar-modal" onSubmit={(event) => void yeniKullaniciOlustur(event)}>
            <div className="ayarlar-row-between">
              <h3 className="ayarlar-h2">{t("newUser")}</h3>
              <button type="button" className="ayarlar-icon-btn" aria-label={t("close")} onClick={() => setYeniModal(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="ayarlar-grid-2">
              <label className="ayarlar-field">
                <span>{t("firstNameRequired")}</span>
                <input value={yeniForm.ad} onChange={(e) => setYeniForm((f) => ({ ...f, ad: e.target.value }))} />
              </label>
              <label className="ayarlar-field">
                <span>{t("lastName")}</span>
                <input value={yeniForm.soyad} onChange={(e) => setYeniForm((f) => ({ ...f, soyad: e.target.value }))} />
              </label>
            </div>
            <label className="ayarlar-field">
              <span>{t("emailRequired")}</span>
              <input type="email" value={yeniForm.email} onChange={(e) => setYeniForm((f) => ({ ...f, email: e.target.value }))} />
            </label>
            <label className="ayarlar-field">
              <span>{t("phone")}</span>
              <input
                value={yeniForm.telefon}
                placeholder="05xx xxx xx xx"
                onChange={(e) => setYeniForm((f) => ({ ...f, telefon: e.target.value }))}
              />
            </label>
            <label className="ayarlar-field">
              <span>{t("passwordRequired")}</span>
              <div className="ayarlar-password">
                <input
                  type={sifreGoster ? "text" : "password"}
                  value={yeniForm.sifre}
                  placeholder={t("passwordPlaceholder")}
                  onChange={(e) => setYeniForm((f) => ({ ...f, sifre: e.target.value }))}
                />
                <button type="button" className="ayarlar-icon-btn" aria-label={t("showPassword")} onClick={() => setSifreGoster((v) => !v)}>
                  {sifreGoster ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
            <label className="ayarlar-field">
              <span>{t("role")}</span>
              <select value={yeniForm.rol} onChange={(e) => setYeniForm((f) => ({ ...f, rol: e.target.value as ManagedRole | "" }))}>
                <option value="">{t("selectRole")}</option>
                {roller.map((rol) => (
                  <option key={rol} value={rol}>
                    {rolAdiGetir(rol, t)}
                  </option>
                ))}
              </select>
            </label>
            <div className="ayarlar-row ayarlar-justify-end">
              <button type="button" className="ayarlar-outline-btn" onClick={() => setYeniModal(false)}>
                {t("cancelButton")}
              </button>
              <button type="submit" className="ayarlar-primary-btn" disabled={yeniKaydediliyor}>
                {yeniKaydediliyor ? <Loader2 size={16} className="ayarlar-spin" /> : <Plus size={16} />}
                {t("create")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

/**
 * Legacy parity (reduced): pages/ayarlar/InstagramAyarlar.jsx + MessengerAyarlar.jsx.
 * Token/config backend integration accounts üzerinden kaydedilir; tokenlar her zaman maskeli döner.
 */
const ENTEGRASYON_METIN = {
  instagram: { baslik: "instagramTitle", alt: "instagramSubtitle", aktif: "instagramActive", pasif: "instagramInactive" },
  messenger: { baslik: "messengerTitle", alt: "messengerSubtitle", aktif: "messengerActive", pasif: "messengerInactive" },
} as const satisfies Record<string, Record<string, SettingsAdminKey>>;

export function EntegrasyonAyarlar({ http, provider }: { http: BackendHttpClient; provider: "instagram" | "messenger" }) {
  const adminClient = useMemo(() => createAdminClient(http), [http]);
  const metin = ENTEGRASYON_METIN[provider];
  const t = useT(settingsAdminMessages);
  const [hesap, setHesap] = useState<IntegrationAccount | null>(null);
  const [snapshot, setSnapshot] = useState<IntegrationAccountSnapshot | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [form, setForm] = useState({ pageAccessToken: "", pageId: "", verifyToken: "" });
  const { mesaj, mesajGoster } = useMesaj();
  const callbackUrl = `${window.location.origin}/webhooks/${provider}`;

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try {
      const { data } = await adminClient.listIntegrationAccounts();
      const account = data.find((item) => item.provider_key === provider) ?? null;
      setHesap(account);
      if (account) {
        const detail = await adminClient.getIntegrationAccount(account.public_id);
        setSnapshot(detail);
        setForm((current) => ({ ...current, pageId: account.external_account_id ?? "" }));
      } else {
        setSnapshot(null);
      }
    } catch (error) {
      mesajGoster("hata", hataMetni(error));
    } finally {
      setYukleniyor(false);
    }
  }, [adminClient, provider, mesajGoster]);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  const tokenTanimli = Boolean(snapshot?.tokens.some((token) => token.token_type === "access_token"));
  const verifyTokenTanimli = Boolean(snapshot?.settings.some((setting) => setting.key === "webhook.verify_token"));

  async function kaydet(event: FormEvent) {
    event.preventDefault();
    if (!form.pageId.trim()) {
      mesajGoster("hata", t("pageIdRequired"));
      return;
    }
    setKaydediliyor(true);
    try {
      const account = await adminClient.upsertIntegrationAccount({
        provider_key: provider,
        display_name: hesap?.display_name ?? (provider === "instagram" ? "Instagram" : "Messenger"),
        external_account_id: form.pageId.trim(),
      });
      if (form.pageAccessToken.trim()) {
        await adminClient.upsertIntegrationToken(account.public_id, "access_token", form.pageAccessToken.trim());
      }
      if (form.verifyToken.trim()) {
        await adminClient.upsertIntegrationSetting(account.public_id, "webhook.verify_token", form.verifyToken.trim(), true);
      }
      setForm((current) => ({ ...current, pageAccessToken: "", verifyToken: "" }));
      mesajGoster("basari", t("tokensSaved"));
      await yukle();
    } catch (error) {
      mesajGoster("hata", t("saveFailed", { error: hataMetni(error) }));
    } finally {
      setKaydediliyor(false);
    }
  }

  async function kopyala(deger: string, basari: string) {
    try {
      await navigator.clipboard.writeText(deger);
      mesajGoster("basari", basari);
    } catch {
      mesajGoster("hata", t("copyFailed"));
    }
  }

  return (
    <div className="ayarlar-stack" data-testid={`ayarlar-${provider}`}>
      <section className="ayarlar-card">
        <div className="ayarlar-row-between">
          <div>
            <h3 className="ayarlar-h2">{t(metin.baslik)}</h3>
            <p className="ayarlar-muted">{t(metin.alt)}</p>
          </div>
          <button type="button" className="ayarlar-outline-btn" onClick={() => void yukle()} disabled={yukleniyor}>
            <RefreshCw size={16} className={yukleniyor ? "ayarlar-spin" : ""} />
            {t("refresh")}
          </button>
        </div>
        <MesajBanner mesaj={mesaj} />
        <h4 className="ayarlar-h4">{t("connectionStatus")}</h4>
        <div className="ayarlar-status-grid">
          <span className={`ayarlar-pill ${tokenTanimli ? "green" : "red"}`}>
            {tokenTanimli ? <CheckCircle size={12} /> : <XCircle size={12} />}
            {tokenTanimli ? t("tokenConfigured") : t("tokenMissing")}
          </span>
          <span className={`ayarlar-pill ${hesap?.external_account_id ? "green" : "red"}`}>
            {hesap?.external_account_id ? t("pageIdValue", { id: hesap.external_account_id }) : t("pageIdMissing")}
          </span>
          <span className={`ayarlar-pill ${hesap?.status === "active" ? "green" : "slate"}`}>
            {hesap?.status === "active" ? t(metin.aktif) : t(metin.pasif)}
          </span>
        </div>
        {snapshot && (
          <p className="ayarlar-small" data-testid={`ayarlar-${provider}-token-mask`}>
            {t("tokenMasked", { mask: tokenTanimli ? "••••••••" : "-" })}
          </p>
        )}
      </section>

      <form className="ayarlar-card ayarlar-form" onSubmit={(event) => void kaydet(event)}>
        <h4 className="ayarlar-h4">
          <Key size={16} /> {t("manualConfig")}
        </h4>
        <label className="ayarlar-field">
          <span>Page Access Token</span>
          <input
            type="password"
            autoComplete="off"
            value={form.pageAccessToken}
            placeholder={tokenTanimli ? t("tokenReplacePlaceholder") : ""}
            onChange={(e) => setForm((f) => ({ ...f, pageAccessToken: e.target.value }))}
          />
        </label>
        <label className="ayarlar-field">
          <span>Facebook Page ID</span>
          <input value={form.pageId} onChange={(e) => setForm((f) => ({ ...f, pageId: e.target.value }))} />
        </label>
        <button type="submit" className="ayarlar-primary-btn" disabled={kaydediliyor}>
          {kaydediliyor ? <Loader2 size={16} className="ayarlar-spin" /> : <Save size={16} />}
          {kaydediliyor ? t("saving") : t("saveTokens")}
        </button>
      </form>

      <form className="ayarlar-card ayarlar-form" onSubmit={(event) => void kaydet(event)}>
        <h4 className="ayarlar-h4">{t("webhookSettings")}</h4>
        <div className="ayarlar-field">
          <span>Callback URL</span>
          <div className="ayarlar-copy-row">
            <code data-testid={`ayarlar-${provider}-callback`}>{callbackUrl}</code>
            <button type="button" className="ayarlar-outline-btn small" onClick={() => void kopyala(callbackUrl, t("urlCopied"))}>
              <Copy size={14} />
              {t("copy")}
            </button>
          </div>
        </div>
        <label className="ayarlar-field">
          <span>Verify Token</span>
          <input
            type="password"
            autoComplete="off"
            value={form.verifyToken}
            placeholder={verifyTokenTanimli ? t("configuredPlaceholder") : ""}
            onChange={(e) => setForm((f) => ({ ...f, verifyToken: e.target.value }))}
          />
        </label>
        <button type="submit" className="ayarlar-primary-btn" disabled={kaydediliyor}>
          <Save size={16} />
          {t("save")}
        </button>
      </form>
    </div>
  );
}
