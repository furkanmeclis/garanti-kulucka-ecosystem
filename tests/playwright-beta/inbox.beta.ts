import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { backendBaseUrl, expectResponsiveLayout, login, mockBackend, mockUser, viewports, type BackendState, type ExtraRoute, type MockUser } from "./helpers";

test.use({ serviceWorkers: "block" });

const now = "2026-10-07T09:00:00.000Z";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept", "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS" };

const products = [
  { public_id: "prd_1", name: "El Yapımı Kuluçka Makinesi", unit_price: "3500.00", stock_quantity: 12, external_product_id: null },
  { public_id: "prd_2", name: "Yedek Motor", unit_price: "250.00", stock_quantity: 4, external_product_id: null },
];

interface InboxOptions {
  orderResponses?: Array<{ status: number; body: unknown }>;
  olderPage?: boolean;
}

/** Mocked Mesajlar backend: thread for cnv_1 (others empty), shortcuts, AI, presence, settings, products, order create. */
function routes(options: InboxOptions = {}) {
  const messages: Array<Record<string, unknown>> = [
    { public_id: "msg_1", sender_type: "customer", sender_name: "Konuşma Müşterisi 1", body: "Kargom nerede?", is_read: true, sent_at: now, attachments: [] },
    { public_id: "msg_2", sender_type: "ai", sender_name: null, body: "Takip numaranız TRK1", is_read: true, sent_at: now, attachments: [{ file_public_id: "fil_doc", attachment_type: "document", original_name: "fatura.pdf", mime_type: "application/pdf", byte_size: 10 }] },
  ];
  const older = [{ public_id: "msg_0", sender_type: "customer", sender_name: "Konuşma Müşterisi 1", body: "En eski mesaj", is_read: true, sent_at: "2026-10-06T09:00:00.000Z", attachments: [] }];
  let shortcuts = [
    { public_id: "msc_1", code: "kargo", message: "Kargonuz yola çıktı.", type: "custom", is_active: true, sort_order: 0, attachments: [], updated_at: now },
    { public_id: "msc_2", code: "2", message: "Siparişiniz alındı, toplam {{fiyat}}. Yardımcı olabileceğim başka bir şey var mı?", type: "default", is_active: true, sort_order: 1, attachments: [], updated_at: now },
  ];
  const extras = { suggestion: "Siparişiniz bugün kargoya verildi.", dryRun: false, orderResponses: [...(options.orderResponses ?? [])], aiEnabled: true, offline: new Set<string>(), answered: false };
  const route: ExtraRoute = ({ method, path, url, body }, backend) => {
    if (path === "/api/conversations/cnv_1/messages" && method === "GET") {
      if (url.searchParams.get("before")) return { status: 200, body: { data: older, has_more: false } };
      return { status: 200, body: { data: messages, has_more: Boolean(options.olderPage) } };
    }
    if (/^\/api\/conversations\/cnv_\d+\/messages$/.test(path) && method === "GET") return { status: 200, body: { data: [], has_more: false } };
    if (/^\/api\/conversations\/cnv_\d+\/messages$/.test(path) && method === "POST") {
      const input = body as { body: string | null; sender_name: string; attachments: Array<{ file_public_id: string; attachment_type: string }> };
      const message = {
        public_id: `msg_s${messages.length + 1}`,
        sender_type: "user",
        sender_name: input.sender_name,
        body: input.body,
        is_read: false,
        sent_at: now,
        attachments: input.attachments.map((item) => ({ ...item, original_name: "foto.png", mime_type: "image/png", byte_size: 4 })),
      };
      if (path === "/api/conversations/cnv_1/messages") messages.push(message);
      return { status: 201, body: message };
    }
    const stateMatch = /^\/api\/conversations\/(cnv_\d+)\/state$/.exec(path);
    if (stateMatch) {
      const row = backend.conversations.find((item) => item.public_id === stateMatch[1])!;
      const input = body as { human_agent_enabled?: boolean; assign_to_me?: boolean; is_in_pool?: boolean; unread_count?: number; status?: string };
      if (input.human_agent_enabled !== undefined) row.human_agent_enabled = input.human_agent_enabled;
      if (input.is_in_pool !== undefined) row.is_in_pool = input.is_in_pool;
      if (input.unread_count !== undefined) row.unread_count = input.unread_count;
      if (input.status !== undefined) row.status = input.status;
      return { status: 200, body: { ...row, notes: null } };
    }
    if (path === "/api/conversations/mark-all-read" && method === "POST") {
      const channel = (body as { channel?: string }).channel;
      const channels = channel ? (channel === "facebook" ? ["facebook", "messenger"] : [channel]) : null;
      let updated = 0;
      for (const item of backend.conversations) {
        if (item.unread_count > 0 && (!channels || channels.includes(item.channel))) {
          item.unread_count = 0;
          updated += 1;
        }
      }
      return { status: 200, body: { updated } };
    }
    if (path === "/api/conversations/cnv_1/notes") return { status: 200, body: { ...backend.conversations[0], notes: (body as { notes: string }).notes } };
    if (path === "/api/conversations/cnv_1/customer-notes") return { status: 200, body: { public_id: "cus_1", notes: (body as { notes: string }).notes } };
    if (path === "/api/conversations/cnv_1/ai-reply" && method === "POST") {
      if (extras.answered) return { status: 409, body: { error: { code: "already_answered", message: "Son mesaj zaten yanıtlanmış" } } };
      if (extras.dryRun) return { status: 409, body: { error: { code: "ai_live_disabled", message: "Canlı AI kapalı", suggestion: extras.suggestion, dry_run: true } } };
      if (!extras.suggestion.trim()) return { status: 422, body: { error: { code: "ai_empty", message: "AI boş yanıt üretti" } } };
      const message = { public_id: `msg_ai${messages.length + 1}`, sender_type: "ai", sender_name: null, body: extras.suggestion.trim(), is_read: true, sent_at: now, attachments: [] };
      messages.push(message);
      extras.answered = true;
      return { status: 201, body: { ...message, delivery: { provider: "messenger", queued: true } } };
    }
    if (path === "/api/ai/reply-suggestion") return { status: 200, body: { suggestion: extras.suggestion, dry_run: extras.dryRun } };
    if (path === "/api/app-settings/ai-status") return { status: 200, body: { ai_enabled: extras.aiEnabled } };
    if (path === "/admin/settings/ai.auto_reply_enabled" && method === "PUT") {
      extras.aiEnabled = (body as { value: boolean }).value;
      return { status: 200, body: { key: "ai.auto_reply_enabled", value: extras.aiEnabled } };
    }
    const presenceMatch = /^\/admin\/users\/(usr_\w+)\/presence$/.exec(path);
    if (presenceMatch && method === "PATCH") {
      extras.offline.add(presenceMatch[1]!);
      return { status: 200, body: { user: { public_id: presenceMatch[1], is_online: false } } };
    }
    if (path === "/admin/users") {
      return {
        status: 200,
        body: {
          data: [
            { public_id: "usr_a", email: "a@example.com", first_name: "Elif", last_name: "Kaya", phone: null, role: "calisan", is_active: true, is_online: !extras.offline.has("usr_a"), last_seen_at: now, sip_username: null, sip_password_configured: false, created_at: now },
            { public_id: "usr_b", email: "b@example.com", first_name: "Can", last_name: "Er", phone: null, role: "calisan", is_active: true, is_online: false, last_seen_at: now, sip_username: null, sip_password_configured: false, created_at: now },
          ],
          roles: [],
        },
      };
    }
    if (path === "/api/message-shortcuts" && method === "GET") return { status: 200, body: { data: shortcuts } };
    if (path === "/api/message-shortcuts" && method === "POST") {
      const input = body as { code: string; message: string | null };
      const created = { public_id: "msc_3", code: input.code, message: input.message, type: "custom", is_active: true, sort_order: 2, attachments: [], updated_at: now };
      shortcuts = [...shortcuts, created];
      return { status: 201, body: created };
    }
    if (path === "/api/message-shortcuts/msc_1" && method === "DELETE") {
      shortcuts = shortcuts.filter((item) => item.public_id !== "msc_1");
      return { status: 200, body: {} };
    }
    if (path === "/api/files/uploads") return { status: 201, body: { file: { public_id: "fil_up", original_name: "foto.png", mime_type: "image/png", byte_size: 4 }, upload: { method: "PUT", headers: {}, presigned_url: `${backendBaseUrl}/presigned/foto.png` } } };
    if (path === "/presigned/foto.png") return { status: 200, body: {} };
    if (path.startsWith("/api/files/") && path.endsWith("/download")) return { status: 200, body: { download: { presigned_url: null } } };
    if (path === "/api/orders/product-options") return { status: 200, body: { data: products } };
    if (path === "/api/orders/customer-lookup") return { status: 200, body: { customer: null, default_address: null } };
    if (path === "/api/orders" && method === "POST") {
      return extras.orderResponses.shift() ?? { status: 201, body: { public_id: "ord_c", order_number: "GK-3001", status: "draft", source: "conversation", total_amount: "3500.00", currency: "TRY" } };
    }
    return undefined;
  };
  return { route, extras };
}

