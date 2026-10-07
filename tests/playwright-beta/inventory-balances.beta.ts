import { expect, test, type Page } from "@playwright/test";
import { expectResponsiveLayout, login, mockBackend, mockUser, pathOf, viewports, type ExtraRoute } from "./helpers";

test.use({ serviceWorkers: "block" });

const now = "2026-10-07T09:00:00.000Z";

function stockRoutes() {
  const products = [
    { public_id: "prd_1", sku: "KM-100", name: "Kuluçka Makinesi 100'lük", category: "incubator", unit_price: "8500.00", stock_quantity: 7, is_active: true, external_product_id: null, unit: "Adet", description: null, updated_at: now },
    { public_id: "prd_2", sku: "KM-50", name: "Kuluçka Makinesi 50'lik", category: "incubator", unit_price: "5200.00", stock_quantity: 2, is_active: true, external_product_id: "kb_p2", unit: "Adet", description: null, updated_at: now },
    { public_id: "prd_3", sku: "YP-1", name: "Nem sensörü", category: "spare_part", unit_price: "350.00", stock_quantity: 0, is_active: true, external_product_id: null, unit: "Adet", description: null, updated_at: now },
  ];
  const route: ExtraRoute = ({ method, path, url, body }) => {
    if (path === "/api/products/kolaybi") {
      return { status: 200, body: { products: [{ id: "7633402", name: "Termostat KolayBi" }], total: 1, synced_at: "2026-10-07T08:00:00.000Z", account_configured: true, live_call_permitted: false, live_gate: "providers.kolaybi.live_mode" } };
    }
    if (path === "/api/products/kolaybi/refresh") return { status: 202, body: { queued: true, live_gate: "providers.kolaybi.live_mode" } };
    if (path === "/api/products/summary") {
      return { status: 200, body: { total_count: 3, active_count: 3, critical_count: 2, critical_threshold: 3, category_counts: { incubator: 2, spare_part: 1, other: 0 } } };
    }
    if (path === "/api/products" && method === "GET") {
      const category = url.searchParams.get("category");
      const search = (url.searchParams.get("search") ?? "").toLocaleLowerCase("tr-TR");
      return { status: 200, body: { data: products.filter((row) => (!category || row.category === category) && (!search || row.name.toLocaleLowerCase("tr-TR").includes(search))) } };
    }
    if (path === "/api/products" && method === "POST") {
      const created = { ...products[0]!, ...(body as object), public_id: "prd_new", updated_at: now };
      products.push(created as never);
      return { status: 201, body: created };
    }
    const match = path.match(/^\/api\/products\/(prd_\w+)(\/stock-movements)?$/);
    if (!match) return undefined;
    const row = products.find((entry) => entry.public_id === match[1])!;
    if (match[2] && method === "GET") {
      return { status: 200, body: { data: [{ public_id: "smv_1", product_public_id: row.public_id, movement_type: "in", quantity: 5, previous_quantity: 2, new_quantity: 7, notes: "Tedarikçi", created_by_user_email: "admin@example.com", created_at: now }] } };
    }
    if (match[2] && method === "POST") {
      const input = body as { movement_type: "in" | "out"; quantity: number };
      const previous = row.stock_quantity;
      row.stock_quantity += input.movement_type === "in" ? input.quantity : -input.quantity;
      return { status: 201, body: { product: row, movement: { public_id: "smv_2", product_public_id: row.public_id, movement_type: input.movement_type, quantity: input.quantity, previous_quantity: previous, new_quantity: row.stock_quantity, notes: null, created_by_user_email: null, created_at: now } } };
    }
    if (method === "PATCH") {
      Object.assign(row, body as object);
      return { status: 200, body: row };
    }
    if (method === "DELETE") {
      row.is_active = false;
      return { status: 200, body: row };
    }
    return undefined;
  };
  return route;
}

