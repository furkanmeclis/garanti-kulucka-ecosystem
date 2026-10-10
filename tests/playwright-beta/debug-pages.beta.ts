import { expect, test, type Page } from "@playwright/test";
import { backendBaseUrl, expectResponsiveLayout, login, mockBackend, mockUser, pathOf, viewports, type ExtraRoute, chooseOption } from "./helpers";

test.use({ serviceWorkers: "block" });

const now = Date.UTC(2026, 9, 7, 9);
const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

const stats = { conversation_count: 42, today_inbound: 7, today_outbound: 5 };
const webhook = { public_id: "wh_1", provider: "whatsapp", event_type: "messages", status: "processed", received_at: at(5), processed_at: at(4), preview: '{"from":"90555***"}' };
const providerAttempt = { request_id: "req_wa_prev", provider: "whatsapp", operation: "message.send", status: "failed", status_code: 400, duration_ms: 321, error_message: "Recipient not allowed", started_at: at(10) };

const whatsapp = {
  live_gate: "providers.whatsapp.live_mode",
  provider_live_mode: false,
  callback_path: "/webhooks/whatsapp",
  config: {
    provider: "whatsapp", account_public_id: "acc_wa", display_name: "Garanti WA", status: "active", external_account_id: "123", access_token_configured: true, verify_token_configured: false,
    account_live_mode: false, live_call_permitted: false, phone_number_id: "PN-998", waba_id: "WABA-77", display_phone_number: "+90 555 000 00 00",
  },
  stats,
  webhooks: [webhook],
  attempts: [providerAttempt],
};

const instagram = {
  live_gates: { instagram: "providers.instagram.live_mode", messenger: "providers.messenger.live_mode" },
  provider_live_mode: { instagram: false, messenger: false },
  callback_paths: { instagram: "/webhooks/instagram", messenger: "/webhooks/messenger" },
  accounts: [
    { provider: "instagram", account_public_id: "acc_ig", display_name: "garantikulucka", status: "active", external_account_id: "IG-1", access_token_configured: true, verify_token_configured: true, account_live_mode: false, live_call_permitted: false },
  ],
  stats: { conversation_count: 18, today_inbound: 3, today_outbound: 2 },
  webhooks: [{ ...webhook, public_id: "wh_ig", provider: "instagram", event_type: "comments" }],
  attempts: [],
};

const ai = {
  config: { provider: "openai", auto_reply_enabled: true, model: "gpt-test", system_prompt_source: "database", system_prompt_length: 640, live_call_permitted: false, dry_run: true },
  stats: { today_ai_replies: 4, total_ai_replies: 1234 },
  recent: [{ public_id: "msg_ai_1", body: "Merhaba, siparişiniz yolda.", sent_at: at(3), conversation_public_id: "cnv_1", channel: "instagram", customer_name: "Ayşe Yılmaz", customer_phone: null }],
};

function attempt(overrides: Record<string, unknown>) {
  return {
    public_id: "pa_x", provider_key: "surat", account_public_id: null, request_id: "req_x", operation: "shipment.create", direction: "outbound", status: "success", status_code: 200, duration_ms: 100,
    retry_decision: "none", next_retry_at: null, idempotency_key: null, request_metadata: {}, provider_request_preview: null, response_metadata: { ok: true }, error_code: null, error_message: null,
    started_at: at(1), updated_at: at(1), ...overrides,
  };
}

