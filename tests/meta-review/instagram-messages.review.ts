import { expect, test } from "@playwright/test";
import { applyEnglishState, combine, inboxRoutes, settingsRoutes } from "./fixtures";
import { startScenario } from "./recording";

const row = (page: import("@playwright/test").Page, id: string) => page.locator(`[data-testid="conversation-row"][data-id="${id}"]`);

test("instagram_business_manage_messages + Human Agent", async ({ page }, testInfo) => {
  const inbox = inboxRoutes();
  const s = await startScenario(page, testInfo, {
    permission: "instagram_business_manage_messages",
    title: "Answering Instagram direct messages, including after 24 hours with the Human Agent tag",
    extra: combine(inbox.route, settingsRoutes()),
  });
  applyEnglishState(s.state);
  await s.caption("Opening Messages and filtering by Instagram");
  await page.goto("/mesajlar");
  await expect(page.getByTestId("page-messages")).toBeVisible();
  await page.getByTestId("filter-unread").click();
  await expect(page.getByTestId("filter-unread")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("channel-filter").click();
  await page.getByTestId("channel-filter-instagram").click();
  await expect(row(page, "cnv_ig")).toBeVisible();
  await s.pause(2000);

  await s.caption("A customer sends a new Instagram DM; it arrives through the Instagram messaging webhook…");
  inbox.addIncoming("cnv_ig", "Hi, is the Incubator Model A still available?");
  await expect(row(page, "cnv_ig")).toContainText("still available", { timeout: 15_000 });
  await row(page, "cnv_ig").click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
  await s.pause(2000);

  await s.caption("The agent replies within the standard messaging window (instagram_business_manage_messages)");
  await page.getByTestId("message-input").fill("Hi Liam, yes it is in stock and ships within 2 days.");
  await page.getByTestId("message-send-button").click();
  await expect(page.getByTestId("thread-message").last()).toContainText("in stock");
  await s.pause(2500);

  await s.caption("This conversation's last customer message is older than 24 hours → the agent turns on Human Agent mode");
  const agent = page.getByTestId("human-agent-toggle");
  await expect(agent).toHaveAttribute("aria-checked", "false");
  await agent.click();
  await expect(agent).toHaveAttribute("aria-checked", "true");
  await s.pause(2500);
  await s.caption("Replies are now sent with the HUMAN_AGENT message tag (7-day window)");
  await page.getByTestId("message-input").fill("Following up on your question from last week: the incubator is back in stock.");
  await page.getByTestId("message-send-button").click();
  await expect(page.getByTestId("thread-message").last()).toContainText("back in stock");
  await s.pause(2500);
  await s.end();
});
