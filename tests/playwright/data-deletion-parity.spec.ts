import { expect, type Page, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

// /veri-silme (legacy DataDeletionPage): public KVKK form + `?ref=` status lookup, and the admin
// "Veri Silme" tab in Ayarlar that reviews the stored requests.
const backendBaseUrl = "http://127.0.0.1:65522";

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

function request(overrides: Record<string, unknown> = {}) {
  return {
    public_id: "ddr_1", reference: "DEL-ABC123", source: "form", full_name: "Zeynep Kaya", email: "zeynep@example.com", phone: null, instagram_username: "zeynep.k",
    messenger_psid: null, description: "Lütfen silin", status: "pending", resolution_note: null, requested_at: now, resolved_at: null, created_at: now, ...overrides,
  };
}

async function mockBackend(page: Page, role = "admin") {
  const state = { requests: [] as Array<{ method: string; path: string; search: string; body: unknown }> };
  await page.addInitScript(`window.__GARANTI_REALTIME_SOCKET_FACTORY__ = () => ({ connect() {}, disconnect() {}, emit() {}, on() {}, off() {} });`);
  await page.route(`${backendBaseUrl}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const body = req.postData() ? (JSON.parse(req.postData() ?? "{}") as unknown) : undefined;
    state.requests.push({ method, path: url.pathname, search: url.search, body });
    const json = (status: number, payload: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
    if (url.pathname === "/auth/login") return json(200, { access_token: "dd-token", refresh_token: "dd-refresh", token_type: "Bearer", expires_in: 900, user: user(role) });
    if (url.pathname === "/auth/me" || url.pathname === "/auth/presence") return json(200, user(role));
    if (url.pathname === "/api/app-settings/ai-status") return json(200, { ai_enabled: false });
    if (url.pathname === "/api/veri-silme-talebi" && method === "POST") {
      const input = body as { ad: string; email: string | null };
      if (input.email === "down@example.com") return json(500, { error: { code: "internal_error", message: "Sunucu hatası" } });
      return json(201, { success: true, message: "Veri silme talebi alındı.", referans: "DEL-NEW1", reference: "DEL-NEW1" });
    }
    if (url.pathname === "/api/veri-silme-talebi/DEL-ABC123") return json(200, { reference: "DEL-ABC123", status: "completed", requested_at: now, resolved_at: now });
    if (url.pathname.startsWith("/api/veri-silme-talebi/")) return json(404, { error: { code: "not_found", message: "Talep bulunamadı" } });
    if (url.pathname === "/admin/data-deletion-requests" && method === "GET") {
      const status = url.searchParams.get("status");
      const rows = [request(), request({ public_id: "ddr_2", reference: "DEL-FB1", source: "facebook", full_name: null, email: null, instagram_username: null, messenger_psid: "1234567890", description: null, status: "in_progress" })];
      return json(200, { data: status ? rows.filter((row) => row.status === status) : rows, total_count: 2, limit: 100, offset: 0 });
    }
    if (url.pathname === "/admin/data-deletion-requests/ddr_1" && method === "PATCH") {
      const input = body as { status: string; note: string | null };
      return json(200, { request: request({ status: input.status, resolution_note: input.note, resolved_at: now }) });
    }
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

test.describe("Data deletion request (legacy DataDeletionPage)", () => {
  let app: Awaited<ReturnType<typeof startWebApp>>;

  test.beforeAll(async () => {
    app = await startWebApp();
  });

  test.afterAll(async () => {
    await (app.server as ViteDevServer).close();
  });

  test("validates and sends the public form, then shows the stored reference", async ({ page }) => {
    const state = await mockBackend(page);
    await page.goto(`${app.url}/veri-silme`);
    const pageRoot = page.getByTestId("deletion-public-page");
    await expect(pageRoot.getByRole("heading", { name: "Veri Silme Talebi" })).toBeVisible();
    await expect(pageRoot).toContainText("Silinecek Veriler");
    const form = page.getByTestId("deletion-form");
    await form.getByRole("button", { name: "Veri Silme Talebini Gönder" }).click();
    await expect(page.getByTestId("deletion-error")).toHaveText("Ad Soyad alanı zorunludur.");
    await form.locator('input[name="ad"]').fill("Zeynep Kaya");
    await form.getByRole("button", { name: "Veri Silme Talebini Gönder" }).click();
    await expect(page.getByTestId("deletion-error")).toContainText("En az bir iletişim bilgisi");
    await form.locator('input[name="instagram"]').fill("@zeynep.k");
    await form.getByRole("button", { name: "Veri Silme Talebini Gönder" }).click();
    await expect(page.getByTestId("deletion-error")).toHaveText("Veri silme talebini onaylamanız gerekmektedir.");
    await form.locator('input[name="email"]').fill("down@example.com");
    await form.locator('input[name="onay"]').check();
    await form.getByRole("button", { name: "Veri Silme Talebini Gönder" }).click();
    await expect(page.getByTestId("deletion-error")).toHaveText("Talep gönderilemedi: Sunucu hatası");
    await form.locator('input[name="email"]').fill("zeynep@example.com");
    await form.locator('textarea[name="aciklama"]').fill("Lütfen silin");
    await form.getByRole("button", { name: "Veri Silme Talebini Gönder" }).click();
    await expect(page.getByTestId("deletion-success")).toContainText("Talebiniz Alındı");
    await expect(page.getByTestId("deletion-reference")).toHaveText("DEL-NEW1");
    const sent = state.requests.filter((entry) => entry.method === "POST" && entry.path === "/api/veri-silme-talebi").at(-1)?.body as Record<string, unknown>;
    expect(sent).toMatchObject({ ad: "Zeynep Kaya", email: "zeynep@example.com", telefon: null, instagram_kullanici_adi: "zeynep.k", messenger_psid: null, aciklama: "Lütfen silin" });
    expect(typeof sent.tarih).toBe("string");
    expect(state.requests.every((entry) => !entry.path.startsWith("/auth/me"))).toBe(true);
  });

  test("shows the status for the Meta callback reference", async ({ page }) => {
    await mockBackend(page);
    await page.goto(`${app.url}/veri-silme?ref=DEL-ABC123`);
    await expect(page.getByTestId("deletion-status")).toContainText("DEL-ABC123 · Tamamlandı");
    await page.goto(`${app.url}/veri-silme?ref=DEL-NOPE`);
    await expect(page.getByTestId("deletion-status")).toContainText("Bu referansla bir talep bulunamadı.");
  });

  test("admin reviews and closes requests from Ayarlar → Veri Silme", async ({ page }) => {
    const state = await mockBackend(page);
    await loginAt(page, `${app.url}/ayarlar`);
    await page.getByRole("tab", { name: "Veri Silme" }).click();
    const tab = page.getByTestId("ayarlar-veri-silme");
    await expect(tab.getByTestId("veri-silme-DEL-ABC123")).toContainText("Zeynep Kaya");
    await expect(tab.getByTestId("veri-silme-DEL-FB1")).toContainText("PSID 1234567890");
    await expect(tab.getByTestId("veri-silme-DEL-FB1")).toContainText("Meta geri çağrısı");
    const row = tab.getByTestId("veri-silme-DEL-ABC123");
    await expect(row.getByTestId("veri-silme-save")).toBeDisabled();
    await row.getByTestId("veri-silme-status").selectOption("completed");
    await row.getByTestId("veri-silme-note").fill("Müşteri ve mesajlar silindi");
    await row.getByTestId("veri-silme-save").click();
    await expect(page.getByTestId("ayarlar-mesaj")).toContainText("DEL-ABC123 güncellendi.");
    await expect(row).toContainText("Tamamlandı");
    expect(state.requests.find((entry) => entry.method === "PATCH")?.body).toEqual({ status: "completed", note: "Müşteri ve mesajlar silindi" });
    await tab.getByTestId("veri-silme-filter").selectOption("in_progress");
    await expect.poll(() => state.requests.some((entry) => entry.path === "/admin/data-deletion-requests" && entry.search.includes("status=in_progress"))).toBe(true);
    await expect(tab.getByTestId("veri-silme-DEL-FB1")).toBeVisible();
    await expect(tab.getByTestId("veri-silme-DEL-ABC123")).toHaveCount(0);
  });
});
