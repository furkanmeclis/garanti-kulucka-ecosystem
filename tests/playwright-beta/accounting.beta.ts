import { expect, test, type Page } from "@playwright/test";
import { expectResponsiveLayout, login, mockBackend, mockUser, pathOf, viewports, type ExtraRoute } from "./helpers";

test.use({ serviceWorkers: "block" });

const now = "2026-10-07T09:00:00.000Z";
const sync = (status: string, error: string | null = null) => ({ status, error, request_id: null, job_id: null });

function accountingRoutes() {
  const contacts = [
    { public_id: "acc_1", contact_type: "corporate", name: "Kuluçka Tarım Ltd.", tax_number: "1234567890", tax_office: "Konya", phone: "03320000000", email: null, address_line: "Organize Sanayi", district: "Selçuklu", city: "Konya", country: "TR", notes: null, kolaybi_contact_id: "kb_c1", sync: sync("synced"), last_synced_at: now, invoice_count: 2, open_balance: "600.00", created_at: now, updated_at: now },
    { public_id: "acc_2", contact_type: "individual", name: "Ayşe Yılmaz", tax_number: null, tax_office: null, phone: "05551112233", email: "ayse@example.com", address_line: null, district: null, city: "İzmir", country: "TR", notes: null, kolaybi_contact_id: null, sync: sync("failed", "Vergi dairesi eksik"), last_synced_at: null, invoice_count: 0, open_balance: "0.00", created_at: now, updated_at: now },
  ];
  const invoice = (publicId: string, number: string, status: string, grand: string, paid: string, contact = contacts[0]!) => ({
    public_id: publicId, invoice_number: number, invoice_type: "sale", status, currency: "TRY", issue_date: "2026-10-05", due_date: null, description: null,
    subtotal: (Number(grand) / 1.2).toFixed(2), vat_total: (Number(grand) - Number(grand) / 1.2).toFixed(2), grand_total: grand, paid_total: paid, open_amount: (Number(grand) - Number(paid)).toFixed(2),
    contact: { public_id: contact.public_id, name: contact.name }, order: null, kolaybi_invoice_id: null, e_document_status: null, sync: sync("local"), created_at: now, updated_at: now,
  });
  let invoices = [invoice("inv_1", "GK2026000001", "issued", "600.00", "0.00"), invoice("inv_2", "GK2026000002", "paid", "1200.00", "1200.00")];
  const payments: Record<string, unknown[]> = { inv_1: [], inv_2: [{ public_id: "pay_1", amount: "1200.00", method: "bank_transfer", vault_id: null, paid_at: now, notes: null, sync: sync("synced"), created_at: now }] };
  const detail = (row: (typeof invoices)[number]) => ({
    ...row,
    contact: contacts.find((entry) => entry.public_id === row.contact.public_id),
    items: [{ public_id: `itm_${row.public_id}`, description: "Kuluçka makinesi yedek motor", quantity: "1.000", unit: "Adet", unit_price: row.subtotal, vat_rate: "20.00", line_subtotal: row.subtotal, line_vat: row.vat_total, line_total: row.grand_total, product_public_id: null }],
    payments: payments[row.public_id] ?? [],
  });
  const route: ExtraRoute = ({ method, path, url, body }) => {
    if (!path.startsWith("/api/accounting/")) return undefined;
    if (path === "/api/accounting/kolaybi/status") {
      return { status: 200, body: { account: { public_id: "iac_kb", display_name: "KolayBi Ana", status: "active" }, provider_live_mode: false, account_live_mode: null, live_call_permitted: false, live_gate: "providers.kolaybi.live_mode", counts: { contact: { local: 0, queued: 0, synced: 1, failed: 1 }, invoice: { local: 2, queued: 0, synced: 0, failed: 0 }, payment: { local: 0, queued: 0, synced: 1, failed: 0 } } } };
    }
    if (path === "/api/accounting/kolaybi/sync") return { status: 200, body: { provider: "kolaybi", live_call_permitted: false, live_gate: "providers.kolaybi.live_mode", account_public_id: "iac_kb", requested_count: 3, queued_count: 3, results: [] } };
    if (path === "/api/accounting/contacts" && method === "GET") {
      const search = (url.searchParams.get("search") ?? "").toLocaleLowerCase("tr-TR");
      const data = contacts.filter((row) => !search || row.name.toLocaleLowerCase("tr-TR").includes(search));
      return { status: 200, body: { data, meta: { total_count: data.length, limit: 20, offset: 0 } } };
    }
    if (path === "/api/accounting/contacts" && method === "POST") {
      const created = { ...contacts[1]!, ...(body as object), public_id: "acc_new", sync: sync("local"), invoice_count: 0, open_balance: "0.00" };
      contacts.push(created as never);
      return { status: 201, body: created };
    }
    const contactMatch = path.match(/^\/api\/accounting\/contacts\/(acc_\w+)$/);
    if (contactMatch && method === "PATCH") {
      const row = contacts.find((entry) => entry.public_id === contactMatch[1])!;
      Object.assign(row, body as object);
      return { status: 200, body: row };
    }
    if (path === "/api/accounting/invoices" && method === "GET") {
      const status = url.searchParams.get("status");
      const data = invoices.filter((row) => !status || (status === "open" ? Number(row.open_amount) > 0 && row.status !== "cancelled" : row.status === status));
      return { status: 200, body: { data, meta: { total_count: data.length, limit: 20, offset: 0 }, totals: { grand_total: "1800.00", paid_total: "1200.00", open_total: "600.00" } } };
    }
    if (path === "/api/accounting/invoices" && method === "POST") {
      const input = body as { contact_public_id: string; items: Array<{ quantity: number; unit_price: string; vat_rate: number }> };
      const net = input.items.reduce((sum, item) => sum + item.quantity * Number(item.unit_price), 0);
      const created = invoice("inv_new", "GK2026000003", "issued", (net * 1.2).toFixed(2), "0.00", contacts.find((entry) => entry.public_id === input.contact_public_id)!);
      invoices = [created, ...invoices];
      return { status: 201, body: { ...detail(created), replayed: false } };
    }
    const match = path.match(/^\/api\/accounting\/invoices\/(inv_\w+)(\/\w+)?$/);
    if (!match) return undefined;
    const row = invoices.find((entry) => entry.public_id === match[1]);
    if (!row) return { status: 404, body: { error: { code: "not_found", message: "Invoice not found" } } };
    if (!match[2]) return { status: 200, body: detail(row) };
    if (match[2] === "/payments") {
      const input = body as { amount: string; method: string };
      row.paid_total = (Number(row.paid_total) + Number(input.amount)).toFixed(2);
      row.open_amount = (Number(row.grand_total) - Number(row.paid_total)).toFixed(2);
      row.status = Number(row.open_amount) <= 0 ? "paid" : "partially_paid";
      payments[row.public_id] = [...(payments[row.public_id] ?? []), { public_id: "pay_new", amount: input.amount, method: input.method, vault_id: null, paid_at: now, notes: null, sync: sync("local"), created_at: now }];
      return { status: 201, body: { invoice: detail(row), payment: {}, replayed: false } };
    }
    if (match[2] === "/cancel") {
      row.status = "cancelled";
      return { status: 200, body: detail(row) };
    }
    return undefined;
  };
  return route;
}

