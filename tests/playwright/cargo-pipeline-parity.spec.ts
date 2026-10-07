import { expect, type Page, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

// /kargo/pipeline (legacy KargoPipelinePage + KargoPipelineTestPaneli): pipeline rows from /api/cargo-pipeline,
// status filter, manager-only row actions / delete / test panel, and read-only view for staff.
const backendBaseUrl = "http://127.0.0.1:65532";

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

function item(overrides: Record<string, unknown> = {}) {
  return {
    public_id: "cpl_1", shipment_public_id: "shp_1", order_public_id: "ord_1", conversation_public_id: "cnv_1", vapi_call_public_id: null,
    channel: "whatsapp", phone: "05551234567", customer_name: "Ayşe Yılmaz", tracking_number: "KP123", cargo_provider: "ptt",
    last_event_text: "Şubede bekliyor - Kadıköy", step: "sms", status: "bekliyor", next_run_at: now, force_run: false, attempt_count: 1, max_attempts: 3,
    error_message: "Mesaj atlandı: konusma_yok", created_at: now, updated_at: now, ...overrides,
  };
}

async function mockBackend(page: Page, role = "admin") {
  const state = { requests: [] as Array<{ method: string; path: string; search: string; body: unknown }> };
  const rows = [item(), item({ public_id: "cpl_2", customer_name: "Mehmet Demir", conversation_public_id: null, channel: null, step: "teslim", status: "teslim", error_message: null })];
  await page.addInitScript(`window.__GARANTI_REALTIME_SOCKET_FACTORY__ = () => ({ connect() {}, disconnect() {}, emit() {}, on() {}, off() {} });`);
  await page.route(`${backendBaseUrl}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const body = req.postData() ? (JSON.parse(req.postData() ?? "{}") as unknown) : undefined;
    state.requests.push({ method, path: url.pathname, search: url.search, body });
    const json = (status: number, payload: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
    if (url.pathname === "/auth/login") return json(200, { access_token: "cp-token", refresh_token: "cp-refresh", token_type: "Bearer", expires_in: 900, user: user(role) });
    if (url.pathname === "/auth/me" || url.pathname === "/auth/presence") return json(200, user(role));
    if (url.pathname === "/api/app-settings/ai-status") return json(200, { ai_enabled: false });
    if (url.pathname === "/api/cargo-pipeline" && method === "GET") {
      const status = url.searchParams.get("status");
      const data = status ? rows.filter((row) => row.status === status) : rows;
      return json(200, { data, total: data.length, page: 1, page_size: 50 });
    }
    if (url.pathname === "/api/cargo-pipeline/config") {
      return json(200, { config: { aktif: true, baslangic_saati: "09:00", bitis_saati: "20:00", mesaj_gecikme_dk: 0, sms_gecikme_dk: 30, vapi_gecikme_dk: 60, max_deneme: 3, mesaj_sablonu: "Sayın {musteri_adi}, kargonuz ({takip_no}) {son_hareket}. Takip: {takip_link}" } });
    }
    if (url.pathname === "/api/cargo-pipeline/cpl_1/actions" && method === "POST") {
      const action = (body as { action: string }).action;
      return json(200, { item: item(action === "cancel" ? { status: "iptal" } : action === "skip" ? { step: "vapi" } : { force_run: true }) });
    }
    if (url.pathname === "/api/cargo-pipeline/cpl_2" && method === "DELETE") return json(200, { deleted: true });
    if (url.pathname === "/api/cargo-pipeline/test" && method === "POST") {
      const input = body as { type: string };
      if (input.type === "vapi") return json(422, { error: { code: "vapi_disabled", message: "VAPI devre dışı. Ayarlardan etkinleştirin." } });
      return json(202, { type: input.type, queued: true, job_ids: ["job_1"], message: "x", live_gate: "providers.netgsm.live_mode" });
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

test.describe("Cargo pipeline (legacy KargoPipelinePage)", () => {
  let app: Awaited<ReturnType<typeof startWebApp>>;

  test.beforeAll(async () => {
    app = await startWebApp();
  });

  test.afterAll(async () => {
    await (app.server as ViteDevServer).close();
  });

  test("lists pipeline rows, filters by status and applies manager actions", async ({ page }) => {
    const state = await mockBackend(page);
    await loginAt(page, `${app.url}/kargo/pipeline`);
    const root = page.getByTestId("shipment-pipeline-flow");
    await expect(root).toContainText("Teslim Alınmayan Kargo Pipeline");
    await expect(page.getByTestId("cargo-pipeline-total")).toContainText("2");
    const row = page.getByTestId("cargo-pipeline-row-cpl_1");
    await expect(row).toContainText("Ayşe Yılmaz");
    await expect(row).toContainText("SMS");
    await expect(row).toContainText("Bekliyor");
    await expect(row).toContainText("Deneme: 1/3");
    await expect(row).toContainText("Mesaj atlandı: konusma_yok");
    await expect(page.getByTestId("cargo-pipeline-row-cpl_2")).toContainText("Teslim");
    await expect(page.getByTestId("cargo-pipeline-row-cpl_2").getByTestId("cargo-pipeline-run-now")).toHaveCount(0);

    await page.getByTestId("cargo-pipeline-filter-teslim").click();
    await expect(page.getByTestId("cargo-pipeline-filter-teslim")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("cargo-pipeline-row-cpl_1")).toHaveCount(0);
    await expect(page.getByTestId("cargo-pipeline-total")).toContainText("1");
    expect(state.requests.some((entry) => entry.path === "/api/cargo-pipeline" && entry.search.includes("status=teslim"))).toBe(true);
    await page.getByTestId("cargo-pipeline-filter-tumu").click();

    await row.getByTestId("cargo-pipeline-run-now").click();
    await expect(page.getByTestId("cargo-pipeline-toast")).toContainText("bir dakika içinde işlenecek");
    await row.getByTestId("cargo-pipeline-cancel").click();
    await expect(row).toContainText("İptal");
    await expect(row.getByTestId("cargo-pipeline-cancel")).toHaveCount(0);
    const actions = state.requests.filter((entry) => entry.path === "/api/cargo-pipeline/cpl_1/actions").map((entry) => (entry.body as { action: string }).action);
    expect(actions).toEqual(["run_now", "cancel"]);

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByTestId("cargo-pipeline-row-cpl_2").getByTestId("cargo-pipeline-delete").click();
    await expect(page.getByTestId("cargo-pipeline-row-cpl_2")).toHaveCount(0);
    await expect(page.getByTestId("cargo-pipeline-toast")).toContainText("Kayıt silindi");
  });

  test("test panel previews the template and sends SMS / message / VAPI tests", async ({ page }) => {
    const state = await mockBackend(page);
    await loginAt(page, `${app.url}/kargo/pipeline`);
    const panel = page.getByTestId("cargo-pipeline-test");
    await expect(page.getByTestId("cargo-pipeline-test-preview")).toContainText("Sayın Test Müşteri, kargonuz (TEST-000) şubede bekliyor. Takip: https://gonderitakip.ptt.gov.tr/Track/Verify?q=TEST-000");
    await panel.getByTestId("cargo-pipeline-test-sms").click();
    await expect(page.getByTestId("cargo-pipeline-toast")).toContainText("Lütfen telefon numarası girin");
    await page.getByTestId("cargo-pipeline-test-phone").fill("0555 123 45 67");
    await panel.getByTestId("cargo-pipeline-test-sms").click();
    await expect(page.getByTestId("cargo-pipeline-toast")).toContainText("Test kuyruğa alındı (providers.netgsm.live_mode)");
    await panel.getByTestId("cargo-pipeline-test-message").click();
    await expect(page.getByTestId("cargo-pipeline-toast")).toContainText("konuşma ID gerekli");
    await page.getByTestId("cargo-pipeline-test-conversation").fill("cnv_1");
    await panel.getByTestId("cargo-pipeline-test-message").click();
    await expect(page.getByTestId("cargo-pipeline-toast")).toContainText("Test kuyruğa alındı");
    await panel.getByTestId("cargo-pipeline-test-vapi").click();
    await expect(page.getByTestId("cargo-pipeline-toast")).toContainText("Test başarısız: VAPI devre dışı");
    const sent = state.requests.filter((entry) => entry.path === "/api/cargo-pipeline/test").map((entry) => entry.body as Record<string, unknown>);
    expect(sent.map((entry) => entry.type)).toEqual(["sms", "mesaj", "vapi"]);
    expect(sent[1]).toMatchObject({ phone: "0555 123 45 67", conversation_public_id: "cnv_1", tracking_number: "TEST-000", cargo_provider: "PTT" });
  });

  test("staff see the rows read-only without the test panel", async ({ page }) => {
    await mockBackend(page, "calisan");
    await loginAt(page, `${app.url}/kargo/pipeline`, "calisan");
    await expect(page.getByTestId("cargo-pipeline-row-cpl_1")).toContainText("Ayşe Yılmaz");
    await expect(page.getByTestId("cargo-pipeline-test")).toHaveCount(0);
    await expect(page.getByTestId("cargo-pipeline-run-now")).toHaveCount(0);
    await expect(page.getByTestId("cargo-pipeline-delete")).toHaveCount(0);
  });
});
