import { ChevronDown, Menu, Search, Settings, WifiOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { displayName, initialsOf, useAuth } from "@/app/auth";
import { bottomBarFor, homePathFor, mainNavigationFor, navGroupsFor, navOwnerOf, settingsNavFor, type NavItem } from "@/app/navigation";
import { useOnlineStatus } from "@/app/pwa-hooks";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { NavIcon } from "@/components/nav-icon";
import { Tip } from "@/components/ui/tooltip";
import { Brand } from "./brand";
import { ShellChromeProvider, useShellChrome, useVisualViewportHeight } from "./shell-chrome";
import { GlobalSearch } from "./global-search";
import { LanguageMenu, NotificationBell, ProfileMenu, roleLabelKey, ThemeToggle, useNavCounts } from "./header-menus";
import { settingsItemLabelKey } from "./settings-layout";

function isActive(item: NavItem, pathname: string) {
  return item.path === "/" ? pathname === "/" : pathname === item.path || pathname.startsWith(`${item.path}/`);
}

/** Top bar and sheet highlight the most specific owner, so /kargolar/cron-debug lights up settings, not Kargolar. */
function useNavOwner() {
  return navOwnerOf(useLocation().pathname);
}

function MobileMenu() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const owner = useNavOwner();
  const [open, setOpen] = useState(false);
  const items = mainNavigationFor(user?.role);
  const groups = navGroupsFor(user?.role);
  const settings = settingsNavFor(user?.role).flatMap((section) => section.items);
  const counts = useNavCounts();
  const badgeFor = (key: string) => counts.find((entry) => entry.key === key && entry.count > 0);
  const link = (item: NavItem, label: string = t(`nav.${item.key}`)) => (
    <Link
      key={item.key}
      to={item.path}
      onClick={() => setOpen(false)}
      aria-current={owner?.key === item.key ? "page" : undefined}
      className={cn(
        "flex min-h-12 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        owner?.key === item.key && "bg-accent text-accent-foreground",
      )}
    >
      <NavIcon item={item} className="size-5" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {(() => {
        const badge = badgeFor(item.key);
        return badge ? (
          <span
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground tabular-nums"
            aria-label={t(badge.label, { count: badge.count })}
            data-testid={`mobile-menu-badge-${item.key}`}
          >
            {badge.count > 99 ? "99+" : badge.count}
          </span>
        ) : null;
      })()}
    </Link>
  );
  const sectionTitle = "px-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase";
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t("nav.openMenu")} data-testid="mobile-menu-trigger">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" closeLabel={t("nav.closeMenu")} className="gap-0 p-0" data-testid="mobile-menu">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-3">
            <Avatar className="size-10">
              <AvatarFallback>{initialsOf(user)}</AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-col text-left">
              <span className="truncate">{displayName(user)}</span>
              <span className="text-xs font-normal text-muted-foreground">{t(roleLabelKey(user?.role))}</span>
            </span>
          </SheetTitle>
          <SheetDescription className="sr-only">{t("nav.main")}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col overflow-y-auto">
          <nav aria-label={t("nav.main")} className="flex flex-col gap-1 p-3" data-testid="mobile-menu-main">
            {items.map((item) => link(item))}
          </nav>
          {groups.map((group) => (
            <nav key={group.key} aria-label={t(`nav.${group.key}`)} className="flex flex-col gap-1 border-t p-3" data-testid={`mobile-menu-${group.key}`}>
              <p className={sectionTitle}>{t(`nav.${group.key}`)}</p>
              {group.items.map((item) => link(item))}
            </nav>
          ))}
          <nav aria-label={t("nav.settings")} className="flex flex-col gap-1 border-t p-3" data-testid="mobile-menu-settings">
            <p className={sectionTitle}>{t("nav.settings")}</p>
            {settings.map((item) => link(item, t(settingsItemLabelKey(item))))}
          </nav>
        </div>
        <Separator />
        <div className="flex items-center justify-between gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <span className="text-sm text-muted-foreground">
            {t("header.language")} / {t("header.theme")}
          </span>
          <div className="flex items-center gap-1">
            <LanguageMenu />
            <ThemeToggle />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MobileSearch() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="2xl:hidden" aria-label={t("header.search")} data-testid="search-trigger">
          <Search className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="top" closeLabel={t("nav.closeMenu")} className="p-4 pr-16">
        <SheetHeader className="sr-only p-0">
          <SheetTitle>{t("header.search")}</SheetTitle>
          <SheetDescription>{t("header.searchPlaceholder")}</SheetDescription>
        </SheetHeader>
        <GlobalSearch autoFocus onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

