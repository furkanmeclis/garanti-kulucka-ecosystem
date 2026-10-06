import { Search } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/app/auth";
import { navigationFor, type NavKey } from "@/app/navigation";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Pages that accept `?q=` searches, in the order offered. */
const searchablePages: readonly NavKey[] = ["orders", "customers", "shipments", "messages"];

export function useSearchTargets() {
  const { user } = useAuth();
  const allowed = navigationFor(user?.role);
  return searchablePages.flatMap((key) => allowed.filter((item) => item.key === key));
}

/** Global search: submits to the first searchable page; suggestions let the user pick another page. */
export function GlobalSearch({ className, autoFocus, onNavigate }: { className?: string; autoFocus?: boolean; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const targets = useSearchTargets();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const listId = useId();
  const trimmed = query.trim();

  function go(path: string) {
    if (!trimmed) return;
    navigate(`${path}?q=${encodeURIComponent(trimmed)}`);
    setQuery("");
    setFocused(false);
    onNavigate?.();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (targets[0]) go(targets[0].path);
  }

  return (
    <form role="search" onSubmit={submit} className={cn("relative min-w-0", className)} data-testid="global-search">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        type="search"
        value={query}
        autoFocus={autoFocus}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => window.setTimeout(() => setFocused(false), 150)}
        placeholder={t("header.searchPlaceholder")}
        aria-label={t("header.search")}
        aria-controls={listId}
        className="pl-9"
      />
      {focused && trimmed && targets.length > 0 && (
        <ul id={listId} className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-md border bg-popover p-1 shadow-md">
          {targets.map((target) => (
            <li key={target.key}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => go(target.path)}
              >
                <target.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{t("header.searchIn", { page: t(`nav.${target.key}`), query: trimmed })}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
