import { expect, test, type Page } from "@playwright/test";
import { backendBaseUrl, expectResponsiveLayout, login, mockBackend, mockUser, pathOf, viewports, type BackendState, type ExtraRoute } from "./helpers";

test.use({ serviceWorkers: "block" });

const now = "2026-10-07T09:00:00.000Z";

function account(provider: string, overrides: Record<string, unknown> = {}) {
  return { public_id: `acc_${provider}`, provider_key: provider, provider_name: provider, display_name: provider, external_account_id: null, status: "active", metadata: {}, updated_at: now, ...overrides };
}

function setting(key: string, value: unknown, isSecret = false) {
  return { public_id: `set_${key}`, key, value: isSecret ? null : value, is_secret: isSecret, updated_at: now };
}

function token(type: string) {
  return { public_id: `tok_${type}`, token_type: type, value: null, expires_at: null, last_refreshed_at: null, updated_at: now };
}

/** Backend mock for the manager settings endpoints; secrets only ever come back as `value: null`. */
function routes(options: { aiEnabled?: boolean; instagramActive?: boolean } = {}) {
  const accounts = [
    account("whatsapp", { external_account_id: "1098765432" }),
    account("netgsm", { external_account_id: "8503000000" }),
    account("instagram", { external_account_id: "pg_123", status: options.instagramActive ? "active" : "inactive" }),
  ];
  const snapshots: Record<string, { settings: unknown[]; tokens: unknown[] }> = {
    acc_whatsapp: {
      settings: [setting("phone_number_id", "1098765432"), setting("waba_id", "waba_1"), setting("display_phone_number", "0555 111 22 33"), setting("webhook.verify_token", "secret", true), setting("live_mode", false)],
      tokens: [token("access_token")],
    },
    acc_netgsm: { settings: [setting("sms_usercode", "8503000000"), setting("msgheader", "GARANTI")], tokens: [token("sms_password")] },
    acc_instagram: { settings: [], tokens: [] },
  };
  const globalSettings = [
    { key: "ai.system_prompt", scope: "global", value: "Sen Garanti Kuluçka asistanısın.", is_secret: false, updated_at: now },
    { key: "sip_config", scope: "global", value: { ws_url: "wss://sip.example.com/ws", domain: "sip.example.com", stun: "stun:stun.example.com:3478" }, is_secret: false, updated_at: now },
    { key: "netgsm.teyit_voice_usercode", scope: "global", value: "3229110370", is_secret: false, updated_at: now },
    { key: "netgsm.teyit_voice_password", scope: "global", value: null, is_secret: true, updated_at: now },
    { key: "vapi_ayarlar", scope: "global", value: { enabled: true }, is_secret: false, updated_at: now },
  ];
  const route: ExtraRoute = ({ method, path, body }) => {
    if (path === "/api/app-settings/ai-status") return { status: 200, body: { ai_enabled: options.aiEnabled ?? false } };
    if (path === "/admin/settings" && method === "GET") return { status: 200, body: { data: globalSettings } };
    const settingMatch = /^\/admin\/settings\/([^/]+)$/.exec(path);
    if (settingMatch && method === "PUT") {
      const input = body as { value: unknown; is_secret: boolean };
      return { status: 200, body: { key: decodeURIComponent(settingMatch[1]!), scope: "global", value: input.is_secret ? null : input.value, is_secret: input.is_secret, updated_at: now } };
    }
    if (path === "/admin/integrations/accounts" && method === "GET") return { status: 200, body: { data: accounts } };
    if (path === "/admin/integrations/accounts" && method === "POST") {
      const input = body as { provider_key: string; external_account_id: string | null; display_name: string };
      return { status: 201, body: account(input.provider_key, { external_account_id: input.external_account_id, display_name: input.display_name }) };
    }
    const metaAction = /^\/admin\/integrations\/accounts\/([^/]+)\/(webhook-subscription|thread-control|disconnect)$/.exec(path);
    if (metaAction && method === "POST") {
      const id = metaAction[1]!;
      const found = accounts.find((item) => item.public_id === id);
      if (!found) return { status: 404, body: { error: { code: "not_found", message: "yok" } } };
      if (metaAction[2] === "disconnect") {
        found.status = "inactive";
        const removed = snapshots[id]?.tokens.length ?? 0;
        snapshots[id] = { settings: snapshots[id]?.settings ?? [], tokens: [] };
        return { status: 200, body: { account: found, removed_tokens: removed, unsubscribe_job_id: `job_${id}_unsubscribe` } };
      }
      const input = body as { action: string };
      return { status: 202, body: { queued: true, job_id: `job_${id}_${input.action}`, request_id: `req_${id}`, account_public_id: id, provider_key: found.provider_key, operation: input.action, live_gate: `providers.${found.provider_key}.live_mode` } };
    }
    const accountMatch = /^\/admin\/integrations\/accounts\/([^/]+)$/.exec(path);
    if (accountMatch && method === "GET") {
      const id = accountMatch[1]!;
      const found = accounts.find((item) => item.public_id === id);
      return found ? { status: 200, body: { account: found, ...snapshots[id] } } : { status: 404, body: { error: { code: "not_found", message: "yok" } } };
    }
    const integrationSetting = /^\/admin\/integrations\/accounts\/([^/]+)\/settings\/([^/]+)$/.exec(path);
    if (integrationSetting && method === "PUT") {
      const input = body as { value: unknown; is_secret: boolean };
      return { status: 200, body: setting(decodeURIComponent(integrationSetting[2]!), input.value, input.is_secret) };
    }
    const integrationToken = /^\/admin\/integrations\/accounts\/([^/]+)\/tokens\/([^/]+)$/.exec(path);
    if (integrationToken && method === "PUT") return { status: 200, body: { public_id: "tok_new", token_type: integrationToken[2], value: null } };
    if (path === "/admin/integrations/netgsm/balance") {
      return {
        status: 200,
        body: { provider: "netgsm", operation: "account.balance", balance: null, currency: "TRY", sms_credit: null, status: "dry_run", live_call_permitted: false, live_gate: "providers.netgsm.live_mode", block_reason: "fixture_replay_contract_required", checked_at: now },
      };
    }
    return undefined;
  };
  return route;
}