async function openInbox(page: Page, options: InboxOptions & { viewport?: { width: number; height: number }; user?: MockUser; path?: string } = {}) {
  await page.setViewportSize(options.viewport ?? viewports.desktop);
  const { route, extras } = routes(options);
  const state = await mockBackend(page, options.user ?? mockUser("admin"), { extra: route, anonymous: (path) => path.startsWith("/presigned/") });
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("topbar")).toBeVisible();
  await page.goto(options.path ?? "/mesajlar");
  await expect(page.getByTestId("page-messages")).toBeVisible();
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
  return { state, extras };
}

const row = (page: Page, id: string) => page.locator(`[data-testid="conversation-row"][data-id="${id}"]`);
const toast = (page: Page, text: string | RegExp) => page.getByTestId("chat-toast").filter({ hasText: text });
const posts = (state: BackendState, path: string) => state.bodies.filter((entry) => entry.method === "POST" && entry.path === path).map((entry) => entry.body);

async function openConversation(page: Page, id: string) {
  await row(page, id).click();
  await expect(page.getByTestId("chat-panel")).toBeVisible();
}

async function pickChannel(page: Page, value: "all" | "whatsapp" | "instagram" | "messenger") {
  await page.getByTestId("channel-filter").click();
  await page.getByTestId(`channel-filter-${value}`).click();
}

async function pickOption(page: Page, trigger: Locator, name: string) {
  await trigger.click();
  await page.getByRole("option", { name, exact: true }).click();
}

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  expect(rect).not.toBeNull();
  return rect!;
}

test("inbox: three-column layout at 1440px matches the legacy proportions", async ({ page }) => {
  await openInbox(page, { viewport: { width: 1440, height: 900 } });
  await expect(page.getByTestId("chat-empty")).toBeVisible();
  await expect(page.getByTestId("order-panel")).toHaveCount(0);
  await openConversation(page, "cnv_1");

  const list = await box(page.getByTestId("conversation-list"));
  const panel = await box(page.getByTestId("order-panel"));
  const chat = await box(page.getByTestId("chat-panel"));
  expect(list.width).toBe(384);
  expect(panel.width).toBe(320);
  expect(Math.round(list.width + chat.width + panel.width)).toBe(1440);
  expect((await box(page.getByTestId("chat-topbar"))).height).toBe(48);
  expect((await box(page.getByTestId("chat-header"))).height).toBe(56);
  expect((await box(row(page, "cnv_1"))).height).toBe(56);
  // The filter strip and the top strip share one 48px line.
  expect((await box(page.getByTestId("chat-topbar"))).y).toBe((await box(page.getByTestId("filter-unread").locator(".."))).y);
  // Full height under the navbar, no page scroll.
  const main = await box(page.getByTestId("main"));
  expect(Math.round(main.y + main.height)).toBe(900);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);

  // Channel indicator + chat header use the brand marks.
  await expect(row(page, "cnv_1").getByTestId("avatar-channel").locator("[data-brand=messenger]")).toBeVisible();
  await expect(page.getByTestId("chat-channel").locator("[data-brand=messenger]")).toBeVisible();
  await expect(page.getByTestId("chat-channel")).toContainText("Messenger");
  await expect(page.getByTestId("chat-channel")).toContainText("Çevrimiçi");
  await expect(page.getByTestId("order-cargo-ptt").locator("[data-brand=ptt] img")).toBeVisible();
  await expect(page.getByTestId("order-cargo-surat").locator("[data-brand=surat] img")).toBeVisible();

  // Manager extras in the top strip: units sold today (not the order count, 7), stock, online agents.
  await expect(page.getByTestId("daily-sales")).toContainText("11");
  await expect(page.getByTestId("current-stock")).toContainText("12");
  await expect(page.getByTestId("online-agents")).toHaveText(/Elif/);
  await expect(page.getByTestId("online-agents")).not.toContainText("Can");
});

