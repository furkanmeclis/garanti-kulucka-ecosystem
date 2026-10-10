import { expect, test, type Page } from "@playwright/test";
import { expectResponsiveLayout, login, mockBackend, mockUser, viewports, type ExtraRoute, chooseOption } from "./helpers";

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

const trackedShipment = {
  public_id: "shp_1", provider: "ptt", tracking_number: "TRK123", barcode_number: null, status: "in_transit", recipient_name: "Ayşe Yılmaz", recipient_phone: "05551234567", recipient_city: "İstanbul", recipient_district: "Kadıköy",
  last_event_text: "Dağıtımda", order_number: "GK-1001", customer_full_name: "Ayşe Yılmaz", updated_at: now,
  tracking_events: [
    { public_id: "evt_2", status: "Dağıtımda", description: "Kurye dağıtıma çıktı", location: "Kadıköy", occurred_at: "2026-10-07T08:00:00.000Z" },
    { public_id: "evt_1", status: "Kabul edildi", description: null, location: "İstanbul", occurred_at: "2026-10-06T08:00:00.000Z" },
  ],
};

/** Row-extra routes (Hızlı Mesaj send, KargoTakipModal) on top of the edit/actions routes. */
function rowRoutes(): ExtraRoute {
  const base = routes();
  return (request, state) => {
    const { method, path, body } = request;
    if (path === "/api/shipments/shp_1" && method === "GET") return { status: 200, body: trackedShipment };
    if (path === "/api/shipments/shp_1/track" && method === "POST") return { status: 202, body: { provider: "ptt", operation: "shipments.track", request_id: "req_1", queued: true, live_gate: "queued" } };
    if (/^\/api\/conversations\/cnv_\d+\/messages$/.test(path) && method === "POST") {
      return { status: 201, body: { public_id: "msg_1", sender_type: "user", sender_name: "calisan@example.com", body: (body as { body: string }).body, is_read: true, sent_at: now, attachments: [] } };
    }
    return base(request, state);
  };
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
  await chooseOption(form.getByTestId("order-edit-cargo"), "surat");
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

test("order rows: legacy badges, quick message and the tracking sheet", async ({ page }) => {
  await page.setViewportSize(viewports.desktop);
  const state = await mockBackend(page, mockUser("calisan"), { extra: rowRoutes() });
  Object.assign(state.orders[0]!, {
    conversation_public_id: "cnv_1", confirmation_status: "confirmed", confirmation_call_status: "answered", confirmation_pressed_key: "1", confirmation_call_count: 2,
    kolaybi_status: "done", kolaybi_invoice_id: "inv_9", e_document_status: "sent",
    shipment: { public_id: "shp_1", provider: "ptt", status: "in_transit", tracking_number: "TRK123" },
  });
  // ord_2: no linked conversation, resolved through the customer phone (matches the mocked conversation cnv_3).
  Object.assign(state.orders[1]!, {
    status: "cancelled", conversation_public_id: null, customer_phone: "05550000003", confirmation_call_status: "no_answer", confirmation_pressed_key: "9", confirmation_call_count: 1,
    kolaybi_status: "cancelled", kolaybi_invoice_id: "inv_2", shipment: null,
  });
  await page.goto("/giris");
  await login(page, state);
  await expect(page.getByTestId("topbar")).toBeVisible();
  await page.goto("/siparisler");
  const table = page.getByTestId("orders-table");
  await expect(table.getByTestId("order-badge-confirmation-ord_1")).toHaveText("Teyitli (2)");
  await expect(table.getByTestId("order-badge-kolaybi-ord_1")).toHaveText("Aktarıldı · e-Fatura: Gönderildi");
  await expect(table.getByTestId("order-badge-shipment-ord_1")).toHaveText("PTT · Yolda · TRK123");
  await expect(table.getByTestId("order-badge-confirmation-ord_2")).toHaveText("9'a bastı (1)");
  await expect(table.getByTestId("order-badge-kolaybi-ord_2")).toHaveText("KB iptal");
  await expect(table.getByTestId("order-badge-shipment-ord_2")).toHaveCount(0);

  // Hızlı mesaj on the linked conversation.
  await table.getByTestId("order-quick-message-ord_1").click();
  const sheet = page.getByTestId("order-quick-message");
  await sheet.getByTestId("order-quick-message-text").fill("Kargonuz yola çıktı");
  await sheet.getByTestId("order-quick-message-send").click();
  await expect(sheet.getByTestId("order-quick-message-feedback")).toHaveText("Mesaj kuyruğa alındı");
  const sent = state.bodies.find((entry) => entry.method === "POST" && entry.path === "/api/conversations/cnv_1/messages")?.body;
  expect(sent).toEqual({ sender_type: "user", sender_name: "calisan@example.com", body: "Kargonuz yola çıktı", external_message_id: null, raw_payload: null, attachments: [] });
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // No linked conversation: GET /api/conversations?search=<phone>&limit=1 first.
  await table.getByTestId("order-quick-message-ord_2").click();
  await sheet.getByTestId("order-quick-message-text").fill("Merhaba");
  await sheet.getByTestId("order-quick-message-send").click();
  await expect(sheet.getByTestId("order-quick-message-feedback")).toHaveText("Mesaj kuyruğa alındı");
  expect(state.requests.some((entry) => entry.method === "GET" && entry.path === "/api/conversations" && entry.search.includes("search=05550000003") && entry.search.includes("limit=1"))).toBe(true);
  expect((state.bodies.find((entry) => entry.method === "POST" && entry.path === "/api/conversations/cnv_3/messages")?.body as { body: string }).body).toBe("Merhaba");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // Kargo takip sheet from the order detail.
  await table.getByTestId("order-open").filter({ hasText: "GK-1001" }).click();
  await expect(page.getByTestId("order-detail")).toBeVisible();
  await page.getByTestId("order-tracking-open").click();
  const modal = page.getByTestId("order-tracking-modal");
  await expect(modal.getByTestId("order-tracking-event")).toHaveCount(2);
  await expect(modal.getByTestId("order-tracking-event").first()).toContainText("Dağıtımda");
  await expect(modal.getByTestId("order-tracking-event").first()).toContainText("Kurye dağıtıma çıktı");
  await modal.getByTestId("order-tracking-refresh").click();
  await expect(modal.getByTestId("order-tracking-notice")).toHaveText("Takip sorgusu kuyruğa alındı");
  expect(state.bodies.filter((entry) => entry.method === "POST" && entry.path === "/api/shipments/shp_1/track")).toHaveLength(1);
  // The notice shows before the shipment is re-fetched, so wait for the second GET instead of reading it once.
  await expect.poll(() => state.requests.filter((entry) => entry.method === "GET" && entry.path === "/api/shipments/shp_1").length).toBeGreaterThanOrEqual(2);
});
