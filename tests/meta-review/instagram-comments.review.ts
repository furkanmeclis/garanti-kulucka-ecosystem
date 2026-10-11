import { expect, test } from "@playwright/test";
import { commentRoutes } from "./fixtures";
import { startScenario } from "./recording";

test("instagram_business_manage_comments", async ({ page }, testInfo) => {
  const s = await startScenario(page, testInfo, {
    permission: "instagram_business_manage_comments",
    title: "Moderating Instagram comments from the Comments tab",
    extra: commentRoutes(),
  });
  await s.caption("Opening the Comments page and filtering by Instagram");
  await page.goto("/yorumlar");
  await expect(page.getByTestId("page-comments")).toBeVisible();
  await page.getByTestId("filter-platform").click();
  await page.getByTestId("filter-platform-instagram").click();
  await expect(page.getByTestId("comment-card")).toHaveCount(3);
  await s.caption("Comments on our posts are read with instagram_business_manage_comments");
  await s.pause(2500);

  await s.caption("Replying to a customer's price question");
  await page.getByTestId("comment-card").first().getByTestId("comment-reply").click();
  const sheet = page.getByTestId("comment-reply-sheet");
  await sheet.getByTestId("comment-ai-suggest").click();
  await expect(sheet.getByTestId("comment-reply-message")).toHaveValue(/Hi Hannah/);
  await s.pause(2000);
  await sheet.getByTestId("comment-reply-send").click();
  await expect(page.getByTestId("comments-feedback")).toHaveText("Reply sent");
  await s.pause(2000);

  await s.caption("Hiding a spam comment so customers no longer see it");
  await page.getByTestId("comment-card").nth(1).getByTestId("comment-hide").click();
  await expect(page.getByTestId("comments-feedback")).toHaveText("Comment hidden");
  await s.pause(2000);

  await s.caption("Deleting an abusive comment permanently");
  await page.getByTestId("comment-card").nth(2).getByTestId("comment-delete").click();
  const confirm = page.getByTestId("confirm-dialog-action");
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page.getByTestId("comments-feedback")).toContainText(/deleted/i);
  await s.pause(2000);
  await s.end();
});
