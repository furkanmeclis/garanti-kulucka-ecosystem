import { expect, type Page, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

// /sesli-asistan/sesli-mesajlar (legacy SesliMesajlarPage) and /sesli-asistan/rehber (legacy RehberPage).
// NetGSM is never called: sends and report queries are provider-delivery jobs; SIP uses a fake engine.
const backendBaseUrl = "http://127.0.0.1:65524";

test.setTimeout(90_000);

function user(role: string) {
  return { public_id: `usr_${role}`, email: `${role}@example.com`, first_name: "Test", last_name: "Ses", role, permissions: [], is_online: true, sip_username: "1003" };
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


const now = "2026-10-06T09:00:00.000Z";

function voiceMessage(overrides: Record<string, unknown> = {}) {
  return {
    public_id: "vms_1",
    recipients: ["05551112233", "05559998877"],
    recipient_count: 2,
    message: "Siparişiniz kargoya verildi",
    audio_id: null,
    ringtime: 20,
    status: "sent",
    bulk_id: "987654",
    error_message: null,
    report: null,
    report_checked_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

async function mockBackend(page: Page, role = "admin") {
  const state = { requests: [] as Array<{ method: string; path: string; search: string; body: unknown }>, reportQueued: false };
  await page.addInitScript(`
    window.__GARANTI_REALTIME_SOCKET_FACTORY__ = () => ({ connect() {}, disconnect() {}, emit() {}, on() {}, off() {} });
    window.__VOICE_SIP_ACTIONS__ = [];
    window.__GARANTI_SIP_ENGINE_FACTORY__ = (config, events) => ({
      start: () => events.onRegistration("registered"),
      stop: () => {},
      call: (target) => {
        window.__VOICE_SIP_ACTIONS__.push("call:" + target);
        events.onCall({ id: "out_1", direction: "outgoing", remote: target, remoteName: null, phase: "ringing", held: false, muted: false, startedAt: null, endReason: null });
      },
      answer: () => {},
      hangup: () => events.onCall(null),
      setHold: () => {},
      setMuted: () => {},
      sendDtmf: () => {},
    });
  `);
  await page.route(`${backendBaseUrl}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postData() ? (JSON.parse(request.postData() ?? "{}") as unknown) : undefined;
    state.requests.push({ method, path: url.pathname, search: url.search, body });
    const json = (status: number, payload: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });

    if (url.pathname === "/auth/login") return json(200, { access_token: "vm-token", refresh_token: "vm-refresh", token_type: "Bearer", expires_in: 900, user: user(role) });
    if (url.pathname === "/auth/me" || url.pathname === "/auth/presence") return json(200, user(role));
    if (url.pathname === "/api/app-settings/ai-status") return json(200, { ai_enabled: false });
    if (url.pathname === "/api/webphone/config") {
      return json(200, { enabled: true, sip_websocket_url: "wss://pbx.example.com/ws", sip_domain: "pbx.example.com", sip_username: "1003", sip_password: "sip-secret", ice_servers: [], media_proxy_enabled: false, transport: "direct_sip_over_webrtc" });
    }
    if (url.pathname.startsWith("/api/netgsm/") && role !== "admin") return json(403, { error: { code: "forbidden", message: "Admin role is required" } });
    if (url.pathname === "/api/netgsm/sesli-mesaj" && method === "POST") {
      const payload = body as { recipients: string[]; message?: string; audio_id?: string; ringtime: number };
      return json(202, {
        voice_message: voiceMessage({ public_id: "vms_new", recipients: payload.recipients, recipient_count: payload.recipients.length, message: payload.message ?? null, audio_id: payload.audio_id ?? null, ringtime: payload.ringtime, status: "queued", bulk_id: null }),
        replayed: false, queued: true, live_gate: "providers.netgsm.live_mode", live_call_permitted: false,
      });
    }
    if (url.pathname === "/api/netgsm/sesli-mesaj") {
      const rows = [voiceMessage(), voiceMessage({ public_id: "vms_2", message: null, audio_id: "445566", status: "dry_run", bulk_id: null, recipient_count: 1, recipients: ["05550001122"], error_message: "Canlı NetGSM kapalı; istek kuru çalıştırıldı (providers.netgsm.live_mode ve hesap onayı gerekli)." })];
      const status = url.searchParams.get("status");
      const data = status ? rows.filter((row) => row.status === status) : rows;
      return json(200, { data, total_count: data.length, recipient_total: data.reduce((sum, row) => sum + row.recipient_count, 0), limit: 25, offset: 0, live_gate: "providers.netgsm.live_mode" });
    }
    if (url.pathname === "/api/netgsm/sesli-mesaj/vms_1/rapor") {
      state.reportQueued = true;
      return json(202, { voice_message: voiceMessage(), replayed: false, queued: true, live_gate: "providers.netgsm.live_mode", live_call_permitted: false });
    }
    if (url.pathname === "/api/netgsm/sesli-mesaj/vms_1") {
      const report = state.reportQueued
        ? { report_ready: true, message: null, rows: [{ phone: "05551112233", status: "cevaplandi", pressed_key: "1", listen_seconds: 14 }, { phone: "05559998877", status: "mesgul", pressed_key: null, listen_seconds: 0 }] }
        : null;
      return json(200, { voice_message: voiceMessage({ report, report_checked_at: state.reportQueued ? now : null }), live_gate: "providers.netgsm.live_mode" });
    }
    if (url.pathname === "/api/netgsm/status") return json(200, { configured: true, live_gate: "providers.netgsm.live_mode" });
    if (url.pathname === "/api/netgsm/teyit-settings") return json(200, { settings: { aktif: false, ilk_arama_dakika: 5, max_deneme: 3, deneme_arasi_dakika: 10 } });
    // Admin dashboard data loads as a whole; /api/webphone/config (click-to-call) arrives with it.
    if (url.pathname === "/api/files/orphans") return json(200, { data: [], summary: { total_count: 0 } });
    if (url.pathname === "/admin/integrations/provider-debug-summary") {
      const provider = (key: string) => ({ provider_key: key, total_attempts: 0, success_count: 0, failure_count: 0, retry_count: 0, average_duration_ms: 0, latest_attempt: null });
      return json(200, {
        providers: [provider("ptt"), provider("surat")],
        cron: { provider_keys: ["ptt", "surat"], operation: "shipment.track", total_attempts: 0, success_count: 0, failure_count: 0, retry_count: 0, total_duration_ms: 0, latest_attempt: null },
      });
    }
    if (url.pathname === "/api/netgsm/rehber") {
      const rows = [
        { kind: "staff", public_id: "usr_op", name: "Ayşe Operatör", phone: null, extension: "1001", role: "calisan" },
        { kind: "customer", public_id: "cus_1", name: "Ahmet Yılmaz", phone: "05551112233", extension: null, role: null },
      ];
      const kind = url.searchParams.get("kind");
      const data = kind ? rows.filter((row) => row.kind === kind) : rows;
      return json(200, { data, total_count: data.length, limit: 50, offset: 0 });
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

test.describe("NetGSM voice messages and phonebook", () => {
  let app: Awaited<ReturnType<typeof startWebApp>>;

  test.beforeAll(async () => {
    app = await startWebApp();
  });

  test.afterAll(async () => {
    await (app.server as ViteDevServer).close();
  });

  test("sends a bulk voice message through the provider-delivery API and reads the per-number report", async ({ page }) => {
    const state = await mockBackend(page);
    await loginAt(page, `${app.url}/sesli-asistan`);
    await page.getByTestId("calls-voice-messages-link").click();
    await expect(page).toHaveURL(/\/sesli-asistan\/sesli-mesajlar$/);
    const voice = page.getByTestId("voice-messages-page");
    await expect(voice.getByRole("heading", { name: "Sesli Mesajlar" })).toBeVisible();

    await voice.getByTestId("voice-send").click();
    await expect(voice.getByTestId("voice-notice")).toContainText("Geçerli en az bir telefon numarası girin.");
    await voice.getByTestId("voice-recipients").fill("0555 111 22 33\n05559998877, 05551112233\nabc");
    await expect(voice.getByTestId("voice-recipient-count")).toHaveText("2 numara");
    await voice.getByTestId("voice-send").click();
    await expect(voice.getByTestId("voice-notice")).toContainText("Mesaj metni veya ses dosyası ID gerekli.");
    await voice.getByTestId("voice-message-text").fill("Siparişiniz kargoya verildi");
    await voice.getByTestId("voice-ringtime").selectOption("25");
    await voice.getByTestId("voice-send").click();
    await expect(voice.getByTestId("voice-notice")).toContainText("Sesli mesaj kuyruğa alındı (2 numara).");
    await expect(voice.getByTestId("voice-notice")).toContainText("providers.netgsm.live_mode");
    const sent = state.requests.find((entry) => entry.method === "POST" && entry.path === "/api/netgsm/sesli-mesaj");
    expect(sent?.body).toMatchObject({ recipients: ["05551112233", "05559998877"], message: "Siparişiniz kargoya verildi", ringtime: 25 });
    expect((sent?.body as { idempotency_key: string }).idempotency_key).toMatch(/^voice_/);

    await voice.getByTestId("voice-tab-reports").click();
    await expect(voice.getByTestId("voice-row")).toHaveCount(2);
    await expect(voice.getByTestId("voice-total")).toHaveText("2");
    await expect(voice.getByTestId("voice-table")).toContainText("Ses dosyası #445566");
    await expect(voice.getByTestId("voice-table")).toContainText("Kuru çalıştırma");
    await voice.getByTestId("voice-status-filter").selectOption("sent");
    await expect(voice.getByTestId("voice-row")).toHaveCount(1);
    expect(state.requests.some((entry) => entry.path === "/api/netgsm/sesli-mesaj" && entry.search.includes("status=sent"))).toBe(true);

    await voice.getByTestId("voice-details").click();
    const detail = page.getByTestId("voice-detail");
    await expect(detail.getByTestId("voice-detail-bulk")).toHaveText("987654");
    await expect(detail).toContainText("Rapor henüz hazır değil.");
    await detail.getByTestId("voice-request-report").click();
    await expect(detail).toContainText("Rapor sorgusu kuyruğa alındı");
    await detail.getByTestId("voice-detail-refresh").click();
    await expect(detail.getByTestId("voice-report-table")).toContainText("Cevaplandı");
    await expect(detail.getByTestId("voice-report-table")).toContainText("Meşgul");
    await expect(detail.getByTestId("voice-report-table")).toContainText("14");
  });

  test("phonebook lists customers and staff extensions with click-to-call", async ({ page }) => {
    const state = await mockBackend(page);
    await loginAt(page, `${app.url}/sesli-asistan/rehber`);
    const book = page.getByTestId("phonebook-page");
    await expect(book.getByTestId("phonebook-row")).toHaveCount(2);
    await expect(book.getByTestId("phonebook-table")).toContainText("Ayşe Operatör");
    await expect(book.getByTestId("phonebook-table")).toContainText("1001");
    await expect(book.getByTestId("click-to-call").first()).toBeEnabled();
    await book.getByTestId("phonebook-row").filter({ hasText: "Ahmet Yılmaz" }).getByTestId("click-to-call").click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __VOICE_SIP_ACTIONS__: string[] }).__VOICE_SIP_ACTIONS__)).toContain("call:05551112233");

    await book.getByTestId("phonebook-kind").selectOption("staff");
    await expect(book.getByTestId("phonebook-row")).toHaveCount(1);
    await book.getByTestId("phonebook-search").fill("ayşe");
    await book.getByTestId("phonebook-search").press("Enter");
    await expect.poll(() => state.requests.some((entry) => entry.path === "/api/netgsm/rehber" && entry.search.includes("kind=staff") && entry.search.includes("search="))).toBe(true);
    await book.getByTestId("open-voice-messages").click();
    await expect(page).toHaveURL(/\/sesli-asistan\/sesli-mesajlar$/);
  });

  test("English labels and 360px layout without horizontal scroll", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 780 } });
    const page = await context.newPage();
    await page.addInitScript(() => window.localStorage.setItem("garanti-lang", "en"));
    await mockBackend(page);
    await loginAt(page, `${app.url}/sesli-asistan/sesli-mesajlar`);
    const voice = page.getByTestId("voice-messages-page");
    await expect(voice.getByRole("heading", { name: "Voice Messages" })).toBeVisible();
    await expect(voice.getByTestId("voice-tab-send")).toHaveText("Send");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.goto(`${app.url}/sesli-asistan/rehber`);
    await expect(page.getByTestId("phonebook-page").getByRole("heading", { name: "Phonebook" })).toBeVisible();
    await context.close();
  });

  test("hidden from employees and not in the main navigation", async ({ page }) => {
    await mockBackend(page, "calisan");
    await loginAt(page, `${app.url}/sesli-asistan/sesli-mesajlar`, "calisan");
    await expect(page.getByTestId("voice-messages-page")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sesli Mesajlar" })).toHaveCount(0);
  });
});
