import type { LucideIcon } from "lucide-react";
import { BrandIcon, type Brand } from "@/components/brand-icons";

/** Navigation glyph: the provider logo for provider-specific entries, otherwise the entry's lucide icon. */
export function NavIcon({ item, className }: { item: { icon: LucideIcon; brand?: Brand | undefined }; className: string }) {
  if (item.brand) return <BrandIcon brand={item.brand} title="" className={className} />;
  const Icon = item.icon;
  return <Icon className={className} aria-hidden="true" />;
}
