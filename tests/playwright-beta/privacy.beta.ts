import { expect, test, type Page } from "@playwright/test";
import { expectResponsiveLayout, login, mockBackend, mockUser, pathOf, viewports, type ExtraRoute } from "./helpers";

test.use({ serviceWorkers: "block" });

const now = "2026-10-07T09:00:00.000Z";

function request(overrides: Record<string, unknown> = {}) {
  return {
    public_id: "ddr_1", reference: "DEL-ABC123", source: "form", full_name: "Zeynep Kaya", email: "zeynep@example.com", phone: null, instagram_username: "zeynep.k",
    messenger_psid: null, description: "Lütfen silin", status: "pending", resolution_note: null, requested_at: now, resolved_at: null, created_at: now, ...overrides,
  };
}

function routes() {
  const route: ExtraRoute = ({ method, path, url, body }) => {
    if (path === "/api/veri-silme-talebi" && method === "POST") {
      if ((body as { email: string | null }).email === "down@example.com") return { status: 500, body: { error: { code: "internal_error", message: "Sunucu hatası" } } };
      return { status: 201, body: { success: true, message: "ok", referans: "DEL-NEW1", reference: "DEL-NEW1" } };
    }
    if (path === "/api/veri-silme-talebi/DEL-ABC123") return { status: 200, body: { reference: "DEL-ABC123", status: "completed", requested_at: now, resolved_at: now } };
    if (path.startsWith("/api/veri-silme-talebi/")) return { status: 404, body: { error: { code: "not_found", message: "Talep bulunamadı" } } };
    if (path === "/admin/data-deletion-requests" && method === "GET") {
      const rows = [request(), request({ public_id: "ddr_2", reference: "DEL-FB1", source: "facebook", full_name: null, email: null, instagram_username: null, messenger_psid: "1234567890", description: null, status: "in_progress" })];
      const status = url.searchParams.get("status");
      const data = status ? rows.filter((row) => row.status === status) : rows;
      return { status: 200, body: { data, total_count: data.length, limit: 25, offset: 0 } };
    }
    if (path === "/admin/data-deletion-requests/ddr_1" && method === "PATCH") {
      const input = body as { status: string; note: string | null };
      return { status: 200, body: { request: request({ status: input.status, resolution_note: input.note, resolved_at: now }) } };
    }
    return undefined;
  };
  return route;
}

async function open(page: Page, path: string, viewport: { width: number; height: number } = viewports.desktop) {
  await page.setViewportSize(viewport);
  const state = await mockBackend(page, mockUser("admin"), { extra: routes(), anonymous: (path) => path.startsWith("/api/veri-silme-talebi") });
  await page.goto(path);
  return state;
}

test("veri silme: anonymous form validates, reports server errors and shows the reference", async ({ page }) => {
  const state = await open(page, "/veri-silme");
  await expect(page.getByRole("heading", { name: "Veri Silme Talebi" })).toBeVisible();
  const form = page.getByTestId("deletion-form");
  const submit = page.getByTestId("deletion-submit");
  await submit.click();
  await expect(page.getByTestId("deletion-error")).toHaveText("Ad Soyad alanı zorunludur.");
  await form.locator('input[name="ad"]').fill("Zeynep Kaya");
  await submit.click();
  await expect(page.getByTestId("deletion-error")).toContainText("En az bir iletişim bilgisi");
  await form.locator('input[name="instagram"]').fill("@zeynep.k");
  await submit.click();
  await expect(page.getByTestId("deletion-error")).toHaveText("Veri silme talebini onaylamanız gerekmektedir.");
  await form.locator('input[name="onay"]').check();
  await form.locator('input[name="email"]').fill("down@example.com");
  await submit.click();
  await expect(page.getByTestId("deletion-error")).toHaveText("Talep gönderilemedi: Sunucu hatası");
  await form.locator('input[name="email"]').fill("zeynep@example.com");
  await submit.click();
  await expect(page.getByTestId("deletion-reference")).toHaveText("DEL-NEW1");
  const sent = state.bodies.filter((entry) => entry.path === "/api/veri-silme-talebi").at(-1)?.body;
  expect(sent).toMatchObject({ ad: "Zeynep Kaya", email: "zeynep@example.com", telefon: null, instagram_kullanici_adi: "zeynep.k", messenger_psid: null, aciklama: null });
  const posted = state.requests.filter((entry) => entry.path === "/api/veri-silme-talebi");
  expect(posted.every((entry) => entry.auth === null)).toBe(true);
});

test("veri silme: Meta callback reference status, English and mobile", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("garanti-beta-lang", "en"));
  await open(page, "/veri-silme?ref=DEL-ABC123", viewports.phone390);
  await expect(page.getByTestId("deletion-status")).toContainText("DEL-ABC123 · Completed");
  await expect(page.getByRole("heading", { name: "Data Deletion Request" })).toBeVisible();
  await expectResponsiveLayout(page, { checkTouchTargets: true });
  await page.goto("/veri-silme?ref=DEL-NOPE");
  await expect(page.getByTestId("deletion-status")).toContainText("No request was found for this reference.");
});

test("data deletion requests: managers review and close requests", async ({ page }) => {
  const state = await open(page, "/giris");
  await login(page, state);
  await page.getByTestId("desktop-more-trigger").click();
  await page.getByTestId("more-dataDeletionRequests").click();
  await expect.poll(() => pathOf(page)).toBe("/veri-silme-talepleri");
  const table = page.getByTestId("deletion-requests-table");
  await expect(table).toContainText("PSID 1234567890");
  await expect(table).toContainText("Meta geri çağrısı");
  const row = table.getByTestId("deletion-row-DEL-ABC123");
  await expect(row.getByTestId("deletion-row-save")).toBeDisabled();
  await row.getByTestId("deletion-row-status").selectOption("completed");
  await row.getByTestId("deletion-row-note").fill("Müşteri ve mesajlar silindi");
  await row.getByTestId("deletion-row-save").click();
  await expect(page.getByTestId("deletion-feedback")).toHaveText("DEL-ABC123 güncellendi.");
  expect(state.bodies.find((entry) => entry.method === "PATCH")?.body).toEqual({ status: "completed", note: "Müşteri ve mesajlar silindi" });
  await page.getByTestId("deletion-filter").selectOption("in_progress");
  await expect(table).not.toContainText("Zeynep Kaya");
});

test("data deletion requests: mobile cards and manager-only", async ({ page }) => {
  const state = await open(page, "/giris", viewports.phone390);
  await login(page, state);
  await page.goto("/veri-silme-talepleri");
  await expect(page.getByTestId("deletion-requests-cards")).toContainText("Zeynep Kaya");
  await expectResponsiveLayout(page, { checkTouchTargets: true });
});

test("calisan cannot open the deletion request list", async ({ page }) => {
  await page.setViewportSize(viewports.desktop);
  const state = await mockBackend(page, mockUser("calisan"), { extra: routes() });
  await page.goto("/giris");
  await login(page, state);
  await page.goto("/veri-silme-talepleri");
  await expect.poll(() => pathOf(page)).not.toBe("/veri-silme-talepleri");
});
