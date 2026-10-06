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



type OrderRow = {
  public_id: string;
  order_number: string;
  status: string;
  source: string;
  cargo_provider: string | null;
  total_amount: string;
  currency: string;
  confirmation_status: string | null;
  notes: string | null;
  customer_full_name: string | null;
  created_by_user_public_id: string | null;
  created_by_user_email: string | null;
  created_at: string;
  updated_at: string;
};

function orderRow(publicId: string, customer: string, overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    public_id: publicId,
    order_number: `ORD-${publicId.toUpperCase()}`,
    status: "pending",
    source: "manual",
    cargo_provider: "ptt",
    total_amount: "2550.00",
    currency: "TRY",
    confirmation_status: null,
    notes: null,
    customer_full_name: customer,
    created_by_user_public_id: "usr_kargo",
    created_by_user_email: "personel@example.com",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function shipmentRow(publicId: string, overrides: Record<string, unknown> = {}) {
  return {
    public_id: publicId,
    provider: "surat",
    tracking_number: "SRT900000123",
    barcode_number: null,
    status: "pending",
    recipient_name: "Ayşe Yılmaz",
    recipient_phone: "5551112233",
    recipient_city: "İzmir",
    recipient_district: "Bornova",
    last_event_text: "Sürat barkod bekleniyor",
    order_number: "ORD-ORD_1",
    customer_full_name: "Ayşe Yılmaz",
    tracking_events: [],
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function draftFor(order: OrderRow, overrides: Record<string, unknown> = {}) {
  return {
    order_public_id: order.public_id,
    order_number: order.order_number,
    order_status: order.status,
    total_amount: order.total_amount,
    currency: "TRY",
    cargo_provider: order.cargo_provider,
    recipient: { name: order.customer_full_name, phone: "5551112233", address: "Atatürk Cad. 1", city: "İzmir", district: "Bornova" },
    items: [{ name: "Kuluçka Makinesi", quantity: 1, unit_price: "2550.00", total_amount: "2550.00" }],
    missing_field: null,
    measurements: { ptt: { weight_kg: 1, desi: 15 }, surat: { weight_kg: 1, desi: 18 } },
    existing_shipment: null,
    ...overrides,
  };
}

for (const role of ["admin", "calisan", "kargo_operatoru"] as const) {
  test(`${role} kargo oluşturma, toplu aktarma ve barkodlu fatura yazdırma backend shipment API ile çalışır`, async ({ page }) => {
    const app = await startWebApp();
    const user = loginUser({ role, email: `${role}@example.com` });
    const orders = [
      orderRow("ord_1", "Ayşe Yılmaz"),
      orderRow("ord_2", "Mehmet Kaya", { cargo_provider: null }),
      orderRow("ord_3", "Zeynep Demir", { cargo_provider: "surat" }),
    ];
    const drafts: Record<string, ReturnType<typeof draftFor>> = {
      ord_1: draftFor(orders[0]!),
      ord_2: draftFor(orders[1]!, {
        recipient: { name: "Mehmet Kaya", phone: "5552223344", address: "Kızılay Mah. 5", city: null, district: null },
        missing_field: "İl bilgisi eksik (ORD-ORD_2)",
      }),
      ord_3: draftFor(orders[2]!, {
        existing_shipment: { public_id: "shp_old", provider: "surat", status: "pending", tracking_number: "SRT111", barcode_number: null },
      }),
    };
    const shipments = [
      shipmentRow("shp_1"),
      shipmentRow("shp_2", { provider: "ptt", tracking_number: null, barcode_number: null, recipient_name: "Mehmet Kaya", order_number: "ORD-ORD_2" }),
    ];
    const createCalls: Array<{ path: string; body: Record<string, unknown> }> = [];
    const bulkCalls: Array<Record<string, unknown>> = [];
    const printedCalls: string[] = [];
    const labelCalls: string[] = [];

    page.on("dialog", (dialog) => void dialog.accept());
    await installRealtimeShim(page);

    await page.route(`${backendBaseUrl}/**`, async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

      if (url.pathname === "/auth/login") return json(loginBody(user));
      if (url.pathname === "/auth/me" || url.pathname === "/auth/presence") return json(user);
      if (url.pathname === "/api/conversations") return json({ data: [] });
      if (url.pathname === "/api/conversations/summary") {
        return json({ total_count: 0, unread_count: 0, pool_count: 0, human_agent_count: 0, channel_counts: {}, status_counts: { open: 0 } });
      }
      if (url.pathname === "/api/orders/product-options") return json({ data: [] });
      if (url.pathname === "/admin/integrations/provider-debug-summary") {
        const empty = { total_attempts: 0, success_count: 0, failure_count: 0, retry_count: 0, average_duration_ms: 0, latest_attempt: null };
        return json({
          providers: [{ provider_key: "ptt", ...empty }, { provider_key: "surat", ...empty }],
          cron: { provider_keys: ["ptt", "surat"], operation: "shipment.track", total_attempts: 0, success_count: 0, failure_count: 0, retry_count: 0, total_duration_ms: 0, latest_attempt: null },
        });
      }
      if (url.pathname.startsWith("/admin/") || url.pathname === "/api/files/orphans") return json({ data: [], summary: { total_count: 0 } });
      if (url.pathname === "/api/orders") return json({ data: orders, meta: { total_count: orders.length, limit: 50, offset: 0 } });
      if (url.pathname === "/api/shipments") return json({ data: shipments, meta: { total_count: shipments.length, limit: 50, offset: 0 } });

      const draftMatch = /^\/api\/orders\/([^/]+)\/shipment-draft$/.exec(url.pathname);
      if (draftMatch) return json(drafts[draftMatch[1]!]);

      const createMatch = /^\/api\/orders\/([^/]+)\/shipments$/.exec(url.pathname);
      if (createMatch && method === "POST") {
        const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
        createCalls.push({ path: url.pathname, body });
        return json(
          {
            provider: body.provider,
            operation: "shipment.create",
            request_id: "req_ptt_create",
            job_id: "job_shipment_create",
            queued: true,
            replayed: false,
            live_call_permitted: false,
            live_gate: `providers.${String(body.provider)}.live_mode`,
            order_public_id: createMatch[1],
            order_number: "ORD-ORD_2",
            barcode_number: "2791727900008",
            barcode_range: "27917279",
            barcode_pool_exhausted: false,
            weight_kg: 1,
            desi: 15,
            payment_status: body.payment_status,
            message: "PTT Kargo barkod oluşturuldu! Takip: 2791727900008",
            shipment: shipmentRow("shp_new", { provider: "ptt", tracking_number: null, barcode_number: "2791727900008" }),
          },
          201,
        );
      }
      if (url.pathname === "/api/shipments/bulk-create" && method === "POST") {
        const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
        bulkCalls.push(body);
        const ids = body.order_public_ids as string[];
        return json({
          provider: body.provider,
          created_count: ids.length,
          skipped_count: 0,
          failed_count: 0,
          message: `${ids.length} sipariş Sürat Kargo'ya aktarıldı!`,
          results: ids.map((id) => ({ order_public_id: id, status: "created", reason: null, shipment: null })),
        });
      }
      const printMatch = /^\/api\/shipments\/([^/]+)\/print$/.exec(url.pathname);
      if (printMatch) {
        return json({
          shipment_public_id: printMatch[1],
          provider: "surat",
          provider_label: "Sürat Kargo",
          status: "pending",
          tracking_number: "SRT900000123",
          barcode_number: null,
          barcode_value: "SRT900000123",
          barcode_format: "CODE128",
          payment_type: "cash_on_delivery",
          label_printed_at: null,
          invoice_title: "Sipariş: ORD-ORD_1",
          recipient: { name: "Ayşe Yılmaz", phone: "5551112233", address: "Atatürk Cad. 1", city: "İzmir", district: "Bornova" },
          order: { public_id: "ord_1", order_number: "ORD-ORD_1", total_amount: "2550.00", currency: "TRY", created_at: "2026-01-01T00:00:00.000Z" },
          items: [{ name: "Kuluçka Makinesi", quantity: 1, unit_price: "2550.00", total_amount: "2550.00" }],
          created_at: "2026-01-01T00:00:00.000Z",
        });
      }
      const labelMatch = /^\/api\/shipments\/([^/]+)\/label$/.exec(url.pathname);
      if (labelMatch) {
        const format = url.searchParams.get("format") ?? "pdf";
        labelCalls.push(`${labelMatch[1]}:${format}`);
        const body = format === "pdf" ? "%PDF-1.4\n%%EOF\n" : format === "zpl" ? "^XA\n^XZ\n" : "\nN\nP1\n";
        return route.fulfill({ status: 200, contentType: format === "pdf" ? "application/pdf" : "text/plain", body });
      }
      const printedMatch = /^\/api\/shipments\/([^/]+)\/printed$/.exec(url.pathname);
      if (printedMatch && method === "POST") {
        printedCalls.push(printedMatch[1]!);
        return json({ shipment_public_id: printedMatch[1], label_printed_at: "2026-01-01T00:10:00.000Z" });
      }
      const shipmentMatch = /^\/api\/shipments\/(shp_[^/]+)$/.exec(url.pathname);
      if (shipmentMatch) {
        const found = shipments.find((shipment) => shipment.public_id === shipmentMatch[1]);
        return found ? json(found) : route.fulfill({ status: 404, body: "not found" });
      }

      const fallback = fallbackResponse(url.pathname);
      if (fallback !== undefined) return json(fallback);
      return route.fulfill({ status: 404, body: "not found" });
    });

    try {
      await page.goto(`${app.url}/giris`);
      await page.getByRole("button", { name: /giriş yap/i }).click();
      await expect(page.getByRole("link", { name: /siparişler/i })).toHaveCount(1);
      await page.goto(`${app.url}/siparisler`);

      // single create with missing address completion and payment status
      await page.getByTestId("order-row-ord_2").click();
      const detail = page.getByTestId("order-detail");
      await detail.getByTestId("kargo-aktar-ptt").click();
      const modal = page.getByTestId("kargo-olustur-modal");
      await expect(modal).toContainText("PTT Kargo Barkod Oluştur");
      await expect(modal).toContainText("Müşteri: Mehmet Kaya - 1 Kuluçka Makinesi");
      await expect(modal).toContainText("Tutar: 2.550 TRY");
      await expect(page.getByTestId("kargo-missing-address")).toContainText("Eksik adres bilgilerini tamamlayın:");
      await expect(page.getByTestId("kargo-ilce")).toBeDisabled();
      await page.getByTestId("kargo-il").fill("Ankara");
      await page.getByTestId("kargo-ilce").fill("Çankaya");
      await expect(page.getByTestId("kargo-odeme-durumu")).toHaveValue("karsi_odemeli");
      await page.getByTestId("kargo-odeme-durumu").selectOption("odeme_alindi");
      await page.getByTestId("kargo-barkod-olustur").click();
      await expect(modal).toHaveCount(0);
      await expect(detail.getByTestId("kargo-toast")).toContainText("PTT Kargo barkod oluşturuldu! Takip: 2791727900008");
      expect(createCalls).toHaveLength(1);
      expect(createCalls[0]).toMatchObject({
        path: "/api/orders/ord_2/shipments",
        body: {
          provider: "ptt",
          payment_status: "odeme_alindi",
          recipient_city: "Ankara",
          recipient_district: "Çankaya",
          idempotency_key: expect.stringContaining("kargo_ptt_ord_2"),
        },
      });
      expect(createCalls[0]?.body).not.toHaveProperty("recipient_address");

      // already-created guard
      await page.getByTestId("order-row-ord_3").click();
      await detail.getByTestId("kargo-aktar-surat").click();
      await expect(modal).toContainText("Sürat Kargo Barkod Oluştur");
      await expect(page.getByTestId("kargo-existing-shipment")).toContainText("Bu sipariş için gönderi daha önce oluşturulmuş. Takip: SRT111");
      await expect(page.getByTestId("kargo-barkod-olustur")).toBeDisabled();
      await modal.getByRole("button", { name: "İptal" }).click();
      await expect(modal).toHaveCount(0);

      // toplu kabul (Sürat'e Aktar)
      await page.getByTestId("order-row-ord_1").locator(".orders-row-checkbox").click();
      await page.getByTestId("order-row-ord_2").locator(".orders-row-checkbox").click();
      const bar = page.getByTestId("kargo-toplu-bar");
      await expect(bar).toContainText("2 kargo seçili");
      await bar.getByTestId("kargo-toplu-surat").click();
      await expect(bar.getByTestId("kargo-toast")).toContainText("2 sipariş Sürat Kargo'ya aktarıldı!");
      expect(bulkCalls).toEqual([
        { provider: "surat", order_public_ids: ["ord_1", "ord_2"], idempotency_key: expect.stringContaining("toplu_surat") },
      ]);

      // barkodlu fatura print view
      await page.goto(`${app.url}/kargo`);
      await page.getByTestId("shipment-detail-action").nth(1).click();
      await expect(page.getByTestId("shipment-detail")).toContainText("Önce kargoya aktarın");
      await expect(page.getByTestId("kargo-yazdir")).toHaveCount(0);
      await page.getByTestId("shipment-detail-action").first().click();
      await page.getByTestId("kargo-yazdir").click();
      const printView = page.getByTestId("kargo-print-view");
      await expect(printView).toContainText("Kargo Etiketi + e-Fatura");
      await expect(page.getByTestId("kargo-print-page")).toContainText("Sipariş: ORD-ORD_1");
      await expect(page.getByTestId("kargo-print-barkod")).toContainText("Sürat Kargo - Kargo Takip");
      await expect(page.getByTestId("kargo-print-takip-no")).toHaveText("SRT900000123");
      await expect(page.getByTestId("kargo-print-barcode-svg").locator("rect").first()).toBeAttached();
      await expect(page.getByTestId("kargo-print-barcode-svg")).toContainText("SRT900000123");

      for (const format of ["pdf", "zpl", "epl"] as const) {
        const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId(`kargo-label-${format}`).click()]);
        expect(download.suggestedFilename()).toBe(`etiket-SRT900000123.${format}`);
      }
      expect(labelCalls).toEqual(["shp_1:pdf", "shp_1:zpl", "shp_1:epl"]);

      await page.emulateMedia({ media: "print" });
      await expect(page.locator("#root")).toBeHidden();
      await expect(page.getByTestId("kargo-print-page")).toBeVisible();
      await page.emulateMedia({ media: "screen" });

      await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
      await expect(page.getByTestId("kargo-print-done")).toHaveText("Yazdırıldı");
      await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
      expect(printedCalls).toEqual(["shp_1"]);
      await page.getByTestId("kargo-print-close").click();
      await expect(printView).toHaveCount(0);
    } finally {
      await closeWebApp(app.server);
    }
  });
}

function fallbackResponse(pathname: string) {
  const emptyData = { data: [] };
  if (pathname === "/api/customers") {
    return {
      data: [
        {
          public_id: "cus_media",
          full_name: "Slice Müşteri",
          phone: "5550000000",
          email: null,
          username: null,
          notes: null,
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
  }
  if (pathname === "/api/message-shortcuts") return emptyData;
  if (pathname === "/api/customers/summary") return { total_count: 0, with_phone_count: 0, with_email_count: 0, with_notes_count: 0 };
  if (pathname === "/api/comments/moderation-summary") return { manual_queue: 0, automatic_queue: 0, answered: 0, instagram: 0, facebook: 0 };
  if (pathname === "/api/balances/summary") return { total_commission: 0, total_deduction: 0, pending_payment: 0, available_balance: 0, pending_request_count: 0 };
  if (pathname === "/api/orders/summary") return { total_count: 0, active_count: 0, delivered_count: 0, pending_confirmation_count: 0, total_revenue: 0, currency: "TRY" };
  if (pathname === "/api/products") return emptyData;
  if (pathname === "/api/products/summary") return { total_count: 0, active_count: 0, critical_count: 0, critical_threshold: 3, category_counts: { incubator: 0, spare_part: 0, other: 0 } };
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