const suratAttempts = [
  attempt({
    public_id: "pa_s1", request_id: "req_s1", operation: "shipment.create", duration_ms: 200, started_at: at(2),
    provider_request_preview: { method: "POST", path: "/kargoya-gonder", headers: { Authorization: "Bearer should-not-show", "Content-Type": "application/json" }, body: { alici: "Mehmet Demir", password: "hidden-value" }, live_call_performed: false },
  }),
  attempt({ public_id: "pa_s2", request_id: "req_s2", operation: "shipment.track", status: "failed", duration_ms: 400, error_code: "timeout", error_message: "Sürat zaman aşımı", started_at: at(3), provider_request_preview: { method: "GET", path: "/kargo-takip", headers: {}, body: null, live_call_performed: false } }),
  attempt({ public_id: "pa_s3", request_id: "req_s3", operation: "shipment.track", retry_decision: "retried", duration_ms: 600, started_at: at(4), provider_request_preview: { method: "GET", path: "/kargo-takip", headers: {}, body: null, live_call_performed: false } }),
];
const pttAttempts = [attempt({ public_id: "pa_p1", provider_key: "ptt", request_id: "req_p1", operation: "shipment.track", duration_ms: 2500, started_at: at(6), response_metadata: { updated: 3 } })];
const catalog = [{ provider: "surat", channels: ["cargo"], supported_operations: ["shipment.create"], contract_mode: "fixture_only", live_feature_flag_key: "providers.surat.live_mode", live_call_permitted: false, live_block_reason: "fixture_replay_contract_required" }];

const trainingStats = (answeredOnly: boolean) => ({ total: answeredOnly ? 240 : 300, by_channel: { whatsapp: 120, instagram: 80, messenger: 40 }, answered_only: answeredOnly });

function routes(): ExtraRoute {
  let triggerCount = 0;
  return ({ method, path, url, body }) => {
    if (path === "/api/debug/whatsapp" && method === "GET") return { status: 200, body: whatsapp };
    if (path === "/api/debug/whatsapp/test-send" && method === "POST") return { status: 202, body: { request_id: "req_wa_1", queued: true, live_call_permitted: false } };
    if (path === "/api/debug/instagram") return { status: 200, body: instagram };
    if (path === "/api/debug/ai") return { status: 200, body: ai };
    if (path === "/api/debug/ai/test" && method === "POST") return { status: 200, body: { reply: `Kuru yanıt: ${(body as { message: string }).message}`, dry_run: true } };
    if (path === "/api/debug/ai-training/stats") return { status: 200, body: trainingStats(url.searchParams.get("answered_only") === "true") };
    if (path === "/api/debug/ai-training/export") return { status: 200, body: [{ messages: [] }, { messages: [] }] };
    if (path === "/admin/integrations/provider-catalog") return { status: 200, body: { data: catalog } };
    if (path === "/admin/integrations/provider-attempts") {
      const provider = url.searchParams.get("provider_key");
      if (method === "DELETE") return { status: 200, body: { provider_key: provider, operation: url.searchParams.get("operation"), deleted: provider === "ptt" ? 4 : 9 } };
      return { status: 200, body: { data: provider === "ptt" ? pttAttempts : provider === "surat" ? suratAttempts : [] } };
    }
    const cron = /^\/admin\/integrations\/provider-cron-triggers\/(ptt|surat)$/.exec(path);
    if (cron && method === "POST") {
      triggerCount += 1;
      return { status: 202, body: attempt({ public_id: `pa_cron_${triggerCount}`, provider_key: cron[1], request_id: `req_cron_${triggerCount}`, operation: "shipment.track", started_at: new Date().toISOString(), response_metadata: { dry_run: true } }) };
    }
    return undefined;
  };
}

async function open(page: Page, role = "admin", viewport: { width: number; height: number } = viewports.desktop) {
  await page.setViewportSize(viewport);
  const state = await mockBackend(page, mockUser(role), { extra: routes() });
  await page.goto("/giris");
  await login(page, state);
  await expect.poll(() => pathOf(page)).not.toBe("/giris");
  return state;
}

