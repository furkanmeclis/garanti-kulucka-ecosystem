import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { expectResponsiveLayout, login, mockBackend, mockUser, viewports, type ExtraRoute } from "./helpers";

test.use({ serviceWorkers: "block" });

const now = "2026-10-07T09:00:00.000Z";

function actionOrder(overrides: Record<string, unknown> = {}) {
  return {
    public_id: "ord_2", order_number: "GK-1002", status: "draft", notes: null, total_amount: "251.00", currency: "TRY", customer_full_name: "Zeynep Kaya", customer_phone: "05551112233",
    deleted_at: null, confirmation_status: null,
    kolaybi: { contact_id: null, address_id: null, invoice_id: null, status: null, error: null, e_document_status: null },
    confirmation_call: { status: null, bulk_id: null, pressed_key: null, listen_seconds: null, call_count: 0 },
    created_at: now, updated_at: now, ...overrides,
  };
}

function routes() {
  let current = actionOrder();
  let createAttempts = 0;
  const route: ExtraRoute = ({ method, path, body }) => {
    if (path === "/api/orders/product-options") {
      return { status: 200, body: { data: [{ public_id: "prd_1", name: "Kuluçka Makinesi 48", unit_price: "4500.00", stock_quantity: 7, external_product_id: "kb_1" }] } };
    }
    if (path === "/api/orders/customer-lookup") {
      return { status: 200, body: { customer: { public_id: "cus_9", full_name: "Ali Veli", phone: "05559998877" }, default_address: { address_line: "Atatürk Cd. 5", city: "Adana", district: "Seyhan", country: "Türkiye" } } };
    }
    if (path === "/api/orders" && method === "POST") {
      createAttempts += 1;
      const input = body as { force_duplicate?: boolean };
      if (!input.force_duplicate) return { status: 409, body: { error: { code: "duplicate_phone_warning", message: "Bu telefonla aktif sipariş var: GK-1001" } } };
      return { status: 201, body: { public_id: "ord_new", order_number: "GK-2001", status: "draft", source: "manual", cargo_provider: "surat", total_amount: "9000.00", currency: "TRY", customer_full_name: "Ali Veli", created_at: now } };
    }
    if (path === "/api/orders/ord_2/actions") return { status: 200, body: { order: current, steps: createAttempts >= 0 && current.kolaybi.status ? [{ public_id: "ops_1", action: "kolaybi_transfer", provider: "kolaybi", operation: "contact.find", attempt: 0, status: "queued", error_message: null, created_at: now }] : [] } };
    if (path === "/api/orders/ord_2/status" && method === "PATCH") {
      current = { ...current, status: (body as { status: string }).status };
      return { status: 200, body: {} };
    }
    if (path === "/api/orders/ord_2/kolaybi/transfer") {
      current = { ...current, kolaybi: { ...current.kolaybi, status: "contact_lookup" } };
      return { status: 202, body: { replayed: false, step: {} } };
    }
    if (path === "/api/orders/ord_2/confirmation") {
      current = { ...current, confirmation_status: (body as { confirmation_status: string }).confirmation_status };
      return { status: 200, body: { order: current } };
    }
    if (path === "/api/orders/ord_2/cancel") {
      current = { ...current, status: "cancelled" };
      return { status: 200, body: { replayed: false, order: current, e_document_cancel: null } };
    }
    if (path === "/api/orders/ord_2/notes") {
      current = { ...current, notes: (body as { notes: string | null }).notes };
      return { status: 200, body: { order: current } };
    }
    if (path === "/api/orders/ord_2/shipment-draft") {
      return { status: 200, body: { order_public_id: "ord_2", order_number: "GK-1002", total_amount: "251.00", currency: "TRY", recipient: { name: "Zeynep Kaya", phone: "05551112233", address: "Kızılay Cd. 1", city: "Ankara", district: null }, items: [{ name: "Yumurta Çevirici", quantity: 1, unit_price: "251.00", total_amount: "251.00" }], existing_shipment: null } };
    }
    if (path === "/api/orders/ord_2/shipments") return { status: 202, body: { provider: "surat", barcode_number: "SRT123", queued: true, live_call_permitted: false, message: "Sürat Kargo barkodu oluşturuldu: SRT123" } };
    if (path === "/api/orders/bulk/confirmation-calls") return { status: 202, body: { requested_count: 2, queued_count: 1, results: [{ order_public_id: "ord_1", queued: true, skipped_reason: null }, { order_public_id: "ord_2", queued: false, skipped_reason: "already_confirmed" }] } };
    if (path === "/api/shipments/bulk-create") return { status: 200, body: { provider: "ptt", created_count: 2, skipped_count: 0, failed_count: 0, message: "2 sipariş PTT Kargo'ya aktarıldı" } };
    return undefined;
  };
  return route;
}

