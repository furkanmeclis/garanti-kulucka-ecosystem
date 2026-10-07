import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { backendBaseUrl, expectResponsiveLayout, login, mockBackend, mockUser, viewports, type BackendState, type ExtraRoute } from "./helpers";

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

/** Legacy Mesajlar extras: older-message paging, server search + load more, mark all read, AI generate & send. */
async function openInboxExtras(page: Page, viewport: { width: number; height: number } = viewports.desktop) {
  await page.setViewportSize(viewport);
  const latest = [
    { public_id: "msg_l1", sender_type: "customer", sender_name: "Konuşma Müşterisi 1", body: "Son sayfa ilk mesaj", is_read: true, sent_at: "2026-10-07T09:00:00.000Z", attachments: [] },
    { public_id: "msg_l2", sender_type: "user", sender_name: "admin@example.com", body: "Son sayfa cevap", is_read: true, sent_at: "2026-10-07T09:01:00.000Z", attachments: [] },
  ];
  const older = [{ public_id: "msg_o1", sender_type: "customer", sender_name: "Konuşma Müşterisi 1", body: "En eski mesaj", is_read: true, sent_at: "2026-10-06T09:00:00.000Z", attachments: [] }];
  const extras = { suggestion: "Kargonuz bugün yola çıkıyor.", sent: [] as Array<Record<string, unknown>> };
  const route: ExtraRoute = ({ method, path, url, body }, backend) => {
    if (path === "/api/conversations/summary") {
      const unread = backend.conversations.filter((row) => row.unread_count > 0).length;
      return { status: 200, body: { total_count: backend.conversations.length, unread_count: unread, pool_count: 0, human_agent_count: 0, channel_counts: { instagram: 0, facebook: 0 }, status_counts: { open: 0, closed: 0 } } };
    }
    if (path === "/api/conversations/mark-all-read" && method === "POST") {
      const channel = (body as { channel?: string }).channel;
      const channels = channel ? (channel === "facebook" ? ["facebook", "messenger"] : [channel]) : null;
      let updated = 0;
      for (const row of backend.conversations) {
        if (row.unread_count > 0 && (!channels || channels.includes(row.channel))) {
          row.unread_count = 0;
          updated += 1;
        }
      }
      return { status: 200, body: { updated } };
    }
    if (path === "/api/conversations/cnv_1/messages" && method === "GET") {
      if (url.searchParams.get("before") === "msg_l1") return { status: 200, body: { data: older, has_more: false } };
      return { status: 200, body: { data: [...latest, ...extras.sent], has_more: true } };
    }
    if (path === "/api/conversations/cnv_1/messages" && method === "POST") {
      const input = body as { body: string | null };
      const message = { public_id: `msg_s${extras.sent.length + 1}`, sender_type: "user", sender_name: "admin@example.com", body: input.body, is_read: true, sent_at: "2026-10-07T09:05:00.000Z", attachments: [] };
      extras.sent.push(message);
      return { status: 201, body: message };
    }
    if (path === "/api/ai/reply-suggestion") return { status: 200, body: { suggestion: extras.suggestion, dry_run: true } };
    if (path === "/api/message-shortcuts" && method === "GET") return { status: 200, body: { data: [] } };
    return undefined;
  };
  const state = await mockBackend(page, mockUser("admin"), { extra: route });
  // 127 conversations: the first batch (100) is full, "load more" fetches the remaining 27 by offset.
  const base = state.conversations[0]!;
  for (let index = 28; index <= 127; index += 1) {
    state.conversations.push({ ...base, public_id: `cnv_${index}`, channel: index % 2 === 0 ? "instagram" : "facebook", unread_count: index % 3, customer: { full_name: `Konuşma Müşterisi ${index}`, phone: `0555000${String(index).padStart(4, "0")}` } });
  }
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("topbar")).toBeVisible();
  await page.goto("/mesajlar");
  await expect(page.getByTestId("page-messages")).toBeVisible();
  return { state, extras };
}

const conversationRequests = (state: BackendState) => state.requests.filter((request) => request.path === "/api/conversations").map((request) => request.search);

