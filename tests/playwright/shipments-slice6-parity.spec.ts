import { expect, type Page, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

const backendBaseUrl = "http://127.0.0.1:65531";

test.setTimeout(60_000);

interface PlaywrightUser {
  public_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: "calisan" | "kargo_operatoru";
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

for (const role of ["kargo_operatoru", "calisan"] as const) {
  test(`Kargo operasyon listesi actions use backend API as ${role}`, async ({ page }) => {
    const app = await startWebApp();
    const shipmentQueryUrls: string[] = [];
    const trackPayloads: unknown[] = [];
    const statusPayloads: unknown[] = [];
    let user = loginUser(role);
    let lastEventText = "Accepted at branch";
    let shipmentStatus = "in_transit";

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

      if (url.pathname === "/api/shipments/summary") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            total_count: 25,
            active_count: 17,
            delivered_count: 8,
            recipient_phone_count: 2,
            provider_counts: { ptt: 12, surat: 7, other: 6 },
            exception_counts: { ptt_not_delivered: 4, surat_not_delivered: 3, tracking_missing: 6 },
          }),
        });
        return;
      }
      if (url.pathname === "/api/shipments/pipeline-summary") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ counts: { all: 0, mesaj: 0, sms: 0, vapi: 0, teslim: 0, bekliyor: 0, isleniyor: 0, hata: 0 }, rows: [] }),
        });
        return;
      }
      if (url.pathname === "/api/shipments/shp_slice6") {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(shipmentRow({ last_event_text: lastEventText, status: shipmentStatus })) });
        return;
      }
      if (url.pathname === "/api/shipments/shp_slice6/track") {
        trackPayloads.push(JSON.parse(route.request().postData() ?? "{}"));
        await route.fulfill({
          contentType: "application/json",
          status: 202,
          body: JSON.stringify({
            provider: "ptt",
            operation: "shipment.track",
            request_id: `req_track_${role}`,
            job_id: `job_track_${role}`,
            queued: true,
            shipment_public_id: "shp_slice6",
            tracking_number: "TRK-SLICE6",
            live_call_permitted: false,
            live_gate: "providers.ptt.live_mode",
          }),
        });
        return;
      }
      if (url.pathname === "/api/shipments/shp_slice6/status") {
        statusPayloads.push(JSON.parse(route.request().postData() ?? "{}"));
        shipmentStatus = "delivered";
        lastEventText = "Teslim edildi";
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(shipmentRow({ status: shipmentStatus, last_event_text: lastEventText })) });
        return;
      }
      if (url.pathname === "/api/shipments") {
        shipmentQueryUrls.push(`${url.pathname}${url.search}`);
        const rows = url.searchParams.get("offset") === "20"
          ? [shipmentRow({ public_id: "shp_slice6_page2", tracking_number: "TRK-SLICE6-P2", order_number: "ORD-SLICE6-P2" })]
          : [shipmentRow({ last_event_text: lastEventText, status: shipmentStatus })];
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            data: rows,
            meta: { total_count: 25, limit: Number(url.searchParams.get("limit") ?? 20), offset: Number(url.searchParams.get("offset") ?? 0) },
          }),
        });
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
      await expect(page.getByRole("link", { name: /^Kargo$/ })).toBeVisible();
      await page.getByRole("link", { name: /^Kargo$/ }).click();
      await expect(page.getByTestId("shipments-flow")).toContainText("Kargo Gönderileri");
      await expect(page.getByTestId("shipment-table")).toContainText("Kargo Firma");
      await expect(page.getByTestId("shipment-table")).toContainText("Takip No / Aktar");
      await expect(page.getByTestId("shipment-table")).toContainText("Müşteri");
      await expect(page.getByTestId("shipment-table")).toContainText("Kargo Durumu");

      await page.getByTestId("shipment-filter-ptt").click();
      await expect(page.getByTestId("shipments-flow")).toContainText("TRK-SLICE6");
      await page.getByTestId("shipment-search").fill("ORD-SLICE6");
      await page.getByRole("button", { name: "Ara" }).click();
      await expect(page.getByTestId("shipments-flow")).toContainText("ORD-SLICE6");
      await page.getByTestId("shipment-next-page").click();
      await expect(page.getByTestId("shipments-flow")).toContainText("TRK-SLICE6-P2");

      await page.getByTestId("shipment-prev-page").click();
      await page.getByTestId("shipment-detail-action").first().click();
      await expect(page.getByTestId("shipment-detail")).toContainText("Accepted at branch");
      await expect(page.getByTestId("shipment-tracking-history")).toContainText("Kadıköy / İstanbul");

      await page.getByTestId("shipment-track-action").first().click();
      await expect(page.getByTestId("shipment-track-result")).toContainText("ptt shipment.track queued");
      expect(trackPayloads).toHaveLength(1);

      // Wait for the status PATCH to reach the mocked route before asserting its payload (was racing the click).
      await Promise.all([
        page.waitForResponse((response) => new URL(response.url()).pathname === "/api/shipments/shp_slice6/status"),
        page.getByTestId("shipment-status-action").first().click(),
      ]);
      expect(statusPayloads).toEqual([expect.objectContaining({ status: "delivered" })]);
      await expect(page.getByTestId("shipment-detail")).toContainText("Teslim edildi");

      lastEventText = "Realtime hareket";
      await page.evaluate(() => {
        window.__GARANTI_REALTIME_TEST__?.emitServer("shipment.updated", {
          event: "shipment.updated",
          id: "rt_shipments_slice6",
          occurred_at: "2026-01-01T00:10:00.000Z",
          payload: { shipment_public_id: "shp_slice6", status: "in_transit", tracking_number: "TRK-SLICE6" },
        });
      });
      await expect(page.getByTestId("shipments-flow")).toContainText("Realtime hareket");

      expect(shipmentQueryUrls).toEqual(
        expect.arrayContaining([
          "/api/shipments?limit=20",
          "/api/shipments?provider=ptt&limit=20",
          "/api/shipments?provider=ptt&search=ORD-SLICE6&limit=20",
          "/api/shipments?provider=ptt&search=ORD-SLICE6&limit=20&offset=20",
        ]),
      );
    } finally {
      await closeWebApp(app.server);
    }
  });
}