test("whatsapp debug: config, stats, logs, dry-run test send and webhook verification", async ({ page }) => {
  const state = await open(page);
  const verifyUrls: string[] = [];
  await page.route(`${backendBaseUrl}/webhooks/whatsapp*`, async (route) => {
    const url = new URL(route.request().url());
    verifyUrls.push(url.search);
    await route.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept", "Content-Type": "text/plain" }, body: url.searchParams.get("hub.challenge") ?? "" });
  });
  await page.getByTestId("desktop-settings-link").click();
  await page.getByTestId("settings-nav-item-whatsappDebug").click();
  await expect.poll(() => pathOf(page)).toBe("/ayarlar/whatsapp-debug");
  await expect(page.getByRole("heading", { name: "WhatsApp Debug" })).toBeVisible();
  const config = page.getByTestId("whatsapp-debug-config");
  await expect(config).toContainText("PN-998");
  await expect(config).toContainText("WABA-77");
  await expect(config).toContainText("Tanımlı");
  await expect(config).toContainText("Eksik");
  await expect(config).toContainText("Kapalı (kuru çalıştırma)");
  await expect(page.getByTestId("whatsapp-debug-gate")).toHaveText("Kilit: providers.whatsapp.live_mode");
  await expect(page.getByTestId("whatsapp-debug-callback")).toContainText("/webhooks/whatsapp");
  await expect(page.getByTestId("debug-stats")).toContainText("Gelen mesaj7");
  await expect(page.getByTestId("debug-webhooks-table")).toContainText("messages");
  await expect(page.getByTestId("debug-webhooks-table")).toContainText('{"from":"90555***"}');
  await expect(page.getByTestId("debug-attempts-table")).toContainText("Recipient not allowed");

  await page.getByTestId("whatsapp-test-to").fill("905551112233");
  await page.getByTestId("whatsapp-test-submit").click();
  await expect(page.getByTestId("whatsapp-test-result")).toHaveText("Kuyruğa alındı: req_wa_1");
  const sent = state.bodies.find((entry) => entry.path === "/api/debug/whatsapp/test-send")?.body as { to: string; idempotency_key: string };
  expect(sent.to).toBe("905551112233");
  expect(sent.idempotency_key).toMatch(/^wa-debug_/);

  await page.getByTestId("debug-verify-token").fill("dogrulama");
  await page.getByTestId("debug-webhook-run").click();
  await expect(page.getByTestId("debug-webhook-result")).toHaveText("Doğrulama başarılı: challenge eşleşti.");
  expect(verifyUrls[0]).toContain("hub.mode=subscribe");
  expect(verifyUrls[0]).toContain("hub.verify_token=dogrulama");
});

test("instagram and AI debug: accounts, callbacks, AI config and a dry-run reply test", async ({ page }) => {
  const state = await open(page);
  await page.goto("/ayarlar/instagram-debug");
  await expect(page.getByRole("heading", { name: "Instagram Debug" })).toBeVisible();
  await expect(page.getByTestId("instagram-debug-account-instagram")).toContainText("garantikulucka (IG-1)");
  await expect(page.getByTestId("instagram-debug-callback-messenger")).toContainText("/webhooks/messenger");
  await expect(page.getByTestId("debug-stats")).toContainText("Toplam konuşma18");
  await expect(page.getByTestId("debug-webhooks-table")).toContainText("comments");
  await expect(page.getByTestId("debug-attempts-empty")).toBeVisible();

  await page.goto("/ayarlar/ai-debug");
  await expect(page.getByRole("heading", { name: "AI Debug" })).toBeVisible();
  await expect(page.getByTestId("ai-debug-config")).toContainText("gpt-test");
  await expect(page.getByTestId("ai-debug-config")).toContainText("Veritabanı (640 karakter)");
  await expect(page.getByTestId("ai-debug-stats")).toContainText("1.234");
  await expect(page.getByTestId("ai-debug-recent-table")).toContainText("Merhaba, siparişiniz yolda.");
  await page.getByTestId("ai-debug-message").fill("Kargom nerede?");
  await page.getByTestId("ai-debug-run").click();
  await expect(page.getByTestId("ai-debug-reply")).toHaveText("Yanıt (kuru çalıştırma): Kuru yanıt: Kargom nerede?");
  expect(state.bodies.find((entry) => entry.path === "/api/debug/ai/test")?.body).toEqual({ message: "Kargom nerede?" });
});

