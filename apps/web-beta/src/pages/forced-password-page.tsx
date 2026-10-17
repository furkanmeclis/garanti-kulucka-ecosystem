import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/app/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { errorText, Field } from "./accounting-shared";

export function ForcedPasswordPage() {
  const { t } = useTranslation();
  const { api, updateUser, logout } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirmation) { setError(t("forcedPassword.mismatch")); return; }
    setSaving(true);
    try {
      await api.changePassword({ password, password_confirmation: confirmation });
      // Re-read the authoritative flag before mounting any authenticated application UI.
      updateUser(await api.me());
    } catch (cause) { setError(t("forcedPassword.failed") + " " + errorText(cause)); }
    finally { setSaving(false); }
  }
  return (
    <main className="flex min-h-dvh items-center justify-center p-4" data-testid="forced-password-screen">
      <Card className="w-full max-w-md p-6">
        <h1 className="text-xl font-semibold">{t("forcedPassword.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("forcedPassword.description")}</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label={t("forcedPassword.password")}><Input aria-label={t("forcedPassword.password")} type="password" autoComplete="new-password" minLength={6} maxLength={200} required value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
          <Field label={t("forcedPassword.confirmation")}><Input aria-label={t("forcedPassword.confirmation")} type="password" autoComplete="new-password" minLength={6} maxLength={200} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={saving}>{t("forcedPassword.submit")}</Button>
          <Button type="button" variant="outline" className="w-full" disabled={saving} onClick={() => void logout()}>{t("forcedPassword.logout")}</Button>
        </form>
      </Card>
    </main>
  );
}
