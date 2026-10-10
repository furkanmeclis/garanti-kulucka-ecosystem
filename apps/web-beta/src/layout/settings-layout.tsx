import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/app/auth";
import { navOwnerOf, settingsNavFor, type NavItem, type SettingsSection } from "@/app/navigation";
import { cn } from "@/lib/utils";
import { PageHeadingLevel } from "./page-header";

const sectionLabel = {
  general: "nav.settingsGeneral",
  management: "nav.settingsManagement",
  developer: "nav.settingsDeveloper",
} as const satisfies Record<SettingsSection, string>;

/** Sub-nav label: /ayarlar itself is the "Genel" entry; the other pages keep their menu names. */
export function settingsItemLabelKey(item: NavItem) {
  return item.key === "settings" ? "nav.settingsGeneral" : (`nav.${item.key}` as const);
}

/**
 * Settings area (shadcn "settings/forms" layout): title, a left sub-nav grouped by section and the
 * page on the right. Below lg the sub-nav turns into one horizontally scrolling row. The pages keep
 * their own URLs (/kullanicilar, /kargolar/cron-debug, …) and render through <Outlet />.
 */
export function SettingsLayout() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const sections = settingsNavFor(user?.role);
  const activeKey = navOwnerOf(pathname)?.key;

  return (
    <div data-testid="settings-layout">
      <div className="mb-6 border-b pb-5">
        <h1 className="text-2xl font-semibold tracking-tight">{t("nav.settings")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("nav.settingsDescription")}</p>
      </div>
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
        <aside className="-mx-4 min-w-0 sm:-mx-6 lg:mx-0 lg:w-56 lg:shrink-0">
          <nav aria-label={t("nav.settingsNav")} className="flex gap-1 overflow-x-auto px-4 pb-1 sm:px-6 lg:flex-col lg:gap-4 lg:overflow-visible lg:px-0" data-testid="settings-nav">
            {sections.map((section, index) => (
              <div key={section.key} className={cn("flex shrink-0 gap-1 lg:flex-col", index > 0 && "border-l pl-1 lg:border-l-0 lg:pl-0")} data-testid={`settings-nav-${section.key}`}>
                {/* Headings only make sense in the vertical list; the mobile row stays a flat strip. */}
                <p className="hidden px-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase lg:block">{t(sectionLabel[section.key])}</p>
                {section.items.map((item) => {
                  const active = item.key === activeKey;
                  return (
                    <Link
                      key={item.key}
                      to={item.path}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                        active && "bg-accent text-accent-foreground",
                      )}
                      data-testid={`settings-nav-item-${item.key}`}
                    >
                      <item.icon className="size-4" aria-hidden="true" />
                      {t(settingsItemLabelKey(item))}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>
        <div className="min-w-0 flex-1">
          <PageHeadingLevel.Provider value={2}>
            <Outlet />
          </PageHeadingLevel.Provider>
        </div>
      </div>
    </div>
  );
}
