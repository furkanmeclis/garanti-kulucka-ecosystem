import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

const backendBaseUrl = "http://127.0.0.1:65530";

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

  await page.route(`${backendBaseUrl}/**`, async (route) => {
    const url = new URL(route.request().url());
    requestedUrls.push(url.pathname);

    if (url.pathname === "/auth/login") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(loginBody()),
      });
      return;
    }

    if (url.pathname === "/auth/me") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(loginBody().user),
      });
      return;
    }

    if (url.pathname === "/auth/logout") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ status: "ok" }),
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

    if (url.pathname === "/api/orders") {
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
          ],
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
    await page.goto(app.url);
    await page.getByRole("button", { name: /giriş yap/i }).click();
    await expect(page.getByTestId("inbox-flow")).toContainText("Playwright Customer");
    await page.reload();
    await expect(page.getByTestId("inbox-flow")).toContainText("Playwright Customer");
    await page.getByRole("button", { name: /siparişler/i }).click();
    await expect(page.getByTestId("orders-flow")).toContainText("ORD-PLAYWRIGHT");
    await page.getByRole("button", { name: /kargo/i }).click();
    await expect(page.getByTestId("shipments-flow")).toContainText("TRK-PLAYWRIGHT");
    await page.getByRole("button", { name: /ayarlar/i }).click();
    await expect(page.getByTestId("admin-flow")).toContainText("webphone.enabled");
    await page.getByRole("button", { name: /dosya/i }).click();
    await page.getByRole("button", { name: /presigned upload testi/i }).click();
    await expect(page.getByTestId("file-upload-flow")).toContainText("kanit.txt kaydedildi");
    await page.getByRole("button", { name: /santral/i }).click();
    await expect(page.getByTestId("webphone-flow")).toContainText("sip.example.com");
    await page.getByRole("button", { name: /çıkış/i }).click();
    await expect(page.getByRole("button", { name: /giriş yap/i })).toBeVisible();
  } finally {
    await closeWebApp(app.server);
  }

  expect(requestedUrls).toEqual(
    expect.arrayContaining([
      "/auth/login",
      "/auth/me",
      "/auth/logout",
      "/api/conversations",
      "/api/orders",
      "/api/shipments",
      "/admin/settings",
      "/api/files/uploads",
      "/presigned/uploads/kanit.txt",
      "/api/webphone/config",
    ]),
  );
  expect(requestedUrls.some((path) => path.includes("supabase"))).toBe(false);
});

function loginBody() {
  return {
    access_token: "playwright-token",
    refresh_token: "refresh-token",
    token_type: "Bearer",
    expires_in: 900,
    user: {
      public_id: "usr_playwright",
      email: "admin@example.com",
      first_name: "Admin",
      last_name: "User",
      role: "admin",
      permissions: ["admin:settings:read"],
      sip_username: "1001",
    },
  };
}
