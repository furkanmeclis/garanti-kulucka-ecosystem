import { expect, test, type Page } from "@playwright/test";
import { expectResponsiveLayout, login, mockBackend, mockUser, pathOf, viewports, type ExtraRoute } from "./helpers";

test.use({ serviceWorkers: "block" });

const now = "2026-10-07T09:00:00.000Z";

function item(overrides: Record<string, unknown> = {}) {
  return {
    public_id: "cpl_1", shipment_public_id: "shp_1", order_public_id: "ord_1", conversation_public_id: "cnv_1", vapi_call_public_id: null,
    channel: "whatsapp", phone: "05551234567", customer_name: "Ayşe Yılmaz", tracking_number: "KP123", cargo_provider: "ptt",
    last_event_text: "Şubede bekliyor - Kadıköy", step: "sms", status: "bekliyor", next_run_at: now, force_run: false, attempt_count: 1, max_attempts: 3,
    error_message: "Mesaj atlandı: konusma_yok", created_at: now, updated_at: now, ...overrides,
  };
}

const config = { aktif: false, baslangic_saati: "09:00", bitis_saati: "20:00", mesaj_gecikme_dk: 0, sms_gecikme_dk: 30, vapi_gecikme_dk: 60, max_deneme: 3, mesaj_sablonu: "Sayın {musteri_adi}, kargonuz ({takip_no}) {son_hareket}. Takip: {takip_link}" };

function routes() {
  const rows = [item(), item({ public_id: "cpl_2", customer_name: "Mehmet Demir", conversation_public_id: null, channel: null, step: "teslim", status: "teslim", error_message: null })];
  const route: ExtraRoute = ({ method, path, url, body }) => {
    if (path === "/api/cargo-pipeline" && method === "GET") {
      const status = url.searchParams.get("status");
      const data = status ? rows.filter((row) => row.status === status) : rows;
      return { status: 200, body: { data, total: data.length, page: 1, page_size: 20 } };
    }
    if (path === "/api/cargo-pipeline/config" && method === "GET") return { status: 200, body: { config } };
    if (path === "/api/cargo-pipeline/config" && method === "PUT") return { status: 200, body: { config: body } };
    if (path === "/api/cargo-pipeline/cpl_1/actions" && method === "POST") {
      const action = (body as { action: string }).action;
      return { status: 200, body: { item: item(action === "cancel" ? { status: "iptal" } : action === "skip" ? { step: "vapi" } : { force_run: true }) } };
    }
    if (path === "/api/cargo-pipeline/cpl_2" && method === "DELETE") return { status: 200, body: { deleted: true } };
    if (path === "/api/cargo-pipeline/test" && method === "POST") {
      const input = body as { type: string };
      if (input.type === "vapi") return { status: 422, body: { error: { code: "vapi_disabled", message: "VAPI devre dışı. Ayarlardan etkinleştirin." } } };
      return { status: 202, body: { type: input.type, queued: true, job_ids: ["job_1"], message: "x", live_gate: "providers.netgsm.live_mode" } };
    }
    return undefined;
  };
  return route;
}

async function open(page: Page, role = "admin", viewport: { width: number; height: number } = viewports.desktop) {
  await page.setViewportSize(viewport);
  const state = await mockBackend(page, mockUser(role), { extra: routes() });
  await page.goto("/giris");
  await login(page, state);
  return state;
}

test("kargo pipeline: managers filter, act on rows and delete from the More menu page", async ({ page }) => {
  const state = await open(page);
  await page.getByTestId("nav-group-trigger-operations").click();
  await page.getByTestId("nav-item-cargoPipeline").click();
  await expect.poll(() => pathOf(page)).toBe("/kargolar/pipeline");
  const table = page.getByTestId("pipeline-table");
  const row = table.getByRole("row").filter({ has: page.getByTestId("pipeline-row-cpl_1") });
  await expect(row).toContainText("Ayşe Yılmaz");
  await expect(row).toContainText("SMS");
  await expect(row).toContainText("Deneme: 1/3");
  await expect(row).toContainText("Mesaj atlandı: konusma_yok");
  await expect(page.getByTestId("pipeline-total")).toHaveText("Toplam: 2");
  await expect(table.getByRole("row").filter({ has: page.getByTestId("pipeline-row-cpl_2") }).getByTestId("pipeline-run_now")).toHaveCount(0);
  await expect(row.getByTestId("pipeline-open-conversation")).toHaveAttribute("href", "/mesajlar?konusma=cnv_1");

  await row.getByTestId("pipeline-run_now").click();
  await expect(page.getByTestId("pipeline-feedback")).toContainText("bir dakika içinde işlenecek");
  await row.getByTestId("pipeline-cancel").click();
  await expect(row).toContainText("İptal");
  await expect(row.getByTestId("pipeline-cancel")).toHaveCount(0);
  await expect.poll(() => state.bodies.filter((entry) => entry.path === "/api/cargo-pipeline/cpl_1/actions").map((entry) => (entry.body as { action: string }).action)).toEqual(["run_now", "cancel"]);

  page.once("dialog", (dialog) => void dialog.accept());
  await table.getByRole("row").filter({ has: page.getByTestId("pipeline-row-cpl_2") }).getByTestId("pipeline-delete").click();
  await expect(page.getByTestId("pipeline-row-cpl_2")).toHaveCount(0);
  await expect(page.getByTestId("pipeline-total")).toHaveText("Toplam: 1");

  await page.getByTestId("pipeline-filter").selectOption("teslim");
  await expect.poll(() => state.requests.some((entry) => entry.path === "/api/cargo-pipeline" && entry.search.includes("status=teslim"))).toBe(true);
});

