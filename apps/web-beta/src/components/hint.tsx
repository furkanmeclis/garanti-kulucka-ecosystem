import { useState, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Short explanation for a compact badge/chip. Hover or keyboard focus opens it (the trigger is focusable and
 * gets `aria-describedby` from the tooltip primitive); a tap toggles it on touch screens, where hover does not exist.
 * `content` may be a string or an array of lines; empty content renders the child alone.
 */
export function Hint({ content, children, className }: { content: ReactNode | ReadonlyArray<ReactNode>; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const lines = (Array.isArray(content) ? content : [content]).filter((line) => line !== null && line !== undefined && line !== false && line !== "");
  if (lines.length === 0) return <>{children}</>;
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className={cn("inline-flex max-w-full cursor-help rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", className)}
            onClick={(event) => {
              // Touch: the primitive closes on pointer down, so a tap re-opens it here (and keeps the row from reacting).
              const pointer = (event.nativeEvent as Partial<PointerEvent>).pointerType;
              if (pointer === "touch" || (!pointer && window.matchMedia?.("(hover: none)").matches)) {
                event.stopPropagation();
                setOpen(true);
              }
            }}
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {lines.length === 1 ? (
            lines[0]
          ) : (
            <ul className="flex flex-col gap-0.5">
              {lines.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
