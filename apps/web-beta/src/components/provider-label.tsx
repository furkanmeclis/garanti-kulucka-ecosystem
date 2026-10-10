import type { ReactNode } from "react";
import { BrandIcon, type Brand } from "@/components/brand-icons";
import { cn } from "@/lib/utils";

/** Maps a carrier/provider value from the API ("ptt", "PTT Kargo", "surat", "Sürat") to its brand, if any. */
export function carrierBrand(provider: string | null | undefined): Brand | null {
  const value = (provider ?? "").toLocaleLowerCase("tr-TR");
  if (!value) return null;
  if (value.includes("ptt")) return "ptt";
  if (value.includes("surat") || value.includes("sürat")) return "surat";
  return null;
}

/** Maps a conversation/comment channel value to its brand, if any. */
export function channelBrand(channel: string | null | undefined): Brand | null {
  const value = (channel ?? "").toLowerCase();
  if (value === "instagram") return "instagram";
  if (value === "messenger") return "messenger";
  if (value === "facebook") return "facebook";
  if (value === "whatsapp") return "whatsapp";
  return null;
}

/** Maps any provider/integration identifier (carrier, channel, kolaybi, netgsm…) to a brand. */
export function providerBrand(provider: string | null | undefined): Brand | null {
  const value = (provider ?? "").toLocaleLowerCase("tr-TR");
  if (!value) return null;
  if (value.includes("kolaybi")) return "kolaybi";
  if (value.includes("netgsm")) return "netgsm";
  if (value.includes("whatsapp")) return "whatsapp";
  if (value.includes("instagram")) return "instagram";
  if (value.includes("messenger")) return "messenger";
  if (value.includes("facebook")) return "facebook";
  return carrierBrand(value);
}

/**
 * A brand mark followed by its visible label. The icon is decorative (`title=""`) because the label names the brand.
 * Renders the label alone when `brand` is null so callers can pass a looked-up brand directly.
 */
export function ProviderLabel({ brand, children, className, iconClassName }: { brand: Brand | null | undefined; children?: ReactNode; className?: string; iconClassName?: string }) {
  if (!brand) return <>{children}</>;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <BrandIcon brand={brand} title="" className={cn("size-4", iconClassName)} />
      {children !== undefined && <span className="min-w-0 truncate">{children}</span>}
    </span>
  );
}
