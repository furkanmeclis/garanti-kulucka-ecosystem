import { expect, test } from "@playwright/test";
import { applyEnglishState, combine, inboxRoutes, settingsRoutes } from "./fixtures";
import { startScenario } from "./recording";

const row = (page: import("@playwright/test").Page, id: string) => page.locator(`[data-testid="conversation-row"][data-id="${id}"]`);

test("pages_messaging + pages_show_list + pages_manage_metadata + Human Agent", async ({ page }, testInfo) => {
  const inbox = inboxRoutes();
  const s = await startScenario(page, testInfo, {
    permission: "pages_messaging",
    title: "Connecting the Facebook Page and answering Messenger conversations",
    extra: combine(inbox.route, settingsRoutes()),
  });
  applyEnglishState(s.state);
  await s.caption("Settings → Messenger: the Page is chosen from the Pages the user manages (pages_show_list)");
  await page.goto("/ayarlar?tab=messenger");
  await expect(page.getByTestId("settings-tab-panel-messenger")).toBeVisible();
  await expect(page.getByTestId("messenger-page-id")).toHaveValue("296265270245200");
  await s.pause(2500);
  await s.caption("The webhook callback for the Page is registered via pages_manage_metadata (subscribed_apps)");
  await expect(page.getByTestId("messenger-callback")).toContainText("/webhooks/messenger");
  const subscribe = page.getByTestId("messenger-webhook-subscribe");
  if (await subscribe.isVisible().catch(() => false)) {
    await subscribe.click();
    await expect(page.getByTestId("messenger-action-feedback")).toContainText("Job queued");
  }
  await s.pause(2500);

  await s.caption("Messages: a customer writes to the Page on Messenger…");
  await page.goto("/mesajlar");
  await page.getByTestId("channel-filter").click();
  await page.getByTestId("channel-filter-messenger").click();
  inbox.addIncoming("cnv_fb", "Hello! Do you deliver to Edinburgh?");
  await expect(row(page, "cnv_fb")).toContainText("Edinburgh", { timeout: 15_000 });
  await row(page, "cnv_fb").click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
  await s.pause(2000);
  await s.caption("The agent replies through the Messenger Send API (pages_messaging)");
  await page.getByTestId("message-input").fill("Hi Olivia, yes we deliver to Edinburgh within 3 working days.");
  await page.getByTestId("message-send-button").click();
  await expect(page.getByTestId("thread-message").last()).toContainText("Edinburgh");
  await s.pause(2500);
  await s.caption("Human Agent mode lets the agent follow up for 7 days after the customer's last message");
  const agent = page.getByTestId("human-agent-toggle");
  await agent.click();
  await expect(agent).toHaveAttribute("aria-checked", "true");
  await s.pause(2500);
  await s.end();
});
