import { expect, type Page, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

const backendBaseUrl = "http://127.0.0.1:65530";

test.setTimeout(60_000);

interface PlaywrightUser {
  public_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  permissions: string[];
  is_online: boolean;
  sip_username: string;
}

declare global {
  interface Window {
    __GARANTI_REALTIME_TEST__?: {
      emitted: Array<{ event: string; payload: unknown }>;
      emitServer: (event: string, payload: unknown) => void;
    };
  }
}

async function startWebApp() {
  const server = await createServer({
    root: "apps/web",
    configFile: "apps/web/vite.config.ts",
    server: {
      host: "127.0.0.1",
      port: 0,
    },
    define: {
      "import.meta.env.VITE_BACKEND_BASE_URL": JSON.stringify(backendBaseUrl),
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("Vite dev server did not expose a TCP address");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    server,
  };
}

async function closeWebApp(server: ViteDevServer) {
  await server.close();
}

test("calisan Mesajlar temel parity actions go through backend API and Socket.IO", async ({ page }) => {
  const app = await startWebApp();
  const statePayloads: unknown[] = [];
  const conversationQueryUrls: string[] = [];
  let user = loginUser({ role: "calisan", email: "calisan@example.com", permissions: [] });
  let conversationUnreadCount = 2;
  let conversationHumanAgent = false;
  let conversationInPool = true;
  let conversationAssignedUserEmail: string | null = null;
  let realtimeDelivered = false;
  let sentBody: string | null = null;

  await installRealtimeShim(page);

  await page.route(`${backendBaseUrl}/**`, async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === "/auth/login") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(loginBody(user)) });
      return;
    }
    if (url.pathname === "/auth/me") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(user) });
      return;
    }
    if (url.pathname === "/auth/presence") {
      const payload = JSON.parse(route.request().postData() ?? "{}") as { online?: boolean };
      user = { ...user, is_online: Boolean(payload.online) };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(user) });
      return;
    }

    if (url.pathname === "/api/conversations") {
      conversationQueryUrls.push(`${url.pathname}${url.search}`);
      const requestedChannels = url.searchParams.get("channel")?.split(",").filter(Boolean);
      const requestedStatus = url.searchParams.get("status");
      const rows = [conversationRow(), facebookRow()].filter((conversation) => {
        const channelMatches = !requestedChannels?.length || requestedChannels.includes(conversation.channel);
        const statusMatches = !requestedStatus || conversation.status === requestedStatus;
        return channelMatches && statusMatches;
      });
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: rows }) });
      return;
    }
    if (url.pathname === "/api/conversations/summary") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          total_count: 2,
          unread_count: conversationUnreadCount,
          pool_count: conversationInPool ? 1 : 0,
          human_agent_count: conversationHumanAgent ? 1 : 0,
          channel_counts: { instagram: 1, facebook: 1 },
          status_counts: { open: 1, closed: 1 },
        }),
      });
      return;
    }
    if (url.pathname === "/api/conversations/cnv_slice/messages") {
      if (route.request().method() === "POST") {
        const payload = JSON.parse(route.request().postData() ?? "{}") as { body?: string | null; sender_type?: string };
        expect(payload.sender_type).toBe("user");
        sentBody = payload.body ?? null;
        await route.fulfill({
          contentType: "application/json",
          status: 201,
          body: JSON.stringify({
            public_id: "msg_slice_reply",
            sender_type: "user",
            sender_name: user.email,
            body: payload.body,
            external_message_id: null,
            is_read: true,
            sent_at: "2026-01-01T00:02:00.000Z",
          }),
        });
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            messageRow("msg_slice_1", "customer", "Slice Müşteri", "Merhaba"),
            ...(sentBody ? [messageRow("msg_slice_reply", "user", user.email, sentBody, "2026-01-01T00:02:00.000Z")] : []),
            ...(realtimeDelivered
              ? [messageRow("msg_socketio_slice", "customer", "Slice Müşteri", "Socket.IO canlı mesaj", "2026-01-01T00:03:00.000Z")]
              : []),
          ],
        }),
      });
      return;
    }
    if (url.pathname === "/api/conversations/cnv_facebook_slice/messages") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [] }) });
      return;
    }
    if (url.pathname === "/api/conversations/cnv_slice/state") {
      const payload = JSON.parse(route.request().postData() ?? "{}") as {
        unread_count?: number;
        human_agent_enabled?: boolean;
        is_in_pool?: boolean;
        assign_to_me?: boolean;
      };
      statePayloads.push(payload);
      if (payload.unread_count !== undefined) conversationUnreadCount = payload.unread_count;
      if (payload.human_agent_enabled !== undefined) conversationHumanAgent = payload.human_agent_enabled;
      if (payload.is_in_pool !== undefined) conversationInPool = payload.is_in_pool;
      if (payload.assign_to_me === true) conversationAssignedUserEmail = user.email;
      if (payload.assign_to_me === false) conversationAssignedUserEmail = null;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(conversationRow()) });
      return;
    }

    const fallback = fallbackResponse(url.pathname);
    if (fallback !== undefined) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(fallback) });
      return;
    }

    await route.fulfill({ status: 404, body: "not found" });
  });

  try {
    await page.goto(`${app.url}/giris`);
    await page.getByRole("button", { name: /giriş yap/i }).click();
    await expect(page.getByTestId("inbox-flow")).toContainText("Slice Müşteri");

    await page.getByTestId("channel-filter").selectOption("facebook");
    await expect(page.getByTestId("conversation-list")).toContainText("Facebook Slice");
    await page.getByTestId("status-filter").selectOption("open");
    await expect(page.getByTestId("conversation-list")).not.toContainText("Facebook Slice");
    await page.getByTestId("status-filter").selectOption("all");
    await page.getByTestId("channel-filter").selectOption("instagram");
    await expect(page.getByTestId("conversation-list")).toContainText("Slice Müşteri");
    expect(conversationQueryUrls).toEqual(
      expect.arrayContaining([
        "/api/conversations?limit=20",
        "/api/conversations?channel=facebook%2Cmessenger&limit=20",
        "/api/conversations?channel=facebook%2Cmessenger&status=open&limit=20",
        "/api/conversations?channel=instagram&limit=20",
      ]),
    );

    await page.getByTestId("conversation-row").first().click();
    await expect(page.getByTestId("message-scroll-area")).toContainText("Merhaba");
    await page.getByTestId("message-input").fill("Temel parity cevabı");
    await page.getByTestId("message-send-button").click();
    await expect(page.getByTestId("message-scroll-area")).toContainText("Temel parity cevabı");
    expect(sentBody).toBe("Temel parity cevabı");

    await page.getByTestId("mark-read-button").click();
    await expect(page.getByTestId("conversation-detail")).toContainText(/Okunmamış\s*0/);
    await page.getByTestId("human-agent-toggle").click();
    await expect(page.getByTestId("human-agent-toggle")).toHaveText("Human agent kapat");
    await page.getByTestId("pool-toggle").click();
    await expect(page.getByTestId("conversation-detail")).toContainText("calisan@example.com");
    await page.getByTestId("pool-toggle").click();
    await expect(page.getByTestId("conversation-detail")).toContainText("havuz");
    expect(statePayloads).toEqual(
      expect.arrayContaining([
        { unread_count: 0 },
        { human_agent_enabled: true },
        { assign_to_me: true, is_in_pool: false },
        { assign_to_me: false, is_in_pool: true },
      ]),
    );

    realtimeDelivered = true;
    await page.evaluate(() =>
      window.__GARANTI_REALTIME_TEST__?.emitServer("message.created", {
        event: "message.created",
        id: "evt_socketio_slice",
        occurred_at: "2026-01-01T00:03:00.000Z",
        payload: {
          message_public_id: "msg_socketio_slice",
          conversation_public_id: "cnv_slice",
          sender_type: "customer",
        },
      }),
    );
    await expect(page.getByTestId("message-scroll-area")).toContainText("Socket.IO canlı mesaj");
    await expect(page.getByText("Yeni mesaj Socket.IO üzerinden alındı")).toBeVisible();
  } finally {
    await closeWebApp(app.server);
  }

  function conversationRow() {
    return {
      public_id: "cnv_slice",
      channel: "instagram",
      status: "open",
      is_in_pool: conversationInPool,
      human_agent_enabled: conversationHumanAgent,
      unread_count: conversationUnreadCount,
      last_message_text: realtimeDelivered ? "Socket.IO canlı mesaj" : sentBody ?? "Merhaba",
      last_message_sender_type: realtimeDelivered ? "customer" : sentBody ? "user" : "customer",
      last_message_at: realtimeDelivered ? "2026-01-01T00:03:00.000Z" : "2026-01-01T00:00:00.000Z",
      customer: { full_name: "Slice Müşteri", phone: "5550000000" },
      assigned_user_email: conversationAssignedUserEmail,
      updated_at: "2026-01-01T00:04:00.000Z",
    };
  }
});

