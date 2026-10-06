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



type QueueRow = {
  id: string;
  public_id: string;
  kargo_id: string | null;
  musteri_telefon: string;
  musteri_adi: string | null;
  kargo_firmasi: string | null;
  takip_no: string | null;
  son_hareket: string | null;
  durum: string;
  oncelik: number;
  deneme_sayisi: number;
  max_deneme: number;
  son_arama_zamani: string | null;
  olusturma_tarihi: string;
};

const cargoRows = [
  {
    id: "shp_ptt_1",
    shipment_public_id: "shp_ptt_1",
    takip_no: "PTT123",
    alici_telefon: "05551112233",
    alici_ad: "Ahmet Yılmaz",
    kargo_firmasi: "ptt",
    son_hareket: "Şubede bekliyor",
    son_hareket_tarihi: "2026-10-05T09:00:00.000Z",
    durum: "in_transit",
    kuyrukta: false,
    kuyruk_durumu: null,
    deneme_sayisi: 0,
    son_24s_arandi: false,
  },
  {
    id: "shp_surat_1",
    shipment_public_id: "shp_surat_1",
    takip_no: "SRT9",
    alici_telefon: "05559998877",
    alici_ad: "Ayşe Kaya",
    kargo_firmasi: "surat",
    son_hareket: "Adreste bulunamadı",
    son_hareket_tarihi: "2026-10-05T10:00:00.000Z",
    durum: "in_transit",
    kuyrukta: false,
    kuyruk_durumu: null,
    deneme_sayisi: 0,
    son_24s_arandi: true,
  },
];

const callRow = {
  id: "vcl_1",
  public_id: "vcl_1",
  vapi_call_id: "call_abc",
  kargo_id: "shp_ptt_1",
  musteri_telefon: "05551112233",
  musteri_adi: "Ahmet Yılmaz",
  kargo_firmasi: "ptt",
  takip_no: "PTT123",
  son_hareket: "Şubede bekliyor",
  durum: "tamamlandi",
  arama_ozeti: "Müşteri yarın şubeden alacak",
  transkript: [
    { role: "assistant", message: "Merhaba Ahmet Bey" },
    { role: "user", message: "Yarın alacağım" },
  ],
  sure_sn: 95,
  maliyet: "0.0812",
  bitis_nedeni: "assistant-ended-call",
  hata_mesaji: null,
  test_aramasi: false,
  request_id: "req_vapi_call_x",
  job_id: "job_vapi_call_x",
  queued: true,
  baslangic: "2026-10-05T11:00:00.000Z",
  bitis: "2026-10-05T11:01:35.000Z",
};