async function signIn(page: Page, viewport: { width: number; height: number } = viewports.desktop, role = "admin") {
  await page.setViewportSize(viewport);
  const state = await mockBackend(page, mockUser(role), { extra: accountingRoutes() });
  // PDF downloads are binary; answer them before the JSON mocks.
  await page.route("**/api/accounting/invoices/*/document*", (route) =>
    route.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Content-Disposition", "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="GK2026000001.pdf"' }, body: "%PDF-1.4\n%%EOF\n" }),
  );
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("topbar")).toBeVisible();
  return state;
}

test("invoices: totals, KolayBi panel, detail with PDF, payment and cancel", async ({ page }) => {
  const state = await signIn(page);
  await page.getByTestId("desktop-more-trigger").click();
  await page.getByTestId("more-invoices").click();
  await expect.poll(() => pathOf(page)).toBe("/faturalar");
  await expect(page.getByTestId("invoice-totals")).toContainText("1.800");
  await expect(page.getByTestId("kolaybi-live")).toHaveText("Canlı KolayBi kapalı — istekler kuru çalıştırılır");
  await expect(page.getByTestId("kolaybi-counts")).toContainText("Fatura 2");
  await page.getByTestId("kolaybi-sync").click();
  await expect(page.getByTestId("kolaybi-feedback")).toHaveText("3/3 kayıt kuyruğa alındı.");

  const table = page.getByTestId("invoices-table");
  await expect(table.getByTestId("invoices-row")).toHaveCount(2);
  await page.getByTestId("filter-status").click();
  await page.getByRole("option", { name: "Açık (tahsil edilmemiş)" }).click();
  await expect(table.getByTestId("invoices-row")).toHaveCount(1);

  await table.getByTestId("invoice-open").first().click();
  const detail = page.getByTestId("invoice-detail");
  await expect(detail.getByTestId("invoice-items")).toContainText("Kuluçka makinesi yedek motor");
  await expect(detail.getByTestId("invoice-grand-total")).toContainText("600");
  const download = page.waitForEvent("download");
  await detail.getByTestId("invoice-pdf").click();
  expect((await download).suggestedFilename()).toBe("GK2026000001.pdf");

  await detail.getByTestId("payment-amount").fill("250");
  await detail.getByTestId("payment-method").selectOption("bank_transfer");
  await detail.getByTestId("payment-submit").click();
  await expect(detail.getByTestId("invoice-feedback")).toHaveText("Tahsilat kaydedildi.");
  await expect(detail.getByTestId("invoice-open-amount")).toContainText("350");
  const payment = state.bodies.find((entry) => entry.path === "/api/accounting/invoices/inv_1/payments")?.body as { amount: string; method: string; idempotency_key: string };
  expect(payment).toMatchObject({ amount: "250", method: "bank_transfer" });
  expect(payment.idempotency_key).toMatch(/^tahsilat_/);

  page.once("dialog", (dialog) => void dialog.accept());
  await detail.getByTestId("invoice-cancel").click();
  await expect(detail.getByTestId("invoice-feedback")).toHaveText("Fatura iptal edildi.");
});