test("inbox: server search, load more conversations and mark all read", async ({ page }) => {
  const { state } = await openInboxExtras(page);
  await expect(page.getByTestId("pagination-summary")).toHaveText("1–20 / 100");
  expect(conversationRequests(state)).toContain("?limit=100");

  await page.getByTestId("messages-load-more").click();
  await expect(page.getByTestId("pagination-summary")).toHaveText("1–20 / 127");
  expect(conversationRequests(state)).toContain("?limit=100&offset=100");
  await expect(page.getByTestId("messages-load-more")).toHaveCount(0);

  await page.getByTestId("list-search").fill("Müşterisi 105");
  await expect.poll(() => conversationRequests(state)).toContain("?limit=100&search=M%C3%BC%C5%9Fterisi+105");
  await expect(page.getByTestId("messages-row")).toHaveCount(1);
  await expect(page.getByTestId("messages-row")).toContainText("Konuşma Müşterisi 105");
  expect(new URL(page.url()).searchParams.get("q")).toBe("Müşterisi 105");
  await expect(page.getByTestId("messages-load-more")).toHaveCount(0);
  await page.getByTestId("list-clear").click();
  await expect(page.getByTestId("pagination-summary")).toHaveText("1–20 / 100");

  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.accept();
  });
  await page.getByTestId("filter-channel").click();
  await page.getByTestId("filter-channel-instagram").click();
  await expect.poll(() => conversationRequests(state).at(-1)).toContain("channel=instagram");
  const instagramUnread = state.conversations.filter((row) => row.channel === "instagram" && row.unread_count > 0).length;
  await page.getByTestId("messages-mark-all-read").click();
  await expect(page.getByTestId("messages-feedback")).toHaveText(`${instagramUnread} konuşma okundu olarak işaretlendi`);
  expect(dialogs[0]).toBe(`${instagramUnread} okunmamış konuşma okundu olarak işaretlensin mi?`);
  expect(state.bodies.filter((entry) => entry.path === "/api/conversations/mark-all-read").map((entry) => entry.body)).toEqual([{ channel: "instagram" }]);

  await page.getByTestId("list-clear").click();
  const allUnread = state.conversations.filter((row) => row.unread_count > 0).length;
  await expect(page.getByTestId("messages-mark-all-read")).toBeEnabled();
  await page.getByTestId("messages-mark-all-read").click();
  await expect(page.getByTestId("messages-feedback")).toHaveText(`${allUnread} konuşma okundu olarak işaretlendi`);
  expect(dialogs[1]).toContain(`${allUnread} okunmamış konuşma`);
  expect(state.bodies.filter((entry) => entry.path === "/api/conversations/mark-all-read").map((entry) => entry.body)).toEqual([{ channel: "instagram" }, {}]);
  await expect(page.getByTestId("messages-mark-all-read")).toBeDisabled();
});

test("inbox: load older messages and AI generate-and-send", async ({ page }) => {
  const { state, extras } = await openInboxExtras(page);
  await page.getByTestId("messages-table").getByTestId("conversation-open").filter({ hasText: /^Konuşma Müşterisi 1$/ }).click();
  const sheet = page.getByTestId("conversation-sheet");
  await expect(sheet.getByTestId("thread-message")).toHaveCount(2);
  const threadRequests = () => state.requests.filter((request) => request.path === "/api/conversations/cnv_1/messages" && request.method === "GET").map((request) => request.search);
  expect(threadRequests()).toEqual(["?limit=50"]);
  await sheet.getByTestId("conversation-load-older").click();
  await expect(sheet.getByTestId("thread-message")).toHaveCount(3);
  await expect(sheet.getByTestId("thread-message").first()).toContainText("En eski mesaj");
  expect(threadRequests()).toEqual(["?limit=50", "?limit=50&before=msg_l1"]);
  await expect(sheet.getByTestId("conversation-load-older")).toHaveCount(0);

  await sheet.getByTestId("composer-ai-send").click();
  await expect(sheet.getByTestId("conversation-feedback")).toHaveText("AI yanıtı üretildi ve gönderildi");
  await expect(sheet.getByTestId("thread-message")).toHaveCount(4);
  await expect(sheet.getByTestId("thread-message").last()).toContainText("Kargonuz bugün yola çıkıyor.");
  const posts = () => state.bodies.filter((entry) => entry.method === "POST" && entry.path === "/api/conversations/cnv_1/messages").map((entry) => entry.body);
  expect(posts()).toEqual([expect.objectContaining({ sender_type: "user", body: "Kargonuz bugün yola çıkıyor.", attachments: [] })]);
  expect(state.bodies.filter((entry) => entry.path === "/api/ai/reply-suggestion").map((entry) => entry.body)).toEqual([{ conversation_public_id: "cnv_1" }]);

  extras.suggestion = "  ";
  await sheet.getByTestId("composer-ai-send").click();
  await expect(sheet.getByTestId("conversation-feedback")).toHaveText("AI yanıt üretemedi; mesaj gönderilmedi");
  expect(posts()).toHaveLength(1);

  // The draft suggestion flow stays available.
  extras.suggestion = "Taslak öneri";
  await sheet.getByTestId("composer-ai").click();
  await expect(sheet.getByTestId("conversation-ai-suggestion")).toContainText("Taslak öneri");
  expect(posts()).toHaveLength(1);
});

test("inbox: the extras fit a phone", async ({ page }) => {
  await openInboxExtras(page, viewports.phone360);
  await expect(page.getByTestId("messages-load-more")).toBeVisible();
  await expect(page.getByTestId("messages-mark-all-read")).toBeVisible();
  await expectResponsiveLayout(page, { checkTouchTargets: true });
  await page.getByTestId("messages-cards").getByTestId("conversation-open").filter({ hasText: /^Konuşma Müşterisi 1$/ }).click();
  await expect(page.getByTestId("conversation-load-older")).toBeVisible();
  await expect(page.getByTestId("composer-ai-send")).toBeVisible();
  await expectResponsiveLayout(page, { checkTouchTargets: true });
});
