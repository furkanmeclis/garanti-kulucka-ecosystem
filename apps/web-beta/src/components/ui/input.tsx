import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** shadcn/ui Input; `unstyled` drops the default look for screens that bring their own (legacy Mesajlar). */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { unstyled?: boolean }>(({ className, type, unstyled = false, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      !unstyled &&
        "flex h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive lg:text-sm dark:bg-input/30",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