test("ai training: stats, filters, batches and the export download", async ({ page }) => {
  const state = await open(page);
  await page.goto("/ayarlar/ai-egitim");
  await expect(page.getByTestId("ai-training-total")).toHaveText("Dışa aktarılabilir konuşma: 240");
  await expect(page.getByTestId("ai-training-channels")).toHaveText("WhatsApp: 120 · Instagram: 80 · Messenger: 40");
  await page.getByTestId("ai-training-answered").uncheck();
  await expect(page.getByTestId("ai-training-total")).toHaveText("Dışa aktarılabilir konuşma: 300");
  await expect.poll(() => state.requests.some((entry) => entry.path === "/api/debug/ai-training/stats" && entry.search.includes("answered_only=false"))).toBe(true);
  await page.getByTestId("ai-training-answered").check();
  await chooseOption(page.getByTestId("ai-training-channel"), "instagram");
  await expect(page.getByTestId("ai-training-total")).toHaveText("Dışa aktarılabilir konuşma: 80");
  await chooseOption(page.getByTestId("ai-training-batch-size"), "50");
  await expect(page.getByTestId("ai-training-batch")).toHaveText("Parti 1–50");
  await page.getByTestId("ai-training-next").click();
  await expect(page.getByTestId("ai-training-batch")).toHaveText("Parti 51–80");
  await expect(page.getByTestId("ai-training-next")).toBeDisabled();
  await chooseOption(page.getByTestId("ai-training-format"), "json");

  const download = page.waitForEvent("download");
  await page.getByTestId("ai-training-download").click();
  expect((await download).suggestedFilename()).toBe("ai-egitim-50-100.json");
  await expect(page.getByTestId("ai-training-notice")).toHaveText("2 konuşma indirildi.");
  const exportCall = state.requests.find((entry) => entry.path === "/api/debug/ai-training/export");
  const params = new URLSearchParams(exportCall?.search ?? "");
  expect(Object.fromEntries(params)).toEqual({ format: "json", answered_only: "true", offset: "50", limit: "50", channel: "instagram" });
});

test("sürat debug: stats, gate, filters, redacted detail and clear", async ({ page }) => {
  await open(page);
  await page.goto("/kargo/surat-debug");
  await expect.poll(() => pathOf(page)).toBe("/kargolar/surat-debug");
  await expect(page.getByRole("heading", { name: "Sürat Kargo Debug" })).toBeVisible();
  await expect(page.getByTestId("surat-stat-total")).toContainText("3");
  await expect(page.getByTestId("surat-stat-success")).toContainText("1");
  await expect(page.getByTestId("surat-stat-error")).toContainText("1");
  await expect(page.getByTestId("surat-stat-recovered")).toContainText("1");
  await expect(page.getByTestId("surat-stat-avg")).toContainText("400ms");
  await expect(page.getByTestId("surat-stat-max")).toContainText("600ms");
  await expect(page.getByTestId("surat-debug-gate")).toContainText("Canlı gate: kapalı");
  await expect(page.getByTestId("surat-debug-gate")).toContainText("fixture_replay_contract_required");

  const logs = page.getByTestId("surat-debug-logs");
  await expect(logs.locator("li")).toHaveCount(3);
  const first = page.getByTestId("debug-log-pa_s1");
  await expect(first).toContainText("POST /kargoya-gonder");
  await first.getByTestId("debug-log-toggle").click();
  const detail = first.getByTestId("debug-log-detail");
  await expect(detail).toContainText("req_s1");
  await expect(detail).toContainText('"Authorization":"[redacted]"');
  await expect(detail).toContainText('"password":"[redacted]"');
  await expect(detail).toContainText("Mehmet Demir");
  await expect(detail).not.toContainText("should-not-show");
  await expect(detail).not.toContainText("hidden-value");
  await expect(detail).toContainText("canlı çağrı yok");

  await chooseOption(page.getByTestId("surat-status-filter"), "error");
  await expect(logs.locator("li")).toHaveCount(1);
  await page.getByTestId("debug-log-pa_s2").getByTestId("debug-log-toggle").click();
  await expect(page.getByTestId("debug-log-pa_s2").getByTestId("debug-log-detail")).toContainText("Hata: timeout Sürat zaman aşımı");
  await chooseOption(page.getByTestId("surat-status-filter"), "all");
  await chooseOption(page.getByTestId("surat-endpoint-filter"), "/kargo-takip");
  await expect(logs.locator("li")).toHaveCount(2);
  await page.getByTestId("debug-search").fill("req_s3");
  await expect(logs.locator("li")).toHaveCount(1);
  await page.getByTestId("debug-clear").click();
  await expect(page.getByTestId("debug-logs-empty")).toContainText("Henüz debug logu yok");
  await expect(page.getByTestId("surat-stat-total")).toContainText("0");
});

