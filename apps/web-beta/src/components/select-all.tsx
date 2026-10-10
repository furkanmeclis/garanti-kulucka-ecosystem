import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/** "Select all visible" as a tri-state Checkbox: checked when every visible row is selected, indeterminate when some are. */
export function SelectAllCheckbox({ total, selected, onChange, label, testId, className }: { total: number; selected: number; onChange: (all: boolean) => void; label: string; testId: string; className?: string }) {
  const all = total > 0 && selected >= total;
  return (
    <label className={cn("inline-flex min-h-11 cursor-pointer items-center gap-1 self-start pr-2 text-sm font-medium lg:gap-2", className)}>
      <Checkbox checked={all ? true : selected > 0 ? "indeterminate" : false} onCheckedChange={() => onChange(!all)} data-testid={testId} />
      {label}
    </label>
  );
}
