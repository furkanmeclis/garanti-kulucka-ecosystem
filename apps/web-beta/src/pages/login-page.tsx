import { Loader2, LogIn, WifiOff } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/app/auth";
import { canAccessPath, homePathFor } from "@/app/navigation";
import { useOnlineStatus } from "@/app/pwa-hooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LanguageMenu, ThemeToggle } from "@/layout/header-menus";
import { ApiError, isNetworkError } from "@/lib/api";

export function redirectTarget(state: unknown) {
  const from = (state as { from?: string } | null)?.from;
  return typeof from === "string" && from.startsWith("/") && from !== "/giris" ? from : null;
}

const rememberEmailKey = "garanti-beta-remember-email";

function readRememberedEmail() {
  try {
    return window.localStorage.getItem(rememberEmailKey);
  } catch {
    return null;
  }
}

export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const online = useOnlineStatus();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remembered] = useState(readRememberedEmail);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    // Legacy "Beni hatırla" also stored the password; only the email is remembered here.
    try {
      if (form.get("remember") === "on") window.localStorage.setItem(rememberEmailKey, String(form.get("email") ?? ""));
      else window.localStorage.removeItem(rememberEmailKey);
    } catch {
      // Storage may be unavailable (private mode); remembering is best effort.
    }
    setSubmitting(true);
    setError(null);
    try {
      const user = await login(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
      const target = redirectTarget(location.state);
      navigate(target && canAccessPath(user.role, target.split("?")[0] ?? target) ? target : homePathFor(user.role), { replace: true });
    } catch (reason) {
      setError(
        isNetworkError(reason) ? t("login.offline") : reason instanceof ApiError && (reason.status === 401 || reason.status === 400) ? t("login.invalid") : t("login.failed"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative grid min-h-dvh place-items-center bg-muted/40 p-4">
      <div className="absolute top-[max(0.5rem,env(safe-area-inset-top))] right-2 flex gap-1">
        <LanguageMenu />
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <img src="/favicon.svg" alt="" className="mb-2 size-12" width={48} height={48} />
          <CardTitle className="text-xl">{t("login.title")}</CardTitle>
          <CardDescription>{t("login.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit} data-testid="login-form">
            {!online && (
              <p className="flex items-center gap-2 rounded-md bg-amber-500/15 p-3 text-sm text-amber-800 dark:text-amber-200" role="status">
                <WifiOff className="size-4 shrink-0" aria-hidden="true" />
                {t("login.offline")}
              </p>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">{t("login.email")}</Label>
              <Input id="email" name="email" type="email" autoComplete="username" inputMode="email" required defaultValue={remembered ?? ""} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">{t("login.password")}</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" name="remember" className="h-11 w-5 accent-primary md:size-5" defaultChecked={remembered !== null} data-testid="login-remember" />
              {t("login.rememberMe")}
            </label>
            <Link to="/sifre-sifirla" className="-mt-2 inline-flex min-h-11 items-center self-end text-sm text-primary underline-offset-4 hover:underline" data-testid="login-forgot">
              {t("login.forgotPassword")}
            </Link>
            {error && (
              <p className="text-sm text-destructive" role="alert" data-testid="login-error">
                {error}
              </p>
            )}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <LogIn aria-hidden="true" />}
              {submitting ? t("login.submitting") : t("login.submit")}
            </Button>
          </form>
          <nav className="mt-4 flex flex-wrap justify-center gap-x-1 text-sm" aria-label={t("login.title")} data-testid="login-links">
            {(
              [
                ["/gizlilik-politikasi", "privacy"],
                ["/kullanim-kosullari", "terms"],
                ["/veri-silme", "deletion"],
              ] as const
            ).map(([to, key]) => (
              <Link key={to} to={to} className="inline-flex min-h-11 items-center px-2 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                {t(`login.${key}`)}
              </Link>
            ))}
          </nav>
        </CardContent>
      </Card>
    </main>
  );
}