async function signIn(page: Page, role: string, viewport: { width: number; height: number } = viewports.desktop, options: { aiEnabled?: boolean; instagramActive?: boolean } = {}) {
  await page.setViewportSize(viewport);
  const state = await mockBackend(page, mockUser(role), { extra: routes(options) });
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("topbar")).toBeVisible();
  return state;
}

const writes = (state: BackendState, prefix: string) => state.bodies.filter((entry) => entry.path.startsWith(prefix));

test("settings: manager sees the provider tabs, toggles AI and saves the system prompt", async ({ page }) => {
  const state = await signIn(page, "admin");
  await page.goto("/ayarlar");
  await expect(page.getByTestId("settings-tabs").getByRole("tab")).toHaveText(["Profil ve tercihler", "Genel AI", "Entegrasyonlar", "WhatsApp", "Instagram", "Messenger", "NetGSM", "Santral"]);
  await expect(page.getByTestId("settings-tab-account")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("settings-profile")).toBeVisible();

  await page.getByTestId("settings-tab-ai").click();
  await expect(page).toHaveURL(/\?tab=ai$/);
  await expect(page.getByTestId("settings-ai-badge")).toHaveText("AI kapalı");
  await expect(page.getByTestId("settings-ai-prompt-input")).toHaveValue("Sen Garanti Kuluçka asistanısın.");
  await expect(page.getByTestId("settings-ai-prompt-source")).toHaveText("Özel talimat");
  await page.getByTestId("settings-ai-toggle").click();
  await expect(page.getByTestId("settings-ai-feedback")).toHaveText("AI otomatik yanıt açıldı.");
  await expect(page.getByTestId("settings-ai-toggle")).toHaveAttribute("aria-checked", "true");
  expect(writes(state, "/admin/settings/ai.auto_reply_enabled")).toEqual([{ method: "PUT", path: "/admin/settings/ai.auto_reply_enabled", body: { value: true, scope: "global", is_secret: false } }]);

  await page.getByTestId("settings-ai-prompt-input").fill("kısa");
  await page.getByTestId("settings-ai-prompt-save").click();
  await expect(page.getByTestId("settings-ai-feedback")).toHaveText("Talimat en az 10 karakter olmalı.");
  await page.getByTestId("settings-ai-prompt-input").fill("  Müşterilere kibar ve kısa yanıt ver.  ");
  await page.getByTestId("settings-ai-prompt-save").click();
  await expect(page.getByTestId("settings-ai-feedback")).toHaveText("Sistem talimatı kaydedildi.");
  await page.getByTestId("settings-ai-prompt-reset").click();
  await expect(page.getByTestId("settings-ai-feedback")).toHaveText("Varsayılan talimata dönüldü.");
  await expect(page.getByTestId("settings-ai-prompt-source")).toHaveText("Varsayılan talimat");
  expect(writes(state, "/admin/settings/ai.system_prompt").map((entry) => entry.body)).toEqual([
    { value: "Müşterilere kibar ve kısa yanıt ver.", scope: "global", is_secret: false },
    { value: "", scope: "global", is_secret: false },
  ]);

  // The tab survives a reload through ?tab=.
  await page.reload();
  await expect(page.getByTestId("settings-tab-ai")).toHaveAttribute("aria-selected", "true");
});

