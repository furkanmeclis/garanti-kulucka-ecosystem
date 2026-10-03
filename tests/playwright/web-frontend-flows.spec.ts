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
              unread_count: 2,
              last_message_text: "Merhaba",
              last_message_sender_type: "customer",
              last_message_at: "2026-01-01T00:00:00.000Z",
              customer: { full_name: "Playwright Customer", phone: "5550000000" },
              assigned_user_email: null,
              updated_at: "2026-01-01T00:00:00.000Z",
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
              metadata: {},
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
            metadata: {},
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
    await page.getByRole("button", { name: /playwright customer/i }).click();
    await expect(page.getByTestId("conversation-detail")).toContainText("open");
    await page.getByRole("button", { name: /cevap gönder/i }).click();
    await expect(page.getByTestId("inbox-flow")).toContainText("Backend UI yaniti");
    await page.goto(`${app.url}/mesajlar`);
    await expect(page.getByTestId("inbox-flow")).toContainText("Playwright Customer");
    await page.goto(`${app.url}/yorumlar`);
    await expect(page.getByTestId("comments-flow")).toContainText("backend conversations");
    await expect(page.getByTestId("comments-detail")).toContainText("Playwright Customer");
    await expect(page.getByTestId("comments-detail")).toContainText("instagram");
    await expect(page.getByTestId("comments-detail")).toContainText("Merhaba");
    await page.goto(`${app.url}/iptaller`);
    await expect(page.getByTestId("cancellations-flow")).toContainText("backend orders");
    await expect(page.getByTestId("cancellation-detail")).toContainText("ORD-PLAYWRIGHT");
    await expect(page.getByTestId("cancellation-detail")).toContainText("Playwright Customer");
    await expect(page.getByTestId("cancellation-detail")).toContainText("fixture order");
    await page.goto(`${app.url}/stok`);
    await expect(page.getByTestId("inventory-flow")).toContainText("orders API");
    await expect(page.getByTestId("inventory-detail")).toContainText("ORD-PLAYWRIGHT");
    await expect(page.getByTestId("inventory-detail")).toContainText("Playwright Customer");
    await expect(page.getByTestId("inventory-detail")).toContainText("sevkiyat bağlı");
    await page.goto(`${app.url}/bakiye`);
    await expect(page.getByTestId("balances-flow")).toContainText("admin settings");
    await expect(page.getByTestId("balances-detail")).toContainText("125.50 TRY");
    await expect(page.getByTestId("balances-detail")).toContainText("ORD-PLAYWRIGHT");
    await page.goto(`${app.url}/sms`);
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
    await page.goto(`${app.url}/ayarlar/entegrasyonlar`);
    await expect(page.getByTestId("integrations-flow")).toContainText("Instagram Main");
    await page.getByRole("button", { name: /instagram main detay/i }).click();
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
    await expect(page.getByTestId("shipment-section-tabs")).toContainText("Tüm kargolar 1");
    await expect(page.getByTestId("shipment-section-tabs")).toContainText("PTT 1");
    await expect(page.getByTestId("shipment-detail")).toContainText("Accepted at branch");
    await expect(page.getByTestId("shipment-detail")).toContainText("Kadikoy / Istanbul");
    await expect(page.getByTestId("shipment-detail")).toContainText("BAR-PLAYWRIGHT");
    await expect(page.getByTestId("shipment-detail")).toContainText("ORD-PLAYWRIGHT");
    await page.getByRole("button", { name: /teslim edildi yap/i }).click();
    await expect(page.getByTestId("shipments-flow")).toContainText("delivered");
    await expect(page.getByTestId("shipment-detail")).toContainText("Frontend teslim kaniti");
    await expect(page.getByTestId("shipment-detail")).toContainText("delivered");
    await page.getByRole("link", { name: /ayarlar/i }).click();
    await expect(page.getByTestId("admin-flow")).toContainText("webphone.enabled");
    await page.getByRole("button", { name: /ptt canlı modu aç/i }).click();
    await expect(page.getByTestId("admin-flow")).toContainText("providers.ptt.live_mode");
    await page.getByRole("link", { name: /dosya/i }).click();
    await page.getByRole("button", { name: /presigned upload testi/i }).click();
    await expect(page.getByTestId("file-upload-flow")).toContainText("kanit.txt kaydedildi");
    await page.getByRole("link", { name: /santral/i }).click();
    await expect(page.getByTestId("webphone-flow")).toContainText("sip.example.com");
    const adminVisualRoutes = [
      { path: "/mesajlar", testId: "inbox-flow" },
      { path: "/yorumlar", testId: "comments-flow" },
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
      "/api/conversations/cnv_playwright/messages",
      "/admin/integrations/accounts",
      "/admin/integrations/accounts/iac_instagram",
      "/admin/integrations/accounts/iac_instagram/settings/webhook.enabled",
      "/admin/integrations/accounts/iac_instagram/tokens/access_token",
      "/api/orders",
      "/api/shipments",
      "/api/shipments/shp_playwright/status",
      "/admin/settings",
      "/admin/settings/sip_config",
      "/admin/settings/netgsm_teyit_ayarlar",
      "/admin/settings/providers.ptt.live_mode",
      "/api/files/uploads",
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
