import { expect, test } from "@playwright/test";
import { settingsRoutes } from "./fixtures";
import { startScenario } from "./recording";

test("whatsapp_business_management", async ({ page }, testInfo) => {
  const s = await startScenario(page, testInfo, {
    permission: "whatsapp_business_management",
    title: "Managing the WhatsApp Business Account from Settings",
    extra: settingsRoutes(),
  });
  await s.caption("Opening Settings → WhatsApp");
  await page.goto("/ayarlar?tab=whatsapp");
  await expect(page.getByTestId("settings-tab-panel-whatsapp")).toBeVisible();
  await s.caption("The WABA, phone number id and display number are read with whatsapp_business_management");
  await expect(page.getByTestId("whatsapp-phone-number-id")).toHaveValue("1128646770325911");
  await expect(page.getByTestId("whatsapp-waba-id")).toHaveValue("1931036684950470");
  await s.pause(3000);
  await s.caption("The webhook callback URL registered on the WABA for incoming messages and statuses");
  await expect(page.getByTestId("whatsapp-callback")).toContainText("/webhooks/whatsapp");
  await s.pause(2500);
  await s.caption("Updating the business display number and saving the account settings");
  await page.getByTestId("whatsapp-display-phone").fill("+90 322 911 03 70");
  await page.getByTestId("whatsapp-save").click();
  await expect(page.getByTestId("whatsapp-feedback")).toHaveText("Settings saved.");
  await s.pause(2500);
  await s.end();
});
