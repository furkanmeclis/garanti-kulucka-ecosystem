import { describe, expect, it } from "vitest";
import { exportFileName, toCsv, toSpreadsheetXml } from "../src/components/charts/export";
import { formatBucket, formatValue } from "../src/components/charts/format";
import { activeDimensionCount, autoGranularity, bucketOf, parseDashboardPreset, parseReportFilters, presetRange, rebucket, serializeReportFilters, toAnalyticsQuery } from "../src/pages/reports/filters";

const now = new Date(2026, 9, 10, 15, 0, 0);

describe("analytics date presets", () => {
  it("resolves every preset to calendar days", () => {
    expect(presetRange("today", now)).toEqual({ from: "2026-10-10", to: "2026-10-10" });
    expect(presetRange("yesterday", now)).toEqual({ from: "2026-10-09", to: "2026-10-09" });
    expect(presetRange("last7", now)).toEqual({ from: "2026-10-04", to: "2026-10-10" });
    expect(presetRange("last30", now)).toEqual({ from: "2026-09-11", to: "2026-10-10" });
    expect(presetRange("last90", now)).toEqual({ from: "2026-07-13", to: "2026-10-10" });
    expect(presetRange("thisMonth", now)).toEqual({ from: "2026-10-01", to: "2026-10-10" });
    expect(presetRange("lastMonth", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("thisYear", now)).toEqual({ from: "2026-01-01", to: "2026-10-10" });
  });

  it("picks day / week / month granularity like the API", () => {
    expect(autoGranularity(30)).toBe("day");
    expect(autoGranularity(90)).toBe("week");
    expect(autoGranularity(365)).toBe("month");
  });
});

describe("report filters in the URL", () => {
  it("defaults to the last 30 days with comparison and no dimensions", () => {
    const state = parseReportFilters(new URLSearchParams(""), now);
    expect(state).toMatchObject({ preset: "last30", from: "2026-09-11", to: "2026-10-10", compare: true, granularity: "auto", cargo: "" });
    expect(serializeReportFilters(state).toString()).toBe("");
    expect(toAnalyticsQuery(state)).toEqual({ from: "2026-09-11", to: "2026-10-10", granularity: "day", compare: "1" });
  });

  it("round-trips a custom range and every dimension", () => {
    const params = new URLSearchParams("range=custom&from=2026-01-01&to=2026-03-31&compare=0&granularity=month&cargo=ptt&personnel=usr_1&channel=instagram&status=iade&product=prd_1&category=incubator&city=Konya");
    const state = parseReportFilters(params, now);
    expect(state).toMatchObject({ preset: "custom", from: "2026-01-01", to: "2026-03-31", compare: false, granularity: "month", cargo: "ptt", city: "Konya" });
    expect(activeDimensionCount(state)).toBe(7);
    expect(serializeReportFilters(state).toString()).toBe(params.toString());
    expect(toAnalyticsQuery(state)).toMatchObject({ cargo_provider: "ptt", personnel_public_id: "usr_1", channel: "instagram", status: "iade", product_public_id: "prd_1", category: "incubator", city: "Konya", compare: "0" });
  });

  it("falls back to the default for invalid ranges or values", () => {
    expect(parseReportFilters(new URLSearchParams("range=custom&from=2026-05-01&to=2026-01-01"), now).preset).toBe("last30");
    expect(parseReportFilters(new URLSearchParams("range=forever&cargo=aras&granularity=hour"), now)).toMatchObject({ preset: "last30", cargo: "", granularity: "auto" });
    expect(parseReportFilters(new URLSearchParams("from=2026-02-01&to=2026-02-10"), now)).toMatchObject({ preset: "custom", from: "2026-02-01" });
    expect(parseDashboardPreset(new URLSearchParams("range=last90"))).toBe("last90");
    expect(parseDashboardPreset(new URLSearchParams("range=today"))).toBe("last30");
  });

  it("re-buckets daily invoice rows into ISO weeks / months", () => {
    expect(bucketOf("2026-10-07", "week")).toBe("2026-10-05");
    expect(bucketOf("2026-10-07", "month")).toBe("2026-10-01");
    const rows = rebucket(
      [
        { date: "2026-10-05", sale: 100, count: 1 },
        { date: "2026-10-11", sale: 50, count: 2 },
        { date: "2026-10-12", sale: 10, count: 1 },
      ],
      "week",
      ["sale", "count"],
    );
    expect(rows.map((row) => [row.bucket, row.sale, row.count])).toEqual([
      ["2026-10-05", 150, 3],
      ["2026-10-12", 10, 1],
    ]);
  });
});

describe("chart formatting (tr / en)", () => {
  it("formats money, percent and counts in the panel language", () => {
    expect(formatValue(154230.5, "money", "tr")).toBe("₺154.230,50");
    expect(formatValue(3500, "money", "tr")).toBe("₺3.500");
    expect(formatValue(83.3, "percent", "tr")).toBe("%83,3");
    expect(formatValue(1234, "count", "en")).toBe("1,234");
    expect(formatValue(Number.NaN, "count", "tr")).toBe("0");
  });

  it("labels buckets as dd.MM for days/weeks and month names for months", () => {
    expect(formatBucket("2026-10-05", "day", "tr")).toBe("05.10");
    expect(formatBucket("2026-10-01", "month", "tr")).toMatch(/Eki/);
    expect(formatBucket("2026-10-01", "month", "en")).toMatch(/Oct/);
  });
});

describe("table export", () => {
  const rows = [
    { city: "İstanbul", orders: 40, revenue: 1200.5 },
    { city: 'Kars; "Merkez"', orders: 1, revenue: 0 },
  ];
  const columns = [
    { header: "Şehir", value: (row: (typeof rows)[number]) => row.city },
    { header: "Sipariş", value: (row: (typeof rows)[number]) => row.orders },
    { header: "Ciro", value: (row: (typeof rows)[number]) => row.revenue },
  ];

  it("writes BOM-prefixed, semicolon separated CSV with Turkish decimals and quoting", () => {
    const csv = toCsv(rows, columns);
    expect(csv.startsWith("﻿Şehir;Sipariş;Ciro\r\n")).toBe(true);
    expect(csv).toContain("İstanbul;40;1200,5\r\n");
    expect(csv).toContain('"Kars; ""Merkez""";1;0');
  });

  it("writes a SpreadsheetML workbook with numeric cells and escaped text", () => {
    const xml = toSpreadsheetXml(rows, columns, "Şehir kırılımı");
    expect(xml).toContain('<Worksheet ss:Name="Şehir kırılımı">');
    expect(xml).toContain('<Data ss:Type="Number">1200.5</Data>');
    expect(xml).toContain("Kars; &quot;Merkez&quot;");
  });

  it("builds ASCII file names from Turkish titles", () => {
    expect(exportFileName("Şehir kırılımı", "2026-09-01_2026-09-30", "csv")).toBe("sehir-kirilimi-2026-09-01_2026-09-30.csv");
    expect(exportFileName("İptal ve iade nedenleri", "", "xls")).toBe("iptal-ve-iade-nedenleri.xls");
  });
});
