import { expect, type Page, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

// Customer detail page (/musteriler/:id): profile, edit, notes, links to orders and conversations, TR/EN.
const backendBaseUrl = "http://127.0.0.1:65529";

test.setTimeout(90_000);

const user = {
  public_id: "usr_customer_detail",
  email: "calisan@example.com",
  first_name: "Test",
  last_name: "Çalışan",
  role: "calisan",
  permissions: [],
  is_online: true,
  sip_username: "1003",
};

const customer = {
  public_id: "cus_pw",
  full_name: "Playwright Müşteri",
  phone: "+905551112233",
  email: "musteri@example.com",
  username: "pw.ig",
  notes: "İlk not",
  created_at: "2026-01-02T09:00:00.000Z",
  updated_at: "2026-01-03T09:00:00.000Z",
};

const order = {
  public_id: "ord_pw",
  order_number: "GK-7001",
  status: "pending",
  source: "manual",
  cargo_provider: "ptt",
  total_amount: "2550.00",
  currency: "TRY",
  confirmation_status: null,
  notes: null,
  customer_full_name: customer.full_name,
  created_by_user_public_id: user.public_id,
  created_by_user_email: user.email,
  created_at: "2026-01-04T09:00:00.000Z",
  updated_at: "2026-01-04T09:00:00.000Z",
};

const conversation = {
  public_id: "cnv_pw",
  channel: "whatsapp",
  status: "open",
  is_in_pool: false,
  human_agent_enabled: true,
  unread_count: 3,
  last_message_text: "Makine ne zaman gelir?",
  last_message_sender_type: "customer",
  last_message_at: "2026-01-05T09:00:00.000Z",
  customer: { full_name: customer.full_name, phone: customer.phone },
  assigned_user_email: null,
  notes: null,
  updated_at: "2026-01-05T09:00:00.000Z",
};

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
  if (pathname === "/api/conversations") return { data: [conversation] };
  if (pathname === "/api/conversations/summary") {
    return { total_count: 1, unread_count: 3, pool_count: 0, human_agent_count: 0, channel_counts: {}, status_counts: { open: 1 } };
  }
  if (pathname === "/api/conversations/cnv_pw/messages") return emptyData;
  if (pathname === "/api/message-shortcuts") return emptyData;
  if (pathname === "/api/customers/summary") return { total_count: 1, with_phone_count: 1, with_email_count: 1, with_notes_count: 1 };
  if (pathname === "/api/comments/moderation-summary") return { manual_queue: 0, automatic_queue: 0, answered: 0, instagram: 0, facebook: 0 };
  if (pathname === "/api/balances/summary") return { total_commission: 0, total_deduction: 0, pending_payment: 0, available_balance: 0, pending_request_count: 0 };
  if (pathname === "/api/orders") return { data: [order], meta: { total_count: 1, limit: 20, offset: 0 } };
  if (pathname === "/api/orders/summary") return { total_count: 1, active_count: 1, delivered_count: 0, pending_confirmation_count: 1, total_revenue: 2550, currency: "TRY" };
  if (pathname === "/api/products" || pathname === "/api/orders/product-options") return emptyData;
  if (pathname === "/api/products/summary") return { total_count: 0, active_count: 0, critical_count: 0, critical_threshold: 3, category_counts: { incubator: 0, spare_part: 0, other: 0 } };
  if (pathname === "/api/shipments") return emptyData;
  if (pathname === "/api/shipments/summary") return { total_count: 0, active_count: 0, delivered_count: 0, recipient_phone_count: 0, provider_counts: { ptt: 0, surat: 0, other: 0 }, exception_counts: { ptt_not_delivered: 0, surat_not_delivered: 0, tracking_missing: 0 } };
  if (pathname === "/api/shipments/pipeline-summary") return { counts: { all: 0, mesaj: 0, sms: 0, vapi: 0, teslim: 0, bekliyor: 0, isleniyor: 0, hata: 0 }, rows: [] };
  if (pathname === "/api/webphone/config") return { enabled: false, sip_username: null, sip_password_configured: false, ws_url: null, domain: null, stun: null };
  return undefined;
}

async function mockBackend(page: Page) {
  const state = { customer: { ...customer }, patches: [] as unknown[], notePatches: [] as unknown[] };
  await page.addInitScript(`
    window.__GARANTI_REALTIME_SOCKET_FACTORY__ = () => ({ connect() {}, disconnect() {}, emit() {}, on() {}, off() {} });
  `);
  await page.route(`${backendBaseUrl}/**`, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const json = (status: number, payload: unknown) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });

    if (url.pathname === "/auth/login") {
      return json(200, { access_token: "cd-token", refresh_token: "cd-refresh", token_type: "Bearer", expires_in: 900, user });
    }
    if (url.pathname === "/auth/me") return json(200, user);
    if (url.pathname === "/api/customers") return json(200, { data: [state.customer] });
    if (url.pathname === "/api/customers/cus_missing") return json(404, { error: { code: "not_found", message: "Müşteri bulunamadı" } });
    if (url.pathname === "/api/customers/cus_pw" && method === "GET") {
      return json(200, {
        customer: state.customer,
        addresses: [
          { public_id: "adr_pw", label: "Ev", address_line: "Atatürk Cd. No:1", city: "Konya", district: "Merkez", country: "TR", postal_code: "42000", is_default: true },
        ],
        orders: [order],
        conversations: [conversation],
      });
    }
    if (url.pathname === "/api/customers/cus_pw" && method === "PATCH") {
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      state.patches.push(body);
      state.customer = { ...state.customer, ...body, updated_at: "2026-01-06T09:00:00.000Z" } as typeof customer;
      return json(200, state.customer);
    }
    if (url.pathname === "/api/customers/cus_pw/notes" && method === "PATCH") {
      const body = JSON.parse(route.request().postData() ?? "{}") as { notes: string | null };
      state.notePatches.push(body);
      state.customer = { ...state.customer, notes: body.notes ?? "" };
      return json(200, state.customer);
    }
    const fallback = fallbackResponse(url.pathname);
    if (fallback !== undefined) return json(200, fallback);
    return json(404, { error: { code: "not_found", message: "not mocked" } });
  });
  return state;
}

