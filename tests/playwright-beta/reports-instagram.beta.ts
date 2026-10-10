import { expect, test, type Page } from "@playwright/test";
import { expectResponsiveLayout, login, mockBackend, mockUser, pathOf, viewports, type ExtraRoute } from "./helpers";

test.use({ serviceWorkers: "block" });

const now = "2026-10-07T09:00:00.000Z";

function routes() {
  let refreshed = false;
  let publicationPolls = 0;
  const route: ExtraRoute = ({ method, path, url, body }) => {
    if (path === "/api/reports/analysis") {
      const provider = url.searchParams.get("cargo_provider");
      const scale = provider === "ptt" ? 0.5 : 1;
      return {
        status: 200,
        body: {
          filters: { start_date: url.searchParams.get("start_date"), end_date: url.searchParams.get("end_date"), personnel_public_id: url.searchParams.get("personnel_public_id"), cargo_provider: provider },
          currency: "TRY",
          metrics: { toplam: 120 * scale, ciro: 245000 * scale, aktif: 90, iptal: 12, iade: 6, sevk_edildi: 30, teslim_edildi: 60, kargoya_giden: 90, ptt: 50, surat: 40, ptt_subede: 4, surat_subede: 3, subede_toplam: 7, teyit_edildi: 100, teyit_bekliyor: 8, kargo_iade: 5, ptt_kargo_iade: 3, surat_kargo_iade: 2, kargo_takip_iade: 1 },
          rates: { teslim: 66.7, iptal: 10, iade: 5, kargo_iade: 5.6, teyit: 83.3, sube: 7.8 },
          status_distribution: [{ status: "teslim_edildi", count: 60 }, { status: "sevk_edildi", count: 30 }, { status: "iptal", count: 12 }, { status: "olusturuldu", count: 0 }],
          daily_source: "daily_series",
          daily: [{ date: "2026-10-05", orders: 8, revenue: 16000, cancelled: 1, returned: 0 }, { date: "2026-10-06", orders: 12, revenue: 24500, cancelled: 0, returned: 1 }],
          cargo_providers: [{ provider: "ptt", active: 50, returns: 3 }, { provider: "surat", active: 40, returns: 2 }],
          personnel_performance: [{ user_public_id: "usr_1", name: "Ayşe Yılmaz", orders: 70, revenue: 150000, cancelled: 5 }],
          personnel_options: [{ public_id: "usr_1", first_name: "Ayşe", last_name: "Yılmaz" }],
        },
      };
    }
    if (path === "/api/instagram/insights/account") {
      const days = Number(url.searchParams.get("days"));
      return {
        status: 200,
        body: {
          success: true, cached: refreshed, account_public_id: "iac_ig",
          data: [
            { name: "impressions", period: "day", values: [{ value: 300, end_time: "2026-10-05T07:00:00+0000" }, { value: 450, end_time: "2026-10-06T07:00:00+0000" }] },
            { name: "reach", period: "day", values: [{ value: days === 14 ? 400 : 120, end_time: "2026-10-05T07:00:00+0000" }, { value: 180, end_time: "2026-10-06T07:00:00+0000" }] },
            { name: "profile_views", period: "day", values: [{ value: 12, end_time: "2026-10-06T07:00:00+0000" }] },
          ],
          followers: { followers_count: 15230, media_count: 88 }, period: { days, since: 0, until: 0 },
          dry_run: !refreshed, synced_at: refreshed ? now : null, live_gate: "providers.instagram.live_mode", live_call_permitted: false,
        },
      };
    }
    if (path === "/api/instagram/insights/account/refresh") {
      refreshed = true;
      return { status: 202, body: { account_public_id: "iac_ig", request_id: "req_1", job_id: "job_1", queued: true, live_gate: "providers.instagram.live_mode", live_call_permitted: false } };
    }
    const publication = (status: string) => ({ public_id: "igp_1", account_public_id: "iac_ig", media_kind: "image", media_type: "IMAGE", media_url: "https://cdn.example.com/a.jpg", file_public_id: null, caption: "Yeni ürün", idempotency_key: "k", request_id: "req_ig", job_id: "job_ig", queued: true, status, media_id: status === "published" ? "17895695668004550" : null, error_message: null, created_at: now });
    if (path === "/api/instagram/publications" && method === "POST") {
      expect((body as { image_url: string }).image_url).toBe("https://cdn.example.com/a.jpg");
      return { status: 202, body: { provider: "instagram", operation: "media.publish", publication: publication("queued"), job_id: "job_ig", queued: true, replayed: false, live_call_permitted: false, live_gate: "providers.instagram.live_mode" } };
    }
    if (path === "/api/instagram/publications/igp_1") {
      publicationPolls += 1;
      return { status: 200, body: publication(publicationPolls > 1 ? "published" : "queued") };
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

test("reports: KPIs, presets, filters and breakdowns", async ({ page }) => {
  const state = await signIn(page, "admin");
  await page.getByTestId("nav-group-trigger-accounting").click();
  await page.getByTestId("nav-item-reports").click();
  await expect.poll(() => pathOf(page)).toBe("/raporlar");
  await expect(page.getByTestId("reports-kpi-total")).toContainText("120");
  await expect(page.getByTestId("reports-kpi-revenue")).toContainText("245.000");
  await expect(page.getByTestId("reports-kpi-confirmation")).toContainText("%83.3");
  await expect(page.getByTestId("reports-status")).toContainText("Teslim Edildi");
  await expect(page.getByTestId("reports-status")).not.toContainText("Oluşturuldu");
  await expect(page.getByTestId("reports-personnel-performance")).toContainText("Ayşe Yılmaz");
  await expect(page.getByTestId("reports-rates")).toContainText("%66.7");

  await page.getByTestId("reports-preset-7").click();
  await page.getByTestId("reports-provider").selectOption("ptt");
  await page.getByTestId("reports-personnel").selectOption("usr_1");
  await expect(page.getByTestId("reports-kpi-total")).toContainText("60");
  // The provider change alone already yields 60, so wait for the request that carries both filters.
  const filtered = () => state.requests.filter((entry) => entry.path === "/api/reports/analysis").map((entry) => new URLSearchParams(entry.search)).find((query) => query.get("cargo_provider") === "ptt" && query.get("personnel_public_id") === "usr_1");
  await expect.poll(() => Boolean(filtered())).toBe(true);
  const params = filtered()!;
  const span = (Date.parse(params.get("end_date")!) - Date.parse(params.get("start_date")!)) / 86_400_000;
  expect(span).toBe(6);
});

test("instagram analytics: day range, live refresh and sync line", async ({ page }) => {
  const state = await signIn(page, "calisan");
  await page.goto("/instagram/analitik");
  await expect(page.getByTestId("instagram-card-followers")).toHaveText("15.230");
  await expect(page.getByTestId("instagram-card-reach")).toHaveText("300");
  await expect(page.getByTestId("instagram-sync")).toContainText("Canlı senkron yok");
  await page.getByTestId("instagram-days").selectOption("14");
  await expect(page.getByTestId("instagram-card-reach")).toHaveText("580");
  await page.getByTestId("instagram-refresh").click();
  await expect(page.getByTestId("instagram-feedback")).toHaveText("Instagram istatistikleri için yenileme kuyruğa alındı.");
  await expect(page.getByTestId("instagram-sync")).toContainText("Son canlı senkron");
  expect(state.bodies.some((entry) => entry.path === "/api/instagram/insights/account/refresh")).toBe(true);
});

test("instagram publish: validation, queue and polling to published", async ({ page }) => {
  await signIn(page, "calisan");
  await page.goto("/instagram/yayinla");
  await page.getByTestId("instagram-publish").click();
  await expect(page.getByTestId("instagram-publish-feedback")).toHaveText("Fotoğraf URL'si girin");
  await page.getByTestId("instagram-image-url").fill("https://cdn.example.com/a.jpg");
  await page.getByTestId("instagram-caption").fill("Yeni ürün");
  await expect(page.getByTestId("instagram-caption-count")).toHaveText("9 / 2200 karakter");
  await page.getByTestId("instagram-publish").click();
  await expect(page.getByTestId("instagram-publish-feedback")).toHaveText("Yayın isteği kuyruğa alındı");
  await expect(page.getByTestId("instagram-publish-feedback")).toHaveText("Instagram gönderisi yayınlandı!", { timeout: 15_000 });
  await expect(page.getByTestId("instagram-publish-result")).toContainText("17895695668004550");
});

test("reports and instagram on a phone; staff cannot open reports; English", async ({ page }) => {
  await signIn(page, "admin", viewports.phone360);
  await page.goto("/raporlar");
  await expect(page.getByTestId("reports-kpis")).toBeVisible();
  await expectResponsiveLayout(page, { checkTouchTargets: true });
  await page.goto("/instagram/analitik");
  await expect(page.getByTestId("instagram-cards")).toBeVisible();
  await expectResponsiveLayout(page, { checkTouchTargets: true });
  await page.goto("/instagram/yayinla");
  await expectResponsiveLayout(page, { checkTouchTargets: true });
  await page.evaluate(() => window.localStorage.setItem("garanti-beta-lang", "en"));
  await page.goto("/raporlar");
  await expect(page.getByTestId("page-reports").getByRole("heading", { level: 1 })).toHaveText("Business Analytics");
});

test("staff is redirected away from reports", async ({ page }) => {
  await signIn(page, "calisan");
  await page.goto("/raporlar");
  await expect.poll(() => pathOf(page)).toBe("/");
});