function balanceRoutes() {
  let requests = [
    { public_id: "bpr_1", amount: 400, status: "pending", user_public_id: "usr_calisan", user_full_name: "Ayşe Yılmaz", processed_by_user_public_id: null, processed_at: null, note: null, created_at: now },
  ];
  const route: ExtraRoute = ({ method, path, body }, state) => {
    if (path === "/api/balances/summary") {
      const own = state.user.role === "calisan";
      return { status: 200, body: { scope: own ? "own" : "all", balance: own ? 650 : 2150, total_commission: own ? 900 : 3000, total_deduction: own ? 50 : 150, total_payment: own ? 200 : 700, pending_payment: own ? 400 : 400, available_balance: own ? 250 : 1750, pending_request_count: 1 } };
    }
    if (path === "/api/balances/staff") {
      return { status: 200, body: { data: [{ user_public_id: "usr_calisan", first_name: "Ayşe", last_name: "Yılmaz", is_online: true, balance: 650, pending_payment: 400, pending_request_count: 1 }, { user_public_id: "usr_2", first_name: "Mehmet", last_name: "Kaya", is_online: false, balance: 0, pending_payment: 0, pending_request_count: 0 }] } };
    }
    if (path === "/api/balances/staff/usr_calisan/orders") {
      return { status: 200, body: { data: [{ public_id: "ord_9", order_number: "GK-9100", customer_full_name: "Zeynep Ak", customer_phone: null, status: "delivered", total_amount: 1500, currency: "TRY", created_at: now }] } };
    }
    if (path === "/api/balances/staff/usr_calisan/reset" && method === "POST") return { status: 200, body: { previous_balance: 650, message: "ok" } };
    if (path === "/api/balances/movements") {
      return { status: 200, body: { data: [
        { public_id: "bmv_1", kind: "commission", amount: 150, balance_after: 650, description: "Komisyon", user_public_id: "usr_calisan", user_full_name: "Ayşe Yılmaz", order_public_id: "ord_9", order_number: "GK-9100", customer_full_name: "Zeynep Ak", created_at: now },
        { public_id: "bmv_2", kind: "cancellation", amount: -50, balance_after: 500, description: "İptal", user_public_id: "usr_calisan", user_full_name: "Ayşe Yılmaz", order_public_id: "ord_8", order_number: "GK-9099", customer_full_name: null, created_at: now },
      ], total: 2 } };
    }
    if (path === "/api/balances/payment-requests" && method === "GET") return { status: 200, body: { data: requests, total: requests.length } };
    if (path === "/api/balances/payment-requests" && method === "POST") {
      const input = body as { amount: string };
      const created = { ...requests[0]!, public_id: "bpr_new", amount: Number(input.amount), status: "pending" };
      requests = [created, ...requests];
      return { status: 201, body: { request: created, replayed: false, message: "Ödeme isteğiniz admin'e iletildi!" } };
    }
    const decision = path.match(/^\/api\/balances\/payment-requests\/(bpr_\w+)\/(approve|reject)$/);
    if (decision) {
      requests = requests.map((entry) => (entry.public_id === decision[1] ? { ...entry, status: decision[2] === "approve" ? "approved" : "rejected" } : entry));
      return { status: 200, body: { request: requests.find((entry) => entry.public_id === decision[1]), message: decision[2] === "approve" ? "Ödeme onaylandı" : "Ödeme isteği reddedildi" } };
    }
    return undefined;
  };
  return route;
}

async function signIn(page: Page, role: string, viewport: { width: number; height: number } = viewports.desktop) {
  await page.setViewportSize(viewport);
  const stock = stockRoutes();
  const balances = balanceRoutes();
  const state = await mockBackend(page, mockUser(role), { extra: (request, current) => stock(request, current) ?? balances(request, current) });
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("topbar")).toBeVisible();
  return state;
}

