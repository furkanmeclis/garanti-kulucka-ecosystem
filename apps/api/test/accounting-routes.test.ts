import type { AppDatabase } from "@garanti-kulucka/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const mocks = vi.hoisted(() => {
  const now = new Date("2026-10-06T09:00:00.000Z");
  const sync = { sync_status: "local", sync_error: null, sync_request_id: null, sync_job_id: null };
  const contact = {
    id: 1,
    public_id: "acc_ayse",
    customer_id: null,
    contact_type: "individual",
    name: "Ayşe Yılmaz",
    tax_number: "12345678901",
    tax_office: null,
    phone: "05551112233",
    email: null,
    address_line: "Atatürk Cd. 1",
    district: "Selçuklu",
    city: "Konya",
    country: "Türkiye",
    notes: null,
    kolaybi_contact_id: null as string | null,
    kolaybi_address_id: null,
    ...sync,
    last_synced_at: null,
    created_by_user_id: 10,
    created_at: now,
    updated_at: now,
  };
  const invoice = {
    id: 5,
    public_id: "inv_1",
    invoice_number: "GK2026000001",
    contact_id: 1,
    order_id: null,
    invoice_type: "sale",
    status: "issued",
    currency: "TRY",
    issue_date: new Date(2026, 9, 6),
    due_date: null,
    description: null,
    subtotal: "100.00",
    vat_total: "20.00",
    grand_total: "120.00",
    paid_total: "0.00",
    kolaybi_invoice_id: null as string | null,
    e_document_status: null,
    ...sync,
    last_synced_at: null,
    idempotency_key: "inv-key",
    cancelled_at: null,
    created_by_user_id: 10,
    created_at: now,
    updated_at: now,
    contact_public_id: "acc_ayse",
    contact_name: "Ayşe Yılmaz",
    order_public_id: null,
    order_number: null,
  };
  const item = {
    id: 9,
    public_id: "ini_1",
    invoice_id: 5,
    product_id: null,
    product_public_id: null,
    description: "Kuluçka Makinesi",
    quantity: "1.000",
    unit: "Adet",
    unit_price: "100.00",
    vat_rate: "20.00",
    line_subtotal: "100.00",
    line_vat: "20.00",
    line_total: "120.00",
    sort_order: 0,
    created_at: now,
    updated_at: now,
  };
  const payment = { id: 3, public_id: "pay_1", invoice_id: 5, amount: "50.00", method: "cash", vault_id: "2", paid_at: now, notes: null, ...sync, idempotency_key: "pay-key", created_by_user_id: 10, created_at: now, updated_at: now };
  const detail = () => ({ invoice: { ...invoice }, contact: { ...contact }, items: [item], payments: [] as unknown[] });
  return {
    contact,
    invoice,
    payment,
    detail,
    roleName: "admin",
    published: [] as Array<{ name: string; payload: { envelope: { operation: string; account_public_id?: string; payload: Record<string, unknown> } } }>,
    authRepository: {
      findUserByPublicId: vi.fn(async () => ({
        id: 10,
        public_id: "usr_test",
        role_id: 1,
        email: "admin@example.com",
        password_hash: "hash",
        first_name: "Test",
        last_name: "Admin",
        phone: null,
        is_active: true,
        is_online: false,
        last_seen_at: null,
        sip_username: null,
        sip_password_encrypted: null,
        created_at: now,
        updated_at: now,
        role_name: mocks.roleName,
      })),
      findSessionByPublicId: vi.fn(async () => ({ id: 100, public_id: "ses_test", user_id: 10, user_agent: null, ip_address: null, expires_at: new Date("2099-01-01"), revoked_at: null, created_at: now, updated_at: now })),
    },
    repository: {
      listContacts: vi.fn(async () => ({ rows: [{ ...contact, invoice_count: 1, open_balance: "120.00" }], total_count: 1 })),
      getContact: vi.fn(async (publicId: string) => (publicId === "acc_ayse" ? { ...contact, invoice_count: 1, open_balance: "120.00" } : null)),
      createContact: vi.fn(async (input: { name: string }) => ({ ...contact, name: input.name })),
      updateContact: vi.fn(async (publicId: string) => (publicId === "acc_ayse" ? contact : null)),
      listInvoices: vi.fn(async () => ({ rows: [invoice], total_count: 1, totals: { grand_total: "120.00", paid_total: "0.00", open_total: "120.00" } })),
      getInvoice: vi.fn(async (publicId: string) => (publicId === "inv_1" ? mocks.detail() : null)),
      createInvoice: vi.fn(async () => ({ detail: mocks.detail(), replayed: false })),
      addPayment: vi.fn(async () => ({ detail: { ...mocks.detail(), invoice: { ...invoice, paid_total: "50.00", status: "partially_paid" } }, payment, replayed: false })),
      cancelInvoice: vi.fn(async () => ({ ...mocks.detail(), invoice: { ...invoice, status: "cancelled" } })),
      invoiceIssuer: vi.fn(async () => ({ name: "Garanti Kuluçka", phone: null, address: null, city: "Konya", district: null })),
      kolaybiReadiness: vi.fn(async (liveGate: string) => ({ account: { public_id: "iac_kolaybi", display_name: "KolayBi", status: "active" }, provider_live_mode: false, account_live_mode: null, live_call_permitted: false, live_gate: liveGate })),
      syncCounts: vi.fn(async () => ({ contact: { local: 1, queued: 0, synced: 0, failed: 0 }, invoice: { local: 1, queued: 0, synced: 0, failed: 0 }, payment: { local: 1, queued: 0, synced: 0, failed: 0 } })),
      queuedRows: vi.fn(async () => ({ contacts: [{ id: 1, sync_request_id: "req_c" }], invoices: [{ id: 5, sync_request_id: "req_i" }], payments: [] })),
      latestAttempt: vi.fn(async (requestId: string) =>
        requestId === "req_c"
          ? { status: "success", response_metadata: { live_call_performed: true, result: { success: true, contact_id: 1001, address_id: 77 } }, error_message: null }
          : { status: "success", response_metadata: { live_call_performed: false, accepted: true }, error_message: null },
      ),
      applySyncResult: vi.fn(async () => undefined),
      pendingSync: vi.fn(async () => ({
        contacts: [contact],
        invoices: [invoice],
        payments: [{ ...payment, kolaybi_invoice_id: null, invoice_public_id: "inv_1" }],
      })),
      markQueued: vi.fn(async () => undefined),
      deletePayment: vi.fn(async (input: { paymentPublicId: string }): Promise<unknown> => ({ detail: mocks.detail(), payment: { ...payment, public_id: input.paymentPublicId, sync_status: "synced" }, kolaybiInvoiceId: "5001" })),
      markEDocumentResend: vi.fn(async (): Promise<string> => "5001"),
      deleteInvoice: vi.fn(async (): Promise<unknown> => ({ invoiceNumber: "GK-F-1", kolaybiInvoiceId: "5001", eDocumentStatus: "sent" })),
    },
  };
});

