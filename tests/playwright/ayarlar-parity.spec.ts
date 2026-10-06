import { expect, type Page, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

const backendBaseUrl = "http://127.0.0.1:65530";

test.setTimeout(60_000);

interface PlaywrightUser {
  public_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  permissions: string[];
  is_online: boolean;
  sip_username: string;
}

declare global {
  interface Window {
    __GARANTI_REALTIME_TEST__?: {
      emitted: Array<{ event: string; payload: unknown }>;
      emitServer: (event: string, payload: unknown) => void;
    };
  }
}

async function startWebApp() {
  const server = await createServer({
    root: "apps/web",
    configFile: "apps/web/vite.config.ts",
    server: {
      host: "127.0.0.1",
      port: 0,
    },
    define: {
      "import.meta.env.VITE_BACKEND_BASE_URL": JSON.stringify(backendBaseUrl),
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("Vite dev server did not expose a TCP address");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    server,
  };
}

async function closeWebApp(server: ViteDevServer) {
  await server.close();
}



type SettingRow = { key: string; scope: string; value: unknown; is_secret: boolean; updated_at: string };

const now = "2026-01-01T09:30:00.000Z";

function adminFallback(pathname: string) {
  if (pathname === "/admin/settings/audit" || pathname === "/admin/integrations/audit") return { data: [], summary: { total_count: 0 } };
  if (pathname === "/admin/integrations/accounts") return { data: [] };
  if (pathname === "/admin/integrations/provider-catalog") {
    return {
      data: ["ptt", "surat", "netgsm"].map((provider) => ({
        provider,
        channels: ["cargo"],
        supported_operations: ["shipment.track"],
        contract_mode: "fixture_only",
        live_feature_flag_key: `providers.${provider}.live_mode`,
        live_call_permitted: false,
        live_block_reason: "fixture_replay_contract_required",
      })),
    };
  }
  if (pathname === "/admin/integrations/provider-debug-summary") {
    return {
      providers: [],
      cron: { provider_keys: ["ptt", "surat"], operation: "shipment.track", total_attempts: 0, success_count: 0, failure_count: 0, retry_count: 0, total_duration_ms: 0, latest_attempt: null },
    };
  }
  if (pathname === "/api/files/orphans") return { data: [] };
  return undefined;
}

function attempt(index: number, provider: "ptt" | "surat", overrides: Record<string, unknown> = {}) {
  return {
    public_id: `pat_${provider}_${index}`,
    provider_key: provider,
    account_public_id: null,
    request_id: `req_${provider}_${index}`,
    operation: "shipment.track",
    direction: "outbound",
    status: "success",
    status_code: 200,
    duration_ms: 400 + index * 100,
    retry_decision: "none",
    next_retry_at: null,
    idempotency_key: null,
    request_metadata: {},
    provider_request_preview: {
      method: "POST",
      path: "/kargo-takip",
      headers: { authorization: "[redacted]" },
      body: { takip_no: `TRK${index}` },
      live_call_performed: false,
    },
    response_metadata: { mode: "dry_run" },
    error_code: null,
    error_message: null,
    started_at: `2026-01-01T09:3${index}:00.000Z`,
    updated_at: now,
    ...overrides,
  };
}

const tabsByRole = {
  admin: ["Profil", "Genel", "Kullanıcılar", "İşlem Logları", "Entegrasyonlar", "Santral / Softphone", "VAPI AI Arama", "Teslim Alınmayan Kargo Pipeline"],
  calisan: ["Profil", "Genel"],
  kargo_operatoru: ["Profil", "Genel"],
} as const;

for (const role of ["admin", "calisan", "kargo_operatoru"] as const) {
  test(`${role} Ayarlar legacy tab visibility and backend settings parity`, async ({ page }) => {
    const app = await startWebApp();
    const user = loginUser({ role, email: `${role}@example.com`, first_name: "Deneme", last_name: "Kişi" });
    const requested: string[] = [];
    const settingWrites: Array<{ key: string; body: Record<string, unknown> }> = [];
    const userWrites: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = [];
    const accountWrites: Array<{ path: string; body: Record<string, unknown> }> = [];
    const settings: SettingRow[] = [
      { key: "ai.system_prompt", scope: "global", value: "Sen yardımcı bir asistansın, kibar ol.", is_secret: false, updated_at: now },
      { key: "vapi.api_key", scope: "global", value: null, is_secret: true, updated_at: now },
      { key: "sip_config", scope: "global", value: { ws_url: "wss://sip.example.com/ws", domain: "sip.example.com", stun: "stun:stun.l.google.com:19302" }, is_secret: false, updated_at: now },
    ];
    let aiEnabled = true;
    const users = [
      { public_id: "usr_staff", email: "staff@example.com", first_name: "Ayşe", last_name: "Kaya", phone: null, role: "calisan", is_active: true, is_online: false, last_seen_at: now, sip_username: "1001", sip_password_configured: true, created_at: now },
    ];

    await installRealtimeShim(page);
    await page.route(`${backendBaseUrl}/**`, async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      requested.push(`${method} ${url.pathname}`);
      const body = route.request().postData() ? (JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>) : null;
      const json = (status: number, payload: unknown) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });

      if (url.pathname === "/auth/login") return json(200, loginBody(user));
      if (url.pathname === "/auth/me" || url.pathname === "/auth/presence") return json(200, user);
      if (url.pathname === "/api/conversations") return json(200, { data: [] });
      if (url.pathname === "/api/conversations/summary") {
        return json(200, { total_count: 0, unread_count: 0, pool_count: 0, human_agent_count: 0, channel_counts: {}, status_counts: { open: 0 } });
      }
      if (url.pathname === "/api/app-settings/ai-status") return json(200, { ai_enabled: aiEnabled });
      if (url.pathname === "/auth/account/profile") {
        accountWrites.push({ path: url.pathname, body: body ?? {} });
        return json(200, { first_name: body?.first_name, last_name: body?.last_name });
      }
      if (url.pathname === "/auth/account/password") {
        accountWrites.push({ path: url.pathname, body: body ?? {} });
        return json(200, { updated: true });
      }
      if (url.pathname.startsWith("/admin/")) {
        if (role !== "admin") return json(403, { error: { code: "forbidden", message: "Admin role is required" } });
        if (url.pathname === "/admin/settings" && method === "GET") return json(200, { data: settings });
        const settingMatch = /^\/admin\/settings\/([^/]+)$/.exec(url.pathname);
        if (settingMatch && method === "PUT") {
          const key = decodeURIComponent(settingMatch[1] ?? "");
          settingWrites.push({ key, body: body ?? {} });
          const isSecret = key.endsWith("api_key") || key.endsWith("password");
          const saved = { key, scope: "global", value: isSecret ? null : body?.value, is_secret: isSecret, updated_at: now };
          const index = settings.findIndex((item) => item.key === key);
          if (index >= 0) settings[index] = saved;
          else settings.push(saved);
          if (key === "ai.auto_reply_enabled") aiEnabled = body?.value === true;
          return json(200, saved);
        }
        if (url.pathname === "/admin/users" && method === "GET") return json(200, { data: users, roles: ["admin", "calisan", "kargo_operatoru"] });
        if (url.pathname === "/admin/users" && method === "POST") {
          userWrites.push({ method, path: url.pathname, body });
          const created = { ...users[0]!, public_id: "usr_new", email: String(body?.email), first_name: String(body?.first_name), last_name: String(body?.last_name ?? ""), role: String(body?.role), sip_username: null, sip_password_configured: false };
          users.push(created);
          return json(201, { user: created });
        }
        const userMatch = /^\/admin\/users\/([^/]+)$/.exec(url.pathname);
        if (userMatch) {
          userWrites.push({ method, path: url.pathname, body });
          const index = users.findIndex((item) => item.public_id === userMatch[1]);
          if (method === "DELETE") {
            // soft delete; SIP list below still needs the fixture user, so do not persist.
            return json(200, { user: { ...users[index]!, is_active: false }, deactivated: true });
          }
          const patch = { ...(body ?? {}) } as Record<string, unknown>;
          if ("sip_password" in patch) {
            delete patch.sip_password;
            patch.sip_password_configured = true;
          }
          users[index] = { ...users[index]!, ...patch } as (typeof users)[number];
          return json(200, { user: users[index] });
        }
        if (url.pathname === "/admin/logs") {
          return json(200, { data: [{ id: 1, actor_name: "Deneme Kişi", action: "create", module: "users", entity_id: "usr_staff", created_at: now }] });
        }
        if (url.pathname === "/admin/integrations/netgsm/balance") {
          return json(200, { provider: "netgsm", operation: "account.balance", balance: null, currency: "TRY", sms_credit: null, status: "dry_run", live_call_permitted: false, live_gate: "providers.netgsm.live_mode", block_reason: "fixture_replay_contract_required", checked_at: now });
        }
        if (url.pathname === "/admin/integrations/provider-attempts") {
          const provider = url.searchParams.get("provider_key");
          if (provider === "surat") {
            return json(200, {
              data: [
                attempt(1, "surat"),
                attempt(2, "surat", { status: "failed", retry_decision: "retry", error_message: "Sürat zaman aşımı", provider_request_preview: { method: "POST", path: "/kargoya-gonder", headers: { authorization: "[redacted]" }, body: { alici: "raw-surat-secret-redacted" }, live_call_performed: false } }),
              ],
            });
          }
          if (provider === "ptt") return json(200, { data: [attempt(3, "ptt")] });
          return json(200, { data: [] });
        }
        const cronMatch = /^\/admin\/integrations\/provider-cron-triggers\/(ptt|surat)$/.exec(url.pathname);
        if (cronMatch && method === "POST") {
          return json(202, attempt(9, cronMatch[1] as "ptt" | "surat", { request_id: `cron_${cronMatch[1]}_manual`, started_at: "2026-01-01T10:00:00.000Z" }));
        }
        const adminFallbackBody = adminFallback(url.pathname);
        if (adminFallbackBody !== undefined) return json(200, adminFallbackBody);
      }
      const fallback = fallbackResponse(url.pathname) ?? adminFallback(url.pathname);
      if (fallback !== undefined) return json(200, fallback);
      return route.fulfill({ status: 404, body: "not found" });
    });

    try {
      await page.goto(`${app.url}/giris`);
      await page.getByRole("button", { name: /giriş yap/i }).click();
      await expect(page.getByRole("link", { name: /^ayarlar$/i })).toHaveCount(1);
      await page.getByRole("link", { name: /^ayarlar$/i }).click();

      const flow = page.getByTestId("admin-flow");
      await expect(flow).toContainText("Sistem ve hesap ayarlarını yönet");
      const tabs = page.getByTestId("ayarlar-tabs").getByRole("tab");
      await expect(tabs).toHaveText([...tabsByRole[role]]);

      // Profil
      await expect(page.getByTestId("ayarlar-profil")).toContainText("E-posta (Değiştirilemez)");
      await expect(page.getByTestId("ayarlar-profil")).toContainText(`${role}@example.com`);
      await page.getByLabel("Soyad").fill("Yeni");
      await page.getByRole("button", { name: "Değişiklikleri Kaydet" }).click();
      await expect(page.getByTestId("ayarlar-mesaj")).toContainText("Profil güncellendi.");
      await page.getByLabel("Yeni Şifre", { exact: true }).fill("abc");
      await page.getByLabel("Yeni Şifre (Tekrar)").fill("abc");
      await page.getByRole("button", { name: "Şifreyi Güncelle" }).click();
      await expect(page.getByTestId("ayarlar-mesaj")).toContainText("Şifre en az 6 karakter olmalı.");
      await page.getByLabel("Yeni Şifre", { exact: true }).fill("secret1");
      await page.getByLabel("Yeni Şifre (Tekrar)").fill("secret1");
      await page.getByRole("button", { name: "Şifreyi Güncelle" }).click();
      await expect(page.getByTestId("ayarlar-mesaj")).toContainText("Şifre güncellendi.");
      expect(accountWrites).toEqual([
        { path: "/auth/account/profile", body: { first_name: "Deneme", last_name: "Yeni" } },
        { path: "/auth/account/password", body: { password: "secret1", password_confirmation: "secret1" } },
      ]);

      // Genel
      await page.getByRole("tab", { name: "Genel" }).click();
      await expect(page.getByTestId("ayarlar-genel")).toContainText("AI AÇIK");
      await page.getByRole("button", { name: "Yapay Zeka Otomatik Yanıt" }).click();

      if (role !== "admin") {
        await expect(page.getByTestId("ayarlar-mesaj")).toContainText("Bu ayarı değiştirme yetkiniz yok.");
        await expect(page.getByTestId("ayarlar-ai-prompt")).toHaveCount(0);
        expect(requested.filter((entry) => entry.includes(" /admin/"))).toEqual([]);
        await page.goto(`${app.url}/kargo/surat-debug`);
        await expect(page.getByTestId("surat-debug-flow")).toHaveCount(0);
        await expect(page.getByRole("link", { name: /sürat debug/i })).toHaveCount(0);
        return;
      }

      await expect(page.getByTestId("ayarlar-mesaj")).toContainText("Yapay zeka kapatıldı.");
      await expect(page.getByTestId("ayarlar-genel")).toContainText("AI KAPALI");
      await expect(page.getByTestId("ayarlar-ai-prompt")).toContainText("Özel Prompt");
      await page.getByRole("button", { name: "Kaydet" }).click();
      await expect(page.getByTestId("ayarlar-mesaj")).toContainText("AI prompt kaydedildi.");
      expect(settingWrites.map((write) => write.key)).toEqual(["ai.auto_reply_enabled", "ai.system_prompt"]);

      // Kullanıcılar
      await page.getByRole("tab", { name: "Kullanıcılar" }).click();
      const usersTab = page.getByTestId("ayarlar-kullanicilar");
      await expect(usersTab).toContainText("Kullanıcı Yönetimi");
      await expect(usersTab).toContainText("Ayşe Kaya");
      await expect(usersTab).toContainText("Çalışan");
      await page.getByRole("button", { name: "Yeni Kullanıcı" }).click();
      const modal = page.getByRole("dialog", { name: "Yeni Kullanıcı" });
      await modal.getByLabel("Ad *").fill("Mehmet");
      await modal.getByLabel("E-posta *").fill("mehmet@example.com");
      await modal.getByLabel("Şifre *").fill("secret1");
      await modal.getByLabel("Rol").selectOption("kargo_operatoru");
      await modal.getByRole("button", { name: "Oluştur" }).click();
      await expect(page.getByTestId("ayarlar-mesaj")).toContainText("Mehmet oluşturuldu.");
      await expect(usersTab).toContainText("Kargo Operatörü");
      await page.getByTestId("kullanici-usr_staff").getByRole("button", { name: "Sil" }).click();
      await page.getByTestId("kullanici-usr_staff").getByRole("button", { name: "Evet" }).click();
      await expect(page.getByTestId("ayarlar-mesaj")).toContainText("Kullanıcı silindi.");
      expect(userWrites.map((write) => `${write.method} ${write.path}`)).toEqual(["POST /admin/users", "DELETE /admin/users/usr_staff"]);
      expect(userWrites[0]?.body).toMatchObject({ email: "mehmet@example.com", first_name: "Mehmet", password: "secret1", role: "kargo_operatoru" });

      // İşlem Logları
      await page.getByRole("tab", { name: "İşlem Logları" }).click();
      await expect(page.getByTestId("ayarlar-loglar")).toContainText("Deneme Kişi");
      await expect(page.getByTestId("ayarlar-loglar")).toContainText("create");

      // Entegrasyonlar: webhook callback copy + masked token
      await page.getByRole("tab", { name: "Entegrasyonlar" }).click();
      await expect(page.getByTestId("ayarlar-instagram")).toContainText("Instagram Entegrasyonu");
      await expect(page.getByTestId("ayarlar-instagram-callback")).toContainText("/webhooks/instagram");
      await page.getByRole("button", { name: "Messenger" }).click();
      await expect(page.getByTestId("ayarlar-messenger")).toContainText("Messenger Entegrasyonu");

      // Santral / NetGSM
      await page.getByRole("tab", { name: "Santral / Softphone" }).click();
      const santral = page.getByTestId("ayarlar-santral");
      await expect(santral.getByLabel("Domain")).toHaveValue("sip.example.com");
      await expect(page.getByTestId("ayarlar-netgsm-bakiye")).toContainText("providers.netgsm.live_mode");
      await page.getByRole("button", { name: "Otomatik arama aktif" }).click();
      await expect(page.getByTestId("ayarlar-netgsm-teyit")).toContainText("5 dakika");
      await page.getByTestId("ayarlar-netgsm-teyit").getByRole("button", { name: "Kaydet" }).click();
      await expect(page.getByTestId("ayarlar-mesaj")).toContainText("Ayarlar kaydedildi.");
      await page.getByTestId("ayarlar-teyit-voice").getByLabel("Arayan numara (NetGSM usercode)").fill("3229110370");
      await page.getByTestId("ayarlar-teyit-voice").getByLabel("Şifre").fill("netgsm-secret");
      await page.getByTestId("ayarlar-teyit-voice").getByRole("button", { name: "Kaydet" }).click();
      await expect(page.getByTestId("ayarlar-mesaj")).toContainText("Teyit araması arayan numarası kaydedildi.");
      await expect(page.getByTestId("ayarlar-teyit-voice").getByLabel("Şifre")).toHaveValue("");
      await expect(page.getByTestId("sip-usr_staff")).toContainText("1001");
      await page.getByTestId("sip-usr_staff").getByRole("button", { name: "Düzenle" }).click();
      await page.getByTestId("sip-usr_staff").getByLabel("SIP Şifre").fill("sip-secret");
      await page.getByTestId("sip-usr_staff").getByRole("button", { name: "Kaydet" }).click();
      await expect(page.getByTestId("ayarlar-mesaj")).toContainText("SIP bilgisi kaydedildi.");
      await expect(page.getByTestId("sip-usr_staff")).not.toContainText("sip-secret");

      // VAPI: secret api key masked
      await page.getByRole("tab", { name: "VAPI AI Arama" }).click();
      await expect(page.getByTestId("ayarlar-vapi")).toContainText("VAPI Yapılandırması");
      await expect(page.getByLabel("VAPI API Key")).toHaveAttribute("placeholder", /tanımlı/);
      await page.getByLabel("VAPI API Key").fill("sk-new");
      await page.getByTestId("ayarlar-vapi").getByRole("button", { name: "Kaydet" }).first().click();
      await expect(page.getByTestId("ayarlar-mesaj")).toContainText("VAPI ayarları kaydedildi.");

      // Kargo pipeline
      await page.getByRole("tab", { name: "Teslim Alınmayan Kargo Pipeline" }).click();
      await expect(page.getByTestId("ayarlar-kargo-pipeline")).toContainText("Kargo Pipeline Ayarları");
      await page.getByTestId("ayarlar-kargo-pipeline").getByRole("button", { name: "Kaydet" }).click();
      await expect(page.getByTestId("ayarlar-mesaj")).toContainText("Kargo pipeline ayarları kaydedildi");

      expect(settingWrites.map((write) => write.key)).toEqual([
        "ai.auto_reply_enabled",
        "ai.system_prompt",
        "netgsm_teyit_ayarlar",
        "netgsm.teyit_voice_usercode",
        "netgsm.teyit_voice_password",
        "vapi_ayarlar",
        "vapi.api_key",
        "kargo_pipeline_ayarlar",
      ]);
      expect(userWrites.at(-1)).toMatchObject({ method: "PATCH", path: "/admin/users/usr_staff", body: { sip_username: "1001", sip_password: "sip-secret" } });

      // Sürat debug
      await page.getByRole("link", { name: /sürat debug/i }).click();
      const surat = page.getByTestId("surat-debug-flow");
      await expect(surat).toContainText("Sürat Kargo Debug");
      await expect(surat).toContainText("Kurtarıldı");
      await expect(surat).toContainText("2/200 log");
      await expect(page.getByTestId("surat-debug-detail")).toContainText("providers.surat.live_mode");
      await page.getByLabel("Durum").selectOption("hata");
      await expect(surat).toContainText("failed / retry");
      await expect(surat).not.toContainText("success / none");
      await surat.getByRole("button", { name: /failed \/ retry/ }).click();
      await expect(surat).toContainText("[redacted]");
      await expect(surat).toContainText("Sürat zaman aşımı");
      await surat.getByRole("button", { name: "Temizle" }).click();
      await expect(surat).toContainText("Henüz debug logu yok");

      // Cron debug
      await page.getByRole("link", { name: /cron debug/i }).click();
      const cron = page.getByTestId("cron-debug-flow");
      await expect(cron).toContainText("Kargo Takip Cron Debug");
      await expect(page.getByTestId("cron-debug-detail")).toContainText("PTT Kargo Cron");
      await expect(page.getByTestId("cron-debug-detail")).toContainText("Sürat Kargo Cron");
      await expect(cron).toContainText("3 / 3 cron çalışması gösteriliyor");
      await page.getByRole("button", { name: "PTT Cron" }).click();
      await expect(cron).toContainText("cron_ptt_manual");
      await page.getByLabel("Firma").selectOption("surat");
      await expect(cron).not.toContainText("req_ptt_3");
    } finally {
      await closeWebApp(app.server);
    }
  });
}

