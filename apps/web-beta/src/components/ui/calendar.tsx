import { enGB, tr } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ComponentProps } from "react";
import { DayPicker } from "react-day-picker";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/** date-fns locale for the UI language (weeks start on Monday in both). */
export function dateLocale(language: string) {
  return language === "en" ? enGB : tr;
}

/** shadcn/ui Calendar on react-day-picker v9: Turkish/English month names, Monday first, 44px day cells on touch. */
export function Calendar({ className, classNames, showOutsideDays = true, ...props }: ComponentProps<typeof DayPicker>) {
  const { i18n } = useTranslation();
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      locale={dateLocale(i18n.language)}
      weekStartsOn={1}
      className={cn("p-3", className)}
      classNames={{
        months: "relative flex flex-col gap-4 sm:flex-row",
        month: "flex flex-col gap-3",
        month_caption: "flex h-9 items-center justify-center text-sm font-medium",
        caption_label: "text-sm font-medium",
        nav: "absolute inset-x-0 top-0 flex items-center justify-between",
        button_previous: "inline-flex size-11 items-center justify-center rounded-md hover:bg-accent disabled:opacity-40 lg:size-9",
        button_next: "inline-flex size-11 items-center justify-center rounded-md hover:bg-accent disabled:opacity-40 lg:size-9",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-11 text-[0.75rem] font-normal text-muted-foreground lg:w-9",
        week: "mt-1 flex w-full",
        day: "relative size-11 p-0 text-center text-sm lg:size-9",
        day_button:
          "inline-flex size-11 items-center justify-center rounded-md font-normal outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:size-9",
        selected: "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary",
        range_start: "rounded-l-md bg-accent",
        range_middle: "bg-accent [&>button]:!bg-transparent [&>button]:!text-accent-foreground",
        range_end: "rounded-r-md bg-accent",
        today: "[&>button]:font-semibold [&>button]:underline [&>button]:underline-offset-4",
        outside: "text-muted-foreground opacity-50",
        disabled: "text-muted-foreground opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClass }) =>
          orientation === "left" ? <ChevronLeft className={cn("size-4", chevronClass)} aria-hidden="true" /> : <ChevronRight className={cn("size-4", chevronClass)} aria-hidden="true" />,
      }}
      {...props}
    />
  );
}
