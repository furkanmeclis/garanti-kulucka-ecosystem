import { expect, test } from "@playwright/test";
import { commentRoutes } from "./fixtures";
import { startScenario } from "./recording";

test("pages_read_engagement + pages_read_user_content + pages_manage_engagement", async ({ page }, testInfo) => {
  const s = await startScenario(page, testInfo, {
    permission: "pages_manage_engagement",
    title: "Reading and moderating comments on the Facebook Page",
    extra: commentRoutes(),
  });
  await s.caption("Opening Comments and filtering by Facebook");
  await page.goto("/yorumlar");
  await expect(page.getByTestId("page-comments")).toBeVisible();
  await page.getByTestId("filter-platform").click();
  await page.getByTestId("filter-platform-facebook").click();
  await expect(page.getByTestId("comment-card")).toHaveCount(2);
  await s.caption("Page posts and visitor comments are read with pages_read_engagement and pages_read_user_content");
  await s.pause(3000);

  await s.caption("Replying to a product question (pages_manage_engagement)");
  await page.getByTestId("comment-card").first().getByTestId("comment-reply").click();
  const sheet = page.getByTestId("comment-reply-sheet");
  await sheet.getByTestId("comment-ai-suggest").click();
  await expect(sheet.getByTestId("comment-reply-message")).toHaveValue(/Hi George/);
  await s.pause(2000);
  await sheet.getByTestId("comment-reply-send").click();
  await expect(page.getByTestId("comments-feedback")).toHaveText("Reply sent");
  await s.pause(2000);

  await s.caption("Hiding an abusive comment from the Page");
  await page.getByTestId("comment-card").nth(1).getByTestId("comment-hide").click();
  await expect(page.getByTestId("comments-feedback")).toHaveText("Comment hidden");
  await s.pause(2500);
  await s.end();
});
