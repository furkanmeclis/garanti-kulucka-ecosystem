import { expect, type Page, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

// Legacy SiparislerPage "Siparişi Düzenle" modal: GET /api/orders/{id}/edit + PATCH /api/orders/{id}.
const backendBaseUrl = "http://127.0.0.1:65533";

test.setTimeout(90_000);

function user(role: string) {
  return { public_id: `usr_${role}`, email: `${role}@example.com`, first_name: "Test", last_name: "Admin", role, permissions: [], is_online: true, sip_username: null };
}

async function startWebApp() {
  const server = await createServer({
    root: "apps/web",
    configFile: "apps/web/vite.config.ts",
    server: { host: "127.0.0.1", port: 0 },
    define: { "import.meta.env.VITE_BACKEND_BASE_URL": JSON.stringify(backendBaseUrl) },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Vite dev server did not expose a TCP address");
  return { url: `http://127.0.0.1:${address.port}`, server };
}

function fallbackResponse(pathname: string): unknown {
  const emptyData = { data: [] };
  if (pathname === "/api/conversations" || pathname === "/api/customers" || pathname === "/api/message-shortcuts") return emptyData;
  if (pathname === "/api/conversations/summary") return { total_count: 0, unread_count: 0, pool_count: 0, human_agent_count: 0, channel_counts: {}, status_counts: {} };
  if (pathname === "/api/customers/summary") return { total_count: 0, with_phone_count: 0, with_email_count: 0, with_notes_count: 0 };
  if (pathname === "/api/comments/moderation-summary") return { manual_queue: 0, automatic_queue: 0, answered: 0, instagram: 0, facebook: 0 };
  if (pathname === "/api/balances/summary") return { total_commission: 0, total_deduction: 0, pending_payment: 0, available_balance: 0, pending_request_count: 0 };
    if (pathname === "/api/orders/summary") return { total_count: 0, active_count: 0, delivered_count: 0, pending_confirmation_count: 0, total_revenue: 0, currency: "TRY" };
  if (pathname === "/api/products" || pathname === "/api/orders/product-options" || pathname === "/api/shipments") return emptyData;
  if (pathname === "/api/products/summary") return { total_count: 0, active_count: 0, critical_count: 0, critical_threshold: 3, category_counts: { incubator: 0, spare_part: 0, other: 0 } };
  if (pathname === "/api/shipments/summary") return { total_count: 0, active_count: 0, delivered_count: 0, recipient_phone_count: 0, provider_counts: { ptt: 0, surat: 0, other: 0 }, exception_counts: { ptt_not_delivered: 0, surat_not_delivered: 0, tracking_missing: 0 } };
  if (pathname === "/api/shipments/pipeline-summary") return { counts: { all: 0, mesaj: 0, sms: 0, vapi: 0, teslim: 0, bekliyor: 0, isleniyor: 0, hata: 0 }, rows: [] };
  if (pathname === "/api/reports/summary") return { conversation_count: 0, order_count: 0, shipment_count: 0, total_revenue: 0, currency: "TRY", open_conversation_count: 0, pending_confirmation_count: 0, active_shipment_count: 0, delivered_shipment_count: 0, delivered_shipment_rate: 0, confirmation_rate: 0, active_shipment_rate: 0 };
  if (pathname === "/api/webphone/config") return { enabled: false, sip_username: null, sip_password_configured: false, ws_url: null, domain: null, stun: null };
  if (pathname.startsWith("/admin/")) return { data: [], summary: { total_count: 0 } };
  return undefined;
}


const now = "2026-10-07T09:00:00.000Z";

function editable(overrides: Record<string, unknown> = {}) {
  return {
    public_id: "ord_1", order_number: "GK-1001", status: "draft", cargo_provider: "ptt", notes: null, currency: "TRY", total_amount: "300.00", items_total: "300.00", manual_total: false,
    customer: { public_id: "cus_1", full_name: "Ayşe Yılmaz", phone: "05551234567" },
    address: { address_line: "Moda Cad. 1", city: "İstanbul", district: "Kadıköy" },
    items: [
      { public_id: "oit_1", product_public_id: null, name: "Kuluçka Makinesi", quantity: 1, unit_price: "200.00", total_amount: "200.00" },
      { public_id: "oit_2", product_public_id: null, name: "Yedek Parça", quantity: 2, unit_price: "50.00", total_amount: "100.00" },
    ],
    locked_reason: null, updated_at: now, ...overrides,
  };
}

function listOrder(publicId: string, number: string) {
  return { public_id: publicId, order_number: number, status: "draft", source: "manual", cargo_provider: "ptt", total_amount: "300.00", currency: "TRY", confirmation_status: null, notes: null, customer_full_name: "Ayşe Yılmaz", customer_phone: "05551234567", created_by_user_public_id: "usr_staff", created_by_user_email: "staff@example.com", created_at: now, updated_at: now };
}

async function mockBackend(page: Page, role = "calisan") {
  const state = { requests: [] as Array<{ method: string; path: string; body: unknown }> };
  await page.addInitScript(`window.__GARANTI_REALTIME_SOCKET_FACTORY__ = () => ({ connect() {}, disconnect() {}, emit() {}, on() {}, off() {} });`);
  await page.route(`${backendBaseUrl}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const body = req.postData() ? (JSON.parse(req.postData() ?? "{}") as unknown) : undefined;
    state.requests.push({ method, path: url.pathname, body });
    const json = (status: number, payload: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
    if (url.pathname === "/auth/login") return json(200, { access_token: "oe-token", refresh_token: "oe-refresh", token_type: "Bearer", expires_in: 900, user: user(role) });
    if (url.pathname === "/auth/me" || url.pathname === "/auth/presence") return json(200, user(role));
    if (url.pathname === "/api/app-settings/ai-status") return json(200, { ai_enabled: false });
    if (url.pathname === "/api/orders" && method === "GET") return json(200, { data: [listOrder("ord_1", "GK-1001"), listOrder("ord_2", "GK-1002")], meta: { total_count: 2, limit: 20, offset: 0 } });
    if (url.pathname === "/api/orders/ord_1/edit") return json(200, { order: editable() });
    if (url.pathname === "/api/orders/ord_2/edit") return json(200, { order: editable({ public_id: "ord_2", order_number: "GK-1002", locked_reason: "kolaybi" }) });
    if (url.pathname === "/api/orders/ord_1" && method === "PATCH") {
      const input = body as { notes: string | null };
      if (input.notes === "fail") return json(409, { error: { code: "order_locked", message: "Bu sipariş KolayBi'ye aktarılmış, düzenlenemez.", reason: "kolaybi" } });
      return json(200, { order: editable({ notes: input.notes }) });
    }
    if (/^\/api\/orders\/ord_\d\/actions$/.test(url.pathname)) return json(200, { order: null, steps: [] });
    if (url.pathname === "/admin/settings") return json(200, { data: [] });
    const fallback = fallbackResponse(url.pathname);
    if (fallback !== undefined) return json(200, fallback);
    return json(404, { error: { code: "not_found", message: "not mocked" } });
  });
  return state;
}

async function loginAt(page: Page, url: string, role = "admin") {
  await page.goto(url);
  await page.locator('input[type="email"]').fill(`${role}@example.com`);
  await page.locator('input[type="password"]').fill("secret-password");
  await Promise.all([page.waitForResponse(`${backendBaseUrl}/auth/login`), page.locator('button[type="submit"]').click()]);
}

test.describe("Order edit modal (legacy Siparişi Düzenle)", () => {
  let app: Awaited<ReturnType<typeof startWebApp>>;

  test.beforeAll(async () => {
    app = await startWebApp();
  });

  test.afterAll(async () => {
    await (app.server as ViteDevServer).close();
  });

  test("edits customer, address, lines and the manual total", async ({ page }) => {
    const state = await mockBackend(page);
    await loginAt(page, `${app.url}/siparisler`, "calisan");
    await page.getByTestId("order-row-ord_1").click();
    await page.getByTestId("order-edit-open").click();
    const modal = page.getByTestId("order-edit-modal");
    await expect(modal.getByTestId("order-edit-name")).toHaveValue("Ayşe Yılmaz");
    await expect(modal.getByTestId("order-edit-line")).toHaveCount(2);
    await expect(modal.getByTestId("order-edit-total")).toHaveValue("300.00");

    await modal.getByTestId("order-edit-name").fill("Ayşe Kaya");
    await modal.getByTestId("order-edit-city").fill("Ankara");
    await modal.getByTestId("order-edit-district").fill("Çankaya");
    await modal.getByTestId("order-edit-cargo").selectOption("surat");
    await modal.getByTestId("order-edit-line").nth(1).getByTestId("order-edit-line-remove").click();
    await modal.getByTestId("order-edit-line").first().getByTestId("order-edit-line-quantity").fill("2");
    await modal.getByTestId("order-edit-add-line").click();
    const added = modal.getByTestId("order-edit-line").nth(1);
    await added.getByTestId("order-edit-line-name").fill("Termometre");
    await added.getByTestId("order-edit-line-price").fill("25,5");
    await expect(modal.getByTestId("order-edit-total")).toHaveValue("425.50");
    await modal.getByTestId("order-edit-notes").fill("Kapıya bırakılacak");
    await modal.getByTestId("order-edit-save").click();
    await expect(modal).toHaveCount(0);
    const sent = state.requests.find((entry) => entry.method === "PATCH" && entry.path === "/api/orders/ord_1")?.body;
    expect(sent).toEqual({
      customer: { full_name: "Ayşe Kaya", phone: "05551234567" },
      address: { address_line: "Moda Cad. 1", city: "Ankara", district: "Çankaya" },
      notes: "Kapıya bırakılacak",
      cargo_provider: "surat",
      items: [
        { public_id: "oit_1", product_public_id: null, name: "Kuluçka Makinesi", quantity: 2, unit_price: "200.00" },
        { public_id: null, product_public_id: null, name: "Termometre", quantity: 1, unit_price: "25.50" },
      ],
      total_amount: null,
    });

    await page.getByTestId("order-edit-open").click();
    await modal.getByTestId("order-edit-manual").check();
    await modal.getByTestId("order-edit-total").fill("280");
    await modal.getByTestId("order-edit-notes").fill("fail");
    await modal.getByTestId("order-edit-save").click();
    await expect(modal.getByTestId("order-edit-error")).toHaveText("Güncelleme hatası: Bu sipariş KolayBi'ye aktarılmış, düzenlenemez.");
    const manual = state.requests.filter((entry) => entry.method === "PATCH").at(-1)?.body as Record<string, unknown>;
    expect(manual.total_amount).toBe("280.00");
  });

  test("validates required fields and keeps KolayBi-transferred orders read-only", async ({ page }) => {
    const state = await mockBackend(page, "kargo_operatoru");
    await loginAt(page, `${app.url}/siparisler`, "kargo_operatoru");
    await page.getByTestId("order-row-ord_1").click();
    await page.getByTestId("order-edit-open").click();
    const modal = page.getByTestId("order-edit-modal");
    await modal.getByTestId("order-edit-phone").fill("");
    await modal.getByTestId("order-edit-save").click();
    await expect(modal.getByTestId("order-edit-error")).toHaveText("Müşteri telefonu gerekli");
    await modal.getByRole("button", { name: "Vazgeç" }).click();
    await page.getByTestId("order-row-ord_2").click();
    await page.getByTestId("order-edit-open").click();
    await expect(modal.getByTestId("order-edit-locked")).toHaveText("Bu sipariş KolayBi'ye aktarılmış, düzenlenemez.");
    await expect(modal.getByTestId("order-edit-save")).toBeDisabled();
    await expect(modal.getByTestId("order-edit-name")).toBeDisabled();
    expect(state.requests.some((entry) => entry.method === "PATCH")).toBe(false);
  });
});
