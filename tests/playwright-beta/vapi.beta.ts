import { expect, test, type Page } from "@playwright/test";
import { expectResponsiveLayout, login, mockBackend, mockUser, pathOf, viewports, type ExtraRoute } from "./helpers";

test.use({ serviceWorkers: "block" });

const now = "2026-10-07T09:00:00.000Z";

const cargo = [
  { id: "shp_1", shipment_public_id: "shp_1", takip_no: "KP111", alici_telefon: "05551112233", alici_ad: "Zeynep Kaya", kargo_firmasi: "ptt", son_hareket: "Şubede bekliyor", son_hareket_tarihi: now, durum: "subede", kuyrukta: false, kuyruk_durumu: null, deneme_sayisi: 0, son_24s_arandi: false },
  { id: "shp_2", shipment_public_id: "shp_2", takip_no: "SR222", alici_telefon: "05554445566", alici_ad: "Mehmet Demir", kargo_firmasi: "surat", son_hareket: "Teslim alınmadı", son_hareket_tarihi: now, durum: "subede", kuyrukta: true, kuyruk_durumu: "bekliyor", deneme_sayisi: 1, son_24s_arandi: true },
];

function queueItem(overrides: Record<string, unknown> = {}) {
  return { id: "vcq_1", public_id: "vcq_1", kargo_id: "shp_2", musteri_telefon: "05554445566", musteri_adi: "Mehmet Demir", kargo_firmasi: "surat", takip_no: "SR222", son_hareket: "Teslim alınmadı", durum: "bekliyor", oncelik: 0, deneme_sayisi: 1, max_deneme: 3, son_arama_zamani: now, olusturma_tarihi: now, ...overrides };
}

const call = {
  id: "vcl_1", public_id: "vcl_1", vapi_call_id: "call_abc", kargo_id: "shp_2", musteri_telefon: "05554445566", musteri_adi: "Mehmet Demir", kargo_firmasi: "surat", takip_no: "SR222", son_hareket: "Teslim alınmadı",
  durum: "tamamlandi", arama_ozeti: null, transkript: null, sure_sn: 95, maliyet: "0.123456", bitis_nedeni: "customer-ended-call", hata_mesaji: null, test_aramasi: false, request_id: "req_1", job_id: "job_1", queued: true, baslangic: now, bitis: now,
};

function routes() {
  let deleted = false;
  const route: ExtraRoute = ({ method, path, url }) => {
    if (path === "/api/vapi/statistics") {
      return { status: 200, body: { statistics: { toplam_arama: 12, cevaplanan: 9, cevapsiz: 2, hatali: 1, toplam_sure_sn: 900, ortalama_sure_sn: 75, toplam_maliyet: "1.2", kuyruk_bekleyen: deleted ? 0 : 1, basari_orani: 75 } } };
    }
    if (path === "/api/vapi/cargo-not-received") {
      const provider = url.searchParams.get("provider");
      const data = provider === "ptt" ? cargo.filter((row) => row.kargo_firmasi === "ptt") : cargo;
      return { status: 200, body: { data, total: data.length, page: 1, page_size: 25 } };
    }
    if (path === "/api/vapi/queue" && method === "POST") return { status: 201, body: { eklenen: 1, atlanan: 0 } };
    if (path === "/api/vapi/queue") {
      const data = deleted ? [] : [queueItem()];
      return { status: 200, body: { data, total: data.length, page: 1, page_size: 25 } };
    }
    if (path === "/api/vapi/queue/vcq_1" && method === "DELETE") {
      deleted = true;
      return { status: 200, body: { deleted: true } };
    }
    if (path === "/api/vapi/calls/bulk") return { status: 202, body: { aranan: 1, hatali: 0, toplam_kuyruk: 1, sonuclar: [] } };
    if (path === "/api/vapi/calls" && method === "POST") return { status: 202, body: { call, replayed: false, live_gate: "providers.vapi.live_mode", live_call_permitted: false } };
    if (path === "/api/vapi/calls") {
      const q = url.searchParams.get("q");
      const data = q && !"Mehmet Demir".toLowerCase().includes(q.toLowerCase()) ? [] : [call];
      return { status: 200, body: { data, total: data.length, page: 1, page_size: 25 } };
    }
    if (path === "/api/vapi/calls/vcl_1") {
      return {
        status: 200,
        body: {
          call: { ...call, arama_ozeti: "Müşteri yarın şubeden alacağını söyledi.", transkript: [{ role: "assistant", text: "Merhaba, kargonuz şubede bekliyor." }, { role: "user", text: "Yarın alacağım." }] },
          backfill_queued: false,
        },
      };
    }
    if (path === "/api/webphone/test-call") return { status: 202, body: { operation: "call.create", request_id: "req_test" } };
    return undefined;
  };
  return route;
}

async function signIn(page: Page, role: string, viewport: { width: number; height: number } = viewports.desktop) {
  await page.setViewportSize(viewport);
  const state = await mockBackend(page, mockUser(role), { extra: routes() });
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("topbar")).toBeVisible();
  return state;
}

