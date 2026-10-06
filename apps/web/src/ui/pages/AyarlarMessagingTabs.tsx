import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import qrcode from "qrcode-generator";
import { CheckCircle, Copy, Key, Loader2, QrCode, RefreshCw, Save, Wallet, XCircle } from "lucide-react";
import { createAdminClient, type IntegrationAccount, type IntegrationAccountSnapshot } from "../../api/admin-client.js";
import type { BackendHttpClient } from "../../api/http-client.js";
import { createSettingsClient, type NetgsmBalance } from "../../api/settings-client.js";
import { useT } from "../i18n/index.js";
import { settingsMessagingMessages } from "../i18n/messages/settingsMessaging.js";
import { MesajBanner, hataMetni, useMesaj } from "./AyarlarShared.js";

/**
 * WhatsApp Cloud API and NetGSM provider settings (legacy WhatsAppAyarlar / NetgsmAyarlar + the
 * env-only credentials of server.js). Values go to the provider's integration account: secrets are
 * stored encrypted as tokens or secret settings and only come back masked; this screen never flips
 * the live gate, it only shows it.
 */

type ProviderKey = "whatsapp" | "netgsm";

const mask = "••••••••";

function useProviderAccount(http: BackendHttpClient, provider: ProviderKey) {
  const adminClient = useMemo(() => createAdminClient(http), [http]);
  const [account, setAccount] = useState<IntegrationAccount | null>(null);
  const [snapshot, setSnapshot] = useState<IntegrationAccountSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await adminClient.listIntegrationAccounts();
      const found = data.find((item) => item.provider_key === provider) ?? null;
      setAccount(found);
      setSnapshot(found ? await adminClient.getIntegrationAccount(found.public_id) : null);
      setError(null);
    } catch (reason) {
      setError(reason);
    } finally {
      setLoading(false);
    }
  }, [adminClient, provider]);

  useEffect(() => {
    void load();
  }, [load]);

  const setting = (key: string) => snapshot?.settings.find((item) => item.key === key) ?? null;
  const plainSetting = (key: string) => {
    const value = setting(key);
    return value && !value.is_secret && typeof value.value === "string" ? value.value : "";
  };
  const hasToken = (type: string) => Boolean(snapshot?.tokens.some((token) => token.token_type === type));
  const liveMode = (() => {
    const value = setting("live_mode")?.value;
    return value === true || value === "true";
  })();

  return { adminClient, account, snapshot, loading, error, load, setting, plainSetting, hasToken, liveMode };
}

function StatusPill({ ok, okText, badText, testId }: { ok: boolean; okText: string; badText: string; testId?: string }) {
  return (
    <span className={`ayarlar-pill ${ok ? "green" : "red"}`} data-testid={testId}>
      {ok ? <CheckCircle size={12} /> : <XCircle size={12} />}
      {ok ? okText : badText}
    </span>
  );
}

function CopyRow({ value, testId, onCopy }: { value: string; testId: string; onCopy: () => void }) {
  const t = useT(settingsMessagingMessages);
  return (
    <div className="ayarlar-copy-row">
      <code data-testid={testId}>{value}</code>
      <button type="button" className="ayarlar-outline-btn small" onClick={onCopy}>
        <Copy size={14} />
        {t("copy")}
      </button>
    </div>
  );
}

/** wa.me link + QR module path for a business number (TR numbers normalised to 90XXXXXXXXXX). */
export function whatsappQr(phone: string) {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `90${digits.slice(1)}`;
  if (digits.length === 10) digits = `90${digits}`;
  if (digits.length < 11) return null;
  const link = `https://wa.me/${digits}`;
  const qr = qrcode(0, "M");
  qr.addData(link);
  qr.make();
  const size = qr.getModuleCount();
  let path = "";
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (qr.isDark(row, col)) path += `M${col + 2} ${row + 2}h1v1h-1z`;
    }
  }
  return { link, size: size + 4, path };
}

function QrImage({ qr }: { qr: NonNullable<ReturnType<typeof whatsappQr>> }) {
  return (
    <svg className="ayarlar-qr-image" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={qr.link} shapeRendering="crispEdges" data-testid="whatsapp-qr-image">
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={qr.path} fill="#000" />
    </svg>
  );
}