test("settings: integrations overview shows status cards and links to the dedicated pages", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/ayarlar?tab=integrations");
  const cards = page.getByTestId("settings-integration-cards");
  await expect(page.getByTestId("settings-integration-account-whatsapp")).toHaveText("Hesap aktif");
  await expect(page.getByTestId("settings-integration-credential-whatsapp")).toHaveText("Kimlik bilgisi tanımlı");
  await expect(page.getByTestId("settings-integration-account-instagram")).toHaveText("Hesap pasif");
  await expect(page.getByTestId("settings-integration-credential-instagram")).toHaveText("Kimlik bilgisi eksik");
  await expect(page.getByTestId("settings-integration-account-messenger")).toHaveText("Hesap yok");
  await expect(page.getByTestId("settings-integration-credential-netgsm")).toHaveText("Kimlik bilgisi tanımlı");
  await expect(page.getByTestId("settings-integration-sip")).toHaveText("SIP sunucusu tanımlı");
  await expect(cards).toContainText("Hesap kimliği: 1098765432");

  const links = page.getByTestId("settings-related-links");
  for (const [testId, href] of [
    ["settings-link-vapi", "/sesli-asistan/vapi"],
    ["settings-link-pipeline", "/kargolar/pipeline"],
    ["settings-link-users", "/kullanicilar"],
    ["settings-link-logs", "/islem-loglari"],
    ["settings-link-data-deletion", "/veri-silme-talepleri"],
  ] as const) {
    await expect(links.getByTestId(testId)).toHaveAttribute("href", href);
  }
  await expect(links.getByTestId("settings-link-vapi")).toContainText("Açık");

  await page.getByTestId("settings-integration-open-whatsapp").click();
  await expect(page).toHaveURL(/\?tab=whatsapp$/);
  await expect(page.getByTestId("settings-tab-panel-whatsapp")).toBeVisible();

  await page.goto("/ayarlar?tab=integrations");
  await links.getByTestId("settings-link-users").click();
  await expect.poll(() => pathOf(page)).toBe("/kullanicilar");
});

