import { expect, test, type Page } from "@playwright/test";
import { expectResponsiveLayout, login, mockBackend, mockUser, pathOf, viewports, type ExtraRoute } from "./helpers";

test.use({ serviceWorkers: "block" });

const now = "2026-10-07T09:00:00.000Z";

function cancelledOrder(publicId: string, orderNumber: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    public_id: publicId, order_number: orderNumber, status, source: "panel", cargo_provider: "ptt", total_amount: "1250.00", currency: "TRY",
    confirmation_status: null, notes: null, customer_full_name: "Ayşe Yılmaz", created_at: "2026-10-01T09:00:00.000Z", updated_at: now, ...extra,
  };
}

/** /api/orders?status=cancellations|cancelled|returned and the order action endpoints. */
function cancellationRoutes() {
  let rows = [
    cancelledOrder("ord_c1", "GK-9001", "cancelled", { notes: "Müşteri vazgeçti" }),
    cancelledOrder("ord_r1", "GK-9002", "returned", { customer_full_name: "Mehmet Kaya" }),
    cancelledOrder("ord_c2", "GK-9003", "cancelled", { customer_full_name: "Zeynep Ak" }),
  ];
  const state = (row: (typeof rows)[number]) => ({
    public_id: row.public_id, order_number: row.order_number, status: row.status, notes: row.notes, total_amount: row.total_amount, currency: row.currency,
    customer_full_name: row.customer_full_name, customer_phone: "05551112233", confirmation_status: null,
    kolaybi: { invoice_id: row.public_id === "ord_c1" ? "kb_inv_77" : null, e_document_status: row.public_id === "ord_c1" ? "approved" : null },
    created_at: row.created_at, updated_at: row.updated_at,
  });
  const route: ExtraRoute = ({ method, path, url, body }) => {
    const status = url.searchParams.get("status");
    if (path === "/api/orders" && (status === "cancellations" || status === "cancelled" || status === "returned")) {
      const search = (url.searchParams.get("search") ?? "").toLocaleLowerCase("tr-TR");
      const data = rows
        .filter((row) => (status === "cancellations" ? true : row.status === status))
        .filter((row) => !search || `${row.order_number} ${row.customer_full_name}`.toLocaleLowerCase("tr-TR").includes(search));
      return { status: 200, body: { data, meta: { total_count: data.length, limit: 20, offset: 0 } } };
    }
    const match = path.match(/^\/api\/orders\/(ord_[a-z0-9]+)(\/[a-z]+)?$/);
    if (!match) return undefined;
    const row = rows.find((entry) => entry.public_id === match[1]);
    if (!row) return { status: 404, body: { error: { code: "not_found", message: "Order not found" } } };
    if (match[2] === "/actions") return { status: 200, body: { order: state(row), steps: [] } };
    if (match[2] === "/restore" && method === "POST") {
      rows = rows.filter((entry) => entry.public_id !== row.public_id);
      return { status: 200, body: { order: { ...state(row), status: "draft" } } };
    }
    if (match[2] === "/notes" && method === "PATCH") {
      row.notes = (body as { notes: string | null }).notes;
      return { status: 200, body: { order: state(row) } };
    }
    if (!match[2] && method === "DELETE") {
      rows = rows.filter((entry) => entry.public_id !== row.public_id);
      const invoiced = row.public_id === "ord_c1";
      return { status: 200, body: { deleted: true, replayed: false, commission_preserved: true, order: state(row), e_document_cancel: invoiced ? { public_id: "ops_1" } : null } };
    }
    return undefined;
  };
  return route;
}

async function signIn(page: Page, viewport: { width: number; height: number } = viewports.desktop, role = "calisan") {
  await page.setViewportSize(viewport);
  const state = await mockBackend(page, mockUser(role), { extra: cancellationRoutes() });
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("topbar")).toBeVisible();
  return state;
}

