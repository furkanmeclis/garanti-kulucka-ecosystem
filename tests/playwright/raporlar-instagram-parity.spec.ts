import { expect, type Page, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

const backendBaseUrl = "http://127.0.0.1:65529";

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

async function closeWebApp(server: ViteDevServer) {
  await server.close();
}

function localDate(daysAgo: number) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function user(role: string): PlaywrightUser {
  return {
    public_id: `usr_${role}`,
    email: `${role}@example.com`,
    first_name: "Test",
    last_name: "Kullanıcı",
    role,
    permissions: [],
    is_online: true,
    sip_username: "1002",
  };
}

function analysis(filters: { start_date: string; end_date: string; cargo_provider: string; personnel_public_id: string | null }) {
  const ptt = filters.cargo_provider === "ptt";
  const metrics = ptt
    ? {
        toplam: 3, ciro: 1500, aktif: 2, iptal: 1, iade: 0, sevk_edildi: 1, teslim_edildi: 1, kargoya_giden: 2,
        ptt: 2, surat: 0, ptt_subede: 1, surat_subede: 0, subede_toplam: 1, teyit_edildi: 2, teyit_bekliyor: 0,
        kargo_iade: 0, ptt_kargo_iade: 0, surat_kargo_iade: 0, kargo_takip_iade: 0,
      }
    : {
        toplam: 10, ciro: 12345.5, aktif: 7, iptal: 2, iade: 1, sevk_edildi: 3, teslim_edildi: 1, kargoya_giden: 5,
        ptt: 4, surat: 3, ptt_subede: 2, surat_subede: 1, subede_toplam: 3, teyit_edildi: 5, teyit_bekliyor: 2,
        kargo_iade: 1, ptt_kargo_iade: 1, surat_kargo_iade: 0, kargo_takip_iade: 2,
      };
  return {
    filters,
    currency: "TRY",
    metrics,
    rates: ptt
      ? { teslim: 50, iptal: 33.3, iade: 0, kargo_iade: 0, teyit: 100, sube: 50 }
      : { teslim: 25, iptal: 20, iade: 10, kargo_iade: 20, teyit: 71.4, sube: 60 },
    status_distribution: [
      { status: "teyit_bekliyor", count: 2 },
      { status: "sevk_edildi", count: 3 },
      { status: "teslim_edildi", count: 1 },
      { status: "iptal", count: 2 },
      { status: "iade", count: 1 },
    ],
    daily_source: ptt ? "filtered_rows" : "daily_series",
    daily: [
      { date: filters.start_date, orders: 4, revenue: 4000, cancelled: 1, returned: 0 },
      { date: filters.end_date, orders: 6, revenue: 8345.5, cancelled: 1, returned: 1 },
    ],
    cargo_providers: [
      { provider: "ptt", active: metrics.ptt, returns: metrics.ptt_kargo_iade },
      { provider: "surat", active: metrics.surat, returns: metrics.surat_kargo_iade },
    ],
    personnel_performance: [
      { user_public_id: "usr_a", name: "Ayşe Yılmaz", orders: 6, revenue: 9000, cancelled: 1 },
      { user_public_id: "usr_c", name: "Can Kaya", orders: 4, revenue: 3345.5, cancelled: 1 },
    ],
    personnel_options: [
      { public_id: "usr_a", first_name: "Ayşe", last_name: "Yılmaz" },
      { public_id: "usr_c", first_name: "Can", last_name: "Kaya" },
    ],
  };
}

function fallbackResponse(pathname: string) {
  const emptyData = { data: [] };
  if (pathname === "/api/conversations" || pathname === "/api/customers" || pathname === "/api/message-shortcuts") return emptyData;
  if (pathname === "/api/conversations/summary") {
    return { total_count: 0, unread_count: 0, pool_count: 0, human_agent_count: 0, channel_counts: {}, status_counts: { open: 0 } };
  }
  if (pathname === "/api/customers/summary") return { total_count: 0, with_phone_count: 0, with_email_count: 0, with_notes_count: 0 };
  if (pathname === "/api/comments/moderation-summary") return { manual_queue: 0, automatic_queue: 0, answered: 0, instagram: 0, facebook: 0 };
  if (pathname === "/api/balances/summary") return { total_commission: 0, total_deduction: 0, pending_payment: 0, available_balance: 0, pending_request_count: 0 };
  if (pathname === "/api/orders" || pathname === "/api/products" || pathname === "/api/shipments") return emptyData;
  if (pathname === "/api/orders/summary") return { total_count: 0, active_count: 0, delivered_count: 0, pending_confirmation_count: 0, total_revenue: 0, currency: "TRY" };
  if (pathname === "/api/products/summary") return { total_count: 0, active_count: 0, critical_count: 0, critical_threshold: 3, category_counts: { incubator: 0, spare_part: 0, other: 0 } };
  if (pathname === "/api/shipments/summary") return { total_count: 0, active_count: 0, delivered_count: 0, recipient_phone_count: 0, provider_counts: { ptt: 0, surat: 0, other: 0 }, exception_counts: { ptt_not_delivered: 0, surat_not_delivered: 0, tracking_missing: 0 } };
  if (pathname === "/api/shipments/pipeline-summary") return { counts: { all: 0, mesaj: 0, sms: 0, vapi: 0, teslim: 0, bekliyor: 0, isleniyor: 0, hata: 0 }, rows: [] };
  if (pathname === "/api/reports/summary") return { conversation_count: 0, order_count: 0, shipment_count: 0, total_revenue: 0, currency: "TRY", open_conversation_count: 0, pending_confirmation_count: 0, active_shipment_count: 0, delivered_shipment_count: 0, delivered_shipment_rate: 0, confirmation_rate: 0, active_shipment_rate: 0 };
  if (pathname === "/api/webphone/config") return { enabled: false, sip_username: null, sip_password_configured: false, ws_url: null, domain: null, stun: null };
  return undefined;
}

async function installRealtimeShim(page: Page) {
  await page.addInitScript(`
    (() => {
      window.__GARANTI_REALTIME_SOCKET_FACTORY__ = () => {
        const socket = {
          listeners: {},
          connect() {},
          disconnect() {},
          emit() {},
          on(event, listener) { socket.listeners[event] = socket.listeners[event] || []; socket.listeners[event].push(listener); },
          off(event, listener) { socket.listeners[event] = (socket.listeners[event] || []).filter((c) => c !== listener); },
        };
        return socket;
      };
    })();
  `);
}

interface Recorded {
  reportQueries: URLSearchParams[];
  publishBodies: Array<Record<string, unknown>>;
  uploadBodies: Array<Record<string, unknown>>;
  garagePuts: number;
  insightDays: string[];
}

async function setup(page: Page, role: string): Promise<Recorded> {
  const recorded: Recorded = { reportQueries: [], publishBodies: [], uploadBodies: [], garagePuts: 0, insightDays: [] };
  const current = user(role);
  await installRealtimeShim(page);
  await page.route(`${backendBaseUrl}/**`, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/auth/login") {
      return json({ access_token: "t", refresh_token: "r", token_type: "Bearer", expires_in: 900, user: current });
    }
    if (url.pathname === "/auth/me" || url.pathname === "/auth/presence") return json(current);
    if (url.pathname === "/api/reports/analysis") {
      if (role !== "admin") return json({ error: { code: "forbidden", message: "Reports analysis access is not allowed" } }, 403);
      recorded.reportQueries.push(url.searchParams);
      return json(
        analysis({
          start_date: url.searchParams.get("start_date") ?? "",
          end_date: url.searchParams.get("end_date") ?? "",
          cargo_provider: url.searchParams.get("cargo_provider") ?? "tumu",
          personnel_public_id: url.searchParams.get("personnel_public_id"),
        }),
      );
    }
    if (url.pathname.startsWith("/api/instagram/") && !["admin", "calisan"].includes(role)) {
      return json({ error: { code: "forbidden", message: "Instagram access is not allowed" } }, 403);
    }
    if (url.pathname === "/api/files/uploads" && method === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      recorded.uploadBodies.push(body);
      return json(
        {
          file: { public_id: "fil_photo", upload_status: "available", mime_type: body.mime_type, byte_size: body.byte_size },
          upload: { method: "PUT", headers: { "content-type": "image/jpeg" }, presigned_url: `${backendBaseUrl}/garage/media/photo.jpg`, expires_at: "2099-01-01T00:00:00.000Z" },
        },
        201,
      );
    }
    if (url.pathname === "/garage/media/photo.jpg" && method === "PUT") {
      recorded.garagePuts += 1;
      return route.fulfill({ status: 200, body: "" });
    }
    if (url.pathname === "/api/instagram/publications" && method === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      recorded.publishBodies.push(body);
      const publicId = `igp_${recorded.publishBodies.length}`;
      return json(
        {
          provider: "instagram",
          operation: "media.publish",
          publication: {
            public_id: publicId,
            account_public_id: "iac_1",
            media_kind: "image",
            media_type: "IMAGE",
            media_url: body.image_url ?? null,
            file_public_id: body.file_public_id ?? null,
            caption: body.caption,
            idempotency_key: body.idempotency_key,
            request_id: "req_igpub",
            job_id: "job_igpub",
            queued: true,
            status: "queued",
            media_id: null,
            error_message: null,
            created_at: "2026-10-06T09:00:00.000Z",
          },
          job_id: "job_igpub",
          queued: true,
          replayed: false,
          live_call_permitted: false,
          live_gate: "providers.instagram.live_mode",
        },
        202,
      );
    }
    const publication = /^\/api\/instagram\/publications\/(igp_\d+)$/.exec(url.pathname);
    if (publication) {
      return json({
        public_id: publication[1],
        account_public_id: "iac_1",
        media_kind: "image",
        media_type: "IMAGE",
        media_url: null,
        file_public_id: null,
        caption: "",
        idempotency_key: "k",
        request_id: "req_igpub",
        job_id: "job_igpub",
        queued: true,
        status: "published",
        media_id: "17895695668004550",
        error_message: null,
        created_at: "2026-10-06T09:00:00.000Z",
      });
    }
    if (url.pathname === "/api/instagram/insights/account") {
      const days = url.searchParams.get("days") ?? "7";
      recorded.insightDays.push(days);
      const values = days === "14"
        ? [{ value: 100, end_time: "2026-10-01T07:00:00+0000" }, { value: 250, end_time: "2026-10-02T07:00:00+0000" }, { value: 50, end_time: "2026-10-03T07:00:00+0000" }]
        : [{ value: 40, end_time: "2026-10-04T07:00:00+0000" }, { value: 60, end_time: "2026-10-05T07:00:00+0000" }];
      return json({
        success: true,
        cached: false,
        account_public_id: "iac_1",
        data: [
          { name: "impressions", period: "day", description: "Toplam gösterim", values: values.map((v) => ({ ...v, value: v.value * 3 })) },
          { name: "reach", period: "day", values },
          { name: "profile_views", period: "day", values: [{ value: 12, end_time: "2026-10-05T07:00:00+0000" }] },
        ],
        followers: { followers_count: 15230, media_count: 88 },
        period: { days: Number(days), since: 0, until: 0 },
        dry_run: true,
        live_call_permitted: false,
      });
    }
    const fallback = fallbackResponse(url.pathname);
    if (fallback !== undefined) return json(fallback);
    return route.fulfill({ status: 404, body: "not found" });
  });
  return recorded;
}