test("sürat debug: server-side clear confirms, deletes every Sürat attempt and reports the count", async ({ page }) => {
  const state = await open(page);
  await page.goto("/kargolar/surat-debug");
  await expect(page.getByTestId("surat-stat-total")).toContainText("3");
  await page.getByTestId("debug-clear-server").click();
  await expect(page.getByTestId("confirm-dialog-message")).toHaveText("Sunucudaki tüm Sürat denemeleri silinecek. Devam?");
  await page.getByTestId("confirm-dialog-action").click();
  await expect(page.getByTestId("debug-clear-result")).toHaveText("Sunucudan 9 kayıt silindi.");
  const deletes = state.requests.filter((request) => request.method === "DELETE");
  expect(deletes.map((request) => `${request.path}${request.search}`)).toEqual(["/admin/integrations/provider-attempts?provider_key=surat"]);
  await expect(page.getByTestId("surat-stat-total")).toContainText("0");
});

test("cron debug: carrier cards, dry-run triggers with idempotency keys and filters", async ({ page }) => {
  const state = await open(page);
  await page.getByTestId("desktop-settings-link").click();
  await page.getByTestId("settings-nav-item-cronDebug").click();
  await expect.poll(() => pathOf(page)).toBe("/kargolar/cron-debug");
  await expect(page.getByRole("heading", { name: "Kargo Takip Cron Debug" })).toBeVisible();
  // Only shipment.track attempts count: 1 PTT run, 2 Sürat runs (one failed).
  await expect(page.getByTestId("cron-updated-ptt")).toHaveText("1");
  await expect(page.getByTestId("cron-updated-surat")).toHaveText("1");
  await expect(page.getByTestId("cron-failed-surat")).toHaveText("1");
  await expect(page.getByTestId("cron-showing")).toHaveText("3 / 3 cron çalışması gösteriliyor");
  await expect(page.getByTestId("debug-log-pa_p1")).toContainText("2.5s toplam");

  await page.getByTestId("cron-run-ptt").click();
  await expect(page.getByTestId("cron-feedback")).toHaveText("Cron tetiklendi (kuru çalıştırma): 1 deneme kaydedildi.");
  await expect(page.getByTestId("cron-updated-ptt")).toHaveText("2");
  await page.getByTestId("cron-run-all").click();
  await expect(page.getByTestId("cron-feedback")).toHaveText("Cron tetiklendi (kuru çalıştırma): 2 deneme kaydedildi.");
  const triggers = state.bodies.filter((entry) => entry.path.startsWith("/admin/integrations/provider-cron-triggers/"));
  expect(triggers.map((entry) => entry.path)).toEqual(["/admin/integrations/provider-cron-triggers/ptt", "/admin/integrations/provider-cron-triggers/ptt", "/admin/integrations/provider-cron-triggers/surat"]);
  expect((triggers[0]?.body as { idempotency_key: string }).idempotency_key).toMatch(/^cron_debug_ptt_/);
  expect((triggers[2]?.body as { idempotency_key: string }).idempotency_key).toMatch(/^cron_debug_surat_/);
  await expect(page.getByTestId("cron-showing")).toHaveText("6 / 6 cron çalışması gösteriliyor");

  await chooseOption(page.getByTestId("cron-provider-filter"), "surat");
  await expect(page.getByTestId("cron-showing")).toHaveText("3 / 6 cron çalışması gösteriliyor");
  const failed = page.getByTestId("debug-log-pa_s2");
  await failed.getByTestId("debug-log-toggle").click();
  await expect(failed.getByTestId("debug-log-detail")).toContainText("GET /kargo-takip");

  // Server-side clear (legacy cron-debug temizle): a dismissed confirm sends nothing, an accepted one deletes
  // the shipment.track attempts of both carriers and reports the summed count.
  await page.getByTestId("debug-clear-server").click();
  await page.getByTestId("confirm-dialog-cancel").click();
  await expect(page.getByTestId("confirm-dialog")).toHaveCount(0);
  expect(state.requests.filter((request) => request.method === "DELETE")).toEqual([]);
  await page.getByTestId("debug-clear-server").click();
  await page.getByTestId("confirm-dialog-action").click();
  await expect(page.getByTestId("debug-clear-result")).toHaveText("Sunucudan 13 kayıt silindi.");
  expect(state.requests.filter((request) => request.method === "DELETE").map((request) => `${request.path}${request.search}`)).toEqual([
    "/admin/integrations/provider-attempts?provider_key=ptt&operation=shipment.track",
    "/admin/integrations/provider-attempts?provider_key=surat&operation=shipment.track",
  ]);
  await chooseOption(page.getByTestId("cron-provider-filter"), "all");
  await expect(page.getByTestId("cron-showing")).toHaveText("0 / 0 cron çalışması gösteriliyor");
});

