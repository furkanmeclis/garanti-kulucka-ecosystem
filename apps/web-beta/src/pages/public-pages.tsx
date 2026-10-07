import { AlertTriangle, ArrowLeft, CheckCircle2, FileText, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { legalDocuments, type LegalDocumentKey } from "@garanti-kulucka/shared";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/app/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LanguageMenu, ThemeMenu } from "@/layout/header-menus";
import { formatDateTime } from "@/lib/format";
import type { DataDeletionStatusLookup } from "@/lib/privacy";
import { errorText, Field } from "./accounting-shared";

/** Shell for the anonymous legacy pages (veri silme, şifre sıfırla, yasal metinler). */
export function PublicLayout({ title, subtitle, icon, children, testId }: { title: string; subtitle?: string; icon: ReactNode; children: ReactNode; testId: string }) {
  const { t } = useTranslation();
  return (
    <main className="min-h-dvh bg-muted/40 px-4 py-6 sm:py-10" data-testid={testId}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <Button asChild variant="ghost" className="min-h-11 -ml-2">
            <Link to="/giris">
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t("dataDeletion.backToLogin")}
            </Link>
          </Button>
          <div className="flex gap-1">
            <LanguageMenu />
            <ThemeMenu />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

const emptyForm = { ad: "", email: "", telefon: "", instagram: "", messenger: "", aciklama: "", onay: false };
const area = "min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

/** /veri-silme — legacy DataDeletionPage: KVKK form (`POST /api/veri-silme-talebi`) and `?ref=` status (Meta callback URL). */
export function DataDeletionPage() {
  const { t, i18n } = useTranslation();
  const { api } = useAuth();
  const [params] = useSearchParams();
  const reference = params.get("ref");
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ reference: string; at: string } | null>(null);
  const [lookup, setLookup] = useState<DataDeletionStatusLookup | "loading" | "missing" | null>(reference ? "loading" : null);

  useEffect(() => {
    if (!reference) return;
    let cancelled = false;
    api
      .dataDeletionStatus(reference)
      .then((result) => !cancelled && setLookup(result))
      .catch(() => !cancelled && setLookup("missing"));
    return () => {
      cancelled = true;
    };
  }, [api, reference]);

  const set = (field: Exclude<keyof typeof emptyForm, "onay">) => (event: { target: { value: string } }) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!form.ad.trim()) return setError(t("dataDeletion.errorName"));
    if (![form.email, form.telefon, form.instagram, form.messenger].some((value) => value.trim())) return setError(t("dataDeletion.errorContact"));
    if (!form.onay) return setError(t("dataDeletion.errorConsent"));
    setSending(true);
    try {
      const at = new Date().toISOString();
      const result = await api.submitDataDeletion({
        ad: form.ad.trim(),
        email: form.email.trim() || null,
        telefon: form.telefon.trim() || null,
        instagram_kullanici_adi: form.instagram.trim().replace(/^@/, "") || null,
        messenger_psid: form.messenger.trim() || null,
        aciklama: form.aciklama.trim() || null,
        tarih: at,
      });
      setSent({ reference: result.reference, at });
    } catch (reason) {
      setError(t("dataDeletion.errorSubmit", { error: errorText(reason) }));
    } finally {
      setSending(false);
    }
  }

  return (
    <PublicLayout title={t("dataDeletion.title")} subtitle={t("dataDeletion.subtitle")} icon={<Trash2 className="size-5" aria-hidden="true" />} testId="page-data-deletion">
      {lookup && (
        <Card className="p-4" data-testid="deletion-status">
          <h2 className="mb-1 font-semibold">{t("dataDeletion.statusTitle")}</h2>
          {lookup === "loading" ? (
            <p className="text-sm text-muted-foreground">{t("dataDeletion.statusLoading")}</p>
          ) : lookup === "missing" ? (
            <p role="alert" className="text-sm text-destructive">
              {t("dataDeletion.statusNotFound")}
            </p>
          ) : (
            <p className="text-sm">
              {t("dataDeletion.reference")}: <strong>{lookup.reference}</strong> · {t(`dataDeletion.status_${lookup.status}`)} · {t("dataDeletion.requestDate")}: {formatDateTime(lookup.requested_at, i18n.language)}
              {lookup.resolved_at && ` · ${t("dataDeletion.resolvedAt")}: ${formatDateTime(lookup.resolved_at, i18n.language)}`}
            </p>
          )}
        </Card>
      )}
      {sent ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center" data-testid="deletion-success">
          <CheckCircle2 className="size-12 text-emerald-600" aria-hidden="true" />
          <h2 className="text-xl font-semibold">{t("dataDeletion.successTitle")}</h2>
          <p className="max-w-md text-sm text-muted-foreground">{t("dataDeletion.successBody")}</p>
          <div className="rounded-md bg-muted px-4 py-3 text-sm">
            <p>
              {t("dataDeletion.requestDate")}: <strong>{formatDateTime(sent.at, i18n.language)}</strong>
            </p>
            <p>
              {t("dataDeletion.reference")}: <strong data-testid="deletion-reference">{sent.reference}</strong>
            </p>
          </div>
          <Button asChild className="min-h-11">
            <Link to="/giris">{t("dataDeletion.backToLogin")}</Link>
          </Button>
        </Card>
      ) : (
        <>
          <Card className="flex gap-3 border-amber-500/40 bg-amber-500/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
            <div>
              <p className="font-medium">{t("dataDeletion.noticeTitle")}</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
                {(["notice1", "notice2", "notice3", "notice4"] as const).map((key) => (
                  <li key={key}>{t(`dataDeletion.${key}`)}</li>
                ))}
              </ul>
            </div>
          </Card>
          <Card className="p-4">
            <h2 className="mb-2 font-semibold">{t("dataDeletion.scopeTitle")}</h2>
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1 pl-4 text-sm text-muted-foreground sm:grid-cols-2 [&>li]:list-disc">
              {(["scope1", "scope2", "scope3", "scope4", "scope5", "scope6", "scope7"] as const).map((key) => (
                <li key={key}>{t(`dataDeletion.${key}`)}</li>
              ))}
            </ul>
          </Card>
          <Card className="p-4 sm:p-6">
            <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate data-testid="deletion-form">
              <h2 className="font-semibold">{t("dataDeletion.formTitle")}</h2>
              {error && (
                <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="deletion-error">
                  {error}
                </p>
              )}
              <Field label={t("dataDeletion.name")}>
                <Input className="h-11 md:h-9" name="ad" autoComplete="name" value={form.ad} onChange={set("ad")} placeholder={t("dataDeletion.namePlaceholder")} />
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t("dataDeletion.email")}>
                  <Input className="h-11 md:h-9" name="email" type="email" autoComplete="email" value={form.email} onChange={set("email")} placeholder="ornek@email.com" />
                </Field>
                <Field label={t("dataDeletion.phone")}>
                  <Input className="h-11 md:h-9" name="telefon" type="tel" autoComplete="tel" value={form.telefon} onChange={set("telefon")} placeholder="+90 5XX XXX XX XX" />
                </Field>
                <Field label={t("dataDeletion.instagram")}>
                  <Input className="h-11 md:h-9" name="instagram" value={form.instagram} onChange={set("instagram")} placeholder="@kullanici_adi" />
                </Field>
                <Field label={t("dataDeletion.messenger")}>
                  <Input className="h-11 md:h-9" name="messenger" value={form.messenger} onChange={set("messenger")} placeholder={t("dataDeletion.messengerPlaceholder")} />
                  <span className="text-xs font-normal text-muted-foreground">{t("dataDeletion.messengerHint")}</span>
                </Field>
              </div>
              <Field label={t("dataDeletion.description")}>
                <textarea className={area} name="aciklama" rows={3} maxLength={2000} value={form.aciklama} onChange={set("aciklama")} placeholder={t("dataDeletion.descriptionPlaceholder")} />
              </Field>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" name="onay" className="mt-0.5 h-11 w-5 shrink-0 accent-primary md:size-5" checked={form.onay} onChange={(event) => setForm((prev) => ({ ...prev, onay: event.target.checked }))} />
                <span className="pt-3 md:pt-0">{t("dataDeletion.consent")}</span>
              </label>
              <Button type="submit" variant="destructive" className="min-h-11 sm:self-start" disabled={sending} data-testid="deletion-submit">
                {sending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
                {sending ? t("dataDeletion.submitting") : t("dataDeletion.submit")}
              </Button>
              <p className="text-xs text-muted-foreground">{t("dataDeletion.alternative")}</p>
            </form>
          </Card>
        </>
      )}
    </PublicLayout>
  );
}