test("invoices: create with two lines", async ({ page }) => {
  const state = await signIn(page);
  await page.goto("/faturalar");
  await page.getByTestId("invoice-new").click();
  const sheet = page.getByTestId("invoice-create");
  await sheet.getByTestId("invoice-create-submit").click();
  await expect(sheet.getByTestId("invoice-create-feedback")).toHaveText("Cari hesap seçin.");
  await sheet.getByTestId("invoice-contact").selectOption("acc_1");
  await sheet.getByTestId("line-description").first().fill("Viyol");
  await sheet.getByTestId("line-quantity").first().fill("2");
  await sheet.getByTestId("line-price").first().fill("100");
  await sheet.getByTestId("invoice-add-line").click();
  await sheet.getByTestId("line-description").nth(1).fill("Nem sensörü");
  await sheet.getByTestId("line-price").nth(1).fill("50,5");
  await sheet.getByTestId("line-vat").nth(1).selectOption("10");
  await expect(sheet.getByTestId("invoice-create-totals")).toContainText("250,50");
  await sheet.getByTestId("invoice-create-submit").click();
  await expect(page.getByTestId("invoices-feedback")).toHaveText("GK2026000003 numaralı fatura oluşturuldu.");
  await expect(page.getByTestId("invoice-detail")).toBeVisible();
  const created = state.bodies.find((entry) => entry.method === "POST" && entry.path === "/api/accounting/invoices")?.body as Record<string, unknown>;
  expect(created).toMatchObject({
    contact_public_id: "acc_1",
    items: [
      { description: "Viyol", quantity: 2, unit_price: "100", vat_rate: 20 },
      { description: "Nem sensörü", quantity: 1, unit_price: "50.5", vat_rate: 10 },
    ],
  });
});

test("accounts: list, sync error, create and edit", async ({ page }) => {
  const state = await signIn(page);
  await page.goto("/cari-hesaplar");
  const table = page.getByTestId("accounts-table");
  await expect(table.getByTestId("accounts-row")).toHaveCount(2);
  await expect(table.getByTestId("accounts-row").nth(1)).toContainText("Hata");

  await page.getByTestId("account-new").click();
  const sheet = page.getByTestId("account-sheet");
  await sheet.getByTestId("account-save").click();
  await expect(sheet.getByTestId("account-feedback")).toHaveText("Cari adı gerekli.");
  await sheet.getByTestId("account-contact_type").selectOption("corporate");
  await sheet.getByTestId("account-name").fill("Yeni Çiftlik A.Ş.");
  await sheet.getByTestId("account-tax_number").fill("9876543210");
  await sheet.getByTestId("account-city").fill("Ankara");
  await sheet.getByTestId("account-save").click();
  await expect(page.getByTestId("accounts-feedback")).toHaveText("Cari hesap kaydedildi.");
  expect(state.bodies.find((entry) => entry.method === "POST" && entry.path === "/api/accounting/contacts")?.body).toMatchObject({
    contact_type: "corporate",
    name: "Yeni Çiftlik A.Ş.",
    tax_number: "9876543210",
    city: "Ankara",
    phone: null,
  });

  await table.getByTestId("accounts-row").first().getByTestId("account-edit").click();
  await expect(sheet.getByTestId("account-name")).toHaveValue("Kuluçka Tarım Ltd.");
  await sheet.getByTestId("account-phone").fill("03321112233");
  await sheet.getByTestId("account-save").click();
  await expect(page.getByTestId("accounts-feedback")).toHaveText("Cari hesap kaydedildi.");
  expect(state.bodies.find((entry) => entry.method === "PATCH" && entry.path === "/api/accounting/contacts/acc_1")?.body).toMatchObject({ phone: "03321112233" });
});

test("accounting pages: phone layout, English and staff without access", async ({ page }) => {
  await signIn(page, viewports.phone360);
  await page.goto("/faturalar");
  await expect(page.getByTestId("invoices-cards").getByTestId("invoices-card")).toHaveCount(2);
  await expectResponsiveLayout(page, { checkTouchTargets: true });
  await page.goto("/cari-hesaplar");
  await expect(page.getByTestId("accounts-cards").getByTestId("accounts-card")).toHaveCount(2);
  await expectResponsiveLayout(page, { checkTouchTargets: true });
  await page.evaluate(() => window.localStorage.setItem("garanti-beta-lang", "en"));
  await page.reload();
  await expect(page.getByTestId("page-accounts").getByRole("heading", { level: 1 })).toHaveText("Accounts");
});

test("staff cannot open accounting pages", async ({ page }) => {
  await signIn(page, viewports.desktop, "calisan");
  await page.getByTestId("desktop-more-trigger").click();
  await expect(page.getByTestId("more-invoices")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto("/faturalar");
  await expect.poll(() => pathOf(page)).toBe("/");
});
