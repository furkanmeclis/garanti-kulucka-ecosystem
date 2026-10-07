import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

/** Legacy Mesajlar extras: mark-all-read, older-message paging, server-side search + load-more, AI generate & send. */
const backendBaseUrl = "http://127.0.0.1:65521";

test.setTimeout(90_000);

interface ConversationRow {
  public_id: string;
  channel: string;
  status: string;
  is_in_pool: boolean;
  human_agent_enabled: boolean;
  unread_count: number;
  last_message_text: string;
  last_message_sender_type: string;
  last_message_at: string;
  customer: { full_name: string; phone: string; username?: string | null };
  assigned_user_email: string | null;
  notes: string | null;
  updated_at: string;
}

async function startWebApp() {
  const server = await createServer({
    root: "apps/web",
    configFile: "apps/web/vite.config.ts",
    server: { host: "127.0.0.1", port: 0 },
    define: {
      "import.meta.env.VITE_BACKEND_BASE_URL": JSON.stringify(backendBaseUrl),
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("Vite dev server did not expose a TCP address");
  }
  return { url: `http://127.0.0.1:${address.port}`, server };
}

async function closeWebApp(server: ViteDevServer) {
  await server.close();
}

function conversation(index: number, overrides: Partial<ConversationRow> = {}): ConversationRow {
  const minute = String(59 - (index % 60)).padStart(2, "0");
  return {
    public_id: `cnv_${index}`,
    channel: index % 2 === 0 ? "instagram" : "facebook",
    status: "open",
    is_in_pool: false,
    human_agent_enabled: false,
    unread_count: index < 4 ? 1 : 0,
    last_message_text: `Son mesaj ${index}`,
    last_message_sender_type: "customer",
    last_message_at: `2026-01-01T10:${minute}:00.000Z`,
    customer: { full_name: `Müşteri ${index}`, phone: `555000${String(index).padStart(4, "0")}`, username: null },
    assigned_user_email: null,
    notes: null,
    updated_at: `2026-01-01T10:${minute}:00.000Z`,
    ...overrides,
  };
}

function messageRow(public_id: string, sender_type: string, body: string, sent_at: string) {
  return {
    public_id,
    sender_type,
    sender_name: sender_type === "customer" ? "Müşteri 0" : "calisan@example.com",
    body,
    external_message_id: null,
    is_read: sender_type !== "customer",
    sent_at,
    attachments: [],
  };
}

test("Mesajlar extras: older messages, server search + load more, mark all read and AI send use the backend API", async ({ page }) => {
  const app = await startWebApp();
  const user = {
    public_id: "usr_inbox_extras",
    email: "calisan@example.com",
    first_name: "Çalışan",
    last_name: "Kullanıcı",
    role: "calisan",
    permissions: [] as string[],
    is_online: true,
    sip_username: "1002",
  };
  // 23 conversations: the first page (20) is full so "load more" appears, the second page has 3.
  const rows: ConversationRow[] = Array.from({ length: 23 }, (_, index) => conversation(index));
  // Matches only by username on the server, so a client-side filter of the loaded rows would never show it.
  const searchHit = conversation(99, {
    public_id: "cnv_search_hit",
    channel: "instagram",
    unread_count: 0,
    last_message_text: "Kuluçka makinesi",
    customer: { full_name: "Uzak Kayıt", phone: "5559999999", username: "arananhesap" },
  });
  const conversationUrls: string[] = [];
  const messageListUrls: string[] = [];
  const markAllReadBodies: unknown[] = [];
  const messagePosts: Array<{ body?: string | null; sender_type?: string }> = [];
  const sentMessages: Array<ReturnType<typeof messageRow>> = [];
  let aiSuggestionCalls = 0;
  let aiSuggestionText = "AI ile üretilmiş yanıt";

  await page.route(`${backendBaseUrl}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname === "/auth/login") {
      return json({ access_token: "inbox-extras-token", refresh_token: "inbox-extras-refresh", token_type: "Bearer", expires_in: 900, user });
    }
    if (url.pathname === "/auth/me") return json(user);
    if (url.pathname === "/auth/presence") return json(user);

    if (url.pathname === "/api/conversations") {
      conversationUrls.push(`${url.pathname}${url.search}`);
      const channels = url.searchParams.get("channel")?.split(",").filter(Boolean);
      const search = url.searchParams.get("search")?.toLocaleLowerCase("tr-TR");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const source = search ? [...rows, searchHit] : rows;
      const filtered = source.filter((row) => {
        const channelMatches = !channels?.length || channels.includes(row.channel);
        const searchMatches =
          !search ||
          [row.customer.full_name, row.customer.phone, row.customer.username, row.last_message_text].some((value) =>
            value?.toLocaleLowerCase("tr-TR").includes(search),
          );
        return channelMatches && searchMatches;
      });
      return json({ data: filtered.slice(offset, offset + limit) });
    }
    if (url.pathname === "/api/conversations/summary") {
      return json({
        total_count: rows.length,
        unread_count: rows.reduce((sum, row) => sum + row.unread_count, 0),
        pool_count: 0,
        human_agent_count: 0,
        channel_counts: {
          instagram: rows.filter((row) => row.channel === "instagram").length,
          facebook: rows.filter((row) => row.channel === "facebook").length,
        },
        status_counts: { open: rows.length, closed: 0 },
      });
    }
    if (url.pathname === "/api/conversations/mark-all-read" && request.method() === "POST") {
      const body = JSON.parse(request.postData() ?? "{}") as { channel?: string };
      markAllReadBodies.push(body);
      const channels = body.channel ? (body.channel === "facebook" ? ["facebook", "messenger"] : [body.channel]) : null;
      let updated = 0;
      for (const row of rows) {
        if (row.unread_count > 0 && (!channels || channels.includes(row.channel))) {
          row.unread_count = 0;
          updated += 1;
        }
      }
      return json({ updated });
    }
    const messagesMatch = /^\/api\/conversations\/([^/]+)\/messages$/.exec(url.pathname);
    if (messagesMatch) {
      if (request.method() === "POST") {
        const payload = JSON.parse(request.postData() ?? "{}") as { body?: string | null; sender_type?: string };
        messagePosts.push(payload);
        const message = messageRow(`msg_sent_${messagePosts.length}`, payload.sender_type ?? "user", payload.body ?? "", `2026-01-01T12:0${messagePosts.length}:00.000Z`);
        sentMessages.push(message);
        return json({ ...message, delivery: null }, 201);
      }
      messageListUrls.push(`${url.pathname}${url.search}`);
      const before = url.searchParams.get("before");
      if (before === "msg_latest_1") {
        return json({ data: [messageRow("msg_old_1", "customer", "En eski müşteri mesajı", "2026-01-01T09:00:00.000Z")], has_more: false });
      }
      return json({
        data: [
          messageRow("msg_latest_1", "customer", "Son sayfadaki ilk mesaj", "2026-01-01T11:00:00.000Z"),
          messageRow("msg_latest_2", "user", "Son sayfadaki cevap", "2026-01-01T11:01:00.000Z"),
          ...sentMessages,
        ],
        has_more: true,
      });
    }
    if (url.pathname === "/api/ai/reply-suggestion") {
      aiSuggestionCalls += 1;
      return json({
        provider: "openai",
        operation: "messages.reply_suggestion",
        dry_run: true,
        live_call_permitted: false,
        conversation_public_id: "cnv_0",
        suggestion: aiSuggestionText,
      });
    }

    const fallback = fallbackResponse(url.pathname);
    if (fallback !== undefined) return json(fallback);
    return route.fulfill({ status: 404, body: "not found" });
  });

  try {
    await page.goto(`${app.url}/giris`);
    await page.getByRole("button", { name: /giriş yap/i }).click();
    await expect(page.getByTestId("conversation-row")).toHaveCount(20);

    // 2. "Eski mesajları yükle": the newest page loads first, then before=<oldest loaded id> is prepended.
    await expect(page.getByTestId("message-scroll-area")).toContainText("Son sayfadaki ilk mesaj");
    expect(messageListUrls).toContain("/api/conversations/cnv_0/messages?limit=50");
    await page.getByTestId("load-older-messages").click();
    await expect(page.getByTestId("message-scroll-area")).toContainText("En eski müşteri mesajı");
    expect(messageListUrls).toContain("/api/conversations/cnv_0/messages?limit=50&before=msg_latest_1");
    await expect(page.getByTestId("load-older-messages")).toHaveCount(0);
    await expect(page.locator(".message-bubble").first()).toContainText("En eski müşteri mesajı");

    // 3a. "Daha fazla konuşma yükle" appends the next offset page and hides when the page was not full.
    await page.getByTestId("load-more-conversations").click();
    await expect(page.getByTestId("conversation-row")).toHaveCount(23);
    expect(conversationUrls).toContain("/api/conversations?limit=20&offset=20");
    await expect(page.getByTestId("load-more-conversations")).toHaveCount(0);

    // 3b. Search goes to the server (debounced) and shows rows the loaded list could not match.
    await page.getByTestId("conversation-search").fill("arananhesap");
    await expect.poll(() => conversationUrls).toContain("/api/conversations?limit=20&search=arananhesap");
    await expect(page.getByTestId("conversation-row")).toHaveCount(1);
    await expect(page.getByTestId("conversation-list")).toContainText("Uzak Kayıt");
    await page.getByTestId("conversation-search").fill("");
    await expect(page.getByTestId("conversation-row")).toHaveCount(20);
    expect(conversationUrls.filter((value) => value.includes("search=")).length).toBe(1);

    // 1. "Tümünü okundu yap" for the facebook filter, then for all channels (confirm shows the unread count).
    await page.getByTestId("channel-filter").selectOption("facebook");
    await expect(page.getByTestId("conversation-list")).not.toContainText("Müşteri 0");
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.accept();
    });
    await page.getByTestId("mark-all-read-button").click();
    await expect(page.getByText("2 konuşma okundu olarak işaretlendi")).toBeVisible();
    expect(dialogs[0]).toContain("2 okunmamış konuşma");
    expect(markAllReadBodies[0]).toEqual({ channel: "facebook" });

    await page.getByTestId("channel-filter").selectOption("all");
    await expect(page.getByTestId("conversation-list")).toContainText("Müşteri 0");
    await page.getByTestId("mark-all-read-button").click();
    await expect(page.getByText("2 konuşma okundu olarak işaretlendi")).toBeVisible();
    expect(dialogs[1]).toContain("2 okunmamış konuşma");
    expect(markAllReadBodies[1]).toEqual({});
    await expect(page.getByTestId("mark-all-read-button")).toBeDisabled();
    expect(conversationUrls.filter((value) => value === "/api/conversations?limit=20").length).toBeGreaterThan(1);

    // 4. Existing "suggest into draft" still works.
    await page.getByTestId("ai-suggestion-button").click();
    await expect(page.getByTestId("ai-suggestion")).toContainText("AI ile üretilmiş yanıt");
    expect(messagePosts).toHaveLength(0);

    // 4. "AI ile üret ve gönder" requests the suggestion and sends it as the reply immediately.
    await page.getByTestId("ai-send-button").click();
    await expect(page.getByText("AI yanıtı üretildi ve gönderildi")).toBeVisible();
    expect(aiSuggestionCalls).toBe(2);
    expect(messagePosts).toEqual([expect.objectContaining({ body: "AI ile üretilmiş yanıt", sender_type: "user" })]);
    await expect(page.getByTestId("message-scroll-area")).toContainText("AI ile üretilmiş yanıt");

    // An empty suggestion is an error and nothing is sent.
    aiSuggestionText = "   ";
    await page.getByTestId("ai-send-button").click();
    await expect(page.getByText("AI yanıt üretemedi; mesaj gönderilmedi")).toBeVisible();
    expect(aiSuggestionCalls).toBe(3);
    expect(messagePosts).toHaveLength(1);
  } finally {
    await closeWebApp(app.server);
  }
});

function fallbackResponse(pathname: string) {
  const emptyData = { data: [] };
  if (pathname === "/api/customers") return emptyData;
  if (pathname === "/api/message-shortcuts") return emptyData;
  if (pathname === "/api/customers/summary") return { total_count: 0, with_phone_count: 0, with_email_count: 0, with_notes_count: 0 };
  if (pathname === "/api/comments/moderation-summary") return { manual_queue: 0, automatic_queue: 0, answered: 0, instagram: 0, facebook: 0 };
  if (pathname === "/api/balances/summary") return { total_commission: 0, total_deduction: 0, pending_payment: 0, available_balance: 0, pending_request_count: 0 };
  if (pathname === "/api/orders") return emptyData;
  if (pathname === "/api/orders/summary") return { total_count: 0, active_count: 0, delivered_count: 0, pending_confirmation_count: 0, total_revenue: 0, currency: "TRY" };
  if (pathname === "/api/products") return emptyData;
  if (pathname === "/api/orders/product-options") return emptyData;
  if (pathname === "/api/products/summary") return { total_count: 0, active_count: 0, critical_count: 0, critical_threshold: 3, category_counts: { incubator: 0, spare_part: 0, other: 0 } };
  if (pathname === "/api/shipments") return emptyData;
  if (pathname === "/api/shipments/summary") return { total_count: 0, active_count: 0, delivered_count: 0, recipient_phone_count: 0, provider_counts: { ptt: 0, surat: 0, other: 0 }, exception_counts: { ptt_not_delivered: 0, surat_not_delivered: 0, tracking_missing: 0 } };
  if (pathname === "/api/shipments/pipeline-summary") return { counts: { all: 0, mesaj: 0, sms: 0, vapi: 0, teslim: 0, bekliyor: 0, isleniyor: 0, hata: 0 }, rows: [] };
  if (pathname === "/api/reports/summary") return { conversation_count: 0, order_count: 0, shipment_count: 0, total_revenue: 0, currency: "TRY", open_conversation_count: 0, pending_confirmation_count: 0, active_shipment_count: 0, delivered_shipment_count: 0, delivered_shipment_rate: 0, confirmation_rate: 0, active_shipment_rate: 0 };
  if (pathname === "/api/webphone/config") return { enabled: false, sip_username: null, sip_password_configured: false, ws_url: null, domain: null, stun: null };
  return undefined;
}