test("inbox: a manager sets an online agent offline from the top strip", async ({ page }) => {
  const { state } = await openInbox(page, { viewport: { width: 1440, height: 900 } });
  const chip = page.getByTestId("online-agent-usr_a");
  await expect(chip).toHaveText(/Elif/);
  await chip.click();
  await expect(page.getByTestId("confirm-dialog")).toContainText("Elif Kaya");
  await page.getByTestId("confirm-dialog-action").click();
  await expect(toast(page, "Elif Kaya çevrimdışı yapıldı")).toBeVisible();
  await expect(page.getByTestId("online-agents")).toHaveCount(0);
  expect(state.bodies.filter((entry) => entry.path === "/admin/users/usr_a/presence")).toEqual([{ method: "PATCH", path: "/admin/users/usr_a/presence", body: { online: false } }]);
});

test("inbox: the order panel only shows from 1280px", async ({ page }) => {
  await openInbox(page, { viewport: { width: 1279, height: 800 }, path: "/mesajlar?konusma=cnv_1" });
  await expect(page.getByTestId("chat-panel")).toBeVisible();
  await expect(page.getByTestId("order-panel")).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByTestId("order-panel")).toBeVisible();
});

test("inbox: deep link opens the conversation and keeps it in the URL", async ({ page }) => {
  await openInbox(page, { path: "/mesajlar?konusma=cnv_1" });
  await expect(page.getByTestId("chat-title")).toContainText("Konuşma Müşterisi 1");
  await expect(page.getByTestId("thread-message")).toHaveCount(2);
  await openConversation(page, "cnv_2");
  await expect.poll(() => new URL(page.url()).searchParams.get("konusma")).toBe("cnv_2");
});

test("inbox: phone shows one pane at a time (list → chat → back)", async ({ page }) => {
  await openInbox(page, { viewport: viewports.phone390 });
  await expect(page.getByTestId("conversation-list")).toBeVisible();
  await expect(page.getByTestId("chat-column")).toBeHidden();
  await expectResponsiveLayout(page, { checkTouchTargets: true });

  await expect(page.getByTestId("topbar")).toBeVisible();
  await expect(page.getByTestId("bottom-nav")).toBeVisible();

  // Open chat is full screen: no app navbar, bottom bar or TEMSİLCİ/GPT strip.
  await openConversation(page, "cnv_1");
  await expect(page.getByTestId("conversation-list")).toBeHidden();
  await expect(page.getByTestId("topbar")).toBeHidden();
  await expect(page.getByTestId("bottom-nav")).toHaveCount(0);
  await expect(page.getByTestId("chat-topbar")).toBeHidden();
  expect((await box(page.getByTestId("chat-header"))).y).toBe(0);
  await expect(page.getByTestId("thread-message")).toHaveCount(2);
  await expect(page.getByTestId("message-composer")).toBeInViewport();
  const composer = await box(page.getByTestId("message-composer"));
  expect(Math.round(composer.y + composer.height)).toBe(844);
  await expect(page.getByTestId("order-panel")).toHaveCount(0);
  await expectResponsiveLayout(page, { checkTouchTargets: true });

  await page.getByTestId("chat-back").click();
  await expect(page.getByTestId("conversation-list")).toBeVisible();
  await expect(page.getByTestId("chat-column")).toBeHidden();
  await expect(page.getByTestId("topbar")).toBeVisible();
  await expect(page.getByTestId("bottom-nav")).toBeVisible();
});

for (const viewport of [viewports.phone390, viewports.phone360]) {
  test(`inbox: single-row composer, menus and 16px inputs at ${viewport.width}px`, async ({ page }) => {
    const { state } = await openInbox(page, { viewport });
    // Below 400px the channel select collapses to its icon so the search keeps the room.
    if (viewport.width < 400) expect((await box(page.getByTestId("channel-filter"))).width).toBe(44);
    expect(await page.getByTestId("conversation-search").evaluate((element) => getComputedStyle(element).fontSize)).toBe("16px");
    await openConversation(page, "cnv_1");

    const row = await Promise.all(["composer-attach-menu", "message-input", "composer-ai", "message-send-button"].map((id) => box(page.getByTestId(id))));
    const centers = row.map((rect) => Math.round(rect.y + rect.height / 2));
    expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(2);
    expect(row[0]!.x).toBeLessThan(row[1]!.x);
    expect(row[2]!.x).toBeGreaterThan(row[1]!.x);
    await expect(page.getByTestId("composer-attach-image")).toBeHidden();
    await expect(page.getByTestId("composer-ai-send")).toBeHidden();
    expect(await page.getByTestId("message-input").evaluate((element) => getComputedStyle(element).fontSize)).toBe("16px");

    // Bubbles may use ~82% of the row on phones.
    expect(await page.getByTestId("thread-message").nth(1).locator("> div").last().evaluate((element) => getComputedStyle(element).maxWidth)).toBe("82%");

    // Auto-grow up to ~5 lines.
    const input = page.getByTestId("message-input");
    await input.fill("1\n2\n3\n4\n5\n6\n7\n8");
    const grown = await box(input);
    expect(grown.height).toBeGreaterThan(80);
    expect(grown.height).toBeLessThanOrEqual(140);
    await input.fill("");

    await page.getByTestId("composer-attach-menu").click();
    await expect(page.getByTestId("composer-attach-options").getByRole("menuitem")).toHaveCount(3);
    await page.getByTestId("composer-attach-menu-quick").click();
    await expect(page.getByTestId("quick-replies")).toBeVisible();
    await expectResponsiveLayout(page, { checkTouchTargets: false });
    await page.getByTestId("quick-replies-close").click();

    // AI menu holds "üret & gönder".
    await page.getByTestId("composer-ai").click();
    await page.getByTestId("composer-ai-menu-send").click();
    await expect(toast(page, "AI yanıt gönderildi")).toBeVisible();
    expect(posts(state, "/api/conversations/cnv_1/ai-reply")).toHaveLength(1);

    // Header ⋮ carries the TEMSİLCİ / GPT switches.
    await page.getByTestId("chat-header-menu-trigger").click();
    const menu = page.getByTestId("chat-header-menu");
    await expect(menu.getByTestId("human-agent-toggle")).toHaveAttribute("aria-checked", "true");
    await expect(menu.getByTestId("gpt-toggle")).toBeVisible();
    await menu.getByTestId("chat-menu-settings").click();
    await expect(page.getByTestId("chat-settings")).toBeVisible();
    await expectResponsiveLayout(page, { checkTouchTargets: false });
  });
}