function BottomNav({ hidden }: { hidden?: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const items = bottomBarFor(user?.role);
  if (items.length === 0 || hidden) return null;
  return (
    <nav
      aria-label={t("nav.bottom")}
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden"
      data-testid="bottom-nav"
    >
      <ul className="mx-auto flex max-w-lg">
        {items.map((item) => {
          const active = isActive(item, pathname);
          return (
            <li key={item.key} className="min-w-0 flex-1">
              <NavLink
                to={item.path}
                end={item.path === "/"}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium text-muted-foreground",
                  active && "text-primary",
                )}
              >
                <NavIcon item={item} className="size-5" />
                <span className="max-w-full truncate">{t(`nav.${item.key}`)}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Routes that render edge to edge at full height (the shell stops scrolling, the page manages its own panes). */
const fullBleedPaths = new Set(["/mesajlar"]);

const topLinkClass =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground";

/** Desktop dropdown for one menu group (Operasyon, Muhasebe, …); active while any of its pages is open. */
function NavGroupMenu({ group }: { group: ReturnType<typeof navGroupsFor>[number] }) {
  const { t } = useTranslation();
  const owner = useNavOwner();
  const navigate = useNavigate();
  const label = t(`nav.${group.key}`);
  const active = owner?.group === group.key;
  return (
    <DropdownMenu>
      <Tip label={label}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className={cn("min-h-11 min-w-11 gap-0.5 px-1.5 text-sm font-medium text-muted-foreground", active && "bg-accent text-accent-foreground")}
          aria-label={label}
          data-testid={`nav-group-trigger-${group.key}`}
        >
          <NavIcon item={group} className="size-4" />
          {/* Icon-only on every desktop width (like the old "More" trigger): the labelled main links plus four
              labelled groups need ~1150 px and overflow even the 1536 px container, so the name lives in
              the tooltip, the accessible name and the menu heading. */}
          <span className="sr-only">{label}</span>
          <ChevronDown className="size-3" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="start" className="min-w-52" data-testid={`nav-group-menu-${group.key}`}>
        <DropdownMenuLabel className="text-xs text-muted-foreground">{label}</DropdownMenuLabel>
        {group.items.map((item) => (
          <DropdownMenuItem key={item.key} onSelect={() => navigate(item.path)} className={cn("min-h-10 gap-3", owner?.key === item.key && "bg-accent/60")} data-testid={`nav-item-${item.key}`}>
            <NavIcon item={item} className="size-4" />
            {t(`nav.${item.key}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ShellChromeProvider>
      <ShellFrame>{children}</ShellFrame>
    </ShellChromeProvider>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const owner = useNavOwner();
  const online = useOnlineStatus();
  const items = mainNavigationFor(user?.role);
  const groups = navGroupsFor(user?.role);
  const settingsActive = owner?.group === "settings";
  const hasBottomNav = bottomBarFor(user?.role).length > 0;
  // Legacy MainLayout: Mesajlar fills the viewport under the navbar (no padding, no max width, panes scroll inside).
  const fullBleed = fullBleedPaths.has(useLocation().pathname);
  // Immersive (open chat below lg): no navbar / bottom bar; the page draws its own safe-area padding.
  const { immersive } = useShellChrome();
  const bare = fullBleed && immersive;
  useVisualViewportHeight(fullBleed);

  return (
    <div className={cn("flex flex-col", fullBleed ? "h-[var(--app-vvh,100dvh)] overflow-hidden lg:h-dvh" : "min-h-dvh")}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-background focus:p-3">
        {t("app.skipToContent")}
      </a>
      <header
        className={cn(
          "sticky top-0 z-40 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/80",
          bare && "max-lg:hidden",
        )}
        data-testid="topbar"
      >
        <div className="mx-auto flex h-16 max-w-screen-2xl items-center gap-1 px-2 sm:gap-2 sm:px-4">
          <MobileMenu />
          <Brand to={homePathFor(user?.role)} compact className="mr-1 lg:mr-3" />
          <nav aria-label={t("nav.main")} className="hidden shrink-0 items-center gap-0.5 lg:flex" data-testid="desktop-nav">
            {items.map((item) => (
              <Tip label={t(`nav.${item.key}`)}><Link
                key={item.key}
                to={item.path}
                aria-current={owner?.key === item.key ? "page" : undefined}
                className={cn(topLinkClass, owner?.key === item.key && "bg-accent text-accent-foreground")}
              >
                <NavIcon item={item} className="size-4" />
                {/* lg: icon-only (label stays for screen readers); xl+: icon and label. */}
                <span className="sr-only xl:not-sr-only">{t(`nav.${item.key}`)}</span>
              </Link></Tip>
            ))}
            {groups.map((group) => (
              <NavGroupMenu key={group.key} group={group} />
            ))}
            {/* Settings is a single link: its pages have their own sub-nav (SettingsLayout). */}
            <Tip label={t("nav.settings")}><Link
              to="/ayarlar"
              aria-current={settingsActive ? "page" : undefined}
              className={cn(topLinkClass, "px-0", settingsActive && "bg-accent text-accent-foreground")}
              data-testid="desktop-settings-link"
            >
              <Settings className="size-4" aria-hidden="true" />
              <span className="sr-only">{t("nav.settings")}</span>
            </Link></Tip>
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-0.5 sm:gap-1" data-testid="header-actions">
            <GlobalSearch className="mr-1 hidden w-56 2xl:block" />
            <MobileSearch />
            <NotificationBell />
            <div className="hidden items-center gap-0.5 sm:flex">
              <LanguageMenu />
              <ThemeToggle />
            </div>
            <ProfileMenu />
          </div>
        </div>
        {!online && (
          <div role="status" className="flex items-center justify-center gap-2 bg-amber-500/15 px-4 py-2 text-center text-sm text-amber-800 dark:text-amber-200" data-testid="offline-banner">
            <WifiOff className="size-4 shrink-0" aria-hidden="true" />
            {t("app.offlineBanner")}
          </div>
        )}
      </header>
      <main
        id="main"
        className={cn(
          fullBleed
            ? cn("flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden", hasBottomNav && !bare && "pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0")
            : cn("mx-auto w-full max-w-screen-2xl min-w-0 flex-1 px-4 py-6 sm:px-6", hasBottomNav && "pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-6"),
        )}
        data-testid="main"
      >
        {children}
      </main>
      <BottomNav hidden={bare} />
    </div>
  );
}
