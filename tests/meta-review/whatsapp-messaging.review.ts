import { expect, test } from "@playwright/test";
import { applyEnglishState, combine, inboxRoutes, settingsRoutes } from "./fixtures";
import { startScenario } from "./recording";

const row = (page: import("@playwright/test").Page, id: string) => page.locator(`[data-testid="conversation-row"][data-id="${id}"]`);

test("whatsapp_business_messaging", async ({ page }, testInfo) => {
  const inbox = inboxRoutes();
  const s = await startScenario(page, testInfo, {
    permission: "whatsapp_business_messaging",
    title: "Answering WhatsApp customers from the shared inbox",
    extra: combine(inbox.route, settingsRoutes()),
    anonymous: (path) => path.startsWith("/presigned/"),
  });
  applyEnglishState(s.state);
  await s.caption("Opening Messages and filtering the inbox by WhatsApp");
  await page.goto("/mesajlar");
  await expect(page.getByTestId("page-messages")).toBeVisible();
  await page.getByTestId("channel-filter").click();
  await page.getByTestId("channel-filter-whatsapp").click();
  await expect(row(page, "cnv_wa")).toBeVisible();
  await s.pause(2000);

  await s.caption("A customer sends a new WhatsApp message; the inbox receives it via the WhatsApp webhook…");
  inbox.addIncoming("cnv_wa", "Can you send me the invoice and the tracking link?");
  await expect(row(page, "cnv_wa")).toContainText("Can you send me the invoice", { timeout: 15_000 });
  await s.pause(1500);

  await s.caption("Opening the conversation; the customer's messages are shown in the thread");
  await row(page, "cnv_wa").click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
  await expect(page.getByTestId("thread-message").last()).toContainText("invoice");
  await s.pause(2000);

  await s.caption("The agent replies with text (whatsapp_business_messaging → POST /messages)");
  await page.getByTestId("message-input").fill("Hi Emma, your order GK-1042 is on its way. Tracking number: TRK900042");
  await page.getByTestId("message-send-button").click();
  await expect(page.getByTestId("thread-message").last()).toContainText("TRK900042");
  await s.pause(2000);

  await s.caption("Sending the product photo as a media message");
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("composer-attach-image").click();
  await (await chooser).setFiles({ name: "incubator-model-a.png", mimeType: "image/png", buffer: Buffer.from("png!") });
  await expect(page.getByTestId("media-preview")).toContainText("incubator-model-a.png");
  await page.getByTestId("message-send-button").click();
  await expect(page.getByTestId("media-preview")).toHaveCount(0);
  await s.pause(2000);

  await s.caption("Quick replies send the standard shipping notification");
  await page.getByTestId("composer-quick-replies").click();
  await page.getByTestId("quick-replies").getByTestId("shortcut-shipping").click();
  await expect(page.getByTestId("message-input")).toHaveValue(/Your parcel is on its way/);
  await page.getByTestId("message-send-button").click();
  await s.pause(2500);
  await s.end();
});