vi.mock("../src/auth/repository.js", () => ({
  AuthRepository: vi.fn(function AuthRepository() {
    return mocks.authRepository;
  }),
  isAdminRole: (role: string) => role === "admin" || role === "owner",
}));

vi.mock("../src/accounting/repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/accounting/repository.js")>();
  return {
    ...actual,
    AccountingRepository: vi.fn(function AccountingRepository() {
      return mocks.repository;
    }),
  };
});

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { AccountingError } = await import("../src/accounting/repository.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "accounting-route-test-secret",
  encryptionKey: "accounting-route-encryption-key",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

const publisher = {
  publish: vi.fn(async (job: (typeof mocks.published)[number] & { job_id: string }) => {
    mocks.published.push(job);
    return job.job_id;
  }),
};

async function token(role = "admin") {
  mocks.roleName = role;
  return signAccessToken({ user_public_id: "usr_test", session_public_id: "ses_test", role }, config);
}

function app() {
  return createApp({ config, db: {} as AppDatabase, providerDeliveryQueuePublisher: publisher as never });
}

async function call(method: string, path: string, body?: unknown, role = "admin") {
  return app().request(path, {
    method,
    headers: { authorization: `Bearer ${await token(role)}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe("accounting routes (fatura / cari / tahsilat / KolayBi)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.published.length = 0;
  });

  it("is manager-only", async () => {
    for (const role of ["calisan", "kargo_operatoru"]) {
      expect((await call("GET", "/api/accounting/invoices", undefined, role)).status).toBe(403);
      expect((await call("POST", "/api/accounting/contacts", { name: "X" }, role)).status).toBe(403);
    }
    expect((await call("GET", "/api/accounting/contacts", undefined, "owner")).status).toBe(200);
  });

  it("lists, creates and updates cari accounts with validation", async () => {
    const list = await call("GET", "/api/accounting/contacts?search=ayşe&limit=20");
    expect(list.status).toBe(200);
    expect(mocks.repository.listContacts).toHaveBeenCalledWith({ search: "ayşe", syncStatus: undefined, limit: 20, offset: 0 });
    await expect(list.json()).resolves.toMatchObject({ data: [{ public_id: "acc_ayse", open_balance: "120.00", sync: { status: "local" } }], meta: { total_count: 1 } });

    const created = await call("POST", "/api/accounting/contacts", { name: "  Zeki A.Ş. ", contact_type: "corporate", tax_number: "1234567890", email: "" });
    expect(created.status).toBe(201);
    expect(mocks.repository.createContact).toHaveBeenCalledWith(expect.objectContaining({ name: "Zeki A.Ş.", contactType: "corporate", taxNumber: "1234567890", email: null }), 10);

    const badTax = await call("POST", "/api/accounting/contacts", { name: "X", tax_number: "12" });
    expect(badTax.status).toBe(400);
    await expect(badTax.json()).resolves.toMatchObject({ error: { message: "VKN/TCKN 10 veya 11 haneli olmalı" } });
    expect((await call("POST", "/api/accounting/contacts", {})).status).toBe(400);

    expect((await call("PATCH", "/api/accounting/contacts/acc_ayse", { city: "Ankara" })).status).toBe(200);
    expect((await call("PATCH", "/api/accounting/contacts/acc_yok", { city: "Ankara" })).status).toBe(404);
    expect((await call("GET", "/api/accounting/contacts/acc_yok")).status).toBe(404);
  });

  it("filters invoices and returns list totals", async () => {
    const response = await call("GET", "/api/accounting/invoices?status=open&issued_from=2026-10-01&issued_to=2026-10-31&search=GK");
    expect(response.status).toBe(200);
    expect(mocks.repository.listInvoices).toHaveBeenCalledWith(expect.objectContaining({ status: "open", issuedFrom: "2026-10-01", issuedTo: "2026-10-31", search: "GK" }));
    await expect(response.json()).resolves.toMatchObject({
      data: [{ invoice_number: "GK2026000001", issue_date: "2026-10-06", open_amount: "120.00", contact: { name: "Ayşe Yılmaz" } }],
      totals: { open_total: "120.00" },
    });
    expect((await call("GET", "/api/accounting/invoices?issued_from=06.10.2026")).status).toBe(400);
  });

  it("creates invoices with validated lines and maps domain errors", async () => {
    const body = {
      idempotency_key: "inv-key",
      contact_public_id: "acc_ayse",
      issue_date: "2026-10-06",
      items: [{ description: "Kuluçka Makinesi", quantity: 1, unit_price: "100", vat_rate: 20 }],
    };
    const created = await call("POST", "/api/accounting/invoices", body);
    expect(created.status).toBe(201);
    expect(mocks.repository.createInvoice).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "inv-key", issueDate: "2026-10-06", items: [expect.objectContaining({ unitPrice: "100", vatRate: 20, quantity: 1 })] }));

    const noItems = await call("POST", "/api/accounting/invoices", { ...body, items: [] });
    await expect(noItems.json()).resolves.toMatchObject({ error: { message: "En az bir kalem gerekli" } });
    const badDue = await call("POST", "/api/accounting/invoices", { ...body, due_date: "2026-10-01" });
    await expect(badDue.json()).resolves.toMatchObject({ error: { message: "Vade tarihi fatura tarihinden önce olamaz" } });

    mocks.repository.createInvoice.mockRejectedValueOnce(new AccountingError("contact_not_found", "Cari hesap bulunamadı"));
    expect((await call("POST", "/api/accounting/invoices", body)).status).toBe(404);
  });

  it("records tahsilat and rejects overpayment", async () => {
    const response = await call("POST", "/api/accounting/invoices/inv_1/payments", { idempotency_key: "pay-key", amount: 50, method: "cash", vault_id: "2" });
    expect(response.status).toBe(201);
    expect(mocks.repository.addPayment).toHaveBeenCalledWith(expect.objectContaining({ invoicePublicId: "inv_1", amount: "50.00", method: "cash", vaultId: "2" }));
    await expect(response.json()).resolves.toMatchObject({ invoice: { status: "partially_paid", open_amount: "70.00" }, payment: { amount: "50.00" } });

    mocks.repository.addPayment.mockRejectedValueOnce(new AccountingError("overpayment", "Tahsilat kalan tutarı (70.00) aşıyor"));
    const over = await call("POST", "/api/accounting/invoices/inv_1/payments", { idempotency_key: "pay-2", amount: "500" });
    expect(over.status).toBe(422);
    expect((await call("POST", "/api/accounting/invoices/inv_1/payments", { idempotency_key: "pay-3", amount: 0 })).status).toBe(400);

    mocks.repository.cancelInvoice.mockRejectedValueOnce(new AccountingError("has_payments", "Tahsilatı olan fatura iptal edilemez"));
    expect((await call("POST", "/api/accounting/invoices/inv_1/cancel")).status).toBe(409);
  });

  it("renders the invoice as HTML and PDF", async () => {
    const html = await call("GET", "/api/accounting/invoices/inv_1/document");
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toContain("text/html");
    const text = await html.text();
    expect(text).toContain("GK2026000001");
    expect(text).toContain("120,00 TL");
    expect(text).toContain("window.print()");

    const pdf = await call("GET", "/api/accounting/invoices/inv_1/document?format=pdf&download=1");
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toBe('attachment; filename="fatura-GK2026000001.pdf"');
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");

    expect((await call("GET", "/api/accounting/invoices/inv_1/document?format=docx")).status).toBe(400);
    expect((await call("GET", "/api/accounting/invoices/inv_yok/document")).status).toBe(404);
  });

  it("reports KolayBi readiness and folds worker attempts into sync state", async () => {
    const response = await call("GET", "/api/accounting/kolaybi/status");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ live_call_permitted: false, live_gate: "providers.kolaybi.live_mode", counts: { contact: { local: 1 } } });
    expect(mocks.repository.applySyncResult).toHaveBeenCalledWith("contact", 1, { status: "synced", kolaybiId: "1001", kolaybiAddressId: "77" });
    expect(mocks.repository.applySyncResult).toHaveBeenCalledWith("invoice", 5, expect.objectContaining({ status: "failed", error: expect.stringContaining("kuru çalıştırıldı") }));
  });

  it("queues KolayBi sync jobs in dependency order with the active account", async () => {
    const response = await call("POST", "/api/accounting/kolaybi/sync", { idempotency_key: "sync-1" });
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({ live_call_permitted: false, live_gate: "providers.kolaybi.live_mode", account_public_id: "iac_kolaybi", queued_count: 1 });
    expect(body.results).toEqual([
      { target: "contact", public_id: "acc_ayse", operation: "contact.create", queued: true, skipped_reason: null },
      { target: "invoice", public_id: "inv_1", operation: null, queued: false, skipped_reason: "contact_not_synced" },
      { target: "payment", public_id: "pay_1", operation: null, queued: false, skipped_reason: "invoice_not_synced" },
    ]);
    expect(mocks.published).toHaveLength(1);
    expect(mocks.published[0]?.payload.envelope).toMatchObject({
      operation: "contact.create",
      account_public_id: "iac_kolaybi",
      payload: { contact_public_id: "acc_ayse", musteri_ad: "Ayşe Yılmaz", identity_no: "12345678901", city: "Konya", idempotency_key: "sync-1:contact:acc_ayse" },
    });
    expect(mocks.repository.markQueued).toHaveBeenCalledWith("contact", 1, expect.stringMatching(/^req_acct_/), expect.stringMatching(/^job_acct_/));
  });

  it("syncs invoices and tahsilat once their parents carry KolayBi ids", async () => {
    mocks.repository.pendingSync.mockResolvedValueOnce({
      contacts: [],
      invoices: [mocks.invoice],
      payments: [{ ...mocks.payment, kolaybi_invoice_id: "5001", invoice_public_id: "inv_1" }],
    });
    mocks.repository.getInvoice.mockResolvedValueOnce({ ...mocks.detail(), contact: { ...mocks.contact, kolaybi_contact_id: "1001" } });
    const response = await call("POST", "/api/accounting/kolaybi/sync", { idempotency_key: "sync-2" });
    const body = await response.json();
    expect(body.queued_count).toBe(2);
    expect(mocks.published.map((job) => job.payload.envelope.operation)).toEqual(["invoice.create", "invoice.payment.create"]);
    expect(mocks.published[0]?.payload.envelope.payload).toMatchObject({ contact_id: "1001", currency: "try", order_date: "2026-10-06", items: [{ quantity: "1.000", unit_price: "100.00", vat_rate: "20.00" }] });
    expect(mocks.published[1]?.payload.envelope.payload).toMatchObject({ document_id: "5001", vault_id: "2", amount: "50.00" });
  });

  it("deletes a payment and queues the KolayBi tahsilat delete only for synced payments", async () => {
    const response = await call("DELETE", "/api/accounting/invoices/inv_1/payments/pay_1");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ deleted_payment_public_id: "pay_1", kolaybi: { operation: "invoice.payment.delete", queued: true } });
    expect(mocks.repository.deletePayment).toHaveBeenCalledWith({ invoicePublicId: "inv_1", paymentPublicId: "pay_1", actorUserId: 10 });
    expect(mocks.published.at(-1)).toMatchObject({ name: "kolaybi.invoice.payment.delete", payload: { envelope: { payload: { document_id: "5001" } } } });

    mocks.repository.deletePayment.mockResolvedValueOnce({ detail: mocks.detail(), payment: { public_id: "pay_2", amount: "10.00", sync_status: "local" }, kolaybiInvoiceId: "5001" });
    const local = await call("DELETE", "/api/accounting/invoices/inv_1/payments/pay_2");
    await expect(local.json()).resolves.toMatchObject({ kolaybi: null });
    expect((await call("DELETE", "/api/accounting/invoices/inv_1/payments/pay_1", undefined, "calisan")).status).toBe(403);
  });

  it("queues an e-document resend and a combined cancel + delete for KolayBi invoices", async () => {
    const resend = await call("POST", "/api/accounting/invoices/inv_1/e-document/resend");
    expect(resend.status).toBe(202);
    expect(mocks.published.at(-1)).toMatchObject({ name: "kolaybi.invoice.e_document.resend", payload: { envelope: { payload: { document_id: "5001" } } } });

    const removed = await call("DELETE", "/api/accounting/invoices/inv_1");
    expect(removed.status).toBe(200);
    await expect(removed.json()).resolves.toMatchObject({ deleted: true, invoice_number: "GK-F-1", kolaybi: { operation: "invoice.delete", queued: true } });
    const job = mocks.published.at(-1) as unknown as { name: string; payload: { envelope: { payload: Record<string, unknown> } } };
    expect(job.name).toBe("kolaybi.invoice.delete");
    expect(job.payload.envelope.payload).toMatchObject({ document_id: "5001", cancel_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });

    mocks.repository.deleteInvoice.mockResolvedValueOnce({ invoiceNumber: "GK-F-2", kolaybiInvoiceId: null, eDocumentStatus: null });
    const local = await call("DELETE", "/api/accounting/invoices/inv_2");
    await expect(local.json()).resolves.toMatchObject({ deleted: true, kolaybi: null });
  });
});