function facebookRow() {
  return {
    public_id: "cnv_facebook_slice",
    channel: "facebook",
    status: "closed",
    is_in_pool: false,
    human_agent_enabled: false,
    unread_count: 0,
    last_message_text: "Cevaplandı",
    last_message_sender_type: "user",
    last_message_at: "2026-01-01T00:01:00.000Z",
    customer: { full_name: "Facebook Slice", phone: "5552222222" },
    assigned_user_email: "calisan@example.com",
    updated_at: "2026-01-01T00:01:00.000Z",
  };
}

function messageRow(public_id: string, sender_type: string, sender_name: string, body: string, sent_at = "2026-01-01T00:00:00.000Z") {
  return {
    public_id,
    sender_type,
    sender_name,
    body,
    external_message_id: null,
    is_read: sender_type !== "customer",
    sent_at,
  };
}

function fallbackResponse(pathname: string) {
  const emptyData = { data: [] };
  if (pathname === "/api/customers") return emptyData;
  if (pathname === "/api/customers/summary") return { total_count: 0, with_phone_count: 0, with_email_count: 0, with_notes_count: 0 };
  if (pathname === "/api/comments/moderation-summary") return { manual_queue: 0, automatic_queue: 0, answered: 0, instagram: 0, facebook: 0 };
  if (pathname === "/api/balances/summary") return { total_commission: 0, total_deduction: 0, pending_payment: 0, available_balance: 0, pending_request_count: 0 };
  if (pathname === "/api/orders") return emptyData;
  if (pathname === "/api/orders/summary") return { total_count: 0, active_count: 0, delivered_count: 0, pending_confirmation_count: 0, total_revenue: 0, currency: "TRY" };
  if (pathname === "/api/products") return emptyData;
  if (pathname === "/api/products/summary") return { total_count: 0, active_count: 0, critical_count: 0, critical_threshold: 3, category_counts: { incubator: 0, spare_part: 0, other: 0 } };
  if (pathname === "/api/shipments") return emptyData;
  if (pathname === "/api/shipments/summary") return { total_count: 0, active_count: 0, delivered_count: 0, recipient_phone_count: 0, provider_counts: { ptt: 0, surat: 0, other: 0 }, exception_counts: { ptt_not_delivered: 0, surat_not_delivered: 0, tracking_missing: 0 } };
  if (pathname === "/api/shipments/pipeline-summary") return { counts: { all: 0, mesaj: 0, sms: 0, vapi: 0, teslim: 0, bekliyor: 0, isleniyor: 0, hata: 0 }, rows: [] };
  if (pathname === "/api/reports/summary") return { conversation_count: 0, order_count: 0, shipment_count: 0, total_revenue: 0, currency: "TRY", open_conversation_count: 0, pending_confirmation_count: 0, active_shipment_count: 0, delivered_shipment_count: 0, delivered_shipment_rate: 0, confirmation_rate: 0, active_shipment_rate: 0 };
  if (pathname === "/api/webphone/config") return { enabled: false, sip_username: null, sip_password_configured: false, ws_url: null, domain: null, stun: null };
  return undefined;
}

