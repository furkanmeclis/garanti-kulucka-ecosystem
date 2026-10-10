import type { BreakdownAnalytics } from "@garanti-kulucka/shared";
import { CalendarRange, FilterX, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { BrandIcon } from "@/components/brand-icons";
import { formatDay } from "@/components/charts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { DateRangePicker } from "@/components/ui/date-picker";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { activeDimensionCount, daysBetween, granularities, presetRange, rangePresets, resolvedGranularity, type DimensionKey, type RangePreset, type ReportFilterState } from "./filters";

const presetLabels: Record<RangePreset, string> = {
  today: "reports.presetToday",
  yesterday: "reports.presetYesterday",
  last7: "reports.presetLast7",
  last30: "reports.presetLast30",
  last90: "reports.presetLast90",
  thisMonth: "reports.presetThisMonth",
  lastMonth: "reports.presetLastMonth",
  thisYear: "reports.presetThisYear",
  custom: "reports.presetCustom",
};

const granularityLabels = { auto: "reports.granularityAuto", day: "reports.granularityDay", week: "reports.granularityWeek", month: "reports.granularityMonth" } as const;
const channels = ["whatsapp", "instagram", "messenger", "phone", "manual"] as const;
const statuses = ["olusturuldu", "teyit_bekliyor", "teyit_edildi", "hazirlaniyor", "kargoya_verildi", "sevk_edildi", "teslim_edildi", "iptal", "iade"] as const;

const triggerClass =
  "h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:h-9 lg:text-sm dark:bg-input/30";

function FilterCombo({ label, value, options, allLabel, onChange, testId }: { label: string; value: string; options: ComboboxOption[]; allLabel: string; onChange: (value: string) => void; testId: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
      <span>{label}</span>
      <Combobox
        options={[{ value: "", label: allLabel }, ...options]}
        value={value}
        onChange={onChange}
        label={label}
        placeholder={allLabel}
        searchPlaceholder={t("reports.searchOption")}
        emptyText={t("common.empty")}
        triggerClassName={triggerClass}
        contentClassName="bg-popover text-popover-foreground"
        itemClassName="text-sm"
        activeItemClassName="bg-accent text-accent-foreground"
        selectedItemClassName="font-medium"
        inputClassName="text-base lg:text-sm"
        testId={testId}
      />
    </div>
  );
}

/**
 * One filter row above everything it scopes (dataviz: filters never live inside chart cards): date presets +
 * range picker, compare toggle, granularity and the dimension filters. Every change is written to the URL.
 */
export function ReportFilterBar({ state, onChange, options }: { state: ReportFilterState; onChange: (next: Partial<ReportFilterState>) => void; options: BreakdownAnalytics["options"] | undefined }) {
  const { t } = useTranslation();
  const granularity = resolvedGranularity(state);
  const days = daysBetween(state.from, state.to);
  const previousTo = new Date(Date.parse(`${state.from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const previousFrom = new Date(Date.parse(`${state.from}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  const set = (key: DimensionKey) => (value: string) => onChange({ [key]: value } as Partial<ReportFilterState>);
  const activeCount = activeDimensionCount(state);

  return (
    <Card className="mb-5 flex flex-col gap-4 p-4" data-testid="reports-filters">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <ToggleGroup
            type="single"
            value={state.preset}
            onValueChange={(value) => {
              if (!value) return;
              const preset = value as RangePreset;
              if (preset === "custom") onChange({ preset });
              else onChange({ preset, ...presetRange(preset) });
            }}
            aria-label={t("reports.dateRange")}
            className="w-max rounded-lg border p-0.5"
            data-testid="reports-presets"
          >
            {rangePresets.map((preset) => (
              <ToggleGroupItem key={preset} value={preset} className="min-h-11 px-2.5 text-sm whitespace-nowrap lg:min-h-8" data-testid={`reports-preset-${preset}`}>
                {t(presetLabels[preset] as "reports.presetToday")}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <DateRangePicker
          from={state.from}
          to={state.to}
          label={t("reports.dateRange")}
          testId="reports-range"
          className="w-full xl:w-72"
          onChange={(range) => {
            if (range.from && range.to && range.from <= range.to) onChange({ preset: "custom", from: range.from, to: range.to });
          }}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <Switch checked={state.compare} onCheckedChange={(checked) => onChange({ compare: checked })} className="size-11 lg:h-8 lg:w-12" aria-label={t("reports.compare")} data-testid="reports-compare" />
          <span className="flex flex-col">
            <span className="font-medium">{t("reports.compare")}</span>
            {state.compare && <span className="text-xs text-muted-foreground" data-testid="reports-compare-range">{t("reports.compareRange", { from: formatDay(previousFrom), to: formatDay(previousTo) })}</span>}
          </span>
        </label>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarRange className="size-4" aria-hidden="true" />
            {t("reports.granularity")}
          </span>
          <ToggleGroup type="single" value={state.granularity} onValueChange={(value) => value && onChange({ granularity: value as ReportFilterState["granularity"] })} aria-label={t("reports.granularity")} className="max-w-full overflow-x-auto rounded-lg border p-0.5" data-testid="reports-granularity">
            {granularities.map((key) => (
              <ToggleGroupItem key={key} value={key} className="min-h-11 min-w-11 px-2.5 text-sm whitespace-nowrap lg:min-h-8" data-testid={`reports-granularity-${key}`}>
                {t(granularityLabels[key])}
                {key === "auto" && state.granularity === "auto" && <span className="hidden text-xs text-muted-foreground sm:inline">· {t(granularityLabels[granularity])}</span>}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            {t("reports.filters")}
            {activeCount > 0 && <span className="rounded-full bg-primary px-2 text-xs text-primary-foreground" data-testid="reports-active-filters">{t("reports.activeFilters", { count: activeCount })}</span>}
          </span>
          {activeCount > 0 && (
            <Button variant="ghost" size="sm" className="lg:h-8" onClick={() => onChange({ cargo: "", personnel: "", channel: "", status: "", product: "", category: "", city: "" })} data-testid="reports-reset">
              <FilterX className="size-4" aria-hidden="true" />
              {t("reports.resetFilters")}
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
          <FilterCombo
            testId="reports-provider"
            label={t("reports.cargoProvider")}
            allLabel={t("reports.allProviders")}
            value={state.cargo}
            onChange={(value) => onChange({ cargo: value === "ptt" || value === "surat" ? value : "" })}
            options={[
              { value: "ptt", label: "PTT", icon: <BrandIcon brand="ptt" title="" className="size-4" /> },
              { value: "surat", label: "Sürat", icon: <BrandIcon brand="surat" title="" className="size-4" /> },
            ]}
          />
          <FilterCombo testId="reports-personnel" label={t("reports.personnel")} allLabel={t("reports.allPersonnel")} value={state.personnel} onChange={set("personnel")} options={(options?.personnel ?? []).map((item) => ({ value: item.public_id, label: item.name }))} />
          <FilterCombo
            testId="reports-channel"
            label={t("reports.channel")}
            allLabel={t("reports.allChannels")}
            value={state.channel}
            onChange={set("channel")}
            options={channels.map((channel) => ({
              value: channel,
              label: t(`analytics.channel.${channel}`),
              ...(channel === "whatsapp" || channel === "instagram" || channel === "messenger" ? { icon: <BrandIcon brand={channel} title="" className="size-4" /> } : {}),
            }))}
          />
          <FilterCombo testId="reports-order-status" label={t("reports.status")} allLabel={t("reports.allStatuses")} value={state.status} onChange={set("status")} options={statuses.map((status) => ({ value: status, label: t(`analytics.status.${status}`) }))} />
          <FilterCombo testId="reports-product" label={t("reports.product")} allLabel={t("reports.allProducts")} value={state.product} onChange={set("product")} options={(options?.products ?? []).map((item) => ({ value: item.public_id, label: item.name }))} />
          <FilterCombo testId="reports-category" label={t("reports.category")} allLabel={t("reports.allCategories")} value={state.category} onChange={set("category")} options={(options?.categories ?? []).map((item) => ({ value: item, label: item }))} />
          <FilterCombo testId="reports-city" label={t("reports.city")} allLabel={t("reports.allCities")} value={state.city} onChange={set("city")} options={(options?.cities ?? []).map((item) => ({ value: item, label: item }))} />
        </div>
      </div>
    </Card>
  );
}