export function WhatsAppAyarlar({ http }: { http: BackendHttpClient }) {
  const t = useT(settingsMessagingMessages);
  const state = useProviderAccount(http, "whatsapp");
  const { mesaj, mesajGoster } = useMesaj();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ phoneNumberId: "", wabaId: "", displayPhone: "", accessToken: "", verifyToken: "" });
  const callbackUrl = `${window.location.origin}/webhooks/whatsapp`;

  useEffect(() => {
    setForm((current) => ({
      ...current,
      phoneNumberId: state.account?.external_account_id ?? state.plainSetting("phone_number_id"),
      wabaId: state.plainSetting("waba_id"),
      displayPhone: state.plainSetting("display_phone_number"),
    }));
    // plainSetting reads the latest snapshot; re-run whenever it changes.
  }, [state.account, state.snapshot]);

  useEffect(() => {
    if (state.error) mesajGoster("hata", t("loadFailed", { error: hataMetni(state.error) }));
  }, [state.error, mesajGoster, t]);

  const tokenSet = state.hasToken("access_token");
  const verifySet = Boolean(state.setting("webhook.verify_token"));
  const qr = form.displayPhone ? whatsappQr(form.displayPhone) : null;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form.phoneNumberId.trim()) {
      mesajGoster("hata", t("phoneNumberIdRequired"));
      return;
    }
    setSaving(true);
    try {
      const account = await state.adminClient.upsertIntegrationAccount({
        provider_key: "whatsapp",
        display_name: state.account?.display_name ?? "WhatsApp",
        external_account_id: form.phoneNumberId.trim(),
      });
      await state.adminClient.upsertIntegrationSetting(account.public_id, "phone_number_id", form.phoneNumberId.trim());
      await state.adminClient.upsertIntegrationSetting(account.public_id, "waba_id", form.wabaId.trim());
      await state.adminClient.upsertIntegrationSetting(account.public_id, "display_phone_number", form.displayPhone.trim());
      if (form.accessToken.trim()) await state.adminClient.upsertIntegrationToken(account.public_id, "access_token", form.accessToken.trim());
      if (form.verifyToken.trim()) await state.adminClient.upsertIntegrationSetting(account.public_id, "webhook.verify_token", form.verifyToken.trim(), true);
      setForm((current) => ({ ...current, accessToken: "", verifyToken: "" }));
      mesajGoster("basari", t("saved"));
      await state.load();
    } catch (error) {
      mesajGoster("hata", t("saveFailed", { error: hataMetni(error) }));
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(callbackUrl);
      mesajGoster("basari", t("copied"));
    } catch {
      mesajGoster("hata", t("copyFailed"));
    }
  }

  return (
    <div className="ayarlar-stack" data-testid="ayarlar-whatsapp">
      <section className="ayarlar-card">
        <div className="ayarlar-row-between">
          <div>
            <h3 className="ayarlar-h2">{t("whatsappTitle")}</h3>
            <p className="ayarlar-muted">{t("whatsappSubtitle")}</p>
          </div>
          <button type="button" className="ayarlar-outline-btn" onClick={() => void state.load()} disabled={state.loading}>
            <RefreshCw size={16} className={state.loading ? "ayarlar-spin" : ""} />
            {t("refresh")}
          </button>
        </div>
        <MesajBanner mesaj={mesaj} />
        <h4 className="ayarlar-h4">{t("connectionStatus")}</h4>
        <div className="ayarlar-status-grid" data-testid="whatsapp-status">
          <StatusPill ok={state.account?.status === "active"} okText={t("accountActive")} badText={state.account ? t("accountInactive") : t("accountMissing")} />
          <StatusPill ok={tokenSet} okText={t("tokenConfigured")} badText={t("tokenMissing")} testId="whatsapp-token-status" />
          <StatusPill ok={verifySet} okText={t("verifyConfigured")} badText={t("verifyMissing")} />
          <span className={`ayarlar-pill ${state.liveMode ? "green" : "slate"}`} data-testid="whatsapp-live">
            {state.liveMode ? t("liveOn") : t("liveOff")}
          </span>
        </div>
        <p className="ayarlar-small">{t("liveGateNote", { gate: "providers.whatsapp.live_mode" })}</p>
        <p className="ayarlar-small" data-testid="whatsapp-token-mask">
          {t("maskedValue", { mask: tokenSet ? mask : "-" })}
        </p>
      </section>

      <form className="ayarlar-card ayarlar-form" onSubmit={(event) => void save(event)} data-testid="whatsapp-form">
        <h4 className="ayarlar-h4">
          <Key size={16} /> {t("whatsappTitle")}
        </h4>
        <div className="ayarlar-grid-2">
          <label className="ayarlar-field">
            <span>{t("phoneNumberId")}</span>
            <input name="phone_number_id" value={form.phoneNumberId} onChange={(event) => setForm((current) => ({ ...current, phoneNumberId: event.target.value }))} />
          </label>
          <label className="ayarlar-field">
            <span>{t("wabaId")}</span>
            <input name="waba_id" value={form.wabaId} onChange={(event) => setForm((current) => ({ ...current, wabaId: event.target.value }))} />
          </label>
          <label className="ayarlar-field">
            <span>{t("displayPhone")}</span>
            <input name="display_phone_number" type="tel" value={form.displayPhone} onChange={(event) => setForm((current) => ({ ...current, displayPhone: event.target.value }))} />
          </label>
          <label className="ayarlar-field">
            <span>{t("accessToken")}</span>
            <input
              name="access_token"
              type="password"
              autoComplete="off"
              value={form.accessToken}
              placeholder={tokenSet ? `${mask} · ${t("replacePlaceholder")}` : ""}
              onChange={(event) => setForm((current) => ({ ...current, accessToken: event.target.value }))}
            />
          </label>
        </div>
        <div className="ayarlar-field">
          <span>{t("callbackUrl")}</span>
          <CopyRow value={callbackUrl} testId="ayarlar-whatsapp-callback" onCopy={() => void copy()} />
        </div>
        <label className="ayarlar-field">
          <span>{t("verifyToken")}</span>
          <input
            name="verify_token"
            type="password"
            autoComplete="off"
            value={form.verifyToken}
            placeholder={verifySet ? `${mask} · ${t("replacePlaceholder")}` : ""}
            onChange={(event) => setForm((current) => ({ ...current, verifyToken: event.target.value }))}
          />
        </label>
        <button type="submit" className="ayarlar-primary-btn" disabled={saving} data-testid="whatsapp-save">
          {saving ? <Loader2 size={16} className="ayarlar-spin" /> : <Save size={16} />}
          {saving ? t("saving") : t("save")}
        </button>
      </form>

      <section className="ayarlar-card" data-testid="whatsapp-qr">
        <h4 className="ayarlar-h4">
          <QrCode size={16} /> {t("qrTitle")}
        </h4>
        {qr ? (
          <div className="ayarlar-qr">
            <QrImage qr={qr} />
            <div>
              <p className="ayarlar-small">{t("qrHint")}</p>
              <a href={qr.link} target="_blank" rel="noreferrer" data-testid="whatsapp-qr-link">
                {qr.link}
              </a>
            </div>
          </div>
        ) : (
          <p className="ayarlar-muted">{t("qrMissing")}</p>
        )}
      </section>
    </div>
  );
}

