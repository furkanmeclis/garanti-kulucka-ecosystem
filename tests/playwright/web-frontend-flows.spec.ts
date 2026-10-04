import { expect, type Page, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

const backendBaseUrl = "http://127.0.0.1:65530";

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

test("real frontend shell uses backend auth, domain, file, and webphone APIs", async ({ page }) => {
  const app = await startWebApp();
  const requestedUrls: string[] = [];
  const allRequestUrls: string[] = [];
  const frontendErrors: string[] = [];
  const conversationQueryUrls: string[] = [];
  const orderQueryUrls: string[] = [];
  const shipmentQueryUrls: string[] = [];
  let currentUser = loginUser();
  let savedIntegrationToken = false;
  let savedIntegrationSetting = false;
  let savedNetgsmSetting = false;
  let savedSipConfig = false;
  let savedOperationalPolicy = false;
  let realtimeMessageDelivered = false;
  let facebookRealtimeDelivered = false;
  let conversationUnreadCount = 2;
  let conversationInPool = true;
  let conversationHumanAgent = false;
  let conversationAssignedUserEmail: string | null = null;
  let conversationOrderCreated = false;
  let cancellationApproved = false;
  let cancellationPayload: { status?: string; notes?: string | null } | null = null;
  let smsSendPayload: {
    recipient_phone?: string;
    message?: string;
    shipment_public_id?: string;
    idempotency_key?: string;
  } | null = null;
  let paymentRequestPayload: {
    amount?: string;
    currency?: string;
    idempotency_key?: string;
  } | null = null;
  let cronTriggerPayload: {
    provider?: string;
    idempotency_key?: string;
  } | null = null;
  let instagramPublishPayload: {
    account_public_id?: string | null;
    image_url?: string;
    caption?: string;
    idempotency_key?: string;
  } | null = null;
  let vapiTestCallPayload: {
    customer_name?: string;
    customer_phone?: string;
    cargo_provider?: string;
    tracking_number?: string;
    last_event_text?: string;
    idempotency_key?: string;
  } | null = null;
  let orphanCleanupDryRunPayload: {
    reason?: string | null;
  } | null = null;
  let suratShipmentStatus = "in_transit";
  let suratShipmentLastEvent = "Selected shipment at branch";

  page.on("pageerror", (error) => {
    frontendErrors.push(error.message);
  });

  await page.addInitScript(`
    (() => {
      const emitted = [];
      const sockets = [];
      window.__GARANTI_REALTIME_TEST__ = {
        emitted,
        emitServer(event, payload) {
          for (const socket of sockets) {
            const listeners = socket.listeners.get(event) ?? [];
            for (const listener of listeners) listener(payload);
          }
        },
      };
      window.__GARANTI_REALTIME_SOCKET_FACTORY__ = (_url, _options) => {
        const socket = {
          listeners: new Map(),
          connect() {
            emitted.push({ event: "connect", payload: null });
            return socket;
          },
          disconnect() {
            emitted.push({ event: "disconnect", payload: null });
            return socket;
          },
          on(event, listener) {
            const listeners = socket.listeners.get(event) ?? [];
            listeners.push(listener);
            socket.listeners.set(event, listeners);
            return socket;
          },
          off(event, listener) {
            if (!listener) {
              socket.listeners.delete(event);
              return socket;
            }
            const listeners = socket.listeners.get(event) ?? [];
            socket.listeners.set(event, listeners.filter((item) => item !== listener));
            return socket;
          },
          emit(event, payload) {
            emitted.push({ event, payload });
            return socket;
          },
        };
        sockets.push(socket);
        return socket;
      };
    })();
  `);

  page.on("request", (request) => {
    allRequestUrls.push(request.url());
  });

  await page.route(`${backendBaseUrl}/**`, async (route) => {
    const url = new URL(route.request().url());
    requestedUrls.push(url.pathname);

    if (url.pathname === "/auth/login") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(loginBody(currentUser)),
      });
      return;
    }

    if (url.pathname === "/auth/me") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(currentUser),
      });
      return;
    }

    if (url.pathname === "/auth/logout") {
      currentUser = { ...currentUser, is_online: false };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ status: "ok" }),
      });
      return;
    }

    if (url.pathname === "/auth/presence") {
      const payload = JSON.parse(route.request().postData() ?? "{}") as { online?: boolean };
      currentUser = { ...currentUser, is_online: Boolean(payload.online) };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(currentUser),
      });
      return;
    }

    if (url.pathname === "/api/comments/moderation-summary") {
      expect(["admin", "calisan"].includes(currentUser.role)).toBe(true);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          manual_queue: 7,
          automatic_queue: 3,
          answered: 11,
          instagram: 5,
          facebook: 2,
        }),
      });
      return;
    }

    if (url.pathname === "/api/conversations") {
      conversationQueryUrls.push(`${url.pathname}${url.search}`);
      const conversations = [
        {
          public_id: "cnv_playwright",
          channel: "instagram",
          status: "open",
          is_in_pool: conversationInPool,
          human_agent_enabled: conversationHumanAgent,
          unread_count: realtimeMessageDelivered ? conversationUnreadCount + 1 : conversationUnreadCount,
          last_message_text: realtimeMessageDelivered ? "Socket.IO canlı mesaj" : "Merhaba",
          last_message_sender_type: "customer",
          last_message_at: realtimeMessageDelivered ? "2026-01-01T00:01:30.000Z" : "2026-01-01T00:00:00.000Z",
          customer: { full_name: "Playwright Customer", phone: "5550000000" },
          assigned_user_email: conversationAssignedUserEmail,
          updated_at: realtimeMessageDelivered ? "2026-01-01T00:01:30.000Z" : "2026-01-01T00:00:00.000Z",
        },
        {
          public_id: "cnv_facebook_playwright",
          channel: "facebook",
          status: "closed",
          is_in_pool: false,
          human_agent_enabled: false,
          unread_count: facebookRealtimeDelivered ? 1 : 0,
          last_message_text: facebookRealtimeDelivered ? "Facebook broadcast mesajı" : "Cevaplandı",
          last_message_sender_type: "user",
          last_message_at: facebookRealtimeDelivered ? "2026-01-01T00:01:10.000Z" : "2026-01-01T00:00:30.000Z",
          customer: { full_name: "Facebook Customer", phone: "5552222222" },
          assigned_user_email: "admin@example.com",
          updated_at: facebookRealtimeDelivered ? "2026-01-01T00:01:10.000Z" : "2026-01-01T00:00:30.000Z",
        },
      ];
      const requestedChannels = url.searchParams.get("channel")?.split(",").filter(Boolean);
      const requestedStatus = url.searchParams.get("status");
      const filteredConversations = conversations.filter((conversation) => {
        const channelMatches = !requestedChannels?.length || requestedChannels.includes(conversation.channel);
        const statusMatches = !requestedStatus || conversation.status === requestedStatus;
        return channelMatches && statusMatches;
      });
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: filteredConversations,
        }),
      });
      return;
    }

    if (url.pathname === "/api/conversations/cnv_playwright/state") {
      expect(route.request().method()).toBe("PATCH");
      const payload = JSON.parse(route.request().postData() ?? "{}") as {
        unread_count?: number;
        human_agent_enabled?: boolean;
        is_in_pool?: boolean;
        assign_to_me?: boolean;
      };
      if (payload.unread_count !== undefined) conversationUnreadCount = payload.unread_count;
      if (payload.human_agent_enabled !== undefined) conversationHumanAgent = payload.human_agent_enabled;
      if (payload.is_in_pool !== undefined) conversationInPool = payload.is_in_pool;
      if (payload.assign_to_me === true) conversationAssignedUserEmail = "admin@example.com";
      if (payload.assign_to_me === false) conversationAssignedUserEmail = null;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          public_id: "cnv_playwright",
          channel: "instagram",
          status: "open",
          is_in_pool: conversationInPool,
          human_agent_enabled: conversationHumanAgent,
          unread_count: conversationUnreadCount,
          last_message_text: realtimeMessageDelivered ? "Socket.IO canlı mesaj" : "Merhaba",
          last_message_sender_type: "customer",
          last_message_at: realtimeMessageDelivered ? "2026-01-01T00:01:30.000Z" : "2026-01-01T00:00:00.000Z",
          customer: { full_name: "Playwright Customer", phone: "5550000000" },
          assigned_user_email: conversationAssignedUserEmail,
          updated_at: "2026-01-01T00:02:00.000Z",
        }),
      });
      return;
    }

    if (url.pathname === "/api/customers") {
      expect(currentUser.role).not.toBe("kargo_operatoru");
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              public_id: "cus_playwright",
              full_name: "Playwright Customer",
              phone: "5550000000",
              email: "playwright@example.com",
              username: "playwright_customer",
              notes: "VIP kuluçka müşterisi",
              updated_at: "2026-01-01T00:00:00.000Z",
            },
            {
              public_id: "cus_facebook",
              full_name: "Facebook Customer",
              phone: null,
              email: "facebook@example.com",
              username: "facebook_customer",
              notes: null,
              updated_at: "2026-01-01T00:00:30.000Z",
            },
          ],
        }),
      });
      return;
    }

    if (url.pathname === "/api/conversations/cnv_playwright/messages") {
      if (route.request().method() === "POST") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            public_id: "msg_playwright_reply",
            sender_type: "user",
            sender_name: "admin@example.com",
            body: "Backend UI yaniti",
            external_message_id: null,
            is_read: true,
            sent_at: "2026-01-01T00:01:00.000Z",
          }),
        });
        return;
      }

      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              public_id: "msg_playwright_1",
              sender_type: "customer",
              sender_name: "Playwright Customer",
              body: "Merhaba",
              external_message_id: "external_msg_1",
              is_read: false,
              sent_at: "2026-01-01T00:00:00.000Z",
            },
            ...(realtimeMessageDelivered
              ? [
                  {
                    public_id: "msg_socketio_live",
                    sender_type: "customer",
                    sender_name: "Playwright Customer",
                    body: "Socket.IO canlı mesaj",
                    external_message_id: "external_msg_socketio",
                    is_read: false,
                    sent_at: "2026-01-01T00:01:30.000Z",
                  },
                ]
              : []),
          ],
        }),
      });
      return;
    }

    if (url.pathname === "/api/conversations/cnv_facebook_playwright/messages") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              public_id: "msg_facebook_1",
              sender_type: "user",
              sender_name: "admin@example.com",
              body: "Cevaplandı",
              external_message_id: "external_msg_facebook",
              is_read: true,
              sent_at: "2026-01-01T00:00:30.000Z",
            },
          ],
        }),
      });
      return;
    }

    if (url.pathname === "/api/orders") {
      if (route.request().method() === "POST") {
        const payload = JSON.parse(route.request().postData() ?? "{}") as {
          conversation_public_id?: string | null;
          order_number?: string;
          notes?: string | null;
        };
        if (payload.order_number === "ORD-WEB-CHAT") {
          expect(payload.conversation_public_id).toBe("cnv_playwright");
          expect(payload.notes).toBe("Frontend conversation order smoke");
          conversationOrderCreated = true;
        }
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            public_id: payload.order_number === "ORD-WEB-CHAT" ? "ord_web_chat" : "ord_web_new",
            order_number: payload.order_number ?? "ORD-WEB-NEW",
            status: "draft",
            source: "manual",
            total_amount: "250.00",
            currency: "TRY",
            confirmation_status: null,
            notes: payload.notes ?? "Frontend backend create smoke",
            customer_full_name: "Playwright Customer",
            created_at: "2026-01-01T00:02:00.000Z",
            updated_at: "2026-01-01T00:02:00.000Z",
          }),
        });
        return;
      }

      orderQueryUrls.push(`${url.pathname}${url.search}`);
      const orders = [
        {
          public_id: "ord_playwright",
          order_number: "ORD-PLAYWRIGHT",
          status: "draft",
          source: "manual",
          total_amount: "125.50",
          currency: "TRY",
          confirmation_status: null,
          notes: "fixture order",
          customer_full_name: "Playwright Customer",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        {
          public_id: "ord_delivered_playwright",
          order_number: "ORD-DELIVERED",
          status: "delivered",
          source: "manual",
          total_amount: "75.00",
          currency: "TRY",
          confirmation_status: "confirmed",
          notes: "delivered fixture order",
          customer_full_name: "Delivered Customer",
          created_at: "2026-01-01T00:03:00.000Z",
          updated_at: "2026-01-01T00:03:00.000Z",
        },
      ];
      const requestedStatus = url.searchParams.get("status");
      const requestedConfirmationStatus = url.searchParams.get("confirmation_status");
      const filteredOrders = orders.filter((order) => {
        const statusMatches =
          !requestedStatus ||
          (requestedStatus === "active"
            ? !["cancelled", "returned", "delivered"].includes(order.status)
            : order.status === requestedStatus);
        const confirmationMatches =
          !requestedConfirmationStatus ||
          (requestedConfirmationStatus === "pending"
            ? order.confirmation_status === null
            : order.confirmation_status === requestedConfirmationStatus);
        return statusMatches && confirmationMatches;
      });
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: filteredOrders,
        }),
      });
      return;
    }

    if (url.pathname === "/api/orders/ord_playwright/payment-request") {
      paymentRequestPayload = JSON.parse(route.request().postData() ?? "{}") as {
        amount?: string;
        currency?: string;
        idempotency_key?: string;
      };
      await route.fulfill({
        contentType: "application/json",
        status: 202,
        body: JSON.stringify({
          provider: "kolaybi",
          operation: "balance.payment_request",
          request_id: "payreq_payment_ord_playwright_12_55_try",
          queued: false,
          live_call_permitted: false,
          replayed: false,
          order_public_id: "ord_playwright",
          amount: paymentRequestPayload.amount,
          currency: paymentRequestPayload.currency,
          order: {
            public_id: "ord_playwright",
            order_number: "ORD-PLAYWRIGHT",
            status: "draft",
            source: "manual",
            total_amount: "125.50",
            currency: "TRY",
            confirmation_status: null,
            notes: null,
            customer_full_name: "Playwright Customer",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:05:00.000Z",
          },
        }),
      });
      return;
    }

    if (url.pathname === "/api/orders/ord_playwright/status") {
      const payload = JSON.parse(route.request().postData() ?? "{}") as {
        status?: string;
        notes?: string | null;
      };
      cancellationPayload = payload;
      cancellationApproved = true;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          public_id: "ord_playwright",
          order_number: "ORD-PLAYWRIGHT",
          status: "cancelled",
          source: "manual",
          total_amount: "125.50",
          currency: "TRY",
          confirmation_status: null,
          notes: payload.notes,
          customer_full_name: "Playwright Customer",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:04:00.000Z",
        }),
      });
      return;
    }

    if (url.pathname === "/api/shipments/shp_playwright/status") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          public_id: "shp_playwright",
          provider: "ptt",
          tracking_number: "TRK-PLAYWRIGHT",
          barcode_number: "BAR-PLAYWRIGHT",
          status: "delivered",
          recipient_name: "Playwright Customer",
          recipient_phone: "5550000000",
          recipient_city: "Istanbul",
          recipient_district: "Kadikoy",
          last_event_text: "Frontend teslim kaniti",
          order_number: "ORD-PLAYWRIGHT",
          customer_full_name: "Playwright Customer",
          updated_at: "2026-01-01T00:02:00.000Z",
        }),
      });
      return;
    }

    if (url.pathname === "/api/shipments/shp_surat_playwright/status") {
      suratShipmentStatus = "delivered";
      suratShipmentLastEvent = "Selected shipment delivered";
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          public_id: "shp_surat_playwright",
          provider: "Sürat",
          tracking_number: "TRK-SURAT-PLAYWRIGHT",
          barcode_number: "BAR-SURAT-PLAYWRIGHT",
          status: suratShipmentStatus,
          recipient_name: "Surat Playwright Customer",
          recipient_phone: "5551111111",
          recipient_city: "Ankara",
          recipient_district: "Cankaya",
          last_event_text: suratShipmentLastEvent,
          order_number: "ORD-SURAT-PLAYWRIGHT",
          customer_full_name: "Surat Playwright Customer",
          updated_at: "2026-01-01T00:02:00.000Z",
        }),
      });
      return;
    }

    if (url.pathname === "/api/shipments") {
      shipmentQueryUrls.push(`${url.pathname}${url.search}`);
      const shipments = [
        {
          public_id: "shp_playwright",
          provider: "ptt",
          tracking_number: "TRK-PLAYWRIGHT",
          barcode_number: "BAR-PLAYWRIGHT",
          status: "in_transit",
          recipient_name: "Playwright Customer",
          recipient_phone: "5550000000",
          recipient_city: "Istanbul",
          recipient_district: "Kadikoy",
          last_event_text: "Accepted at branch",
          order_number: "ORD-PLAYWRIGHT",
          customer_full_name: "Playwright Customer",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        {
          public_id: "shp_surat_playwright",
          provider: "Sürat",
          tracking_number: "TRK-SURAT-PLAYWRIGHT",
          barcode_number: "BAR-SURAT-PLAYWRIGHT",
          status: suratShipmentStatus,
          recipient_name: "Surat Playwright Customer",
          recipient_phone: "5551111111",
          recipient_city: "Ankara",
          recipient_district: "Cankaya",
          last_event_text: suratShipmentLastEvent,
          order_number: "ORD-SURAT-PLAYWRIGHT",
          customer_full_name: "Surat Playwright Customer",
          updated_at: "2026-01-01T00:01:00.000Z",
        },
        {
          public_id: "shp_message_playwright",
          provider: "KolayBi",
          tracking_number: "TRK-MESSAGE-PLAYWRIGHT",
          barcode_number: "BAR-MESSAGE-PLAYWRIGHT",
          status: "in_transit",
          recipient_name: "Message Step Customer",
          recipient_phone: null,
          recipient_city: "Izmir",
          recipient_district: "Konak",
          last_event_text: "Waiting for message contact",
          order_number: "ORD-MESSAGE-PLAYWRIGHT",
          customer_full_name: "Message Step Customer",
          updated_at: "2026-01-01T00:02:00.000Z",
        },
        {
          public_id: "shp_surat_sms_playwright",
          provider: "Surat",
          tracking_number: "TRK-SMS-PLAYWRIGHT",
          barcode_number: "BAR-SMS-PLAYWRIGHT",
          status: "in_transit",
          recipient_name: "SMS Step Customer",
          recipient_phone: "5552222222",
          recipient_city: "Bursa",
          recipient_district: "Nilufer",
          last_event_text: "SMS step waiting",
          order_number: "ORD-SMS-PLAYWRIGHT",
          customer_full_name: "SMS Step Customer",
          updated_at: "2026-01-01T00:03:00.000Z",
        },
      ];
      const requestedProvider = url.searchParams.get("provider");
      const requestedStatus = url.searchParams.get("status");
      const trackingMissing = url.searchParams.get("tracking_missing") === "true";
      const filteredShipments = shipments.filter((shipment) => {
        const normalizedProvider = shipment.provider.toLocaleLowerCase("tr-TR");
        const providerMatches =
          !requestedProvider ||
          (requestedProvider === "surat"
            ? normalizedProvider.includes("sürat") || normalizedProvider.includes("surat")
            : requestedProvider === "other"
              ? !normalizedProvider.includes("ptt") && !normalizedProvider.includes("sürat") && !normalizedProvider.includes("surat")
              : normalizedProvider.includes(requestedProvider));
        const statusMatches = !requestedStatus || shipment.status === requestedStatus;
        const trackingMatches = !trackingMissing || (!shipment.tracking_number && !shipment.barcode_number);
        return providerMatches && statusMatches && trackingMatches;
      });
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: filteredShipments,
        }),
      });
      return;
    }

    if (url.pathname === "/api/products") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              public_id: "prd_incubator",
              sku: "SKU-KUL-56",
              name: "Kuluçka Pro 56",
              category: "incubator",
              unit_price: "1250.00",
              stock_quantity: 7,
              is_active: true,
              external_product_id: "kb_prd_56",
              updated_at: "2026-01-01T00:00:00.000Z",
            },
            {
              public_id: "prd_fan",
              sku: "SKU-FAN",
              name: "Yedek Fan",
              category: "spare_part",
              unit_price: "85.00",
              stock_quantity: 0,
              is_active: true,
              external_product_id: "kb_fan",
              updated_at: "2026-01-01T00:00:00.000Z",
            },
            {
              public_id: "prd_meter",
              sku: "SKU-METER",
              name: "Nem Ölçer",
              category: "other",
              unit_price: "40.00",
              stock_quantity: 2,
              is_active: false,
              external_product_id: "kb_meter",
              updated_at: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      });
      return;
    }

    if (url.pathname === "/admin/settings") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              key: "webphone.enabled",
              scope: "global",
              value: true,
              is_secret: false,
              updated_at: "2026-01-01T00:00:00.000Z",
            },
            {
              key: "sip_config",
              scope: "global",
              value: {
                ws_url: "wss://sip.example.com/ws",
                domain: "sip.example.com",
                stun: "stun:stun.l.google.com:19302",
              },
              is_secret: false,
              updated_at: "2026-01-01T00:00:00.000Z",
            },
            {
              key: "netgsm_teyit_ayarlar",
              scope: "global",
              value: {
                aktif: savedNetgsmSetting,
                ilk_arama_dakika: 5,
                max_deneme: 3,
                deneme_arasi_dakika: 10,
              },
              is_secret: false,
              updated_at: "2026-01-01T00:00:00.000Z",
            },
            {
              key: "operations.policy",
              scope: "global",
              value: savedOperationalPolicy
                ? {
                    max_attempts: 5,
                    retry_delay_ms: 45000,
                    request_timeout_ms: 12000,
                    webhook_timeout_ms: 6000,
                    provider_rate_limit_per_minute: 90,
                    queue_concurrency: 6,
                    storage_bucket: "garage-media",
                    lifecycle_days: 120,
                    orphan_cleanup_enabled: true,
                  }
                : {
                    max_attempts: 3,
                    retry_delay_ms: 30000,
                    request_timeout_ms: 10000,
                    webhook_timeout_ms: 5000,
                    provider_rate_limit_per_minute: 60,
                    queue_concurrency: 4,
                    storage_bucket: "garage-media",
                    lifecycle_days: 90,
                    orphan_cleanup_enabled: true,
                  },
              is_secret: false,
              updated_at: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      });
      return;
    }

    if (url.pathname === "/admin/settings/audit") {
      expect(currentUser.role).toBe("admin");
      expect(url.searchParams.get("limit")).toBe("10");
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: 901,
              actor_user_id: 1,
              action: "settings_change",
              entity_type: "settings",
              entity_id: "providers.ptt.live_mode",
              old_value: {
                value: false,
                provider_token: "raw-settings-audit-secret",
              },
              new_value: {
                value: true,
                access_token: "raw-settings-audit-secret",
              },
              ip_address: "127.0.0.1",
              user_agent: "Playwright",
              created_at: "2026-01-01T00:06:00.000Z",
            },
          ],
        }),
      });
      return;
    }

    if (url.pathname === "/admin/settings/sip_config") {
      expect(route.request().method()).toBe("PUT");
      savedSipConfig = true;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          key: "sip_config",
          scope: "global",
          value: {
            ws_url: "wss://sip.example.com/ws",
            domain: "sip.example.com",
            stun: "stun:stun.l.google.com:19302",
          },
          is_secret: false,
          updated_at: "2026-01-01T00:04:00.000Z",
        }),
      });
      return;
    }

    if (url.pathname === "/admin/settings/netgsm_teyit_ayarlar") {
      expect(route.request().method()).toBe("PUT");
      savedNetgsmSetting = true;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          key: "netgsm_teyit_ayarlar",
          scope: "global",
          value: {
            aktif: true,
            ilk_arama_dakika: 5,
            max_deneme: 3,
            deneme_arasi_dakika: 10,
          },
          is_secret: false,
          updated_at: "2026-01-01T00:03:00.000Z",
        }),
      });
      return;
    }

    if (url.pathname === "/admin/settings/operations.policy") {
      expect(route.request().method()).toBe("PUT");
      savedOperationalPolicy = true;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          key: "operations.policy",
          scope: "global",
          value: {
            max_attempts: 5,
            retry_delay_ms: 45000,
            request_timeout_ms: 12000,
            webhook_timeout_ms: 6000,
            provider_rate_limit_per_minute: 90,
            queue_concurrency: 6,
            storage_bucket: "garage-media",
            lifecycle_days: 120,
            orphan_cleanup_enabled: true,
          },
          is_secret: false,
          updated_at: "2026-01-01T00:08:00.000Z",
        }),
      });
      return;
    }

    if (url.pathname === "/admin/settings/providers.ptt.live_mode") {
      expect(route.request().method()).toBe("PUT");
      expect(route.request().postDataJSON()).toMatchObject({
        value: false,
        scope: "global",
        is_secret: false,
      });
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          key: "providers.ptt.live_mode",
          scope: "global",
          value: false,
          is_secret: false,
          updated_at: "2026-01-01T00:03:00.000Z",
        }),
      });
      return;
    }

    if (url.pathname === "/admin/integrations/accounts") {
      if (route.request().method() === "POST") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            public_id: "iac_instagram_playwright",
            provider_key: "instagram",
            provider_name: "Instagram",
            display_name: "Instagram Playwright",
            external_account_id: "ig_playwright",
            status: "active",
            metadata: { source: "frontend" },
            updated_at: "2026-01-01T00:04:00.000Z",
          }),
        });
        return;
      }

      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              public_id: "iac_instagram",
              provider_key: "instagram",
              provider_name: "Instagram",
              display_name: "Instagram Main",
              external_account_id: "ig_main",
              status: "active",
              metadata: {
                analytics: {
                  followers: 1240,
                  reach: 980,
                  impressions: 1450,
                  profile_views: 87,
                  engagement_rate: 6,
                },
              },
              updated_at: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      });
      return;
    }

    if (url.pathname === "/admin/integrations/audit") {
      expect(currentUser.role).toBe("admin");
      expect(url.searchParams.get("limit")).toBe("10");
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: 902,
              actor_user_id: 1,
              action: "integration_token_update",
              entity_type: "integration_tokens",
              entity_id: "iac_instagram/access_token",
              old_value: {
                value: null,
              },
              new_value: {
                token: "raw-integration-audit-secret",
                expires_at: null,
              },
              ip_address: "127.0.0.1",
              user_agent: "Playwright",
              created_at: "2026-01-01T00:07:00.000Z",
            },
          ],
        }),
      });
      return;
    }

    if (url.pathname === "/admin/integrations/provider-catalog") {
      expect(currentUser.role).toBe("admin");
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              provider: "ptt",
              channels: ["cargo"],
              supported_operations: ["shipment.create", "shipment.track"],
              contract_mode: "fixture_only",
              live_feature_flag_key: "providers.ptt.live_mode",
              live_call_permitted: false,
              live_block_reason: "fixture_replay_contract_required",
            },
            {
              provider: "surat",
              channels: ["cargo"],
              supported_operations: ["shipment.create", "shipment.track"],
              contract_mode: "fixture_only",
              live_feature_flag_key: "providers.surat.live_mode",
              live_call_permitted: false,
              live_block_reason: "fixture_replay_contract_required",
            },
            {
              provider: "kolaybi",
              channels: ["accounting"],
              supported_operations: ["invoice.create"],
              contract_mode: "fixture_only",
              live_feature_flag_key: "providers.kolaybi.live_mode",
              live_call_permitted: false,
              live_block_reason: "fixture_replay_contract_required",
            },
            {
              provider: "meta",
              channels: ["whatsapp", "instagram", "messenger"],
              supported_operations: ["message.webhook"],
              contract_mode: "fixture_only",
              live_feature_flag_key: "providers.meta.live_mode",
              live_call_permitted: false,
              live_block_reason: "fixture_replay_contract_required",
            },
            {
              provider: "whatsapp",
              channels: ["whatsapp"],
              supported_operations: ["message.webhook", "message.send"],
              contract_mode: "fixture_only",
              live_feature_flag_key: "providers.whatsapp.live_mode",
              live_call_permitted: false,
              live_block_reason: "fixture_replay_contract_required",
            },
            {
              provider: "instagram",
              channels: ["instagram"],
              supported_operations: ["message.webhook", "message.send"],
              contract_mode: "fixture_only",
              live_feature_flag_key: "providers.instagram.live_mode",
              live_call_permitted: false,
              live_block_reason: "fixture_replay_contract_required",
            },
            {
              provider: "messenger",
              channels: ["messenger"],
              supported_operations: ["message.webhook", "message.send"],
              contract_mode: "fixture_only",
              live_feature_flag_key: "providers.messenger.live_mode",
              live_call_permitted: false,
              live_block_reason: "fixture_replay_contract_required",
            },
            {
              provider: "netgsm",
              channels: ["sms"],
              supported_operations: ["sms.send"],
              contract_mode: "fixture_only",
              live_feature_flag_key: "providers.netgsm.live_mode",
              live_call_permitted: false,
              live_block_reason: "fixture_replay_contract_required",
            },
            {
              provider: "vapi",
              channels: ["voice"],
              supported_operations: ["call.webhook"],
              contract_mode: "fixture_only",
              live_feature_flag_key: "providers.vapi.live_mode",
              live_call_permitted: false,
              live_block_reason: "fixture_replay_contract_required",
            },
            {
              provider: "sip",
              channels: ["sip"],
              supported_operations: ["sip.config.sync"],
              contract_mode: "fixture_only",
              live_feature_flag_key: "providers.sip.live_mode",
              live_call_permitted: false,
              live_block_reason: "fixture_replay_contract_required",
            },
          ],
        }),
      });
      return;
    }

    if (url.pathname === "/admin/integrations/provider-attempts") {
      expect(currentUser.role).toBe("admin");
      expect(url.searchParams.get("limit")).toBe("10");
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              public_id: "pat_instagram_preview",
              provider_key: "instagram",
              account_public_id: "iac_instagram",
              request_id: "req_provider_preview",
              operation: "message.send",
              direction: "outbound",
              status: "failed",
              status_code: 429,
              duration_ms: 312,
              retry_decision: "retry",
              next_retry_at: "2026-01-01T00:10:00.000Z",
              idempotency_key: "msg_preview_1",
              request_metadata: {
                authorization: "[redacted]",
              },
              provider_request_preview: {
                method: "POST",
                path: "/v18.0/ig_main/media",
                headers: {
                  authorization: "Bearer raw-provider-secret",
                  "content-type": "application/json",
                },
                body: {
                  image_url: "https://example.com/garanti-kulucka.jpg",
                  access_token: "raw-provider-secret",
                  raw_secret: "raw-provider-secret",
                },
                live_call_performed: false,
              },
              response_metadata: {
                provider_token: "[redacted]",
              },
              error_code: "rate_limited",
              error_message: "fixture retry",
              started_at: "2026-01-01T00:00:00.000Z",
              updated_at: "2026-01-01T00:00:01.000Z",
            },
            {
              public_id: "pat_surat_debug",
              provider_key: "surat",
              account_public_id: null,
              request_id: "req_surat_debug",
              operation: "shipment.track",
              direction: "outbound",
              status: "failed",
              status_code: 503,
              duration_ms: 1450,
              retry_decision: "retry",
              next_retry_at: "2026-01-01T00:11:00.000Z",
              idempotency_key: "trk_surat_playwright",
              request_metadata: {
                authorization: "[redacted]",
              },
              provider_request_preview: {
                method: "POST",
                path: "/kargo-takip",
                headers: {
                  authorization: "Bearer raw-surat-secret",
                  "content-type": "application/json",
                },
                body: {
                  takip_no: "TRK-SURAT-PLAYWRIGHT",
                  api_key: "raw-surat-secret",
                },
                live_call_performed: false,
              },
              response_metadata: {
                provider_token: "[redacted]",
              },
              error_code: "surat_fixture_timeout",
              error_message: "fixture retry",
              started_at: "2026-01-01T00:00:02.000Z",
              updated_at: "2026-01-01T00:00:03.000Z",
            },
            {
              public_id: "pat_ptt_cron_debug",
              provider_key: "ptt",
              account_public_id: null,
              request_id: "req_ptt_cron_debug",
              operation: "shipment.track",
              direction: "outbound",
              status: "success",
              status_code: 200,
              duration_ms: 870,
              retry_decision: "none",
              next_retry_at: null,
              idempotency_key: "trk_ptt_playwright",
              request_metadata: {
                authorization: "[redacted]",
              },
              provider_request_preview: {
                method: "POST",
                path: "/kargo-takip",
                headers: {
                  authorization: "Bearer raw-ptt-secret",
                  "content-type": "application/json",
                },
                body: {
                  takip_no: "TRK-PLAYWRIGHT",
                  api_key: "raw-ptt-secret",
                },
                live_call_performed: false,
              },
              response_metadata: {
                provider_token: "[redacted]",
              },
              error_code: null,
              error_message: null,
              started_at: "2026-01-01T00:00:04.000Z",
              updated_at: "2026-01-01T00:00:05.000Z",
            },
          ],
        }),
      });
      return;
    }

    if (url.pathname === "/admin/integrations/provider-cron-triggers/ptt") {
      expect(currentUser.role).toBe("admin");
      expect(route.request().method()).toBe("POST");
      const payload = JSON.parse(route.request().postData() ?? "{}") as {
        idempotency_key?: string;
      };
      cronTriggerPayload = {
        provider: "ptt",
        idempotency_key: payload.idempotency_key,
      };
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          public_id: "pat_ptt_cron_manual",
          provider_key: "ptt",
          account_public_id: null,
          request_id: "cron_ptt_cron_debug_ptt_manual",
          operation: "shipment.track",
          direction: "outbound",
          status: "success",
          status_code: 202,
          duration_ms: 0,
          retry_decision: "none",
          next_retry_at: null,
          idempotency_key: payload.idempotency_key,
          request_metadata: {
            live_call_permitted: false,
          },
          provider_request_preview: {
            method: "POST",
            path: "/api/ptt/cron-debug",
            headers: {
              authorization: "[redacted]",
              "content-type": "application/json",
            },
            body: {
              action: "cron-takip-guncelle",
              provider_key: "ptt",
            },
            live_call_performed: false,
          },
          response_metadata: {
            mode: "dry_run",
            queued: false,
            live_call_permitted: false,
          },
          error_code: null,
          error_message: null,
          started_at: "2026-01-01T00:00:06.000Z",
          updated_at: "2026-01-01T00:00:06.000Z",
        }),
      });
      return;
    }

    if (url.pathname === "/admin/integrations/instagram-publish-previews") {
      expect(currentUser.role).toBe("admin");
      expect(route.request().method()).toBe("POST");
      const payload = JSON.parse(route.request().postData() ?? "{}") as {
        account_public_id?: string | null;
        image_url?: string;
        caption?: string;
        idempotency_key?: string;
      };
      instagramPublishPayload = payload;
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          public_id: "pat_instagram_publish_manual",
          provider_key: "instagram",
          account_public_id: payload.account_public_id ?? null,
          request_id: "igpub_instagram_publish_iac_instagram",
          operation: "message.send",
          direction: "outbound",
          status: "success",
          status_code: 202,
          duration_ms: 0,
          retry_decision: "none",
          next_retry_at: null,
          idempotency_key: payload.idempotency_key,
          request_metadata: {
            live_call_permitted: false,
          },
          provider_request_preview: {
            method: "POST",
            path: "/v18.0/ig_main/media",
            headers: {
              authorization: "[redacted]",
              "content-type": "application/json",
            },
            body: {
              image_url: payload.image_url,
              caption: payload.caption,
            },
            live_call_performed: false,
          },
          response_metadata: {
            mode: "dry_run",
            queued: false,
            live_call_permitted: false,
          },
          error_code: null,
          error_message: null,
          started_at: "2026-01-01T00:00:07.000Z",
          updated_at: "2026-01-01T00:00:07.000Z",
        }),
      });
      return;
    }

    if (url.pathname === "/admin/integrations/accounts/iac_instagram") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          account: {
            public_id: "iac_instagram",
            provider_key: "instagram",
            provider_name: "Instagram",
            display_name: "Instagram Main",
            external_account_id: "ig_main",
            status: "active",
            metadata: {
              analytics: {
                followers: 1240,
                reach: 980,
                impressions: 1450,
                profile_views: 87,
                engagement_rate: 6,
              },
            },
            updated_at: "2026-01-01T00:00:00.000Z",
          },
          settings: [
            {
              public_id: "ias_webhook",
              key: "webhook.enabled",
              value: savedIntegrationSetting,
              is_secret: false,
              updated_at: "2026-01-01T00:00:00.000Z",
            },
          ],
          tokens: savedIntegrationToken
            ? [
                {
                  public_id: "iat_access",
                  token_type: "access_token",
                  value: null,
                  expires_at: null,
                  last_refreshed_at: "2026-01-01T00:05:00.000Z",
                  updated_at: "2026-01-01T00:05:00.000Z",
                },
              ]
            : [],
        }),
      });
      return;
    }

    if (url.pathname === "/admin/integrations/accounts/iac_instagram/tokens/access_token") {
      expect(route.request().method()).toBe("PUT");
      savedIntegrationToken = true;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          public_id: "iat_access",
          token_type: "access_token",
          value: null,
        }),
      });
      return;
    }

    if (url.pathname === "/admin/integrations/accounts/iac_instagram/settings/webhook.enabled") {
      expect(route.request().method()).toBe("PUT");
      savedIntegrationSetting = true;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          public_id: "ias_webhook",
          key: "webhook.enabled",
          value: true,
          is_secret: false,
          updated_at: "2026-01-01T00:06:00.000Z",
        }),
      });
      return;
    }

    if (url.pathname === "/api/webphone/config") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          enabled: true,
          sip_websocket_url: "wss://sip.example.com/ws",
          sip_domain: "sip.example.com",
          sip_username: "1001",
          sip_password: null,
          ice_servers: [],
          media_proxy_enabled: false,
          transport: "direct_sip_over_webrtc",
        }),
      });
      return;
    }

    if (url.pathname === "/api/webphone/test-call") {
      expect(currentUser.role).toBe("admin");
      vapiTestCallPayload = JSON.parse(route.request().postData() ?? "{}") as {
        customer_name?: string;
        customer_phone?: string;
        cargo_provider?: string;
        tracking_number?: string;
        last_event_text?: string;
        idempotency_key?: string;
      };
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          public_id: "pat_vapi_test_manual",
          provider_key: "vapi",
          account_public_id: null,
          request_id: "vapitest_vapi_test_05051234567",
          operation: "call.test",
          direction: "outbound",
          status: "success",
          status_code: 202,
          duration_ms: 0,
          retry_decision: "none",
          next_retry_at: null,
          idempotency_key: vapiTestCallPayload.idempotency_key,
          request_metadata: {},
          provider_request_preview: {
            method: "POST",
            path: "/vapi/calls",
            headers: { authorization: "[redacted]", "content-type": "application/json" },
            body: {
              customer_name: vapiTestCallPayload.customer_name,
              customer_phone: vapiTestCallPayload.customer_phone,
              cargo_provider: vapiTestCallPayload.cargo_provider,
              tracking_number: vapiTestCallPayload.tracking_number,
              last_event_text: vapiTestCallPayload.last_event_text,
            },
            live_call_performed: false,
          },
          response_metadata: { mode: "dry_run", queued: false, live_call_permitted: false },
          error_code: null,
          error_message: null,
          started_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        }),
      });
      return;
    }

    if (url.pathname === "/api/sms/send") {
      smsSendPayload = JSON.parse(route.request().postData() ?? "{}") as {
        recipient_phone?: string;
        message?: string;
        shipment_public_id?: string;
        idempotency_key?: string;
      };
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          provider: "netgsm",
          operation: "sms.send",
          request_id: "req_sms_playwright",
          job_id: "job_manual_sms_shp_playwright",
          queued: true,
          recipient_phone: smsSendPayload.recipient_phone,
          message_preview: smsSendPayload.message?.slice(0, 80) ?? "",
          live_call_permitted: false,
        }),
      });
      return;
    }

    if (url.pathname === "/api/files/uploads") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          file: {
            public_id: "fil_playwright",
            bucket: "media",
            object_key: "uploads/kanit.txt",
            original_name: "kanit.txt",
            mime_type: "text/plain",
            byte_size: 12,
            checksum: "sha256:frontend-smoke",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
          upload: {
            method: "PUT",
            bucket: "media",
            object_key: "uploads/kanit.txt",
            headers: { "content-type": "text/plain" },
            presigned_url: `${backendBaseUrl}/presigned/uploads/kanit.txt`,
            expires_at: "2026-01-01T00:10:00.000Z",
          },
        }),
      });
      return;
    }

    if (url.pathname === "/api/files/orphans") {
      expect(currentUser.role).toBe("admin");
      expect(url.searchParams.get("limit")).toBe("10");
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              public_id: "fil_orphan",
              bucket: "media",
              object_key: "uploads/orphan-proof.txt",
              original_name: "orphan-proof.txt",
              mime_type: "text/plain",
              byte_size: 42,
              checksum: "sha256:orphan-proof",
              created_at: "2026-01-01T00:00:00.000Z",
              updated_at: "2026-01-01T00:01:00.000Z",
            },
          ],
        }),
      });
      return;
    }

    if (url.pathname === "/api/files/fil_orphan/orphan-cleanup-dry-run") {
      expect(currentUser.role).toBe("admin");
      expect(route.request().method()).toBe("POST");
      orphanCleanupDryRunPayload = JSON.parse(route.request().postData() ?? "{}") as {
        reason?: string | null;
      };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          mode: "dry_run",
          request_id: "orphan_cleanup_fil_orphan",
          deletion_performed: false,
          eligible_for_cleanup: true,
          reason: orphanCleanupDryRunPayload.reason ?? null,
          file: {
            public_id: "fil_orphan",
            bucket: "media",
            object_key: "uploads/orphan-proof.txt",
            original_name: "orphan-proof.txt",
            mime_type: "text/plain",
            byte_size: 42,
            checksum: "sha256:orphan-proof",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:01:00.000Z",
          },
          storage_action: {
            provider: "garage",
            bucket: "media",
            object_key: "uploads/orphan-proof.txt",
            operation: "delete_object",
          },
        }),
      });
      return;
    }

    if (url.pathname === "/api/files/fil_playwright") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          public_id: "fil_playwright",
          bucket: "media",
          object_key: "uploads/kanit.txt",
          original_name: "kanit.txt",
          mime_type: "text/plain",
          byte_size: 12,
          checksum: "sha256:frontend-smoke",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:30.000Z",
        }),
      });
      return;
    }

    if (url.pathname === "/api/files/fil_playwright/download") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          file: {
            public_id: "fil_playwright",
            bucket: "media",
            object_key: "uploads/kanit.txt",
            original_name: "kanit.txt",
            mime_type: "text/plain",
            byte_size: 12,
            checksum: "sha256:frontend-smoke",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:01:00.000Z",
          },
          download: {
            method: "GET",
            bucket: "media",
            object_key: "uploads/kanit.txt",
            headers: {},
            presigned_url: `${backendBaseUrl}/presigned/downloads/kanit.txt`,
            expires_at: "2026-01-01T00:16:00.000Z",
          },
        }),
      });
      return;
    }

    if (url.pathname === "/presigned/uploads/kanit.txt") {
      await route.fulfill({ status: 200, body: "ok" });
      return;
    }

    if (url.pathname === "/presigned/downloads/kanit.txt") {
      expect(route.request().method()).toBe("GET");
      await route.fulfill({
        contentType: "text/plain",
        body: "frontend-ok",
      });
      return;
    }

    await route.fulfill({ status: 404, body: "not found" });
  });

  try {
    await page.goto(`${app.url}/gizlilik-politikasi`);
    await expect(page.getByTestId("privacy-public-page")).toContainText("Backend API");
    await page.goto(`${app.url}/kullanim-kosullari`);
    await expect(page.getByTestId("terms-public-page")).toContainText("PTT");
    await page.goto(`${app.url}/veri-silme`);
    await expect(page.getByTestId("deletion-public-page")).toContainText("Talep");
    await page.goto(`${app.url}/sifre-sifirla`);
    await expect(page.getByTestId("reset-password-flow")).toContainText("Şifre sıfırlama");
    await page.getByRole("button", { name: /sıfırlama bağlantısı gönder/i }).click();
    await expect(page.getByTestId("reset-password-flow")).toContainText("backend auth");
    await page.goto(`${app.url}/giris`);
    await page.getByRole("button", { name: /giriş yap/i }).click();
    await expect(page.getByTestId("inbox-flow")).toContainText("Playwright Customer");
    await expect(page.getByRole("link", { name: /yorumlar/i })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /müşteriler/i })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /ptaller/i })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /stoklar/i })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /bakiyeler/i })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /^sms$/i })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /arama/i })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /vapi ai/i })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /analizi/i })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /entegrasyonlar/i })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /sürat debug/i })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /cron debug/i })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /evrimiçi/i })).toHaveCount(0);
    await expect(page.getByTestId("inbox-flow")).toContainText("Merhaba");
    await expect(page.getByTestId("inbox-flow")).toContainText("Okunmamış");
    await expect(page.getByTestId("inbox-flow")).toContainText("Havuz");
    await expect(page.getByTestId("conversation-filter-summary")).toContainText("legacy kanal/durum filtreleri");
    await expect(page.getByTestId("conversation-filter-summary")).toContainText("backend is_in_pool");
    await expect(page.getByTestId("conversation-filter-summary")).toContainText("backend human_agent_enabled");
    await page.getByTestId("conversation-channel-filter-facebook").click();
    await expect(page.getByTestId("conversation-list")).toContainText("Facebook Customer");
    await expect(page.getByTestId("conversation-list")).not.toContainText("Playwright Customer");
    await expect(page.getByTestId("conversation-detail")).toContainText("Facebook Customer");
    await expect(page.getByTestId("conversation-filter-summary")).toContainText("facebook");
    await page.getByTestId("conversation-status-filter-open").click();
    await expect(page.getByTestId("conversation-list")).not.toContainText("Facebook Customer");
    await expect(page.getByTestId("conversation-filter-summary")).toContainText("open");
    await page.getByTestId("conversation-status-filter-all").click();
    await page.getByTestId("conversation-channel-filter-instagram").click();
    await expect(page.getByTestId("conversation-list")).toContainText("Playwright Customer");
    await expect(page.getByTestId("conversation-list")).not.toContainText("Facebook Customer");
    await page.getByTestId("conversation-channel-filter-all").click();
    await expect(page.getByTestId("conversation-detail")).toContainText("Playwright Customer");
    await expect(page.getByTestId("conversation-detail")).toContainText("instagram");
    expect(conversationQueryUrls).toEqual(
      expect.arrayContaining([
        "/api/conversations?limit=20",
        "/api/conversations?channel=facebook%2Cmessenger&limit=20",
        "/api/conversations?channel=facebook%2Cmessenger&status=open&limit=20",
        "/api/conversations?channel=instagram&limit=20",
      ]),
    );
    await Promise.all([
      page.waitForResponse(`${backendBaseUrl}/api/conversations/cnv_playwright/state`),
      page.getByRole("button", { name: /okundu yap/i }).click(),
    ]);
    await expect(page.getByTestId("conversation-detail")).toContainText(/Okunmamış\s*0/);
    await Promise.all([
      page.waitForResponse(`${backendBaseUrl}/api/conversations/cnv_playwright/state`),
      page.getByRole("button", { name: /human agent aç/i }).click(),
    ]);
    await expect(page.getByRole("button", { name: /human agent kapat/i })).toBeVisible();
    await Promise.all([
      page.waitForResponse(`${backendBaseUrl}/api/conversations/cnv_playwright/state`),
      page.getByRole("button", { name: /havuzdan al/i }).click(),
    ]);
    await expect(page.getByTestId("conversation-detail")).toContainText("admin@example.com");
    await Promise.all([
      page.waitForResponse(`${backendBaseUrl}/api/orders`),
      page.getByRole("button", { name: /konuşmadan sipariş aç/i }).click(),
    ]);
    expect(conversationOrderCreated).toBe(true);
    await expect.poll(async () =>
      page.evaluate(() => window.__GARANTI_REALTIME_TEST__?.emitted ?? []),
    ).toEqual(
      expect.arrayContaining([
        { event: "connect", payload: null },
        { event: "conversation.join", payload: "cnv_playwright" },
      ]),
    );
    await page.getByRole("button", { name: /facebook customer/i }).click();
    await expect(page.getByTestId("conversation-detail")).toContainText("facebook");
    await page.getByRole("button", { name: /playwright customer/i }).click();
    await expect.poll(async () =>
      page.evaluate(() => window.__GARANTI_REALTIME_TEST__?.emitted ?? []),
    ).toEqual(
      expect.arrayContaining([
        { event: "conversation.leave", payload: "cnv_playwright" },
        { event: "conversation.join", payload: "cnv_facebook_playwright" },
        { event: "conversation.join", payload: "cnv_playwright" },
      ]),
    );
    facebookRealtimeDelivered = true;
    await page.evaluate(() =>
      window.__GARANTI_REALTIME_TEST__?.emitServer("message.created", {
        event: "message.created",
        id: "evt_socketio_facebook",
        occurred_at: "2026-01-01T00:01:10.000Z",
        payload: {
          message_public_id: "msg_socketio_facebook",
          conversation_public_id: "cnv_facebook_playwright",
          sender_type: "customer",
        },
      }),
    );
    await expect(page.getByTestId("inbox-flow")).toContainText("Facebook broadcast mesajı");
    await expect(page.getByTestId("inbox-flow")).not.toContainText("msg_socketio_facebook");
    await expect(page.getByText("Yeni konuşma bildirimi Socket.IO üzerinden alındı")).toBeVisible();
    realtimeMessageDelivered = true;
    await page.evaluate(() =>
      window.__GARANTI_REALTIME_TEST__?.emitServer("message.created", {
        event: "message.created",
        id: "evt_socketio_live",
        occurred_at: "2026-01-01T00:01:30.000Z",
        payload: {
          message_public_id: "msg_socketio_live",
          conversation_public_id: "cnv_playwright",
          sender_type: "customer",
        },
      }),
    );
    await expect(page.getByTestId("inbox-flow")).toContainText("Socket.IO canlı mesaj");
    await expect(page.getByText("Yeni mesaj Socket.IO üzerinden alındı")).toBeVisible();
    await page.getByRole("button", { name: /playwright customer/i }).click();
    await expect(page.getByTestId("conversation-detail")).toContainText("open");
    await page.getByRole("button", { name: /cevap gönder/i }).click();
    await expect(page.getByTestId("inbox-flow")).toContainText("Backend UI yaniti");
    await page.goto(`${app.url}/mesajlar`);
    await expect(page.getByTestId("inbox-flow")).toContainText("Playwright Customer");
    await page.goto(`${app.url}/yorumlar`);
    await expect(page.getByTestId("comments-flow")).toContainText("backend conversations");
    await expect(page.getByTestId("comments-ai-summary")).toContainText("Manuel bekleyen");
    await expect(page.getByTestId("comments-ai-summary")).toContainText("7");
    await expect(page.getByTestId("comments-ai-summary")).toContainText("Instagram");
    await expect(page.getByTestId("comments-ai-summary")).toContainText("Facebook");
    await expect(page.getByTestId("comments-ai-summary")).toContainText("Cevaplı");
    await expect(page.getByTestId("comments-ai-summary")).toContainText("11");
    await expect(page.getByTestId("comments-ai-summary")).toContainText("3");
    await expect(page.getByTestId("comments-ai-summary")).toContainText("AI cevap tipi");
    await expect(page.getByTestId("comments-detail")).toContainText("Playwright Customer");
    await expect(page.getByTestId("comments-detail")).toContainText("instagram");
    await expect(page.getByTestId("comments-detail")).toContainText("Merhaba");
    await page.goto(`${app.url}/musteriler`);
    await expect(page.getByTestId("customers-flow")).toContainText("Müşteri");
    await expect(page.getByTestId("customers-list-detail")).toContainText("Playwright Customer");
    await expect(page.getByTestId("customers-list-detail")).toContainText("VIP kuluçka müşterisi");
    await expect(page.getByTestId("customer-card-detail")).toContainText("5550000000");
    await expect(page.getByTestId("customer-card-detail")).toContainText("playwright@example.com");
    await expect(page.getByTestId("customer-card-detail")).toContainText("customers API");
    await page.goto(`${app.url}/iptaller`);
    await expect(page.getByTestId("cancellations-flow")).toContainText("backend orders");
    await expect(page.getByTestId("cancellation-detail")).toContainText("ORD-PLAYWRIGHT");
    await expect(page.getByTestId("cancellation-detail")).toContainText("Playwright Customer");
    await expect(page.getByTestId("cancellation-detail")).toContainText("fixture order");
    await page.getByRole("button", { name: "İptali onayla" }).click();
    await expect
      .poll(() => cancellationApproved, {
        message: `Expected cancellation status request; requests=${allRequestUrls
          .filter((requestUrl) => requestUrl.includes("/api/orders"))
          .join(",")} errors=${frontendErrors.join(",")}`,
      })
      .toBe(true);
    expect(cancellationPayload).toEqual({
      status: "cancelled",
      notes: "Frontend iptal inceleme onayi",
    });
    await expect(page.getByTestId("cancellation-detail")).toContainText("cancelled");
    await expect(page.getByTestId("cancellation-detail")).toContainText("Frontend iptal inceleme onayi");
    await page.goto(`${app.url}/stok`);
    await expect(page.getByTestId("inventory-flow")).toContainText("Ürün");
    await expect(page.getByTestId("inventory-flow")).toContainText("Kritik Stok");
    await expect(page.getByTestId("inventory-flow")).toContainText("orders API");
    await expect(page.getByTestId("inventory-categories")).toContainText("Kuluçka Makineleri");
    await expect(page.getByTestId("inventory-categories")).toContainText("Yedek Parçalar");
    await expect(page.getByTestId("inventory-categories")).toContainText("Diğer Malzemeler");
    await expect(page.getByTestId("inventory-categories")).toContainText("products API");
    await expect(page.getByTestId("inventory-products-detail")).toContainText("Kuluçka Pro 56");
    await expect(page.getByTestId("inventory-products-detail")).toContainText("SKU-KUL-56");
    await expect(page.getByTestId("inventory-products-detail")).toContainText("7 adet");
    await expect(page.getByTestId("inventory-products-detail")).toContainText("1250.00 TRY");
    await expect(page.getByTestId("inventory-critical-stock")).toContainText("Yedek Fan");
    await expect(page.getByTestId("inventory-critical-stock")).toContainText("0 adet");
    await expect(page.getByTestId("inventory-critical-stock")).toContainText("kritik stok");
    await expect(page.getByTestId("inventory-detail")).toContainText("ORD-PLAYWRIGHT");
    await expect(page.getByTestId("inventory-detail")).toContainText("Playwright Customer");
    await expect(page.getByTestId("inventory-detail")).toContainText("sevkiyat bağlı");
    await page.goto(`${app.url}/bakiye`);
    await expect(page.getByTestId("balances-flow")).toContainText("admin settings");
    await expect(page.getByTestId("balances-detail")).toContainText("125.50 TRY");
    await expect(page.getByTestId("balances-detail")).toContainText("ORD-PLAYWRIGHT");
    await expect(page.getByTestId("balance-payment-detail")).toContainText("Ödeme İsteği Kuyruğu");
    await expect(page.getByTestId("balance-payment-detail")).toContainText("12.55 TRY");
    await expect(page.getByTestId("balance-payment-detail")).toContainText("1 talep");
    await expect(page.getByTestId("balance-payment-detail")).toContainText("Kullanılabilir bakiye");
    await page.getByRole("button", { name: "Ödeme isteği oluştur" }).click();
    await expect
      .poll(() => paymentRequestPayload)
      .toMatchObject({
        amount: "12.55",
        currency: "TRY",
        idempotency_key: "payment_ord_playwright_12.55_TRY",
      });
    await expect(page.getByTestId("balance-payment-detail")).toContainText("balance.payment_request payreq_payment_ord_playwright_12_55_try");
    await expect(page.getByTestId("balance-payment-detail")).toContainText("canlı ödeme provider kapalı");
    await page.getByRole("link", { name: /^sms$/i }).click();
    await expect(page.getByTestId("sms-template-detail")).toContainText("Manuel SMS Şablonu");
    await expect(page.getByTestId("sms-template-detail")).toContainText("{musteri_adi}");
    await expect(page.getByTestId("sms-template-detail")).toContainText("Playwright Customer");
    await expect(page.getByTestId("sms-template-detail")).toContainText("TRK-PLAYWRIGHT");
    await expect(page.getByTestId("sms-template-variable-musteri-adi")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("sms-template-variable-takip-no").click();
    await expect(page.getByTestId("sms-template-variable-takip-no")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("sms-template-detail")).toContainText("Seçili değişken");
    await expect(page.getByTestId("sms-template-selected-variable")).toContainText("{takip_no}: TRK-PLAYWRIGHT");
    await page.getByTestId("sms-template-variable-kargo-firmasi").click();
    await expect(page.getByTestId("sms-template-variable-kargo-firmasi")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("sms-template-selected-variable")).toContainText("{kargo_firmasi}: ptt");
    await expect(page.getByTestId("sms-template-detail")).toContainText("1 SMS");
    await expect(page.getByTestId("sms-history-detail")).toContainText("SMS Gönderim Kayıtları");
    await expect(page.getByTestId("sms-history-detail")).toContainText("3 alıcı");
    await expect(page.getByTestId("sms-history-detail")).toContainText("5550000000");
    await page.getByRole("button", { name: "SMS gönder" }).click();
    await expect
      .poll(() => smsSendPayload)
      .toMatchObject({
        recipient_phone: "5550000000",
        shipment_public_id: "shp_playwright",
        idempotency_key: "manual_sms_shp_playwright",
        message: expect.stringContaining("TRK-PLAYWRIGHT"),
      });
    await expect(page.getByTestId("sms-history-detail")).toContainText("netgsm sms.send queued req_sms_playwright");
    await expect(page.getByTestId("sms-confirmation-detail")).toContainText("kapalı");
    await expect(page.getByTestId("sms-confirmation-detail")).toContainText("5550000000");
    await page.getByRole("button", { name: /netgsm teyit ayarını kaydet/i }).click();
    await expect(page.getByTestId("sms-confirmation-detail")).toContainText("aktif");
    await expect(page.getByTestId("sms-confirmation-detail")).toContainText("5 dakika sonra aranacak");
    await page.goto(`${app.url}/sesli-asistan`);
    await expect(page.getByTestId("sip-config-detail")).toContainText("wss://sip.example.com/ws");
    await expect(page.getByTestId("sip-config-detail")).toContainText("stun:stun.l.google.com:19302");
    await page.getByRole("button", { name: /santral ayarını kaydet/i }).click();
    await expect(page.getByTestId("sip-config-detail")).toContainText("sip.example.com");
    await page.goto(`${app.url}/sesli-asistan/vapi`);
    await expect(page.getByTestId("vapi-flow")).toContainText("webphone API");
    await expect(page.getByTestId("vapi-detail")).toContainText("sip.example.com");
    await expect(page.getByTestId("vapi-detail")).toContainText("1001");
    await expect(page.getByTestId("vapi-detail")).toContainText("AI model ayarı tanımlı değil");
    await expect(page.getByTestId("vapi-test-call-detail")).toContainText("Hızlı Test Araması");
    await page.getByRole("button", { name: "VAPI test araması hazırla" }).click();
    expect(vapiTestCallPayload).toMatchObject({
      customer_name: "Test Müşteri",
      customer_phone: "05051234567",
      cargo_provider: "PTT",
      tracking_number: "TRK-PLAYWRIGHT",
      last_event_text: "Accepted at branch",
      idempotency_key: "vapi_test_05051234567",
    });
    await expect(page.getByTestId("vapi-test-call-detail")).toContainText("call.test vapitest_vapi_test_05051234567");
    await page.goto(`${app.url}/raporlar`);
    await expect(page.getByTestId("reports-flow")).toContainText("200.50 TRY");
    await expect(page.getByTestId("reports-detail")).toContainText("Açık konuşma");
    await expect(page.getByTestId("reports-detail")).toContainText("Aktif kargo");
    await expect(page.getByTestId("reports-ratio-summary")).toContainText("Teslim Oranı");
    await expect(page.getByTestId("reports-ratio-summary")).toContainText("Teyit Oranı");
    await expect(page.getByTestId("reports-ratio-summary")).toContainText("%0");
    await page.goto(`${app.url}/ayarlar/entegrasyonlar`);
    await expect(page.getByTestId("integrations-flow")).toContainText("Instagram Main");
    await expect(page.getByTestId("instagram-publish-preview")).toContainText("Instagram Yayın Önizleme");
    await expect(page.getByTestId("instagram-publish-preview")).toContainText("https://example.com/garanti-kulucka.jpg");
    await expect(page.getByTestId("instagram-publish-preview")).toContainText("2200 karakter");
    await expect(page.getByTestId("instagram-publish-preview")).toContainText("taslak");
    await expect(page.getByTestId("provider-attempts-detail")).toContainText("Provider Deneme Kayıtları");
    await expect(page.getByTestId("provider-attempts-detail")).toContainText("instagram / message.send");
    await expect(page.getByTestId("provider-attempts-detail")).toContainText("failed");
    await expect(page.getByTestId("provider-attempts-detail")).toContainText("429");
    await expect(page.getByTestId("provider-attempts-detail")).toContainText("312 ms");
    await expect(page.getByTestId("provider-attempts-detail")).toContainText("retry");
    await expect(page.getByTestId("provider-attempts-detail")).toContainText("POST /v18.0/ig_main/media");
    await expect(page.getByTestId("provider-attempts-detail")).toContainText("[redacted]");
    await expect(page.getByTestId("provider-attempts-detail")).not.toContainText("frontend-playwright-token");
    await expect(page.getByTestId("provider-attempts-detail")).not.toContainText("raw-provider-secret");
    await page.getByRole("button", { name: "Instagram yayın dry-run hazırla" }).click();
    expect(instagramPublishPayload).toMatchObject({
      account_public_id: "iac_instagram",
      image_url: "https://example.com/garanti-kulucka.jpg",
      idempotency_key: "instagram_publish_iac_instagram",
    });
    expect(instagramPublishPayload?.caption).toContain("Kuluçka makineleri");
    await expect(page.getByTestId("instagram-publish-preview")).toContainText("message.send igpub_instagram_publish_iac_instagram");
    await expect(page.getByTestId("provider-attempts-detail")).toContainText("POST /v18.0/ig_main/media");
    await expect(page.getByTestId("provider-attempts-detail")).toContainText("success");
    await expect(page.getByTestId("provider-attempts-detail")).toContainText("HTTP202");
    await expect(page.getByTestId("provider-attempts-detail")).toContainText("0 ms");
    await expect(page.getByTestId("provider-attempts-detail")).toContainText("none");
    await expect(page.getByTestId("provider-attempts-detail")).toContainText("igpub_instagram_publish_iac_instagram");
    await expect(page.getByTestId("provider-attempts-detail")).toContainText("[redacted]");
    await expect(page.getByTestId("provider-attempts-detail")).not.toContainText("frontend-playwright-token");
    await expect(page.getByTestId("provider-attempts-detail")).not.toContainText("raw-provider-secret");
    await expect(page.getByTestId("provider-catalog-detail")).toContainText("Provider Canlı Mod Sınırları");
    await expect(page.getByTestId("provider-catalog-detail")).toContainText("10");
    await expect(page.getByTestId("provider-catalog-detail")).toContainText("ptt");
    await expect(page.getByTestId("provider-catalog-detail")).toContainText("fixture_only");
    await expect(page.getByTestId("provider-catalog-detail")).toContainText("kapalı");
    await expect(page.getByTestId("provider-catalog-detail")).toContainText("providers.ptt.live_mode");
    await expect(page.getByTestId("provider-catalog-detail")).toContainText("fixture_replay_contract_required");
    await expect(page.getByTestId("provider-catalog-detail")).toContainText("surat");
    await expect(page.getByTestId("provider-catalog-detail")).toContainText("kolaybi");
    await expect(page.getByTestId("provider-catalog-detail")).toContainText("whatsapp");
    await expect(page.getByTestId("provider-catalog-detail")).toContainText("netgsm");
    await expect(page.getByTestId("provider-catalog-detail")).toContainText("sip");
    await expect(page.getByTestId("integration-audit-detail")).toContainText("Entegrasyon Denetim Kayıtları");
    await expect(page.getByTestId("integration-audit-detail")).toContainText("integration_token_update / integration_tokens");
    await expect(page.getByTestId("integration-audit-detail")).toContainText("iac_instagram/access_token");
    await expect(page.getByTestId("integration-audit-detail")).toContainText("[redacted]");
    await expect(page.getByTestId("integration-audit-detail")).not.toContainText("raw-integration-audit-secret");
    await page.getByRole("button", { name: /instagram main detay/i }).click();
    await expect(page.getByTestId("instagram-analytics-summary")).toContainText("Instagram Analitik Özeti");
    await expect(page.getByTestId("instagram-analytics-summary")).toContainText("1240");
    await expect(page.getByTestId("instagram-analytics-summary")).toContainText("980");
    await expect(page.getByTestId("instagram-analytics-summary")).toContainText("6% etkileşim");
    await expect(page.getByTestId("integration-detail")).toContainText("webhook.enabled");
    await expect(page.getByTestId("integration-detail")).toContainText("false");
    await page.getByRole("button", { name: /webhook ayarını kaydet/i }).click();
    await expect(page.getByTestId("integration-detail")).toContainText("true");
    await expect(page.getByTestId("integration-detail")).toContainText("value masked");
    await page.getByRole("button", { name: /access token kaydet/i }).click();
    await expect(page.getByTestId("integration-detail")).toContainText("access_token");
    await expect(page.getByTestId("integration-detail")).toContainText("maskeli");
    await expect(page.getByTestId("integration-detail")).not.toContainText("frontend-playwright-token");
    await page.getByRole("button", { name: /instagram hesabı kaydet/i }).click();
    await expect(page.getByTestId("integrations-flow")).toContainText("Instagram Playwright");
    await page.getByRole("link", { name: /siparişler/i }).click();
    await expect(page.getByTestId("orders-flow")).toContainText("ORD-PLAYWRIGHT");
    await expect(page.getByTestId("orders-flow")).toContainText("Toplam Sipariş");
    await expect(page.getByTestId("orders-flow")).toContainText("Aktif Sipariş");
    await expect(page.getByTestId("order-section-filters")).toContainText("Hepsi 2");
    await expect(page.getByTestId("order-section-filters")).toContainText("Aktif 1");
    await expect(page.getByTestId("order-section-filters")).toContainText("Teyit 1");
    await expect(page.getByTestId("order-section-filters")).toContainText("Teslim 1");
    await expect(page.getByTestId("order-detail")).toContainText("Playwright Customer");
    await expect(page.getByTestId("order-detail")).toContainText("fixture order");
    await page.getByTestId("order-filter-active").click();
    await expect(page.getByTestId("orders-flow")).toContainText("ORD-PLAYWRIGHT");
    await expect(page.getByTestId("orders-flow")).not.toContainText("ORD-DELIVERED");
    await expect(page.getByTestId("order-section-filters")).toContainText("Aktif 1");
    await expect(page.getByTestId("order-section-filters")).toContainText("Hepsi sonuç");
    await page.getByTestId("order-filter-pending-confirmation").click();
    await expect(page.getByTestId("order-detail")).toContainText("teyit bekliyor");
    await expect(page.getByTestId("order-section-filters")).toContainText("Teyit 1");
    await page.getByTestId("order-filter-delivered").click();
    await expect(page.getByTestId("orders-flow")).toContainText("ORD-DELIVERED");
    await expect(page.getByTestId("orders-flow")).not.toContainText("ORD-PLAYWRIGHT");
    await expect(page.getByTestId("order-section-filters")).toContainText("Teslim 1");
    await expect(page.getByTestId("order-section-filters")).toContainText("Aktif sonuç");
    await page.getByTestId("order-filter-all").click();
    await expect(page.getByTestId("order-section-filters")).toContainText("Hepsi 2");
    expect(orderQueryUrls).toEqual(
      expect.arrayContaining([
        "/api/orders?limit=20",
        "/api/orders?status=active&limit=20",
        "/api/orders?confirmation_status=pending&limit=20",
        "/api/orders?status=delivered&limit=20",
      ]),
    );
    await page.getByRole("button", { name: /sipariş oluştur/i }).click();
    await expect(page.getByTestId("orders-flow")).toContainText("ORD-WEB-NEW");
    await expect(page.getByTestId("order-detail")).toContainText("ORD-WEB-NEW");
    await expect(page.getByTestId("order-detail")).toContainText("Frontend backend create smoke");
    await page.getByRole("link", { name: /kargo/i }).click();
    await expect(page.getByTestId("shipments-flow")).toContainText("TRK-PLAYWRIGHT");
    await expect(page.getByTestId("shipments-flow")).toContainText("PTT Kargo");
    await expect(page.getByTestId("shipments-flow")).toContainText("Yoldaki Kargolar");
    await expect(page.getByTestId("shipment-section-tabs")).toContainText("Tüm kargolar 4");
    await expect(page.getByTestId("shipment-section-tabs")).toContainText("PTT 1");
    await expect(page.getByTestId("shipment-section-tabs")).toContainText("Sürat 2");
    await expect(page.getByTestId("shipment-section-tabs")).toContainText("Diğer 1");
    await expect(page.getByTestId("shipment-filter-summary")).toContainText("Yeni");
    await expect(page.getByTestId("shipment-filter-summary")).toContainText("PTT Almayan");
    await expect(page.getByTestId("shipment-filter-summary")).toContainText("Sürat Almayan");
    await expect(page.getByTestId("shipment-filter-summary")).toContainText("Takip No Yok");
    await page.getByTestId("shipment-filter-ptt").click();
    await expect(page.getByTestId("shipments-flow")).toContainText("TRK-PLAYWRIGHT");
    await expect(page.getByTestId("shipments-flow")).not.toContainText("TRK-SURAT-PLAYWRIGHT");
    await expect(page.getByTestId("shipment-section-tabs")).toContainText("PTT 1");
    await expect(page.getByTestId("shipment-section-tabs")).toContainText("Sürat sonuç");
    await page.getByTestId("shipment-filter-surat").click();
    await expect(page.getByTestId("shipments-flow")).toContainText("TRK-SURAT-PLAYWRIGHT");
    await expect(page.getByTestId("shipments-flow")).not.toContainText("TRK-PLAYWRIGHT");
    await page.getByTestId("shipment-filter-other").click();
    await expect(page.getByTestId("shipments-flow")).not.toContainText("TRK-PLAYWRIGHT");
    await expect(page.getByTestId("shipments-flow")).not.toContainText("TRK-SURAT-PLAYWRIGHT");
    await page.getByTestId("shipment-filter-in-transit").click();
    await expect(page.getByTestId("shipments-flow")).toContainText("TRK-PLAYWRIGHT");
    await expect(page.getByTestId("shipments-flow")).toContainText("TRK-SURAT-PLAYWRIGHT");
    await page.getByTestId("shipment-filter-all").click();
    await expect(page.getByTestId("shipment-detail")).toContainText("Accepted at branch");
    await expect(page.getByTestId("shipment-detail")).toContainText("Kadikoy / Istanbul");
    await expect(page.getByTestId("shipment-detail")).toContainText("BAR-PLAYWRIGHT");
    await expect(page.getByTestId("shipment-detail")).toContainText("ORD-PLAYWRIGHT");
    await page.getByRole("button", { name: /trk-surat-playwright detay/i }).click();
    await expect(page.getByTestId("shipment-detail")).toContainText("Selected shipment at branch");
    await expect(page.getByTestId("shipment-detail")).toContainText("Cankaya / Ankara");
    await page.getByTestId("shipment-filter-in-transit").click();
    await page.getByRole("button", { name: /trk-surat-playwright detay/i }).click();
    await page.getByRole("button", { name: /teslim edildi yap/i }).click();
    await expect(page.getByTestId("shipments-flow")).not.toContainText("TRK-SURAT-PLAYWRIGHT");
    await expect(page.getByTestId("shipment-detail")).toContainText("Accepted at branch");
    await page.getByTestId("shipment-filter-delivered").click();
    await expect(page.getByTestId("shipments-flow")).toContainText("TRK-SURAT-PLAYWRIGHT");
    await expect(page.getByTestId("shipments-flow")).not.toContainText("TRK-PLAYWRIGHT");
    await expect(page.getByTestId("shipment-detail")).toContainText("Selected shipment delivered");
    await expect(page.getByTestId("shipment-detail")).toContainText("delivered");
    await page.getByTestId("shipment-filter-tracking-missing").click();
    await expect(page.getByTestId("shipments-flow")).not.toContainText("TRK-PLAYWRIGHT");
    await page.getByTestId("shipment-filter-all").click();
    expect(shipmentQueryUrls).toEqual(
      expect.arrayContaining([
        "/api/shipments?limit=20",
        "/api/shipments?provider=ptt&limit=20",
        "/api/shipments?provider=surat&limit=20",
        "/api/shipments?provider=other&limit=20",
        "/api/shipments?status=in_transit&limit=20",
        "/api/shipments?status=delivered&limit=20",
        "/api/shipments?tracking_missing=true&limit=20",
      ]),
    );
    await page.getByRole("button", { name: /trk-surat-playwright detay/i }).click();
    await page.getByRole("link", { name: /pipeline/i }).click();
    await expect(page.getByTestId("shipment-pipeline-flow")).toContainText("Teslim Alınmayan Kargo Pipeline");
    await expect(page.getByTestId("shipment-pipeline-tabs")).toContainText("Tümü 4");
    await expect(page.getByTestId("shipment-pipeline-tabs")).toContainText("Mesaj 1");
    await expect(page.getByTestId("shipment-pipeline-tabs")).toContainText("SMS 1");
    await expect(page.getByTestId("shipment-pipeline-tabs")).toContainText("VAPI 1");
    await expect(page.getByTestId("shipment-pipeline-tabs")).toContainText("Teslim 1");
    await expect(page.getByTestId("shipment-pipeline-detail")).toContainText("Mesaj SMS VAPI Akışı");
    await expect(page.getByTestId("shipment-pipeline-detail")).toContainText("legacy /kargo/pipeline");
    await expect(page.getByTestId("shipment-pipeline-detail")).toContainText("Supabase channel yok");
    await expect(page.getByTestId("shipment-pipeline-flow")).toContainText("Playwright Customer");
    await expect(page.getByTestId("shipment-pipeline-flow")).toContainText("vapi / isleniyor");
    await expect(page.getByTestId("shipment-pipeline-flow")).toContainText("teslim / teslim");
    await page.getByTestId("shipment-pipeline-filter-mesaj").click();
    await expect(page.getByTestId("shipment-pipeline-filter-mesaj")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("shipment-pipeline-detail")).toContainText("mesaj");
    await expect(page.getByTestId("shipment-pipeline-detail")).toContainText("1 kargo");
    await expect(page.getByTestId("shipment-pipeline-flow")).toContainText("Message Step Customer");
    await expect(page.getByTestId("shipment-pipeline-flow")).not.toContainText("Playwright Customer");
    await page.getByTestId("shipment-pipeline-filter-sms").click();
    await expect(page.getByTestId("shipment-pipeline-filter-sms")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("shipment-pipeline-flow")).toContainText("SMS Step Customer");
    await expect(page.getByTestId("shipment-pipeline-flow")).toContainText("sms / isleniyor");
    await expect(page.getByTestId("shipment-pipeline-flow")).not.toContainText("Message Step Customer");
    await page.getByTestId("shipment-pipeline-filter-vapi").click();
    await expect(page.getByTestId("shipment-pipeline-flow")).toContainText("Playwright Customer");
    await expect(page.getByTestId("shipment-pipeline-flow")).not.toContainText("SMS Step Customer");
    await page.getByTestId("shipment-pipeline-filter-teslim").click();
    await expect(page.getByTestId("shipment-pipeline-flow")).toContainText("Surat Playwright Customer");
    await expect(page.getByTestId("shipment-pipeline-flow")).toContainText("teslim / teslim");
    await expect(page.getByTestId("shipment-pipeline-flow")).not.toContainText("TRK-PLAYWRIGHT");
    await page.getByTestId("shipment-pipeline-filter-all").click();
    await expect(page.getByTestId("shipment-pipeline-filter-all")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("shipment-pipeline-flow")).toContainText("Message Step Customer");
    await expect(page.getByTestId("shipment-pipeline-flow")).toContainText("SMS Step Customer");
    await page.getByRole("link", { name: /sürat debug/i }).click();
    await expect(page.getByTestId("surat-debug-flow")).toContainText("Sürat Kargo Debug");
    await expect(page.getByTestId("surat-debug-detail")).toContainText("legacy /api/surat-kargo/debug");
    await expect(page.getByTestId("surat-debug-detail")).toContainText("providers.surat.live_mode");
    await expect(page.getByTestId("surat-debug-detail")).toContainText("fixture_replay_contract_required");
    await expect(page.getByTestId("surat-debug-detail")).toContainText("POST /kargo-takip");
    await expect(page.getByTestId("surat-debug-detail")).toContainText("canlı çağrı yok");
    await expect(page.getByTestId("surat-debug-detail")).toContainText("[redacted]");
    await expect(page.getByTestId("surat-debug-detail")).not.toContainText("raw-surat-secret");
    await expect(page.getByTestId("surat-debug-flow")).toContainText("shipment.track / outbound");
    await expect(page.getByTestId("surat-debug-flow")).toContainText("failed / retry");
    await page.getByRole("link", { name: /cron debug/i }).click();
    await expect(page.getByTestId("cron-debug-flow")).toContainText("Kargo Takip Cron Debug");
    await expect(page.getByTestId("cron-debug-detail")).toContainText("legacy /api/ptt/cron-debug + /api/surat/cron-debug");
    await expect(page.getByTestId("cron-debug-detail")).toContainText("providers.ptt.live_mode");
    await expect(page.getByTestId("cron-debug-detail")).toContainText("providers.surat.live_mode");
    await expect(page.getByTestId("cron-debug-detail")).toContainText("cron-takip-guncelle canlı çağrı yok");
    await expect(page.getByTestId("cron-debug-detail")).toContainText("fixture_replay_contract_required");
    await expect(page.getByTestId("cron-debug-actions")).toContainText("PTT cron dry-run tetikle");
    await page.getByRole("button", { name: "PTT cron dry-run tetikle" }).click();
    expect(cronTriggerPayload).toEqual({
      provider: "ptt",
      idempotency_key: "cron_debug_ptt_manual",
    });
    await expect(page.getByTestId("cron-debug-flow")).toContainText("PTT / cron_ptt_cron_debug_ptt_manual");
    await expect(page.getByTestId("cron-debug-detail")).toContainText("2 güncellendi");
    await expect(page.getByTestId("cron-debug-flow")).toContainText("PTT / req_ptt_cron_debug");
    await expect(page.getByTestId("cron-debug-flow")).toContainText("SURAT / req_surat_debug");
    await page.getByRole("link", { name: /^sms$/i }).click();
    await expect(page.getByTestId("sms-template-detail")).toContainText("Surat Playwright Customer");
    await expect(page.getByTestId("sms-template-detail")).toContainText("TRK-SURAT-PLAYWRIGHT");
    await expect(page.getByTestId("sms-history-detail")).toContainText("5551111111");
    await expect(page.getByTestId("sms-confirmation-detail")).toContainText("5551111111");
    await page.getByRole("link", { name: /ayarlar/i }).click();
    await expect(page.getByTestId("admin-flow")).toContainText("webphone.enabled");
    await expect(page.getByTestId("operation-policy-detail")).toContainText("Operasyon Politikaları");
    await expect(page.getByTestId("operation-policy-detail")).toContainText("3 deneme");
    await expect(page.getByTestId("operation-policy-detail")).toContainText("10000 ms provider");
    await expect(page.getByTestId("operation-policy-detail")).toContainText("60/dk");
    await expect(page.getByTestId("operation-policy-detail")).toContainText("90 gün / orphan cleanup açık");
    await page.getByRole("button", { name: /operasyon politikasını kaydet/i }).click();
    await expect(page.getByTestId("operation-policy-detail")).toContainText("5 deneme");
    await expect(page.getByTestId("operation-policy-detail")).toContainText("12000 ms provider");
    await expect(page.getByTestId("operation-policy-detail")).toContainText("90/dk");
    await expect(page.getByTestId("operation-policy-detail")).toContainText("queue concurrency 6");
    await expect(page.getByTestId("operation-policy-detail")).toContainText("120 gün / orphan cleanup açık");
    await expect(page.getByTestId("settings-audit-detail")).toContainText("Ayar Denetim Kayıtları");
    await expect(page.getByTestId("settings-audit-detail")).toContainText("settings_change / settings");
    await expect(page.getByTestId("settings-audit-detail")).toContainText("providers.ptt.live_mode");
    await expect(page.getByTestId("settings-audit-detail")).toContainText("[redacted]");
    await expect(page.getByTestId("settings-audit-detail")).not.toContainText("raw-settings-audit-secret");
    await page.getByRole("button", { name: /ptt live gate kapalı kaydet/i }).click();
    await expect(page.getByTestId("admin-flow")).toContainText("providers.ptt.live_mode");
    await expect(page.getByTestId("admin-flow")).toContainText("false");
    await page.getByRole("link", { name: /dosya/i }).click();
    await expect(page.getByTestId("file-orphans-detail")).toContainText("Orphan Dosya Adayları");
    await expect(page.getByTestId("file-orphans-detail")).toContainText("orphan-proof.txt");
    await expect(page.getByTestId("file-orphans-detail")).toContainText("uploads/orphan-proof.txt");
    await expect(page.getByTestId("file-orphans-detail")).toContainText("42 byte");
    await page.getByRole("button", { name: /orphan cleanup dry-run hazırla/i }).click();
    expect(orphanCleanupDryRunPayload).toMatchObject({
      reason: "admin_orphan_lifecycle_review",
    });
    await expect(page.getByTestId("file-orphans-detail")).toContainText("orphan_cleanup_fil_orphan");
    await expect(page.getByTestId("file-orphans-detail")).toContainText("yapılmadı");
    await expect(page.getByTestId("file-orphans-detail")).toContainText("delete_object uploads/orphan-proof.txt");
    await page.getByRole("button", { name: /presigned upload testi/i }).click();
    await expect(page.getByTestId("file-upload-flow")).toContainText("kanit.txt kaydedildi");
    await expect(page.getByTestId("file-metadata-detail")).toContainText("media");
    await expect(page.getByTestId("file-metadata-detail")).toContainText("uploads/kanit.txt");
    await expect(page.getByTestId("file-metadata-detail")).toContainText("12 byte");
    await expect(page.getByTestId("file-metadata-detail")).toContainText("sha256:frontend-smoke");
    await expect(page.getByTestId("file-download-detail")).toContainText("Dosya İndirme");
    await expect(page.getByTestId("file-download-detail")).toContainText("GET");
    await expect(page.getByTestId("file-download-detail")).toContainText("presigned download");
    await expect(page.getByTestId("file-download-detail")).toContainText("hazır");
    await page.getByRole("link", { name: /santral/i }).click();
    await expect(page.getByTestId("webphone-flow")).toContainText("sip.example.com");
    const adminVisualRoutes = [
      { path: "/mesajlar", testId: "inbox-flow" },
      { path: "/yorumlar", testId: "comments-flow" },
      { path: "/musteriler", testId: "customers-flow" },
      { path: "/siparisler", testId: "orders-flow" },
      { path: "/kargo", testId: "shipments-flow" },
      { path: "/kargo/pipeline", testId: "shipment-pipeline-flow" },
      { path: "/kargo/surat-debug", testId: "surat-debug-flow" },
      { path: "/kargo/cron-debug", testId: "cron-debug-flow" },
      { path: "/iptaller", testId: "cancellations-flow" },
      { path: "/stok", testId: "inventory-flow" },
      { path: "/bakiye", testId: "balances-flow" },
      { path: "/sms", testId: "sms-flow" },
      { path: "/sesli-asistan", testId: "calls-flow" },
      { path: "/sesli-asistan/vapi", testId: "vapi-flow" },
      { path: "/raporlar", testId: "reports-flow" },
      { path: "/ayarlar/entegrasyonlar", testId: "integrations-flow" },
      { path: "/ayarlar", testId: "admin-flow" },
      { path: "/dosya", testId: "file-upload-flow" },
      { path: "/santral", testId: "webphone-flow" },
    ];
    await assertLegacyVisualFrame(page, app.url, "desktop", adminVisualRoutes);
    await assertLegacyVisualFrame(page, app.url, "mobile", adminVisualRoutes);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole("button", { name: /çıkış/i }).click();
    await expect(page.getByRole("button", { name: /giriş yap/i })).toBeVisible();
    currentUser = loginUser({ email: "cargo@example.com", role: "kargo_operatoru" });
    await Promise.all([
      page.waitForResponse(`${backendBaseUrl}/auth/login`),
      page.getByRole("button", { name: /giriş yap/i }).click(),
    ]);
    await expect(page.getByText("cargo@example.com")).toBeVisible();
    await page.goto(`${app.url}/mesajlar`);
    await expect(page.getByTestId("inbox-flow")).toContainText("Playwright Customer");
    await expect(page.getByRole("link", { name: /siparişler/i })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /kargo/i })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /^sms$/i })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /müşteriler/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /ayarlar/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /dosya/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /vapi ai/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /sürat debug/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /cron debug/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /evrimiçi/i })).toBeVisible();
    await Promise.all([
      page.waitForResponse(`${backendBaseUrl}/auth/presence`),
      page.getByRole("button", { name: /evrimiçi/i }).click(),
    ]);
    await expect(page.getByRole("button", { name: /evrimdışı/i })).toBeVisible();
    const cargoVisualRoutes = [
      { path: "/mesajlar", testId: "inbox-flow" },
      { path: "/siparisler", testId: "orders-flow" },
      { path: "/kargo", testId: "shipments-flow" },
      { path: "/kargo/pipeline", testId: "shipment-pipeline-flow" },
      { path: "/sms", testId: "sms-flow" },
    ];
    await assertLegacyVisualFrame(page, app.url, "desktop", cargoVisualRoutes);
    await assertLegacyVisualFrame(page, app.url, "mobile", cargoVisualRoutes);
  } finally {
    await closeWebApp(app.server);
  }

  expect(requestedUrls).toEqual(
    expect.arrayContaining([
      "/auth/login",
      "/auth/me",
      "/auth/logout",
      "/auth/presence",
      "/api/conversations",
      "/api/comments/moderation-summary",
      "/api/customers",
      "/api/conversations/cnv_playwright/messages",
      "/api/conversations/cnv_playwright/state",
      "/admin/integrations/accounts",
      "/admin/integrations/audit",
      "/admin/integrations/provider-catalog",
      "/admin/integrations/provider-attempts",
      "/admin/integrations/accounts/iac_instagram",
      "/admin/integrations/accounts/iac_instagram/settings/webhook.enabled",
      "/admin/integrations/accounts/iac_instagram/tokens/access_token",
      "/api/orders",
      "/api/products",
      "/api/shipments",
      "/api/shipments/shp_surat_playwright/status",
      "/admin/settings",
      "/admin/settings/audit",
      "/admin/settings/operations.policy",
      "/admin/settings/sip_config",
      "/admin/settings/netgsm_teyit_ayarlar",
      "/admin/settings/providers.ptt.live_mode",
      "/api/files/uploads",
      "/api/files/orphans",
      "/api/files/fil_orphan/orphan-cleanup-dry-run",
      "/api/files/fil_playwright",
      "/api/files/fil_playwright/download",
      "/presigned/uploads/kanit.txt",
      "/presigned/downloads/kanit.txt",
      "/api/webphone/config",
      "/api/webphone/test-call",
    ]),
  );
  expect(allRequestUrls.some((url) => /supabase|storage\/v1/i.test(url))).toBe(false);
  expect(savedSipConfig).toBe(true);
});

