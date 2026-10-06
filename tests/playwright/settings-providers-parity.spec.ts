import { expect, type Page, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

// Ayarlar → Entegrasyonlar: WhatsApp Cloud API and NetGSM tabs (masked tokens, webhook copy, status, QR)
// and the users tab SIP column/edit, against a stateful mocked /admin/integrations backend.
const backendBaseUrl = "http://127.0.0.1:65527";

test.setTimeout(90_000);

const admin = { public_id: "usr_admin", email: "admin@example.com", first_name: "Test", last_name: "Yönetici", role: "admin", permissions: [], is_online: true, sip_username: "1000" };

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


async function mockBackend(page: Page) {
  const now = "2026-10-06T09:00:00.000Z";
  const state = {
    accounts: [] as Array<{ public_id: string; provider_key: string; provider_name: string; display_name: string; external_account_id: string | null; status: string; metadata: unknown; updated_at: string }>,
    settings: new Map<string, Array<{ public_id: string; key: string; value: unknown; is_secret: boolean; updated_at: string }>>(),
    tokens: new Map<string, Array<{ public_id: string; token_type: string; expires_at: null; last_refreshed_at: null; updated_at: string }>>(),
    writes: [] as Array<{ method: string; path: string; body: Record<string, unknown> | null }>,
    users: [
      { public_id: "usr_staff", email: "staff@example.com", first_name: "Ayşe", last_name: "Kaya", phone: null, role: "calisan", is_active: true, is_online: false, last_seen_at: now, sip_username: "1001", sip_password_configured: true, created_at: now },
      { public_id: "usr_cargo", email: "kargo@example.com", first_name: "Can", last_name: "Er", phone: null, role: "kargo_operatoru", is_active: true, is_online: false, last_seen_at: now, sip_username: null, sip_password_configured: false, created_at: now },
    ],
  };
  await page.addInitScript(`window.__GARANTI_REALTIME_SOCKET_FACTORY__ = () => ({ connect() {}, disconnect() {}, emit() {}, on() {}, off() {} });`);
  await page.route(`${backendBaseUrl}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postData() ? (JSON.parse(request.postData() ?? "{}") as Record<string, unknown>) : null;
    const json = (status: number, payload: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
    if (method !== "GET" && url.pathname.startsWith("/admin/")) state.writes.push({ method, path: url.pathname, body });

    if (url.pathname === "/auth/login") return json(200, { access_token: "set-token", refresh_token: "set-refresh", token_type: "Bearer", expires_in: 900, user: admin });
    if (url.pathname === "/auth/me" || url.pathname === "/auth/presence") return json(200, admin);
    if (url.pathname === "/api/app-settings/ai-status") return json(200, { ai_enabled: false });
    if (url.pathname === "/admin/integrations/accounts" && method === "GET") return json(200, { data: state.accounts });
    if (url.pathname === "/admin/integrations/accounts" && method === "POST") {
      let account = state.accounts.find((item) => item.provider_key === body?.provider_key);
      if (!account) {
        account = { public_id: `iac_${String(body?.provider_key)}`, provider_key: String(body?.provider_key), provider_name: String(body?.provider_key), display_name: String(body?.display_name), external_account_id: null, status: "active", metadata: {}, updated_at: now };
        state.accounts.push(account);
      }
      account.external_account_id = (body?.external_account_id as string | null) ?? null;
      return json(200, account);
    }
    const accountMatch = /^\/admin\/integrations\/accounts\/([^/]+)(?:\/(settings|tokens)\/([^/]+))?$/.exec(url.pathname);
    if (accountMatch) {
      const [, id, kind, key] = accountMatch;
      const account = state.accounts.find((item) => item.public_id === id)!;
      if (kind === "settings") {
        const rows = state.settings.get(id!) ?? [];
        const secret = body?.is_secret === true;
        const row = { public_id: `ist_${key}`, key: decodeURIComponent(key!), value: secret ? null : body?.value, is_secret: secret, updated_at: now };
        state.settings.set(id!, [...rows.filter((item) => item.key !== row.key), row]);
        return json(200, row);
      }
      if (kind === "tokens") {
        const rows = state.tokens.get(id!) ?? [];
        state.tokens.set(id!, [...rows.filter((item) => item.token_type !== key), { public_id: `itk_${key}`, token_type: key!, expires_at: null, last_refreshed_at: null, updated_at: now }]);
        return json(200, { public_id: `itk_${key}`, token_type: key, value: null });
      }
      return json(200, { account, settings: state.settings.get(id!) ?? [], tokens: state.tokens.get(id!) ?? [] });
    }
    if (url.pathname === "/admin/integrations/netgsm/balance") {
      return json(200, { provider: "netgsm", operation: "account.balance", balance: null, currency: "TRY", sms_credit: null, status: "dry_run", live_call_permitted: false, live_gate: "providers.netgsm.live_mode", block_reason: "live_mode_disabled", checked_at: now });
    }
    if (url.pathname === "/admin/users" && method === "GET") return json(200, { data: state.users, roles: ["admin", "calisan", "kargo_operatoru"] });
    const userMatch = /^\/admin\/users\/([^/]+)$/.exec(url.pathname);
    if (userMatch && method === "PATCH") {
      const index = state.users.findIndex((item) => item.public_id === userMatch[1]);
      const patch = { ...(body ?? {}) };
      if ("sip_password" in patch) {
        delete patch.sip_password;
        patch.sip_password_configured = true;
      }
      state.users[index] = { ...state.users[index]!, ...patch } as (typeof state.users)[number];
      return json(200, { user: state.users[index] });
    }
    if (url.pathname === "/admin/logs") {
      return json(200, {
        data: [
          { id: 1, actor_name: "Test Yönetici", action: "update", module: "users", entity_id: "usr_cargo", created_at: now },
          { id: 2, actor_name: "Ayşe Kaya", action: "create", module: "orders", entity_id: "ord_77", created_at: now },
        ],
      });
    }
    if (url.pathname === "/admin/settings") return json(200, { data: [] });
    const fallback = fallbackResponse(url.pathname);
    if (fallback !== undefined) return json(200, fallback);
    return json(404, { error: { code: "not_found", message: "not mocked" } });
  });
  return state;
}

async function loginAt(page: Page, url: string) {
  await page.goto(url);
  await page.locator('input[type="email"]').fill(admin.email);
  await page.locator('input[type="password"]').fill("secret-password");
  await Promise.all([page.waitForResponse(`${backendBaseUrl}/auth/login`), page.locator('button[type="submit"]').click()]);
}


async function openIntegrations(page: Page, provider: "WhatsApp" | "NetGSM") {
  await page.getByTestId("ayarlar-tabs").getByRole("tab", { name: /Entegrasyonlar|Integrations/ }).click();
  await page.getByTestId("ayarlar-provider-tabs").getByRole("button", { name: provider }).click();
}

test.describe("Ayarlar provider tabs", () => {
  let app: Awaited<ReturnType<typeof startWebApp>>;

  test.beforeAll(async () => {
    app = await startWebApp();
  });

  test.afterAll(async () => {
    await (app.server as ViteDevServer).close();
  });

  test("WhatsApp: saves the account, masks the token, copies the webhook and shows the QR", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const state = await mockBackend(page);
    await loginAt(page, `${app.url}/ayarlar`);
    await openIntegrations(page, "WhatsApp");
    const tab = page.getByTestId("ayarlar-whatsapp");
    await expect(tab.getByTestId("whatsapp-status")).toContainText("Hesap tanımlı değil");
    await expect(tab.getByTestId("whatsapp-token-status")).toHaveText("Token eksik");
    await expect(tab.getByTestId("whatsapp-qr")).toContainText("QR için işletme telefon numarasını girin.");

    const form = tab.getByTestId("whatsapp-form");
    await form.locator('input[name="phone_number_id"]').fill("1234567890");
    await form.locator('input[name="waba_id"]').fill("998877");
    await form.locator('input[name="display_phone_number"]').fill("0555 111 22 33");
    await form.locator('input[name="access_token"]').fill("EAAG-secret-token");
    await form.locator('input[name="verify_token"]').fill("verify-secret");
    await expect(tab.getByTestId("whatsapp-qr-link")).toHaveText("https://wa.me/905551112233");
    await expect(tab.getByTestId("whatsapp-qr-image")).toBeVisible();
    await tab.getByTestId("whatsapp-save").click();
    await expect(tab.getByTestId("ayarlar-mesaj")).toContainText("Ayarlar kaydedildi.");

    expect(state.writes.map((write) => `${write.method} ${write.path}`)).toEqual([
      "POST /admin/integrations/accounts",
      "PUT /admin/integrations/accounts/iac_whatsapp/settings/phone_number_id",
      "PUT /admin/integrations/accounts/iac_whatsapp/settings/waba_id",
      "PUT /admin/integrations/accounts/iac_whatsapp/settings/display_phone_number",
      "PUT /admin/integrations/accounts/iac_whatsapp/tokens/access_token",
      "PUT /admin/integrations/accounts/iac_whatsapp/settings/webhook.verify_token",
    ]);
    expect(state.writes[4]?.body).toMatchObject({ value: "EAAG-secret-token" });
    expect(state.writes[5]?.body).toMatchObject({ value: "verify-secret", is_secret: true });

    await expect(tab.getByTestId("whatsapp-token-status")).toHaveText("Token tanımlı");
    await expect(tab.getByTestId("whatsapp-token-mask")).toHaveText("Kayıtlı değer: ••••••••");
    await expect(form.locator('input[name="access_token"]')).toHaveValue("");
    await expect(tab).not.toContainText("EAAG-secret-token");
    await expect(tab.getByTestId("whatsapp-live")).toHaveText("Hesap canlı onayı: kapalı (kuru çalıştırma)");

    await expect(tab.getByTestId("ayarlar-whatsapp-callback")).toHaveText(`${app.url}/webhooks/whatsapp`);
    await tab.getByRole("button", { name: "Kopyala" }).click();
    await expect(tab.getByTestId("ayarlar-mesaj")).toContainText("Webhook adresi kopyalandı.");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${app.url}/webhooks/whatsapp`);
  });

  test("NetGSM: saves credentials with a masked password and checks the balance in dry-run", async ({ page }) => {
    const state = await mockBackend(page);
    await loginAt(page, `${app.url}/ayarlar`);
    await openIntegrations(page, "NetGSM");
    const tab = page.getByTestId("ayarlar-netgsm");
    await expect(tab.getByTestId("netgsm-password-status")).toHaveText("Şifre eksik");
    await tab.getByTestId("netgsm-save").click();
    await expect(tab.getByTestId("ayarlar-mesaj")).toContainText("NetGSM kullanıcı kodu gerekli.");

    const form = tab.getByTestId("netgsm-form");
    await form.locator('input[name="usercode"]').fill("8503000000");
    await form.locator('input[name="password"]').fill("netgsm-pass");
    await form.locator('input[name="msgheader"]').fill("GARANTIKLC");
    await tab.getByTestId("netgsm-save").click();
    await expect(tab.getByTestId("ayarlar-mesaj")).toContainText("Ayarlar kaydedildi.");
    await expect(tab.getByTestId("netgsm-password-status")).toHaveText("Şifre tanımlı");
    await expect(tab.getByTestId("netgsm-password-mask")).toHaveText("Kayıtlı değer: ••••••••");
    expect(state.writes.map((write) => write.path)).toContain("/admin/integrations/accounts/iac_netgsm/tokens/sms_password");
    await expect(tab.getByTestId("ayarlar-netgsm-callback")).toHaveText(`${app.url}/webhooks/netgsm`);

    await tab.getByTestId("netgsm-balance-check").click();
    await expect(tab.getByTestId("netgsm-balance-result")).toHaveText("Canlı NetGSM kapalı — bakiye sorgusu kuru çalıştı.");
  });

  test("users tab shows SIP info and edits it without echoing the password", async ({ page }) => {
    const state = await mockBackend(page);
    await loginAt(page, `${app.url}/ayarlar`);
    await page.getByTestId("ayarlar-tabs").getByRole("tab", { name: "Kullanıcılar" }).click();
    const staff = page.getByTestId("kullanici-usr_staff");
    await expect(staff.getByTestId("kullanici-sip")).toContainText("1001");
    await expect(staff.getByTestId("kullanici-sip")).toContainText("şifre tanımlı");
    await expect(page.getByTestId("kullanici-usr_cargo").getByTestId("kullanici-sip")).toHaveText("-");

    const cargo = page.getByTestId("kullanici-usr_cargo");
    await cargo.getByRole("button", { name: "Düzenle" }).click();
    await cargo.locator('input[name="sip_username"]').fill("1002");
    await cargo.locator('input[name="sip_password"]').fill("sip-pass");
    await cargo.getByRole("button", { name: "Kaydet" }).click();
    await expect(cargo.getByTestId("kullanici-sip")).toContainText("1002");
    await expect(cargo.getByTestId("kullanici-sip")).toContainText("şifre tanımlı");
    await expect(cargo).not.toContainText("sip-pass");
    expect(state.writes.at(-1)).toMatchObject({ method: "PATCH", path: "/admin/users/usr_cargo", body: { sip_username: "1002", sip_password: "sip-pass" } });

    await staff.getByRole("button", { name: "Düzenle" }).click();
    await staff.getByRole("button", { name: "Kaydet" }).click();
    await expect(staff.getByTestId("kullanici-sip")).toContainText("1001");
    expect(state.writes.at(-1)?.body).not.toHaveProperty("sip_password");
  });

  test("logs tab filters by module and search text", async ({ page }) => {
    await mockBackend(page);
    await loginAt(page, `${app.url}/ayarlar`);
    await page.getByTestId("ayarlar-tabs").getByRole("tab", { name: "İşlem Logları" }).click();
    const logs = page.getByTestId("ayarlar-loglar");
    await expect(logs.locator("tbody tr")).toHaveCount(2);
    await page.getByTestId("ayarlar-log-filters").getByRole("combobox").selectOption("orders");
    await expect(logs.locator("tbody tr")).toHaveCount(1);
    await expect(logs.locator("tbody tr")).toContainText("ord_77");
    await page.getByTestId("ayarlar-log-filters").getByRole("combobox").selectOption("");
    await page.getByTestId("ayarlar-log-filters").getByRole("searchbox").fill("usr_cargo");
    await expect(logs.locator("tbody tr")).toHaveCount(1);
    await expect(logs.locator("tbody tr")).toContainText("Test Yönetici");
  });

  test("English labels and a 360px phone layout", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await mockBackend(page);
    await page.addInitScript(() => window.localStorage.setItem("garanti-lang", "en"));
    await loginAt(page, `${app.url}/ayarlar`);
    await openIntegrations(page, "WhatsApp");
    await expect(page.getByTestId("ayarlar-whatsapp")).toContainText("Webhook (callback) URL");
    await page.getByTestId("whatsapp-form").locator('input[name="display_phone_number"]').fill("905551112233");
    await expect(page.getByTestId("whatsapp-qr-image")).toBeVisible();
    let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.getByTestId("ayarlar-provider-tabs").getByRole("button", { name: "NetGSM" }).click();
    await expect(page.getByTestId("ayarlar-netgsm")).toContainText("Check balance");
    overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