/** /gizlilik-politikasi and /kullanim-kosullari — legacy PrivacyPolicyPage / TermsOfServicePage (shared TR/EN text). */
export function LegalPage({ document: key }: { document: LegalDocumentKey }) {
  const { i18n } = useTranslation();
  const document = legalDocuments[i18n.language === "en" ? "en" : "tr"][key];
  return (
    <PublicLayout
      title={document.title}
      subtitle={document.subtitle}
      icon={key === "privacy" ? <ShieldCheck className="size-5" aria-hidden="true" /> : <FileText className="size-5" aria-hidden="true" />}
      testId={`page-legal-${key}`}
    >
      <Card className="flex flex-col gap-5 p-4 text-sm leading-relaxed sm:p-6">
        <p className="text-xs text-muted-foreground">{document.updated}</p>
        {document.sections.map((section) => (
          <section key={section.heading} className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">{section.heading}</h2>
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph} className="text-muted-foreground">
                {paragraph}
              </p>
            ))}
            {section.items && (
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                {section.items.map((item) => (
                  <li key={`${item.label ?? ""}${item.text}`}>
                    {item.label && <strong className="text-foreground">{item.label}: </strong>}
                    {item.text}
                  </li>
                ))}
              </ul>
            )}
            {section.after?.map((paragraph) => (
              <p key={paragraph} className="text-muted-foreground">
                {paragraph}
              </p>
            ))}
            {section.link && (
              <p className="text-muted-foreground">
                {section.link.before}
                <Link to={section.link.path} className="font-medium text-primary underline-offset-4 hover:underline">
                  {section.link.label}
                </Link>
                {section.link.after}
              </p>
            )}
          </section>
        ))}
        <p className="text-xs text-muted-foreground">{document.footer}</p>
      </Card>
    </PublicLayout>
  );
}

