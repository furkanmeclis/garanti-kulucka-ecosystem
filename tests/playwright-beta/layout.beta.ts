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
      await test.step(route, async () => {
        await page.goto(route);
        await expect(page.getByTestId("main")).toBeVisible();
        await page.waitForLoadState("networkidle");
        await expectResponsiveLayout(page, { checkTouchTargets: mobile });
      });
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
  await expect(bottom.getByRole("link")).toHaveText(["Mesajlar", "Siparişler", "Kargolar", "Pano"]);
  await bottom.getByRole("link", { name: "Kargolar" }).click();
  await expect.poll(() => pathOf(page)).toBe("/kargolar");
  await expect(bottom.getByRole("link", { name: "Kargolar" })).toHaveAttribute("aria-current", "page");

  await page.getByTestId("mobile-menu-trigger").click();
  const sheet = page.getByTestId("mobile-menu");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("mobile-menu-main").getByRole("link")).toHaveText([/^Mesajlar/, /^Siparişler/, /^Kargolar/, "Müşteriler", "Pano"]);
  // Attention counts from the summaries: unread messages, pending confirmations, missing tracking.
  await expect(sheet.getByTestId("mobile-menu-badge-messages")).toHaveText("5");
  await expect(sheet.getByTestId("mobile-menu-badge-orders")).toHaveText("7");
  await expect(sheet.getByTestId("mobile-menu-badge-shipments")).toHaveText("6");
  await expect(sheet.getByTestId("mobile-menu-badge-messages")).toHaveAttribute("aria-label", /5/);
  await expect(sheet.getByTestId("mobile-menu-operations").getByRole("link")).toHaveText(["Kargo Pipeline", "İptaller", "Stoklar", "Yorumlar", "SMS"]);
  await expect(sheet.getByTestId("mobile-menu-accounting").getByRole("link")).toHaveText(["Bakiyeler"]);
  await expect(sheet.getByTestId("mobile-menu-instagram").getByRole("link")).toHaveText(["Instagram Analitik", "Instagram Yayın"]);
  // Staff see no voice pages, so that section is left out; settings is always there.
  await expect(sheet.getByTestId("mobile-menu-voice")).toHaveCount(0);
  await expect(sheet.getByTestId("mobile-menu-settings").getByRole("link")).toHaveText(["Genel"]);
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

test("profile menu: staff toggle their presence (PATCH /auth/presence), admins have no toggle", async ({ page }) => {
  await page.setViewportSize(viewports.desktop);
  const state = await mockBackend(page, mockUser("calisan"));
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("profile-presence-dot")).toHaveAttribute("data-online", "false");
  await page.getByTestId("profile-menu-trigger").click();
  const toggle = page.getByTestId("profile-presence-toggle");
  await expect(toggle).toHaveText("Çevrimdışı (çevrimiçi ol)");
  await toggle.click();
  await expect(toggle).toHaveText("Çevrimiçi (çevrimdışı ol)");
  await expect(page.getByTestId("profile-presence-dot")).toHaveAttribute("data-online", "true");
  expect(state.bodies.filter((entry) => entry.path === "/auth/presence")).toEqual([{ method: "PATCH", path: "/auth/presence", body: { online: true } }]);
  await toggle.click();
  await expect(toggle).toHaveText("Çevrimdışı (çevrimiçi ol)");
  expect(state.bodies.filter((entry) => entry.path === "/auth/presence").at(-1)?.body).toEqual({ online: false });

  // Admins are ghost observers: no dot, no toggle.
  await page.getByTestId("profile-menu-logout").click();
  await expect.poll(() => pathOf(page)).toBe("/giris");
  const admin = await mockBackend(page, mockUser("admin"));
  await login(page, admin);
  await expect(page.getByTestId("profile-menu-trigger")).toBeVisible();
  await expect(page.getByTestId("profile-presence-dot")).toHaveCount(0);
  await page.getByTestId("profile-menu-trigger").click();
  await expect(page.getByTestId("profile-menu-logout")).toBeVisible();
  await expect(page.getByTestId("profile-presence-toggle")).toHaveCount(0);
});

test("desktop: header has nav, search, bell with backend counts, language, theme and profile", async ({ page }) => {
  await page.setViewportSize(viewports.desktop);
  const state = await mockBackend(page, mockUser("admin"));
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("desktop-nav")).toBeVisible();
  await expect(page.getByTestId("mobile-menu-trigger")).toBeHidden();
  for (const testId of ["notification-trigger", "language-menu-trigger", "theme-toggle", "profile-menu-trigger"]) {
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

test("desktop: grouped dropdowns and the settings area with its sub-nav", async ({ page }) => {
  await page.setViewportSize(viewports.desktop);
  const state = await mockBackend(page, mockUser("admin"));
  await page.goto("/giris");
  await login(page, state);
  const nav = page.getByTestId("desktop-nav");
  for (const group of ["operations", "accounting", "instagram", "voice"]) await expect(nav.getByTestId(`nav-group-trigger-${group}`)).toBeVisible();
  await expect(nav.getByRole("link", { name: "Ayarlar" })).toHaveAttribute("data-testid", "desktop-settings-link");

  await nav.getByTestId("nav-group-trigger-instagram").click();
  await expect(page.getByTestId("nav-group-menu-instagram").getByRole("menuitem")).toHaveText(["Instagram Analitik", "Instagram Yayın"]);
  await page.getByTestId("nav-item-instagramAnalytics").click();
  await expect.poll(() => pathOf(page)).toBe("/instagram/analitik");
  await expect(nav.getByTestId("nav-group-trigger-instagram")).toHaveClass(/bg-accent/);

  // Settings: one gear link, then a sectioned sub-nav; debug pages under /kargolar light up settings, not Kargolar.
  await page.getByTestId("desktop-settings-link").click();
  await expect.poll(() => pathOf(page)).toBe("/ayarlar");
  await expect(page.getByRole("heading", { name: "Ayarlar", level: 1 })).toBeVisible();
  const sub = page.getByTestId("settings-nav");
  await expect(sub.getByTestId("settings-nav-general").getByRole("link")).toHaveText(["Genel"]);
  await expect(sub.getByTestId("settings-nav-management").getByRole("link")).toHaveText(["Kullanıcılar", "İşlem Logları", "Veri Silme Talepleri"]);
  await expect(sub.getByTestId("settings-nav-developer").getByRole("link")).toHaveText(["Sürat Debug", "Cron Debug", "WhatsApp Debug", "Instagram Debug", "AI Debug", "AI Eğitim"]);
  await expect(page.getByTestId("settings-nav-item-settings")).toHaveAttribute("aria-current", "page");
  await page.getByTestId("settings-nav-item-cronDebug").click();
  await expect.poll(() => pathOf(page)).toBe("/kargolar/cron-debug");
  await expect(page.getByTestId("settings-nav-item-cronDebug")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("desktop-settings-link")).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Kargolar" })).not.toHaveAttribute("aria-current", "page");
  await expectResponsiveLayout(page, { checkTouchTargets: false });

  // Phone: the sub-nav becomes a horizontally scrolling strip without page overflow.
  await page.setViewportSize(viewports.phone360);
  await page.goto("/kullanicilar");
  await expect(page.getByTestId("settings-nav-item-users")).toHaveAttribute("aria-current", "page");
  const strip = await page.getByTestId("settings-nav").evaluate((element) => ({ overflowX: getComputedStyle(element).overflowX, scrollable: element.scrollWidth > element.clientWidth }));
  expect(strip).toEqual({ overflowX: "auto", scrollable: true });
  await expectResponsiveLayout(page, { checkTouchTargets: true });
});
