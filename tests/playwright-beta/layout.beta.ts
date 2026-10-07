import { expect, test } from "@playwright/test";
import { expectResponsiveLayout, login, mockBackend, mockUser, pathOf, viewports } from "./helpers";

test.use({ serviceWorkers: "block" });

const routes = ["/", "/siparisler", "/mesajlar", "/musteriler", "/kargolar", "/ayarlar"];

for (const [name, viewport] of Object.entries(viewports)) {
  test(`no horizontal overflow at ${name} (${viewport.width}px)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const state = await mockBackend(page, mockUser("admin", { first_name: "Ayşegül Nur", last_name: "Karaoğlanoğlu-Yıldırımtürk", email: "cok.uzun.bir.eposta.adresi@example.com" }));
    await page.goto("/giris");
    await expectResponsiveLayout(page, { checkTouchTargets: viewport.width < 768 });
    await login(page, state);
    await expect(page.getByTestId("topbar")).toBeVisible();
    const mobile = viewport.width < 768;
    for (const route of routes) {
      await page.goto(route);
      await expect(page.getByTestId("main")).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectResponsiveLayout(page, { checkTouchTargets: mobile });
    }
    if (mobile) {
      await expect(page.getByTestId("bottom-nav")).toBeVisible();
      await expect(page.getByTestId("desktop-nav")).toBeHidden();
    } else {
      await expect(page.getByTestId("bottom-nav")).toBeHidden();
    }
  });
}

test("mobile: hamburger sheet and bottom bar navigate; header keeps search, bell and profile", async ({ page }) => {
  await page.setViewportSize(viewports.phone390);
  const state = await mockBackend(page, mockUser("calisan"));
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("mobile-menu-trigger")).toBeVisible();
  for (const testId of ["search-trigger", "notification-trigger", "profile-menu-trigger"]) {
    await expect(page.getByTestId(testId)).toBeInViewport();
  }

  const bottom = page.getByTestId("bottom-nav");
  await expect(bottom.getByRole("link")).toHaveText(["Pano", "Siparişler", "Mesajlar", "Kargolar"]);
  await bottom.getByRole("link", { name: "Kargolar" }).click();
  await expect.poll(() => pathOf(page)).toBe("/kargolar");
  await expect(bottom.getByRole("link", { name: "Kargolar" })).toHaveAttribute("aria-current", "page");

  await page.getByTestId("mobile-menu-trigger").click();
  const sheet = page.getByTestId("mobile-menu");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("mobile-menu-main").getByRole("link")).toHaveText(["Pano", "Siparişler", "Mesajlar", "Müşteriler", "Kargolar", "Ayarlar"]);
  await expect(sheet.getByTestId("mobile-menu-more").getByRole("link")).toHaveText(["İptaller", "Stoklar", "Bakiyeler", "Yorumlar", "SMS"]);
  await expectResponsiveLayout(page, { checkTouchTargets: true });
  await sheet.getByRole("link", { name: "Müşteriler" }).click();
  await expect(sheet).toBeHidden();
  await expect.poll(() => pathOf(page)).toBe("/musteriler");

  // Search sheet sends the query to the first searchable page.
  await page.getByTestId("search-trigger").click();
  await page.getByRole("searchbox", { name: "Ara" }).fill("GK-1003");
  await page.keyboard.press("Enter");
  await expect.poll(() => `${pathOf(page)}${new URL(page.url()).search}`).toBe("/siparisler?q=GK-1003");
});

test("desktop: header has nav, search, bell with backend counts, language, theme and profile", async ({ page }) => {
  await page.setViewportSize(viewports.desktop);
  const state = await mockBackend(page, mockUser("admin"));
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("desktop-nav")).toBeVisible();
  await expect(page.getByTestId("mobile-menu-trigger")).toBeHidden();
  for (const testId of ["notification-trigger", "language-menu-trigger", "theme-menu-trigger", "profile-menu-trigger"]) {
    await expect(page.getByTestId(testId)).toBeVisible();
  }
  // 5 unread + 7 pending confirmations + 6 missing tracking numbers.
  await expect(page.getByTestId("notification-badge")).toHaveText("18");
  await page.getByTestId("notification-trigger").click();
  await expect(page.getByTestId("notification-messages")).toHaveText("5 okunmamış mesaj");
  await expect(page.getByTestId("notification-orders")).toHaveText("7 sipariş teyit bekliyor");
  await page.getByTestId("notification-shipments").click();
  await expect.poll(() => pathOf(page)).toBe("/kargolar");

  await page.setViewportSize(viewports.wide);
  await expect(page.getByTestId("search-trigger")).toBeHidden();
  await page.getByRole("searchbox", { name: "Ara" }).fill("Zeynep");
  await page.getByRole("button", { name: /Müşteriler içinde ara/ }).click();
  await expect.poll(() => `${pathOf(page)}${new URL(page.url()).search}`).toBe("/musteriler?q=Zeynep");
});
