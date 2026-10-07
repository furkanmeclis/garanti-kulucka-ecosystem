import { expect, test, type Page } from "@playwright/test";
import { expectResponsiveLayout, login, mockBackend, mockUser, viewports, type ExtraRoute } from "./helpers";

test.use({ serviceWorkers: "block" });

const now = "2026-10-07T09:00:00.000Z";

function actionOrder(publicId: string, number: string) {
  return {
    public_id: publicId, order_number: number, status: "draft", notes: null, total_amount: "300.00", currency: "TRY", customer_full_name: "Ayşe Yılmaz", customer_phone: "05551234567",
    deleted_at: null, confirmation_status: null,
    kolaybi: { contact_id: null, address_id: null, invoice_id: null, status: null, error: null, e_document_status: null },
    confirmation_call: { status: null, bulk_id: null, pressed_key: null, listen_seconds: null, call_count: 0 },
    created_at: now, updated_at: now,
  };
}

function editable(overrides: Record<string, unknown> = {}) {
  return {
    public_id: "ord_2", order_number: "GK-1002", status: "draft", cargo_provider: "ptt", notes: null, currency: "TRY", total_amount: "300.00", items_total: "300.00", manual_total: false,
    customer: { public_id: "cus_1", full_name: "Ayşe Yılmaz", phone: "05551234567" },
    address: { address_line: "Moda Cad. 1", city: "İstanbul", district: "Kadıköy" },
    items: [
      { public_id: "oit_1", product_public_id: null, name: "Kuluçka Makinesi", quantity: 1, unit_price: "200.00", total_amount: "200.00" },
      { public_id: "oit_2", product_public_id: null, name: "Yedek Parça", quantity: 2, unit_price: "50.00", total_amount: "100.00" },
    ],
    locked_reason: null, updated_at: now, ...overrides,
  };
}

function routes() {
  const route: ExtraRoute = ({ method, path, body }) => {
    const match = /^\/api\/orders\/(ord_\d+)\/(actions|edit)$/.exec(path);
    if (match?.[2] === "actions") return { status: 200, body: { order: actionOrder(match[1]!, match[1] === "ord_1" ? "GK-1001" : "GK-1002"), steps: [] } };
    if (path === "/api/orders/ord_2/edit") return { status: 200, body: { order: editable() } };
    if (path === "/api/orders/ord_1/edit") return { status: 200, body: { order: editable({ public_id: "ord_1", order_number: "GK-1001", locked_reason: "kolaybi" }) } };
    if (path === "/api/orders/ord_2" && method === "PATCH") {
      const input = body as { notes: string | null };
      if (input.notes === "fail") return { status: 409, body: { error: { code: "order_locked", message: "Bu sipariş KolayBi'ye aktarılmış, düzenlenemez.", reason: "kolaybi" } } };
      return { status: 200, body: { order: editable({ notes: input.notes }) } };
    }
    return undefined;
  };
  return route;
}

async function openDetail(page: Page, number: string, role = "calisan", viewport: { width: number; height: number } = viewports.desktop) {
  await page.setViewportSize(viewport);
  const state = await mockBackend(page, mockUser(role), { extra: routes() });
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("topbar")).toBeVisible();
  await page.goto("/siparisler");
  const list = viewport.width < 768 ? page.getByTestId("orders-cards") : page.getByTestId("orders-table");
  await list.getByTestId("order-open").filter({ hasText: number }).click();
  return state;
}

