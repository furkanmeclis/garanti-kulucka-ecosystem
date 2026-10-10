import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { expectResponsiveLayout, login, mockBackend, mockUser, viewports, type ExtraRoute } from "./helpers";

test.use({ serviceWorkers: "block" });

function routes() {
  let delivered = false;
  const route: ExtraRoute = ({ method, path }) => {
    if (path === "/api/shipments/shp_2" && method === "GET") {
      return {
        status: 200,
        body: {
          public_id: "shp_2", provider: "ptt", tracking_number: "TRK900002", barcode_number: "KP900002", status: delivered ? "delivered" : "in_transit", recipient_name: "Alıcı 2", recipient_phone: "05551112233",
          recipient_city: "Adana", recipient_district: "Seyhan", last_event_text: "Şubede bekliyor", order_number: "GK-1002", customer_full_name: "Müşteri 2",
          tracking_events: [{ public_id: "ste_1", status: "in_transit", description: "Kabul edildi", location: "Adana", occurred_at: "2026-10-05T08:00:00.000Z" }], updated_at: "2026-10-06T08:00:00.000Z",
        },
      };
    }
    if (path === "/api/shipments/shp_2/track") return { status: 202, body: { provider: "ptt", operation: "shipment.track", request_id: "req_t", queued: true, live_gate: "providers.ptt.live_mode" } };
    if (path === "/api/shipments/shp_2/status") {
      delivered = true;
      return { status: 200, body: { public_id: "shp_2", provider: "ptt", tracking_number: "TRK900002", barcode_number: "KP900002", status: "delivered", recipient_name: "Alıcı 2", tracking_events: [] } };
    }
    const print = /^\/api\/shipments\/(shp_\d+)\/print$/.exec(path);
    if (print) {
      const id = print[1];
      return {
        status: 200,
        body: { shipment_public_id: id, provider: "ptt", provider_label: "PTT Kargo", status: "in_transit", tracking_number: `T-${id}`, barcode_number: `B-${id}`, barcode_value: `B-${id}`, label_printed_at: null, invoice_title: "Garanti Kuluçka", recipient: { name: `Alıcı ${id}`, phone: null, address: "Adres", city: "Adana", district: "Seyhan" }, items: [{ name: "Makine", quantity: 1, unit_price: "100.00", total_amount: "100.00" }] },
      };
    }
    if (/^\/api\/shipments\/shp_\d+\/printed$/.test(path)) return { status: 200, body: { shipment_public_id: "x", label_printed_at: "2026-10-07T09:00:00.000Z" } };
    if (path.startsWith("/admin/integrations/provider-cron-triggers/")) return { status: 202, body: {} };
    return undefined;
  };
  return route;
}

async function open(page: Page, role = "admin", viewport: { width: number; height: number } = viewports.desktop) {
  await page.setViewportSize(viewport);
  const state = await mockBackend(page, mockUser(role), { extra: routes() });
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("topbar")).toBeVisible();
  await page.goto("/kargolar");
  await expect(page.getByTestId("page-shipments")).toBeVisible();
  return state;
}

const lastQuery = (state: Awaited<ReturnType<typeof open>>) => state.requests.filter((entry) => entry.path === "/api/shipments").at(-1)?.search ?? "";

test("kargolar: legacy views and date range reach the API; managers can queue tracking for all", async ({ page }) => {
  const state = await open(page);
  await page.getByTestId("filter-view").click();
  await page.getByTestId("filter-view-surat_not_received").click();
  await expect.poll(() => lastQuery(state)).toContain("not_received=surat");
  await page.getByTestId("filter-view").click();
  await page.getByTestId("filter-view-shipped").click();
  await expect.poll(() => lastQuery(state)).toContain("stage=shipped");
  await page.getByTestId("filter-dates").click();
  await page.getByTestId("filter-from").fill("01.10.2026");
  await expect.poll(() => lastQuery(state)).toContain("created_from=2026-10-01");
  await page.keyboard.press("Escape");
  await page.getByTestId("shipments-refresh-tracking").click();
  await expect(page.getByTestId("shipments-feedback")).toHaveText("PTT ve Sürat takip güncellemesi kuyruğa alındı");
  expect(state.bodies.filter((entry) => entry.path.startsWith("/admin/integrations/provider-cron-triggers/")).map((entry) => entry.path).sort()).toEqual([
    "/admin/integrations/provider-cron-triggers/ptt",
    "/admin/integrations/provider-cron-triggers/surat",
  ]);
});

