import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  Clock,
  Globe,
  Key,
  Loader2,
  Package,
  Phone,
  RefreshCw,
  Save,
  Server,
  ToggleLeft,
  ToggleRight,
  Users,
  Volume2,
  Wallet,
} from "lucide-react";
import type { BackendHttpClient } from "../../api/http-client.js";
import { createAdminClient, type AdminSetting } from "../../api/admin-client.js";
import { createSettingsClient, type ManagedUser, type NetgsmBalance } from "../../api/settings-client.js";
import { MesajBanner, hataMetni, tarihSaatFormatla, useMesaj } from "./AyarlarShared.js";
import { localeFor, useLanguage, useT } from "../i18n/index.js";
import { settingsProvidersMessages, type SettingsProvidersKey } from "../i18n/messages/settingsProviders.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function useGlobalSettings(http: BackendHttpClient) {
  const adminClient = useMemo(() => createAdminClient(http), [http]);
  const [settings, setSettings] = useState<AdminSetting[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const yukle = useCallback(async () => {
    setYukleniyor(true);
    try {
      const { data } = await adminClient.listSettings();
      setSettings(data);
      return data;
    } catch {
      setSettings([]);
      return [] as AdminSetting[];
    } finally {
      setYukleniyor(false);
    }
  }, [adminClient]);
  const kaydet = useCallback(
    async (key: string, value: unknown) => {
      const saved = await adminClient.upsertSetting(key, value);
      setSettings((current) => [saved, ...current.filter((item) => item.key !== key)]);
      return saved;
    },
    [adminClient],
  );
  return { settings, yukleniyor, yukle, kaydet };
}

function settingValue(settings: AdminSetting[], key: string) {
  return settings.find((setting) => setting.key === key)?.value;
}

function secretConfigured(settings: AdminSetting[], key: string) {
  return settings.some((setting) => setting.key === key && setting.is_secret);
}

function Toggle({ aktif, onClick, label }: { aktif: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" className="ayarlar-toggle-btn" aria-label={label} aria-pressed={aktif} onClick={onClick}>
      {aktif ? <ToggleRight size={32} className="ayarlar-green" /> : <ToggleLeft size={32} />}
    </button>
  );
}

// ─── Santral / Softphone + NetGSM ────────────────────────────────────────────

const NETGSM_VARSAYILAN = { aktif: false, ilk_arama_dakika: 5, max_deneme: 3, deneme_arasi_dakika: 10 };

/**
 * Legacy parity: pages/ayarlar/SantralAyarlar.jsx + NetgsmAyarlar.jsx.
 * SIP sunucu ayarı `sip_config`, teyit arayan numara `netgsm.teyit_voice_*` (şifre secret),
 * otomatik teyit `netgsm_teyit_ayarlar`; kullanıcı SIP bilgisi `/admin/users` (admin-only yazma).
 * NetGSM bakiyesi yalnızca backend dry-run sınırından okunur; tarayıcı NetGSM'e gitmez.
 */
