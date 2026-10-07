import { expect, type Page, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

// /iptaller — legacy IptallerPage list: iptal + iade orders, filter, search, detail, geri al, kalıcı sil, notes.
const backendBaseUrl = "http://127.0.0.1:65523";

test.setTimeout(90_000);

function user(role: string) {
  return { public_id: `usr_${role}`, email: `${role}@example.com`, first_name: "Test", last_name: "İptal", role, permissions: [], is_online: true, sip_username: null };
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
  if (pathname === "/api/orders") return { data: [], meta: { total_count: 0, limit: 20, offset: 0 } };
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

function order(publicId: string, orderNumber: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    public_id: publicId, order_number: orderNumber, status, source: "panel", cargo_provider: "ptt", total_amount: "1250.00", currency: "TRY",
    confirmation_status: null, notes: null, customer_full_name: "Ayşe Yılmaz", created_by_user_public_id: null, created_by_user_email: null,
    created_at: "2026-10-01T09:00:00.000Z", updated_at: now, ...extra,
  };
}

function actionState(row: ReturnType<typeof order>, invoiceId: string | null) {
  return {
    public_id: row.public_id, order_number: row.order_number, status: row.status, notes: row.notes, total_amount: row.total_amount, currency: row.currency,
    customer_full_name: row.customer_full_name, customer_phone: "05551112233", deleted_at: null, confirmation_status: null,
    kolaybi: { contact_id: null, address_id: null, invoice_id: invoiceId, status: null, error: null, e_document_status: invoiceId ? "approved" : null },
    confirmation_call: { status: null, bulk_id: null, pressed_key: null, listen_seconds: null, call_count: 0 },
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

async function mockBackend(page: Page, role = "admin") {
  const rows = [
    order("ord_c1", "GK-1001", "cancelled", { notes: "Müşteri vazgeçti" }),
    order("ord_r1", "GK-1002", "returned", { customer_full_name: "Mehmet Kaya" }),
    order("ord_c2", "GK-1003", "cancelled", { customer_full_name: "Zeynep Ak" }),
  ];
  const state = { requests: [] as Array<{ method: string; path: string; search: string; body: unknown }>, rows };
  await page.addInitScript(`window.__GARANTI_REALTIME_SOCKET_FACTORY__ = () => ({ connect() {}, disconnect() {}, emit() {}, on() {}, off() {} });`);
  await page.route(`${backendBaseUrl}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postData() ? (JSON.parse(request.postData() ?? "{}") as unknown) : undefined;
    state.requests.push({ method, path: url.pathname, search: url.search, body });
    const json = (status: number, payload: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });

    if (url.pathname === "/auth/login") return json(200, { access_token: "ip-token", refresh_token: "ip-refresh", token_type: "Bearer", expires_in: 900, user: user(role) });
    if (url.pathname === "/auth/me" || url.pathname === "/auth/presence") return json(200, user(role));
    if (url.pathname === "/api/app-settings/ai-status") return json(200, { ai_enabled: false });
    if (url.pathname === "/api/orders" && url.searchParams.get("status")) {
      const status = url.searchParams.get("status");
      const search = (url.searchParams.get("search") ?? "").toLocaleLowerCase("tr");
      const data = state.rows
        .filter((row) => status === "cancellations" ? ["cancelled", "returned"].includes(row.status) : row.status === status)
        .filter((row) => !search || row.order_number.toLocaleLowerCase("tr").includes(search) || (row.customer_full_name ?? "").toLocaleLowerCase("tr").includes(search));
      return json(200, { data, meta: { total_count: data.length, limit: 25, offset: 0 } });
    }
    const match = url.pathname.match(/^\/api\/orders\/(ord_[a-z0-9]+)(\/[a-z]+)?$/);
    if (match) {
      const row = state.rows.find((entry) => entry.public_id === match[1]);
      if (!row) return json(404, { error: { code: "not_found", message: "Order not found" } });
      const invoiceId = row.public_id === "ord_c1" ? "kb_inv_77" : null;
      if (match[2] === "/actions") return json(200, { order: actionState(row, invoiceId), steps: [] });
      if (match[2] === "/restore") {
        state.rows = state.rows.filter((entry) => entry.public_id !== row.public_id);
        return json(200, { order: { ...actionState(row, invoiceId), status: "draft" } });
      }
      if (match[2] === "/notes") {
        row.notes = (body as { notes: string | null }).notes;
        return json(200, { order: actionState(row, invoiceId) });
      }
      if (!match[2] && method === "DELETE") {
        state.rows = state.rows.filter((entry) => entry.public_id !== row.public_id);
        return json(200, {
          deleted: true, replayed: false, commission_preserved: true, order: { ...actionState(row, invoiceId), deleted_at: now },
          e_document_cancel: invoiceId ? { public_id: "ops_1", action: "e_document_cancel", provider: "kolaybi", operation: "invoice.e_document.cancel", attempt: 1, status: "queued", request_id: "req_1", job_id: "job_1", queued: true, error_message: null, created_at: now, updated_at: now } : null,
        });
      }
    }
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

test.describe("İptaller (legacy IptallerPage)", () => {
  let app: Awaited<ReturnType<typeof startWebApp>>;

  test.beforeAll(async () => {
    app = await startWebApp();
  });

  test.afterAll(async () => {
    await (app.server as ViteDevServer).close();
  });

  test("lists cancelled and returned orders, filters, searches and saves a note", async ({ page }) => {
    const state = await mockBackend(page, "calisan");
    await loginAt(page, `${app.url}/iptaller`, "calisan");
    const list = page.getByTestId("cancellations-list");
    await expect(list.getByTestId("iptal-row")).toHaveCount(3);
    await expect(list.getByTestId("iptal-total")).toHaveText("3 sipariş");
    const listQuery = state.requests.find((entry) => entry.path === "/api/orders" && entry.search.includes("status=cancellations"));
    expect(listQuery?.search).toContain("sort_by=updated_at");
    expect(listQuery?.search).toContain("sort_direction=desc");

    await list.getByTestId("iptal-filter-returned").click();
    await expect(list.getByTestId("iptal-row")).toHaveCount(1);
    await expect(list.getByTestId("iptal-table")).toContainText("GK-1002");
    await list.getByTestId("iptal-filter-cancellations").click();
    await list.getByTestId("iptal-search").fill("zeynep");
    await expect(list.getByTestId("iptal-row")).toHaveCount(1);
    await expect(list.getByTestId("iptal-table")).toContainText("GK-1003");
    await list.getByTestId("iptal-search").fill("");
    await expect(list.getByTestId("iptal-row")).toHaveCount(3);

    const first = list.getByTestId("iptal-row").filter({ hasText: "GK-1002" });
    await first.getByTestId("iptal-note").fill("Kargo hasarlı geldi");
    await first.getByTestId("iptal-note-save").click();
    await expect(list.getByTestId("iptal-notice")).toHaveText("Not kaydedildi");
    expect(state.requests.find((entry) => entry.method === "PATCH" && entry.path === "/api/orders/ord_r1/notes")?.body).toEqual({ notes: "Kargo hasarlı geldi" });
  });

  test("restores an order and permanently deletes an invoiced one after confirmation", async ({ page }) => {
    const state = await mockBackend(page);
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.accept();
    });
    await loginAt(page, `${app.url}/iptaller`);
    const list = page.getByTestId("cancellations-list");
    await expect(list.getByTestId("iptal-row")).toHaveCount(3);

    await list.getByTestId("iptal-row").filter({ hasText: "GK-1002" }).getByTestId("iptal-restore").click();
    await expect(list.getByTestId("iptal-notice")).toContainText("Sipariş geri alındı");
    expect(dialogs[0]).toContain("\"GK-1002\" siparişi geri alınacak");
    await expect(list.getByTestId("iptal-row")).toHaveCount(2);
    expect(state.requests.some((entry) => entry.method === "POST" && entry.path === "/api/orders/ord_r1/restore")).toBe(true);

    await list.getByTestId("iptal-row").filter({ hasText: "GK-1001" }).getByTestId("iptal-details").click();
    const detail = page.getByTestId("iptal-detail");
    await expect(detail.getByTestId("iptal-detail-invoice")).toHaveText("kb_inv_77");
    await expect(detail).toContainText("05551112233");
    await detail.getByTestId("iptal-detail-delete").click();
    await expect(list.getByTestId("iptal-notice")).toContainText("KolayBi e-belge iptali kuyruğa alındı");
    expect(dialogs[1]).toContain("KolayBi e-belgesi iptal kuyruğuna alınacak");
    await expect(page.getByTestId("iptal-detail")).toHaveCount(0);
    await expect(list.getByTestId("iptal-row")).toHaveCount(1);
    const removal = state.requests.find((entry) => entry.method === "DELETE" && entry.path === "/api/orders/ord_c1");
    expect((removal?.body as { idempotency_key: string }).idempotency_key).toMatch(/^iptal_sil_/);
  });

  test("dismissing the confirmation changes nothing; English and 360px without horizontal scroll", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 780 } });
    const page = await context.newPage();
    await page.addInitScript(() => window.localStorage.setItem("garanti-lang", "en"));
    const state = await mockBackend(page);
    page.on("dialog", (dialog) => void dialog.dismiss());
    await loginAt(page, `${app.url}/iptaller`);
    const list = page.getByTestId("cancellations-list");
    await expect(list.getByRole("heading", { name: "Cancelled and Returned Orders" })).toBeVisible();
    await expect(list.getByTestId("iptal-row")).toHaveCount(3);
    await list.getByTestId("iptal-row").first().getByTestId("iptal-restore").click();
    await expect(list.getByTestId("iptal-row")).toHaveCount(3);
    expect(state.requests.some((entry) => entry.path.endsWith("/restore"))).toBe(false);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });
});