function fallbackResponse(pathname: string) {
  const emptyData = { data: [] };
  if (pathname === "/api/customers") {
    return {
      data: [
        {
          public_id: "cus_media",
          full_name: "Slice Müşteri",
          phone: "5550000000",
          email: null,
          username: null,
          notes: null,
          updated_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
  }
  if (pathname === "/api/message-shortcuts") return emptyData;
  if (pathname === "/api/customers/summary") return { total_count: 0, with_phone_count: 0, with_email_count: 0, with_notes_count: 0 };
  if (pathname === "/api/comments/moderation-summary") return { manual_queue: 0, automatic_queue: 0, answered: 0, instagram: 0, facebook: 0 };
  if (pathname === "/api/balances/summary") return { total_commission: 0, total_deduction: 0, pending_payment: 0, available_balance: 0, pending_request_count: 0 };
  if (pathname === "/api/orders") return emptyData;
  if (pathname === "/api/orders/summary") return { total_count: 0, active_count: 0, delivered_count: 0, pending_confirmation_count: 0, total_revenue: 0, currency: "TRY" };
  if (pathname === "/api/products") return emptyData;
  if (pathname === "/api/products/summary") return { total_count: 0, active_count: 0, critical_count: 0, critical_threshold: 3, category_counts: { incubator: 0, spare_part: 0, other: 0 } };
  if (pathname === "/api/shipments") return emptyData;
  if (pathname === "/api/shipments/summary") return { total_count: 0, active_count: 0, delivered_count: 0, recipient_phone_count: 0, provider_counts: { ptt: 0, surat: 0, other: 0 }, exception_counts: { ptt_not_delivered: 0, surat_not_delivered: 0, tracking_missing: 0 } };
  if (pathname === "/api/shipments/pipeline-summary") return { counts: { all: 0, mesaj: 0, sms: 0, vapi: 0, teslim: 0, bekliyor: 0, isleniyor: 0, hata: 0 }, rows: [] };
  if (pathname === "/api/reports/summary") return { conversation_count: 0, order_count: 0, shipment_count: 0, total_revenue: 0, currency: "TRY", open_conversation_count: 0, pending_confirmation_count: 0, active_shipment_count: 0, delivered_shipment_count: 0, delivered_shipment_rate: 0, confirmation_rate: 0, active_shipment_rate: 0 };
  if (pathname === "/api/webphone/config") return { enabled: false, sip_username: null, sip_password_configured: false, ws_url: null, domain: null, stun: null };
  return undefined;
}

async function installRealtimeShim(page: Page) {
  await page.addInitScript(`
    (() => {
      const emitted = [];
      const sockets = [];
      window.__GARANTI_REALTIME_TEST__ = {
        emitted,
        emitServer(event, payload) {
          for (const socket of sockets) {
            for (const listener of socket.listeners[event] || []) listener(payload);
          }
        }
      };
      window.__GARANTI_REALTIME_SOCKET_FACTORY__ = () => {
        const socket = {
          listeners: {},
          connect() { emitted.push({ event: "connect", payload: null }); },
          disconnect() { emitted.push({ event: "disconnect", payload: null }); },
          emit(event, payload) { emitted.push({ event, payload }); },
          on(event, listener) {
            socket.listeners[event] = socket.listeners[event] || [];
            socket.listeners[event].push(listener);
          },
          off(event, listener) {
            socket.listeners[event] = (socket.listeners[event] || []).filter((candidate) => candidate !== listener);
          }
        };
        sockets.push(socket);
        return socket;
      };
    })();
  `);
}

function loginUser(overrides: Partial<PlaywrightUser> = {}): PlaywrightUser {
  return {
    public_id: "usr_messages_slice",
    email: "calisan@example.com",
    first_name: "Çalışan",
    last_name: "Kullanıcı",
    role: "calisan",
    permissions: [],
    is_online: true,
    sip_username: "1002",
    ...overrides,
  };
}

function loginBody(user: PlaywrightUser) {
  return {
    access_token: "messages-slice-token",
    refresh_token: "messages-slice-refresh-token",
    token_type: "Bearer",
    expires_in: 900,
    user,
  };
}