async function login(page: Page, appUrl: string) {
  await page.goto(`${appUrl}/giris`);
  await page.getByRole("button", { name: /giriş yap/i }).click();
  await expect(page.getByRole("link", { name: /mesajlar/i })).toHaveCount(1);
}

test("admin İş Analizi reproduces legacy filters, KPI cards, charts and rate summary from the SQL aggregate", async ({ page }) => {
  const app = await startWebApp();
  const recorded = await setup(page, "admin");
  try {
    await login(page, app.url);
    await expect(page.getByRole("link", { name: "İş Analizi" })).toHaveCount(1);
    await page.goto(`${app.url}/raporlar`);
    const sayfa = page.getByTestId("raporlar-page");
    await expect(sayfa).toContainText("İş Analizi");
    await expect(sayfa).toContainText("Sipariş, kargo, fatura ve sonuçlanma metrikleri — filtreli görünüm");

    const siparis = page.getByTestId("rapor-siparis-ozeti");
    await expect(siparis).toContainText("Toplam Sipariş10");
    await expect(siparis).toContainText("Aktif Sipariş7");
    await expect(siparis).toContainText("12.345,50 ₺");
    await expect(siparis).toContainText("%20 iptal oranı");
    await expect(siparis).toContainText("%10 iade oranı");

    const kargo = page.getByTestId("rapor-kargo-durumu");
    await expect(kargo).toContainText("Kargoya Verilenler5");
    await expect(kargo).toContainText("Yoldaki Kargolar3");
    await expect(kargo).toContainText("%25 teslim oranı");
    await expect(kargo).toContainText("PTT: 1 · Sürat: 0 · %20 iade oranı");
    await expect(kargo).toContainText("Şubede Bekleyen3");
    await expect(kargo).toContainText("PTT: 2 · Sürat: 1");
    await expect(kargo).toContainText("Takipte İade2");
    await expect(kargo).toContainText("Kargo hareketinde iade görünen");
    await expect(kargo).toContainText("%71.4");
    await expect(kargo).toContainText("2 teyit bekliyor");

    await expect(page.getByTestId("rapor-gunluk-trend")).toContainText("Günlük Sipariş Trendi");
    await expect(page.getByTestId("rapor-gunluk-trend").locator(".recharts-area")).toHaveCount(1);
    await expect(page.getByTestId("rapor-durum-dagilimi")).toContainText("Yoldaki Kargolar");
    await expect(page.getByTestId("rapor-gunluk-ciro").locator(".recharts-bar-rectangle")).toHaveCount(2);
    await expect(page.getByTestId("rapor-kargo-firmasi")).toContainText("Aktif Kargo");
    await expect(page.getByTestId("rapor-kargo-firmasi")).toContainText("Kargo İadesi");
    await expect(page.getByTestId("rapor-personel-performansi")).toContainText("Ayşe Yılmaz");

    const oranlar = page.getByTestId("rapor-oran-ozeti");
    await expect(oranlar).toContainText("Teslim Oranı%25Teslim / (Sevk + Teslim)");
    await expect(oranlar).toContainText("Kargo İade Oranı%20");
    await expect(oranlar).toContainText("Şubede Bekleme%60Şubede / Kargolanan");

    expect(recorded.reportQueries[0]?.get("start_date")).toBe(localDate(29));
    expect(recorded.reportQueries[0]?.get("end_date")).toBe(localDate(0));
    expect(recorded.reportQueries[0]?.get("cargo_provider")).toBe("tumu");

    await page.getByRole("button", { name: "Son 7 gün" }).click();
    await expect.poll(() => recorded.reportQueries.at(-1)?.get("start_date")).toBe(localDate(6));

    const filtreler = page.getByTestId("rapor-filtreler");
    await filtreler.getByLabel("Kargo firması").selectOption("ptt");
    await expect.poll(() => recorded.reportQueries.at(-1)?.get("cargo_provider")).toBe("ptt");
    await expect(siparis).toContainText("Toplam Sipariş3");
    await expect(siparis).toContainText("%33.3 iptal oranı");

    await expect(filtreler.getByLabel("Personel").locator("option")).toHaveText(["Tüm personel", "Ayşe Yılmaz", "Can Kaya"]);
    await filtreler.getByLabel("Personel").selectOption("usr_c");
    await expect.poll(() => recorded.reportQueries.at(-1)?.get("personnel_public_id")).toBe("usr_c");

    await filtreler.getByLabel("Başlangıç").fill("2026-09-01");
    await expect.poll(() => recorded.reportQueries.at(-1)?.get("start_date")).toBe("2026-09-01");
    await expect(page.getByRole("button", { name: "Son 7 gün" })).not.toHaveClass(/aktif/);
  } finally {
    await closeWebApp(app.server);
  }
});

