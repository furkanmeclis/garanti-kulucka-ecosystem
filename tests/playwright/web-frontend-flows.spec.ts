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
  let currentUser = loginUser();
  let savedIntegrationToken = false;
  let savedIntegrationSetting = false;
  let savedNetgsmSetting = false;
  let savedSipConfig = false;
  let realtimeMessageDelivered = false;
  let facebookRealtimeDelivered = false;

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

    if (url.pathname === "/api/conversations") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              public_id: "cnv_playwright",
              channel: "instagram",
              status: "open",
              is_in_pool: true,
              human_agent_enabled: false,
              unread_count: realtimeMessageDelivered ? 3 : 2,
              last_message_text: realtimeMessageDelivered ? "Socket.IO canlı mesaj" : "Merhaba",
              last_message_sender_type: "customer",
              last_message_at: realtimeMessageDelivered ? "2026-01-01T00:01:30.000Z" : "2026-01-01T00:00:00.000Z",
              customer: { full_name: "Playwright Customer", phone: "5550000000" },
              assigned_user_email: null,
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
          ],
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
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            public_id: "ord_web_new",
            order_number: "ORD-WEB-NEW",
            status: "draft",
            source: "manual",
            total_amount: "250.00",
            currency: "TRY",
            confirmation_status: null,
            notes: "Frontend backend create smoke",
            customer_full_name: "Playwright Customer",
            created_at: "2026-01-01T00:02:00.000Z",
            updated_at: "2026-01-01T00:02:00.000Z",
          }),
        });
        return;
      }

      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [
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
          ],
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
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          public_id: "shp_surat_playwright",
          provider: "Sürat",
          tracking_number: "TRK-SURAT-PLAYWRIGHT",
          barcode_number: "BAR-SURAT-PLAYWRIGHT",
          status: "delivered",
          recipient_name: "Surat Playwright Customer",
          recipient_phone: "5551111111",
          recipient_city: "Ankara",
          recipient_district: "Cankaya",
          last_event_text: "Selected shipment delivered",
          order_number: "ORD-SURAT-PLAYWRIGHT",
          customer_full_name: "Surat Playwright Customer",
          updated_at: "2026-01-01T00:02:00.000Z",
        }),
      });
      return;
    }

    if (url.pathname === "/api/shipments") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [
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
              status: "in_transit",
              recipient_name: "Surat Playwright Customer",
              recipient_phone: "5551111111",
              recipient_city: "Ankara",
              recipient_district: "Cankaya",
              last_event_text: "Selected shipment at branch",
              order_number: "ORD-SURAT-PLAYWRIGHT",
              customer_full_name: "Surat Playwright Customer",
              updated_at: "2026-01-01T00:01:00.000Z",
            },
          ],
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

    if (url.pathname === "/admin/settings/providers.ptt.live_mode") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          key: "providers.ptt.live_mode",
          scope: "global",
          value: true,
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

    if (url.pathname === "/presigned/uploads/kanit.txt") {
      await route.fulfill({ status: 200, body: "ok" });
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
    await expect(page.getByRole("button", { name: /evrimiçi/i })).toHaveCount(0);
    await expect(page.getByTestId("inbox-flow")).toContainText("Merhaba");
    await expect(page.getByTestId("conversation-detail")).toContainText("Playwright Customer");
    await expect(page.getByTestId("conversation-detail")).toContainText("instagram");
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
    await expect(page.getByTestId("comments-ai-summary")).toContainText("Instagram");
    await expect(page.getByTestId("comments-ai-summary")).toContainText("Facebook");
    await expect(page.getByTestId("comments-ai-summary")).toContainText("Cevaplı");
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
    await page.getByRole("link", { name: /^sms$/i }).click();
    await expect(page.getByTestId("sms-template-detail")).toContainText("Manuel SMS Şablonu");
    await expect(page.getByTestId("sms-template-detail")).toContainText("{musteri_adi}");
    await expect(page.getByTestId("sms-template-detail")).toContainText("Playwright Customer");
    await expect(page.getByTestId("sms-template-detail")).toContainText("TRK-PLAYWRIGHT");
    await expect(page.getByTestId("sms-template-detail")).toContainText("1 SMS");
    await expect(page.getByTestId("sms-history-detail")).toContainText("SMS Gönderim Kayıtları");
    await expect(page.getByTestId("sms-history-detail")).toContainText("2 alıcı");
    await expect(page.getByTestId("sms-history-detail")).toContainText("5550000000");
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
    await page.goto(`${app.url}/raporlar`);
    await expect(page.getByTestId("reports-flow")).toContainText("125.50 TRY");
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
    await expect(page.getByTestId("order-section-filters")).toContainText("Hepsi 1");
    await expect(page.getByTestId("order-section-filters")).toContainText("Teyit 1");
    await expect(page.getByTestId("order-detail")).toContainText("Playwright Customer");
    await expect(page.getByTestId("order-detail")).toContainText("fixture order");
    await page.getByRole("button", { name: /sipariş oluştur/i }).click();
    await expect(page.getByTestId("orders-flow")).toContainText("ORD-WEB-NEW");
    await expect(page.getByTestId("order-detail")).toContainText("ORD-WEB-NEW");
    await expect(page.getByTestId("order-detail")).toContainText("Frontend backend create smoke");
    await page.getByRole("link", { name: /kargo/i }).click();
    await expect(page.getByTestId("shipments-flow")).toContainText("TRK-PLAYWRIGHT");
    await expect(page.getByTestId("shipments-flow")).toContainText("PTT Kargo");
    await expect(page.getByTestId("shipments-flow")).toContainText("Yoldaki Kargolar");
    await expect(page.getByTestId("shipment-section-tabs")).toContainText("Tüm kargolar 2");
    await expect(page.getByTestId("shipment-section-tabs")).toContainText("PTT 1");
    await expect(page.getByTestId("shipment-section-tabs")).toContainText("Sürat 1");
    await expect(page.getByTestId("shipment-filter-summary")).toContainText("Yeni");
    await expect(page.getByTestId("shipment-filter-summary")).toContainText("PTT Almayan");
    await expect(page.getByTestId("shipment-filter-summary")).toContainText("Sürat Almayan");
    await expect(page.getByTestId("shipment-filter-summary")).toContainText("Takip No Yok");
    await expect(page.getByTestId("shipment-detail")).toContainText("Accepted at branch");
    await expect(page.getByTestId("shipment-detail")).toContainText("Kadikoy / Istanbul");
    await expect(page.getByTestId("shipment-detail")).toContainText("BAR-PLAYWRIGHT");
    await expect(page.getByTestId("shipment-detail")).toContainText("ORD-PLAYWRIGHT");
    await page.getByRole("button", { name: /trk-surat-playwright detay/i }).click();
    await expect(page.getByTestId("shipment-detail")).toContainText("Selected shipment at branch");
    await expect(page.getByTestId("shipment-detail")).toContainText("Cankaya / Ankara");
    await page.getByRole("button", { name: /teslim edildi yap/i }).click();
    await expect(page.getByTestId("shipments-flow")).toContainText("delivered");
    await expect(page.getByTestId("shipment-detail")).toContainText("Selected shipment delivered");
    await expect(page.getByTestId("shipment-detail")).toContainText("delivered");
    await page.getByRole("link", { name: /^sms$/i }).click();
    await expect(page.getByTestId("sms-template-detail")).toContainText("Surat Playwright Customer");
    await expect(page.getByTestId("sms-template-detail")).toContainText("TRK-SURAT-PLAYWRIGHT");
    await expect(page.getByTestId("sms-history-detail")).toContainText("5551111111");
    await expect(page.getByTestId("sms-confirmation-detail")).toContainText("5551111111");
    await page.getByRole("link", { name: /ayarlar/i }).click();
    await expect(page.getByTestId("admin-flow")).toContainText("webphone.enabled");
    await page.getByRole("button", { name: /ptt canlı modu aç/i }).click();
    await expect(page.getByTestId("admin-flow")).toContainText("providers.ptt.live_mode");
    await page.getByRole("link", { name: /dosya/i }).click();
    await page.getByRole("button", { name: /presigned upload testi/i }).click();
    await expect(page.getByTestId("file-upload-flow")).toContainText("kanit.txt kaydedildi");
    await expect(page.getByTestId("file-metadata-detail")).toContainText("media");
    await expect(page.getByTestId("file-metadata-detail")).toContainText("uploads/kanit.txt");
    await expect(page.getByTestId("file-metadata-detail")).toContainText("12 byte");
    await expect(page.getByTestId("file-metadata-detail")).toContainText("sha256:frontend-smoke");
    await page.getByRole("link", { name: /santral/i }).click();
    await expect(page.getByTestId("webphone-flow")).toContainText("sip.example.com");
    const adminVisualRoutes = [
      { path: "/mesajlar", testId: "inbox-flow" },
      { path: "/yorumlar", testId: "comments-flow" },
      { path: "/musteriler", testId: "customers-flow" },
      { path: "/siparisler", testId: "orders-flow" },
      { path: "/kargo", testId: "shipments-flow" },
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
      "/api/customers",
      "/api/conversations/cnv_playwright/messages",
      "/admin/integrations/accounts",
      "/admin/integrations/accounts/iac_instagram",
      "/admin/integrations/accounts/iac_instagram/settings/webhook.enabled",
      "/admin/integrations/accounts/iac_instagram/tokens/access_token",
      "/api/orders",
      "/api/products",
      "/api/shipments",
      "/api/shipments/shp_surat_playwright/status",
      "/admin/settings",
      "/admin/settings/sip_config",
      "/admin/settings/netgsm_teyit_ayarlar",
      "/admin/settings/providers.ptt.live_mode",
      "/api/files/uploads",
      "/api/files/fil_playwright",
      "/presigned/uploads/kanit.txt",
      "/api/webphone/config",
    ]),
  );
  expect(requestedUrls.some((path) => path.includes("supabase"))).toBe(false);
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

    expect(frame, `${viewport} ${route.path} visual frame`).toMatchObject({ ok: true });
  }
}