export function NetgsmAyarlar({ http }: { http: BackendHttpClient }) {
  const t = useT(settingsMessagingMessages);
  const state = useProviderAccount(http, "netgsm");
  const settingsClient = useMemo(() => createSettingsClient(http), [http]);
  const { mesaj, mesajGoster } = useMesaj();
  const [saving, setSaving] = useState(false);
  const [balance, setBalance] = useState<NetgsmBalance | null>(null);
  const [checking, setChecking] = useState(false);
  const [form, setForm] = useState({ usercode: "", password: "", msgheader: "" });
  const callbackUrl = `${window.location.origin}/webhooks/netgsm`;

  useEffect(() => {
    setForm((current) => ({
      ...current,
      usercode: state.account?.external_account_id ?? state.plainSetting("sms_usercode"),
      msgheader: state.plainSetting("msgheader"),
    }));
  }, [state.account, state.snapshot]);

  useEffect(() => {
    if (state.error) mesajGoster("hata", t("loadFailed", { error: hataMetni(state.error) }));
  }, [state.error, mesajGoster, t]);

  const passwordSet = state.hasToken("sms_password");

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form.usercode.trim()) {
      mesajGoster("hata", t("usercodeRequired"));
      return;
    }
    setSaving(true);
    try {
      const account = await state.adminClient.upsertIntegrationAccount({
        provider_key: "netgsm",
        display_name: state.account?.display_name ?? "NetGSM",
        external_account_id: form.usercode.trim(),
      });
      await state.adminClient.upsertIntegrationSetting(account.public_id, "sms_usercode", form.usercode.trim());
      await state.adminClient.upsertIntegrationSetting(account.public_id, "msgheader", form.msgheader.trim());
      if (form.password.trim()) await state.adminClient.upsertIntegrationToken(account.public_id, "sms_password", form.password.trim());
      setForm((current) => ({ ...current, password: "" }));
      mesajGoster("basari", t("saved"));
      await state.load();
    } catch (error) {
      mesajGoster("hata", t("saveFailed", { error: hataMetni(error) }));
    } finally {
      setSaving(false);
    }
  }

  async function checkBalance() {
    setChecking(true);
    try {
      setBalance(await settingsClient.getNetgsmBalance());
    } catch (error) {
      mesajGoster("hata", hataMetni(error));
    } finally {
      setChecking(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(callbackUrl);
      mesajGoster("basari", t("copied"));
    } catch {
      mesajGoster("hata", t("copyFailed"));
    }
  }

  return (
    <div className="ayarlar-stack" data-testid="ayarlar-netgsm">
      <section className="ayarlar-card">
        <div className="ayarlar-row-between">
          <div>
            <h3 className="ayarlar-h2">{t("netgsmTitle")}</h3>
            <p className="ayarlar-muted">{t("netgsmSubtitle")}</p>
          </div>
          <button type="button" className="ayarlar-outline-btn" onClick={() => void state.load()} disabled={state.loading}>
            <RefreshCw size={16} className={state.loading ? "ayarlar-spin" : ""} />
            {t("refresh")}
          </button>
        </div>
        <MesajBanner mesaj={mesaj} />
        <h4 className="ayarlar-h4">{t("connectionStatus")}</h4>
        <div className="ayarlar-status-grid" data-testid="netgsm-status">
          <StatusPill ok={state.account?.status === "active"} okText={t("accountActive")} badText={state.account ? t("accountInactive") : t("accountMissing")} />
          <StatusPill ok={passwordSet} okText={t("passwordConfigured")} badText={t("passwordMissing")} testId="netgsm-password-status" />
          <span className={`ayarlar-pill ${state.liveMode ? "green" : "slate"}`} data-testid="netgsm-live">
            {state.liveMode ? t("liveOn") : t("liveOff")}
          </span>
        </div>
        <p className="ayarlar-small">{t("liveGateNote", { gate: "providers.netgsm.live_mode" })}</p>
        <p className="ayarlar-small" data-testid="netgsm-password-mask">
          {t("maskedValue", { mask: passwordSet ? mask : "-" })}
        </p>
      </section>

      <form className="ayarlar-card ayarlar-form" onSubmit={(event) => void save(event)} data-testid="netgsm-form">
        <h4 className="ayarlar-h4">
          <Key size={16} /> {t("netgsmTitle")}
        </h4>
        <div className="ayarlar-grid-2">
          <label className="ayarlar-field">
            <span>{t("usercode")}</span>
            <input name="usercode" value={form.usercode} onChange={(event) => setForm((current) => ({ ...current, usercode: event.target.value }))} />
          </label>
          <label className="ayarlar-field">
            <span>{t("password")}</span>
            <input
              name="password"
              type="password"
              autoComplete="off"
              value={form.password}
              placeholder={passwordSet ? `${mask} · ${t("replacePlaceholder")}` : ""}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
            />
          </label>
          <label className="ayarlar-field">
            <span>{t("msgheader")}</span>
            <input name="msgheader" value={form.msgheader} onChange={(event) => setForm((current) => ({ ...current, msgheader: event.target.value }))} />
          </label>
        </div>
        <div className="ayarlar-field">
          <span>{t("callbackUrl")}</span>
          <CopyRow value={callbackUrl} testId="ayarlar-netgsm-callback" onCopy={() => void copy()} />
        </div>
        <button type="submit" className="ayarlar-primary-btn" disabled={saving} data-testid="netgsm-save">
          {saving ? <Loader2 size={16} className="ayarlar-spin" /> : <Save size={16} />}
          {saving ? t("saving") : t("save")}
        </button>
      </form>

      <section className="ayarlar-card" data-testid="netgsm-balance">
        <div className="ayarlar-row-between">
          <h4 className="ayarlar-h4">
            <Wallet size={16} /> {t("balance")}
          </h4>
          <button type="button" className="ayarlar-outline-btn" onClick={() => void checkBalance()} disabled={checking} data-testid="netgsm-balance-check">
            {checking ? <Loader2 size={16} className="ayarlar-spin" /> : <RefreshCw size={16} />}
            {t("checkBalance")}
          </button>
        </div>
        {balance && (
          <p className="ayarlar-small" data-testid="netgsm-balance-result">
            {balance.status === "dry_run"
              ? t("balanceDryRun")
              : t("balanceValue", { balance: balance.balance ?? "-", credit: balance.sms_credit ?? "-" })}
          </p>
        )}
      </section>
    </div>
  );
}
