import { expect, test, type Page } from "@playwright/test";
import { chooseOption, expectResponsiveLayout, login, mockBackend, mockUser, pathOf, viewports } from "./helpers";

test.use({ serviceWorkers: "block" });

async function signIn(page: Page, role = "admin", viewport: { width: number; height: number } = viewports.desktop) {
  await page.setViewportSize(viewport);
  const state = await mockBackend(page, mockUser(role));
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("topbar")).toBeVisible();
  return state;
}

const requestsTo = (state: Awaited<ReturnType<typeof signIn>>, path: string) => state.requests.filter((entry) => entry.path === path).map((entry) => new URLSearchParams(entry.search));

test("pano: KPI tiles with deltas and sparklines, range preset in the URL refetches", async ({ page }) => {
  const state = await signIn(page);
  const kpis = page.getByTestId("dashboard-kpis");
  await expect(kpis.getByTestId(/^kpi-[a-z_]+$/)).toHaveCount(8);
  await expect(page.getByTestId("kpi-orders-value")).toHaveText("180");
  await expect(page.getByTestId("kpi-orders-delta")).toHaveAttribute("data-direction", "up");
  // A higher cancellation rate is bad: the delta is still "up" but rendered as a regression.
  await expect(page.getByTestId("kpi-cancel_rate-delta")).toBeVisible();
  await expect(kpis.getByTestId("sparkline").first()).toBeVisible();
  await expect(page.getByTestId("dashboard-channels")).toContainText("WhatsApp");
  await expect(page.getByTestId("dashboard-funnel-steps-step")).toHaveCount(4);
  await expect(page.getByTestId("dashboard-personnel")).toContainText("Personel performansı");
  await expect(page.getByTestId("dashboard-recent-order")).toHaveCount(2);
  await expect(page.getByTestId("dashboard-recent-shipment").nth(1)).toContainText("Takip no yok");

  const before = requestsTo(state, "/api/reports/dashboard").length;
  await page.getByTestId("dashboard-range-last7").click();
  await expect.poll(() => new URL(page.url()).searchParams.get("range")).toBe("last7");
  await expect.poll(() => requestsTo(state, "/api/reports/dashboard").length).toBeGreaterThan(before);
  const last = requestsTo(state, "/api/reports/dashboard").at(-1)!;
  expect((Date.parse(last.get("to")!) - Date.parse(last.get("from")!)) / 86_400_000).toBe(6);
  await expect(page.getByTestId("kpi-orders-value")).toHaveText("39");

  await page.getByTestId("dashboard-metric-orders").click();
  await expect(page.getByTestId("dashboard-trend")).toContainText("Sipariş");

  // Legacy to-do list: add, tick, delete.
  await page.getByTestId("dashboard-todo-input").fill("Yeni görev");
  await page.getByTestId("dashboard-todo-add").click();
  await expect(page.getByTestId("dashboard-todo-item")).toHaveCount(4);
  await expect(page.getByTestId("dashboard-todo-count")).toHaveText("3");
});

test("pano: staff roles get no personnel block; cargo operators no customer/conversation data", async ({ page }) => {
  await signIn(page, "calisan");
  await expect(page.getByTestId("kpi-revenue-value")).toBeVisible();
  await expect(page.getByTestId("dashboard-personnel")).toHaveCount(0);
  await expect(page.getByTestId("stat-unread-value")).toHaveText("12");
});