for (const role of ["admin", "calisan"] as const) {
  test(`${role} Instagram yayınla queues the legacy publish form through the backend`, async ({ page }) => {
    const app = await startWebApp();
    const recorded = await setup(page, role);
    try {
      await login(page, app.url);
      if (role === "calisan") await expect(page.getByRole("link", { name: "İş Analizi" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Yayın Oluştur" })).toHaveCount(0);
      await page.goto(`${app.url}/instagram/yayinla`);
      const sayfa = page.getByTestId("instagram-yayinla-page");
      await expect(sayfa).toContainText("Instagram Gönderi Yayınla");
      await expect(sayfa).toContainText("Foto ve açıklama ile Instagram hesabınıza doğrudan gönderi yayınlayın");
      await expect(sayfa).toContainText("Teknik Gereksinimler (Instagram Graph API)");
      await expect(sayfa).toContainText("Gerekli izin: instagram_business_content_publish");
      const buton = page.getByRole("button", { name: "Instagram'a Yayınla" });
      await expect(buton).toBeDisabled();

      await page.getByLabel("Fotoğraf URL'si").fill("https://cdn.example.com/kulucka.jpg");
      await page.getByLabel("Başlık (Caption)").fill("Yeni kuluçka makinesi");
      await expect(sayfa).toContainText("21 / 2200 karakter");
      await expect(page.getByTestId("instagram-preview")).toContainText("garantikulucka Yeni kuluçka makinesi");
      await expect(page.getByTestId("instagram-preview").locator("img")).toHaveAttribute("src", "https://cdn.example.com/kulucka.jpg");
      await buton.click();

      await expect.poll(() => recorded.publishBodies.length).toBe(1);
      expect(recorded.publishBodies[0]).toMatchObject({
        image_url: "https://cdn.example.com/kulucka.jpg",
        caption: "Yeni kuluçka makinesi",
        idempotency_key: expect.stringMatching(/^instagram_yayinla_/),
      });
      await expect(page.getByTestId("instagram-publish-result")).toContainText("Media ID: 17895695668004550");
      await expect(sayfa).toContainText("Instagram gönderisi yayınlandı!");
      await expect(page.getByTestId("instagram-publish-result").getByRole("link", { name: /Instagram'da Gör/ })).toHaveAttribute(
        "href",
        "https://www.instagram.com/p/17895695668004550",
      );
      await expect(page.getByLabel("Fotoğraf URL'si")).toHaveValue("");

      if (role === "admin") {
        await page.getByTestId("instagram-file-input").setInputFiles({
          name: "urun.jpg",
          mimeType: "image/jpeg",
          buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
        });
        await expect(sayfa).toContainText("urun.jpg");
        expect(recorded.uploadBodies[0]).toMatchObject({ original_name: "urun.jpg", mime_type: "image/jpeg", byte_size: 10 });
        expect(String(recorded.uploadBodies[0]?.checksum)).toHaveLength(44);
        await expect.poll(() => recorded.garagePuts).toBe(1);
        await buton.click();
        await expect.poll(() => recorded.publishBodies.length).toBe(2);
        expect(recorded.publishBodies[1]).toMatchObject({ file_public_id: "fil_photo", caption: "" });
        expect(recorded.publishBodies[1]).not.toHaveProperty("image_url");
      }
    } finally {
      await closeWebApp(app.server);
    }
  });

  test(`${role} Instagram analitik loads account insights for the selected days`, async ({ page }) => {
    const app = await startWebApp();
    const recorded = await setup(page, role);
    try {
      await login(page, app.url);
      await page.goto(`${app.url}/instagram/analitik`);
      const sayfa = page.getByTestId("instagram-analitik-page");
      await expect(sayfa).toContainText("Instagram Analitik");
      await expect(sayfa).toContainText("Hesap performans metrikleri");
      const ozet = page.getByTestId("instagram-ozet-kartlari");
      await expect(ozet).toContainText("Takipçi");
      await expect(ozet).toContainText(/15[.,]230/);
      await expect(ozet).toContainText("Toplam takipçi");
      await expect(ozet).toContainText("Erişim100");
      await expect(ozet).toContainText("Gösterim300");
      await expect(ozet).toContainText("Profil Görüntüleme12");
      await expect(ozet).toContainText("Son 7 gün");
      await expect(page.getByTestId("instagram-gunluk-performans").locator(".ig-gunluk-satir")).toHaveCount(2);
      await expect(page.getByTestId("instagram-tum-metrikler")).toContainText("profile views");
      await expect(page.getByTestId("instagram-tum-metrikler")).toContainText("Toplam gösterim");
      expect(recorded.insightDays.length).toBeGreaterThan(0);
      expect(recorded.insightDays.every((days) => days === "7")).toBe(true);

      await page.getByLabel("Gün aralığı").selectOption("14");
      await expect.poll(() => recorded.insightDays.at(-1)).toBe("14");
      await expect(ozet).toContainText("Erişim400");
      await expect(ozet).toContainText("Son 14 gün");
      await expect(page.getByTestId("instagram-gunluk-performans").locator(".ig-gunluk-satir")).toHaveCount(3);

      const beforeRefresh = recorded.insightDays.length;
      await page.getByRole("button", { name: "Yenile" }).click();
      await expect.poll(() => recorded.insightDays.length).toBe(beforeRefresh + 1);
    } finally {
      await closeWebApp(app.server);
    }
  });
}

test("kargo operatörü cannot reach İş Analizi or Instagram pages", async ({ page }) => {
  const app = await startWebApp();
  const recorded = await setup(page, "kargo_operatoru");
  try {
    await login(page, app.url);
    await expect(page.getByRole("link", { name: "İş Analizi" })).toHaveCount(0);
    for (const path of ["/raporlar", "/instagram/yayinla", "/instagram/analitik"]) {
      await page.goto(`${app.url}${path}`);
      await expect(page.getByRole("link", { name: /mesajlar/i })).toHaveCount(1);
      await expect(page.getByTestId("raporlar-page")).toHaveCount(0);
      await expect(page.getByTestId("instagram-yayinla-page")).toHaveCount(0);
      await expect(page.getByTestId("instagram-analitik-page")).toHaveCount(0);
    }
    expect(recorded.reportQueries).toHaveLength(0);
    expect(recorded.insightDays).toHaveLength(0);
  } finally {
    await closeWebApp(app.server);
  }
});