test("stock: categories, critical warning, stock in/out, edit, history and delete", async ({ page }) => {
  const state = await signIn(page, "calisan");
  await page.getByTestId("desktop-more-trigger").click();
  await page.getByTestId("more-inventory").click();
  await expect.poll(() => pathOf(page)).toBe("/stok");
  await expect(page.getByTestId("inventory-critical")).toContainText("2 ürün kritik seviyede");
  await expect(page.getByTestId("inventory-category-incubator")).toContainText("2 Ürün");
  await page.getByTestId("inventory-category-incubator").click();
  await expect.poll(() => new URL(page.url()).search).toBe("?category=incubator");
  const table = page.getByTestId("inventory-table");
  await expect(table.getByTestId("inventory-row")).toHaveCount(2);
  await expect(table.getByTestId("inventory-row").nth(1)).toContainText("Kritik");

  const first = table.getByTestId("inventory-row").first();
  await first.getByTestId("inventory-out").click();
  const sheet = page.getByTestId("inventory-sheet");
  await sheet.getByTestId("product-quantity").fill("10");
  await sheet.getByTestId("inventory-submit").click();
  await expect(sheet.getByTestId("inventory-sheet-feedback")).toHaveText("Yetersiz stok! Mevcut: 7, Çıkış: 10");
  await sheet.getByTestId("product-quantity").fill("3");
  await sheet.getByTestId("inventory-submit").click();
  await expect(page.getByTestId("inventory-feedback")).toHaveText("Çıkış: 3 Adet → Yeni stok: 4");
  expect(state.bodies.find((entry) => entry.path === "/api/products/prd_1/stock-movements")?.body).toEqual({ movement_type: "out", quantity: 3 });
  await expect(first.getByTestId("inventory-quantity")).toHaveText("4 Adet");

  await first.getByTestId("inventory-edit").click();
  await sheet.getByTestId("product-price").fill("8750");
  await sheet.getByTestId("inventory-submit").click();
  await expect(page.getByTestId("inventory-feedback")).toHaveText("Stok kartı güncellendi");
  expect(state.bodies.find((entry) => entry.method === "PATCH" && entry.path === "/api/products/prd_1")?.body).toMatchObject({ unit_price: "8750", stock_quantity: 4 });

  await first.getByTestId("inventory-history").click();
  await expect(sheet.getByTestId("inventory-movements")).toContainText("Giriş · 5");
  await page.keyboard.press("Escape");

  page.once("dialog", (dialog) => void dialog.accept());
  await table.getByTestId("inventory-row").nth(1).getByTestId("inventory-delete").click();
  await expect(page.getByTestId("inventory-feedback")).toContainText("silindi");
  await expect(table.getByTestId("inventory-row")).toHaveCount(1);
});

test("stock: create a card in the open category", async ({ page }) => {
  const state = await signIn(page, "admin");
  await page.goto("/stok?category=spare_part");
  await page.getByTestId("inventory-new").click();
  const sheet = page.getByTestId("inventory-sheet");
  await sheet.getByTestId("inventory-submit").click();
  await expect(sheet.getByTestId("inventory-sheet-feedback")).toHaveText("Ürün adı gerekli");
  await sheet.getByTestId("product-name").fill("Termostat");
  await sheet.getByTestId("product-sku").fill("YP-2");
  await expect(sheet.getByTestId("product-kolaybi-info")).toContainText("1 KolayBi ürünü");
  await expect(page.locator("#beta-kolaybi-products option")).toHaveAttribute("value", "7633402");
  await sheet.getByTestId("product-kolaybi-refresh").click();
  await expect(sheet.getByTestId("product-kolaybi-info")).toContainText("Liste isteği kuyruğa alındı");
  await sheet.getByTestId("product-external").fill("7633402");
  await sheet.getByTestId("product-quantity").fill("12");
  await sheet.getByTestId("product-price").fill("275,50");
  await sheet.getByTestId("inventory-submit").click();
  await expect(page.getByTestId("inventory-feedback")).toHaveText("Yeni stok kartı oluşturuldu");
  expect(state.bodies.find((entry) => entry.method === "POST" && entry.path === "/api/products")?.body).toEqual({
    name: "Termostat", sku: "YP-2", external_product_id: "7633402", unit: "Adet", unit_price: "275.50", stock_quantity: 12, description: null, category: "spare_part",
  });
});

