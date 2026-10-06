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


type TemplateRow = {
  public_id: string;
  title: string;
  body: string;
  sort_order: number;
  is_active: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
};

type HistoryRow = {
  public_id: string;
  recipient_phone: string;
  customer_name: string | null;
  tracking_number: string | null;
  message: string;
  is_automatic: boolean;
  status: "queued" | "sent" | "failed";
  error_message: string | null;
  provider_bulk_id: string | null;
  request_id: string;
  job_id: string | null;
  queued: boolean;
  created_at: string;
};

function historyRow(index: number, overrides: Partial<HistoryRow> = {}): HistoryRow {
  return {
    public_id: `sms_hist_${index}`,
    recipient_phone: `555000${String(index).padStart(4, "0")}`,
    customer_name: index === 0 ? "Ahmet Yılmaz" : null,
    tracking_number: index === 0 ? "TRK-HIST-0" : null,
    message: `Geçmiş mesaj ${index}`,
    is_automatic: index % 2 === 1,
    status: index === 1 ? "failed" : index === 2 ? "queued" : "sent",
    error_message: index === 1 ? "30: Geçersiz kullanıcı" : null,
    provider_bulk_id: null,
    request_id: `req_hist_${index}`,
    job_id: `job_hist_${index}`,
    queued: true,
    created_at: "2026-01-01T09:30:00.000Z",
    ...overrides,
  };
}

