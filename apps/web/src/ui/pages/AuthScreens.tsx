import { useState, type FormEvent } from "react";
import { NavLink } from "react-router-dom";
import { ArrowLeft, CheckCircle, FileText, LogIn, Shield, Trash2 } from "lucide-react";
import { DataRows } from "../app/shared.js";
import { useUiMessageText, type UiMessage } from "../i18n/messages/status.js";
import { useLanguage, useT } from "../i18n/index.js";
import { legalDocuments } from "@garanti-kulucka/shared";
import { authMessages } from "../i18n/messages/auth.js";

const rememberEmailKey = "garanti-remember-email";

function readRememberedEmail() {
  try {
    return window.localStorage.getItem(rememberEmailKey);
  } catch {
    return null;
  }
}

export function publicPageFromPath(pathname: string): "privacy" | "terms" | "deletion" | null {
  if (pathname === "/gizlilik-politikasi") return "privacy";
  if (pathname === "/kullanim-kosullari") return "terms";
  if (pathname === "/veri-silme") return "deletion";
  return null;
}

/** Legacy PrivacyPolicyPage / TermsOfServicePage: full text from the shared legal documents (TR/EN). */
export function PublicPage(props: { page: "privacy" | "terms" }) {
  const t = useT(authMessages);
  const { language } = useLanguage();
  const document = legalDocuments[language === "en" ? "en" : "tr"][props.page];

  return (
    <main className="public-page" data-testid={`${props.page}-public-page`}>
      <section className="public-card">
        <NavLink className="back-link" to="/giris">
          <ArrowLeft size={16} aria-hidden="true" />
          {t("backToLogin")}
        </NavLink>
        <div className="public-title">
          <span className="public-icon">{props.page === "privacy" ? <Shield size={20} aria-hidden="true" /> : <FileText size={20} aria-hidden="true" />}</span>
          <div>
            <h1>{document.title}</h1>
            <p>{document.subtitle}</p>
          </div>
        </div>
        <p className="legal-updated">{document.updated}</p>
        {document.sections.map((section) => (
          <section key={section.heading} className="legal-section">
            <h2>{section.heading}</h2>
            {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            {section.items && (
              <ul>
                {section.items.map((item) => (
                  <li key={`${item.label ?? ""}${item.text}`}>
                    {item.label && <strong>{item.label}: </strong>}
                    {item.text}
                  </li>
                ))}
              </ul>
            )}
            {section.after?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            {section.link && (
              <p>
                {section.link.before}
                <NavLink to={section.link.path}>{section.link.label}</NavLink>
                {section.link.after}
              </p>
            )}
          </section>
        ))}
        <p className="legal-updated">{document.footer}</p>
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
  const remembered = readRememberedEmail();

  // Legacy "Beni hatırla" kept the email (and the password) in localStorage; only the email is kept here.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const form = new FormData(event.currentTarget);
    try {
      if (form.get("remember") === "on") window.localStorage.setItem(rememberEmailKey, String(form.get("email") ?? ""));
      else window.localStorage.removeItem(rememberEmailKey);
    } catch {
      // Storage can be unavailable (private mode); remembering is best effort.
    }
    props.onLogin(event);
  }

  return (
    <main className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="brand large">
          <span className="brand-mark">G</span>
          <span>Garanti Kuluçka</span>
        </div>
        <label>
          {t("email")}
          <input name="email" defaultValue={remembered ?? "admin@example.com"} type="email" autoComplete="username" />
        </label>
        <label>
          {t("password")}
          <input name="password" defaultValue="password" type="password" autoComplete="current-password" />
        </label>
        <label className="remember-line">
          <input name="remember" type="checkbox" defaultChecked={remembered !== null} />
          <span>{t("rememberMe")}</span>
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
