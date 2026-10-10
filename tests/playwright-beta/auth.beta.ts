import { expect, test } from "@playwright/test";
import { login, mockBackend, mockUser, pathOf } from "./helpers";

test.use({ serviceWorkers: "block" });

test("anonymous visitors land on /giris and return to the requested page after login", async ({ page }) => {
  const state = await mockBackend(page, mockUser("admin"));
  await page.goto("/kargolar");
  await expect(page.getByTestId("login-form")).toBeVisible();
  expect(pathOf(page)).toBe("/giris");

  // Wrong password shows a translated error and keeps the user on the form.
  await page.getByLabel("E-posta").fill(state.user.email);
  await page.getByLabel("Şifre").fill("yanlis");
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await expect(page.getByTestId("login-error")).toHaveText("E-posta veya şifre hatalı.");

  await login(page, state);
  await expect.poll(() => pathOf(page)).toBe("/kargolar");
  await expect(page.getByTestId("topbar")).toBeVisible();
  const authed = state.requests.filter((request) => request.path.startsWith("/api/"));
  expect(authed.length).toBeGreaterThan(0);
  expect(authed.every((request) => request.auth === "Bearer beta-access")).toBe(true);

  // Session survives a reload via /auth/me with the stored bearer token.
  await page.reload();
  await expect(page.getByTestId("topbar")).toBeVisible();
  expect(state.requests.some((request) => request.path === "/auth/me" && request.auth === "Bearer beta-access")).toBe(true);

  // Logout from the profile menu clears the session.
  await page.getByTestId("profile-menu-trigger").click();
  await expect(page.getByTestId("profile-name")).toHaveText("Ayşe Yılmaz");
  await expect(page.getByTestId("profile-role")).toHaveText("Yönetici");
  await page.getByTestId("profile-menu-logout").click();
  await expect(page.getByTestId("login-form")).toBeVisible();
  expect(state.requests.some((request) => request.path === "/auth/logout")).toBe(true);
  expect(await page.evaluate(() => window.localStorage.getItem("garanti-beta.session"))).toBeNull();
  await page.goto("/");
  await expect.poll(() => pathOf(page)).toBe("/giris");
});

const roleCases = [
  { role: "owner", home: "/", menu: ["Pano", "Siparişler", "Mesajlar", "Müşteriler", "Kargolar", "Ayarlar"], groups: ["Operasyon", "Muhasebe", "Instagram", "Sesli Asistan"], label: "Sahip" },
  { role: "admin", home: "/", menu: ["Pano", "Siparişler", "Mesajlar", "Müşteriler", "Kargolar", "Ayarlar"], groups: ["Operasyon", "Muhasebe", "Instagram", "Sesli Asistan"], label: "Yönetici" },
  { role: "calisan", home: "/", menu: ["Pano", "Siparişler", "Mesajlar", "Müşteriler", "Kargolar", "Ayarlar"], groups: ["Operasyon", "Muhasebe", "Instagram"], label: "Personel" },
  { role: "kargo_operatoru", home: "/siparisler", menu: ["Siparişler", "Mesajlar", "Kargolar", "Ayarlar"], groups: ["Operasyon"], label: "Kargo operatörü" },
] as const;

for (const item of roleCases) {
  test(`${item.role} gets its role menu, home page and is kept out of other pages`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const state = await mockBackend(page, mockUser(item.role));
    await page.goto("/giris");
    await login(page, state);
    await expect.poll(() => pathOf(page)).toBe(item.home);
    await expect(page.getByTestId("desktop-nav").getByRole("link")).toHaveText([...item.menu]);
    // Dropdown groups the role sees nothing of are left out of the bar.
    await expect(page.getByTestId("desktop-nav").getByRole("button")).toHaveText([...item.groups]);
    await page.getByTestId("profile-menu-trigger").click();
    await expect(page.getByTestId("profile-role")).toHaveText(item.label);
    await page.keyboard.press("Escape");

    if (item.role === "kargo_operatoru") {
      for (const forbidden of ["/", "/musteriler"]) {
        await page.goto(forbidden);
        await expect.poll(() => pathOf(page)).toBe("/siparisler");
      }
    }
    await page.goto("/olmayan-sayfa");
    await expect.poll(() => pathOf(page)).toBe(item.home);
  });
}

test("an expired session falls back to the login page", async ({ page }) => {
  await mockBackend(page, mockUser("admin"));
  await page.addInitScript(() => window.localStorage.setItem("garanti-beta.session", JSON.stringify({ access_token: "expired", refresh_token: "expired" })));
  await page.goto("/siparisler");
  await expect(page.getByTestId("login-form")).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.getItem("garanti-beta.session"))).toBeNull();
});
