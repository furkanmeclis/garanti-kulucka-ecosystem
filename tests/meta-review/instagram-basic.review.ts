import { expect, test } from "@playwright/test";
import { settingsRoutes } from "./fixtures";
import { startScenario } from "./recording";

test("instagram_business_basic", async ({ page }, testInfo) => {
  const s = await startScenario(page, testInfo, {
    permission: "instagram_business_basic",
    title: "Connecting the Instagram professional account to the panel",
    extra: settingsRoutes(),
  });
  await s.caption("Opening Settings → Instagram");
  await page.goto("/ayarlar?tab=instagram");
  await expect(page.getByTestId("settings-tab-panel-instagram")).toBeVisible();
  await s.caption("The connected account profile is read with instagram_business_basic: @garantikulucka");
  await expect(page.getByTestId("instagram-status")).toContainText("Instagram connected");
  await s.pause(2500);
  await s.caption("The Instagram user id and login type come from the Instagram API with Instagram Login");
  await expect(page.getByTestId("instagram-page-id")).toHaveValue("17841400000000000");
  await s.pause(2500);
  await s.caption("Saving the account keeps the panel linked to this Instagram profile");
  await page.getByTestId("instagram-save").click();
  await expect(page.getByTestId("instagram-feedback")).toHaveText("Settings saved.");
  await s.pause(2000);
  await s.end();
});