test("inbox: order sheet on a phone validates and keeps the submit button in view", async ({ page }) => {
  await openInbox(page, { viewport: viewports.phone390 });
  await openConversation(page, "cnv_1");
  await page.getByTestId("chat-open-order").click();
  const sheet = page.getByTestId("order-sheet");
  await expect(sheet).toBeVisible();
  const rect = await box(sheet);
  expect(Math.round(rect.y + rect.height)).toBe(844);
  expect(rect.height).toBeLessThanOrEqual(844 * 0.92 + 1);
  await expect(sheet.getByTestId("order-submit")).toBeInViewport();
  expect(await sheet.getByTestId("order-name").evaluate((element) => getComputedStyle(element).fontSize)).toBe("16px");
  await sheet.getByTestId("order-name").fill("");
  await sheet.getByTestId("order-submit").click();
  await expect(toast(page, "Lütfen İsim giriniz.")).toBeVisible();
  await sheet.getByTestId("order-name").fill("Ayşe Demir");
  await sheet.getByTestId("order-submit").click();
  await expect(toast(page, "Lütfen İl seçiniz.")).toBeVisible();
  await sheet.getByTestId("order-city").click();
  await page.getByTestId("order-city-input").fill("Adan");
  await page.getByTestId("order-city-input").press("Enter");
  await expect(sheet.getByTestId("order-city")).toHaveAttribute("data-value", "Adana");
  await expect(sheet.getByTestId("order-submit")).toBeInViewport();
  await expectResponsiveLayout(page, { checkTouchTargets: false });
  await sheet.getByTestId("order-panel-mode").click();
  await expect(sheet.getByTestId("customer-orders")).toBeVisible();
});

test("inbox: tablet (1100px) keeps the strip and opens the order panel as a side sheet", async ({ page }) => {
  await openInbox(page, { viewport: { width: 1100, height: 800 } });
  await openConversation(page, "cnv_1");
  await expect(page.getByTestId("conversation-list")).toBeVisible();
  await expect(page.getByTestId("chat-topbar")).toBeVisible();
  await expect(page.getByTestId("order-panel")).toHaveCount(0);
  await expect(page.getByTestId("chat-header-menu-trigger")).toBeHidden();
  await page.getByTestId("chat-open-order").click();
  const sheet = page.getByTestId("order-sheet");
  await expect(sheet.getByTestId("order-create-form")).toBeVisible();
  const rect = await box(sheet);
  expect(Math.round(rect.x + rect.width)).toBe(1100);
  expect(rect.height).toBe(800);
  await expect(sheet.getByTestId("order-product")).toHaveAttribute("data-value", "prd_1");
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByTestId("chat-open-order")).toBeHidden();
});

test("inbox: sending shows an optimistic bubble that settles, and rolls back on failure", async ({ page }) => {
  const { state } = await openInbox(page);
  // With the default unread filter a replied conversation leaves the list (legacy); show every row here.
  await page.getByTestId("filter-unread").click();
  await openConversation(page, "cnv_1");
  await expect(page.getByTestId("thread-message")).toHaveCount(2);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(`${backendBaseUrl}/api/conversations/cnv_1/messages`, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await gate;
    return route.fallback();
  });
  await page.getByTestId("message-input").fill("Merhaba, siparişiniz hazırlanıyor");
  await page.getByTestId("message-send-button").click();
  const pending = page.locator('[data-testid="thread-message"][data-pending="true"]');
  await expect(pending).toHaveCount(1);
  await expect(pending).toContainText("Merhaba, siparişiniz hazırlanıyor");
  await expect(page.getByTestId("message-input")).toHaveValue("");
  await expect(row(page, "cnv_1")).toContainText("Temsilci: Merhaba, siparişiniz hazırlanıyor");
  release();
  await expect(pending).toHaveCount(0);
  await expect(page.getByTestId("thread-message")).toHaveCount(3);
  expect(posts(state, "/api/conversations/cnv_1/messages")).toEqual([expect.objectContaining({ sender_type: "user", sender_name: "Yönetici", body: "Merhaba, siparişiniz hazırlanıyor", attachments: [] })]);

  await page.unroute(`${backendBaseUrl}/api/conversations/cnv_1/messages`);
  await page.route(`${backendBaseUrl}/api/conversations/cnv_1/messages`, (route) =>
    route.request().method() === "POST" ? route.fulfill({ status: 500, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ error: { code: "boom", message: "kanal kapalı" } }) }) : route.fallback(),
  );
  await page.getByTestId("message-input").fill("Bu gitmeyecek");
  await page.keyboard.press("Enter");
  await expect(toast(page, "Mesaj gönderilemedi")).toBeVisible();
  await expect(page.getByTestId("thread-message").filter({ hasText: "Bu gitmeyecek" })).toHaveCount(0);
  await expect(page.getByTestId("thread-message")).toHaveCount(3);
});