test("kargo pipeline: settings sheet saves the legacy config and the test sheet sends tests", async ({ page }) => {
  const state = await open(page);
  await page.goto("/kargolar/pipeline");
  await page.getByTestId("pipeline-open-config").click();
  const sheet = page.getByTestId("pipeline-config-sheet");
  await expect(sheet.getByTestId("pipeline-config-template")).toHaveValue(config.mesaj_sablonu);
  await sheet.getByTestId("pipeline-config-active").check();
  await sheet.getByTestId("pipeline-config-sms_gecikme_dk").fill("15");
  await sheet.getByTestId("pipeline-config-save").click();
  await expect(sheet.getByTestId("pipeline-config-feedback")).toHaveText("Pipeline ayarları kaydedildi");
  expect(state.bodies.find((entry) => entry.path === "/api/cargo-pipeline/config" && entry.method === "PUT")?.body).toEqual({ ...config, aktif: true, sms_gecikme_dk: 15 });
  await page.keyboard.press("Escape");

  await page.getByTestId("pipeline-open-test").click();
  const test = page.getByTestId("pipeline-test-sheet");
  await expect(test.getByTestId("pipeline-test-preview")).toHaveText("Sayın Test Müşteri, kargonuz (TEST-000) şubede bekliyor. Takip: https://gonderitakip.ptt.gov.tr/Track/Verify?q=TEST-000");
  await test.getByTestId("pipeline-test-sms").click();
  await expect(test.getByTestId("pipeline-test-feedback")).toHaveText("Lütfen telefon numarası girin");
  await test.getByTestId("pipeline-test-phone").fill("05551234567");
  await test.getByTestId("pipeline-test-sms").click();
  await expect(test.getByTestId("pipeline-test-feedback")).toHaveText("Test kuyruğa alındı (providers.netgsm.live_mode)");
  await test.getByTestId("pipeline-test-message").click();
  await expect(test.getByTestId("pipeline-test-feedback")).toHaveText("Kanal mesajı için konuşma ID gerekli");
  await test.getByTestId("pipeline-test-conversation").fill("cnv_1");
  await test.getByTestId("pipeline-test-message").click();
  await expect(test.getByTestId("pipeline-test-feedback")).toContainText("Test kuyruğa alındı");
  await test.getByTestId("pipeline-test-vapi").click();
  await expect(test.getByTestId("pipeline-test-feedback")).toHaveText("Test başarısız: VAPI devre dışı. Ayarlardan etkinleştirin.");
  const sent = state.bodies.filter((entry) => entry.path === "/api/cargo-pipeline/test").map((entry) => entry.body as Record<string, unknown>);
  expect(sent.map((entry) => entry.type)).toEqual(["sms", "mesaj", "vapi"]);
  expect(sent[1]).toMatchObject({ phone: "05551234567", conversation_public_id: "cnv_1", tracking_number: "TEST-000", cargo_provider: "PTT" });
});

test("kargo pipeline: staff see rows read-only, mobile layout and English", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("garanti-beta-lang", "en"));
  await open(page, "kargo_operatoru", viewports.phone390);
  await page.goto("/kargo/pipeline");
  await expect.poll(() => pathOf(page)).toBe("/kargolar/pipeline");
  await expect(page.getByRole("heading", { name: "Undelivered Shipment Pipeline" })).toBeVisible();
  await expect(page.getByTestId("pipeline-cards")).toContainText("Ayşe Yılmaz");
  await expect(page.getByTestId("pipeline-open-config")).toHaveCount(0);
  await expect(page.getByTestId("pipeline-run_now")).toHaveCount(0);
  await expect(page.getByTestId("pipeline-delete")).toHaveCount(0);
  await expectResponsiveLayout(page, { checkTouchTargets: true });
});