test("vapi: stats, cargo-not-received selection and queueing", async ({ page }) => {
  const state = await signIn(page, "admin");
  await page.getByTestId("desktop-more-trigger").click();
  await page.getByTestId("more-vapi").click();
  await expect.poll(() => pathOf(page)).toBe("/sesli-asistan/vapi");
  await expect(page.getByTestId("vapi-stats")).toContainText("%75");
  await expect(page.getByTestId("voice-link-vapi")).toHaveAttribute("aria-current", "page");

  const table = page.getByTestId("vapi-cargo-table");
  await expect(table).toContainText("Zeynep Kaya");
  await expect(table).toContainText("Aranmadı");
  await page.getByTestId("vapi-cargo-provider").selectOption("ptt");
  await expect(table).not.toContainText("Mehmet Demir");
  await expect(page.getByTestId("vapi-cargo-count")).toHaveText("1 kargo almayan müşteri");
  await table.getByTestId("vapi-cargo-select").first().check();
  await page.getByTestId("vapi-add-queue").click();
  await expect(page.getByTestId("vapi-feedback")).toContainText("1 kişi arama kuyruğuna eklendi");
  const posted = state.bodies.find((entry) => entry.method === "POST" && entry.path === "/api/vapi/queue")?.body as { items: unknown[]; idempotency_key: string };
  expect(posted.items).toEqual([{ shipment_public_id: "shp_1", customer_phone: "05551112233", customer_name: "Zeynep Kaya", cargo_provider: "ptt", tracking_number: "KP111", last_event_text: "Şubede bekliyor" }]);
  expect(posted.idempotency_key).toMatch(/^vapi_queue/);
});

test("vapi: queue call, bulk call and remove", async ({ page }) => {
  const state = await signIn(page, "owner");
  await page.goto("/sesli-asistan/vapi");
  await page.getByTestId("vapi-tab-queue").click();
  const table = page.getByTestId("vapi-queue-table");
  await expect(table).toContainText("1/3");
  await table.getByTestId("vapi-call-now").click();
  await expect(page.getByTestId("vapi-feedback")).toContainText("Mehmet Demir aranıyor...");
  expect(state.bodies.find((entry) => entry.method === "POST" && entry.path === "/api/vapi/calls")?.body).toMatchObject({ queue_public_id: "vcq_1", customer_phone: "05554445566", idempotency_key: "vapi_call_vcq_1_2" });
  await page.getByTestId("vapi-bulk-call").click();
  await expect(page.getByTestId("vapi-feedback")).toContainText("1 kişi arandı");
  await table.getByTestId("vapi-queue-delete").click();
  await expect(page.getByTestId("vapi-feedback")).toContainText("Kuyruktan silindi");
  await expect(page.getByTestId("vapi-queue-empty")).toBeVisible();
  await expect(page.getByTestId("vapi-stats")).toContainText("0");
});

test("vapi: call history detail with AI summary and transcript, English", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("garanti-beta-lang", "en"));
  const state = await signIn(page, "admin");
  await page.goto("/sesli-asistan/vapi");
  await page.getByTestId("vapi-tab-history").click();
  const table = page.getByTestId("vapi-calls-table");
  await expect(table).toContainText("1:35");
  await page.getByTestId("vapi-calls-search").fill("ahmet");
  await expect(page.getByTestId("vapi-calls-empty")).toBeVisible();
  await page.getByTestId("vapi-calls-search").fill("");
  await page.getByTestId("vapi-calls-status").selectOption("tamamlandi");
  await expect.poll(() => state.requests.some((entry) => entry.path === "/api/vapi/calls" && entry.search.includes("status=tamamlandi"))).toBe(true);
  await table.getByTestId("vapi-call-open").click();
  const sheet = page.getByTestId("vapi-call-detail");
  await expect(sheet).toContainText("call_abc");
  await expect(sheet.getByTestId("vapi-detail-duration")).toHaveText("1:35 · $0.1235");
  await expect(sheet.getByTestId("vapi-detail-summary")).toContainText("Müşteri yarın şubeden alacağını söyledi.");
  await expect(sheet.getByTestId("vapi-detail-transcript")).toContainText("Merhaba, kargonuz şubede bekliyor.");
  await expect(sheet.getByTestId("vapi-detail-transcript")).toContainText("Customer");
});

test("vapi: dry-run test call", async ({ page }) => {
  const state = await signIn(page, "admin");
  await page.goto("/sesli-asistan/vapi");
  await page.getByTestId("vapi-tab-test").click();
  await page.getByTestId("vapi-test-call").click();
  await expect(page.getByTestId("vapi-feedback")).toBeVisible();
  await page.getByTestId("vapi-test-phone").fill("0555 999 88 77");
  await page.getByTestId("vapi-test-call").click();
  await expect(page.getByTestId("vapi-test-last")).toContainText("call.create req_test");
  expect(state.bodies.find((entry) => entry.path === "/api/webphone/test-call")?.body).toMatchObject({ customer_name: "Test Müşteri", customer_phone: "0555 999 88 77", idempotency_key: "vapi_test_0555_999_88_77" });
});

test("vapi: mobile cards and manager-only access", async ({ page }) => {
  await signIn(page, "admin", viewports.phone390);
  await page.goto("/sesli-asistan/vapi");
  await expect(page.getByTestId("vapi-cargo-cards")).toContainText("Zeynep Kaya");
  await expectResponsiveLayout(page, { checkTouchTargets: true });
  await page.getByTestId("vapi-tab-queue").click();
  await expect(page.getByTestId("vapi-queue-cards")).toContainText("Mehmet Demir");
  await expectResponsiveLayout(page, { checkTouchTargets: true });
});

test("calisan cannot open vapi", async ({ page }) => {
  await signIn(page, "calisan");
  await page.goto("/sesli-asistan/vapi");
  await expect.poll(() => pathOf(page)).not.toBe("/sesli-asistan/vapi");
});
