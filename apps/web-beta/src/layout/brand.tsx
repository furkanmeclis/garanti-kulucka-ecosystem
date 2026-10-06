import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export function Brand({ to, className, compact = false }: { to: string; className?: string; compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <Link to={to} className={cn("flex min-h-11 min-w-11 shrink-0 items-center gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", className)} data-testid="brand">
      <img src="/favicon.svg" alt="" className="size-8" width={32} height={32} />
      <span className={cn("flex items-baseline gap-1.5 font-semibold tracking-tight", compact && "max-sm:sr-only")}>
        <span className="whitespace-nowrap">{t("app.name")}</span>
        <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">{t("app.beta")}</span>
      </span>
    </Link>
  );
}