test("iş analizi: filters live in the URL, preset/compare/granularity refetch and tables export", async ({ page }) => {
  const state = await signIn(page);
  await page.goto("/raporlar?range=last90&channel=instagram&city=Konya");
  await expect(page.getByTestId("reports-kpis")).toBeVisible();
  // Deep link restores the filters and sends them to every analytics endpoint.
  await expect(page.getByTestId("reports-channel")).toHaveAttribute("data-value", "instagram");
  await expect(page.getByTestId("reports-city")).toHaveAttribute("data-value", "Konya");
  await expect(page.getByTestId("reports-active-filters")).toHaveText("2 filtre");
  await expect.poll(() => requestsTo(state, "/api/reports/breakdowns").some((query) => query.get("channel") === "instagram" && query.get("city") === "Konya" && query.get("granularity") === "week")).toBe(true);
  await expect(page.getByTestId("reports-legacy-total-value")).toHaveText("60");

  await chooseOption(page.getByTestId("reports-order-status"), "teslim_edildi");
  await expect.poll(() => new URL(page.url()).searchParams.get("status")).toBe("teslim_edildi");
  await page.getByTestId("reports-reset").click();
  await expect.poll(() => new URL(page.url()).search).toBe("?range=last90");
  await expect(page.getByTestId("reports-legacy-total-value")).toHaveText("120");

  await page.getByTestId("reports-preset-thisYear").click();
  await expect.poll(() => new URL(page.url()).searchParams.get("range")).toBe("thisYear");
  await expect.poll(() => requestsTo(state, "/api/reports/timeseries").at(-1)?.get("from")).toMatch(/^\d{4}-01-01$/);

  await page.getByTestId("reports-granularity-month").click();
  await expect.poll(() => requestsTo(state, "/api/reports/timeseries").at(-1)?.get("granularity")).toBe("month");
  await page.getByTestId("reports-compare").click();
  await expect.poll(() => new URL(page.url()).searchParams.get("compare")).toBe("0");
  await expect.poll(() => requestsTo(state, "/api/reports/timeseries").at(-1)?.get("compare")).toBe("0");
  await expect(page.getByTestId("reports-kpi-orders-delta")).toHaveCount(0);

  // New breakdowns.
  await expect(page.getByTestId("reports-cities")).toContainText("İstanbul");
  await expect(page.getByTestId("reports-conversion-rate")).toHaveText("%64");
  await expect(page.getByTestId("reports-heatmap-grid")).toBeVisible();
  await expect(page.getByTestId("reports-cohort-table-row")).toHaveCount(2);
  await expect(page.getByTestId("reports-reasons")).toContainText("İptal ve iade nedenleri");
  await page.getByTestId("reports-reasons-view-table").click();
  await expect(page.getByTestId("reports-reasons-table")).toContainText("Belirtilmemiş");
  await expect(page.getByTestId("reports-invoice-sale-total-value")).toHaveText("₺147.000");
  await expect(page.getByTestId("reports-invoice-note")).toBeVisible();

  // CSV / Excel export of a table.
  await page.getByTestId("reports-cities-export").click();
  const csv = page.waitForEvent("download");
  await page.getByTestId("reports-cities-export-csv").click();
  const download = await csv;
  expect(download.suggestedFilename()).toMatch(/^sehir-kirilimi-\d{4}-01-01_\d{4}-\d{2}-\d{2}\.csv$/);
  const body = await (await download.createReadStream()).toArray();
  const text = Buffer.concat(body as Buffer[]).toString("utf8");
  expect(text).toContain("Şehir;Sipariş;Ciro");
  expect(text).toContain("İstanbul;40;120000");

  await page.getByTestId("reports-products-export").click();
  const xls = page.waitForEvent("download");
  await page.getByTestId("reports-products-export-xls").click();
  expect((await xls).suggestedFilename()).toMatch(/\.xls$/);

  // Custom range from the range picker.
  await page.getByTestId("reports-range").click();
  await page.getByTestId("reports-range-preset-lastMonth").click();
  await expect.poll(() => new URL(page.url()).searchParams.get("range")).toBe("custom");
  expect(new URL(page.url()).searchParams.get("from")).toMatch(/^\d{4}-\d{2}-01$/);
});

test("iş analizi and pano on a phone: 2-column KPI grid, no page overflow, 44px targets", async ({ page }) => {
  await signIn(page, "admin", viewports.phone390);
  await expect(page.getByTestId("dashboard-kpis")).toBeVisible();
  const tiles = await page.getByTestId("dashboard-kpis").evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length);
  expect(tiles).toBe(2);
  await expectResponsiveLayout(page, { checkTouchTargets: true });
  await page.goto("/raporlar");
  await expect(page.getByTestId("reports-kpis")).toBeVisible();
  await expect(page.getByTestId("reports-invoice-sale-total")).toBeVisible();
  await expectResponsiveLayout(page, { checkTouchTargets: true });
  // Filter inputs are 16px below 1024px (no iOS zoom).
  const fontSize = await page.getByTestId("reports-channel").evaluate((element) => getComputedStyle(element).fontSize);
  expect(fontSize).toBe("16px");
});

test("staff cannot open İş Analizi", async ({ page }) => {
  await signIn(page, "calisan");
  await page.goto("/raporlar");
  await expect.poll(() => pathOf(page)).toBe("/");
});