for (const role of ["admin", "calisan", "kargo_operatoru"] as const) {
  test(`${role} SMS merkezi legacy parity goes through backend SMS API`, async ({ page }) => {
    const app = await startWebApp();
    const user = loginUser({ role, email: `${role}@example.com` });
    const templates: TemplateRow[] = [
      {
        public_id: "smt_system",
        title: "Kargo Bilgilendirme",
        body: "Sayın {musteri_adi}, {takip_no} takip numaralı kargonuz {kargo_firmasi} ile yolda.",
        sort_order: 1,
        is_active: true,
        is_system: true,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        public_id: "smt_custom",
        title: "Teşekkür",
        body: "Siparişiniz için teşekkür ederiz.",
        sort_order: 99,
        is_active: true,
        is_system: false,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        public_id: "smt_passive",
        title: "Pasif Şablon",
        body: "Kullanılmıyor",
        sort_order: 100,
        is_active: false,
        is_system: false,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    const history = Array.from({ length: 30 }, (_, index) => historyRow(index));
    const historyUrls: string[] = [];
    const sendPayloads: Array<Record<string, unknown>> = [];
    const templateCalls: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = [];
    const triggerPayloads: Array<Record<string, unknown>> = [];

    await installRealtimeShim(page);
    page.on("dialog", (dialog) => void dialog.accept());
    await page.route(`${backendBaseUrl}/**`, async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();
      const json = (status: number, payload: unknown) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });

      if (url.pathname === "/auth/login") return json(200, loginBody(user));
      if (url.pathname === "/auth/me" || url.pathname === "/auth/presence") return json(200, user);
      if (url.pathname === "/api/conversations") return json(200, { data: [] });
      if (url.pathname === "/api/conversations/summary") {
        return json(200, { total_count: 0, unread_count: 0, pool_count: 0, human_agent_count: 0, channel_counts: {}, status_counts: { open: 0 } });
      }

      if (url.pathname === "/api/sms/templates" && method === "GET") return json(200, { data: templates });
      if (url.pathname === "/api/sms/templates" && method === "POST") {
        const payload = JSON.parse(route.request().postData() ?? "{}") as { title: string; body: string };
        templateCalls.push({ method, path: url.pathname, body: payload });
        const created: TemplateRow = { ...templates[1]!, public_id: "smt_new", title: payload.title, body: payload.body, sort_order: 99 };
        templates.push(created);
        return json(201, { template: created });
      }
      const templateMatch = /^\/api\/sms\/templates\/([^/]+)$/.exec(url.pathname);
      if (templateMatch) {
        const publicId = templateMatch[1] ?? "";
        const payload = route.request().postData() ? (JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>) : null;
        templateCalls.push({ method, path: url.pathname, body: payload });
        const index = templates.findIndex((template) => template.public_id === publicId);
        if (index < 0) return json(404, { error: { code: "not_found", message: "Şablon bulunamadı" } });
        if (method === "PATCH") {
          templates[index] = { ...templates[index]!, ...(payload?.title ? { title: String(payload.title) } : {}), ...(payload?.body ? { body: String(payload.body) } : {}) };
          return json(200, { template: templates[index] });
        }
        if (method === "DELETE") {
          templates.splice(index, 1);
          return json(200, { deleted: true });
        }
      }
      if (url.pathname === "/api/sms/history") {
        historyUrls.push(`${url.pathname}${url.search}`);
        const type = url.searchParams.get("type") ?? "all";
        const q = url.searchParams.get("q")?.toLocaleLowerCase("tr-TR");
        const page = Number(url.searchParams.get("page") ?? "1");
        const pageSize = Number(url.searchParams.get("page_size") ?? "25");
        const rows = history.filter(
          (row) =>
            (type === "all" || row.is_automatic === (type === "automatic")) &&
            (!q || row.recipient_phone.includes(q) || (row.customer_name ?? "").toLocaleLowerCase("tr-TR").includes(q) || (row.tracking_number ?? "").toLocaleLowerCase("tr-TR").includes(q)),
        );
        return json(200, { data: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, page_size: pageSize });
      }
      if (url.pathname === "/api/sms/manual-send" && method === "POST") {
        const payload = JSON.parse(route.request().postData() ?? "{}") as { recipients: string[]; message: string };
        sendPayloads.push(payload);
        const messages = payload.recipients.map((phone, index) => ({
          ...historyRow(100 + index),
          recipient_phone: phone.replace(/\D/g, ""),
          message: payload.message,
          is_automatic: false,
          status: "queued",
          error_message: null,
        }));
        history.unshift(...messages);
        return json(202, {
          provider: "netgsm",
          operation: "sms.send",
          recipient_count: messages.length,
          queued_count: messages.length,
          replayed: false,
          live_call_permitted: false,
          live_gate: "providers.netgsm.live_mode",
          messages,
        });
      }
      if (url.pathname === "/api/sms/automatic/trigger" && method === "POST") {
        const payload = JSON.parse(route.request().postData() ?? "{}") as { provider: "ptt" | "surat" };
        triggerPayloads.push(payload);
        return json(202, {
          provider: payload.provider,
          operation: "shipment.track",
          checked_count: 2,
          queued_count: 2,
          job_ids: ["job_a", "job_b"],
          live_call_permitted: false,
          live_gate: `providers.${payload.provider}.live_mode`,
        });
      }

      const fallback = fallbackResponse(url.pathname);
      if (fallback !== undefined) return json(200, fallback);
      return route.fulfill({ status: 404, body: "not found" });
    });

    try {
      await page.goto(`${app.url}/giris`);
      await page.getByRole("button", { name: /giriş yap/i }).click();
      await expect(page.getByRole("link", { name: /^sms$/i })).toHaveCount(1);
      await page.goto(`${app.url}/sms`);

      const flow = page.getByTestId("sms-flow");
      await expect(flow).toContainText("Manuel gönderim, geçmiş kayıtlar, şablon yönetimi ve otomatik SMS ayarları");
      for (const label of ["Manuel Gönder", "Geçmiş", "Şablonlar", "Otomatik SMS"]) {
        await expect(page.getByRole("tab", { name: label })).toBeVisible();
      }
      await expect(page.getByTestId("sms-session")).toContainText("Henüz SMS gönderilmedi");

      // validation guards from legacy ManuelTab
      await page.getByTestId("sms-send-button").click();
      await expect(page.getByTestId("sms-toast")).toContainText("En az bir telefon numarası girin");
      await page.getByTestId("sms-phone-input").first().fill("0555 111 22 33");
      await page.getByTestId("sms-send-button").click();
      await expect(page.getByTestId("sms-toast")).toContainText("Mesaj boş olamaz");

      // template select with variables -> unfilled variable guard + preview
      await page.getByTestId("sms-template-select").click();
      await expect(page.getByTestId("sms-template-menu")).toContainText("Kargo Bilgilendirme");
      await expect(page.getByTestId("sms-template-menu")).not.toContainText("Pasif Şablon");
      await page.getByTestId("sms-template-menu").getByRole("button", { name: /Kargo Bilgilendirme/ }).click();
      await expect(page.getByTestId("sms-template-select")).toContainText("Kargo Bilgilendirme");
      await expect(page.getByTestId("sms-preview")).toContainText("Sayın [Ahmet Yılmaz], [123456789] takip numaralı kargonuz [PTT] ile yolda.");
      await expect(page.getByTestId("sms-manual-tab")).toContainText("Değişkenleri göndermeden önce doldurun veya silin");
      await page.getByTestId("sms-send-button").click();
      await expect(page.getByTestId("sms-toast")).toContainText("Mesajda doldurulmamış değişken var ({musteri_adi} vb.)");
      expect(sendPayloads).toHaveLength(0);

      // counter: GSM vs Turkish characters
      await page.getByTestId("sms-message-input").fill("a".repeat(161));
      await expect(page.getByTestId("sms-manual-counter")).toContainText("161 karakter");
      await expect(page.getByTestId("sms-manual-counter")).toContainText("2 SMS");
      await page.getByTestId("sms-message-input").fill("Kargonuz yola çıktı, iyi günler dileriz şimdiden");
      await expect(page.getByTestId("sms-manual-counter")).toContainText("1 SMS");
      await expect(page.getByTestId("sms-manual-counter")).toContainText("Türkçe karakter → 70 karakter/SMS");

      // variable insertion at cursor
      await page.getByTestId("sms-message-input").fill("Merhaba ");
      await page.getByTestId("sms-message-input").press("End");
      await page.getByTestId("sms-variable-takip-no").click();
      await expect(page.getByTestId("sms-message-input")).toHaveValue("Merhaba {takip_no}");
      await page.getByTestId("sms-message-input").fill("Kargonuz yolda, iyi günler");

      // multi recipient send
      await page.getByTestId("sms-add-phone").click();
      await page.getByTestId("sms-phone-input").nth(1).fill("0532 000 00 00");
      await page.getByTestId("sms-send-button").click();
      await expect(page.getByTestId("sms-toast")).toContainText("2 SMS başarıyla gönderildi");
      await expect(page.getByTestId("sms-session-item")).toHaveCount(2);
      await expect(page.getByTestId("sms-session")).toContainText("0555 111 22 33");
      await expect(page.getByTestId("sms-session")).toContainText("Kuyruğa alındı");
      await expect(page.getByTestId("sms-phone-input")).toHaveCount(1);
      await expect(page.getByTestId("sms-message-input")).toHaveValue("");
      expect(sendPayloads[0]).toMatchObject({
        recipients: ["0555 111 22 33", "0532 000 00 00"],
        message: "Kargonuz yolda, iyi günler",
        template_public_id: "smt_system",
        idempotency_key: expect.stringContaining("sms_manual_"),
      });

      // history tab: pagination, type filter, search
      await page.getByTestId("sms-tab-gecmis").click();
      const table = page.getByTestId("sms-history-table");
      await expect(table).toContainText("Ahmet Yılmaz");
      await expect(page.getByTestId("sms-history-row")).toHaveCount(25);
      await expect(page.getByTestId("sms-history-pagination")).toContainText("32 kayıttan 1–25 gösteriliyor");
      await expect(table).toContainText("Gönderildi");
      await expect(table).toContainText("Hata");
      await expect(table).toContainText("Kuyrukta");
      await expect(table).toContainText("Otomatik");
      await expect(table).toContainText("Manuel");
      await page.getByTestId("sms-history-next").click();
      await expect(page.getByTestId("sms-history-pagination")).toContainText("32 kayıttan 26–32 gösteriliyor");
      await page.getByTestId("sms-history-type-automatic").click();
      await expect(page.getByTestId("sms-history-type-automatic")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("sms-history-row")).toHaveCount(15);
      await page.getByTestId("sms-history-type-all").click();
      await page.getByTestId("sms-history-search").fill("TRK-HIST");
      await expect(page.getByTestId("sms-history-row")).toHaveCount(1);
      await expect(table).toContainText("TRK-HIST-0");
      await page.getByTestId("sms-history-search").fill("zzz-yok");
      await expect(page.getByTestId("sms-history-tab")).toContainText("Kayıt bulunamadı");
      expect(historyUrls).toEqual(
        expect.arrayContaining([
          "/api/sms/history?type=all&page=1&page_size=25",
          "/api/sms/history?type=all&page=2&page_size=25",
          "/api/sms/history?type=automatic&page=1&page_size=25",
          "/api/sms/history?type=all&page=1&page_size=25&q=TRK-HIST",
        ]),
      );

      // templates tab CRUD
      await page.getByTestId("sms-tab-sablonlar").click();
      const templatesTab = page.getByTestId("sms-templates-tab");
      await expect(templatesTab).toContainText("Kullanılabilir Değişkenler");
      await expect(templatesTab).toContainText("→ Müşteri Adı (örn: Ahmet Yılmaz)");
      await expect(page.getByTestId("sms-template-count")).toContainText("3 şablon • Sistem şablonları düzenlenebilir ama silinemez");
      const systemCard = page.getByTestId("sms-template-card").filter({ hasText: "Kargo Bilgilendirme" });
      await expect(systemCard).toContainText("Sistem");
      await expect(systemCard.getByTestId("sms-template-delete")).toHaveCount(0);
      await expect(page.getByTestId("sms-template-card").filter({ hasText: "Pasif Şablon" })).toContainText("Pasif");

      await page.getByTestId("sms-template-new").click();
      await page.getByTestId("sms-template-form").getByRole("button", { name: "Kaydet" }).click();
      await expect(page.getByTestId("sms-toast")).toContainText("Başlık ve metin boş olamaz");
      await page.getByTestId("sms-template-title-input").fill("Teslim Hatırlatma");
      await page.getByTestId("sms-template-body-input").fill("Merhaba ");
      await page.getByTestId("sms-template-body-input").press("End");
      await page.getByTestId("sms-template-form").getByTestId("sms-variable-musteri-adi").click();
      await expect(page.getByTestId("sms-template-body-input")).toHaveValue("Merhaba {musteri_adi}");
      await page.getByTestId("sms-template-form").getByRole("button", { name: "Kaydet" }).click();
      await expect(page.getByTestId("sms-toast")).toContainText("Şablon eklendi");
      await expect(page.getByTestId("sms-template-count")).toContainText("4 şablon");

      await systemCard.getByTestId("sms-template-edit").click();
      await page.getByTestId("sms-template-title-input").fill("Kargo Bilgilendirme v2");
      await page.getByTestId("sms-template-form").getByRole("button", { name: "Kaydet" }).click();
      await expect(page.getByTestId("sms-toast")).toContainText("Şablon güncellendi");
      await expect(templatesTab).toContainText("Kargo Bilgilendirme v2");

      await page.getByTestId("sms-template-card").filter({ hasText: "Teşekkür" }).getByTestId("sms-template-delete").click();
      await expect(page.getByTestId("sms-toast")).toContainText("Şablon silindi");
      await expect(page.getByTestId("sms-template-count")).toContainText("3 şablon");
      expect(templateCalls.map((call) => `${call.method} ${call.path}`)).toEqual([
        "POST /api/sms/templates",
        "PATCH /api/sms/templates/smt_system",
        "DELETE /api/sms/templates/smt_custom",
      ]);
      expect(templateCalls[0]?.body).toMatchObject({ title: "Teslim Hatırlatma", body: "Merhaba {musteri_adi}" });

      // automatic SMS tab
      await page.getByTestId("sms-tab-otomatik").click();
      const autoTab = page.getByTestId("sms-automatic-tab");
      await expect(autoTab).toContainText("Otomatik SMS Nasıl Çalışır?");
      await expect(page.getByTestId("sms-keywords")).toContainText("işyerinde bekliyor");
      await expect(page.getByTestId("sms-keywords")).toContainText("müşteri şubeden alacak");
      await page.getByTestId("sms-trigger-ptt").click();
      await expect(page.getByTestId("sms-toast")).toContainText("PTT takip güncelleme başlatıldı");
      await page.getByTestId("sms-trigger-surat").click();
      await expect(page.getByTestId("sms-toast")).toContainText("Sürat takip güncelleme başlatıldı");
      expect(triggerPayloads).toEqual([
        { provider: "ptt", idempotency_key: expect.stringContaining("sms_auto_ptt_") },
        { provider: "surat", idempotency_key: expect.stringContaining("sms_auto_surat_") },
      ]);
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