async function loginAt(page: Page, url: string) {
  await page.goto(url);
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill("secret-password");
  await Promise.all([page.waitForResponse(`${backendBaseUrl}/auth/login`), page.locator('button[type="submit"]').click()]);
}

test.describe("customer detail page", () => {
  let app: Awaited<ReturnType<typeof startWebApp>>;

  test.beforeAll(async () => {
    app = await startWebApp();
  });

  test.afterAll(async () => {
    await (app.server as ViteDevServer).close();
  });

  test("opens from the customer list, edits the profile and saves notes", async ({ page }) => {
    const state = await mockBackend(page);
    await loginAt(page, `${app.url}/musteriler`);
    await expect(page.getByTestId("customers-flow")).toBeVisible();
    await page.getByTestId("customer-detail-link").filter({ hasText: "Playwright Müşteri" }).click();

    await expect(page).toHaveURL(/\/musteriler\/cus_pw$/);
    const detail = page.getByTestId("customer-detail");
    await expect(page.getByTestId("customer-detail-name")).toHaveText("Playwright Müşteri");
    await expect(page.getByTestId("customer-detail-profile")).toContainText("musteri@example.com");
    await expect(page.getByTestId("customer-detail-addresses")).toContainText("Atatürk Cd. No:1");
    await expect(page.getByTestId("customer-detail-orders")).toContainText("Siparişler (1)");
    await expect(page.getByTestId("customer-detail-conversations")).toContainText("3 okunmamış");

    await page.getByTestId("customer-edit").click();
    const form = page.getByTestId("customer-edit-form");
    await form.locator('input[name="full_name"]').fill("Playwright Müşteri Güncel");
    await form.locator('input[name="email"]').fill("");
    await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/customers/cus_pw" && response.request().method() === "PATCH"),
      page.getByTestId("customer-save").click(),
    ]);
    expect(state.patches).toEqual([{ full_name: "Playwright Müşteri Güncel", phone: "+905551112233", email: null, username: "pw.ig" }]);
    await expect(page.getByTestId("customer-detail-notice")).toHaveText("Müşteri bilgileri kaydedildi.");
    await expect(page.getByTestId("customer-detail-name")).toHaveText("Playwright Müşteri Güncel");

    await page.getByTestId("customer-notes-input").fill("Tekrar aranacak");
    await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/customers/cus_pw/notes"),
      page.getByTestId("customer-notes-save").click(),
    ]);
    expect(state.notePatches).toEqual([{ notes: "Tekrar aranacak" }]);
    await expect(detail.getByTestId("customer-detail-notice")).toHaveText("Not kaydedildi.");

    await page.getByTestId("customer-detail-back").click();
    await expect(page).toHaveURL(/\/musteriler$/);
  });

  test("links to the customer's orders and conversations", async ({ page }) => {
    await mockBackend(page);
    await loginAt(page, `${app.url}/musteriler/cus_pw`);
    await expect(page.getByTestId("customer-detail-name")).toHaveText("Playwright Müşteri");

    await page.getByTestId("customer-order-link").click();
    await expect(page).toHaveURL(/\/siparisler$/);
    await expect(page.getByTestId("orders-flow")).toContainText("GK-7001");

    await page.goto(`${app.url}/musteriler/cus_pw`);
    await page.getByTestId("customer-conversation-link").click();
    await expect(page).toHaveURL(/\/mesajlar$/);
    await expect(page.getByTestId("inbox-flow")).toContainText("Playwright Müşteri");
  });

  test("shows not found and renders in English", async ({ page }) => {
    await mockBackend(page);
    await page.addInitScript(() => window.localStorage.setItem("garanti-lang", "en"));
    await loginAt(page, `${app.url}/musteriler/cus_missing`);
    await expect(page.getByTestId("customer-detail-missing")).toHaveText("Customer not found.");

    await page.goto(`${app.url}/musteriler/cus_pw`);
    await expect(page.getByTestId("customer-detail-profile")).toContainText("Customer Information");
    await expect(page.getByTestId("customer-detail-orders")).toContainText("Orders (1)");
    await expect(page.getByTestId("customer-detail-back")).toHaveText("Back to customers");
  });

  test("fits a 360px phone without horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await mockBackend(page);
    await loginAt(page, `${app.url}/musteriler/cus_pw`);
    await expect(page.getByTestId("customer-detail-name")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
