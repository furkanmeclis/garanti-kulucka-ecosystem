import { expect, test } from "@playwright/test";
import { settingsRoutes } from "./fixtures";
import { startScenario } from "./recording";

test("business_management", async ({ page }, testInfo) => {
  const s = await startScenario(page, testInfo, {
    permission: "business_management",
    title: "Listing the business portfolio assets connected to the panel",
    extra: settingsRoutes(),
  });
  await s.caption("Opening Settings → Integrations");
  await page.goto("/ayarlar?tab=integrations");
  await expect(page.getByTestId("settings-integration-cards")).toBeVisible();
  await s.caption("business_management lets the system user read the Page, Instagram account and WABA owned by the business portfolio");
  await expect(page.getByTestId("settings-integration-account-whatsapp")).toContainText(/active/i);
  await expect(page.getByTestId("settings-integration-account-instagram")).toContainText(/active/i);
  await expect(page.getByTestId("settings-integration-account-messenger")).toContainText(/active/i);
  await s.pause(3000);
  await s.caption("Each card shows the asset id taken from the portfolio: WABA phone, Instagram user and Facebook Page");
  await expect(page.getByTestId("settings-integration-cards")).toContainText("1128646770325911");
  await expect(page.getByTestId("settings-integration-cards")).toContainText("296265270245200");
  await s.pause(3000);
  await s.caption("Opening the WhatsApp card leads to the asset's own settings page");
  await page.getByTestId("settings-integration-open-whatsapp").click();
  await expect(page.getByTestId("settings-tab-panel-whatsapp")).toBeVisible();
  await s.pause(2500);
  await s.end();
});
