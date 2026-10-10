import { StickyNote, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { chatTipClass } from "./top-bar";

/** Legacy InlineNote: note text next to the name; the icon opens an inline input that saves on blur / Enter. */
export function InlineNote({ value, onSave }: { value: string; onSave: (next: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (open) {
      input.current?.focus();
      input.current?.select();
    }
  }, [open]);

  async function save() {
    const clean = text.trim();
    if (clean === value.trim()) return setOpen(false);
    try {
      setSaving(true);
      await onSave(clean);
    } catch {
      setText(value);
    } finally {
      setSaving(false);
      setOpen(false);
    }
  }

  return (
    <span className="inline-flex min-w-0 shrink-0 items-center gap-1" data-testid="inline-note">
      {value && !open && (
        <span className="max-w-[180px] truncate text-xs font-normal text-amber-600 max-sm:hidden dark:text-amber-400/80" data-testid="inline-note-text">
          — {value}
        </span>
      )}
      {open ? (
        <span className="inline-flex items-center gap-1">
          <Input
            unstyled
            ref={input}
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => void save()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void save();
              }
              if (event.key === "Escape") {
                setText(value);
                setOpen(false);
              }
            }}
            disabled={saving}
            placeholder={t("chat.notePlaceholder")}
            aria-label={t("chat.noteEdit")}
            className="w-36 rounded border border-amber-500/40 bg-msg-raised px-1.5 py-0.5 text-xs font-normal text-amber-700 placeholder:text-msg-subtle focus:border-amber-400 focus:ring-1 focus:ring-amber-400/30 focus:outline-none max-lg:min-h-11 max-lg:w-32 max-lg:text-base dark:text-amber-300"
            data-testid="inline-note-input"
          />
          {text && (
            <Tip label={t("chat.noteClear")} className={chatTipClass}>
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setText("");
                }}
                className="rounded p-0.5 text-msg-subtle transition-colors hover:text-red-500 max-lg:inline-flex max-lg:size-11 max-lg:items-center max-lg:justify-center"
                aria-label={t("chat.noteClear")}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </Tip>
          )}
        </span>
      ) : (
        <Tip label={value ? t("chat.noteEdit") : t("chat.noteAdd")} className={chatTipClass}>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setOpen(true);
            }}
            className={cn(
              "rounded p-0.5 transition-colors hover:bg-amber-500/10 max-lg:inline-flex max-lg:size-11 max-lg:items-center max-lg:justify-center",
              value ? "text-amber-600 hover:text-amber-500 dark:text-amber-400/70 dark:hover:text-amber-300" : "text-msg-faint hover:text-amber-500 dark:hover:text-amber-400",
            )}
            aria-label={value ? t("chat.noteEdit") : t("chat.noteAdd")}
            data-testid="inline-note-trigger"
          >
            <StickyNote className="size-3.5" aria-hidden="true" />
          </button>
        </Tip>
      )}
    </span>
  );
}

/**
 * ui/Combobox dressed as the legacy order-panel fields (il / ilçe / ürün): slate field, primary focus ring,
 * slate dropdown with the picked row in primary.
 */
export function ChatCombobox({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  notFoundText,
  label,
  testId,
  clearable = true,
  compact = false,
}: {
  options: ReadonlyArray<{ value: string; label: string; icon?: ReactNode }>;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  notFoundText: string;
  label: string;
  testId?: string;
  clearable?: boolean;
  /** `rounded` 2px corners and px-2 like the product select (il/ilçe use the rounded-lg field). */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Combobox
      options={options}
      value={value}
      onChange={onChange}
      label={label}
      placeholder={placeholder}
      emptyText={notFoundText}
      {...(disabled !== undefined ? { disabled } : {})}
      {...(clearable ? { clearLabel: t("chat.clearSelect") } : {})}
      triggerClassName={cn(
        "border border-msg-border-strong bg-msg-field py-1.5 text-xs text-msg-fg outline-none focus-visible:border-msg-primary focus-visible:bg-msg-field-focus focus-visible:ring-1 focus-visible:ring-msg-primary data-[state=open]:border-msg-primary data-[state=open]:ring-1 data-[state=open]:ring-msg-primary max-lg:min-h-11 max-lg:text-base",
        compact ? "rounded px-2" : "rounded-lg px-3",
        clearable && value && "[&>span:first-child]:mr-6",
      )}
      contentClassName="border-msg-border-strong bg-msg-raised text-msg-fg shadow-lg"
      itemClassName="text-msg-fg"
      activeItemClassName="bg-msg-hover-raised"
      selectedItemClassName="bg-msg-primary/10 font-medium text-msg-primary-text"
      inputClassName="text-msg-fg placeholder:text-msg-subtle"
      chevronClassName={compact ? "size-3 text-msg-subtle opacity-100" : "text-msg-subtle opacity-100"}
      {...(testId ? { testId } : {})}
    />
  );
}
