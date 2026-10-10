import { addDays, endOfMonth, format, isValid, parse, startOfMonth, subMonths } from "date-fns";
import { CalendarDays, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { Combobox } from "./combobox";
import { Input } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/** API value ("YYYY-MM-DD") ↔ local Date; the UI shows dd.MM.yyyy in both languages. */
export function parseIsoDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return isValid(date) ? date : undefined;
}

export function toIsoDate(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function displayDate(value: string | null | undefined) {
  const date = parseIsoDate(value);
  return date ? format(date, "dd.MM.yyyy") : "";
}

/** Typed input: "01.10.2026", "1.10.2026", "01/10/2026" or "2026-10-01"; null when it is not a full date yet. */
export function parseTypedDate(text: string): string | null {
  const value = text.trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return parseIsoDate(value) ? value : null;
  const normalised = value.replace(/[/-]/g, ".");
  if (!/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(normalised)) return null;
  const date = parse(normalised, "d.M.yyyy", new Date());
  return isValid(date) ? toIsoDate(date) : null;
}

const triggerClass =
  "flex h-11 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-left text-base whitespace-nowrap shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 lg:text-sm dark:bg-input/30";

function TypedDate({ value, onCommit, label, testId }: { value: string; onCommit: (value: string) => void; label: string; testId?: string | undefined }) {
  const { t } = useTranslation();
  const [text, setText] = useState(displayDate(value));
  useEffect(() => setText(displayDate(value)), [value]);
  return (
    <Input
      value={text}
      inputMode="numeric"
      aria-label={label}
      placeholder={t("datePicker.inputPlaceholder")}
      className="h-11 lg:h-9"
      onChange={(event) => {
        setText(event.target.value);
        const parsed = parseTypedDate(event.target.value);
        if (parsed) onCommit(parsed);
        else if (!event.target.value.trim()) onCommit("");
      }}
      data-testid={testId}
    />
  );
}

export interface DatePickerProps {
  /** "YYYY-MM-DD" or "" */
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  /** The trigger; the typed-date input inside the popover is `${testId}-input`. */
  testId?: string;
  className?: string;
  disabled?: boolean;
  clearable?: boolean;
}

/** shadcn-style DatePicker: a button showing dd.MM.yyyy that opens a Calendar (plus a typed input) in a Popover. */
export function DatePicker({ value, onChange, label, placeholder, testId, className, disabled, clearable = true }: DatePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = parseIsoDate(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button type="button" className={cn(triggerClass, className)} aria-label={`${label}: ${value ? displayDate(value) : (placeholder ?? t("datePicker.placeholder"))}`} data-value={value} data-testid={testId}>
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className={cn("truncate", !value && "text-muted-foreground")}>{value ? displayDate(value) : (placeholder ?? t("datePicker.placeholder"))}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <div className="flex flex-col gap-2 border-b p-3">
          <TypedDate value={value} onCommit={onChange} label={label} testId={testId ? `${testId}-input` : undefined} />
        </div>
        <Calendar
          mode="single"
          {...(selected ? { selected, defaultMonth: selected } : {})}
          onSelect={(date) => {
            onChange(date ? toIsoDate(date) : "");
            setOpen(false);
          }}
        />
        <div className="flex justify-between gap-2 border-t p-2">
          <Button type="button" variant="ghost" size="sm" className="min-h-11 lg:min-h-8" onClick={() => (onChange(toIsoDate(new Date())), setOpen(false))}>
            {t("datePicker.today")}
          </Button>
          {clearable && value && (
            <Button type="button" variant="ghost" size="sm" className="min-h-11 lg:min-h-8" onClick={() => (onChange(""), setOpen(false))}>
              <X className="size-4" aria-hidden="true" />
              {t("datePicker.clear")}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

type PresetKey = "today" | "yesterday" | "last7" | "last30" | "thisMonth" | "lastMonth";

export function presetRange(key: PresetKey, now = new Date()): { from: string; to: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (key) {
    case "today":
      return { from: toIsoDate(today), to: toIsoDate(today) };
    case "yesterday": {
      const day = addDays(today, -1);
      return { from: toIsoDate(day), to: toIsoDate(day) };
    }
    case "last7":
      return { from: toIsoDate(addDays(today, -6)), to: toIsoDate(today) };
    case "last30":
      return { from: toIsoDate(addDays(today, -29)), to: toIsoDate(today) };
    case "thisMonth":
      return { from: toIsoDate(startOfMonth(today)), to: toIsoDate(today) };
    case "lastMonth": {
      const month = subMonths(today, 1);
      return { from: toIsoDate(startOfMonth(month)), to: toIsoDate(endOfMonth(month)) };
    }
  }
}

const presetKeys: PresetKey[] = ["today", "yesterday", "last7", "last30", "thisMonth", "lastMonth"];

export interface DateRangePickerProps {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  label: string;
  /** The trigger; presets are `${testId}-preset-<key>`. */
  testId: string;
  /** Typed start/end inputs inside the popover (keeps the old `filter-from` / `filter-to` hooks). */
  fromTestId?: string;
  toTestId?: string;
  className?: string;
}

/** One trigger for a from/to filter: presets (Bugün, Dün, Son 7 gün, Bu ay, Geçen ay…), typed dates and a range calendar. */
export function DateRangePicker({ from, to, onChange, label, testId, fromTestId, toTestId, className }: DateRangePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const range: DateRange | undefined = from || to ? { from: parseIsoDate(from), to: parseIsoDate(to) } : undefined;
  const text = from || to ? `${from ? displayDate(from) : "…"} – ${to ? displayDate(to) : "…"}` : t("datePicker.rangePlaceholder");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("relative", className)}>
        <PopoverTrigger asChild>
          <button type="button" className={cn(triggerClass, (from || to) && "pr-10")} aria-label={`${label}: ${text}`} data-from={from} data-to={to} data-testid={testId}>
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className={cn("truncate", !(from || to) && "text-muted-foreground")}>{text}</span>
          </button>
        </PopoverTrigger>
        {(from || to) && (
          <button
            type="button"
            className="absolute top-1/2 right-0 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground lg:size-9"
            aria-label={t("datePicker.clear")}
            onClick={() => onChange({ from: "", to: "" })}
            data-testid={`${testId}-clear`}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <PopoverContent align="start" className="w-auto max-w-[calc(100vw-1rem)] p-0">
        <div className="flex flex-col sm:flex-row">
          <div className="flex flex-wrap gap-1 border-b p-2 sm:w-36 sm:flex-col sm:flex-nowrap sm:border-r sm:border-b-0" role="group" aria-label={t("datePicker.presets")}>
            {presetKeys.map((key) => (
              <Button
                key={key}
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11 justify-start lg:min-h-8"
                onClick={() => {
                  onChange(presetRange(key));
                  setOpen(false);
                }}
                data-testid={`${testId}-preset-${key}`}
              >
                {t(`datePicker.${key}`)}
              </Button>
            ))}
          </div>
          <div className="flex flex-col">
            <div className="grid grid-cols-2 gap-2 border-b p-3">
              <TypedDate value={from} onCommit={(value) => onChange({ from: value, to })} label={`${label} · ${t("datePicker.from")}`} testId={fromTestId} />
              <TypedDate value={to} onCommit={(value) => onChange({ from, to: value })} label={`${label} · ${t("datePicker.to")}`} testId={toTestId} />
            </div>
            <Calendar
              mode="range"
              {...(range ? { selected: range } : {})}
              {...(range?.from ? { defaultMonth: range.from } : {})}
              onSelect={(next) => onChange({ from: next?.from ? toIsoDate(next.from) : "", to: next?.to ? toIsoDate(next.to) : "" })}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Time of day ("HH:mm") from a filterable 15-minute list; an off-grid saved value stays selectable. */
export function TimeSelect({ value, onChange, label, testId, className }: { value: string; onChange: (value: string) => void; label: string; testId?: string; className?: string }) {
  const { t } = useTranslation();
  const slots = Array.from({ length: 96 }, (_, index) => `${String(Math.floor(index / 4)).padStart(2, "0")}:${String((index % 4) * 15).padStart(2, "0")}`);
  const options = (value && !slots.includes(value) ? [...slots, value].sort() : slots).map((slot) => ({ value: slot, label: slot }));
  return (
    <Combobox
      options={options}
      value={value}
      onChange={onChange}
      label={label}
      placeholder={t("datePicker.timePlaceholder")}
      emptyText={t("common.empty")}
      triggerClassName={cn(triggerClass, className)}
      contentClassName="bg-popover text-popover-foreground"
      itemClassName="text-sm"
      activeItemClassName="bg-accent text-accent-foreground"
      selectedItemClassName="font-medium"
      inputClassName="text-sm"
      {...(testId ? { testId } : {})}
    />
  );
}