test("inbox: Enter on an empty composer jumps to the next conversation", async ({ page }) => {
  await openInbox(page);
  const rows = page.getByTestId("conversation-row");
  const firstId = await rows.nth(0).getAttribute("data-id");
  const secondId = await rows.nth(1).getAttribute("data-id");
  await rows.nth(0).click();
  await expect(rows.nth(0)).toHaveAttribute("aria-current", "true");
  await page.getByTestId("message-input").press("Enter");
  await expect(row(page, secondId!)).toHaveAttribute("aria-current", "true");
  await expect(row(page, firstId!)).not.toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("message-input")).toBeFocused();
});

test("inbox: shortcut suggestions expand with Tab and send with Enter", async ({ page }) => {
  const { state } = await openInbox(page);
  await openConversation(page, "cnv_1");
  const input = page.getByTestId("message-input");
  await input.pressSequentially("merhaba ka");
  const suggestions = page.getByTestId("shortcut-suggestion");
  await expect(suggestions).toHaveCount(1);
  await expect(suggestions).toContainText("kargo");
  await input.press("Tab");
  await expect(input).toHaveValue("merhaba Kargonuz yola çıktı. ");
  await expect(suggestions).toHaveCount(0);
  expect(posts(state, "/api/conversations/cnv_1/messages")).toHaveLength(0);

  await input.fill("");
  await input.pressSequentially("kar");
  await expect(suggestions).toHaveCount(1);
  await input.press("Enter");
  await expect.poll(() => posts(state, "/api/conversations/cnv_1/messages")).toEqual([expect.objectContaining({ body: "Kargonuz yola çıktı." })]);
  await expect(input).toHaveValue("");
});

test("inbox: attachments, quick replies, AI suggestion and media rendering", async ({ page }) => {
  const { state, extras } = await openInbox(page);
  await openConversation(page, "cnv_1");
  await expect(page.getByTestId("thread-message").nth(1)).toHaveAttribute("data-sender", "ai");
  await expect(page.getByTestId("thread-message").nth(1)).toContainText("Yapay Zeka");
  await expect(page.getByTestId("message-attachment")).toHaveText("fatura.pdf");

  await page.getByTestId("composer-quick-replies").click();
  await page.getByTestId("shortcut-kargo").click();
  await expect(page.getByTestId("quick-replies")).toHaveCount(0);
  await expect(page.getByTestId("message-input")).toHaveValue("Kargonuz yola çıktı. ");
  await page.getByTestId("composer-image-file").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: Buffer.from("png!") });
  await expect(page.getByTestId("media-preview")).toContainText("foto.png");
  await page.getByTestId("message-send-button").click();
  await expect(page.getByTestId("thread-message")).toHaveCount(3);
  await expect(page.getByTestId("media-preview")).toHaveCount(0);
  await expect.poll(() => posts(state, "/api/conversations/cnv_1/messages")).toEqual([expect.objectContaining({ body: "Kargonuz yola çıktı.", attachments: [{ file_public_id: "fil_up", attachment_type: "image" }] })]);
  const upload = state.bodies.find((entry) => entry.path === "/api/files/uploads")?.body as { checksum: string; byte_size: number };
  expect(upload).toMatchObject({ original_name: "foto.png", mime_type: "image/png", byte_size: 4 });
  expect(upload.checksum).toMatch(/^[A-Za-z0-9+/]+=*$/);
  expect(state.bodies.some((entry) => entry.method === "PUT" && entry.path === "/presigned/foto.png")).toBe(true);

  extras.dryRun = true;
  await page.getByTestId("composer-ai").click();
  await expect(page.getByTestId("ai-suggestion")).toContainText("Siparişiniz bugün kargoya verildi.");
  await expect(page.getByTestId("ai-suggestion")).toContainText("Kuru çalıştırma");
  // A dry-run placeholder can be copied into the box but never sent straight away.
  await expect(page.getByTestId("ai-suggestion-send")).toBeDisabled();
  await page.getByTestId("ai-suggestion-use").click();
  await expect(page.getByTestId("message-input")).toHaveValue("Siparişiniz bugün kargoya verildi.");
});

test("inbox: AI generate & send, and the empty-suggestion guard", async ({ page }) => {
  const { state, extras } = await openInbox(page);
  await openConversation(page, "cnv_1");
  await page.getByTestId("composer-ai-send").click();
  await expect(toast(page, "AI yanıt gönderildi")).toBeVisible();
  await expect(page.getByTestId("thread-message").last()).toContainText("Siparişiniz bugün kargoya verildi.");
  // The server drafts and sends; the panel never posts the AI text itself.
  expect(posts(state, "/api/conversations/cnv_1/ai-reply")).toEqual([undefined]);
  expect(posts(state, "/api/ai/reply-suggestion")).toEqual([]);
  // The customer is no longer waiting: the server refuses a second answer.
  await page.getByTestId("composer-ai-send").click();
  await expect(toast(page, "Son mesaj zaten yanıtlanmış; AI yanıtı gönderilmedi")).toBeVisible();
  extras.answered = false;
  extras.suggestion = "  ";
  await page.getByTestId("composer-ai-send").click();
  await expect(toast(page, "AI yanıt üretemedi; mesaj gönderilmedi")).toBeVisible();
  // Live AI off: the placeholder is shown as a suggestion and nothing reaches the customer.
  extras.suggestion = "AI yanıt önerisi backend dry-run sınırında tutuldu.";
  extras.dryRun = true;
  await page.getByTestId("composer-ai-send").click();
  await expect(toast(page, "Canlı AI kapalı olduğu için yanıt gönderilmedi; öneri olarak gösterildi")).toBeVisible();
  await expect(page.getByTestId("ai-suggestion")).toContainText("Kuru çalıştırma");
  await expect(page.getByTestId("ai-suggestion")).toContainText("dry-run sınırında");
  expect(posts(state, "/api/conversations/cnv_1/messages")).toHaveLength(0);
  expect(posts(state, "/api/conversations/cnv_1/ai-reply")).toHaveLength(4);
});

