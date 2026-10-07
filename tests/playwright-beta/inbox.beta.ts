import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { backendBaseUrl, expectResponsiveLayout, login, mockBackend, mockUser, viewports, type ExtraRoute } from "./helpers";

test.use({ serviceWorkers: "block" });

const now = "2026-10-07T09:00:00.000Z";

function routes() {
  const messages = [
    { public_id: "msg_1", sender_type: "customer", sender_name: "Konuşma Müşterisi 1", body: "Kargom nerede?", is_read: true, sent_at: now, attachments: [] },
    { public_id: "msg_2", sender_type: "ai", sender_name: null, body: "Takip numaranız TRK1", is_read: true, sent_at: now, attachments: [{ file_public_id: "fil_doc", attachment_type: "document", original_name: "fatura.pdf", mime_type: "application/pdf", byte_size: 10 }] },
  ];
  let shortcuts = [{ public_id: "msc_1", code: "kargo", message: "Kargonuz yola çıktı.", type: "custom", is_active: true, sort_order: 0, attachments: [], updated_at: now }];
  const state: Record<string, unknown> = {};
  const route: ExtraRoute = ({ method, path, body }) => {
    if (path === "/api/conversations/cnv_1/messages" && method === "GET") return { status: 200, body: { data: messages } };
    if (path === "/api/conversations/cnv_1/messages" && method === "POST") {
      const input = body as { body: string | null; attachments: Array<{ file_public_id: string; attachment_type: string }> };
      const message = { public_id: `msg_${messages.length + 1}`, sender_type: "user", sender_name: "admin@example.com", body: input.body, is_read: true, sent_at: now, attachments: input.attachments.map((item) => ({ ...item, original_name: "foto.png", mime_type: "image/png", byte_size: 4 })) };
      messages.push(message);
      return { status: 201, body: message };
    }
    if (path === "/api/conversations/cnv_1/state") {
      Object.assign(state, body as object);
      const input = body as { human_agent_enabled?: boolean; assign_to_me?: boolean; is_in_pool?: boolean; unread_count?: number; status?: string };
      return {
        status: 200,
        body: {
          public_id: "cnv_1", channel: "facebook", status: input.status ?? "open", is_in_pool: input.is_in_pool ?? false, human_agent_enabled: input.human_agent_enabled ?? true, unread_count: input.unread_count ?? 1,
          customer: { full_name: "Konuşma Müşterisi 1", phone: "05550000001" }, assigned_user_email: "admin@example.com", updated_at: now,
        },
      };
    }
    if (path === "/api/conversations/cnv_1/notes") return { status: 200, body: { public_id: "cnv_1", notes: (body as { notes: string }).notes } };
    if (path === "/api/conversations/cnv_1/customer-notes") return { status: 200, body: { public_id: "cus_1", notes: (body as { notes: string }).notes } };
    if (path === "/api/ai/reply-suggestion") return { status: 200, body: { suggestion: "Siparişiniz bugün kargoya verildi.", dry_run: true } };
    if (path === "/api/message-shortcuts" && method === "GET") return { status: 200, body: { data: shortcuts } };
    if (path === "/api/message-shortcuts" && method === "POST") {
      const input = body as { code: string; message: string | null };
      const created = { public_id: "msc_2", code: input.code, message: input.message, type: "custom", is_active: true, sort_order: 1, attachments: [], updated_at: now };
      shortcuts = [...shortcuts, created];
      return { status: 201, body: created };
    }
    if (path === "/api/message-shortcuts/msc_1" && method === "DELETE") {
      shortcuts = shortcuts.filter((item) => item.public_id !== "msc_1");
      return { status: 200, body: {} };
    }
    if (path === "/api/files/uploads") return { status: 201, body: { file: { public_id: "fil_up", original_name: "foto.png", mime_type: "image/png", byte_size: 4 }, upload: { method: "PUT", headers: {}, presigned_url: `${backendBaseUrl}/presigned/foto.png` } } };
    if (path === "/presigned/foto.png") return { status: 200, body: {} };
    if (path === "/api/files/fil_doc/download") return { status: 200, body: { download: { presigned_url: null } } };
    if (path === "/api/orders/product-options") return { status: 200, body: { data: [] } };
    if (path === "/api/orders/customer-lookup") return { status: 200, body: { customer: null, default_address: null } };
    if (path === "/api/orders" && method === "POST") return { status: 201, body: { public_id: "ord_c", order_number: "GK-3001", status: "draft", source: "conversation", total_amount: "100.00", currency: "TRY" } };
    return undefined;
  };
  return { route, state };
}

async function openInbox(page: Page, viewport: { width: number; height: number } = viewports.desktop) {
  await page.setViewportSize(viewport);
  const { route, state: conversationState } = routes();
  const state = await mockBackend(page, mockUser("admin"), { extra: route, anonymous: (path) => path.startsWith("/presigned/") });
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("topbar")).toBeVisible();
  await page.goto("/mesajlar");
  await expect(page.getByTestId("page-messages")).toBeVisible();
  return { state, conversationState };
}