test("order edit: staff edit customer, address, lines and save the line total", async ({ page }) => {
  const state = await openDetail(page, "GK-1002");
  const detail = page.getByTestId("order-detail");
  await detail.getByTestId("order-edit-open").click();
  const form = detail.getByTestId("order-edit-form");
  await expect(form.getByTestId("order-edit-name")).toHaveValue("Ayşe Yılmaz");
  await expect(form.getByTestId("order-edit-line")).toHaveCount(2);
  await expect(form.getByTestId("order-edit-total")).toHaveValue("300.00");
  await form.getByTestId("order-edit-name").fill("Ayşe Kaya");
  await form.getByTestId("order-edit-city").fill("Ankara");
  await form.getByTestId("order-edit-district").fill("Çankaya");
  await form.getByTestId("order-edit-cargo").selectOption("surat");
  await form.getByTestId("order-edit-line").nth(1).getByTestId("order-edit-line-remove").click();
  await form.getByTestId("order-edit-line").first().getByTestId("order-edit-line-quantity").fill("2");
  await form.getByTestId("order-edit-add-line").click();
  const added = form.getByTestId("order-edit-line").nth(1);
  await added.getByTestId("order-edit-line-name").fill("Termometre");
  await added.getByTestId("order-edit-line-price").fill("25,5");
  await expect(form.getByTestId("order-edit-total")).toHaveValue("425.50");
  await form.getByTestId("order-edit-notes").fill("Kapıya bırakılacak");
  await form.getByTestId("order-edit-save").click();
  await expect(detail.getByTestId("order-action-message")).toHaveText("Sipariş güncellendi");
  await expect(detail.getByTestId("order-edit-form")).toHaveCount(0);
  expect(state.bodies.find((entry) => entry.method === "PATCH" && entry.path === "/api/orders/ord_2")?.body).toEqual({
    customer: { full_name: "Ayşe Kaya", phone: "05551234567" },
    address: { address_line: "Moda Cad. 1", city: "Ankara", district: "Çankaya" },
    notes: "Kapıya bırakılacak",
    cargo_provider: "surat",
    items: [
      { public_id: "oit_1", product_public_id: null, name: "Kuluçka Makinesi", quantity: 2, unit_price: "200.00" },
      { public_id: null, product_public_id: null, name: "Termometre", quantity: 1, unit_price: "25.50" },
    ],
    total_amount: null,
  });

  await detail.getByTestId("order-edit-open").click();
  await form.getByTestId("order-edit-manual").check();
  await form.getByTestId("order-edit-total").fill("280");
  await form.getByTestId("order-edit-notes").fill("fail");
  await form.getByTestId("order-edit-save").click();
  await expect(form.getByTestId("order-edit-feedback")).toHaveText("Güncelleme hatası: Bu sipariş KolayBi'ye aktarılmış, düzenlenemez.");
  expect((state.bodies.filter((entry) => entry.method === "PATCH").at(-1)?.body as { total_amount: string }).total_amount).toBe("280.00");
});

test("order edit: KolayBi-transferred orders are read-only; validation; mobile layout", async ({ page }) => {
  const state = await openDetail(page, "GK-1001", "kargo_operatoru", viewports.phone390);
  const detail = page.getByTestId("order-detail");
  await detail.getByTestId("order-edit-open").click();
  await expect(detail.getByTestId("order-edit-locked")).toHaveText("Bu sipariş KolayBi'ye aktarılmış, düzenlenemez.");
  await expect(detail.getByTestId("order-edit-save")).toBeDisabled();
  await expect(detail.getByTestId("order-edit-name")).toBeDisabled();
  await expectResponsiveLayout(page, { checkTouchTargets: true });
  await detail.getByTestId("order-edit-cancel").click();
  await expect(detail.getByTestId("order-edit-form")).toHaveCount(0);
  expect(state.bodies.some((entry) => entry.method === "PATCH")).toBe(false);
});

test("order edit: required phone and English labels", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("garanti-beta-lang", "en"));
  await openDetail(page, "GK-1002", "admin");
  const detail = page.getByTestId("order-detail");
  await detail.getByRole("button", { name: "Edit" }).click();
  await detail.getByTestId("order-edit-phone").fill("");
  await detail.getByTestId("order-edit-save").click();
  await expect(detail.getByTestId("order-edit-feedback")).toHaveText("Customer phone is required");
  await expect(detail.getByText("Enter total manually")).toBeVisible();
});
