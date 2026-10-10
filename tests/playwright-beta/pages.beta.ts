import { expect, test, type Page } from "@playwright/test";
import { login, mockBackend, mockUser, pathOf, viewports, type BackendState } from "./helpers";

test.use({ serviceWorkers: "block" });

async function signIn(page: Page, role = "admin", viewport: { width: number; height: number } = viewports.desktop) {
  await page.setViewportSize(viewport);
  const state = await mockBackend(page, mockUser(role));
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("topbar")).toBeVisible();
  return state;
}

const lastRequest = (state: BackendState, path: string) => [...state.requests].reverse().find((request) => request.path === path);

async function pickFilter(page: Page, testId: string, value: string) {
  await page.getByTestId(testId).click();
  await page.getByTestId(`${testId}-${value}`).click();
}

test("dashboard shows the analytics snapshot, KPI tiles and work-list links", async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId("stat-pending-shipments-value")).toHaveText("19");
  await expect(page.getByTestId("stat-customers-value")).toHaveText("342");
  await expect(page.getByTestId("kpi-orders-value")).toHaveText("180");
  await expect(page.getByTestId("kpi-revenue-value")).toHaveText("₺540.000");
  await expect(page.getByTestId("dashboard-providers")).toContainText("Sürat");
  await expect(page.getByTestId("attention-awaiting-count")).toHaveText("7");
  await page.getByTestId("attention-awaiting").click();
  await expect.poll(() => `${pathOf(page)}${new URL(page.url()).search}`).toBe("/siparisler?status=pending_confirmation");
});

test("orders: server-side search, filters, sort and paging; table on desktop, cards on mobile", async ({ page }) => {
  const state = await signIn(page);
  await page.goto("/siparisler");
  await expect(page.getByTestId("orders-table")).toBeVisible();
  await expect(page.getByTestId("orders-cards")).toBeHidden();
  await expect(page.getByTestId("orders-row")).toHaveCount(20);
  await expect(page.getByTestId("pagination-summary")).toHaveText("1–20 / 45");

  await page.getByTestId("pagination-next").click();
  await expect(page.getByTestId("pagination-page")).toHaveText("2 / 3");
  await expect.poll(() => lastRequest(state, "/api/orders")?.search).toContain("offset=20");

  await pickFilter(page, "filter-status", "delivered");
  await expect.poll(() => lastRequest(state, "/api/orders")?.search).toContain("status=delivered");
  await expect(page.getByTestId("pagination-page")).toHaveText("1 / 1");
  await expect(page.getByTestId("orders-row").first()).toContainText("Teslim edildi");

  await pickFilter(page, "filter-sort", "amount");
  await expect.poll(() => lastRequest(state, "/api/orders")?.search).toContain("sort_by=total_amount");

  await page.getByTestId("list-search").fill("GK-1003");
  await expect.poll(() => lastRequest(state, "/api/orders")?.search).toContain("search=GK-1003");
  await expect(page.getByTestId("orders-row")).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get("q")).toBe("GK-1003");

  await page.getByTestId("list-clear").click();
  await expect(page.getByTestId("orders-row")).toHaveCount(20);

  await page.setViewportSize(viewports.phone390);
  await expect(page.getByTestId("orders-cards")).toBeVisible();
  await expect(page.getByTestId("orders-table")).toBeHidden();
  await expect(page.getByTestId("orders-card").first()).toContainText("GK-1001");
});

test("global search lands on a filtered order list", async ({ page }) => {
  const state = await signIn(page, "calisan", viewports.wide);
  await page.getByRole("searchbox", { name: "Ara" }).fill("GK-1010");
  await page.keyboard.press("Enter");
  await expect.poll(() => pathOf(page)).toBe("/siparisler");
  await expect(page.getByTestId("list-search")).toHaveValue("GK-1010");
  await expect.poll(() => lastRequest(state, "/api/orders")?.search).toContain("search=GK-1010");
  await expect(page.getByTestId("orders-row")).toHaveCount(1);
});

