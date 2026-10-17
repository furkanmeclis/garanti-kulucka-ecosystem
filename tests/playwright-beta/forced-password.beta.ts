import { expect, test } from "@playwright/test";
import { login, mockBackend, mockUser } from "./helpers";

test.use({ serviceWorkers: "block" });

test("temporary password blocks every page until password change succeeds, including after reload", async ({ page }) => {
  let rejectChange = true;
  const user = mockUser("admin", { must_change_password: true });
  const state = await mockBackend(page, user, { extra: ({ path }, state) => {
    if (path !== "/auth/account/password") return undefined;
    if (rejectChange) return { status: 400, body: { error: { code: "invalid_request", message: "Fixture rejection" } } };
    state.user.must_change_password = false;
    return { status: 200, body: { updated: true } };
  } });
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByRole("heading", { name: "Şifrenizi değiştirin" })).toBeVisible();
  await expect(page.getByTestId("topbar")).toHaveCount(0);
  expect(state.requests.some((request) => request.path.startsWith("/api/"))).toBe(false);
  await page.goto("/kullanicilar");
  await expect(page.getByTestId("forced-password-screen")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("forced-password-screen")).toBeVisible();
  await page.getByLabel("Yeni şifre", { exact: true }).fill("new-fixture-password");
  await page.getByLabel("Yeni şifre tekrar", { exact: true }).fill("different-password");
  await page.getByRole("button", { name: "Şifreyi değiştir", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Şifreler eşleşmiyor.");
  await page.getByLabel("Yeni şifre tekrar", { exact: true }).fill("new-fixture-password");
  await page.getByRole("button", { name: "Şifreyi değiştir", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Şifre değiştirilemedi.");
  await expect(page.getByTestId("topbar")).toHaveCount(0);
  rejectChange = false;
  await page.getByRole("button", { name: "Şifreyi değiştir", exact: true }).click();
  await expect(page.getByTestId("topbar")).toBeVisible();
  await expect(page.getByTestId("forced-password-screen")).toHaveCount(0);
});