test("inbox: thread, send with attachment and shortcut, AI suggestion, toggles and notes", async ({ page }) => {
  const { state, conversationState } = await openInbox(page);
  await page.getByTestId("messages-table").getByTestId("conversation-open").filter({ hasText: /^Konuşma Müşterisi 1$/ }).click();
  const sheet = page.getByTestId("conversation-sheet");
  await expect(sheet.getByTestId("thread-message")).toHaveCount(2);
  await expect(sheet.getByTestId("message-attachment")).toHaveText("fatura.pdf");

  await sheet.getByTestId("composer-shortcuts").click();
  await page.getByTestId("shortcut-kargo").click();
  await expect(sheet.getByTestId("composer-input")).toHaveValue("Kargonuz yola çıktı.");
  await sheet.getByTestId("composer-file").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: Buffer.from("png!") });
  await expect(sheet.getByTestId("composer-attachments")).toContainText("foto.png");
  await sheet.getByTestId("composer-send").click();
  await expect(sheet.getByTestId("thread-message")).toHaveCount(3);
  const sent = state.bodies.find((entry) => entry.method === "POST" && entry.path === "/api/conversations/cnv_1/messages")?.body;
  expect(sent).toMatchObject({ sender_type: "user", body: "Kargonuz yola çıktı.", attachments: [{ file_public_id: "fil_up", attachment_type: "image" }] });
  const upload = state.bodies.find((entry) => entry.path === "/api/files/uploads")?.body as { checksum: string; byte_size: number };
  expect(upload).toMatchObject({ original_name: "foto.png", mime_type: "image/png", byte_size: 4 });
  expect(upload.checksum).toMatch(/^[A-Za-z0-9+/]+=*$/);
  expect(state.bodies.some((entry) => entry.method === "PUT" && entry.path === "/presigned/foto.png")).toBe(true);

  await sheet.getByTestId("composer-ai").click();
  await expect(sheet.getByTestId("conversation-ai-suggestion")).toContainText("Kuru çalıştırma");
  await sheet.getByTestId("conversation-ai-use").click();
  await expect(sheet.getByTestId("composer-input")).toHaveValue("Siparişiniz bugün kargoya verildi.");

  await sheet.getByTestId("conversation-agent").click();
  await expect(sheet.getByTestId("conversation-agent-badge")).toHaveText("AI yanıtlıyor");
  await sheet.getByTestId("conversation-read").click();
  await sheet.getByTestId("conversation-release").click();
  await expect(sheet.getByTestId("conversation-take")).toBeVisible();
  expect(conversationState).toMatchObject({ is_in_pool: true });

  await sheet.getByTestId("conversation-notes").locator("summary").click();
  await sheet.getByTestId("conversation-note").fill("İade isteyebilir");
  await expect(sheet.getByTestId("conversation-feedback")).toHaveText("Not kaydedildi");
  expect(state.bodies.find((entry) => entry.path === "/api/conversations/cnv_1/notes")?.body).toEqual({ notes: "İade isteyebilir" });
});

test("inbox: create an order from the conversation", async ({ page }) => {
  const { state } = await openInbox(page);
  await page.getByTestId("messages-table").getByTestId("conversation-open").filter({ hasText: /^Konuşma Müşterisi 1$/ }).click();
  await page.getByTestId("conversation-create-order").click();
  const form = page.getByTestId("order-form");
  await expect(form.getByTestId("order-form-name")).toHaveValue("Konuşma Müşterisi 1");
  await expect(form.getByTestId("order-form-phone")).toHaveValue("05550000001");
  await form.getByTestId("order-form-city").fill("Adana");
  await form.getByTestId("order-form-district").fill("Seyhan");
  await form.getByTestId("order-form-address").fill("Atatürk Cd. 1");
  await form.getByTestId("order-form-cargo-ptt").click();
  await form.getByTestId("order-form-item-name").fill("Kuluçka Makinesi");
  await form.getByTestId("order-form-price").fill("100");
  await form.getByTestId("order-form-submit").click();
  await expect(page.getByTestId("conversation-feedback")).toHaveText("Sipariş oluşturuldu! (GK-3001)");
  expect(state.bodies.find((entry) => entry.method === "POST" && entry.path === "/api/orders")?.body).toMatchObject({ source: "conversation", conversation_public_id: "cnv_1", notes: "Konuşmadan oluşturuldu" });
});

test("inbox: manage shortcuts and export them as JSON", async ({ page }) => {
  const { state } = await openInbox(page);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("shortcuts-manage").click();
  const sheet = page.getByTestId("shortcuts-sheet");
  await expect(sheet.getByTestId("shortcut-row-kargo")).toContainText("Kargonuz yola çıktı.");
  await sheet.getByTestId("shortcut-save").click();
  await expect(sheet.getByTestId("shortcuts-feedback")).toHaveText("Kod ve mesaj (veya dosya) gerekli");
  await sheet.getByTestId("shortcut-code").fill("/iban");
  await sheet.getByTestId("shortcut-message").fill("IBAN: TR00 0000");
  await sheet.getByTestId("shortcut-save").click();
  await expect(sheet.getByTestId("shortcut-row-iban")).toBeVisible();
  expect(state.bodies.find((entry) => entry.method === "POST" && entry.path === "/api/message-shortcuts")?.body).toMatchObject({ code: "iban", message: "IBAN: TR00 0000", type: "custom" });
  await sheet.getByTestId("shortcut-row-kargo").getByTestId("shortcut-delete").click();
  await expect(sheet.getByTestId("shortcut-row-kargo")).toHaveCount(0);
  const [download] = await Promise.all([page.waitForEvent("download"), sheet.getByTestId("shortcuts-export").click()]);
  const exported = JSON.parse(await readFile((await download.path())!, "utf8")) as Array<{ code: string }>;
  expect(exported.map((item) => item.code)).toEqual(["iban"]);
});

test("inbox: the conversation pane fits a phone", async ({ page }) => {
  await openInbox(page, viewports.phone390);
  await page.getByTestId("messages-cards").getByTestId("conversation-open").filter({ hasText: /^Konuşma Müşterisi 1$/ }).click();
  await expect(page.getByTestId("conversation-sheet").getByTestId("thread-message")).toHaveCount(2);
  await expectResponsiveLayout(page, { checkTouchTargets: true });
});