test("messages: unread filter, channel filter and server search", async ({ page }) => {
  const state = await signIn(page);
  await page.goto("/mesajlar");
  const rows = page.getByTestId("conversation-row");
  // Legacy default: only unread conversations (27 mocked, every third has none).
  await expect(rows).toHaveCount(18);
  await expect(page.getByTestId("filter-unread")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("filter-unread").click();
  await expect(rows).toHaveCount(27);

  await page.getByTestId("channel-filter").click();
  await page.getByTestId("channel-filter-instagram").click();
  await expect.poll(() => lastRequest(state, "/api/conversations")?.search).toContain("channel=instagram");
  await expect(rows).toHaveCount(13);
  await page.getByTestId("channel-filter").click();
  await page.getByTestId("channel-filter-messenger").click();
  await expect.poll(() => lastRequest(state, "/api/conversations")?.search).toContain("channel=facebook%2Cmessenger");
  await expect(rows).toHaveCount(14);

  await page.getByTestId("channel-filter").click();
  await page.getByTestId("channel-filter-all").click();
  await page.getByTestId("conversation-search").fill("Müşterisi 4");
  await expect.poll(() => state.requests.some((request) => request.path === "/api/conversations" && request.search.includes("search=M%C3%BC%C5%9Fterisi+4"))).toBe(true);
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Konuşma Müşterisi 4");
});

test("customers: contact filter, search and paging", async ({ page }) => {
  await signIn(page);
  await page.goto("/musteriler");
  await expect(page.getByTestId("pagination-summary")).toHaveText("1–20 / 31");
  await pickFilter(page, "filter-contact", "email");
  await expect(page.getByTestId("pagination-summary")).toHaveText("1–10 / 10");
  await page.getByTestId("list-search").fill("musteri9@");
  await expect(page.getByTestId("customers-row")).toHaveCount(1);
  await expect(page.getByTestId("customers-row")).toContainText("musteri9@example.com");
});

test("shipments: provider/status filters and search use the API", async ({ page }) => {
  const state = await signIn(page, "kargo_operatoru");
  await page.goto("/kargolar");
  await expect(page.getByTestId("shipments-row")).toHaveCount(20);
  await pickFilter(page, "filter-provider", "ptt");
  await expect.poll(() => lastRequest(state, "/api/shipments")?.search).toContain("provider=ptt");
  await pickFilter(page, "filter-status", "in_transit");
  await expect.poll(() => lastRequest(state, "/api/shipments")?.search).toContain("status=in_transit");
  await expect(page.getByTestId("shipments-row").first()).toContainText("Yolda");
  await page.getByTestId("list-search").fill("TRK900002");
  await expect.poll(() => lastRequest(state, "/api/shipments")?.search).toContain("search=TRK900002");
  await expect(page.getByTestId("shipments-row")).toHaveCount(1);
});

test("settings: profile update, password validation and preferences", async ({ page }) => {
  const state = await signIn(page);
  await page.goto("/ayarlar");
  await page.getByLabel("Ad", { exact: true }).fill("Fatma");
  await page.getByLabel("Soyad").fill("Demir");
  await page.getByTestId("profile-save").click();
  await expect(page.getByTestId("profile-feedback")).toHaveText("Profil güncellendi.");
  expect(state.user.first_name).toBe("Fatma");
  await page.getByTestId("profile-menu-trigger").click();
  await expect(page.getByTestId("profile-name")).toHaveText("Fatma Demir");
  await page.keyboard.press("Escape");

  await page.getByLabel("Yeni şifre", { exact: true }).fill("guclu-sifre-1");
  await page.getByLabel("Yeni şifre (tekrar)").fill("farkli-sifre-2");
  await page.getByTestId("password-save").click();
  await expect(page.getByTestId("password-feedback")).toHaveText("Şifreler eşleşmiyor.");
  await page.getByLabel("Yeni şifre (tekrar)").fill("guclu-sifre-1");
  await page.getByTestId("password-save").click();
  await expect(page.getByTestId("password-feedback")).toHaveText("Şifre güncellendi.");
  expect(state.requests.some((request) => request.path === "/auth/account/password")).toBe(true);

  await pickFilter(page, "settings-language", "en");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(page.getByTestId("settings-install")).toContainText("Add the panel");
});

test("English content on list pages, including status badges and money", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("garanti-beta-lang", "en"));
  await signIn(page);
  await expect(page.getByTestId("kpi-revenue-value")).toHaveText("₺540,000");
  await page.goto("/siparisler");
  await expect(page.getByRole("heading", { name: "Orders", level: 1 })).toBeVisible();
  await expect(page.getByTestId("orders-table").locator("th")).toHaveText(["", "Order no.", "Customer", "Status", "Badges", "Carrier", "Amount", "Date", ""]);
  await expect(page.getByTestId("orders-row").first()).toContainText("Awaiting confirmation");
  await expect(page.getByTestId("pagination-summary")).toHaveText("1–20 of 45");
});

test("a failing list shows a retry state", async ({ page }) => {
  const state = await signIn(page);
  state.fail.add("/api/shipments");
  await page.goto("/kargolar");
  await expect(page.getByTestId("error-state")).toBeVisible();
  state.fail.delete("/api/shipments");
  await page.getByTestId("error-state").getByRole("button").click();
  await expect(page.getByTestId("shipments-row")).toHaveCount(20);
});
