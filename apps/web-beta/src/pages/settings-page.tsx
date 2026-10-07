import { panelRoleOf } from "@garanti-kulucka/shared";
import { CheckCircle2, Download, Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/app/auth";
import { useInstallPrompt } from "@/app/pwa-hooks";
import { useTheme, type ThemePreference } from "@/app/theme";
import { FilterSelect } from "@/components/list-toolbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { roleLabelKey } from "@/layout/header-menus";
import { PageHeader } from "@/layout/page-header";
import { isLanguage } from "@/i18n";
import { cn } from "@/lib/utils";
import { NativeSelect } from "./accounting-shared";
import { AiSettingsTab, IntegrationsOverviewTab, MetaProviderTab, NetgsmTab, SantralTab, WhatsAppTab } from "./settings-tabs";

type Feedback = { tone: "success" | "error"; text: string } | null;

function FeedbackLine({ feedback, testId }: { feedback: Feedback; testId: string }) {
  if (!feedback) return null;
  return (
    <p role={feedback.tone === "error" ? "alert" : "status"} className={feedback.tone === "error" ? "text-sm text-destructive" : "flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300"} data-testid={testId}>
      {feedback.tone === "success" && <CheckCircle2 className="size-4" aria-hidden="true" />}
      {feedback.text}
    </p>
  );
}

function ProfileCard() {
  const { t } = useTranslation();
  const { api, user, updateUser } = useAuth();
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setFeedback(null);
    try {
      const updated = await api.updateProfile({ first_name: String(form.get("first_name") ?? "").trim(), last_name: String(form.get("last_name") ?? "").trim() });
      updateUser(updated);
      setFeedback({ tone: "success", text: t("settings.profileUpdated") });
    } catch {
      setFeedback({ tone: "error", text: t("common.error") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card data-testid="settings-profile">
      <CardHeader>
        <CardTitle>{t("settings.profile")}</CardTitle>
        <CardDescription>{t("settings.profileDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="first_name">{t("settings.firstName")}</Label>
            <Input id="first_name" name="first_name" defaultValue={user?.first_name ?? ""} required autoComplete="given-name" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="last_name">{t("settings.lastName")}</Label>
            <Input id="last_name" name="last_name" defaultValue={user?.last_name ?? ""} autoComplete="family-name" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{t("settings.email")}</Label>
            <Input id="email" value={user?.email ?? ""} readOnly disabled />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="role">{t("settings.role")}</Label>
            <Input id="role" value={t(roleLabelKey(user?.role))} readOnly disabled />
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={saving} data-testid="profile-save">
              {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
              {saving ? t("common.saving") : t("common.save")}
            </Button>
            <FeedbackLine feedback={feedback} testId="profile-feedback" />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const { t } = useTranslation();
  const { api } = useAuth();
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("password_confirmation") ?? "");
    if (password.length < 8) return setFeedback({ tone: "error", text: t("settings.passwordTooShort") });
    if (password !== confirmation) return setFeedback({ tone: "error", text: t("settings.passwordMismatch") });
    setSaving(true);
    setFeedback(null);
    try {
      await api.changePassword({ password, password_confirmation: confirmation });
      formElement.reset();
      setFeedback({ tone: "success", text: t("settings.passwordUpdated") });
    } catch {
      setFeedback({ tone: "error", text: t("common.error") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card data-testid="settings-password">
      <CardHeader>
        <CardTitle>{t("settings.password")}</CardTitle>
        <CardDescription>{t("settings.passwordDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{t("settings.newPassword")}</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password_confirmation">{t("settings.confirmPassword")}</Label>
            <Input id="password_confirmation" name="password_confirmation" type="password" autoComplete="new-password" required />
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" variant="secondary" disabled={saving} data-testid="password-save">
              {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
              {saving ? t("common.saving") : t("common.save")}
            </Button>
            <FeedbackLine feedback={feedback} testId="password-feedback" />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PreferencesCard() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { canInstall, installed, install } = useInstallPrompt();
  return (
    <Card data-testid="settings-preferences">
      <CardHeader>
        <CardTitle>{t("settings.preferences")}</CardTitle>
        <CardDescription>{t("settings.preferencesDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t("header.language")}</span>
            <FilterSelect
              testId="settings-language"
              label={t("header.language")}
              value={i18n.language}
              onChange={(value) => isLanguage(value) && void i18n.changeLanguage(value)}
              options={[
                { value: "tr", label: "Türkçe" },
                { value: "en", label: "English" },
              ]}
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t("header.theme")}</span>
            <FilterSelect
              testId="settings-theme"
              label={t("header.theme")}
              value={theme}
              onChange={(value) => setTheme(value as ThemePreference)}
              options={[
                { value: "light", label: t("header.themeLight") },
                { value: "dark", label: t("header.themeDark") },
                { value: "system", label: t("header.themeSystem") },
              ]}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2" data-testid="settings-install">
          <span className="text-sm font-medium">{t("settings.app")}</span>
          <p className="text-sm text-muted-foreground">{t("settings.appDescription")}</p>
          {installed ? (
            <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              {t("settings.installed")}
            </p>
          ) : canInstall ? (
            <Button className="self-start" onClick={() => void install()}>
              <Download />
              {t("header.install")}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">{t("settings.installUnavailable")}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type SettingsTab = "account" | "ai" | "integrations" | "whatsapp" | "instagram" | "messenger" | "netgsm" | "santral";

const managerTabs: SettingsTab[] = ["account", "ai", "integrations", "whatsapp", "instagram", "messenger", "netgsm", "santral"];

const tabLabel = {
  account: "settingsTabs.tabAccount",
  ai: "settingsTabs.tabAi",
  integrations: "settingsTabs.tabIntegrations",
  whatsapp: "settingsTabs.tabWhatsapp",
  instagram: "settingsTabs.tabInstagram",
  messenger: "settingsTabs.tabMessenger",
  netgsm: "settingsTabs.tabNetgsm",
  santral: "settingsTabs.tabSantral",
} as const;

function AccountTab() {
  return (
    <div className="grid gap-6 xl:grid-cols-2" data-testid="settings-tab-panel-account">
      <ProfileCard />
      <PasswordCard />
      <div className="xl:col-span-2">
        <PreferencesCard />
      </div>
    </div>
  );
}

/**
 * /ayarlar — profile, password and preferences for every role; managers also get the web
 * AyarlarPage provider tabs (AI, integrations overview, WhatsApp, Instagram, Messenger, NetGSM,
 * Santral). Users, logs, data deletion, VAPI and the cargo pipeline keep their own pages and are
 * linked from the integrations overview. The selected tab lives in `?tab=`.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const manager = panelRoleOf(user?.role) === "manager";
  const tabs: SettingsTab[] = manager ? managerTabs : ["account"];
  const requested = params.get("tab") as SettingsTab | null;
  const tab: SettingsTab = requested && tabs.includes(requested) ? requested : "account";

  const select = (next: SettingsTab) => {
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        if (next === "account") copy.delete("tab");
        else copy.set("tab", next);
        return copy;
      },
      { replace: true },
    );
  };

  return (
    <section data-testid="page-settings">
      <PageHeader title={t("settings.title")} description={manager ? t("settingsTabs.managerSubtitle") : t("settings.subtitle")} />
      {tabs.length > 1 && (
        <>
          <div className="mb-4 md:hidden">
            <NativeSelect aria-label={t("settingsTabs.tabsLabel")} value={tab} onChange={(event) => select(event.target.value as SettingsTab)} data-testid="settings-tab-select">
              {tabs.map((id) => (
                <option key={id} value={id}>
                  {t(tabLabel[id])}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="mb-6 hidden flex-wrap gap-1 border-b md:flex" role="tablist" aria-label={t("settingsTabs.tabsLabel")} data-testid="settings-tabs">
            {tabs.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={cn("-mb-px min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium transition-colors", tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
                onClick={() => select(id)}
                data-testid={`settings-tab-${id}`}
              >
                {t(tabLabel[id])}
              </button>
            ))}
          </div>
        </>
      )}
      {tab === "account" && <AccountTab />}
      {tab === "ai" && <AiSettingsTab />}
      {tab === "integrations" && <IntegrationsOverviewTab onOpen={select} />}
      {tab === "whatsapp" && <WhatsAppTab />}
      {(tab === "instagram" || tab === "messenger") && <MetaProviderTab key={tab} provider={tab} />}
      {tab === "netgsm" && <NetgsmTab />}
      {tab === "santral" && <SantralTab />}
    </section>
  );
}
