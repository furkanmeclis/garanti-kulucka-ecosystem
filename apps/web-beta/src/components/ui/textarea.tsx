import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** shadcn/ui Textarea; `unstyled` drops the default look for screens that bring their own (legacy Mesajlar). */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { unstyled?: boolean }>(({ className, unstyled = false, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      !unstyled &&
        "flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 lg:text-sm dark:bg-input/30",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