test("settings: WhatsApp saves plain settings and only sends secrets that were typed", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const state = await signIn(page, "admin");
  await page.goto("/ayarlar?tab=whatsapp");
  await expect(page.getByTestId("whatsapp-token-status")).toHaveText("Token tanımlı");
  await expect(page.getByTestId("whatsapp-verify-status")).toHaveText("Verify token tanımlı");
  await expect(page.getByTestId("whatsapp-live")).toHaveText("Canlı mod kapalı");
  await expect(page.getByTestId("whatsapp-phone-number-id")).toHaveValue("1098765432");
  await expect(page.getByTestId("whatsapp-waba-id")).toHaveValue("waba_1");
  // Secrets are never echoed back: the inputs stay empty with a masked placeholder.
  await expect(page.getByTestId("whatsapp-access-token")).toHaveValue("");
  await expect(page.getByTestId("whatsapp-access-token")).toHaveAttribute("placeholder", /••••••••/);
  await expect(page.getByTestId("whatsapp-wa-link")).toHaveText("https://wa.me/905551112233");

  await expect(page.getByTestId("whatsapp-callback")).toHaveText(`${backendBaseUrl}/webhooks/whatsapp`);
  await page.getByTestId("whatsapp-callback-copy").click();
  await expect(page.getByTestId("whatsapp-feedback")).toHaveText("Panoya kopyalandı.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${backendBaseUrl}/webhooks/whatsapp`);

  await page.getByTestId("whatsapp-waba-id").fill("waba_2");
  await page.getByTestId("whatsapp-save").click();
  await expect(page.getByTestId("whatsapp-feedback")).toHaveText("Ayarlar kaydedildi.");
  const firstSave = writes(state, "/admin/integrations/accounts");
  expect(firstSave).toEqual([
    { method: "POST", path: "/admin/integrations/accounts", body: { provider_key: "whatsapp", display_name: "whatsapp", external_account_id: "1098765432", metadata: {} } },
    { method: "PUT", path: "/admin/integrations/accounts/acc_whatsapp/settings/phone_number_id", body: { value: "1098765432", is_secret: false } },
    { method: "PUT", path: "/admin/integrations/accounts/acc_whatsapp/settings/waba_id", body: { value: "waba_2", is_secret: false } },
    { method: "PUT", path: "/admin/integrations/accounts/acc_whatsapp/settings/display_phone_number", body: { value: "0555 111 22 33", is_secret: false } },
  ]);

  await page.getByTestId("whatsapp-access-token").fill("EAAG-new-token");
  await page.getByTestId("whatsapp-verify-token").fill("verify-me");
  await page.getByTestId("whatsapp-save").click();
  await expect(page.getByTestId("whatsapp-access-token")).toHaveValue("");
  const secretWrites = writes(state, "/admin/integrations/accounts/acc_whatsapp/").filter((entry) => /tokens|verify_token/.test(entry.path));
  expect(secretWrites).toEqual([
    { method: "PUT", path: "/admin/integrations/accounts/acc_whatsapp/tokens/access_token", body: { value: "EAAG-new-token", expires_at: null } },
    { method: "PUT", path: "/admin/integrations/accounts/acc_whatsapp/settings/webhook.verify_token", body: { value: "verify-me", is_secret: true } },
  ]);

  await page.getByTestId("whatsapp-phone-number-id").fill(" ");
  await page.getByTestId("whatsapp-save").click();
  await expect(page.getByTestId("whatsapp-feedback")).toHaveText("Phone number ID zorunlu.");
});

test("settings: Instagram and Messenger tabs save the page id and typed tokens", async ({ page }) => {
  const state = await signIn(page, "admin");
  await page.goto("/ayarlar?tab=instagram");
  await expect(page.getByTestId("instagram-token-status")).toHaveText("Token eksik");
  await expect(page.getByTestId("instagram-page-id")).toHaveValue("pg_123");
  await page.getByTestId("instagram-access-token").fill("IG-PAGE-TOKEN");
  await page.getByTestId("instagram-save").click();
  await expect(page.getByTestId("instagram-feedback")).toHaveText("Ayarlar kaydedildi.");
  expect(writes(state, "/admin/integrations/accounts").map((entry) => entry.path)).toEqual(["/admin/integrations/accounts", "/admin/integrations/accounts/acc_instagram/tokens/access_token"]);

  await page.getByTestId("settings-tab-messenger").click();
  await expect(page.getByTestId("messenger-page-id")).toHaveValue("");
  await expect(page.getByTestId("messenger-callback")).toHaveText(`${backendBaseUrl}/webhooks/messenger`);
  await page.getByTestId("messenger-save").click();
  await expect(page.getByTestId("messenger-feedback")).toHaveText("Facebook Page ID zorunlu.");
  await page.getByTestId("messenger-page-id").fill("pg_999");
  await page.getByTestId("messenger-save").click();
  await expect(page.getByTestId("messenger-feedback")).toHaveText("Ayarlar kaydedildi.");
  const messengerWrites = writes(state, "/admin/integrations/accounts").slice(2);
  expect(messengerWrites).toEqual([{ method: "POST", path: "/admin/integrations/accounts", body: { provider_key: "messenger", display_name: "Messenger", external_account_id: "pg_999", metadata: {} } }]);
});

