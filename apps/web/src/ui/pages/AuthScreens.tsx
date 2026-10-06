import { useState, type FormEvent } from "react";
import { NavLink } from "react-router-dom";
import { ArrowLeft, CheckCircle, FileText, LogIn, Shield, Trash2 } from "lucide-react";
import { DataRows } from "../app/shared.js";
import { useUiMessageText, type UiMessage } from "../i18n/messages/status.js";
import { useT } from "../i18n/index.js";
import { authMessages } from "../i18n/messages/auth.js";

export function publicPageFromPath(pathname: string): "privacy" | "terms" | "deletion" | null {
  if (pathname === "/gizlilik-politikasi") return "privacy";
  if (pathname === "/kullanim-kosullari") return "terms";
  if (pathname === "/veri-silme") return "deletion";
  return null;
}

export function PublicPage(props: { page: "privacy" | "terms" | "deletion" }) {
  const t = useT(authMessages);
  const content = {
    privacy: {
      title: t("privacyTitle"),
      subtitle: t("privacySubtitle"),
      icon: <Shield size={20} aria-hidden="true" />,
      rows: [
        [t("privacyDataScope"), t("privacyDataScopeValue")],
        [t("privacyInfrastructure"), t("privacyInfrastructureValue")],
        [t("privacyAccess"), t("privacyAccessValue")],
      ],
    },
    terms: {
      title: t("termsTitle"),
      subtitle: t("termsSubtitle"),
      icon: <FileText size={20} aria-hidden="true" />,
      rows: [
        [t("termsService"), t("termsServiceValue")],
        [t("termsUsage"), t("termsUsageValue")],
        [t("termsProviders"), t("termsProvidersValue")],
      ],
    },
    deletion: {
      title: t("deletionTitle"),
      subtitle: t("deletionSubtitle"),
      icon: <Trash2 size={20} aria-hidden="true" />,
      rows: [
        [t("deletionRequest"), t("deletionRequestValue")],
        [t("deletionProcess"), t("deletionProcessValue")],
        [t("deletionStatus"), t("deletionStatusValue")],
      ],
    },
  }[props.page];

  return (
    <main className="public-page" data-testid={`${props.page}-public-page`}>
      <section className="public-card">
        <NavLink className="back-link" to="/giris">
          <ArrowLeft size={16} aria-hidden="true" />
          {t("backToLogin")}
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
  const t = useT(authMessages);
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
          {t("backToLogin")}
        </NavLink>
        <div className="brand large">
          <span className="brand-mark">G</span>
          <span>{t("resetTitle")}</span>
        </div>
        {submitted ? (
          <p className="success-line">
            <CheckCircle size={16} aria-hidden="true" />
            {t("resetSubmitted")}
          </p>
        ) : (
          <>
            <label>
              {t("email")}
              <input name="email" type="email" defaultValue="admin@example.com" />
            </label>
            <button className="primary-action" type="submit">
              {t("sendResetLink")}
            </button>
          </>
        )}
      </form>
    </main>
  );
}

export function LoginScreen(props: { onLogin: (event: FormEvent<HTMLFormElement>) => void; status: UiMessage }) {
  const messageText = useUiMessageText();
  const t = useT(authMessages);
  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={props.onLogin}>
        <div className="brand large">
          <span className="brand-mark">G</span>
          <span>Garanti Kuluçka</span>
        </div>
        <label>
          {t("email")}
          <input name="email" defaultValue="admin@example.com" type="email" />
        </label>
        <label>
          {t("password")}
          <input name="password" defaultValue="password" type="password" />
        </label>
        <button className="primary-action" type="submit">
          <LogIn size={16} aria-hidden="true" />
          {t("login")}
        </button>
        <div className="auth-links">
          <NavLink to="/sifre-sifirla">{t("forgotPassword")}</NavLink>
          <NavLink to="/gizlilik-politikasi">{t("privacyTitle")}</NavLink>
          <NavLink to="/kullanim-kosullari">{t("termsTitle")}</NavLink>
          <NavLink to="/veri-silme">{t("deletionTitle")}</NavLink>
        </div>
        <p aria-live="polite">{messageText(props.status)}</p>
      </form>
    </main>
  );
}
