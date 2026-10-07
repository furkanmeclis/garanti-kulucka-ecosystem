import { expect, test } from "@playwright/test";
import { expectResponsiveLayout, login, mockBackend, mockUser, pathOf, viewports } from "./helpers";

test.use({ serviceWorkers: "block" });

test("login links open the full legal pages, which link to the deletion form", async ({ page }) => {
  await page.setViewportSize(viewports.phone390);
  await mockBackend(page, mockUser("admin"));
  await page.goto("/giris");
  await page.getByTestId("login-links").getByRole("link", { name: "Gizlilik Politikası" }).click();
  await expect.poll(() => pathOf(page)).toBe("/gizlilik-politikasi");
  const privacy = page.getByTestId("page-legal-privacy");
  await expect(privacy.getByRole("heading", { name: "8. Haklarınız" })).toBeVisible();
  await expect(privacy).toContainText("KVKK (6698 sayılı Kişisel Verilerin Korunması Kanunu)");
  await expectResponsiveLayout(page, { checkTouchTargets: false });
  await privacy.getByRole("link", { name: "Veri Silme Talebi" }).click();
  await expect.poll(() => pathOf(page)).toBe("/veri-silme");
  await page.goto("/giris");
  await page.getByTestId("login-links").getByRole("link", { name: "Kullanım Koşulları" }).click();
  await expect(page.getByTestId("page-legal-terms")).toContainText("Adana Mahkemeleri ve İcra Daireleri yetkilidir.");
});

test("legal pages follow the English panel language", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("garanti-beta-lang", "en"));
  await mockBackend(page, mockUser("admin"));
  await page.goto("/kullanim-kosullari");
  await expect(page.getByRole("heading", { name: "Terms of Service" })).toBeVisible();
  await expect(page.getByTestId("page-legal-terms")).toContainText("10. Governing law");
});

test("remember me keeps only the email for the next login", async ({ page }) => {
  const state = await mockBackend(page, mockUser("admin"));
  await page.goto("/giris");
  await page.getByTestId("login-remember").check();
  await login(page, state);
  await expect(page.getByTestId("topbar")).toBeVisible();
  const stored = await page.evaluate(() => Object.entries(window.localStorage).filter(([key]) => key.includes("remember")));
  expect(stored).toEqual([["garanti-beta-remember-email", "admin@example.com"]]);
  expect(JSON.stringify(stored)).not.toContain(state.password);
});

test("legacy /kargo redirects to the beta shipments list", async ({ page }) => {
  await page.setViewportSize(viewports.desktop);
  const state = await mockBackend(page, mockUser("admin"));
  await page.goto("/giris");
  await login(page, state);
  await page.goto("/kargo");
  await expect.poll(() => pathOf(page)).toBe("/kargolar");
});

test("forgot password: request the e-mail, then set a new password from the link", async ({ page }) => {
  await page.setViewportSize(viewports.phone390);
  const state = await mockBackend(page, mockUser("admin"), {
    anonymous: (path) => path.startsWith("/auth/password-reset/"),
    extra: ({ path, body }) => {
      if (path === "/auth/password-reset/request") return { status: 202, body: { accepted: true } };
      if (path === "/auth/password-reset/confirm") {
        return (body as { token: string }).token === "tok_beta_reset_token_123456"
          ? { status: 200, body: { reset: true } }
          : { status: 400, body: { error: { code: "invalid_token", message: "Bağlantı geçersiz ya da süresi dolmuş. Yeni bir sıfırlama isteği gönderin." } } };
      }
      return undefined;
    },
  });
  await page.goto("/giris");
  await page.getByTestId("login-forgot").click();
  await expect.poll(() => pathOf(page)).toBe("/sifre-sifirla");
  const form = page.getByTestId("reset-password-form");
  await page.getByTestId("reset-password-submit").click();
  await expect(page.getByTestId("reset-password-error")).toHaveText("Geçerli bir e-posta adresi girin");
  await form.locator('input[name="email"]').fill("admin@example.com");
  await page.getByTestId("reset-password-submit").click();
  await expect(page.getByTestId("reset-password-done")).toContainText("şifre sıfırlama bağlantısı gönderildi");
  expect(state.bodies.find((entry) => entry.path === "/auth/password-reset/request")?.body).toEqual({ email: "admin@example.com" });
  await expectResponsiveLayout(page, { checkTouchTargets: true });

  await page.goto("/sifre-sifirla?token=tok_expired_token_0000000");
  await form.locator('input[name="password"]').fill("yeni-sifre");
  await form.locator('input[name="password-repeat"]').fill("yeni-sifre");
  await page.getByTestId("reset-password-submit").click();
  await expect(page.getByTestId("reset-password-error")).toContainText("Bağlantı geçersiz ya da süresi dolmuş");
  await page.goto("/sifre-sifirla?token=tok_beta_reset_token_123456");
  await form.locator('input[name="password"]').fill("yeni-sifre");
  await form.locator('input[name="password-repeat"]').fill("farkli");
  await page.getByTestId("reset-password-submit").click();
  await expect(page.getByTestId("reset-password-error")).toHaveText("Şifreler eşleşmiyor");
  await form.locator('input[name="password-repeat"]').fill("yeni-sifre");
  await page.getByTestId("reset-password-submit").click();
  await expect(page.getByTestId("reset-password-done")).toContainText("Şifreniz güncellendi");
  await page.getByTestId("reset-password-done").getByRole("link", { name: "Giriş sayfasına dön" }).click();
  await expect.poll(() => pathOf(page)).toBe("/giris");
});
