import * as SwitchPrimitive from "@radix-ui/react-switch";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cn } from "@/lib/utils";

const tones = {
  primary: "group-data-[state=checked]:bg-primary",
  emerald: "group-data-[state=checked]:bg-emerald-600",
  blue: "group-data-[state=checked]:bg-blue-600",
} as const;

export interface SwitchProps extends ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  /** `sm` = h-5 w-9 track, `md` = h-6 w-11 track. */
  size?: "sm" | "md";
  tone?: keyof typeof tones;
  /** Track colour overrides (e.g. the unchecked colour). */
  trackClassName?: string;
}

/**
 * shadcn/ui Switch (Radix). The root is the hit area and the visible pill is an inner track, so callers can give
 * the control a 44px touch target without changing how the pill looks.
 */
export const Switch = forwardRef<ElementRef<typeof SwitchPrimitive.Root>, SwitchProps>(({ className, size = "md", tone = "primary", trackClassName, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "group relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed",
      className,
    )}
    {...props}
  >
    <span className={cn("inline-flex items-center rounded-full bg-input transition-colors", size === "sm" ? "h-5 w-9" : "h-6 w-11", tones[tone], trackClassName)}>
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block rounded-full bg-white shadow-sm transition-transform",
          size === "sm" ? "size-3.5 translate-x-0.5 data-[state=checked]:translate-x-4" : "size-4 translate-x-1 data-[state=checked]:translate-x-6",
        )}
      />
    </span>
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