async function signIn(page: Page, role = "admin", viewport: { width: number; height: number } = viewports.desktop) {
  await page.setViewportSize(viewport);
  const state = await mockBackend(page, mockUser(role), { extra: routes() });
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("topbar")).toBeVisible();
  await page.goto("/siparisler");
  await expect(page.getByTestId("page-orders")).toBeVisible();
  return state;
}

test("orders: create with phone lookup, product lines, totals and the duplicate warning", async ({ page }) => {
  const state = await signIn(page);
  await page.getByTestId("order-new").click();
  const form = page.getByTestId("order-form");
  await form.getByTestId("order-form-submit").click();
  await expect(form.getByTestId("order-form-feedback")).toHaveText("Müşteri adı gerekli");
  await form.getByTestId("order-form-phone").fill("0555 999 88 77");
  await form.getByTestId("order-form-phone").blur();
  await expect(form.getByTestId("order-form-name")).toHaveValue("Ali Veli");
  await expect(form.getByTestId("order-form-district")).toHaveValue("Seyhan");
  await form.getByTestId("order-form-submit").click();
  await expect(form.getByTestId("order-form-feedback")).toHaveText("Kargo firması seçimi zorunlu (PTT veya Sürat)");
  await form.getByTestId("order-form-cargo-surat").click();
  await form.getByTestId("order-form-product").selectOption("prd_1");
  await form.getByTestId("order-form-quantity").fill("2");
  await expect(form.getByTestId("order-form-grand-total")).toContainText("9.000");
  await form.getByTestId("order-form-add-item").click();
  await form.getByTestId("order-form-item-name").fill("Termostat");
  await form.getByTestId("order-form-price").nth(1).fill("150,50");
  await expect(form.getByTestId("order-form-grand-total")).toContainText("9.150,5");
  await form.getByTestId("order-form-submit").click();
  await expect(form.getByTestId("order-form-feedback")).toHaveText("Bu telefonla aktif sipariş var: GK-1001");
  await expect(form.getByTestId("order-form-submit")).toHaveText("Uyarıya rağmen oluştur");
  await form.getByTestId("order-form-submit").click();
  await expect(page.getByTestId("orders-feedback")).toHaveText("Sipariş oluşturuldu! (GK-2001)");
  const posts = state.bodies.filter((entry) => entry.method === "POST" && entry.path === "/api/orders");
  expect(posts).toHaveLength(2);
  expect(posts[1]?.body).toMatchObject({
    customer_public_id: "cus_9",
    customer: { full_name: "Ali Veli", phone: "05559998877" },
    address: { address_line: "Atatürk Cd. 5", city: "Adana", district: "Seyhan" },
    cargo_provider: "surat",
    force_duplicate: true,
    items: [
      { product_public_id: "prd_1", name: "Kuluçka Makinesi 48", quantity: 2, unit_price: "4500.00", external_product_id: "kb_1" },
      { product_public_id: null, name: "Termostat", quantity: 1, unit_price: "150.50" },
    ],
  });
});

