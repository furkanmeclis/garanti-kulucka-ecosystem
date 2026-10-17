import { expect, test } from "@playwright/test";
import { login, mockBackend, mockUser, viewports } from "./helpers";

test.use({ serviceWorkers: "block" });

for (const language of ["tr", "en"] as const) {
  test(`customer merge: candidates, search, preview, confirmation and target navigation (${language}, mobile)`, async ({ page }) => {
    await page.setViewportSize(viewports.phone360);
    const state = await mockBackend(page, mockUser("calisan"));
    let mergeBody: unknown;
    let attempts = 0;
    let searched = false;
    const target = { public_id: "cus_2", full_name: "Hedef Müşteri", phone: "05551112233", email: null, orders_count: 4, conversations_count: 2 };
    await page.route("**/api/customers/**/merge-candidates", (route) => route.fulfill({ json: { data: [target] } }));
    await page.route("**/api/customers/**/merge-preview", (route) => route.fulfill({ json: { counts: { orders: 3, conversations: 2, customer_addresses: 1, customer_external_identities: 1, shipments: 2, notes: 1 } } }));
    await page.route("**/api/customers?*", async (route) => {
      if (new URL(route.request().url()).searchParams.has("search")) {
        searched = true;
        return route.fulfill({ json: { data: [target] } });
      }
      await route.fallback();
    });
    await page.route("**/api/customers/cus_2/merge", (route) => {
      mergeBody = route.request().postDataJSON();
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 500, json: { error: { code: "internal_error", message: "Please retry" } } });
      return route.fulfill({ json: { target_public_id: "cus_2", source_public_id: "cus_1", counts: { orders: 3 } } });
    });
    await page.goto("/giris");
    await login(page, state);
    await page.evaluate((lang) => window.localStorage.setItem("garanti-beta-lang", lang), language);
    await page.goto("/musteriler/cus_1");
    await page.getByTestId("customer-merge").click();
    const dialog = page.getByTestId("customer-merge-dialog");
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewports.phone360.width);
    await expect(dialog).toContainText(language === "tr" ? "Müşteri birleştir" : "Merge customers");
    await expect(page.getByTestId("merge-preview")).toContainText(language === "tr" ? "Siparişler" : "Orders");
    await expect(page.getByTestId("merge-submit")).toBeDisabled();
    await expect(page.getByTestId("merge-candidate")).toContainText("4");
    await dialog.getByRole("textbox").fill("Hedef");
    await expect.poll(() => searched).toBe(true);
    await page.getByTestId("merge-candidate").click();
    await expect(page.getByTestId("merge-submit")).toBeDisabled();
    await page.getByTestId("merge-confirm").check();
    await page.getByTestId("merge-submit").click();
    await expect(dialog.getByRole("alert")).toContainText("Please retry");
    await expect(dialog).toBeVisible();
    await page.getByTestId("merge-submit").click();
    await expect(page).toHaveURL(/\/musteriler\/cus_2$/);
    expect(mergeBody).toEqual({ source_public_id: "cus_1" });
    await expect(dialog).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