function loginUser(overrides: Partial<PlaywrightUser> = {}): PlaywrightUser {
  return {
    public_id: "usr_playwright",
    email: "admin@example.com",
    first_name: "Admin",
    last_name: "User",
    role: "admin",
    permissions: ["admin:settings:read"],
    is_online: true,
    sip_username: "1001",
    ...overrides,
  };
}

function loginBody(user = loginUser()) {
  return {
    access_token: "playwright-token",
    refresh_token: "refresh-token",
    token_type: "Bearer",
    expires_in: 900,
    user,
  };
}

async function assertLegacyVisualFrame(
  page: Page,
  appUrl: string,
  viewport: "desktop" | "mobile",
  routes: Array<{ path: string; testId: string }>,
) {
  await page.setViewportSize(viewport === "desktop" ? { width: 1280, height: 720 } : { width: 390, height: 844 });

  for (const route of routes) {
    await page.goto(`${appUrl}${route.path}`);
    const panel = page.getByTestId(route.testId);
    await expect(panel).toBeVisible();

    const frame = await page.evaluate((testId) => {
      const topbar = document.querySelector<HTMLElement>(".topbar");
      const workspace = document.querySelector<HTMLElement>(".workspace");
      const panelElement = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
      const nav = document.querySelector<HTMLElement>("nav");
      const viewportWidth = document.documentElement.clientWidth;

      if (!topbar || !workspace || !panelElement || !nav) {
        return { ok: false, reason: "missing-shell-node" };
      }

      const topbarRect = topbar.getBoundingClientRect();
      const workspaceRect = workspace.getBoundingClientRect();
      const panelRect = panelElement.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();

      if (panelRect.width < 240 || panelRect.height < 120) {
        return { ok: false, reason: "panel-too-small" };
      }
      if (workspaceRect.top < topbarRect.bottom - 1) {
        return { ok: false, reason: "workspace-overlaps-topbar" };
      }
      if (panelRect.left < -1 || panelRect.right > viewportWidth + 1) {
        return { ok: false, reason: "panel-horizontal-overflow" };
      }
      if (document.documentElement.scrollWidth > viewportWidth + 1) {
        return { ok: false, reason: "document-horizontal-scroll" };
      }
      if (navRect.width < 240 || navRect.height < 30) {
        return { ok: false, reason: "nav-collapsed" };
      }

      return { ok: true, reason: "ok" };
    }, route.testId);

    if (!frame.ok) {
      throw new Error(`${viewport} ${route.path} visual frame: ${JSON.stringify(frame)}`);
    }
  }
}