test("settings: Instagram queues the webhook subscription and thread control, then disconnects after confirming", async ({ page }) => {
  const state = await signIn(page, "admin", viewports.desktop, { instagramActive: true });
  await page.goto("/ayarlar?tab=instagram");
  const card = page.getByTestId("instagram-webhook-card");
  await expect(page.getByTestId("instagram-status")).toContainText("Instagram bağlı");
  await expect(card.getByTestId("instagram-webhook-subscribe")).toBeEnabled();

  await card.getByTestId("instagram-webhook-subscribe").click();
  await expect(card.getByTestId("instagram-action-feedback")).toHaveText("İş kuyruğa alındı: job_acc_instagram_subscribe (canlı çağrı için providers.instagram.live_mode gerekir)");
  const subscribe = writes(state, "/admin/integrations/accounts/acc_instagram/webhook-subscription");
  expect(subscribe).toHaveLength(1);
  expect(subscribe[0]).toMatchObject({ method: "POST", body: { action: "subscribe", idempotency_key: expect.stringMatching(/^instagram_webhook_/) } });

  await card.getByTestId("instagram-thread-take").click();
  await expect(card.getByTestId("instagram-action-feedback")).toHaveText("Alıcı PSID / IGSID zorunlu.");
  await card.getByTestId("instagram-thread-recipient").fill("1234567890");
  await card.getByTestId("instagram-thread-take").click();
  await expect(card.getByTestId("instagram-action-feedback")).toHaveText("İş kuyruğa alındı: job_acc_instagram_take (canlı çağrı için providers.instagram.live_mode gerekir)");
  const threadControl = writes(state, "/admin/integrations/accounts/acc_instagram/thread-control");
  expect(threadControl).toHaveLength(1);
  expect(threadControl[0]).toMatchObject({ method: "POST", body: { action: "take", recipient_id: "1234567890" } });

  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("instagram bağlantısı kesilecek");
    void dialog.accept();
  });
  await card.getByTestId("instagram-disconnect").click();
  await expect(card.getByTestId("instagram-action-feedback")).toHaveText("Bağlantı kesildi; 0 token silindi.");
  await expect(page.getByTestId("instagram-status")).toContainText("Instagram bağlı değil");
  expect(writes(state, "/admin/integrations/accounts/acc_instagram/disconnect")).toHaveLength(1);

  await page.setViewportSize(viewports.phone360);
  await page.waitForLoadState("networkidle");
  await expectResponsiveLayout(page, { checkTouchTargets: true });
});

test("settings: NetGSM saves the config without the untouched password and shows the dry-run balance", async ({ page }) => {
  const state = await signIn(page, "admin");
  await page.goto("/ayarlar?tab=netgsm");
  await expect(page.getByTestId("netgsm-password-status")).toHaveText("Şifre tanımlı");
  await expect(page.getByTestId("netgsm-usercode")).toHaveValue("8503000000");
  await expect(page.getByTestId("netgsm-msgheader")).toHaveValue("GARANTI");
  await expect(page.getByTestId("netgsm-password")).toHaveValue("");
  await expect(page.getByTestId("netgsm-callback")).toHaveText(`${backendBaseUrl}/webhooks/netgsm`);

  await page.getByTestId("netgsm-msgheader").fill("GRNTKULUCKA");
  await page.getByTestId("netgsm-save").click();
  await expect(page.getByTestId("netgsm-feedback")).toHaveText("Ayarlar kaydedildi.");
  expect(writes(state, "/admin/integrations/accounts")).toEqual([
    { method: "POST", path: "/admin/integrations/accounts", body: { provider_key: "netgsm", display_name: "netgsm", external_account_id: "8503000000", metadata: {} } },
    { method: "PUT", path: "/admin/integrations/accounts/acc_netgsm/settings/sms_usercode", body: { value: "8503000000", is_secret: false } },
    { method: "PUT", path: "/admin/integrations/accounts/acc_netgsm/settings/msgheader", body: { value: "GRNTKULUCKA", is_secret: false } },
  ]);

  await page.getByTestId("netgsm-password").fill("yeni-sifre");
  await page.getByTestId("netgsm-save").click();
  await expect(page.getByTestId("netgsm-password")).toHaveValue("");
  expect(writes(state, "/admin/integrations/accounts/acc_netgsm/tokens")).toEqual([{ method: "PUT", path: "/admin/integrations/accounts/acc_netgsm/tokens/sms_password", body: { value: "yeni-sifre", expires_at: null } }]);

  await page.getByTestId("netgsm-balance-check").click();
  await expect(page.getByTestId("netgsm-balance-result")).toContainText("Canlı sorgu kapalı (providers.netgsm.live_mode)");
});

