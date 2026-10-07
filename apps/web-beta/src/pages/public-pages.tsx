import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, Trash2 } from "lucide-react";
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
