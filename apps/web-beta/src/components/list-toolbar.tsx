import { Search, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface FilterOption {
  value: string;
  label: string;
}

/** Search box (debounced into the URL) plus filter selects and a clear button. */
export function ListToolbar({
  query,
  placeholder,
  onQuery,
  hasFilters,
  onClear,
  children,
}: {
  query: string;
  placeholder: string;
  onQuery: (value: string) => void;
  hasFilters: boolean;
  onClear: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(query);
  useEffect(() => setDraft(query), [query]);
  useEffect(() => {
    if (draft === query) return;
    const timer = window.setTimeout(() => onQuery(draft.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [draft, query, onQuery]);

  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center" data-testid="list-toolbar">
      <div className="relative min-w-0 sm:w-72">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onQuery(draft.trim());
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="pl-9"
          data-testid="list-search"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">{children}</div>
      {hasFilters && (
        <Button variant="ghost" onClick={onClear} className="sm:ml-auto" data-testid="list-clear">
          <X />
          {t("common.clear")}
        </Button>
      )}
    </div>
  );
}

export function FilterSelect({ label, value, options, onChange, testId }: { label: string; value: string; options: FilterOption[]; onChange: (value: string) => void; testId: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="sm:w-48" aria-label={label} data-testid={testId}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} data-testid={`${testId}-${option.value}`}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
