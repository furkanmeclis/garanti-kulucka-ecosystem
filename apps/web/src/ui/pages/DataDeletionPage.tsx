import { useEffect, useState, type FormEvent } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CheckCircle, Loader2, Trash2 } from "lucide-react";
import { BackendRequestError, type BackendHttpClient } from "../../api/http-client.js";
import { localeFor, useLanguage, useT } from "../i18n/index.js";
import { dataDeletionMessages } from "../i18n/messages/dataDeletion.js";

type DeletionStatus = "pending" | "in_progress" | "completed" | "rejected";
interface StatusLookup {
  reference: string;
  status: DeletionStatus;
  requested_at: string;
  resolved_at: string | null;
}

const emptyForm = { ad: "", email: "", telefon: "", instagram: "", messenger: "", aciklama: "", onay: false };

function errorMessage(error: unknown) {
  if (error instanceof BackendRequestError) {
    const body = error.body as { error?: { message?: unknown } } | null | undefined;
    if (typeof body?.error?.message === "string") return body.error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Legacy parity: pages/legal/DataDeletionPage.jsx. Posts to the public `POST /api/veri-silme-talebi`
 * (stored, `DEL-` reference); `?ref=DEL-...` (the Meta data deletion callback URL) shows that request's status.
 */
export function DataDeletionPage({ http }: { http: BackendHttpClient }) {
  const t = useT(dataDeletionMessages);
  const { language } = useLanguage();
  const location = useLocation();
  const reference = new URLSearchParams(location.search).get("ref");
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ reference: string; at: Date } | null>(null);
  const [lookup, setLookup] = useState<StatusLookup | "loading" | "missing" | null>(reference ? "loading" : null);

  useEffect(() => {
    if (!reference) return;
    let cancelled = false;
    http
      .request<StatusLookup>(`/api/veri-silme-talebi/${encodeURIComponent(reference)}`)
      .then((result) => !cancelled && setLookup(result))
      .catch(() => !cancelled && setLookup("missing"));
    return () => {
      cancelled = true;
    };
  }, [http, reference]);

  const set = (field: keyof typeof emptyForm) => (event: { target: { value: string; checked?: boolean; type?: string } }) =>
    setForm((prev) => ({ ...prev, [field]: event.target.type === "checkbox" ? Boolean(event.target.checked) : event.target.value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!form.ad.trim()) return setError(t("errorName"));
    if (![form.email, form.telefon, form.instagram, form.messenger].some((value) => value.trim())) return setError(t("errorContact"));
    if (!form.onay) return setError(t("errorConsent"));
    setSending(true);
    try {
      const result = await http.request<{ reference: string }>("/api/veri-silme-talebi", {
        method: "POST",
        body: {
          ad: form.ad.trim(),
          email: form.email.trim() || null,
          telefon: form.telefon.trim() || null,
          instagram_kullanici_adi: form.instagram.trim().replace(/^@/, "") || null,
          messenger_psid: form.messenger.trim() || null,
          aciklama: form.aciklama.trim() || null,
          tarih: new Date().toISOString(),
        },
      });
      setSent({ reference: result.reference, at: new Date() });
    } catch (submitError) {
      setError(t("errorSubmit", { error: errorMessage(submitError) }));
    } finally {
      setSending(false);
    }
  }

  const date = (value: Date | string) => new Date(value).toLocaleDateString(localeFor(language));

  return (
    <main className="public-page" data-testid="deletion-public-page">
      <section className="public-card">
        <NavLink className="back-link" to="/giris">
          <ArrowLeft size={16} aria-hidden="true" />
          {t("backToLogin")}
        </NavLink>
        <div className="public-title">
          <span className="public-icon">
            <Trash2 size={20} aria-hidden="true" />
          </span>
          <div>
            <h1>{t("title")}</h1>
            <p>{t("subtitle")}</p>
          </div>
        </div>

        {lookup && (
          <div className="deletion-box" data-testid="deletion-status">
            <h2>{t("statusTitle")}</h2>
            {lookup === "loading" ? (
              <p>{t("statusLoading")}</p>
            ) : lookup === "missing" ? (
              <p role="alert">{t("statusNotFound")}</p>
            ) : (
              <p>
                {t("reference")}: <strong>{lookup.reference}</strong> · {t(`status_${lookup.status}`)} · {t("requestDate")}: {date(lookup.requested_at)}
                {lookup.resolved_at && ` · ${t("resolvedAt")}: ${date(lookup.resolved_at)}`}
              </p>
            )}
          </div>
        )}

        {sent ? (
          <div className="deletion-box deletion-success" data-testid="deletion-success">
            <CheckCircle size={40} aria-hidden="true" />
            <h2>{t("successTitle")}</h2>
            <p>{t("successBody")}</p>
            <p>
              {t("requestDate")}: <strong>{date(sent.at)}</strong>
            </p>
            <p>
              {t("reference")}: <strong data-testid="deletion-reference">{sent.reference}</strong>
            </p>
            <NavLink className="primary-action" to="/giris">
              {t("backToLogin")}
            </NavLink>
          </div>
        ) : (
          <>
            <div className="deletion-box deletion-notice">
              <AlertTriangle size={18} aria-hidden="true" />
              <div>
                <strong>{t("noticeTitle")}</strong>
                <ul>
                  {(["notice1", "notice2", "notice3", "notice4"] as const).map((key) => (
                    <li key={key}>{t(key)}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="deletion-box">
              <h2>{t("scopeTitle")}</h2>
              <ul className="deletion-scope">
                {(["scope1", "scope2", "scope3", "scope4", "scope5", "scope6", "scope7"] as const).map((key) => (
                  <li key={key}>{t(key)}</li>
                ))}
              </ul>
            </div>
            <form className="deletion-form" onSubmit={(event) => void submit(event)} data-testid="deletion-form" noValidate>
              <h2>{t("formTitle")}</h2>
              {error && (
                <p className="deletion-error" role="alert" data-testid="deletion-error">
                  {error}
                </p>
              )}
              <label>
                {t("name")}
                <input name="ad" value={form.ad} onChange={set("ad")} placeholder={t("namePlaceholder")} autoComplete="name" />
              </label>
              <label>
                {t("email")}
                <input name="email" type="email" value={form.email} onChange={set("email")} placeholder="ornek@email.com" autoComplete="email" />
              </label>
              <label>
                {t("phone")}
                <input name="telefon" type="tel" value={form.telefon} onChange={set("telefon")} placeholder="+90 5XX XXX XX XX" autoComplete="tel" />
              </label>
              <label>
                {t("instagram")}
                <input name="instagram" value={form.instagram} onChange={set("instagram")} placeholder="@kullanici_adi" />
              </label>
              <label>
                {t("messenger")}
                <input name="messenger" value={form.messenger} onChange={set("messenger")} placeholder={t("messengerPlaceholder")} />
                <span className="deletion-hint">{t("messengerHint")}</span>
              </label>
              <label>
                {t("description")}
                <textarea name="aciklama" rows={3} maxLength={2000} value={form.aciklama} onChange={set("aciklama")} placeholder={t("descriptionPlaceholder")} />
              </label>
              <label className="deletion-consent">
                <input name="onay" type="checkbox" checked={form.onay} onChange={set("onay")} />
                <span>{t("consent")}</span>
              </label>
              <button className="primary-action danger" type="submit" disabled={sending}>
                {sending ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
                {sending ? t("submitting") : t("submit")}
              </button>
              <p className="deletion-hint">{t("alternative")}</p>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
