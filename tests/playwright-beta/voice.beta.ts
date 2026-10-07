import { expect, test, type Page } from "@playwright/test";
import { expectResponsiveLayout, login, mockBackend, mockUser, pathOf, viewports, type ExtraRoute } from "./helpers";

test.use({ serviceWorkers: "block" });

const now = "2026-10-07T09:00:00.000Z";

function voiceMessage(overrides: Record<string, unknown> = {}) {
  return {
    public_id: "vm_1",
    recipients: ["05551112233", "05554445566"],
    recipient_count: 2,
    message: "Siparişiniz yola çıktı",
    audio_id: null,
    ringtime: 20,
    status: "dry_run",
    bulk_id: "bulk_77",
    error_message: null,
    report: null,
    report_checked_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function routes() {
  let teyit = { aktif: false, ilk_arama_dakika: 5, max_deneme: 3, deneme_arasi_dakika: 30 };
  let reported = false;
  const route: ExtraRoute = ({ method, path, url, body }) => {
    if (path === "/api/netgsm/teyit-settings") {
      if (method === "PUT") teyit = body as typeof teyit;
      return { status: 200, body: { settings: teyit } };
    }
    if (path === "/api/netgsm/cdr/sync") return { status: 202, body: { request_id: "req_cdr", job_id: "job_cdr", queued: true } };
    if (path === "/api/netgsm/cdr") {
      const outgoing = url.searchParams.get("yon") === "giden";
      return {
        status: 200,
        body: {
          success: true,
          synced_at: now,
          data: {
            kayitlar: [
              { id: outgoing ? "c2" : "c1", tarih: "07.10.2026 10:15", arayanNumara: outgoing ? "8501234567" : "05557778899", arayanAdi: "", arananNumara: outgoing ? "05557778899" : "8501234567", yontem: "", sure: "01:20", sureSaniye: 80, yon: outgoing ? "Giden" : "Gelen", yonKod: outgoing ? 0 : 1, sesKaydi: null, hat: null },
            ],
            toplamKayit: 1,
            toplamSure: "00:01:20",
            sayfa: 1,
            sayfaBoyutu: 25,
          },
        },
      };
    }
    if (path === "/api/netgsm/cdr/istatistik") {
      return { status: 200, body: { success: true, synced_at: now, data: { gelenArama: 42, gidenArama: 17, gelenCevapli: 38, gelenCevapsiz: 4, toplamSure: "02:10:00", toplamGorisme: 59, ortalamaSure: "00:02:12", cevaplananOran: 90.5 } } };
    }
    if (path === "/api/netgsm/sesli-mesaj" && method === "POST") {
      const input = body as { recipients: string[] };
      return { status: 202, body: { voice_message: voiceMessage({ public_id: "vm_2", recipients: input.recipients, recipient_count: input.recipients.length, status: "queued", bulk_id: null }), replayed: false, queued: true, live_gate: "providers.netgsm.live_mode", live_call_permitted: false } };
    }
    if (path === "/api/netgsm/sesli-mesaj") {
      const status = url.searchParams.get("status");
      const rows = [voiceMessage(), voiceMessage({ public_id: "vm_3", message: null, audio_id: "aud_9", status: "failed", bulk_id: null, error_message: "NetGSM 30" })];
      const data = status ? rows.filter((row) => row.status === status) : rows;
      return { status: 200, body: { data, total_count: data.length, recipient_total: 3, limit: 25, offset: 0, live_gate: "providers.netgsm.live_mode" } };
    }
    if (path === "/api/netgsm/sesli-mesaj/vm_1/rapor") {
      reported = true;
      return { status: 202, body: { voice_message: voiceMessage(), replayed: false, queued: true, live_gate: "providers.netgsm.live_mode", live_call_permitted: false } };
    }
    if (path === "/api/netgsm/sesli-mesaj/vm_1") {
      const report = reported ? { report_ready: true, message: null, rows: [{ phone: "05551112233", status: "cevaplandi", pressed_key: "1", listen_seconds: 14 }] } : null;
      return { status: 200, body: { voice_message: voiceMessage({ report }), live_gate: "providers.netgsm.live_mode" } };
    }
    if (path === "/api/netgsm/rehber") {
      const kind = url.searchParams.get("kind");
      const rows = [
        { kind: "customer", public_id: "cus_1", name: "Zeynep Kaya", phone: "0555 111 22 33", extension: null, role: null },
        { kind: "staff", public_id: "usr_1", name: "Ayşe Yılmaz", phone: "05320000000", extension: "101", role: "calisan" },
      ];
      const data = kind ? rows.filter((row) => row.kind === kind) : rows;
      return { status: 200, body: { data, total_count: data.length, limit: 25, offset: 0 } };
    }
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

test("calls: auto-confirmation settings and call records", async ({ page }) => {
  const state = await signIn(page, "admin");
  await page.getByTestId("desktop-more-trigger").click();
  await page.getByTestId("more-calls").click();
  await expect.poll(() => pathOf(page)).toBe("/sesli-asistan");
  await expect(page.getByTestId("page-calls")).toBeVisible();

  await expect(page.getByTestId("teyit-summary")).toHaveCount(0);
  await page.getByTestId("teyit-aktif").check();
  await expect(page.getByTestId("teyit-summary")).toBeVisible();
  await page.getByTestId("teyit-max_deneme").fill("4");
  await page.getByTestId("teyit-save").click();
  await expect(page.getByTestId("teyit-feedback")).toContainText("Ayarlar kaydedildi.");
  expect(state.bodies.find((entry) => entry.method === "PUT" && entry.path === "/api/netgsm/teyit-settings")?.body).toEqual({ aktif: true, ilk_arama_dakika: 5, max_deneme: 4, deneme_arasi_dakika: 30 });

  await expect(page.getByTestId("cdr-summary")).toContainText("00:01:20");
  await expect(page.getByTestId("cdr-table")).toContainText("05557778899");
  await page.getByTestId("cdr-tab-giden").click();
  await expect(page.getByTestId("cdr-table")).toContainText("Giden");
  expect(state.requests.some((entry) => entry.path === "/api/netgsm/cdr" && entry.search.includes("yon=giden"))).toBe(true);
  await page.getByTestId("cdr-sync").click();
  await expect.poll(() => state.bodies.some((entry) => entry.path === "/api/netgsm/cdr/sync")).toBe(true);
  await page.getByTestId("cdr-tab-stats").click();
  await expect(page.getByTestId("cdr-stats")).toContainText("42");
  await expect(page.getByTestId("cdr-stats")).toContainText("%90.5");
});

test("voice messages: queue, list filter and per-number report", async ({ page }) => {
  const state = await signIn(page, "owner");
  await page.goto("/sesli-asistan/sesli-mesajlar");
  await expect(page.getByTestId("page-voice-messages")).toBeVisible();
  await expect(page.getByTestId("voice-link-voiceMessages")).toHaveAttribute("aria-current", "page");

  await page.getByTestId("voice-send").click();
  await expect(page.getByTestId("voice-feedback")).toContainText("Geçerli en az bir telefon numarası girin.");
  await page.getByTestId("voice-recipients").fill("0555 111 22 33\n05554445566, 05554445566; abc");
  await expect(page.getByTestId("voice-recipient-count")).toHaveText("2 numara");
  await page.getByTestId("voice-content").fill("Siparişiniz yola çıktı");
  await page.getByTestId("voice-ringtime").selectOption("30");
  await page.getByTestId("voice-send").click();
  await expect(page.getByTestId("voice-feedback")).toContainText("Sesli mesaj kuyruğa alındı (2 numara).");
  const sent = state.bodies.find((entry) => entry.method === "POST" && entry.path === "/api/netgsm/sesli-mesaj")?.body as Record<string, unknown>;
  expect(sent).toMatchObject({ recipients: ["05551112233", "05554445566"], message: "Siparişiniz yola çıktı", ringtime: 30 });
  expect(String(sent.idempotency_key)).toMatch(/^voice/);

  const table = page.getByTestId("voice-table");
  await expect(table).toContainText("aud_9");
  await page.getByTestId("filter-status").click();
  await page.getByTestId("filter-status-failed").click();
  await expect(table).not.toContainText("Siparişiniz yola çıktı");
  await expect.poll(() => state.requests.some((entry) => entry.path === "/api/netgsm/sesli-mesaj" && entry.search.includes("status=failed"))).toBe(true);
  await page.getByTestId("filter-status").click();
  await page.getByTestId("filter-status-all").click();
  await expect(table).toContainText("Siparişiniz yola çıktı");

  await table.getByTestId("voice-details").filter({ hasText: "Siparişiniz yola çıktı" }).click();
  const sheet = page.getByTestId("voice-detail");
  await expect(sheet.getByTestId("voice-detail-bulk")).toHaveText("bulk_77");
  await sheet.getByTestId("voice-request-report").click();
  await expect(sheet.getByTestId("voice-detail-feedback")).toContainText("Rapor sorgusu kuyruğa alındı");
  await sheet.getByTestId("voice-detail-refresh").click();
  await expect(sheet.getByTestId("voice-report")).toContainText("Cevaplandı · 14 sn · 1");
});

test("phonebook: customers and staff with tel links, English", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("garanti-beta-lang", "en"));
  const state = await signIn(page, "admin");
  await page.goto("/sesli-asistan/rehber");
  await expect(page.getByTestId("page-phonebook")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Phonebook" })).toBeVisible();
  const table = page.getByTestId("phonebook-table");
  await expect(table.locator('a[href="tel:05551112233"]')).toBeVisible();
  await expect(table.locator('a[href="tel:101"]')).toBeVisible();
  await page.getByTestId("filter-kind").click();
  await page.getByTestId("filter-kind-staff").click();
  await expect(table).not.toContainText("Zeynep Kaya");
  await expect(table).toContainText("Staff");
  expect(state.requests.some((entry) => entry.path === "/api/netgsm/rehber" && entry.search.includes("kind=staff"))).toBe(true);
  await page.getByTestId("voice-link-calls").click();
  await expect.poll(() => pathOf(page)).toBe("/sesli-asistan");
});

test("voice pages are manager-only and responsive on mobile", async ({ page }) => {
  await signIn(page, "admin", viewports.phone390);
  await page.goto("/sesli-asistan/sesli-mesajlar");
  await expect(page.getByTestId("voice-cards")).toContainText("aud_9");
  await expectResponsiveLayout(page, { checkTouchTargets: true });
  await page.goto("/sesli-asistan/rehber");
  await expect(page.getByTestId("phonebook-cards")).toContainText("Ayşe Yılmaz");
  await expectResponsiveLayout(page, { checkTouchTargets: true });
});

test("calisan is redirected away from voice pages", async ({ page }) => {
  await signIn(page, "calisan");
  await page.goto("/sesli-asistan");
  await expect.poll(() => pathOf(page)).not.toBe("/sesli-asistan");
  await page.getByTestId("desktop-more-trigger").click();
  await expect(page.getByTestId("more-calls")).toHaveCount(0);
});
