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

/** Legacy parity: pages/ayarlar/KullanicilarPage.jsx — `/admin/users` (admin-only RBAC). */

const ROL_ADLARI: Record<string, string> = {
  admin: "Admin",
  owner: "Admin",
  calisan: "Çalışan",
  kargo_operatoru: "Kargo Operatörü",
};

function rolAdiGetir(rol: string | undefined) {
  if (!rol) return "-";
  return ROL_ADLARI[rol] ?? rol;
}

const BOSH_YENI = { email: "", ad: "", soyad: "", telefon: "", sifre: "", rol: "" as ManagedRole | "" };
const BOSH_DUZENLE = { ad: "", soyad: "", telefon: "", rol: "" as ManagedRole | "" };

export function KullanicilarSekmesi({ http, currentUserPublicId }: { http: BackendHttpClient; currentUserPublicId: string }) {
  const client = useMemo(() => createSettingsClient(http), [http]);
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
      mesajGoster("hata", `Kullanıcılar yüklenemedi: ${hataMetni(error)}`);
    } finally {
      setYukleniyor(false);
    }
  }, [client, mesajGoster]);

  useEffect(() => {
    void kullanicilariGetir();
  }, [kullanicilariGetir]);

  async function yeniKullaniciOlustur(event: FormEvent) {
    event.preventDefault();
    if (!yeniForm.email || !yeniForm.ad || !yeniForm.sifre) {
      mesajGoster("hata", "E-posta, ad ve şifre zorunlu.");
      return;
    }
    if (yeniForm.sifre.length < 6) {
      mesajGoster("hata", "Şifre en az 6 karakter olmalı.");
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
      mesajGoster("basari", `${yeniForm.ad} oluşturuldu.`);
      void kullanicilariGetir();
    } catch (error) {
      mesajGoster("hata", `Oluşturulamadı: ${hataMetni(error)}`);
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
      });
      setKullanicilar((prev) => prev.map((item) => (item.public_id === publicId ? user : item)));
      setDuzenleId(null);
      mesajGoster("basari", "Kullanıcı güncellendi.");
    } catch (error) {
      mesajGoster("hata", `Güncellenemedi: ${hataMetni(error)}`);
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
      mesajGoster("hata", `Durum güncellenemedi. ${hataMetni(error)}`);
    }
  }

  async function kullaniciSil(publicId: string) {
    setSiliniyor(true);
    try {
      await client.deactivateUser(publicId);
      setKullanicilar((prev) => prev.filter((item) => item.public_id !== publicId));
      setSilOnayId(null);
      mesajGoster("basari", "Kullanıcı silindi.");
    } catch (error) {
      mesajGoster("hata", `Silinemedi: ${hataMetni(error)}`);
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
    });
  }

  return (
    <div className="ayarlar-stack" data-testid="ayarlar-kullanicilar">
      <div className="ayarlar-row-between">
        <div className="ayarlar-row">
          <Users size={20} className="ayarlar-primary-text" />
          <div>
            <h2 className="ayarlar-h2">Kullanıcı Yönetimi</h2>
            <p className="ayarlar-muted">Panel kullanıcılarını yönetin</p>
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
          Yeni Kullanıcı
        </button>
      </div>

      <MesajBanner mesaj={mesaj} />

      <div className="ayarlar-table-card">
        {yukleniyor ? (
          <div className="ayarlar-empty">Yükleniyor...</div>
        ) : kullanicilar.length === 0 ? (
          <div className="ayarlar-empty">
            <Users size={40} />
            <p>Kullanıcı bulunamadı</p>
          </div>
        ) : (
          <div className="ayarlar-table-scroll">
            <table className="ayarlar-table">
              <thead>
                <tr>
                  <th>Kullanıcı</th>
                  <th>Rol</th>
                  <th>Durum</th>
                  <th>Son Giriş</th>
                  <th className="right">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {kullanicilar.map((kullanici) => (
                  <tr key={kullanici.public_id} data-testid={`kullanici-${kullanici.public_id}`}>
                    <td>
                      {duzenleId === kullanici.public_id ? (
                        <div className="ayarlar-inline-edit">
                          <input placeholder="Ad" value={duzenleForm.ad} onChange={(e) => setDuzenleForm((f) => ({ ...f, ad: e.target.value }))} />
                          <input
                            placeholder="Soyad"
                            value={duzenleForm.soyad}
                            onChange={(e) => setDuzenleForm((f) => ({ ...f, soyad: e.target.value }))}
                          />
                          <input
                            placeholder="Telefon"
                            value={duzenleForm.telefon}
                            onChange={(e) => setDuzenleForm((f) => ({ ...f, telefon: e.target.value }))}
                          />
                          <select
                            aria-label="Rol"
                            value={duzenleForm.rol}
                            onChange={(e) => setDuzenleForm((f) => ({ ...f, rol: e.target.value as ManagedRole | "" }))}
                          >
                            <option value="">Rol seç</option>
                            {roller.map((rol) => (
                              <option key={rol} value={rol}>
                                {rolAdiGetir(rol)}
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
                              {duzenleKaydediliyor ? "..." : "Kaydet"}
                            </button>
                            <button type="button" className="ayarlar-outline-btn small" aria-label="Vazgeç" onClick={() => setDuzenleId(null)}>
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
                        {rolAdiGetir(kullanici.role)}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="ayarlar-link-btn"
                        onClick={() => void aktifToggle(kullanici)}
                        title={kullanici.is_active ? "Pasife al" : "Aktife al"}
                        disabled={kullanici.public_id === currentUserPublicId}
                      >
                        {kullanici.is_active ? <ToggleRight size={20} className="ayarlar-green" /> : <ToggleLeft size={20} />}
                        <span className={kullanici.is_active ? "ayarlar-green" : "ayarlar-muted"}>{kullanici.is_active ? "Aktif" : "Pasif"}</span>
                      </button>
                    </td>
                    <td className="ayarlar-nowrap">{kullanici.last_seen_at ? tarihSaatFormatla(kullanici.last_seen_at) : "-"}</td>
                    <td className="right">
                      {duzenleId !== kullanici.public_id && (
                        <div className="ayarlar-row ayarlar-justify-end">
                          <button type="button" className="ayarlar-outline-btn small" onClick={() => duzenleBaslat(kullanici)}>
                            <Pencil size={14} />
                            Düzenle
                          </button>
                          {silOnayId === kullanici.public_id ? (
                            <div className="ayarlar-row">
                              <span className="ayarlar-red small">Emin misin?</span>
                              <button
                                type="button"
                                className="ayarlar-danger-btn small"
                                onClick={() => void kullaniciSil(kullanici.public_id)}
                                disabled={siliniyor}
                              >
                                {siliniyor ? "..." : "Evet"}
                              </button>
                              <button type="button" className="ayarlar-outline-btn small" onClick={() => setSilOnayId(null)}>
                                Hayır
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
                              Sil
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
        <div className="ayarlar-overlay" role="dialog" aria-modal="true" aria-label="Yeni Kullanıcı">
          <form className="ayarlar-modal" onSubmit={(event) => void yeniKullaniciOlustur(event)}>
            <div className="ayarlar-row-between">
              <h3 className="ayarlar-h2">Yeni Kullanıcı</h3>
              <button type="button" className="ayarlar-icon-btn" aria-label="Kapat" onClick={() => setYeniModal(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="ayarlar-grid-2">
              <label className="ayarlar-field">
                <span>Ad *</span>
                <input value={yeniForm.ad} onChange={(e) => setYeniForm((f) => ({ ...f, ad: e.target.value }))} />
              </label>
              <label className="ayarlar-field">
                <span>Soyad</span>
                <input value={yeniForm.soyad} onChange={(e) => setYeniForm((f) => ({ ...f, soyad: e.target.value }))} />
              </label>
            </div>
            <label className="ayarlar-field">
              <span>E-posta *</span>
              <input type="email" value={yeniForm.email} onChange={(e) => setYeniForm((f) => ({ ...f, email: e.target.value }))} />
            </label>
            <label className="ayarlar-field">
              <span>Telefon</span>
              <input
                value={yeniForm.telefon}
                placeholder="05xx xxx xx xx"
                onChange={(e) => setYeniForm((f) => ({ ...f, telefon: e.target.value }))}
              />
            </label>
            <label className="ayarlar-field">
              <span>Şifre *</span>
              <div className="ayarlar-password">
                <input
                  type={sifreGoster ? "text" : "password"}
                  value={yeniForm.sifre}
                  placeholder="En az 6 karakter"
                  onChange={(e) => setYeniForm((f) => ({ ...f, sifre: e.target.value }))}
                />
                <button type="button" className="ayarlar-icon-btn" aria-label="Şifreyi göster" onClick={() => setSifreGoster((v) => !v)}>
                  {sifreGoster ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
            <label className="ayarlar-field">
              <span>Rol</span>
              <select value={yeniForm.rol} onChange={(e) => setYeniForm((f) => ({ ...f, rol: e.target.value as ManagedRole | "" }))}>
                <option value="">Rol seçin</option>
                {roller.map((rol) => (
                  <option key={rol} value={rol}>
                    {rolAdiGetir(rol)}
                  </option>
                ))}
              </select>
            </label>
            <div className="ayarlar-row ayarlar-justify-end">
              <button type="button" className="ayarlar-outline-btn" onClick={() => setYeniModal(false)}>
                İptal
              </button>
              <button type="submit" className="ayarlar-primary-btn" disabled={yeniKaydediliyor}>
                {yeniKaydediliyor ? <Loader2 size={16} className="ayarlar-spin" /> : <Plus size={16} />}
                Oluştur
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
  instagram: { baslik: "Instagram Entegrasyonu", alt: "Instagram DM mesajlaşma ve webhook ayarları", aktif: "Instagram Aktif", pasif: "Instagram Pasif" },
  messenger: { baslik: "Messenger Entegrasyonu", alt: "Facebook Messenger mesajlaşma ve webhook ayarları", aktif: "Messenger Aktif", pasif: "Messenger Pasif" },
} as const;

export function EntegrasyonAyarlar({ http, provider }: { http: BackendHttpClient; provider: "instagram" | "messenger" }) {
  const adminClient = useMemo(() => createAdminClient(http), [http]);
  const metin = ENTEGRASYON_METIN[provider];
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
      mesajGoster("hata", "Page ID gerekli");
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
      mesajGoster("basari", "Token bilgileri kaydedildi.");
      await yukle();
    } catch (error) {
      mesajGoster("hata", `Kayıt başarısız: ${hataMetni(error)}`);
    } finally {
      setKaydediliyor(false);
    }
  }

  async function kopyala(deger: string, basari: string) {
    try {
      await navigator.clipboard.writeText(deger);
      mesajGoster("basari", basari);
    } catch {
      mesajGoster("hata", "Kopyalanamadı");
    }
  }

  return (
    <div className="ayarlar-stack" data-testid={`ayarlar-${provider}`}>
      <section className="ayarlar-card">
        <div className="ayarlar-row-between">
          <div>
            <h3 className="ayarlar-h2">{metin.baslik}</h3>
            <p className="ayarlar-muted">{metin.alt}</p>
          </div>
          <button type="button" className="ayarlar-outline-btn" onClick={() => void yukle()} disabled={yukleniyor}>
            <RefreshCw size={16} className={yukleniyor ? "ayarlar-spin" : ""} />
            Yenile
          </button>
        </div>
        <MesajBanner mesaj={mesaj} />
        <h4 className="ayarlar-h4">Bağlantı Durumu</h4>
        <div className="ayarlar-status-grid">
          <span className={`ayarlar-pill ${tokenTanimli ? "green" : "red"}`}>
            {tokenTanimli ? <CheckCircle size={12} /> : <XCircle size={12} />}
            {tokenTanimli ? "Page Access Token Tanımlı" : "Page Access Token Eksik"}
          </span>
          <span className={`ayarlar-pill ${hesap?.external_account_id ? "green" : "red"}`}>
            {hesap?.external_account_id ? `Page ID: ${hesap.external_account_id}` : "Page ID Eksik"}
          </span>
          <span className={`ayarlar-pill ${hesap?.status === "active" ? "green" : "slate"}`}>
            {hesap?.status === "active" ? metin.aktif : metin.pasif}
          </span>
        </div>
        {snapshot && (
          <p className="ayarlar-small" data-testid={`ayarlar-${provider}-token-mask`}>
            Token: {tokenTanimli ? "••••••••" : "-"} (maskeli)
          </p>
        )}
      </section>

      <form className="ayarlar-card ayarlar-form" onSubmit={(event) => void kaydet(event)}>
        <h4 className="ayarlar-h4">
          <Key size={16} /> Manuel Yapılandırma
        </h4>
        <label className="ayarlar-field">
          <span>Page Access Token</span>
          <input
            type="password"
            autoComplete="off"
            value={form.pageAccessToken}
            placeholder={tokenTanimli ? "•••••••• (değiştirmek için yeni token girin)" : ""}
            onChange={(e) => setForm((f) => ({ ...f, pageAccessToken: e.target.value }))}
          />
        </label>
        <label className="ayarlar-field">
          <span>Facebook Page ID</span>
          <input value={form.pageId} onChange={(e) => setForm((f) => ({ ...f, pageId: e.target.value }))} />
        </label>
        <button type="submit" className="ayarlar-primary-btn" disabled={kaydediliyor}>
          {kaydediliyor ? <Loader2 size={16} className="ayarlar-spin" /> : <Save size={16} />}
          {kaydediliyor ? "Kaydediliyor..." : "Token Bilgilerini Kaydet"}
        </button>
      </form>

      <form className="ayarlar-card ayarlar-form" onSubmit={(event) => void kaydet(event)}>
        <h4 className="ayarlar-h4">Webhook Ayarları</h4>
        <div className="ayarlar-field">
          <span>Callback URL</span>
          <div className="ayarlar-copy-row">
            <code data-testid={`ayarlar-${provider}-callback`}>{callbackUrl}</code>
            <button type="button" className="ayarlar-outline-btn small" onClick={() => void kopyala(callbackUrl, "URL kopyalandı!")}>
              <Copy size={14} />
              Kopyala
            </button>
          </div>
        </div>
        <label className="ayarlar-field">
          <span>Verify Token</span>
          <input
            type="password"
            autoComplete="off"
            value={form.verifyToken}
            placeholder={verifyTokenTanimli ? "•••••••• (tanımlı)" : ""}
            onChange={(e) => setForm((f) => ({ ...f, verifyToken: e.target.value }))}
          />
        </label>
        <button type="submit" className="ayarlar-primary-btn" disabled={kaydediliyor}>
          <Save size={16} />
          Kaydet
        </button>
      </form>
    </div>
  );
}
