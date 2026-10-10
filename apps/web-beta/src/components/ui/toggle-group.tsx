import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cn } from "@/lib/utils";

/** shadcn/ui ToggleGroup (Radix): single choice renders radio semantics, multiple renders pressed buttons. */
export const ToggleGroup = forwardRef<ElementRef<typeof ToggleGroupPrimitive.Root>, ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Root ref={ref} className={cn("flex items-center gap-1", className)} {...props} />
));
ToggleGroup.displayName = "ToggleGroup";

export const ToggleGroupItem = forwardRef<ElementRef<typeof ToggleGroupPrimitive.Item>, ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    className={cn(
      "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground",
      className,
    )}
    {...props}
  />
));
ToggleGroupItem.displayName = "ToggleGroupItem";
