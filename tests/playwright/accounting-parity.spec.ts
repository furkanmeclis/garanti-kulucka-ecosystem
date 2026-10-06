import { expect, type Page, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";

// Muhasebe (legacy FaturaListPage / FaturaOlusturPage / CariHesaplarPage): invoices, tahsilat, print/PDF,
// cari accounts and the KolayBi sync panel against a stateful mocked backend.
const backendBaseUrl = "http://127.0.0.1:65528";

test.setTimeout(90_000);

function user(role: string) {
  return { public_id: `usr_${role}`, email: `${role}@example.com`, first_name: "Test", last_name: "Muhasebe", role, permissions: [], is_online: true, sip_username: "1003" };
}

async function startWebApp() {
  const server = await createServer({
    root: "apps/web",
    configFile: "apps/web/vite.config.ts",
    server: { host: "127.0.0.1", port: 0 },
    define: { "import.meta.env.VITE_BACKEND_BASE_URL": JSON.stringify(backendBaseUrl) },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Vite dev server did not expose a TCP address");
  return { url: `http://127.0.0.1:${address.port}`, server };
}

function fallbackResponse(pathname: string): unknown {
  const emptyData = { data: [] };
  if (pathname === "/api/conversations" || pathname === "/api/customers" || pathname === "/api/message-shortcuts") return emptyData;
  if (pathname === "/api/conversations/summary") return { total_count: 0, unread_count: 0, pool_count: 0, human_agent_count: 0, channel_counts: {}, status_counts: {} };
  if (pathname === "/api/customers/summary") return { total_count: 0, with_phone_count: 0, with_email_count: 0, with_notes_count: 0 };
  if (pathname === "/api/comments/moderation-summary") return { manual_queue: 0, automatic_queue: 0, answered: 0, instagram: 0, facebook: 0 };
  if (pathname === "/api/balances/summary") return { total_commission: 0, total_deduction: 0, pending_payment: 0, available_balance: 0, pending_request_count: 0 };
  if (pathname === "/api/orders") return { data: [], meta: { total_count: 0, limit: 20, offset: 0 } };
  if (pathname === "/api/orders/summary") return { total_count: 0, active_count: 0, delivered_count: 0, pending_confirmation_count: 0, total_revenue: 0, currency: "TRY" };
  if (pathname === "/api/products" || pathname === "/api/orders/product-options" || pathname === "/api/shipments") return emptyData;
  if (pathname === "/api/products/summary") return { total_count: 0, active_count: 0, critical_count: 0, critical_threshold: 3, category_counts: { incubator: 0, spare_part: 0, other: 0 } };
  if (pathname === "/api/shipments/summary") return { total_count: 0, active_count: 0, delivered_count: 0, recipient_phone_count: 0, provider_counts: { ptt: 0, surat: 0, other: 0 }, exception_counts: { ptt_not_delivered: 0, surat_not_delivered: 0, tracking_missing: 0 } };
  if (pathname === "/api/shipments/pipeline-summary") return { counts: { all: 0, mesaj: 0, sms: 0, vapi: 0, teslim: 0, bekliyor: 0, isleniyor: 0, hata: 0 }, rows: [] };
  if (pathname === "/api/reports/summary") return { conversation_count: 0, order_count: 0, shipment_count: 0, total_revenue: 0, currency: "TRY", open_conversation_count: 0, pending_confirmation_count: 0, active_shipment_count: 0, delivered_shipment_count: 0, delivered_shipment_rate: 0, confirmation_rate: 0, active_shipment_rate: 0 };
  if (pathname === "/api/webphone/config") return { enabled: false, sip_username: null, sip_password_configured: false, ws_url: null, domain: null, stun: null };
  if (pathname.startsWith("/admin/")) return { data: [], summary: { total_count: 0 } };
  return undefined;
}

const cents = (value: string | number) => Math.round(Number(value) * 100);
const money = (value: number) => (value / 100).toFixed(2);
const sync = (status = "local") => ({ status, error: null, request_id: null, job_id: null });

interface MockContact { public_id: string; contact_type: string; name: string; tax_number: string | null; tax_office: string | null; phone: string | null; email: string | null; address_line: string | null; district: string | null; city: string | null; country: string; notes: string | null; kolaybi_contact_id: string | null; sync: ReturnType<typeof sync>; last_synced_at: null; created_at: string; updated_at: string }

async function mockBackend(page: Page, role = "admin") {
  const now = "2026-10-06T09:00:00.000Z";
  const contact = (index: number, name: string, extra: Partial<MockContact> = {}): MockContact => ({
    public_id: `acc_${index}`, contact_type: "individual", name, tax_number: null, tax_office: null, phone: `05550000${String(index).padStart(3, "0")}`, email: null,
    address_line: null, district: null, city: "Konya", country: "Türkiye", notes: null, kolaybi_contact_id: null, sync: sync(), last_synced_at: null, created_at: now, updated_at: now, ...extra,
  });
  const state = {
    contacts: [contact(1, "Ayşe Yılmaz", { tax_number: "12345678901" }), contact(2, "Zeki Kurumsal A.Ş.", { contact_type: "corporate", tax_number: "1234567890" })],
    invoices: [] as Array<Record<string, unknown> & { public_id: string; contact_public_id: string; grand: number; paid: number; status: string; issue_date: string; items: unknown[]; payments: unknown[]; invoice_number: string; subtotal: number; vat: number }>,
    requests: [] as Array<{ method: string; path: string; search: string; body: unknown }>,
    sequence: 0,
  };
  const contactView = (row: MockContact) => {
    const invoices = state.invoices.filter((invoice) => invoice.contact_public_id === row.public_id && invoice.status !== "cancelled");
    return { ...row, invoice_count: invoices.length, open_balance: money(invoices.reduce((sum, invoice) => sum + invoice.grand - invoice.paid, 0)) };
  };
  const invoiceView = (invoice: (typeof state.invoices)[number]) => {
    const owner = state.contacts.find((row) => row.public_id === invoice.contact_public_id)!;
    return {
      public_id: invoice.public_id, invoice_number: invoice.invoice_number, invoice_type: "sale", status: invoice.status, currency: "TRY", issue_date: invoice.issue_date, due_date: null, description: null,
      subtotal: money(invoice.subtotal), vat_total: money(invoice.vat), grand_total: money(invoice.grand), paid_total: money(invoice.paid), open_amount: money(invoice.status === "cancelled" ? 0 : invoice.grand - invoice.paid),
      contact: { public_id: owner.public_id, name: owner.name }, order: null, kolaybi_invoice_id: null, e_document_status: null, sync: sync(), created_at: now, updated_at: now,
    };
  };
  const detailView = (invoice: (typeof state.invoices)[number]) => ({ ...invoiceView(invoice), contact: contactView(state.contacts.find((row) => row.public_id === invoice.contact_public_id)!), items: invoice.items, payments: invoice.payments });

  await page.addInitScript(`window.__GARANTI_REALTIME_SOCKET_FACTORY__ = () => ({ connect() {}, disconnect() {}, emit() {}, on() {}, off() {} });`);
  await page.route(`${backendBaseUrl}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postData() ? (JSON.parse(request.postData() ?? "{}") as Record<string, unknown>) : undefined;
    state.requests.push({ method, path: url.pathname, search: url.search, body });
    const json = (status: number, payload: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });

    if (url.pathname === "/auth/login") return json(200, { access_token: "acct-token", refresh_token: "acct-refresh", token_type: "Bearer", expires_in: 900, user: user(role) });
    if (url.pathname === "/auth/me") return json(200, user(role));
    if (url.pathname.startsWith("/api/accounting") && role !== "admin") return json(403, { error: { code: "forbidden", message: "Muhasebe yalnızca yöneticiye açıktır" } });

    if (url.pathname === "/api/accounting/contacts" && method === "GET") {
      const search = (url.searchParams.get("search") ?? "").toLocaleLowerCase("tr-TR");
      const rows = state.contacts.filter((row) => !search || `${row.name} ${row.tax_number ?? ""}`.toLocaleLowerCase("tr-TR").includes(search));
      return json(200, { data: rows.map(contactView), meta: { total_count: rows.length, limit: 20, offset: 0 } });
    }
    if (url.pathname === "/api/accounting/contacts" && method === "POST") {
      const created = contact(state.contacts.length + 1, String(body?.name), { ...(body as Partial<MockContact>) });
      state.contacts.push(created);
      return json(201, contactView(created));
    }
    const contactMatch = /^\/api\/accounting\/contacts\/([^/]+)$/.exec(url.pathname);
    if (contactMatch && method === "PATCH") {
      const index = state.contacts.findIndex((row) => row.public_id === contactMatch[1]);
      state.contacts[index] = { ...state.contacts[index]!, ...(body as Partial<MockContact>) };
      return json(200, contactView(state.contacts[index]!));
    }
    if (url.pathname === "/api/accounting/invoices" && method === "GET") {
      const status = url.searchParams.get("status");
      const rows = state.invoices.filter((invoice) => !status || (status === "open" ? ["issued", "partially_paid"].includes(invoice.status) : invoice.status === status));
      const active = rows.filter((invoice) => invoice.status !== "cancelled");
      return json(200, {
        data: rows.map(invoiceView),
        meta: { total_count: rows.length, limit: 20, offset: 0 },
        totals: { grand_total: money(active.reduce((sum, row) => sum + row.grand, 0)), paid_total: money(active.reduce((sum, row) => sum + row.paid, 0)), open_total: money(active.reduce((sum, row) => sum + row.grand - row.paid, 0)) },
      });
    }
    if (url.pathname === "/api/accounting/invoices" && method === "POST") {
      const items = (body?.items as Array<{ description: string; quantity: number; unit_price: string; vat_rate: number }>).map((item, index) => {
        const subtotal = Math.round(cents(item.unit_price) * item.quantity);
        const vat = Math.round((subtotal * item.vat_rate) / 100);
        return { public_id: `ini_${index}`, description: item.description, quantity: String(item.quantity), unit: "Adet", unit_price: item.unit_price, vat_rate: String(item.vat_rate), line_subtotal: money(subtotal), line_vat: money(vat), line_total: money(subtotal + vat), product_public_id: null, _subtotal: subtotal, _vat: vat };
      });
      state.sequence += 1;
      const subtotal = items.reduce((sum, item) => sum + item._subtotal, 0);
      const vat = items.reduce((sum, item) => sum + item._vat, 0);
      const invoice = { public_id: `inv_${state.sequence}`, invoice_number: `GK2026${String(state.sequence).padStart(6, "0")}`, contact_public_id: String(body?.contact_public_id), issue_date: String(body?.issue_date), status: "issued", subtotal, vat, grand: subtotal + vat, paid: 0, items, payments: [] as unknown[] };
      state.invoices.unshift(invoice);
      return json(201, { ...detailView(invoice), replayed: false });
    }
    const invoiceMatch = /^\/api\/accounting\/invoices\/([^/]+)(\/[a-z]+)?$/.exec(url.pathname);
    if (invoiceMatch) {
      const invoice = state.invoices.find((row) => row.public_id === invoiceMatch[1]);
      if (!invoice) return json(404, { error: { code: "not_found", message: "Fatura bulunamadı" } });
      if (invoiceMatch[2] === "/document") {
        if (url.searchParams.get("format") === "pdf") return route.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4\n%%EOF\n" });
        return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: `<!doctype html><html><body><main data-testid="invoice-document">FATURA ${invoice.invoice_number}</main></body></html>` });
      }
      if (invoiceMatch[2] === "/payments") {
        const amount = cents(String(body?.amount));
        if (amount > invoice.grand - invoice.paid) return json(422, { error: { code: "overpayment", message: `Tahsilat kalan tutarı (${money(invoice.grand - invoice.paid)}) aşıyor` } });
        invoice.paid += amount;
        invoice.status = invoice.paid >= invoice.grand ? "paid" : "partially_paid";
        const payment = { public_id: `pay_${invoice.payments.length + 1}`, amount: money(amount), method: body?.method, vault_id: body?.vault_id ?? null, paid_at: now, notes: null, sync: sync(), created_at: now };
        invoice.payments.push(payment);
        return json(201, { invoice: detailView(invoice), payment, replayed: false });
      }
      if (invoiceMatch[2] === "/cancel") {
        invoice.status = "cancelled";
        return json(200, detailView(invoice));
      }
      return json(200, detailView(invoice));
    }
    if (url.pathname === "/api/accounting/kolaybi/status") {
      return json(200, {
        account: { public_id: "iac_kolaybi", display_name: "KolayBi Ana Hesap", status: "active" }, provider_live_mode: false, account_live_mode: null, live_call_permitted: false, live_gate: "providers.kolaybi.live_mode",
        counts: { contact: { local: state.contacts.length, queued: 0, synced: 0, failed: 0 }, invoice: { local: state.invoices.length, queued: 0, synced: 0, failed: 0 }, payment: { local: 0, queued: 0, synced: 0, failed: 0 } },
      });
    }
    if (url.pathname === "/api/accounting/kolaybi/sync") {
      return json(202, { provider: "kolaybi", live_call_permitted: false, live_gate: "providers.kolaybi.live_mode", account_public_id: "iac_kolaybi", requested_count: state.contacts.length, queued_count: state.contacts.length, results: [] });
    }
    const fallback = fallbackResponse(url.pathname);
    if (fallback !== undefined) return json(200, fallback);
    return json(404, { error: { code: "not_found", message: "not mocked" } });
  });
  return state;
}

async function loginAt(page: Page, url: string) {
  await page.goto(url);
  await page.locator('input[type="email"]').fill("admin@example.com");
  await page.locator('input[type="password"]').fill("secret-password");
  await Promise.all([page.waitForResponse(`${backendBaseUrl}/auth/login`), page.locator('button[type="submit"]').click()]);
}

test.describe("muhasebe pages", () => {
  let app: Awaited<ReturnType<typeof startWebApp>>;

  test.beforeAll(async () => {
    app = await startWebApp();
  });

  test.afterAll(async () => {
    await (app.server as ViteDevServer).close();
  });

  test("cari hesaplar: list, search, create, edit and KolayBi sync in dry-run", async ({ page }) => {
    const state = await mockBackend(page);
    await loginAt(page, `${app.url}/cari-hesaplar`);
    await expect(page.getByTestId("accounts-page")).toBeVisible();
    await expect(page.getByTestId("account-row")).toHaveCount(2);
    await expect(page.getByTestId("kolaybi-live-state")).toHaveText("Canlı KolayBi kapalı — istekler kuru çalıştırılır");
    await expect(page.getByTestId("kolaybi-pending")).toContainText("Cari 2");

    await page.getByTestId("account-search").fill("zeki");
    await page.getByTestId("account-search").press("Enter");
    await expect(page.getByTestId("account-row")).toHaveCount(1);
    await expect.poll(() => state.requests.filter((request) => request.path === "/api/accounting/contacts").at(-1)?.search).toContain("search=zeki");

    await page.getByTestId("account-new").click();
    const form = page.getByTestId("account-form");
    await form.locator('select[name="contact_type"]').selectOption("corporate");
    await form.locator('input[name="name"]').fill("Yeni Bayi Ltd.");
    await form.locator('input[name="tax_number"]').fill("9876543210");
    await form.locator('input[name="city"]').fill("Ankara");
    await page.getByTestId("account-save").click();
    await expect(page.getByTestId("acct-notice")).toContainText("Cari hesap kaydedildi.");
    expect(state.requests.find((request) => request.method === "POST" && request.path === "/api/accounting/contacts")?.body).toMatchObject({
      contact_type: "corporate",
      name: "Yeni Bayi Ltd.",
      tax_number: "9876543210",
      city: "Ankara",
      email: null,
    });

    await page.getByTestId("account-search").fill("");
    await page.getByTestId("account-search").press("Enter");
    await page.getByRole("button", { name: "Düzenle Ayşe Yılmaz" }).click();
    await page.getByTestId("account-form").locator('input[name="phone"]').fill("05551112233");
    await page.getByTestId("account-save").click();
    await expect(page.getByTestId("acct-notice")).toContainText("Cari hesap kaydedildi.");
    expect(state.requests.find((request) => request.method === "PATCH")?.path).toBe("/api/accounting/contacts/acc_1");

    await page.getByTestId("kolaybi-sync").click();
    await expect(page.getByTestId("kolaybi-message")).toHaveText("3/3 kayıt kuyruğa alındı.");
    expect(state.requests.find((request) => request.path === "/api/accounting/kolaybi/sync")?.body).toMatchObject({ idempotency_key: expect.stringMatching(/^kolaybi-sync:/) });
  });

  test("faturalar: create with live totals, collect, print and PDF, filter", async ({ page, context }) => {
    const state = await mockBackend(page);
    await loginAt(page, `${app.url}/faturalar`);
    await expect(page.getByTestId("invoices-page")).toBeVisible();
    await expect(page.getByText("Kayıt bulunamadı.")).toBeVisible();

    await page.getByTestId("invoice-new").click();
    const create = page.getByTestId("invoice-create");
    await create.getByTestId("invoice-contact").selectOption("acc_1");
    await create.locator('input[name="item-0-description"]').fill("Kuluçka Makinesi 48'lik");
    await create.locator('input[name="item-0-quantity"]').fill("2");
    await create.locator('input[name="item-0-price"]').fill("2125");
    await page.getByTestId("invoice-add-item").click();
    await create.locator('input[name="item-1-description"]').fill("Termostat");
    await create.locator('input[name="item-1-quantity"]').fill("1,5");
    await create.locator('input[name="item-1-price"]').fill("99,99");
    await create.locator('select[name="item-1-vat"]').selectOption("10");
    await expect(page.getByTestId("invoice-draft-total")).toHaveText("₺5.264,99");
    await page.getByTestId("invoice-save").click();

    await expect(page.getByTestId("acct-notice")).toContainText("GK2026000001 numaralı fatura oluşturuldu.");
    const created = state.requests.find((request) => request.method === "POST" && request.path === "/api/accounting/invoices")?.body as Record<string, unknown>;
    expect(created).toMatchObject({
      contact_public_id: "acc_1",
      items: [
        { description: "Kuluçka Makinesi 48'lik", quantity: 2, unit_price: "2125.00", vat_rate: 20 },
        { description: "Termostat", quantity: 1.5, unit_price: "99.99", vat_rate: 10 },
      ],
    });
    expect(String(created.idempotency_key)).toMatch(/^invoice:/);
    await expect(page.getByTestId("invoice-detail-total")).toHaveText("₺5.264,99");

    await page.getByTestId("invoice-collect").click();
    await page.getByTestId("payment-amount").fill("9999");
    await page.getByTestId("payment-save").click();
    await expect(page.getByTestId("payment-error")).toContainText("Tahsilat kalan tutarı (5264.99) aşıyor");
    await page.getByTestId("payment-amount").fill("1000");
    await page.getByTestId("payment-method").selectOption("cash");
    await page.getByTestId("payment-vault").fill("3");
    await page.getByTestId("payment-save").click();
    await expect(page.getByTestId("acct-notice")).toContainText("Tahsilat kaydedildi.");
    await expect(page.getByTestId("invoice-detail-open")).toHaveText("₺4.264,99");
    await expect(page.getByTestId("invoice-payments")).toContainText("Nakit");
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("invoice-row")).toHaveCount(1);
    await expect(page.getByTestId("invoice-row").first()).toContainText("Kısmen tahsil edildi");
    await expect(page.getByTestId("invoice-open-total")).toHaveText("₺4.264,99");

    const [popup] = await Promise.all([context.waitForEvent("page"), page.getByTestId("invoice-print").first().click()]);
    await expect(popup.getByTestId("invoice-document")).toContainText("GK2026000001");
    await popup.close();
    const [pdfPopup] = await Promise.all([context.waitForEvent("page"), page.getByTestId("invoice-pdf").first().click()]);
    await pdfPopup.close();
    expect(state.requests.filter((request) => request.path.endsWith("/document")).map((request) => request.search)).toEqual(["?format=html", "?format=pdf"]);

    await page.getByTestId("invoice-status-filter").selectOption("paid");
    await expect(page.getByText("Kayıt bulunamadı.")).toBeVisible();
    await page.getByTestId("invoice-from").fill("2026-10-01");
    await expect.poll(() => state.requests.filter((request) => request.path === "/api/accounting/invoices" && request.method === "GET").at(-1)?.search).toContain("issued_from=2026-10-01");
    expect(state.requests.filter((request) => request.path === "/api/accounting/invoices" && request.method === "GET").at(-1)?.search).toContain("status=paid");
  });

  test("renders in English and fits a 360px phone", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await mockBackend(page);
    await page.addInitScript(() => window.localStorage.setItem("garanti-lang", "en"));
    await loginAt(page, `${app.url}/faturalar`);
    await expect(page.getByTestId("invoices-page")).toContainText("Invoices");
    await expect(page.getByTestId("kolaybi-live-state")).toHaveText("Live KolayBi disabled — requests run as dry runs");
    let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await page.goto(`${app.url}/cari-hesaplar`);
    await expect(page.getByTestId("account-row").first()).toContainText("Ayşe Yılmaz");
    overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.getByTestId("account-new").click();
    overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("staff cannot reach the muhasebe pages", async ({ page }) => {
    await mockBackend(page, "calisan");
    await loginAt(page, `${app.url}/faturalar`);
    await expect(page).not.toHaveURL(/\/faturalar$/);
    await expect(page.getByTestId("app-nav")).not.toContainText("Faturalar");
    await expect(page.getByTestId("app-nav")).not.toContainText("Cari Hesaplar");
  });
});