test("inbox: top strip toggles, menu actions and notes", async ({ page }) => {
  const { state, extras } = await openInbox(page);
  // TEMSİLCİ only applies to Instagram / Messenger conversations.
  await expect(page.getByTestId("human-agent-toggle")).toBeDisabled();
  await openConversation(page, "cnv_1");
  const agent = page.getByTestId("human-agent-toggle");
  await expect(agent).toHaveAttribute("aria-checked", "true");
  await agent.click();
  await expect(agent).toHaveAttribute("aria-checked", "false");
  await expect(toast(page, "Temsilci modu kapatıldı")).toBeVisible();

  const gpt = page.getByTestId("gpt-toggle");
  await expect(gpt).toHaveAttribute("aria-checked", "true");
  await gpt.click();
  await expect(gpt).toHaveAttribute("aria-checked", "false");
  expect(extras.aiEnabled).toBe(false);

  // Managers mark a single conversation read from the header.
  await page.getByTestId("chat-mark-read").click();
  await expect(page.getByTestId("chat-mark-read")).toHaveCount(0);

  await page.getByTestId("chat-menu-trigger").click();
  await page.getByTestId("conversation-release").click();
  await expect.poll(() => state.conversations[0]!.is_in_pool).toBe(true);
  await page.getByTestId("chat-menu-trigger").click();
  await expect(page.getByTestId("conversation-take")).toBeVisible();
  await page.getByTestId("conversation-note-open").click();
  await page.getByTestId("conversation-note").fill("İade isteyebilir");
  await page.getByTestId("conversation-note-save").click();
  await expect(toast(page, "Not kaydedildi")).toBeVisible();
  expect(state.bodies.find((entry) => entry.path === "/api/conversations/cnv_1/notes")?.body).toEqual({ notes: "İade isteyebilir" });

  // Customer note next to the name (legacy InlineNote).
  await page.getByTestId("inline-note-trigger").click();
  await page.getByTestId("inline-note-input").fill("VIP müşteri");
  await page.getByTestId("inline-note-input").press("Enter");
  await expect(page.getByTestId("inline-note-text")).toHaveText("— VIP müşteri");
  expect(state.bodies.find((entry) => entry.path === "/api/conversations/cnv_1/customer-notes")?.body).toEqual({ notes: "VIP müşteri" });

  await page.getByTestId("chat-menu-trigger").click();
  await page.getByTestId("chat-menu-settings").click();
  await page.getByTestId("chat-settings-auto-open").click();
  await expect(page.getByTestId("chat-settings-auto-open")).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate(() => window.localStorage.getItem("garanti-beta-chat-auto-open"))).toBe("1");
});

test("inbox: auto-open setting opens the newest conversation on load", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("garanti-beta-chat-auto-open", "1"));
  await openInbox(page);
  await expect(page.getByTestId("conversation-row").first()).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("chat-panel")).toBeVisible();
});

test("inbox: order create validates in the legacy order, warns on duplicates and sends the follow-up", async ({ page }) => {
  const { state } = await openInbox(page, {
    viewport: { width: 1440, height: 900 },
    orderResponses: [{ status: 409, body: { error: { code: "duplicate_phone_warning", message: "Aynı telefon numarasıyla başka aktif sipariş bulunuyor." } } }],
  });
  await openConversation(page, "cnv_1");
  const panel = page.getByTestId("order-panel");
  await expect(panel.getByTestId("order-name")).toHaveValue("Konuşma Müşterisi 1");
  await expect(panel.getByTestId("order-phone")).toHaveValue("05550000001");
  // Default product is the hand-made incubator with its price.
  await expect(panel.getByTestId("order-product").first()).toHaveAttribute("data-value", "prd_1");
  await expect(panel.getByTestId("order-price").first()).toHaveValue("3500");

  const submit = panel.getByTestId("order-submit");
  const expectError = async (text: string) => {
    await submit.click();
    await expect(toast(page, text).last()).toBeVisible();
  };
  await panel.getByTestId("order-name").fill("");
  await panel.getByTestId("order-phone").fill("");
  await expectError("Lütfen İsim giriniz.");
  await panel.getByTestId("order-name").fill("Ayşe Demir");
  await expectError("Lütfen Telefon giriniz.");
  await panel.getByTestId("order-phone").fill("05551234567");
  await expectError("Lütfen İl seçiniz.");
  await panel.getByTestId("order-city").click();
  await page.getByTestId("order-city-input").fill("Adan");
  await page.getByTestId("order-city-input").press("Enter");
  await expectError("Lütfen İlçe seçiniz.");
  await panel.getByTestId("order-district").click();
  await page.getByTestId("order-district-input").fill("Seyh");
  await page.getByTestId("order-district-input").press("Enter");
  await expectError("Lütfen Adres giriniz.");
  await panel.getByTestId("order-address").fill("Atatürk Cd. 1");
  await panel.getByTestId("order-price").first().fill("");
  await expectError("Lütfen Fiyat giriniz.");
  await panel.getByTestId("order-price").first().fill("3500");
  await pickOption(page, panel.getByTestId("order-product").first(), "-- Ürün Seçin --");
  await expectError("Ürün seçimi zorunlu.");
  await pickOption(page, panel.getByTestId("order-product").first(), "El Yapımı Kuluçka Makinesi");
  await expectError("Kargo firması seçimi zorunlu (PTT veya Sürat).");
  expect(posts(state, "/api/orders")).toHaveLength(0);

  // "Ürün Ekle" shows the second product box on the first click (legacy bug fixed).
  await panel.getByTestId("order-add-product").click();
  await expect(panel.getByTestId("order-line")).toHaveCount(2);
  await panel.getByTestId("order-remove-product").click();
  await expect(panel.getByTestId("order-line")).toHaveCount(1);

  await panel.getByTestId("order-cargo-ptt").click();
  await submit.click();
  await expect(page.getByTestId("chat-alert")).toContainText("Aynı telefon numarasıyla başka aktif sipariş bulunuyor.");
  await expect(submit).toHaveText("Yine de Oluştur");
  await submit.click();
  await expect(toast(page, "Sipariş oluşturuldu! (GK-3001) Bakiyenize +50 TL komisyon eklendi.")).toBeVisible();
  const orders = posts(state, "/api/orders");
  expect(orders).toHaveLength(2);
  expect(orders[1]).toMatchObject({
    conversation_public_id: "cnv_1",
    source: "conversation",
    cargo_provider: "ptt",
    force_duplicate: true,
    customer: { full_name: "Ayşe Demir", phone: "05551234567" },
    address: { address_line: "Atatürk Cd. 1", city: "Adana", district: "Seyhan", country: "Türkiye" },
    items: [{ product_public_id: "prd_1", name: "El Yapımı Kuluçka Makinesi", quantity: 1, unit_price: "3500.00" }],
  });
  // Legacy follow-up: shortcut "2" with the total filled in and the closing question stripped.
  await expect.poll(() => posts(state, "/api/conversations/cnv_1/messages")).toEqual([expect.objectContaining({ body: "Siparişiniz alındı, toplam 3.500 TL." })]);
  await expect(submit).toHaveText("Sipariş Oluştur");
});