async function installRealtimeShim(page: Page) {
  await page.addInitScript(`
    (() => {
      const emitted = [];
      const sockets = [];
      window.__GARANTI_REALTIME_TEST__ = {
        emitted,
        emitServer(event, payload) {
          for (const socket of sockets) {
            for (const listener of socket.listeners[event] || []) listener(payload);
          }
        }
      };
      window.__GARANTI_REALTIME_SOCKET_FACTORY__ = () => {
        const socket = {
          listeners: {},
          connect() { emitted.push({ event: "connect", payload: null }); },
          disconnect() { emitted.push({ event: "disconnect", payload: null }); },
          emit(event, payload) { emitted.push({ event, payload }); },
          on(event, listener) {
            socket.listeners[event] = socket.listeners[event] || [];
            socket.listeners[event].push(listener);
          },
          off(event, listener) {
            socket.listeners[event] = (socket.listeners[event] || []).filter((candidate) => candidate !== listener);
          }
        };
        sockets.push(socket);
        return socket;
      };
    })();
  `);
}

function loginUser(overrides: Partial<PlaywrightUser> = {}): PlaywrightUser {
  return {
    public_id: "usr_messages_slice",
    email: "calisan@example.com",
    first_name: "Çalışan",
    last_name: "Kullanıcı",
    role: "calisan",
    permissions: [],
    is_online: true,
    sip_username: "1002",
    ...overrides,
  };
}

function loginBody(user: PlaywrightUser) {
  return {
    access_token: "messages-slice-token",
    refresh_token: "messages-slice-refresh-token",
    token_type: "Bearer",
    expires_in: 900,
    user,
  };
}