/** /sifre-sifirla — legacy ResetPasswordPage: e-mail request, then the e-mailed `?token` sets a new password. */
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [params] = useSearchParams();
  const token = params.get("token");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (token) {
      if (password.length < 6) return setError(t("passwordReset.tooShort"));
      if (password !== repeat) return setError(t("passwordReset.mismatch"));
    } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      return setError(t("passwordReset.invalidEmail"));
    }
    setBusy(true);
    try {
      if (token) await api.confirmPasswordReset(token, password);
      else await api.requestPasswordReset(email.trim());
      setDone(true);
    } catch (requestError) {
      setError(token ? errorText(requestError) : t("passwordReset.failed", { error: errorText(requestError) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicLayout title={t("passwordReset.title")} subtitle={token ? t("passwordReset.newSubtitle") : t("passwordReset.subtitle")} icon={<ShieldCheck className="size-5" aria-hidden="true" />} testId="reset-password-page">
      <Card className="p-4 sm:p-6">
        {done ? (
          <div className="flex flex-col items-start gap-3" data-testid="reset-password-done">
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-5 text-emerald-600" aria-hidden="true" />
              {token ? t("passwordReset.done") : t("passwordReset.sent")}
            </p>
            <Button asChild className="min-h-11">
              <Link to="/giris">{t("passwordReset.toLogin")}</Link>
            </Button>
          </div>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)} noValidate data-testid="reset-password-form">
            {token ? (
              <>
                <Field label={t("passwordReset.newPassword")}>
                  <Input type="password" name="password" autoComplete="new-password" className="h-11" value={password} onChange={(event) => setPassword(event.target.value)} />
                </Field>
                <Field label={t("passwordReset.newPasswordRepeat")}>
                  <Input type="password" name="password-repeat" autoComplete="new-password" className="h-11" value={repeat} onChange={(event) => setRepeat(event.target.value)} />
                </Field>
              </>
            ) : (
              <Field label={t("passwordReset.email")}>
                <Input type="email" name="email" autoComplete="email" inputMode="email" className="h-11" value={email} onChange={(event) => setEmail(event.target.value)} />
              </Field>
            )}
            {error && (
              <p className="flex items-center gap-2 text-sm text-destructive" role="alert" data-testid="reset-password-error">
                <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}
            <Button type="submit" className="min-h-11" disabled={busy} data-testid="reset-password-submit">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {token ? t("passwordReset.update") : t("passwordReset.send")}
            </Button>
          </form>
        )}
      </Card>
    </PublicLayout>
  );
}
