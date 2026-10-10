import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export interface ComboboxOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

export interface ComboboxProps {
  options: readonly ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  /** Accessible name of the trigger and the list. */
  label: string;
  placeholder: string;
  searchPlaceholder?: string;
  emptyText: string;
  disabled?: boolean;
  /** Shows an × that resets the value to "". */
  clearLabel?: string;
  triggerClassName?: string;
  contentClassName?: string;
  itemClassName?: string;
  activeItemClassName?: string;
  selectedItemClassName?: string;
  inputClassName?: string;
  chevronClassName?: string;
  testId?: string;
}

const fold = (value: string) => value.toLocaleLowerCase("tr-TR");

/**
 * shadcn-style Combobox (Popover + filter input + listbox): type to filter (Turkish-aware), ↑/↓ to move,
 * Enter to pick, Esc to close. The search input is `${testId}-input`, the trigger `${testId}`.
 */
export function Combobox(props: ComboboxProps) {
  const { options, value, onChange, testId } = props;
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const list = useRef<HTMLDivElement | null>(null);
  const filtered = useMemo(() => options.filter((option) => fold(option.label).includes(fold(term))), [options, term]);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return setTerm("");
    const index = filtered.findIndex((option) => option.value === value);
    setActive(index >= 0 ? index : 0);
    // Only when the popup opens.
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setActive(0), [term]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (option: ComboboxOption | undefined) => {
    if (!option) return;
    onChange(option.value);
    setOpen(false);
  };

  return (
    <Popover open={open && !props.disabled} onOpenChange={setOpen}>
      <div className="relative">
        <PopoverTrigger asChild disabled={props.disabled}>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={`${props.label}: ${selected?.label ?? props.placeholder}`}
            className={cn("flex w-full items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50", props.triggerClassName)}
            data-value={value}
            data-testid={testId}
          >
            <span className={cn("flex min-w-0 items-center gap-1.5 truncate", !selected && "opacity-70")}>
              {selected?.icon}
              <span className="truncate">{selected?.label ?? props.placeholder}</span>
            </span>
            <ChevronDown className={cn("size-4 shrink-0 opacity-60", props.chevronClassName)} aria-hidden="true" />
          </button>
        </PopoverTrigger>
        {props.clearLabel && value && !props.disabled && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label={props.clearLabel}
            className="absolute top-1/2 right-7 inline-flex -translate-y-1/2 items-center justify-center rounded p-0.5 opacity-60 hover:opacity-100 max-lg:size-11"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        )}
      </div>
      <PopoverContent align="start" className={cn("w-(--radix-popover-trigger-width) min-w-48 p-0", props.contentClassName)} onOpenAutoFocus={(event) => event.preventDefault()}>
        <div className="flex items-center gap-2 border-b border-inherit px-3">
          <Search className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
          <input
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, filtered.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                pick(filtered[active]);
              }
            }}
            placeholder={props.searchPlaceholder ?? props.placeholder}
            aria-label={props.label}
            aria-controls={listId}
            aria-activedescendant={filtered[active] ? `${listId}-${active}` : undefined}
            className={cn("h-9 w-full bg-transparent text-xs outline-none placeholder:opacity-60 max-lg:h-11 max-lg:text-base", props.inputClassName)}
            data-testid={testId ? `${testId}-input` : undefined}
          />
        </div>
        <div ref={list} id={listId} role="listbox" aria-label={props.label} className="max-h-60 overflow-y-auto overscroll-y-contain py-1 msg-scrollbar">
          {filtered.length === 0 ? (
            <div className="px-4 py-2 text-xs opacity-70">{props.emptyText}</div>
          ) : (
            filtered.map((option, index) => (
              <div
                key={option.value || "__empty"}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={option.value === value}
                data-value={option.value}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(option)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 px-4 py-2 text-xs max-lg:min-h-11 max-lg:text-sm",
                  props.itemClassName,
                  index === active && props.activeItemClassName,
                  option.value === value && props.selectedItemClassName,
                )}
              >
                {option.icon}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.value === value && <Check className="size-3.5 shrink-0" aria-hidden="true" />}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
