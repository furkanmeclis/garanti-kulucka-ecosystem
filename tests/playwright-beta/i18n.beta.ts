import { expect, test } from "@playwright/test";
import { login, mockBackend, mockUser } from "./helpers";

test.use({ serviceWorkers: "block" });

test("TR is the default; EN switch translates login, menu and pages and is remembered", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const state = await mockBackend(page, mockUser("calisan"));
  await page.goto("/giris");
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
  await expect(page.getByRole("heading", { name: "Panele giriş" })).toBeVisible();

  // Switch on the login screen.
  await page.getByTestId("language-menu-trigger").click();
  await page.getByTestId("language-option-en").click();
  await expect(page.getByRole("heading", { name: "Sign in to the panel" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await page.evaluate(() => window.localStorage.getItem("garanti-beta-lang"))).toBe("en");

  await login(page, state);
  await expect(page.getByTestId("desktop-nav").getByRole("link")).toHaveText(["Dashboard", "Orders", "Messages", "Customers", "Shipments", "Settings"]);
  await page.getByTestId("profile-menu-trigger").click();
  await expect(page.getByTestId("profile-role")).toHaveText("Staff");
  await expect(page.getByTestId("profile-menu-logout")).toHaveText("Sign out");
  await page.keyboard.press("Escape");

  // Remembered after reload, then back to Turkish from the header.
  await page.reload();
  await expect(page.getByTestId("desktop-nav").getByRole("link", { name: "Orders" })).toBeVisible();
  await page.getByTestId("language-menu-trigger").click();
  await page.getByTestId("language-option-tr").click();
  await expect(page.getByTestId("desktop-nav").getByRole("link")).toHaveText(["Pano", "Siparişler", "Mesajlar", "Müşteriler", "Kargolar", "Ayarlar"]);
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
});

test("theme switch toggles dark mode and is remembered", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  const state = await mockBackend(page, mockUser("admin"));
  await page.goto("/giris");
  await login(page, state);
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByTestId("theme-menu-trigger").click();
  await page.getByTestId("theme-option-dark").click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});
