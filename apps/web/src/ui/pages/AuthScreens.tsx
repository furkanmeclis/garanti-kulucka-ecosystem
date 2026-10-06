import { useState, type FormEvent } from "react";
import { NavLink } from "react-router-dom";
import { ArrowLeft, CheckCircle, FileText, LogIn, Shield, Trash2 } from "lucide-react";
import { DataRows } from "../app/shared.js";

export function publicPageFromPath(pathname: string): "privacy" | "terms" | "deletion" | null {
  if (pathname === "/gizlilik-politikasi") return "privacy";
  if (pathname === "/kullanim-kosullari") return "terms";
  if (pathname === "/veri-silme") return "deletion";
  return null;
}

export function PublicPage(props: { page: "privacy" | "terms" | "deletion" }) {
  const content = {
    privacy: {
      title: "Gizlilik Politikası",
      subtitle: "Privacy Policy",
      icon: <Shield size={20} aria-hidden="true" />,
      rows: [
        ["Veri kapsamı", "Müşteri iletişimi, sipariş, kargo ve destek kayıtları"],
        ["Altyapı", "Backend API, production object storage ve provider adapter sınırları"],
        ["Erişim", "Rol bazlı panel oturumu ve denetlenebilir admin ayarları"],
      ],
    },
    terms: {
      title: "Kullanım Koşulları",
      subtitle: "Terms of Service",
      icon: <FileText size={20} aria-hidden="true" />,
      rows: [
        ["Hizmet", "Mesaj, sipariş, kargo, dosya ve santral operasyon paneli"],
        ["Kullanım", "Yetkili kullanıcılar yalnızca iş süreçleri için erişebilir"],
        ["Sağlayıcılar", "PTT, Sürat, KolayBi, Meta, NetGSM ve SIP/Vapi sınırları"],
      ],
    },
    deletion: {
      title: "Veri Silme Talebi",
      subtitle: "Data Deletion",
      icon: <Trash2 size={20} aria-hidden="true" />,
      rows: [
        ["Talep", "Müşteri kimliği ve iletişim kanalıyla operasyon ekibine iletilir"],
        ["Süreç", "Kayıtlar yasal saklama ve provider zorunluluklarına göre incelenir"],
        ["Durum", "Talep sonucu kayıtlı iletişim kanalı üzerinden bildirilir"],
      ],
    },
  }[props.page];

  return (
    <main className="public-page" data-testid={`${props.page}-public-page`}>
      <section className="public-card">
        <NavLink className="back-link" to="/giris">
          <ArrowLeft size={16} aria-hidden="true" />
          Giriş sayfasına dön
        </NavLink>
        <div className="public-title">
          <span className="public-icon">{content.icon}</span>
          <div>
            <h1>{content.title}</h1>
            <p>{content.subtitle}</p>
          </div>
        </div>
        <DataRows rows={content.rows} />
      </section>
    </main>
  );
}

export function ResetPasswordScreen() {
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={handleSubmit} data-testid="reset-password-flow">
        <NavLink className="back-link" to="/giris">
          <ArrowLeft size={16} aria-hidden="true" />
          Giriş sayfasına dön
        </NavLink>
        <div className="brand large">
          <span className="brand-mark">G</span>
          <span>Şifre sıfırlama</span>
        </div>
        {submitted ? (
          <p className="success-line">
            <CheckCircle size={16} aria-hidden="true" />
            Sıfırlama talebi backend auth akışına kaydedildi.
          </p>
        ) : (
          <>
            <label>
              E-posta
              <input name="email" type="email" defaultValue="admin@example.com" />
            </label>
            <button className="primary-action" type="submit">
              Sıfırlama bağlantısı gönder
            </button>
          </>
        )}
      </form>
    </main>
  );
}

export function LoginScreen(props: { onLogin: (event: FormEvent<HTMLFormElement>) => void; status: string }) {
  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={props.onLogin}>
        <div className="brand large">
          <span className="brand-mark">G</span>
          <span>Garanti Kuluçka</span>
        </div>
        <label>
          E-posta
          <input name="email" defaultValue="admin@example.com" type="email" />
        </label>
        <label>
          Şifre
          <input name="password" defaultValue="password" type="password" />
        </label>
        <button className="primary-action" type="submit">
          <LogIn size={16} aria-hidden="true" />
          Giriş yap
        </button>
        <div className="auth-links">
          <NavLink to="/sifre-sifirla">Şifremi unuttum</NavLink>
          <NavLink to="/gizlilik-politikasi">Gizlilik Politikası</NavLink>
          <NavLink to="/kullanim-kosullari">Kullanım Koşulları</NavLink>
          <NavLink to="/veri-silme">Veri Silme Talebi</NavLink>
        </div>
        <p aria-live="polite">{props.status}</p>
      </form>
    </main>
  );
}
