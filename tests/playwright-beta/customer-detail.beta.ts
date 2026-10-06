import { expect, test, type Page } from "@playwright/test";
import { expectResponsiveLayout, login, mockBackend, mockUser, pathOf, viewports } from "./helpers";

test.use({ serviceWorkers: "block" });

async function signIn(page: Page, viewport: { width: number; height: number } = viewports.desktop, role = "calisan") {
  await page.setViewportSize(viewport);
  const state = await mockBackend(page, mockUser(role));
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("topbar")).toBeVisible();
  return state;
}

test("customer list links to the detail page; profile edit and notes are saved", async ({ page }) => {
  const state = await signIn(page);
  await page.goto("/musteriler");
  await page.getByTestId("customers-table").getByTestId("customer-link").first().click();
  await expect.poll(() => pathOf(page)).toBe("/musteriler/cus_1");
  await expect(page.getByTestId("page-customer-detail").getByRole("heading", { level: 1 })).toHaveText("Mehmet Müşteri 1");
  await expect(page.getByTestId("customer-addresses")).toContainText("Atatürk Cd. No:1");
  await expect(page.getByTestId("customer-orders")).toContainText("Siparişler (3)");
  await expect(page.getByTestId("customer-conversations")).toContainText("Konuşmalar (2)");

  await page.getByTestId("customer-edit").click();
  await page.getByLabel("Ad soyad").fill("Mehmet Yeni");
  await page.getByLabel("E-posta").fill("yeni@example.com");
  await page.getByTestId("customer-save").click();
  await expect(page.getByTestId("customer-feedback")).toHaveText("Müşteri bilgileri kaydedildi.");
  await expect(page.getByTestId("page-customer-detail").getByRole("heading", { level: 1 })).toHaveText("Mehmet Yeni");
  expect(state.bodies.find((entry) => entry.path === "/api/customers/cus_1")?.body).toEqual({
    full_name: "Mehmet Yeni",
    phone: "05321000001",
    email: "yeni@example.com",
    username: null,
  });

  await page.getByTestId("customer-notes-input").fill("Yedek parça teklifi gönderildi");
  await page.getByTestId("customer-notes-save").click();
  await expect(page.getByTestId("customer-feedback")).toHaveText("Not kaydedildi.");
  expect(state.bodies.find((entry) => entry.path === "/api/customers/cus_1/notes")?.body).toEqual({ notes: "Yedek parça teklifi gönderildi" });

  await page.getByTestId("customer-order-link").first().click();
  await expect.poll(() => `${pathOf(page)}${new URL(page.url()).search}`).toBe("/siparisler?q=GK-1001");
  await expect(page.getByTestId("orders-row")).toHaveCount(1);
});

test("customer detail: not found, English and mobile layout", async ({ page }) => {
  await signIn(page, viewports.phone360);
  await page.goto("/musteriler/cus_yok");
  await expect(page.getByTestId("customer-not-found")).toHaveText("Müşteri bulunamadı.");

  await page.goto("/musteriler/cus_2");
  await expect(page.getByTestId("customer-profile")).toBeVisible();
  await expectResponsiveLayout(page, { checkTouchTargets: true });

  await page.evaluate(() => window.localStorage.setItem("garanti-beta-lang", "en"));
  await page.reload();
  await expect(page.getByTestId("customer-profile")).toContainText("Customer information");
  await expect(page.getByTestId("customer-back")).toHaveText("Back to customers");
});

test("cargo operator cannot open customer details", async ({ page }) => {
  await signIn(page, viewports.desktop, "kargo_operatoru");
  await page.goto("/musteriler/cus_1");
  await expect.poll(() => pathOf(page)).toBe("/siparisler");
});