test("inbox: Sürat AT warning asks before creating", async ({ page }) => {
  const { state } = await openInbox(page, {
    viewport: { width: 1440, height: 900 },
    orderResponses: [{ status: 409, body: { error: { code: "surat_at_warning", message: "Bu adrese sürat kargo teslimat yapmamaktadır" } } }],
  });
  await openConversation(page, "cnv_1");
  const panel = page.getByTestId("order-panel");
  await panel.getByTestId("order-city").click();
  await page.getByTestId("order-city-input").fill("Van");
  await page.getByTestId("order-city-input").press("Enter");
  await panel.getByTestId("order-district").click();
  await page.getByTestId("order-district-input").fill("Başkale");
  await page.getByTestId("order-district-input").press("Enter");
  await panel.getByTestId("order-address").fill("Köy yolu, AT dışı");
  await panel.getByTestId("order-cargo-surat").click();
  await panel.getByTestId("order-submit").click();
  const dialog = page.getByTestId("at-warning");
  await expect(dialog).toContainText("Sürat Kargo Teslimat Yapılmıyor");
  await expect(dialog).toContainText("Başkale");
  await dialog.getByTestId("at-warning-create").click();
  await expect(toast(page, "Sipariş oluşturuldu! (GK-3001)")).toBeVisible();
  expect(posts(state, "/api/orders")[1]).toMatchObject({ force_surat_at: true, cargo_provider: "surat" });
});

test("inbox: order query screen lists the customer's orders and opens the cargo detail", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { route } = routes();
  const state = await mockBackend(page, mockUser("admin"), {
    extra: (request, backend) => {
      // The conversation detail carries the customer id, note and default address (no phone lookup).
      if (request.path === "/api/conversations/cnv_1" && request.method === "GET") {
        const row = backend.conversations[0]!;
        return { status: 200, body: { ...row, notes: null, customer: { ...row.customer, public_id: "cus_1", username: null, notes: "Ödeme kapıda", default_address: { address_line: "Atatürk Cd. 1", city: "Adana", district: "Seyhan", country: "TR", is_default: true } } } };
      }
      if (request.path === "/api/customers/cus_1") {
        return {
          status: 200,
          body: {
            customer: { public_id: "cus_1", full_name: "Konuşma Müşterisi 1", phone: "05550000001", notes: null, updated_at: now },
            addresses: [],
            orders: [{ public_id: "ord_9", order_number: "GK-9009", status: "shipped", source: "conversation", cargo_provider: "ptt", total_amount: "3500.00", currency: "TRY", created_at: now, shipment: { public_id: "shp_9", provider: "ptt", status: "in_transit", tracking_number: "KP123" } }],
            conversations: [],
          },
        };
      }
      if (request.path === "/api/orders/ord_9/edit") {
        return { status: 200, body: { order: { public_id: "ord_9", order_number: "GK-9009", status: "shipped", cargo_provider: "ptt", notes: null, currency: "TRY", total_amount: "3500.00", items_total: "3500.00", manual_total: false, customer: { public_id: "cus_1", full_name: "Konuşma Müşterisi 1", phone: "05550000001" }, address: { address_line: "Atatürk Cd. 1", city: "Adana", district: "Seyhan" }, items: [{ public_id: "itm_1", product_public_id: "prd_1", name: "El Yapımı Kuluçka Makinesi", quantity: 1, unit_price: "3500.00", total_amount: "3500.00" }], locked_reason: null, updated_at: now } } };
      }
      if (request.path === "/api/shipments/shp_9") {
        return { status: 200, body: { public_id: "shp_9", provider: "ptt", tracking_number: "KP123", status: "in_transit", recipient_name: "Konuşma Müşterisi 1", recipient_city: "Adana", recipient_district: "Seyhan", last_event_text: "Dağıtıma çıktı", tracking_events: [{ public_id: "evt_1", status: "in_transit", description: "Transfer merkezinde", location: "Adana", occurred_at: now }] } };
      }
      return route(request, backend);
    },
  });
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("topbar")).toBeVisible();
  await page.goto("/mesajlar?konusma=cnv_1");
  await expect(page.getByTestId("inline-note-text")).toHaveText("— Ödeme kapıda");
  const panel = page.getByTestId("order-panel");
  await expect(panel.getByTestId("order-address")).toHaveValue("Atatürk Cd. 1");
  await panel.getByTestId("order-panel-mode").click();
  await expect(panel.getByTestId("customer-order")).toContainText("#GK-9009");
  await expect(panel.getByTestId("customer-order")).toContainText("KP123");
  await panel.getByTestId("customer-order").click();
  await expect(panel.getByTestId("order-detail")).toContainText("El Yapımı Kuluçka Makinesi x1");
  await expect(panel.getByTestId("order-detail")).toContainText("Dağıtıma çıktı");
  await panel.getByTestId("order-detail-cargo").click();
  await expect(page.getByTestId("cargo-dialog")).toContainText("Transfer merkezinde");
  expect(state.requests.some((request) => request.path === "/api/orders/customer-lookup")).toBe(false);
});