function shipmentRow(overrides: Partial<ReturnType<typeof shipmentRowBase>> = {}) {
  return {
    ...shipmentRowBase(),
    ...overrides,
  };
}

function shipmentRowBase() {
  return {
    public_id: "shp_slice6",
    provider: "ptt",
    tracking_number: "TRK-SLICE6",
    barcode_number: "BAR-SLICE6",
    status: "in_transit",
    recipient_name: "Slice Müşteri",
    recipient_phone: "05551234567",
    recipient_city: "İstanbul",
    recipient_district: "Kadıköy",
    last_event_text: "Accepted at branch",
    order_number: "ORD-SLICE6",
    customer_full_name: "Slice Customer",
    tracking_events: [
      {
        public_id: "ste_slice6",
        status: "in_transit",
        description: "Accepted at branch",
        location: "Kadıköy / İstanbul",
        occurred_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function fallbackResponse(pathname: string) {
  const emptyData = { data: [] };
  if (pathname === "/api/conversations") return emptyData;
  if (pathname === "/api/conversations/summary") return { total_count: 0, unread_count: 0, pool_count: 0, human_agent_count: 0, channel_counts: { instagram: 0, facebook: 0 }, status_counts: { open: 0, closed: 0 } };
  if (pathname === "/api/customers") return emptyData;
  if (pathname === "/api/customers/summary") return { total_count: 0, with_phone_count: 0, with_email_count: 0, with_notes_count: 0 };
  if (pathname === "/api/comments/moderation-summary") return { manual_queue: 0, automatic_queue: 0, answered: 0, instagram: 0, facebook: 0 };
  if (pathname === "/api/balances/summary") return { total_commission: 0, total_deduction: 0, pending_payment: 0, available_balance: 0, pending_request_count: 0 };
  if (pathname === "/api/orders") return emptyData;
  if (pathname === "/api/orders/summary") return { total_count: 0, active_count: 0, delivered_count: 0, pending_confirmation_count: 0, total_revenue: 0, currency: "TRY" };
  if (pathname === "/api/products") return emptyData;
  if (pathname === "/api/products/summary") return { total_count: 0, active_count: 0, critical_count: 0, critical_threshold: 3, category_counts: { incubator: 0, spare_part: 0, other: 0 } };
  if (pathname === "/api/message-shortcuts") return emptyData;
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

function loginUser(role: PlaywrightUser["role"]): PlaywrightUser {
  return {
    public_id: role === "kargo_operatoru" ? "usr_kargo_slice6" : "usr_calisan_slice6",
    email: role === "kargo_operatoru" ? "kargo@example.com" : "calisan@example.com",
    first_name: "Kargo",
    last_name: "Kullanıcı",
    role,
    permissions: [],
    is_online: true,
    sip_username: role,
  };
}

function loginBody(user: PlaywrightUser) {
  return {
    access_token: `shipments-slice6-token-${user.role}`,
    refresh_token: `shipments-slice6-refresh-${user.role}`,
    token_type: "Bearer",
    expires_in: 900,
    user,
  };
}