test("admin Sesli Asistan legacy parity uses backend VAPI/NetGSM voice API", async ({ page }) => {
  const app = await startWebApp();
  const user = loginUser({ role: "admin", email: "admin@example.com" });
  const queue: QueueRow[] = [];
  const posts: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
  let teyit = { aktif: false, ilk_arama_dakika: 5, max_deneme: 3, deneme_arasi_dakika: 10 };

  await installRealtimeShim(page);
  await page.route(`${backendBaseUrl}/**`, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const payload = () => JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
    if (url.pathname === "/auth/login") return json(loginBody(user));
    if (url.pathname === "/auth/me" || url.pathname === "/auth/presence") return json(user);
    if (url.pathname === "/api/conversations") return json({ data: [] });
    if (url.pathname === "/api/conversations/summary") {
      return json({ total_count: 0, unread_count: 0, pool_count: 0, human_agent_count: 0, channel_counts: {}, status_counts: { open: 0 } });
    }
    if ((url.pathname.startsWith("/api/vapi/") || url.pathname.startsWith("/api/netgsm/") || url.pathname === "/api/webphone/test-call") && method !== "GET") {
      posts.push({ method, path: url.pathname, body: method === "DELETE" ? {} : payload() });
    }
    // ─── NetGSM (AramaPage) ───
    if (url.pathname === "/api/netgsm/status") return json({ configured: true, live_gate: "providers.netgsm.live_mode" });
    if (url.pathname === "/api/netgsm/teyit-settings" && method === "GET") return json({ settings: teyit });
    if (url.pathname === "/api/netgsm/teyit-settings" && method === "PUT") {
      teyit = payload() as typeof teyit;
      return json({ settings: teyit });
    }
    if (url.pathname === "/api/netgsm/cdr/sync") return json({ request_id: "req_netgsm_call_report_x", job_id: "job_x", queued: true }, 202);
    if (url.pathname === "/api/netgsm/cdr") {
      const yon = url.searchParams.get("yon");
      const kayitlar =
        yon === "gelen"
          ? [{ id: "u1", tarih: "06.10.2026 10:00:00", arayanNumara: "905551112233", arayanAdi: "Ahmet", arananNumara: "908500000000", yontem: "Sesli", sure: "00:01:15", sureSaniye: 75, yon: "Gelen Arama", yonKod: 1, sesKaydi: "https://rec.example.test/u1.mp3", hat: null }]
          : [{ id: "u2", tarih: "06.10.2026 11:00:00", arayanNumara: "908500000000", arayanAdi: "", arananNumara: "905550000000", yontem: "Sesli", sure: "00:00:00", sureSaniye: 0, yon: "Giden Cevapsız", yonKod: 3, sesKaydi: null, hat: null }];
      return json({ success: true, data: { kayitlar, toplamKayit: 1, toplamSure: yon === "gelen" ? "00:01:15" : "00:00:00", sayfa: 1, sayfaBoyutu: 10 }, synced_at: "2026-10-06T08:00:00.000Z" });
    }
    if (url.pathname === "/api/netgsm/cdr/istatistik") {
      return json({ success: true, data: { gelenArama: 2, gidenArama: 1, gelenCevapli: 1, gelenCevapsiz: 1, toplamSure: "00:01:15", toplamGorisme: 3, ortalamaSure: "00:00:25", cevaplananOran: 50 }, synced_at: null });
    }
    // ─── VAPI (VapiAramalarPage) ───
    if (url.pathname === "/api/vapi/statistics") {
      return json({ statistics: { toplam_arama: 12, cevaplanan: 9, cevapsiz: 2, hatali: 1, toplam_sure_sn: 900, ortalama_sure_sn: 100, toplam_maliyet: "0.9000", kuyruk_bekleyen: queue.filter((row) => row.durum === "bekliyor").length, basari_orani: 75 } });
    }
    if (url.pathname === "/api/vapi/cargo-not-received") {
      const provider = url.searchParams.get("provider");
      const data = cargoRows.filter((row) => provider === "tumu" || row.kargo_firmasi === provider);
      return json({ data, total: data.length, page: 1, page_size: 25 });
    }
    if (url.pathname === "/api/vapi/queue" && method === "POST") {
      const body = payload() as { items: Array<{ shipment_public_id: string; customer_phone: string; customer_name: string; cargo_provider: string; tracking_number: string; last_event_text: string }> };
      for (const item of body.items) {
        queue.push({
          id: `vcq_${item.shipment_public_id}`,
          public_id: `vcq_${item.shipment_public_id}`,
          kargo_id: item.shipment_public_id,
          musteri_telefon: item.customer_phone,
          musteri_adi: item.customer_name,
          kargo_firmasi: item.cargo_provider,
          takip_no: item.tracking_number,
          son_hareket: item.last_event_text,
          durum: "bekliyor",
          oncelik: 0,
          deneme_sayisi: 0,
          max_deneme: 3,
          son_arama_zamani: null,
          olusturma_tarihi: "2026-10-06T08:00:00.000Z",
        });
      }
      return json({ eklenen: body.items.length, atlanan: 0, replayed: false }, 201);
    }
    if (url.pathname === "/api/vapi/queue" && method === "GET") {
      const status = url.searchParams.get("status");
      const data = queue.filter((row) => status === "tumu" || row.durum === status);
      return json({ data, total: data.length, page: 1, page_size: 25 });
    }
    const deleteMatch = /^\/api\/vapi\/queue\/([^/]+)$/.exec(url.pathname);
    if (deleteMatch && method === "DELETE") {
      const index = queue.findIndex((row) => row.public_id === deleteMatch[1]);
      if (index >= 0) queue.splice(index, 1);
      return json({ deleted: true });
    }
    if (url.pathname === "/api/vapi/calls" && method === "POST") {
      const body = payload() as { queue_public_id?: string };
      const row = queue.find((candidate) => candidate.public_id === body.queue_public_id);
      if (row) {
        row.durum = "araniyor";
        row.deneme_sayisi += 1;
        row.son_arama_zamani = "2026-10-06T08:05:00.000Z";
      }
      return json({ call: { ...callRow, durum: "basladi" }, call_id: "vcl_new", job_id: "job_vapi_call_new", replayed: false, live_gate: "providers.vapi.live_mode", live_call_permitted: false }, 202);
    }
    if (url.pathname === "/api/vapi/calls/bulk") {
      const waiting = queue.filter((row) => row.durum === "bekliyor");
      for (const row of waiting) row.durum = "araniyor";
      return json({ aranan: waiting.length, hatali: 0, toplam_kuyruk: waiting.length, sonuclar: [] }, 202);
    }
    if (url.pathname === "/api/vapi/calls" && method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      const data = q && !callRow.musteri_adi.includes(q) ? [] : [callRow];
      return json({ data, total: data.length, page: 1, page_size: 20 });
    }
    if (url.pathname === "/api/vapi/calls/vcl_1") return json({ call: callRow, backfill_queued: false, backfill_job_id: null });
    if (url.pathname === "/api/webphone/test-call") {
      return json({ public_id: "pat_test", provider_key: "vapi", account_public_id: null, request_id: "vapitest_vapi_test_05051234567", operation: "call.test", direction: "outbound", status: "success", status_code: 202, duration_ms: 0, retry_decision: "none", next_retry_at: null, idempotency_key: "vapi_test_05051234567", request_metadata: {}, response_metadata: { mode: "dry_run" }, error_code: null, error_message: null, started_at: "2026-10-06T08:00:00.000Z", created_at: "2026-10-06T08:00:00.000Z" }, 202);
    }
    const fallback = fallbackResponse(url.pathname);
    if (fallback !== undefined) return json(fallback);
    return route.fulfill({ status: 404, body: "not found" });
  });

  try {
    await page.goto(`${app.url}/giris`);
    await page.getByRole("button", { name: /giriş yap/i }).click();
    await expect(page.getByText("admin@example.com")).toBeVisible();

    // ─── /sesli-asistan → AramaPage (NetgsmAyarlar + GorusmeDetayPage) ───
    await page.goto(`${app.url}/sesli-asistan`);
    const calls = page.getByTestId("calls-flow");
    await expect(calls).toContainText("Arama");
    await expect(calls).toContainText("NetGSM otomatik teyit araması ve görüşme kayıtları");
    const teyitCard = page.getByTestId("netgsm-teyit-settings");
    await expect(teyitCard).toContainText("Otomatik Teyit Araması");
    await expect(teyitCard).toContainText("Yeni siparişler için otomatik IVR araması");
    await page.getByRole("button", { name: "Otomatik arama aktif" }).click();
    await expect(teyitCard).toContainText("5 dakika");
    await teyitCard.getByRole("spinbutton").nth(1).fill("4");
    await teyitCard.getByRole("button", { name: "Kaydet" }).click();
    await expect(teyitCard).toContainText("Ayarlar kaydedildi.");
    expect(teyit).toEqual({ aktif: true, ilk_arama_dakika: 5, max_deneme: 4, deneme_arasi_dakika: 10 });

    const gorusme = page.getByTestId("netgsm-gorusme");
    await expect(gorusme).toContainText("Görüşme Kayıtları");
    await expect(gorusme).toContainText("Net GSM sabit telefon arama kayıtları");
    const cdrTable = page.getByTestId("netgsm-cdr-table");
    await expect(cdrTable.locator("th")).toHaveText(["", "Yön", "Tarih", "Arayan Numara", "Aranan Numara", "Durum", "Süre", "Ses Kaydı"]);
    await expect(cdrTable).toContainText("905551112233");
    await expect(cdrTable).toContainText("(Ahmet)");
    await expect(cdrTable).toContainText("Gelen Arama");
    await expect(gorusme).toContainText("Toplam Süre: 00:01:15");
    await expect(cdrTable.getByRole("button", { name: "Oynat" })).toBeVisible();
    await expect(cdrTable.getByRole("button", { name: "10sn İleri" })).toBeDisabled();
    await gorusme.getByRole("button", { name: "Giden Arama" }).click();
    await expect(cdrTable).toContainText("Giden Cevapsız");
    await expect(cdrTable).toContainText("Kayıt Yok");
    await gorusme.getByRole("button", { name: "İstatistik" }).click();
    const cdrStats = page.getByTestId("netgsm-cdr-stats");
    await expect(cdrStats).toContainText("Gelen Aramalar");
    await expect(cdrStats).toContainText("Cevaplı: 1 | Cevapsız: 1");
    await expect(cdrStats).toContainText("%50");
    await expect(cdrStats).toContainText("Ortalama: 00:00:25");
    await gorusme.getByRole("button", { name: "Filtrele" }).first().click();
    await gorusme.getByLabel("Başlangıç Tarihi").fill("2026-10-01");
    await gorusme.locator(".arama-filter-submit").getByRole("button", { name: "Filtrele" }).click();
    await expect.poll(() => posts.filter((post) => post.path === "/api/netgsm/cdr/sync").at(-1)?.body).toMatchObject({ baslangic_tarih: "2026-10-01" });

    // ─── /sesli-asistan/vapi → VapiAramalarPage ───
    await page.goto(`${app.url}/sesli-asistan/vapi`);
    const vapi = page.getByTestId("vapi-flow");
    await expect(vapi).toContainText("VAPI AI Aramalar");
    await expect(vapi).toContainText("Kargo almayan müşterilere otomatik AI sesli arama");
    const stats = page.getByTestId("vapi-stats");
    await expect(stats).toContainText("Toplam Arama");
    await expect(stats).toContainText("12");
    await expect(stats).toContainText("%75");
    await expect(stats).toContainText("Kuyrukta");
    await expect(page.getByRole("tab")).toHaveText(["Kargo Almayan", "Arama Kuyruğu", "Arama Geçmişi", "Test Araması"]);

    const cargo = page.getByTestId("vapi-cargo-table");
    await expect(cargo.locator("th")).toHaveText(["", "Müşteri", "Kargo", "Son Hareket", "Durum"]);
    await expect(cargo).toContainText("Ahmet Yılmaz");
    await expect(cargo).toContainText("Aranmadı");
    await expect(cargo).toContainText("Son 24s arandı");
    await expect(vapi).toContainText("2 kargo almayan müşteri");
    await vapi.getByLabel("Kargo firması").selectOption("ptt");
    await expect(vapi).toContainText("1 kargo almayan müşteri");
    await cargo.getByLabel("Ahmet Yılmaz seç").check();
    await vapi.getByRole("button", { name: "1 Kişiyi Kuyruğa Ekle" }).click();
    await expect(page.getByTestId("vapi-toast")).toContainText("1 kişi arama kuyruğuna eklendi");
    const queueAdd = posts.find((post) => post.path === "/api/vapi/queue");
    expect(queueAdd?.body).toMatchObject({
      items: [{ shipment_public_id: "shp_ptt_1", customer_phone: "05551112233", customer_name: "Ahmet Yılmaz", cargo_provider: "ptt", tracking_number: "PTT123", last_event_text: "Şubede bekliyor" }],
      idempotency_key: expect.stringContaining("vapi_queue_"),
    });

    await page.getByTestId("vapi-tab-kuyruk").click();
    const queueTable = page.getByTestId("vapi-queue-table");
    await expect(queueTable.locator("th")).toHaveText(["Müşteri", "Kargo", "Son Hareket", "Deneme", "Durum", "İşlem"]);
    await expect(queueTable).toContainText("0/3");
    await expect(queueTable).toContainText("Bekliyor");
    await expect(vapi.getByRole("button", { name: "Toplu Arama Başlat (1 kişi)" })).toBeVisible();
    await queueTable.getByRole("button", { name: "Şimdi Ara" }).click();
    await expect(page.getByTestId("vapi-toast")).toContainText("Ahmet Yılmaz aranıyor...");
    await expect(queueTable).toContainText("Aranıyor");
    await expect(queueTable).toContainText("1/3");
    expect(posts.find((post) => post.path === "/api/vapi/calls")?.body).toMatchObject({
      queue_public_id: "vcq_shp_ptt_1",
      customer_phone: "05551112233",
      idempotency_key: "vapi_call_vcq_shp_ptt_1_1",
    });
    queue.push({ ...queue[0]!, id: "vcq_extra", public_id: "vcq_extra", musteri_adi: "Mehmet Demir", durum: "bekliyor", deneme_sayisi: 0 });
    await vapi.getByRole("button", { name: "Yenile" }).click();
    await vapi.getByRole("button", { name: "Toplu Arama Başlat (1 kişi)" }).click();
    await expect(page.getByTestId("vapi-toast")).toContainText("1 kişi arandı");
    expect(posts.find((post) => post.path === "/api/vapi/calls/bulk")?.body).toMatchObject({ idempotency_key: expect.stringContaining("vapi_bulk_") });
    await queueTable.getByRole("button", { name: "Kuyruktan Sil" }).first().click();
    await expect(page.getByTestId("vapi-toast")).toContainText("Kuyruktan silindi");
    expect(posts.some((post) => post.method === "DELETE" && post.path === "/api/vapi/queue/vcq_shp_ptt_1")).toBe(true);

    await page.getByTestId("vapi-tab-gecmis").click();
    const callsTable = page.getByTestId("vapi-calls-table");
    await expect(callsTable.locator("th")).toHaveText(["Tarih", "Müşteri", "Kargo", "Süre", "Durum", "Detay"]);
    await expect(callsTable).toContainText("1:35");
    await expect(callsTable).toContainText("Tamamlandı");
    await expect(vapi).toContainText("1 arama kaydı");
    await callsTable.getByText("Ahmet Yılmaz").click();
    const modal = page.getByTestId("vapi-call-detail-modal");
    await expect(modal).toContainText("Arama Detayı");
    await expect(modal).toContainText("call_abc");
    await expect(modal).toContainText("PTT Kargo");
    await expect(modal).toContainText("$0.0812");
    await expect(modal).toContainText("Arama Anındaki Kargo Durumu");
    await expect(modal).toContainText("AI Arama Özeti");
    await expect(modal).toContainText("Müşteri yarın şubeden alacak");
    await expect(modal).toContainText("Konuşma Transkripti");
    await expect(modal).toContainText("Merhaba Ahmet Bey");
    await modal.getByRole("button", { name: "Kapat" }).click();
    await expect(modal).toHaveCount(0);
    await vapi.getByPlaceholder("İsim, telefon, takip no...").fill("Zeynep");
    await expect(callsTable).toContainText("Henüz arama kaydı yok");

    await page.getByTestId("vapi-tab-test").click();
    const testPanel = page.getByTestId("vapi-test-call-detail");
    await expect(testPanel).toContainText("Hızlı Test Araması");
    await expect(testPanel).toContainText("Müşteri Adı (Test İçin)");
    await testPanel.getByRole("button", { name: "Ara", exact: true }).click();
    await expect(page.getByTestId("vapi-toast")).toContainText("Lütfen test telefon numarasını girin");
    await testPanel.getByPlaceholder("Örn: 05051234567").fill("05051234567");
    await testPanel.getByRole("button", { name: "Ara", exact: true }).click();
    await expect(page.getByTestId("vapi-toast")).toContainText("Test araması başlatıldı!");
    expect(posts.find((post) => post.path === "/api/webphone/test-call")?.body).toMatchObject({
      customer_name: "Test Müşteri",
      customer_phone: "05051234567",
      cargo_provider: "PTT",
      tracking_number: "279172790012",
      last_event_text: "şubede bekliyor",
    });
  } finally {
    await closeWebApp(app.server);
  }
});