test("desktop More menu opens İptaller; filter, search and inline note", async ({ page }) => {
  const state = await signIn(page);
  await page.getByTestId("nav-group-trigger-operations").click();
  await page.getByTestId("nav-item-cancellations").click();
  await expect.poll(() => pathOf(page)).toBe("/iptaller");
  const table = page.getByTestId("cancellations-table");
  await expect(table.getByTestId("cancellations-row")).toHaveCount(3);
  const listCall = state.requests.find((entry) => entry.path === "/api/orders" && entry.search.includes("status=cancellations"));
  expect(listCall?.search).toContain("sort_by=updated_at");

  await page.getByTestId("filter-status").click();
  await page.getByRole("option", { name: "İade" }).click();
  await expect(table.getByTestId("cancellations-row")).toHaveCount(1);
  await expect(table).toContainText("GK-9002");
  await expect.poll(() => new URL(page.url()).search).toBe("?status=returned");

  const row = table.getByTestId("cancellations-row").first();
  await row.getByTestId("cancellation-note").fill("Kargo hasarlı geldi");
  await row.getByTestId("cancellation-note-save").click();
  await expect(page.getByTestId("cancellations-feedback")).toHaveText("Not kaydedildi");
  expect(state.bodies.find((entry) => entry.method === "PATCH" && entry.path === "/api/orders/ord_r1/notes")?.body).toEqual({ notes: "Kargo hasarlı geldi" });
});

test("restore and permanently delete an invoiced order after confirmation", async ({ page }) => {
  const state = await signIn(page, viewports.desktop, "admin");
  await page.goto("/iptaller");
  const table = page.getByTestId("cancellations-table");
  await expect(table.getByTestId("cancellations-row")).toHaveCount(3);

  await table.getByTestId("cancellations-row").filter({ hasText: "GK-9002" }).getByTestId("cancellation-restore").click();
  await expect(page.getByTestId("confirm-dialog-message")).toContainText('"GK-9002" siparişi geri alınacak');
  await page.getByTestId("confirm-dialog-action").click();
  await expect(page.getByTestId("cancellations-feedback")).toContainText("Sipariş geri alındı");
  await expect(table.getByTestId("cancellations-row")).toHaveCount(2);
  expect(state.bodies.some((entry) => entry.method === "POST" && entry.path === "/api/orders/ord_r1/restore")).toBe(true);

  await table.getByTestId("cancellations-row").filter({ hasText: "GK-9001" }).getByTestId("cancellation-details").click();
  const detail = page.getByTestId("cancellation-detail");
  await expect(detail.getByTestId("cancellation-detail-invoice")).toHaveText("kb_inv_77");
  await expect(detail).toContainText("05551112233");
  await detail.getByTestId("cancellation-detail-delete").click();
  await expect(page.getByTestId("confirm-dialog-message")).toContainText("KolayBi e-belgesi iptal kuyruğuna alınacak");
  await page.getByTestId("confirm-dialog-action").click();
  await expect(page.getByTestId("cancellations-feedback")).toContainText("KolayBi e-belge iptali kuyruğa alındı");
  await expect(page.getByTestId("cancellation-detail")).toHaveCount(0);
  await expect(table.getByTestId("cancellations-row")).toHaveCount(1);
  const removal = state.bodies.find((entry) => entry.method === "DELETE" && entry.path === "/api/orders/ord_c1");
  expect((removal?.body as { idempotency_key: string }).idempotency_key).toMatch(/^iptal_sil_/);
});

test("mobile cards, dismissed confirmation, English and the cargo operator is redirected", async ({ page }) => {
  const state = await signIn(page, viewports.phone360);
  await page.getByTestId("mobile-menu-trigger").click();
  await page.getByTestId("mobile-menu-operations").getByRole("link", { name: "İptaller" }).click();
  await expect.poll(() => pathOf(page)).toBe("/iptaller");
  const cards = page.getByTestId("cancellations-cards");
  await expect(cards.getByTestId("cancellations-card")).toHaveCount(3);
  await cards.getByTestId("cancellations-card").first().getByTestId("cancellation-restore").click();
  await page.getByTestId("confirm-dialog-cancel").click();
  await expect(cards.getByTestId("cancellations-card")).toHaveCount(3);
  expect(state.bodies.some((entry) => entry.path.endsWith("/restore"))).toBe(false);
  await expectResponsiveLayout(page, { checkTouchTargets: true });

  await page.evaluate(() => window.localStorage.setItem("garanti-beta-lang", "en"));
  await page.reload();
  await expect(page.getByTestId("page-cancellations").getByRole("heading", { level: 1 })).toHaveText("Cancellations");
  await expect(cards.getByTestId("cancellation-delete").first()).toHaveText("Delete permanently");
});

test("cargo operator has no İptaller page", async ({ page }) => {
  await signIn(page, viewports.desktop, "kargo_operatoru");
  await page.getByTestId("nav-group-trigger-operations").click();
  await expect(page.getByTestId("nav-group-menu-operations")).toBeVisible();
  await expect(page.getByTestId("nav-item-cancellations")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto("/iptaller");
  await expect.poll(() => pathOf(page)).toBe("/siparisler");
});
