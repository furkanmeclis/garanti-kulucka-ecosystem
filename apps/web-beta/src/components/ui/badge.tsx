import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva("inline-flex max-w-full items-center gap-1 truncate rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "border-transparent bg-secondary text-secondary-foreground",
      info: "border-transparent bg-sky-500/15 text-sky-700 dark:text-sky-300",
      success: "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
      warning: "border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300",
      danger: "border-transparent bg-red-500/15 text-red-700 dark:text-red-300",
      outline: "text-foreground",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
