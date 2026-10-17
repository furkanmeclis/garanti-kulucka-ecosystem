import { expect, test } from "@playwright/test";
import { publishRoutes } from "./fixtures";
import { startScenario } from "./recording";

test("instagram_business_content_publish", async ({ page }, testInfo) => {
  const s = await startScenario(page, testInfo, {
    permission: "instagram_business_content_publish",
    title: "Publishing a product photo to Instagram from the panel",
    extra: publishRoutes(),
  });
  await s.caption("Opening Instagram → Publish");
  await page.goto("/instagram/yayinla");
  await expect(page.getByTestId("page-instagram-publish")).toBeVisible();
  await s.caption("Entering the product image and caption");
  await page.getByTestId("instagram-image-url").fill("https://cdn.example.com/incubator-model-a.jpg");
  await page.getByTestId("instagram-caption").fill("New arrival: Incubator Model A");
  await s.pause(2000);
  await s.caption("Publishing uses instagram_business_content_publish (container → publish)");
  await page.getByTestId("instagram-publish").click();
  await expect(page.getByTestId("instagram-publish-feedback")).toHaveText("Publish request queued");
  await expect(page.getByTestId("instagram-publish-feedback")).toHaveText("Instagram post published!", { timeout: 20_000 });
  await s.caption("The post is live; the Instagram media id is shown for reference");
  await expect(page.getByTestId("instagram-publish-result")).toContainText("17895695668004550");
  await s.pause(2500);
  await s.end();
});