test("inbox: quick replies manage shortcuts and export them as JSON", async ({ page }) => {
  const { state } = await openInbox(page);
  await openConversation(page, "cnv_1");
  await page.getByTestId("composer-quick-replies").click();
  const popover = page.getByTestId("quick-replies");
  await expect(popover.getByTestId("shortcut-row-kargo")).toContainText("Kargonuz yola çıktı.");
  await popover.getByTestId("shortcut-add").click();
  await expect(popover.getByTestId("shortcut-save")).toBeDisabled();
  await popover.getByTestId("shortcut-code").fill("/kargo");
  await popover.getByTestId("shortcut-message").fill("tekrar");
  await popover.getByTestId("shortcut-save").click();
  await expect(toast(page, "Bu kısayol kodu (/kargo) zaten kullanımda")).toBeVisible();
  await popover.getByTestId("shortcut-code").fill("iban");
  await popover.getByTestId("shortcut-message").fill("IBAN: TR00 0000");
  await popover.getByTestId("shortcut-save").click();
  await expect(popover.getByTestId("shortcut-row-iban")).toBeVisible();
  expect(posts(state, "/api/message-shortcuts")).toEqual([{ code: "iban", message: "IBAN: TR00 0000", attachments: [], type: "custom" }]);
  await popover.getByTestId("shortcut-row-kargo").hover();
  await popover.getByTestId("shortcut-row-kargo").getByTestId("shortcut-delete").click();
  await expect(page.getByTestId("confirm-dialog")).toContainText("Bu kısayolu silmek istediğinize emin misiniz?");
  await page.getByTestId("confirm-dialog-action").click();
  await expect(popover.getByTestId("shortcut-row-kargo")).toHaveCount(0);
  const [download] = await Promise.all([page.waitForEvent("download"), popover.getByTestId("shortcuts-export").click()]);
  const exported = JSON.parse(await readFile((await download.path())!, "utf8")) as Array<{ code: string }>;
  expect(exported.map((item) => item.code)).toEqual(["2", "iban"]);
});

test("inbox: older messages, load more conversations and mark all read", async ({ page }) => {
  const { state } = await openInbox(page, { olderPage: true });
  // 127 conversations: the first batch (100) is full, the button loads the rest by offset.
  const base = state.conversations[0]!;
  for (let index = 28; index <= 127; index += 1) {
    state.conversations.push({ ...base, public_id: `cnv_${index}`, channel: index % 2 === 0 ? "instagram" : "facebook", unread_count: index % 3, customer: { full_name: `Konuşma Müşterisi ${index}`, phone: `0555000${String(index).padStart(4, "0")}` } });
  }
  await page.reload();
  // "Okunmamış" (on by default) is filtered on the server, so the first page only holds unread rows.
  await expect(page.getByTestId("conversation-row")).toHaveCount(85);
  expect(state.requests.some((request) => request.path === "/api/conversations" && request.search === "?limit=100&unread=true")).toBe(true);
  await expect(page.getByTestId("filter-unread")).toContainText("85");
  await page.getByTestId("filter-unread").click();
  await expect(page.getByTestId("conversation-row")).toHaveCount(100);
  await page.getByTestId("conversations-load-more").click();
  await expect(page.getByTestId("conversation-row")).toHaveCount(127);
  expect(state.requests.some((request) => request.path === "/api/conversations" && request.search === "?limit=100&offset=100")).toBe(true);
  await expect(page.getByTestId("conversations-load-more")).toHaveCount(0);

  await openConversation(page, "cnv_1");
  await expect(page.getByTestId("thread-message")).toHaveCount(2);
  await page.getByTestId("conversation-load-older").click();
  await expect(page.getByTestId("thread-message")).toHaveCount(3);
  await expect(page.getByTestId("thread-message").first()).toContainText("En eski mesaj");
  expect(state.requests.filter((request) => request.path === "/api/conversations/cnv_1/messages").map((request) => request.search)).toContain("?limit=100&before=msg_1");

  await pickChannel(page, "instagram");
  await expect.poll(() => state.requests.filter((request) => request.path === "/api/conversations").at(-1)?.search).toContain("channel=instagram");
  await page.getByTestId("chat-menu-trigger").click();
  await page.getByTestId("chat-menu-mark-all-read").click();
  await expect(page.getByTestId("confirm-dialog")).toContainText(/okunmamış konuşma okundu işaretlensin mi\?/);
  await page.getByTestId("confirm-dialog-action").click();
  await expect(toast(page, /konuşma okundu işaretlendi/)).toBeVisible();
  expect(state.bodies.filter((entry) => entry.path === "/api/conversations/mark-all-read").map((entry) => entry.body)).toEqual([{ channel: "instagram" }]);
});

test("inbox: staff who are offline see the legacy offline state and can go online", async ({ page }) => {
  await page.setViewportSize(viewports.desktop);
  const { route } = routes();
  const state = await mockBackend(page, mockUser("calisan", { is_online: false }), { extra: route });
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("topbar")).toBeVisible();
  await page.goto("/mesajlar");
  await expect(page.getByTestId("conversations-offline")).toContainText("Çevrimdışı Görünüyorsunuz");
  await page.getByTestId("conversations-go-online").click();
  await expect(page.getByTestId("conversation-row").first()).toBeVisible();
  // Staff see the pool counter; GPT is read-only for them.
  await expect(page.getByTestId("pool-count")).toHaveText("Havuz (9)");
  await expect(page.getByTestId("gpt-toggle")).toBeDisabled();
});

test("inbox: light and dark themes both render the legacy palette", async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.localStorage.getItem("garanti-beta-theme")) window.localStorage.setItem("garanti-beta-theme", "dark");
  });
  await openInbox(page, { viewport: { width: 1440, height: 900 }, path: "/mesajlar?konusma=cnv_1" });
  const bg = (testId: string) => page.getByTestId(testId).evaluate((element) => getComputedStyle(element).backgroundColor);
  // Dark = legacy slate-900 list / slate-800 header 1:1.
  expect(await bg("conversation-list")).toBe("rgb(15, 23, 42)");
  expect(await bg("chat-header")).toBe("rgb(30, 41, 59)");
  await page.evaluate(() => window.localStorage.setItem("garanti-beta-theme", "light"));
  await page.reload();
  await expect(page.getByTestId("chat-header")).toBeVisible();
  expect(await bg("conversation-list")).toBe("rgb(248, 250, 252)");
  expect(await bg("chat-header")).toBe("rgb(255, 255, 255)");
});