test("kargolar: detail with history, tracking, delivered and the barcoded invoice print", async ({ page }) => {
  const state = await open(page, "kargo_operatoru");
  await expect(page.getByTestId("shipments-refresh-tracking")).toHaveCount(0);
  await page.getByTestId("shipments-table").getByTestId("shipment-open").filter({ hasText: "TRK900002" }).click();
  const detail = page.getByTestId("shipment-detail");
  await expect(detail.getByTestId("shipment-history")).toContainText("Kabul edildi");
  await detail.getByTestId("shipment-track").click();
  await expect(detail.getByTestId("shipment-detail-feedback")).toContainText("providers.ptt.live_mode");
  await detail.getByTestId("shipment-mark-delivered").click();
  await expect(detail.getByTestId("shipment-detail-status")).toContainText("Teslim edildi");
  expect(state.bodies.find((entry) => entry.path === "/api/shipments/shp_2/status")?.body).toMatchObject({ status: "delivered" });
  await detail.getByTestId("shipment-print").click();
  await expect(detail).toHaveCount(0);
  const overlay = page.getByTestId("print-overlay");
  await expect(overlay.getByTestId("print-page")).toHaveCount(1);
  await expect(overlay.getByTestId("print-barcode-value")).toHaveText("B-shp_2");
  await expect(overlay.locator("svg rect").first()).toBeAttached();
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect(overlay.getByTestId("print-done")).toBeVisible();
  await overlay.getByTestId("print-close").click();
  await expect(overlay).toHaveCount(0);
});

test("kargolar: selection, bulk print and both Excel formats", async ({ page }) => {
  const state = await open(page, "calisan");
  const table = page.getByTestId("shipments-table");
  await table.getByTestId("shipment-select").nth(0).check();
  await table.getByTestId("shipment-select").nth(1).check();
  await expect(page.getByTestId("shipments-bulk-bar")).toContainText("2 seçili");
  await page.getByTestId("shipments-bulk-print").click();
  await expect(page.getByTestId("print-overlay").getByTestId("print-page")).toHaveCount(2);
  await expect(page.getByTestId("print-count")).toHaveText(" · 2");
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect.poll(() => state.bodies.filter((entry) => entry.path.endsWith("/printed")).length).toBe(2);
  await page.getByTestId("print-close").click();

  await page.getByTestId("shipments-export").click();
  const [phones] = await Promise.all([page.waitForEvent("download"), page.getByTestId("shipments-export-selected-telefon").click()]);
  expect(phones.suggestedFilename()).toMatch(/^kargolar-telefon-/);
  expect(await readFile((await phones.path())!, "utf8")).toContain("<tr><td>Telefon</td><td>Ad Soyad</td></tr>");
  await page.getByTestId("shipments-export").click();
  const [list] = await Promise.all([page.waitForEvent("download"), page.getByTestId("shipments-export-filtered-liste").click()]);
  expect(await readFile((await list.path())!, "utf8")).toContain("<td>Ad Soyad</td><td>Telefon</td><td>İl</td>");
  await expect(page.getByTestId("shipments-feedback")).toContainText("Excel olarak indirildi");
});

test("kargolar: mobile cards stay touch friendly", async ({ page }) => {
  await open(page, "admin", viewports.phone390);
  await expect(page.getByTestId("shipments-cards")).toBeVisible();
  await expectResponsiveLayout(page, { checkTouchTargets: true });
});
