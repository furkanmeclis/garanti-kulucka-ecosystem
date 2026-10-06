import { Menu, Search, WifiOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation } from "react-router-dom";
import { displayName, initialsOf, useAuth } from "@/app/auth";
import { bottomBarFor, homePathFor, navigationFor, type NavItem } from "@/app/navigation";
import { useOnlineStatus } from "@/app/pwa-hooks";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Brand } from "./brand";
import { GlobalSearch } from "./global-search";
import { LanguageMenu, NotificationBell, ProfileMenu, roleLabelKey, ThemeMenu } from "./header-menus";

function isActive(item: NavItem, pathname: string) {
  return item.path === "/" ? pathname === "/" : pathname === item.path || pathname.startsWith(`${item.path}/`);
}

function MobileMenu() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const items = navigationFor(user?.role);
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
        <nav aria-label={t("nav.main")} className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
          {items.map((item) => (
            <NavLink
              key={item.key}
              to={item.path}
              end={item.path === "/"}
              onClick={() => setOpen(false)}
              className={cn(
                "flex min-h-12 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                isActive(item, pathname) && "bg-accent text-accent-foreground",
              )}
            >
              <item.icon className="size-5" aria-hidden="true" />
              {t(`nav.${item.key}`)}
            </NavLink>
          ))}
        </nav>
        <Separator />
        <div className="flex items-center justify-between gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <span className="text-sm text-muted-foreground">
            {t("header.language")} / {t("header.theme")}
          </span>
          <div className="flex items-center gap-1">
            <LanguageMenu />
            <ThemeMenu />
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

function BottomNav() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const items = bottomBarFor(user?.role);
  if (items.length === 0) return null;
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
                <item.icon className="size-5" aria-hidden="true" />
                <span className="max-w-full truncate">{t(`nav.${item.key}`)}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const online = useOnlineStatus();
  const items = navigationFor(user?.role);
  const hasBottomNav = bottomBarFor(user?.role).length > 0;

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-background focus:p-3">
        {t("app.skipToContent")}
      </a>
      <header
        className="sticky top-0 z-40 border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/80"
        data-testid="topbar"
      >
        <div className="mx-auto flex h-16 max-w-screen-2xl items-center gap-1 px-2 sm:gap-2 sm:px-4">
          <MobileMenu />
          <Brand to={homePathFor(user?.role)} compact className="mr-1 lg:mr-3" />
          <nav aria-label={t("nav.main")} className="hidden shrink-0 items-center gap-0.5 lg:flex xl:gap-1" data-testid="desktop-nav">
            {items.map((item) => (
              <NavLink
                key={item.key}
                to={item.path}
                end={item.path === "/"}
                title={t(`nav.${item.key}`)}
                className={cn(
                  "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                  isActive(item, pathname) && "bg-accent text-accent-foreground",
                )}
              >
                <item.icon className="size-4" aria-hidden="true" />
                {/* lg: icon-only (label stays for screen readers); xl+: icon and label. */}
                <span className="sr-only xl:not-sr-only">{t(`nav.${item.key}`)}</span>
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-0.5 sm:gap-1" data-testid="header-actions">
            <GlobalSearch className="mr-1 hidden w-64 2xl:block" />
            <MobileSearch />
            <NotificationBell />
            <div className="hidden items-center gap-0.5 sm:flex">
              <LanguageMenu />
              <ThemeMenu />
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
        className={cn("mx-auto w-full max-w-screen-2xl min-w-0 flex-1 px-4 py-6 sm:px-6", hasBottomNav && "pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-6")}
        data-testid="main"
      >
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