test("settings: Santral saves the SIP server and keeps the caller password unless retyped", async ({ page }) => {
  const state = await signIn(page, "admin");
  await page.goto("/ayarlar?tab=santral");
  await expect(page.getByTestId("santral-ws-url")).toHaveValue("wss://sip.example.com/ws");
  await expect(page.getByTestId("santral-caller-id")).toHaveValue("3229110370");
  await expect(page.getByTestId("santral-caller-password")).toHaveAttribute("placeholder", /••••••••/);
  await expect(page.getByTestId("santral-balance-result")).toBeVisible();

  await page.getByTestId("santral-domain").fill("pbx.example.com");
  await page.getByTestId("santral-config-save").click();
  await expect(page.getByTestId("santral-config-feedback")).toHaveText("Santral ayarları kaydedildi.");
  expect(writes(state, "/admin/settings/sip_config").map((entry) => entry.body)).toEqual([
    { value: { ws_url: "wss://sip.example.com/ws", domain: "pbx.example.com", stun: "stun:stun.example.com:3478" }, scope: "global", is_secret: false },
  ]);

  await page.getByTestId("santral-caller-save").click();
  await expect(page.getByTestId("santral-caller-feedback")).toHaveText("Arayan numara kaydedildi.");
  expect(writes(state, "/admin/settings/netgsm.teyit_voice_password")).toEqual([]);
  await page.getByTestId("santral-caller-password").fill("ses-sifre");
  await page.getByTestId("santral-caller-save").click();
  await expect(page.getByTestId("santral-caller-password")).toHaveValue("");
  expect(writes(state, "/admin/settings/netgsm.teyit_voice_password").map((entry) => entry.body)).toEqual([{ value: "ses-sifre", scope: "global", is_secret: true }]);
  await expect(page.getByTestId("santral-link-users")).toHaveAttribute("href", "/kullanicilar");
});

for (const role of ["calisan", "kargo_operatoru"]) {
  test(`settings: ${role} only sees profile and preferences`, async ({ page }) => {
    const state = await signIn(page, role);
    await page.goto("/ayarlar?tab=whatsapp");
    await expect(page.getByTestId("settings-tab-panel-account")).toBeVisible();
    await expect(page.getByTestId("settings-profile")).toBeVisible();
    await expect(page.getByTestId("settings-preferences")).toBeVisible();
    await expect(page.getByTestId("settings-tabs")).toHaveCount(0);
    await expect(page.getByTestId("settings-tab-select")).toHaveCount(0);
    await expect(page.getByTestId("settings-tab-panel-whatsapp")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect(state.requests.some((request) => request.path.startsWith("/admin/"))).toBe(false);
  });
}

test("settings: mobile tab picker and layout at 360px", async ({ page }) => {
  await signIn(page, "admin", viewports.phone360);
  await page.goto("/ayarlar");
  await expect(page.getByTestId("settings-tabs")).toBeHidden();
  const picker = page.getByTestId("settings-tab-select");
  await expect(picker).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectResponsiveLayout(page, { checkTouchTargets: true });
  for (const [tab, panel] of [
    ["ai", "settings-tab-panel-ai"],
    ["integrations", "settings-integration-cards"],
    ["whatsapp", "whatsapp-form"],
    ["instagram", "instagram-form"],
    ["netgsm", "netgsm-form"],
    ["santral", "santral-config-form"],
  ] as const) {
    await picker.selectOption(tab);
    await expect(page).toHaveURL(new RegExp(`\\?tab=${tab}$`));
    await expect(page.getByTestId(panel)).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectResponsiveLayout(page, { checkTouchTargets: true });
  }
});

test("settings: English labels on the manager tabs", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("garanti-beta-lang", "en"));
  await signIn(page, "admin", viewports.desktop, { aiEnabled: true });
  await page.goto("/ayarlar");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(page.getByTestId("settings-tabs").getByRole("tab")).toHaveText(["Profile & preferences", "General AI", "Integrations", "WhatsApp", "Instagram", "Messenger", "NetGSM", "PBX"]);
  await page.getByTestId("settings-tab-ai").click();
  await expect(page.getByTestId("settings-ai-badge")).toHaveText("AI on");
  await expect(page.getByRole("heading", { name: "AI auto reply" })).toBeVisible();
  await page.getByTestId("settings-tab-integrations").click();
  await expect(page.getByTestId("settings-integration-account-messenger")).toHaveText("No account");
  await expect(page.getByTestId("settings-related-links")).toContainText("Data deletion requests");
  await page.getByTestId("settings-tab-netgsm").click();
  await expect(page.getByTestId("netgsm-password-status")).toHaveText("Password configured");
  await expect(page.getByTestId("netgsm-password")).toHaveAttribute("placeholder", "•••••••• · enter a new value to replace");
});
