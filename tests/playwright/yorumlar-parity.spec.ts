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


type CommentRow = {
  public_id: string;
  platform: "instagram" | "facebook";
  external_comment_id: string;
  media_id: string | null;
  post_id: string | null;
  username: string | null;
  text: string | null;
  status: string;
  classification: string | null;
  classification_reason: string | null;
  confidence: number | null;
  ai_reply_draft: string | null;
  manual_reply: string | null;
  reply_type: "public" | "private" | null;
  error_message: string | null;
  received_at: string;
  updated_at: string;
};

function commentRow(overrides: Partial<CommentRow>): CommentRow {
  return {
    public_id: "scm_ig_1",
    platform: "instagram",
    external_comment_id: "17890000000000001",
    media_id: "media_1",
    post_id: null,
    username: "civciv_sever",
    text: "Fiyatı nedir?",
    status: "manual",
    classification: "soru",
    classification_reason: "fiyat sorusu",
    confidence: 0.81,
    ai_reply_draft: "Fiyatımız 2550 TL efendim.",
    manual_reply: null,
    reply_type: null,
    error_message: null,
    received_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

for (const role of ["admin", "calisan"] as const) {
  test(`${role} Yorumlar moderasyonu legacy parity actions go through backend comment API`, async ({ page }) => {
    const app = await startWebApp();
    const user = loginUser({ role, email: `${role}@example.com` });
    const comments: CommentRow[] = [
      commentRow({}),
      commentRow({
        public_id: "scm_fb_1",
        platform: "facebook",
        external_comment_id: "fb_comment_1",
        username: "kumes_dostu",
        text: "Kargo ne zaman gelir?",
        status: "manual",
        ai_reply_draft: null,
        confidence: null,
        classification: null,
        classification_reason: null,
      }),
      commentRow({
        public_id: "scm_ig_auto",
        external_comment_id: "17890000000000002",
        username: "otomatik_kullanici",
        text: "Teşekkürler",
        status: "auto_replied",
      }),
    ];
    const listUrls: string[] = [];
    const actionCalls: Array<{ path: string; body: Record<string, unknown> }> = [];
    let savedSettings: Record<string, unknown> | null = null;
    let config = {
      enabled: true,
      platforms: { instagram: true, facebook: true },
      reply_type: "public",
      delete_profanity: true,
      delete_brand_disparagement: true,
      risk_manual_examples: [] as string[],
      auto_reply_topics: [] as string[],
      min_confidence: 0.55,
    };

    await installRealtimeShim(page);

    await page.route(`${backendBaseUrl}/**`, async (route) => {
      const url = new URL(route.request().url());
      const method = route.request().method();

      if (url.pathname === "/auth/login") {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(loginBody(user)) });
        return;
      }
      if (url.pathname === "/auth/me" || url.pathname === "/auth/presence") {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(user) });
        return;
      }
      if (url.pathname === "/api/conversations") {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [] }) });
        return;
      }
      if (url.pathname === "/api/conversations/summary") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ total_count: 0, unread_count: 0, pool_count: 0, human_agent_count: 0, channel_counts: {}, status_counts: { open: 0 } }),
        });
        return;
      }

      if (url.pathname === "/api/comments") {
        listUrls.push(`${url.pathname}${url.search}`);
        const status = url.searchParams.get("status");
        const platform = url.searchParams.get("platform");
        const q = url.searchParams.get("q")?.toLocaleLowerCase("tr-TR");
        const rows = comments.filter(
          (comment) =>
            (!status || comment.status === status) &&
            (!platform || comment.platform === platform) &&
            (!q || (comment.text ?? "").toLocaleLowerCase("tr-TR").includes(q)),
        );
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ data: rows, total: rows.length, page: 1, page_size: 30 }),
        });
        return;
      }
      if (url.pathname === "/api/comments/stats") {
        const counts: Record<string, number> = { pending: 0, manual: 0, auto_replied: 0, replied: 0, deleted: 0, hidden: 0, error: 0 };
        for (const comment of comments) counts[comment.status] = (counts[comment.status] ?? 0) + 1;
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ counts }) });
        return;
      }
      if (url.pathname === "/api/comments/control") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            status: "warning",
            summary: { ok: 2, warning: 1, error: 0 },
            warnings: [{ id: "ai_dry_run", level: "warning", title: "AI cevap önerisi dry-run", detail: "OpenAI canlı çağrısı kapalı" }],
            checks: [],
          }),
        });
        return;
      }
      if (url.pathname === "/api/comments/settings") {
        if (method === "PUT") {
          savedSettings = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
          config = savedSettings as typeof config;
        }
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ config }) });
        return;
      }
      const actionMatch = /^\/api\/comments\/([^/]+)\/(reply|hide|delete|manual|ai-suggestion)$/.exec(url.pathname);
      if (actionMatch && method === "POST") {
        const [, publicId, action] = actionMatch;
        const payload = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
        actionCalls.push({ path: url.pathname, body: payload });
        const comment = comments.find((candidate) => candidate.public_id === publicId);
        if (!comment) {
          await route.fulfill({ status: 404, body: "not found" });
          return;
        }
        if (action === "ai-suggestion") {
          await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
              provider: "openai",
              operation: "comments.reply_suggestion",
              dry_run: true,
              live_call_permitted: false,
              comment_public_id: publicId,
              action: "manual",
              suggestion: "Kargonuz 1-3 iş gününde teslim edilir efendim.",
            }),
          });
          return;
        }
        const nextStatus = { reply: "replied", hide: "hidden", delete: "deleted", manual: "manual" }[action as "reply"];
        comment.status = nextStatus;
        comment.updated_at = "2026-01-01T00:05:00.000Z";
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({
            provider: action === "manual" ? null : "instagram",
            operation: null,
            action,
            job_id: action === "manual" ? null : `job_comment_${String(payload.idempotency_key)}`,
            queued: action !== "manual",
            replayed: false,
            live_call_permitted: false,
            comment,
          }),
        });
        return;
      }

      const fallback = fallbackResponse(url.pathname);
      if (fallback !== undefined) {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(fallback) });
        return;
      }
      await route.fulfill({ status: 404, body: "not found" });
    });

    try {
      await page.goto(`${app.url}/giris`);
      await page.getByRole("button", { name: /giriş yap/i }).click();
      await expect(page.getByRole("link", { name: /yorumlar/i })).toHaveCount(1);
      await page.goto(`${app.url}/yorumlar`);

      const flow = page.getByTestId("comments-flow");
      await expect(flow).toContainText("Facebook / Instagram post yorumları");
      await expect(page.getByTestId("yorumlar-control-panel")).toContainText("Yorum AI çalışır ama uyarılar var");
      await expect(page.getByTestId("yorumlar-control-panel")).toContainText("AI cevap önerisi dry-run");
      await expect(page.getByTestId("yorumlar-stat-manual")).toContainText("2");
      await expect(page.getByTestId("yorumlar-stat-auto_replied")).toContainText("1");
      await expect(page.getByTestId("yorumlar-config-pill")).toHaveText("AI açık · public");
      await expect(page.getByTestId("yorumlar-list")).toContainText("Fiyatı nedir?");
      await expect(page.getByTestId("yorumlar-list")).toContainText("Taslak: Fiyatımız 2550 TL efendim.");
      await expect(page.getByTestId("yorumlar-list")).toContainText("güven 0.81");
      await expect(page.getByTestId("yorumlar-list")).not.toContainText("Teşekkürler");

      // platform + status filters
      await page.getByTestId("yorumlar-platform-filter").selectOption("facebook");
      await expect(page.getByTestId("yorumlar-list")).toContainText("Kargo ne zaman gelir?");
      await expect(page.getByTestId("yorumlar-list")).not.toContainText("Fiyatı nedir?");
      await page.getByTestId("yorumlar-platform-filter").selectOption("tumu");
      await page.getByTestId("yorumlar-filter-auto_replied").click();
      await expect(page.getByTestId("yorumlar-list")).toContainText("Teşekkürler");
      await expect(page.getByTestId("yorumlar-row").first().getByTestId("yorumlar-status")).toHaveText("Otomatik");
      await page.getByTestId("yorumlar-filter-tumu").click();
      await page.getByTestId("yorumlar-search").fill("kargo");
      await page.getByTestId("yorumlar-search").press("Enter");
      await expect(page.getByTestId("yorumlar-row")).toHaveCount(1);
      await page.getByTestId("yorumlar-search").fill("");
      await page.getByTestId("yorumlar-search").press("Enter");
      await page.getByTestId("yorumlar-filter-manual").click();
      expect(listUrls).toEqual(
        expect.arrayContaining([
          "/api/comments?page=1&page_size=30&status=manual",
          "/api/comments?page=1&page_size=30&status=manual&platform=facebook",
          "/api/comments?page=1&page_size=30&status=auto_replied",
          "/api/comments?page=1&page_size=30&q=kargo",
        ]),
      );

      // AI dry-run suggestion then private reply through modal
      const fbRow = page.getByTestId("yorumlar-row").filter({ hasText: "Kargo ne zaman gelir?" });
      await fbRow.getByTestId("yorumlar-ai-button").click();
      await expect(page.getByTestId("yorumlar-toast")).toContainText("İşlendi: manual (dry-run)");
      await expect(fbRow).toContainText("Taslak: Kargonuz 1-3 iş gününde teslim edilir efendim.");
      await fbRow.getByTestId("yorumlar-reply-button").click();
      const modal = page.getByTestId("yorumlar-reply-modal");
      await expect(modal).toContainText("@kumes_dostu · facebook");
      await expect(page.getByTestId("yorumlar-reply-text")).toHaveValue("Kargonuz 1-3 iş gününde teslim edilir efendim.");
      await page.getByTestId("yorumlar-reply-type").selectOption("private");
      await page.getByTestId("yorumlar-reply-send").click();
      await expect(page.getByTestId("yorumlar-toast")).toContainText("Cevap gönderildi");
      await expect(modal).toHaveCount(0);

      // public reply on Instagram comment with the AI draft
      const igRow = page.getByTestId("yorumlar-row").filter({ hasText: "Fiyatı nedir?" });
      await igRow.getByTestId("yorumlar-reply-button").click();
      await expect(page.getByTestId("yorumlar-reply-text")).toHaveValue("Fiyatımız 2550 TL efendim.");
      await page.getByTestId("yorumlar-reply-send").click();
      await expect(page.getByTestId("yorumlar-toast")).toContainText("Cevap gönderildi");
      await expect(page.getByTestId("yorumlar-stat-replied")).toContainText("2");

      // hide, manual, delete
      await page.getByTestId("yorumlar-filter-tumu").click();
      const autoRow = page.getByTestId("yorumlar-row").filter({ hasText: "Teşekkürler" });
      await autoRow.getByTestId("yorumlar-hide-button").click();
      await expect(page.getByTestId("yorumlar-toast")).toContainText("Yorum gizlendi");
      await expect(autoRow.getByTestId("yorumlar-status")).toHaveText("Gizlendi");
      await autoRow.getByTestId("yorumlar-manual-button").click();
      await expect(page.getByTestId("yorumlar-toast")).toContainText("Manuel kuyruğa alındı");
      await expect(autoRow.getByTestId("yorumlar-status")).toHaveText("Manuel");
      await autoRow.getByTestId("yorumlar-delete-button").click();
      await expect(page.getByTestId("yorumlar-toast")).toContainText("Yorum silindi/gizlendi");
      await expect(autoRow.getByTestId("yorumlar-status")).toHaveText("Silindi");
      await expect(page.getByTestId("yorumlar-stat-deleted")).toContainText("1");

      const byPath = (suffix: string) => actionCalls.filter((call) => call.path.endsWith(suffix));
      expect(byPath("/scm_fb_1/ai-suggestion")).toHaveLength(1);
      expect(byPath("/scm_fb_1/reply")[0]?.body).toMatchObject({
        message: "Kargonuz 1-3 iş gününde teslim edilir efendim.",
        reply_type: "private",
        idempotency_key: expect.stringContaining("yorum_private_reply_scm_fb_1"),
      });
      expect(byPath("/scm_ig_1/reply")[0]?.body).toMatchObject({ reply_type: "public", message: "Fiyatımız 2550 TL efendim." });
      expect(byPath("/scm_ig_auto/hide")[0]?.body).toMatchObject({ idempotency_key: expect.stringContaining("yorum_hide_scm_ig_auto") });
      expect(byPath("/scm_ig_auto/manual")).toHaveLength(1);
      expect(byPath("/scm_ig_auto/delete")).toHaveLength(1);

      // settings panel save
      await page.getByTestId("yorumlar-settings-button").click();
      const panel = page.getByTestId("yorumlar-settings-panel");
      await expect(panel).toContainText("Yorum AI Ayarları");
      await page.getByTestId("yorumlar-setting-enabled").uncheck();
      await page.getByTestId("yorumlar-setting-facebook").uncheck();
      await page.getByTestId("yorumlar-setting-reply-type").selectOption("private");
      await page.getByTestId("yorumlar-setting-risk").fill("kargom nerede\niade");
      await panel.getByRole("button", { name: "Kaydet" }).click();
      await expect(page.getByTestId("yorumlar-toast")).toContainText("Ayarlar kaydedildi");
      await expect(panel).toHaveCount(0);
      await expect(page.getByTestId("yorumlar-config-pill")).toHaveText("AI kapalı · DM");
      expect(savedSettings).toMatchObject({
        enabled: false,
        platforms: { instagram: true, facebook: false },
        reply_type: "private",
        risk_manual_examples: ["kargom nerede", "iade"],
      });
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