test("balances: manager processes requests, resets a balance and opens staff orders", async ({ page }) => {
  const state = await signIn(page, "admin");
  await page.goto("/bakiye");
  await expect(page.getByTestId("page-balances").getByRole("heading", { level: 1 })).toHaveText("Bakiye Yönetimi");
  await expect(page.getByTestId("balance-cards")).toContainText("2.150");
  await expect(page.getByTestId("balance-movements-table").getByTestId("balance-movements-row")).toHaveCount(2);
  await expect(page.getByTestId("balance-movements-table")).toContainText("İptal Kesintisi");

  const staff = page.getByTestId("staff-balances");
  await staff.getByTestId("staff-balance-row").first().getByTestId("staff-detail").click();
  await expect(page.getByTestId("staff-orders")).toContainText("GK-9100");
  await page.keyboard.press("Escape");

  page.once("dialog", (dialog) => void dialog.accept());
  await staff.getByTestId("staff-balance-row").first().getByTestId("staff-reset").click();
  await expect(page.getByTestId("balances-feedback")).toHaveText("Ayşe Yılmaz bakiyesi sıfırlandı (₺650.00)");

  await page.getByTestId("balance-tab-requests").click();
  await page.getByTestId("balance-requests-table").getByTestId("request-approve").click();
  await expect(page.getByTestId("balances-feedback")).toHaveText("Ödeme onaylandı");
  await expect(page.getByTestId("balance-requests-table")).toContainText("Ödeme Yapıldı");
  expect(state.bodies.some((entry) => entry.path === "/api/balances/payment-requests/bpr_1/approve")).toBe(true);
});

test("balances: staff asks for a payment on the phone; English", async ({ page }) => {
  const state = await signIn(page, "calisan", viewports.phone360);
  await page.goto("/bakiye");
  await expect(page.getByTestId("page-balances").getByRole("heading", { level: 1 })).toHaveText("Bakiyem");
  await expect(page.getByTestId("staff-balances")).toHaveCount(0);
  await page.getByTestId("balance-request").click();
  const sheet = page.getByTestId("payment-request-sheet");
  await sheet.getByTestId("payment-request-amount").fill("300");
  await sheet.getByTestId("payment-request-submit").click();
  await expect(sheet.getByTestId("payment-request-feedback")).toHaveText("Geçerli bir tutar girin");
  await sheet.getByTestId("payment-request-amount").fill("200");
  await sheet.getByTestId("payment-request-submit").click();
  await expect(page.getByTestId("balances-feedback")).toHaveText("Ödeme isteğiniz admin'e iletildi!");
  const request = state.bodies.find((entry) => entry.method === "POST" && entry.path === "/api/balances/payment-requests")?.body as { amount: string; idempotency_key: string };
  expect(request.amount).toBe("200.00");
  await expect(page.getByTestId("balance-requests-cards").getByTestId("balance-requests-card")).toHaveCount(2);
  await expectResponsiveLayout(page, { checkTouchTargets: true });

  await page.goto("/stok");
  await expectResponsiveLayout(page, { checkTouchTargets: true });
  await page.evaluate(() => window.localStorage.setItem("garanti-beta-lang", "en"));
  await page.goto("/bakiye");
  await expect(page.getByTestId("balance-tab-movements")).toHaveText("Balance Movements");
});

test("cargo operator has no stock or balance pages", async ({ page }) => {
  await signIn(page, "kargo_operatoru");
  await page.goto("/stok");
  await expect.poll(() => pathOf(page)).toBe("/siparisler");
  await page.goto("/bakiye");
  await expect.poll(() => pathOf(page)).toBe("/siparisler");
});