export function SantralAyarlar({ http }: { http: BackendHttpClient }) {
  const settingsClient = useMemo(() => createSettingsClient(http), [http]);
  const { settings, yukleniyor, yukle, kaydet } = useGlobalSettings(http);
  const t = useT(settingsProvidersMessages);
  const { language } = useLanguage();
  const { mesaj, mesajGoster } = useMesaj();
  const [config, setConfig] = useState({ ws_url: "", domain: "", stun: "stun:stun.l.google.com:19302" });
  const [configKaydediliyor, setConfigKaydediliyor] = useState(false);
  const [teyitVoice, setTeyitVoice] = useState({ teyit_voice_usercode: "", teyit_voice_password: "" });
  const [teyitKaydediliyor, setTeyitKaydediliyor] = useState(false);
  const [netgsm, setNetgsm] = useState(NETGSM_VARSAYILAN);
  const [netgsmKaydediliyor, setNetgsmKaydediliyor] = useState(false);
  const [bakiye, setBakiye] = useState<NetgsmBalance | null>(null);
  const [bakiyeYukleniyor, setBakiyeYukleniyor] = useState(false);
  const [kullanicilar, setKullanicilar] = useState<ManagedUser[]>([]);
  const [sipDuzenle, setSipDuzenle] = useState<Record<string, { sip_username: string; sip_password: string }>>({});
  const [sipKaydediliyor, setSipKaydediliyor] = useState<string | null>(null);

  const bakiyeSorgula = useCallback(async () => {
    setBakiyeYukleniyor(true);
    try {
      setBakiye(await settingsClient.getNetgsmBalance());
    } catch (error) {
      mesajGoster("hata", t("balanceFetchFailed", { error: hataMetni(error) }));
    } finally {
      setBakiyeYukleniyor(false);
    }
  }, [settingsClient, mesajGoster, t]);

  const kullanicilariYukle = useCallback(async () => {
    try {
      const { data } = await settingsClient.listUsers();
      setKullanicilar(data.filter((user) => user.is_active));
    } catch {
      setKullanicilar([]);
    }
  }, [settingsClient]);

  useEffect(() => {
    void yukle().then((data) => {
      const sip = settingValue(data, "sip_config");
      if (isRecord(sip)) {
        setConfig((current) => ({
          ws_url: typeof sip.ws_url === "string" ? sip.ws_url : current.ws_url,
          domain: typeof sip.domain === "string" ? sip.domain : current.domain,
          stun: typeof sip.stun === "string" ? sip.stun : current.stun,
        }));
      }
      const usercode = settingValue(data, "netgsm.teyit_voice_usercode");
      setTeyitVoice({ teyit_voice_usercode: typeof usercode === "string" ? usercode : "", teyit_voice_password: "" });
      const teyit = settingValue(data, "netgsm_teyit_ayarlar");
      if (isRecord(teyit)) setNetgsm({ ...NETGSM_VARSAYILAN, ...(teyit as Partial<typeof NETGSM_VARSAYILAN>) });
    });
    void kullanicilariYukle();
    void bakiyeSorgula();
  }, [yukle, kullanicilariYukle, bakiyeSorgula]);

  async function configKaydet() {
    setConfigKaydediliyor(true);
    try {
      await kaydet("sip_config", config);
      mesajGoster("basari", t("pbxSettingsSaved"));
    } catch (error) {
      mesajGoster("hata", t("saveFailed", { error: hataMetni(error) }));
    } finally {
      setConfigKaydediliyor(false);
    }
  }

  async function teyitKaydet() {
    setTeyitKaydediliyor(true);
    try {
      await kaydet("netgsm.teyit_voice_usercode", teyitVoice.teyit_voice_usercode.trim());
      if (teyitVoice.teyit_voice_password.trim()) {
        await kaydet("netgsm.teyit_voice_password", teyitVoice.teyit_voice_password.trim());
      }
      setTeyitVoice((current) => ({ ...current, teyit_voice_password: "" }));
      mesajGoster("basari", t("callerIdSaved"));
    } catch (error) {
      mesajGoster("hata", t("saveFailed", { error: hataMetni(error) }));
    } finally {
      setTeyitKaydediliyor(false);
    }
  }

  async function netgsmKaydet() {
    setNetgsmKaydediliyor(true);
    try {
      await kaydet("netgsm_teyit_ayarlar", netgsm);
      mesajGoster("basari", t("settingsSaved"));
    } catch (error) {
      mesajGoster("hata", t("saveFailed", { error: hataMetni(error) }));
    } finally {
      setNetgsmKaydediliyor(false);
    }
  }

  async function sipKaydet(user: ManagedUser) {
    const form = sipDuzenle[user.public_id];
    if (!form) return;
    setSipKaydediliyor(user.public_id);
    try {
      const { user: updated } = await settingsClient.updateUser(user.public_id, {
        sip_username: form.sip_username.trim() || null,
        ...(form.sip_password.trim() ? { sip_password: form.sip_password.trim() } : {}),
      });
      setKullanicilar((current) => current.map((item) => (item.public_id === updated.public_id ? updated : item)));
      setSipDuzenle((current) => {
        const next = { ...current };
        delete next[user.public_id];
        return next;
      });
      mesajGoster("basari", t("sipSaved", { name: user.first_name }));
    } catch (error) {
      mesajGoster("hata", t("saveFailed", { error: hataMetni(error) }));
    } finally {
      setSipKaydediliyor(null);
    }
  }

  const setN = (alan: keyof typeof NETGSM_VARSAYILAN, deger: number | boolean) => setNetgsm((prev) => ({ ...prev, [alan]: deger }));
  const sayi = (value: string, max: number) => Math.min(max, Math.max(1, Number.parseInt(value, 10) || 1));

  return (
    <div className="ayarlar-stack" data-testid="ayarlar-santral">
      <div className="ayarlar-row">
        <div className="ayarlar-icon-box green">
          <Phone size={20} />
        </div>
        <div>
          <h3 className="ayarlar-h2">{t("pbxTitle")}</h3>
          <p className="ayarlar-small">{t("pbxSubtitle")}</p>
        </div>
      </div>
      <MesajBanner mesaj={mesaj} />

      <section className="ayarlar-card ayarlar-form">
        <div className="ayarlar-row-between">
          <h4 className="ayarlar-h4">
            <Server size={16} /> {t("serverInfo")}
          </h4>
          <button type="button" className="ayarlar-icon-btn" title={t("refresh")} onClick={() => void yukle()} disabled={yukleniyor}>
            <RefreshCw size={16} className={yukleniyor ? "ayarlar-spin" : ""} />
          </button>
        </div>
        <label className="ayarlar-field">
          <span>
            <Globe size={12} /> WebSocket URL (wss://)
          </span>
          <input value={config.ws_url} placeholder="wss://sip.netgsm.com.tr:8089/ws" onChange={(e) => setConfig({ ...config, ws_url: e.target.value })} />
          <small>{t("wsUrlHint")}</small>
        </label>
        <label className="ayarlar-field">
          <span>
            <Server size={12} /> Domain
          </span>
          <input value={config.domain} placeholder="sip.netgsm.com.tr" onChange={(e) => setConfig({ ...config, domain: e.target.value })} />
          <small>{t("domainHint")}</small>
        </label>
        <label className="ayarlar-field">
          <span>{t("stunServer")}</span>
          <input value={config.stun} placeholder="stun:stun.l.google.com:19302" onChange={(e) => setConfig({ ...config, stun: e.target.value })} />
        </label>
        <div>
          <button type="button" className="ayarlar-primary-btn" onClick={() => void configKaydet()} disabled={configKaydediliyor}>
            {configKaydediliyor ? <Loader2 size={16} className="ayarlar-spin" /> : <Save size={16} />}
            {t("save")}
          </button>
        </div>
      </section>

      <section className="ayarlar-card ayarlar-form" data-testid="ayarlar-teyit-voice">
        <h4 className="ayarlar-h4">
          <Phone size={16} /> {t("callerIdTitle")}
        </h4>
        <p className="ayarlar-small">
          {t("callerIdDescriptionBefore")}
          <code>NETGSM_VOICE_*</code>
          {t("callerIdDescriptionAfter")}
        </p>
        <div className="ayarlar-grid-2">
          <label className="ayarlar-field">
            <span>
              <Key size={12} /> {t("callerIdLabel")}
            </span>
            <input
              value={teyitVoice.teyit_voice_usercode}
              placeholder={t("examplePrefix", { value: "3229110370" })}
              onChange={(e) => setTeyitVoice({ ...teyitVoice, teyit_voice_usercode: e.target.value })}
            />
            <small>{t("callerIdHint")}</small>
          </label>
          <label className="ayarlar-field">
            <span>
              <Key size={12} /> {t("password")}
            </span>
            <input
              type="password"
              autoComplete="off"
              value={teyitVoice.teyit_voice_password}
              placeholder={secretConfigured(settings, "netgsm.teyit_voice_password") ? t("secretConfiguredPlaceholder") : "••••••"}
              onChange={(e) => setTeyitVoice({ ...teyitVoice, teyit_voice_password: e.target.value })}
            />
          </label>
        </div>
        <div>
          <button type="button" className="ayarlar-primary-btn" onClick={() => void teyitKaydet()} disabled={teyitKaydediliyor}>
            {teyitKaydediliyor ? <Loader2 size={16} className="ayarlar-spin" /> : <Save size={16} />}
            {t("save")}
          </button>
        </div>
      </section>

      <section className="ayarlar-card ayarlar-form" data-testid="ayarlar-netgsm-teyit">
        <div className="ayarlar-row">
          <div className="ayarlar-icon-box green">
            <Phone size={20} />
          </div>
          <div>
            <h3 className="ayarlar-h3">{t("autoConfirmTitle")}</h3>
            <p className="ayarlar-muted">{t("autoConfirmSubtitle")}</p>
          </div>
        </div>
        <div className="ayarlar-toggle-row">
          <div>
            <p className="ayarlar-strong">{t("autoCallActive")}</p>
            <p className="ayarlar-muted">{t("autoCallActiveHint")}</p>
          </div>
          <Toggle aktif={netgsm.aktif} label={t("autoCallActive")} onClick={() => setN("aktif", !netgsm.aktif)} />
        </div>
        <div className="ayarlar-grid-3">
          <label className="ayarlar-field">
            <span>{t("firstCallDelay")}</span>
            <input type="number" min={1} max={60} value={netgsm.ilk_arama_dakika} onChange={(e) => setN("ilk_arama_dakika", sayi(e.target.value, 60))} />
            <small>{t("firstCallDelayHint")}</small>
          </label>
          <label className="ayarlar-field">
            <span>{t("maxAttempts")}</span>
            <input type="number" min={1} max={10} value={netgsm.max_deneme} onChange={(e) => setN("max_deneme", sayi(e.target.value, 10))} />
            <small>{t("maxAttemptsHint")}</small>
          </label>
          <label className="ayarlar-field">
            <span>{t("retryInterval")}</span>
            <input
              type="number"
              min={1}
              max={120}
              value={netgsm.deneme_arasi_dakika}
              onChange={(e) => setN("deneme_arasi_dakika", sayi(e.target.value, 120))}
            />
            <small>{t("retryIntervalHint")}</small>
          </label>
        </div>
        {netgsm.aktif && (
          <div className="ayarlar-info green">
            {t("summaryPart1")}
            <strong>{t("summaryMinutes", { count: netgsm.ilk_arama_dakika })}</strong>
            {t("summaryPart2")}{" "}
            <strong>{t("summaryMinutes", { count: netgsm.deneme_arasi_dakika })}</strong>
            {t("summaryPart3")}
            <strong>{t("summaryTimes", { count: netgsm.max_deneme })}</strong>
            {t("summaryPart4")}
          </div>
        )}
        <div>
          <button type="button" className="ayarlar-primary-btn" onClick={() => void netgsmKaydet()} disabled={netgsmKaydediliyor}>
            {netgsmKaydediliyor ? <Loader2 size={16} className="ayarlar-spin" /> : <Save size={16} />}
            {t("save")}
          </button>
        </div>
      </section>

      <section className="ayarlar-card" data-testid="ayarlar-netgsm-bakiye">
        <div className="ayarlar-row-between">
          <h4 className="ayarlar-h4">
            <Wallet size={16} /> {t("netgsmBalance")}
          </h4>
          <button type="button" className="ayarlar-icon-btn" title={t("refresh")} onClick={() => void bakiyeSorgula()} disabled={bakiyeYukleniyor}>
            <RefreshCw size={16} className={bakiyeYukleniyor ? "ayarlar-spin" : ""} />
          </button>
        </div>
        {bakiye ? (
          <div className="ayarlar-balance">
            <p className="ayarlar-balance-value">
              {bakiye.balance === null ? "-" : `${bakiye.balance.toLocaleString(localeFor(language), { minimumFractionDigits: 2 })} ${bakiye.currency}`}
            </p>
            <p className="ayarlar-small">
              {bakiye.live_call_permitted
                ? t("lastChecked", { date: tarihSaatFormatla(bakiye.checked_at, language) })
                : t("liveQueryDisabled", { gate: bakiye.live_gate })}
            </p>
          </div>
        ) : (
          <p className="ayarlar-small">{bakiyeYukleniyor ? t("loading") : "-"}</p>
        )}
      </section>

      <section className="ayarlar-card ayarlar-form" data-testid="ayarlar-sip-kullanicilar">
        <h4 className="ayarlar-h4">
          <Users size={16} /> {t("userSipAccounts")}
        </h4>
        {kullanicilar.length === 0 ? (
          <div className="ayarlar-small">{t("noActiveUsers")}</div>
        ) : (
          kullanicilar.map((user) => {
            const form = sipDuzenle[user.public_id];
            return (
              <div key={user.public_id} className="ayarlar-sip-row" data-testid={`sip-${user.public_id}`}>
                <div>
                  <p className="ayarlar-strong">
                    {user.first_name} {user.last_name}
                  </p>
                  <p className="ayarlar-small">{user.email}</p>
                </div>
                {form ? (
                  <div className="ayarlar-row ayarlar-wrap">
                    <label className="ayarlar-field compact">
                      <span>{t("sipUsername")}</span>
                      <input
                        value={form.sip_username}
                        placeholder={t("examplePrefix", { value: "3229110532" })}
                        onChange={(e) => setSipDuzenle((c) => ({ ...c, [user.public_id]: { ...form, sip_username: e.target.value } }))}
                      />
                    </label>
                    <label className="ayarlar-field compact">
                      <span>{t("sipPassword")}</span>
                      <input
                        type="password"
                        autoComplete="off"
                        value={form.sip_password}
                        placeholder="••••••"
                        onChange={(e) => setSipDuzenle((c) => ({ ...c, [user.public_id]: { ...form, sip_password: e.target.value } }))}
                      />
                    </label>
                    <button type="button" className="ayarlar-primary-btn small" onClick={() => void sipKaydet(user)} disabled={sipKaydediliyor === user.public_id}>
                      {sipKaydediliyor === user.public_id ? "..." : t("save")}
                    </button>
                  </div>
                ) : (
                  <div className="ayarlar-row ayarlar-wrap">
                    <span className="ayarlar-small">
                      <span className="ayarlar-muted">{t("userPrefix")}</span>
                      {user.sip_username ?? "-"}
                    </span>
                    <span className="ayarlar-small">
                      <span className="ayarlar-muted">{t("passwordPrefix")}</span>
                      {user.sip_password_configured ? "••••••" : "-"}
                    </span>
                    <button
                      type="button"
                      className="ayarlar-outline-btn small"
                      onClick={() => setSipDuzenle((c) => ({ ...c, [user.public_id]: { sip_username: user.sip_username ?? "", sip_password: "" } }))}
                    >
                      {t("edit")}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

// ─── VAPI ───────────────────────────────────────────────────────────────────

const VAPI_VARSAYILAN_PROMPT = `Sen Garanti Kuluçka firmasının müşteri temsilcisisin. Sadece müşteriye kargosu hakkında bilgi vermek için aradın.
Karşındaki kişinin adı: {musteri_adi}
Kargo Firması: {kargo_firmasi}
Takip Numarası: {takip_no}
Kargonun Son Durumu: {son_hareket}`;

const VAPI_VARSAYILAN = {
  enabled: false,
  assistant_id: "",
  phone_number_id: "",
  tts_provider: "azure" as "azure" | "elevenlabs" | "google",
  tts_voice: "tr-TR-AhmetNeural",
  arama_baslangic_saati: "09:00",
  arama_bitis_saati: "18:00",
  max_deneme: 3,
  tekrar_arama_saat: 24,
  otomatik_arama: false,
  system_prompt: VAPI_VARSAYILAN_PROMPT,
};

const TTS_SESLER: Record<string, Array<{ id: string; ad: SettingsProvidersKey }>> = {
  azure: [
    { id: "tr-TR-AhmetNeural", ad: "voiceAhmet" },
    { id: "tr-TR-EmelNeural", ad: "voiceEmel" },
  ],
  elevenlabs: [{ id: "default", ad: "voiceDefault" }],
  google: [
    { id: "tr-TR-Standard-A", ad: "voiceStandardA" },
    { id: "tr-TR-Standard-B", ad: "voiceStandardB" },
  ],
};

/** Legacy parity: pages/ayarlar/VapiAyarlar.jsx — `vapi_ayarlar` + secret `vapi.api_key`. */
export function VapiAyarlar({ http }: { http: BackendHttpClient }) {
  const { settings, yukle, kaydet } = useGlobalSettings(http);
  const t = useT(settingsProvidersMessages);
  const { mesaj, mesajGoster } = useMesaj();
  const [config, setConfig] = useState(VAPI_VARSAYILAN);
  const [apiKey, setApiKey] = useState("");
  const [kaydediyor, setKaydediyor] = useState(false);

  useEffect(() => {
    void yukle().then((data) => {
      const value = settingValue(data, "vapi_ayarlar");
      if (isRecord(value)) setConfig((prev) => ({ ...prev, ...(value as Partial<typeof VAPI_VARSAYILAN>) }));
    });
  }, [yukle]);

  const guncelle = <K extends keyof typeof VAPI_VARSAYILAN>(alan: K, deger: (typeof VAPI_VARSAYILAN)[K]) =>
    setConfig((prev) => ({ ...prev, [alan]: deger }));

  async function kaydetTumu() {
    setKaydediyor(true);
    try {
      await kaydet("vapi_ayarlar", config);
      if (apiKey.trim()) await kaydet("vapi.api_key", apiKey.trim());
      setApiKey("");
      mesajGoster("basari", t("vapiSaved"));
    } catch (error) {
      mesajGoster("hata", t("saveFailed", { error: hataMetni(error) }));
    } finally {
      setKaydediyor(false);
    }
  }

  const mevcutSesler = TTS_SESLER[config.tts_provider] ?? [];
  const apiKeyTanimli = secretConfigured(settings, "vapi.api_key");

  return (
    <div className="ayarlar-stack" data-testid="ayarlar-vapi">
      <div className="ayarlar-row-between">
        <div className="ayarlar-row">
          <div className="ayarlar-icon-box purple">
            <Bot size={20} />
          </div>
          <div>
            <h2 className="ayarlar-h2">{t("vapiTitle")}</h2>
            <p className="ayarlar-small">{t("vapiSubtitle")}</p>
          </div>
        </div>
        <button type="button" className="ayarlar-purple-btn" onClick={() => void kaydetTumu()} disabled={kaydediyor}>
          {kaydediyor ? <Loader2 size={16} className="ayarlar-spin" /> : <Save size={16} />}
          {t("save")}
        </button>
      </div>
      <MesajBanner mesaj={mesaj} />

      <section className="ayarlar-card">
        <div className="ayarlar-row-between">
          <div>
            <h3 className="ayarlar-h3">{t("vapiStatus")}</h3>
            <p className="ayarlar-small">{t("vapiStatusHint")}</p>
          </div>
          <div className="ayarlar-row">
            <Toggle aktif={config.enabled} label={t("vapiStatus")} onClick={() => guncelle("enabled", !config.enabled)} />
            <span className={config.enabled ? "ayarlar-purple-text" : "ayarlar-muted"}>{config.enabled ? t("active") : t("off")}</span>
          </div>
        </div>
      </section>

      <section className="ayarlar-card ayarlar-form">
        <h3 className="ayarlar-h3">
          <Key size={16} /> {t("apiConfig")}
        </h3>
        <div className="ayarlar-grid-2">
          <label className="ayarlar-field">
            <span>VAPI API Key</span>
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              placeholder={apiKeyTanimli ? t("configuredPlaceholder") : "sk-xxxxxxxxxxxxxxxx"}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
          <label className="ayarlar-field">
            <span>{t("assistantIdOptional")}</span>
            <input
              value={config.assistant_id}
              placeholder={t("assistantIdPlaceholder")}
              onChange={(e) => guncelle("assistant_id", e.target.value)}
            />
          </label>
          <label className="ayarlar-field">
            <span>{t("phoneNumberId")}</span>
            <input value={config.phone_number_id} placeholder="VAPI Phone Number ID" onChange={(e) => guncelle("phone_number_id", e.target.value)} />
            <small>{t("phoneNumberIdHint")}</small>
          </label>
        </div>
      </section>

      <section className="ayarlar-card ayarlar-form">
        <h3 className="ayarlar-h3">
          <Volume2 size={16} /> {t("voiceSettings")}
        </h3>
        <div className="ayarlar-grid-2">
          <label className="ayarlar-field">
            <span>{t("ttsProvider")}</span>
            <select
              value={config.tts_provider}
              onChange={(e) => {
                const provider = e.target.value as typeof config.tts_provider;
                setConfig((prev) => ({ ...prev, tts_provider: provider, tts_voice: TTS_SESLER[provider]?.[0]?.id ?? "" }));
              }}
            >
              <option value="azure">Microsoft Azure</option>
              <option value="elevenlabs">ElevenLabs</option>
              <option value="google">Google Cloud</option>
            </select>
          </label>
          <label className="ayarlar-field">
            <span>{t("voice")}</span>
            <select value={config.tts_voice} onChange={(e) => guncelle("tts_voice", e.target.value)}>
              {mevcutSesler.map((ses) => (
                <option key={ses.id} value={ses.id}>
                  {t(ses.ad)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="ayarlar-card ayarlar-form">
        <h3 className="ayarlar-h3">
          <Clock size={16} /> {t("callSchedule")}
        </h3>
        <div className="ayarlar-grid-4">
          <label className="ayarlar-field">
            <span>{t("startTime")}</span>
            <input type="time" value={config.arama_baslangic_saati} onChange={(e) => guncelle("arama_baslangic_saati", e.target.value)} />
          </label>
          <label className="ayarlar-field">
            <span>{t("endTime")}</span>
            <input type="time" value={config.arama_bitis_saati} onChange={(e) => guncelle("arama_bitis_saati", e.target.value)} />
          </label>
          <label className="ayarlar-field">
            <span>{t("maxAttemptsShort")}</span>
            <input type="number" min={1} max={10} value={config.max_deneme} onChange={(e) => guncelle("max_deneme", Math.max(1, Number(e.target.value) || 1))} />
          </label>
          <label className="ayarlar-field">
            <span>{t("retryHours")}</span>
            <input
              type="number"
              min={1}
              max={168}
              value={config.tekrar_arama_saat}
              onChange={(e) => guncelle("tekrar_arama_saat", Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
        </div>
        <div className="ayarlar-toggle-row">
          <div>
            <p className="ayarlar-strong">{t("autoCall")}</p>
          </div>
          <Toggle aktif={config.otomatik_arama} label={t("autoCall")} onClick={() => guncelle("otomatik_arama", !config.otomatik_arama)} />
        </div>
      </section>

      <section className="ayarlar-card ayarlar-form">
        <h3 className="ayarlar-h3">
          <Bot size={16} /> {t("systemPrompt")}
        </h3>
        <textarea className="ayarlar-textarea mono" rows={12} value={config.system_prompt} onChange={(e) => guncelle("system_prompt", e.target.value)} />
      </section>
    </div>
  );
}

// ─── Kargo Pipeline ────────────────────────────────────────────────────────

const PIPELINE_VARSAYILAN = {
  aktif: false,
  baslangic_saati: "09:00",
  bitis_saati: "20:00",
  mesaj_gecikme_dk: 0,
  sms_gecikme_dk: 60,
  vapi_gecikme_dk: 120,
  max_deneme: 3,
  mesaj_sablonu: "Sayın {musteri_adi}, kargonuz ({takip_no}) {son_hareket} sebebiyle size ulaşmamış. Takip: {takip_link}",
};

const PLACEHOLDERS = ["{musteri_adi}", "{takip_no}", "{son_hareket}", "{takip_link}"];

/** Legacy parity: pages/ayarlar/KargoPipelineAyarlar.jsx — `kargo_pipeline_ayarlar`. */
export function KargoPipelineAyarlar({ http }: { http: BackendHttpClient }) {
  const { yukleniyor, yukle, kaydet } = useGlobalSettings(http);
  const t = useT(settingsProvidersMessages);
  const { mesaj, mesajGoster } = useMesaj();
  const [ayarlar, setAyarlar] = useState(PIPELINE_VARSAYILAN);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  useEffect(() => {
    void yukle().then((data) => {
      const value = settingValue(data, "kargo_pipeline_ayarlar");
      if (isRecord(value)) setAyarlar((prev) => ({ ...prev, ...(value as Partial<typeof PIPELINE_VARSAYILAN>) }));
    });
  }, [yukle]);

  const set = <K extends keyof typeof PIPELINE_VARSAYILAN>(alan: K, deger: (typeof PIPELINE_VARSAYILAN)[K]) =>
    setAyarlar((prev) => ({ ...prev, [alan]: deger }));

  async function handleKaydet() {
    setKaydediliyor(true);
    try {
      await kaydet("kargo_pipeline_ayarlar", ayarlar);
      mesajGoster("basari", t("pipelineSaved"));
    } catch (error) {
      mesajGoster("hata", t("pipelineSaveFailed", { error: hataMetni(error) }));
    } finally {
      setKaydediliyor(false);
    }
  }

  if (yukleniyor) {
    return (
      <div className="ayarlar-loading" data-testid="ayarlar-kargo-pipeline">
        <Loader2 size={16} className="ayarlar-spin" /> {t("loading")}
      </div>
    );
  }

  const sayi = (value: string) => Math.max(0, Number.parseInt(value, 10) || 0);

  return (
    <div className="ayarlar-stack" data-testid="ayarlar-kargo-pipeline">
      <section className="ayarlar-card ayarlar-form">
        <div className="ayarlar-row">
          <div className="ayarlar-icon-box">
            <Package size={20} />
          </div>
          <div>
            <h3 className="ayarlar-h3">{t("pipelineTitle")}</h3>
            <p className="ayarlar-muted">{t("pipelineSubtitle")}</p>
          </div>
        </div>
        <MesajBanner mesaj={mesaj} />
        <div className="ayarlar-toggle-row">
          <div>
            <p className="ayarlar-strong">{t("pipelineActive")}</p>
            <p className="ayarlar-muted">{t("pipelineActiveHint")}</p>
          </div>
          <Toggle aktif={ayarlar.aktif} label={t("pipelineActive")} onClick={() => set("aktif", !ayarlar.aktif)} />
        </div>
        <h4 className="ayarlar-h4">{t("workingHours")}</h4>
        <div className="ayarlar-grid-2">
          <label className="ayarlar-field">
            <span>{t("pipelineStartTime")}</span>
            <input type="time" value={ayarlar.baslangic_saati} onChange={(e) => set("baslangic_saati", e.target.value)} />
          </label>
          <label className="ayarlar-field">
            <span>{t("pipelineEndTime")}</span>
            <input type="time" value={ayarlar.bitis_saati} onChange={(e) => set("bitis_saati", e.target.value)} />
          </label>
        </div>
        <div className="ayarlar-grid-4">
          <label className="ayarlar-field">
            <span>{t("messageDelay")}</span>
            <input type="number" min={0} value={ayarlar.mesaj_gecikme_dk} onChange={(e) => set("mesaj_gecikme_dk", sayi(e.target.value))} />
          </label>
          <label className="ayarlar-field">
            <span>{t("smsDelay")}</span>
            <input type="number" min={0} value={ayarlar.sms_gecikme_dk} onChange={(e) => set("sms_gecikme_dk", sayi(e.target.value))} />
          </label>
          <label className="ayarlar-field">
            <span>{t("vapiDelay")}</span>
            <input type="number" min={0} value={ayarlar.vapi_gecikme_dk} onChange={(e) => set("vapi_gecikme_dk", sayi(e.target.value))} />
          </label>
          <label className="ayarlar-field">
            <span>{t("maxAttemptsAbbr")}</span>
            <input type="number" min={1} value={ayarlar.max_deneme} onChange={(e) => set("max_deneme", Math.max(1, sayi(e.target.value)))} />
          </label>
        </div>
        <label className="ayarlar-field">
          <span>{t("messageTemplate")}</span>
          <textarea className="ayarlar-textarea" rows={4} value={ayarlar.mesaj_sablonu} onChange={(e) => set("mesaj_sablonu", e.target.value)} />
          <small>{t("availableVariables", { variables: PLACEHOLDERS.join(" ") })}</small>
        </label>
        <div className="ayarlar-info">
          {t("pipelineSummary", {
            start: ayarlar.baslangic_saati,
            end: ayarlar.bitis_saati,
            smsDelay: ayarlar.sms_gecikme_dk,
            vapiDelay: ayarlar.vapi_gecikme_dk,
          })}
        </div>
        <div>
          <button type="button" className="ayarlar-primary-btn" onClick={() => void handleKaydet()} disabled={kaydediliyor}>
            {kaydediliyor ? <Loader2 size={16} className="ayarlar-spin" /> : <Save size={16} />}
            {t("save")}
          </button>
        </div>
      </section>
    </div>
  );
}
