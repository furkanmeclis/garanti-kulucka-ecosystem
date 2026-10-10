import { createContext, useContext, type ReactNode } from "react";
import { BrandIcon, type Brand } from "@/components/brand-icons";

/** Pages inside a layout that already owns the h1 (the settings area) render their title as h2. */
export const PageHeadingLevel = createContext<1 | 2>(1);

/** `brand` puts the provider's logo before the title on provider-specific pages (Instagram, NetGSM, KolayBi, debug pages…). */
export function PageHeader({ title, description, actions, brand }: { title: string; description?: string; actions?: ReactNode; brand?: Brand }) {
  const level = useContext(PageHeadingLevel);
  const Heading = level === 1 ? "h1" : "h2";
  // Inside the settings area the content column is narrower, so actions go under the title instead of beside it.
  return (
    <div className={level === 1 ? "mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between" : "mb-6 flex flex-col gap-3"}>
      <div className="min-w-0">
        <Heading className={level === 1 ? "text-2xl font-semibold tracking-tight" : "text-lg font-semibold tracking-tight"}>
          {brand ? (
            <span className="inline-flex items-center gap-2">
              <BrandIcon brand={brand} title="" className={level === 1 ? "size-6" : "size-5"} />
              {title}
            </span>
          ) : (
            title
          )}
        </Heading>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
