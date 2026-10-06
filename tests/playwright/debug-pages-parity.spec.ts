import { expect, type Page, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

// Admin debug pages: /ayarlar/whatsapp-debug, /ayarlar/instagram-debug, /ayarlar/ai-debug, /ayarlar/ai-egitim.
const backendBaseUrl = "http://127.0.0.1:65525";

test.setTimeout(90_000);

function user(role: string) {
  return { public_id: `usr_${role}`, email: `${role}@example.com`, first_name: "Test", last_name: "Debug", role, permissions: [], is_online: true, sip_username: "1003" };
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

async function mockBackend(page: Page, role = "admin") {
  const state = { requests: [] as Array<{ method: string; path: string; search: string; body: unknown }> };
  await page.addInitScript(`window.__GARANTI_REALTIME_SOCKET_FACTORY__ = () => ({ connect() {}, disconnect() {}, emit() {}, on() {}, off() {} });`);
  await page.route(`${backendBaseUrl}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postData() ? (JSON.parse(request.postData() ?? "{}") as unknown) : undefined;
    state.requests.push({ method, path: url.pathname, search: url.search, body });
    const json = (status: number, payload: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });

    if (url.pathname === "/auth/login") return json(200, { access_token: "dbg-token", refresh_token: "dbg-refresh", token_type: "Bearer", expires_in: 900, user: user(role) });
    if (url.pathname === "/auth/me" || url.pathname === "/auth/presence") return json(200, user(role));
    if (url.pathname === "/api/app-settings/ai-status") return json(200, { ai_enabled: true });
    if (url.pathname.startsWith("/api/debug") && role !== "admin") return json(403, { error: { code: "forbidden", message: "Hata ayıklama sayfaları yalnızca yöneticiye açıktır" } });
    const webhooks = [{ public_id: "whe_1", provider: "whatsapp", event_type: "message.webhook", status: "processed", received_at: now, processed_at: now, preview: '{"entry":[{"text":"merhaba","access_token":"[redacted]"}]}' }];
    const attempts = [{ request_id: "req_1", provider: "whatsapp", operation: "message.send", status: "failed", status_code: 401, duration_ms: 120, error_message: "Invalid OAuth access token", started_at: now }];
    if (url.pathname === "/api/debug/whatsapp") {
      return json(200, {
        live_gate: "providers.whatsapp.live_mode", provider_live_mode: false, callback_path: "/webhooks/whatsapp",
        config: { provider: "whatsapp", account_public_id: "iac_wa", display_name: "WhatsApp", status: "active", external_account_id: "1234567890", access_token_configured: true, verify_token_configured: false, account_live_mode: null, live_call_permitted: false, phone_number_id: "1234567890", waba_id: "998877", display_phone_number: "905551112233" },
        stats: { conversation_count: 12, today_inbound: 7, today_outbound: 5 }, webhooks, attempts,
      });
    }
    if (url.pathname === "/api/debug/whatsapp/test-send") return json(202, { provider: "whatsapp", operation: "message.send", request_id: "req_debug_wa_abc", job_id: "job_debug_wa_abc", queued: true, to: "905551112233", live_call_permitted: false });
    if (url.pathname === "/webhooks/whatsapp") {
      if (url.searchParams.get("hub.verify_token") === "dogru-token") return route.fulfill({ status: 200, contentType: "text/plain", body: url.searchParams.get("hub.challenge") ?? "" });
      return json(403, { error: { code: "webhook_verification_failed", message: "Webhook verification failed" } });
    }
    if (url.pathname === "/api/debug/instagram") {
      return json(200, {
        live_gates: { instagram: "providers.instagram.live_mode", messenger: "providers.messenger.live_mode" }, provider_live_mode: { instagram: true, messenger: false },
        callback_paths: { instagram: "/webhooks/instagram", messenger: "/webhooks/messenger" },
        accounts: [{ provider: "instagram", account_public_id: "iac_ig", display_name: "Instagram", status: "active", external_account_id: "17841", access_token_configured: true, verify_token_configured: true, account_live_mode: true, live_call_permitted: true }],
        stats: { conversation_count: 4, today_inbound: 2, today_outbound: 1 }, webhooks: [], attempts: [],
      });
    }
    if (url.pathname === "/api/debug/ai") {
      return json(200, {
        config: { provider: "openai", auto_reply_enabled: true, model: "gpt-4o-mini", system_prompt_source: "database", system_prompt_length: 42, live_call_permitted: false, dry_run: true },
        stats: { today_ai_replies: 3, total_ai_replies: 120 },
        recent: [{ public_id: "msg_ai", body: "Merhaba, size nasıl yardımcı olabilirim?", sent_at: now, conversation_public_id: "cnv_1", channel: "whatsapp", customer_name: "Ayşe Yılmaz", customer_phone: "0555" }],
      });
    }
    if (url.pathname === "/api/debug/ai/test") return json(200, { dry_run: true, live_call_permitted: false, reply: "AI yanıt önerisi backend dry-run sınırında tutuldu." });
    if (url.pathname === "/api/debug/ai-training/stats") {
      const answered = url.searchParams.get("answered_only") !== "false";
      return json(200, { total: answered ? 150 : 400, by_channel: answered ? { whatsapp: 120, instagram: 30, messenger: 0 } : { whatsapp: 300, instagram: 90, messenger: 10 }, answered_only: answered });
    }
    if (url.pathname === "/api/debug/ai-training/export") {
      return route.fulfill({ status: 200, contentType: "application/x-ndjson", headers: { "content-disposition": 'attachment; filename="ai-egitim.jsonl"' }, body: '{"messages":[]}\n{"messages":[]}\n' });
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

test.describe("admin debug pages", () => {
  let app: Awaited<ReturnType<typeof startWebApp>>;

  test.beforeAll(async () => {
    app = await startWebApp();
  });

  test.afterAll(async () => {
    await (app.server as ViteDevServer).close();
  });

  test("WhatsApp debug: config flags, stats, test send, webhook verification, events and attempts", async ({ page }) => {
    const state = await mockBackend(page);
    await loginAt(page, `${app.url}/ayarlar`);
    await page.getByTestId("ayarlar-tabs").getByRole("tab", { name: "Genel" }).click();
    await page.getByTestId("debug-links").getByRole("link", { name: "WhatsApp Debug" }).click();
    await expect(page).toHaveURL(/\/ayarlar\/whatsapp-debug$/);
    const debug = page.getByTestId("whatsapp-debug");
    await expect(debug.getByTestId("whatsapp-debug-config")).toContainText("1234567890");
    await expect(debug.getByTestId("whatsapp-debug-config")).toContainText("Eksik");
    await expect(debug.getByTestId("whatsapp-debug-config")).toContainText("Kapalı (kuru çalıştırma)");
    await expect(debug.getByTestId("debug-stats")).toContainText("7");
    await expect(debug.getByTestId("whatsapp-debug-callback")).toHaveText(`${app.url}/webhooks/whatsapp`);
    await expect(debug.getByTestId("debug-webhooks")).toContainText("[redacted]");
    await expect(debug.getByTestId("debug-attempts")).toContainText("Invalid OAuth access token");

    await debug.getByTestId("whatsapp-test-to").fill("+90 555 111 22 33");
    await debug.getByTestId("whatsapp-test-send").getByRole("button", { name: "Gönder" }).click();
    await expect(debug.getByTestId("whatsapp-test-result")).toHaveText("Kuyruğa alındı: req_debug_wa_abc");
    expect(state.requests.find((request) => request.path === "/api/debug/whatsapp/test-send")?.body).toMatchObject({ to: "+90 555 111 22 33", idempotency_key: expect.stringMatching(/^wa-debug:/) });

    await debug.getByTestId("debug-verify-token").fill("yanlis");
    await debug.getByTestId("debug-webhook-test").getByRole("button", { name: "Testi çalıştır" }).click();
    await expect(debug.getByTestId("debug-webhook-result")).toContainText("Doğrulama başarısız: Webhook verification failed");
    await debug.getByTestId("debug-verify-token").fill("dogru-token");
    await debug.getByTestId("debug-webhook-test").getByRole("button", { name: "Testi çalıştır" }).click();
    await expect(debug.getByTestId("debug-webhook-result")).toHaveText("Doğrulama başarılı: challenge eşleşti.");

    const before = state.requests.filter((request) => request.path === "/api/debug/whatsapp").length;
    await debug.getByTestId("debug-refresh").click();
    await expect.poll(() => state.requests.filter((request) => request.path === "/api/debug/whatsapp").length).toBe(before + 1);
  });

  test("Instagram and AI debug pages", async ({ page }) => {
    const state = await mockBackend(page);
    await loginAt(page, `${app.url}/ayarlar/instagram-debug`);
    const instagram = page.getByTestId("instagram-debug");
    await expect(instagram.getByTestId("instagram-debug-account-instagram")).toContainText("17841");
    await expect(instagram.getByTestId("instagram-debug-account-instagram")).toContainText("Açık");
    await expect(instagram.getByTestId("instagram-debug-callback-messenger")).toHaveText(`${app.url}/webhooks/messenger`);

    await page.goto(`${app.url}/ayarlar/ai-debug`);
    const ai = page.getByTestId("ai-debug");
    await expect(ai.getByTestId("ai-debug-config")).toContainText("gpt-4o-mini");
    await expect(ai.getByTestId("ai-debug-config")).toContainText("Veritabanı (42 karakter)");
    await expect(ai.getByTestId("ai-debug-stats")).toContainText("120");
    await expect(ai.getByTestId("ai-debug-recent")).toContainText("Ayşe Yılmaz");
    await ai.getByTestId("ai-debug-message").fill("Kuluçka makinesi fiyatı nedir?");
    await ai.getByTestId("ai-debug-test").getByRole("button", { name: "Test et" }).click();
    await expect(ai.getByTestId("ai-debug-reply")).toContainText("dry-run");
    expect(state.requests.find((request) => request.path === "/api/debug/ai/test")?.body).toEqual({ message: "Kuluçka makinesi fiyatı nedir?" });
  });

  test("AI training export: stats, filters, batches and download", async ({ page }) => {
    const state = await mockBackend(page);
    await loginAt(page, `${app.url}/ayarlar/ai-egitim`);
    const training = page.getByTestId("ai-training");
    await expect(training.getByTestId("ai-training-total")).toHaveText("Dışa aktarılabilir konuşma: 150");
    await training.getByTestId("ai-training-answered").uncheck();
    await expect(training.getByTestId("ai-training-total")).toHaveText("Dışa aktarılabilir konuşma: 400");
    await training.getByTestId("ai-training-channel").selectOption("whatsapp");
    await expect(training.getByTestId("ai-training-total")).toHaveText("Dışa aktarılabilir konuşma: 300");
    await training.getByRole("button", { name: "Sonraki parti" }).click();
    await expect(training.getByTestId("ai-training-batch")).toHaveText("Parti 101–200");
    await training.getByRole("button", { name: "Önceki parti" }).click();
    await expect(training.getByTestId("ai-training-batch")).toHaveText("Parti 1–100");
    await training.getByTestId("ai-training-channel").selectOption("instagram");
    await expect(training.getByTestId("ai-training-total")).toHaveText("Dışa aktarılabilir konuşma: 90");
    await expect(training.getByRole("button", { name: "Sonraki parti" })).toBeDisabled();

    const [download] = await Promise.all([page.waitForEvent("download"), training.getByTestId("ai-training-download").click()]);
    expect(download.suggestedFilename()).toBe("ai-egitim-0-100.jsonl");
    await expect(training.getByTestId("ai-training-notice")).toHaveText("2 konuşma indirildi.");
    expect(state.requests.find((request) => request.path === "/api/debug/ai-training/export")?.search).toBe("?format=jsonl&answered_only=false&offset=0&limit=100&channel=instagram");
  });

  test("staff are redirected away; English and 360px layout for admins", async ({ page, browser }) => {
    await mockBackend(page, "calisan");
    await loginAt(page, `${app.url}/ayarlar/ai-debug`, "calisan");
    await expect(page).not.toHaveURL(/ai-debug/);
    await expect(page.getByTestId("ai-debug")).toHaveCount(0);

    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await admin.setViewportSize({ width: 360, height: 740 });
    await mockBackend(admin);
    await admin.addInitScript(() => window.localStorage.setItem("garanti-lang", "en"));
    await loginAt(admin, `${app.url}/ayarlar/whatsapp-debug`);
    await expect(admin.getByTestId("whatsapp-debug")).toContainText("Recent webhook events");
    const overflow = await admin.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await adminContext.close();
  });
});