test("non-admin roles cannot reach Sesli Asistan routes (legacy App.jsx admin only)", async ({ page }) => {
  const app = await startWebApp();
  const user = loginUser({ role: "calisan", email: "calisan@example.com" });
  const voiceRequests: string[] = [];
  await installRealtimeShim(page);
  await page.route(`${backendBaseUrl}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname.startsWith("/api/vapi/") || url.pathname.startsWith("/api/netgsm/")) voiceRequests.push(url.pathname);
    if (url.pathname === "/auth/login") return json(loginBody(user));
    if (url.pathname === "/auth/me" || url.pathname === "/auth/presence") return json(user);
    if (url.pathname === "/api/conversations") return json({ data: [] });
    if (url.pathname === "/api/conversations/summary") {
      return json({ total_count: 0, unread_count: 0, pool_count: 0, human_agent_count: 0, channel_counts: {}, status_counts: { open: 0 } });
    }
    const fallback = fallbackResponse(url.pathname);
    if (fallback !== undefined) return json(fallback);
    return route.fulfill({ status: 404, body: "not found" });
  });
  try {
    await page.goto(`${app.url}/giris`);
    await page.getByRole("button", { name: /giriş yap/i }).click();
    await expect(page.getByText("calisan@example.com")).toBeVisible();
    await expect(page.getByRole("link", { name: "VAPI AI" })).toHaveCount(0);
    await page.goto(`${app.url}/sesli-asistan/vapi`);
    await expect(page.getByTestId("vapi-flow")).toHaveCount(0);
    expect(voiceRequests).toEqual([]);
  } finally {
    await closeWebApp(app.server);
  }
});

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
