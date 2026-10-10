import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cn } from "@/lib/utils";

/**
 * shadcn/ui Checkbox (Radix, `role="checkbox"` + `aria-checked`, so it also supports `checked="indeterminate"` for
 * "select all"). The root is a 44px hit area on touch layouts; the visible box stays 20px (16px from lg up).
 */
export const Checkbox = forwardRef<ElementRef<typeof CheckboxPrimitive.Root>, ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "group relative inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 lg:size-6",
      className,
    )}
    {...props}
  >
    <span className="flex size-5 items-center justify-center rounded-[5px] border border-input bg-background shadow-xs transition-colors group-data-[state=checked]:border-primary group-data-[state=checked]:bg-primary group-data-[state=checked]:text-primary-foreground group-data-[state=indeterminate]:border-primary group-data-[state=indeterminate]:bg-primary group-data-[state=indeterminate]:text-primary-foreground lg:size-4 dark:bg-input/30">
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        {props.checked === "indeterminate" ? <Minus className="size-3.5 lg:size-3" strokeWidth={3} /> : <Check className="size-3.5 lg:size-3" strokeWidth={3} />}
      </CheckboxPrimitive.Indicator>
    </span>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = "Checkbox";