test("orders: detail actions, manual confirmation, notes, KolayBi and cargo transfer", async ({ page }) => {
  const state = await signIn(page);
  await page.getByTestId("orders-table").getByTestId("order-open").filter({ hasText: "GK-1002" }).click();
  const detail = page.getByTestId("order-detail");
  await expect(detail.getByTestId("order-teyit-badge")).toHaveText("Bekliyor");
  await detail.getByTestId("order-status-confirmed").click();
  await expect(detail.getByTestId("order-action-message")).toContainText("Teyit Edildi");
  expect(state.bodies.find((entry) => entry.path === "/api/orders/ord_2/status")?.body).toEqual({ status: "confirmed" });
  await detail.getByTestId("order-manual-confirm").click();
  await expect(detail.getByTestId("order-teyit-badge")).toHaveText("Teyitli");
  await detail.getByTestId("order-kolaybi-transfer").click();
  await expect(detail.getByTestId("order-kolaybi-badge")).toHaveText("Aktarılıyor...");
  await expect(detail.getByTestId("order-provider-steps")).toContainText("kolaybi.contact.find #1");
  await detail.getByTestId("order-notes-input").fill("Kapıda arayın");
  await detail.getByTestId("order-notes-save").click();
  await expect(detail.getByTestId("order-action-message")).toContainText("Not kaydedildi");

  await detail.getByTestId("order-cargo-surat").click();
  const transfer = detail.getByTestId("order-cargo-transfer");
  await expect(transfer.getByTestId("order-cargo-missing-address")).toBeVisible();
  await transfer.getByTestId("order-cargo-district").fill("Çankaya");
  await transfer.getByTestId("order-cargo-payment").selectOption("odeme_alindi");
  await transfer.getByTestId("order-cargo-create").click();
  await expect(detail.getByTestId("order-action-message")).toHaveText("Sürat Kargo barkodu oluşturuldu: SRT123");
  const shipment = state.bodies.find((entry) => entry.path === "/api/orders/ord_2/shipments")?.body as Record<string, unknown>;
  expect(shipment).toMatchObject({ provider: "surat", payment_status: "odeme_alindi", recipient_district: "Çankaya" });
  expect(shipment.recipient_city).toBeUndefined();

  page.once("dialog", (dialog) => void dialog.accept());
  await detail.getByTestId("order-cancel").click();
  await expect(detail.getByTestId("order-restore")).toBeVisible();
});

test("orders: bulk confirmation, bulk cargo transfer and Excel exports", async ({ page }) => {
  const state = await signIn(page);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("orders-select-all").click();
  await expect(page.getByTestId("orders-bulk-bar")).toContainText("20 seçili");
  await page.getByTestId("orders-table").getByTestId("order-select").nth(0).uncheck();
  await expect(page.getByTestId("orders-bulk-bar")).toContainText("19 seçili");
  await page.getByTestId("orders-bulk-confirmation").click();
  await expect(page.getByTestId("orders-feedback")).toContainText("1");
  const bulk = state.bodies.find((entry) => entry.path === "/api/orders/bulk/confirmation-calls")?.body as { order_public_ids: string[] };
  expect(bulk.order_public_ids).toHaveLength(19);
  expect(bulk.order_public_ids).not.toContain("ord_1");
  await page.getByTestId("orders-bulk-ptt").click();
  await expect(page.getByTestId("orders-feedback")).toHaveText("2 sipariş PTT Kargo'ya aktarıldı");

  await page.getByTestId("orders-table").getByTestId("order-select").nth(1).check();
  await page.getByTestId("orders-export").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("orders-export-phones").click()]);
  expect(download.suggestedFilename()).toMatch(/^siparisler-telefon-\d{4}-\d{2}-\d{2}\.xls$/);
  const content = await readFile((await download.path())!, "utf8");
  expect(content).toContain("<td>İsim</td><td>Telefon</td>");
  expect(content).toContain("<td>Müşteri Uzun Adı Soyadı 2</td><td>05551000002</td>");
  await page.getByTestId("orders-export").click();
  const [filtered] = await Promise.all([page.waitForEvent("download"), page.getByTestId("orders-export-filtered").click()]);
  expect(await readFile((await filtered.path())!, "utf8")).toContain("GK-1045");
});

test("orders: source and date filters reach the API; mobile cards stay touch friendly", async ({ page }) => {
  const state = await signIn(page, "calisan", viewports.phone390);
  await page.getByTestId("filter-source").click();
  await page.getByTestId("filter-source-ai").click();
  await expect.poll(() => state.requests.filter((entry) => entry.path === "/api/orders").at(-1)?.search).toContain("source=ai");
  await page.getByTestId("filter-from").fill("2026-10-01");
  await expect.poll(() => state.requests.filter((entry) => entry.path === "/api/orders").at(-1)?.search).toContain("created_from=2026-10-01");
  await page.getByTestId("filter-source").click();
  await page.getByTestId("filter-source-all").click();
  await expect(page.getByTestId("orders-cards")).toBeVisible();
  await expectResponsiveLayout(page, { checkTouchTargets: true });
});