test("debug pages are manager-only", async ({ page }) => {
  await open(page, "calisan");
  await page.getByTestId("desktop-settings-link").click();
  await expect(page.getByTestId("settings-nav")).toBeVisible();
  await expect(page.getByTestId("settings-nav-item-settings")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("settings-nav-developer")).toHaveCount(0);
  for (const key of ["suratDebug", "cronDebug", "whatsappDebug", "instagramDebug", "aiDebug", "aiTraining"]) await expect(page.getByTestId(`settings-nav-item-${key}`)).toHaveCount(0);
  for (const path of ["/ayarlar/whatsapp-debug", "/ayarlar/instagram-debug", "/ayarlar/ai-debug", "/ayarlar/ai-egitim", "/kargolar/surat-debug", "/kargo/cron-debug"]) {
    await page.goto(path);
    await expect.poll(() => pathOf(page)).toBe("/");
  }
});

test("debug pages: English labels and phone layout", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("garanti-beta-lang", "en"));
  await open(page, "admin", viewports.phone360);
  const pages: Array<[string, string, string]> = [
    ["/ayarlar/whatsapp-debug", "WhatsApp Debug", "Send a test message"],
    ["/ayarlar/instagram-debug", "Instagram Debug", "Accounts"],
    ["/ayarlar/ai-debug", "AI Debug", "AI configuration"],
    ["/ayarlar/ai-egitim", "AI Training Data", "Exportable conversations: 240"],
    ["/kargolar/surat-debug", "Sürat Kargo Debug", "Live gate: closed"],
    ["/kargolar/cron-debug", "Shipment Tracking Cron Debug", "Showing 3 / 3 cron runs"],
  ];
  for (const [path, heading, text] of pages) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
    await expectResponsiveLayout(page, { checkTouchTargets: true });
  }
  await expect(page.getByTestId("cron-debug-logs").locator("li").first()).toBeVisible();
  await page.getByTestId("debug-log-toggle").first().click();
  await expect(page.getByTestId("debug-log-detail")).toContainText("Response:");
  await expectResponsiveLayout(page, { checkTouchTargets: true });
  await page.goto("/ayarlar/whatsapp-debug");
  await expect(page.getByTestId("debug-webhooks-cards")).toContainText("messages");
  await expect(page.getByTestId("debug-attempts-cards")).toContainText("Recipient not allowed");

  await page.setViewportSize(viewports.phone390);
  await page.getByTestId("mobile-menu-trigger").click();
  const settings = page.getByTestId("mobile-menu-settings");
  for (const label of ["Sürat Debug", "Cron Debug", "WhatsApp Debug", "Instagram Debug", "AI Debug", "AI Training"]) await expect(settings.getByRole("link", { name: label, exact: true })).toBeVisible();
});
