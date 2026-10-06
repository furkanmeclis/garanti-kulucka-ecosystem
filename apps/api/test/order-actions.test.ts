import type { AppDatabase } from "@garanti-kulucka/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";
import { planOrderDeleteMovement } from "../src/balances/rules.js";
import {
  contactCreatePayload,
  firstKolaybiStep,
  initialContactCreateVariant,
  invoiceCreatePayload,
  nextContactCreateVariant,
  planNextKolaybiStep,
  type KolaybiWorkflowOrder,
} from "../src/orders/kolaybi-workflow.js";

const workflowOrder: KolaybiWorkflowOrder = {
  orderPublicId: "ord_1",
  orderNumber: "ORD-1",
  createdAt: "2026-10-05T21:30:00.000Z",
  customer: { fullName: "Ahmet Yılmaz PTT", phone: "05551112233", email: null },
  address: { addressLine: "Atatürk Cad. 1", city: "Konya", district: "Selçuklu", country: "Türkiye" },
  items: [{ name: "Kuluçka Makinesi 96", quantity: 2, unitPrice: "1200.00", externalProductId: "77" }],
};

describe("KolayBi cari workflow planner", () => {
  it("starts with contact.find, or invoice.create when a contact is already known", () => {
    expect(firstKolaybiStep(workflowOrder, { contactId: null, addressId: null })).toMatchObject({ kind: "enqueue", operation: "contact.find", orderStatus: "contact_lookup" });
    expect(firstKolaybiStep(workflowOrder, { contactId: "9", addressId: "4" })).toMatchObject({
      kind: "enqueue",
      operation: "invoice.create",
      payload: { contact_id: "9", address_id: "4" },
    });
  });

  it("uses the found contact or falls through to contact.create", () => {
    const found = planNextKolaybiStep(workflowOrder, {
      operation: "contact.find",
      attempt: 0,
      requestPayload: {},
      outcome: { status: "succeeded", result: { found: true, contact: { id: 41, address_id: 8 } } },
    });
    expect(found).toMatchObject({ kind: "enqueue", operation: "invoice.create", payload: { contact_id: "41", address_id: "8" } });

    const missing = planNextKolaybiStep(workflowOrder, {
      operation: "contact.find",
      attempt: 0,
      requestPayload: {},
      outcome: { status: "succeeded", result: { found: false, contact: null } },
    });
    expect(missing).toMatchObject({ kind: "enqueue", operation: "contact.create", attempt: 0 });
    if (missing.kind === "enqueue") {
      expect(missing.payload).toMatchObject({ address: "Atatürk Cad. 1", city: "Konya", district: "Selçuklu" });
      expect(missing.payload.country).toBeUndefined();
    }
  });

  it("walks the legacy country → district → address → tax office retry ladder", () => {
    let variant = initialContactCreateVariant;
    const countries: Array<unknown> = [];
    for (let index = 0; index < 4; index += 1) {
      variant = nextContactCreateVariant(variant, "The selected country is invalid") ?? variant;
      countries.push(contactCreatePayload(workflowOrder, variant).country);
    }
    expect(countries).toEqual(["Türkiye", "Turkey", "TR", "TUR"]);

    const noDistrict = nextContactCreateVariant(initialContactCreateVariant, "ilçe bulunamadı");
    expect(noDistrict).toMatchObject({ include_district: false, country_index: 1 });
    expect(contactCreatePayload(workflowOrder, noDistrict!)).toMatchObject({ country: "Türkiye" });
    expect(contactCreatePayload(workflowOrder, noDistrict!).district).toBeUndefined();

    const noAddress = nextContactCreateVariant(noDistrict!, "district invalid");
    expect(contactCreatePayload(workflowOrder, noAddress!)).toMatchObject({ skip_address: true });

    const noTax = nextContactCreateVariant(initialContactCreateVariant, "Vergi dairesi bulunamadı (404)");
    expect(contactCreatePayload(workflowOrder, noTax!)).toMatchObject({ skip_tax_office: true, address: "Atatürk Cad. 1" });
    const noTaxNoAddress = nextContactCreateVariant(noTax!, "vergi dairesi");
    expect(contactCreatePayload(workflowOrder, noTaxNoAddress!)).toMatchObject({ skip_tax_office: true, skip_address: true });
    expect(nextContactCreateVariant(noTaxNoAddress!, "vergi dairesi")).toBeNull();
  });

  it("retries contact.create with the next variant and fails when the ladder is exhausted", () => {
    const retry = planNextKolaybiStep(workflowOrder, {
      operation: "contact.create",
      attempt: 0,
      requestPayload: contactCreatePayload(workflowOrder, initialContactCreateVariant),
      outcome: { status: "failed", error: "country mismatch" },
    });
    expect(retry).toMatchObject({ kind: "enqueue", operation: "contact.create", attempt: 1, payload: { country: "Türkiye" } });

    const exhausted = planNextKolaybiStep(workflowOrder, {
      operation: "contact.create",
      attempt: 3,
      requestPayload: contactCreatePayload(workflowOrder, { ...initialContactCreateVariant, include_address: false, include_tax_office: false }),
      outcome: { status: "failed", error: "unknown" },
    });
    expect(exhausted).toMatchObject({ kind: "failed" });
  });

  it("re-runs the lookup once on 412 and fails if the contact is still missing", () => {
    const relookup = planNextKolaybiStep(workflowOrder, {
      operation: "contact.create",
      attempt: 0,
      requestPayload: {},
      outcome: { status: "failed", error: "KolayBi returned HTTP 412" },
    });
    expect(relookup).toMatchObject({ kind: "enqueue", operation: "contact.find", attempt: 1 });
    const failed = planNextKolaybiStep(workflowOrder, {
      operation: "contact.find",
      attempt: 1,
      requestPayload: {},
      outcome: { status: "succeeded", result: { found: false } },
    });
    expect(failed).toEqual({ kind: "failed", error: "KolayBi müşteri oluşturulamadı (HTTP 412)" });
  });

  it("completes with the invoice id or reports the legacy partial failure", () => {
    const payload = invoiceCreatePayload(workflowOrder, "41", "8");
    expect(payload).toMatchObject({
      description: "Sipariş: ORD-1",
      currency: "try",
      order_date: "2026-10-06",
      items: [{ product_id: "77", quantity: "2", unit_price: "1000.00", vat_rate: "20", description: "Kuluçka Makinesi 96" }],
    });
    expect(planNextKolaybiStep(workflowOrder, {
      operation: "invoice.create",
      attempt: 0,
      requestPayload: payload,
      outcome: { status: "succeeded", result: { success: true, data: { id: 5501 } } },
    })).toEqual({ kind: "completed", contactId: "41", addressId: "8", invoiceId: "5501" });
    expect(planNextKolaybiStep(workflowOrder, {
      operation: "invoice.create",
      attempt: 0,
      requestPayload: payload,
      outcome: { status: "failed", error: "HTTP 500" },
    })).toMatchObject({ kind: "failed", error: "Cari oluşturuldu ama fatura oluşturulamadı. Tekrar deneyin.", contactId: "41" });
  });
});

describe("order delete balance rule (legacy 073)", () => {
  it("preserves commission for cargo operators and removes the net effect otherwise", () => {
    expect(planOrderDeleteMovement({ orderPublicId: "ord_1", orderNumber: "ORD-1", actorRole: "kargo_operatoru", netOrderCents: 5000 })).toBeNull();
    expect(planOrderDeleteMovement({ orderPublicId: "ord_1", orderNumber: "ORD-1", actorRole: "calisan", netOrderCents: 0 })).toBeNull();
    expect(planOrderDeleteMovement({ orderPublicId: "ord_1", orderNumber: "ORD-1", actorRole: "admin", netOrderCents: 5000 })).toEqual({
      kind: "adjustment",
      amount_cents: -5000,
      description: "Sipariş silindi: ORD-1",
      idempotency_key: "order:ord_1:delete",
    });
  });
});

const mocks = vi.hoisted(() => {
  const now = new Date("2026-10-06T08:00:00.000Z");
  let role = "calisan";
  const baseOrder = {
    id: 7,
    public_id: "ord_1",
    order_number: "ORD-1",
    status: "draft",
    notes: null as string | null,
    total_amount: "2400.00",
    currency: "TRY",
    created_at: now,
    updated_at: now,
    deleted_at: null as Date | null,
    confirmation_status: null as string | null,
    kolaybi_contact_id: null as string | null,
    kolaybi_address_id: null as string | null,
    kolaybi_invoice_id: null as string | null,
    kolaybi_status: null as string | null,
    kolaybi_error: null as string | null,
    e_document_status: null as string | null,
    confirmation_call_status: null as string | null,
    confirmation_call_bulk_id: null as string | null,
    confirmation_pressed_key: null as string | null,
    confirmation_listen_seconds: null as number | null,
    confirmation_call_count: 0,
    customer_full_name: "Ahmet Yılmaz",
    customer_phone: "05551112233",
    customer_email: null,
    customer_id: 3,
  };
  const state = { order: { ...baseOrder }, steps: [] as Array<Record<string, unknown>>, attempts: new Map<string, unknown>() };
  const repo = {
    getOrderState: vi.fn(async (publicId: string, options: { includeDeleted?: boolean } = {}) => {
      if (publicId !== state.order.public_id) return null;
      if (state.order.deleted_at && !options.includeDeleted) return null;
      return { ...state.order };
    }),
    getWorkflowOrder: vi.fn(async () => ({
      orderPublicId: "ord_1",
      orderNumber: "ORD-1",
      createdAt: now.toISOString(),
      customer: { fullName: "Ahmet Yılmaz", phone: "05551112233", email: null },
      address: { addressLine: "Atatürk Cad. 1", city: "Konya", district: "Selçuklu", country: "Türkiye" },
      items: [{ name: "Kuluçka Makinesi", quantity: 1, unitPrice: "2400.00", externalProductId: null }],
    })),
    hasIncubatorItem: vi.fn(async () => true),
    listSteps: vi.fn(async () => state.steps),
    listQueuedSteps: vi.fn(async () => state.steps.filter((step) => step.status === "queued")),
    findStepByIdempotencyKey: vi.fn(async (key: string) => state.steps.find((step) => step.idempotency_key === key) ?? null),
    insertStep: vi.fn(async (input: Record<string, unknown>) => {
      const step = {
        id: state.steps.length + 1,
        public_id: `ops_${state.steps.length + 1}`,
        order_id: input.orderId,
        action: input.action,
        provider: input.provider,
        operation: input.operation,
        attempt: input.attempt,
        status: "queued",
        idempotency_key: input.idempotencyKey,
        request_id: input.requestId,
        job_id: input.jobId,
        queued: input.queued,
        request_payload: input.requestPayload,
        result: null,
        error_message: null,
        actor_user_id: input.actorUserId,
        created_at: now,
        updated_at: now,
      };
      state.steps.push(step);
      return step;
    }),
    completeStep: vi.fn(async (stepId: number, input: { status: string; errorMessage: string | null }) => {
      const step = state.steps.find((item) => item.id === stepId);
      if (step) {
        step.status = input.status;
        step.error_message = input.errorMessage;
      }
    }),
    updateOrderProviderState: vi.fn(async (_orderId: number, update: Record<string, unknown>) => {
      Object.assign(state.order, update);
    }),
    updateNotes: vi.fn(async (_orderId: number, notes: string | null) => {
      state.order.notes = notes;
    }),
    latestAttempt: vi.fn(async (requestId: string) => state.attempts.get(requestId) ?? null),
    softDeleteOrder: vi.fn(async (input: { actorRole: string | null }) => {
      state.order.deleted_at = now;
      return { deleted: true, commissionPreserved: input.actorRole === "kargo_operatoru" };
    }),
  };
  const domainRepository = {
    updateOrderStatus: vi.fn(async (input: { status: string }) => {
      state.order.status = input.status;
      return state.order;
    }),
  };
  return {
    now,
    baseOrder,
    state,
    repo,
    domainRepository,
    setRole: (next: string) => {
      role = next;
    },
    authRepository: {
      findUserByPublicId: vi.fn(async () => ({
        id: 10,
        public_id: "usr_test",
        role_id: 1,
        email: "user@example.com",
        password_hash: "hash",
        first_name: "Test",
        last_name: "User",
        phone: null,
        is_active: true,
        is_online: false,
        last_seen_at: null,
        sip_username: null,
        sip_password_encrypted: null,
        created_at: now,
        updated_at: now,
        role_name: role,
      })),
      findSessionByPublicId: vi.fn(async () => ({
        id: 100,
        public_id: "ses_test",
        user_id: 10,
        user_agent: null,
        ip_address: null,
        expires_at: new Date("2099-02-01T00:00:00.000Z"),
        revoked_at: null,
        created_at: now,
        updated_at: now,
      })),
    },
  };
});

vi.mock("../src/auth/repository.js", () => ({
  AuthRepository: vi.fn(function AuthRepository() {
    return mocks.authRepository;
  }),
  isAdminRole: (role: string) => role === "admin" || role === "owner",
}));

vi.mock("../src/orders/action-repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/orders/action-repository.js")>();
  return {
    ...actual,
    OrderActionRepository: vi.fn(function OrderActionRepository() {
      return mocks.repo;
    }),
  };
});

vi.mock("../src/domain/repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/domain/repository.js")>();
  return {
    ...actual,
    DomainRepository: vi.fn(function DomainRepository() {
      return mocks.domainRepository;
    }),
  };
});

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "order-actions-route-test-secret-value",
  encryptionKey: "order-actions-route-encryption-key",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

type PublishedJob = { job_id: string; name: string; payload: { envelope: { provider: string; operation: string; channel: string; request_id: string; payload: Record<string, unknown> } } };
const published: PublishedJob[] = [];
const publisher = {
  publish: vi.fn(async (job: PublishedJob) => {
    published.push(job);
    return job.job_id;
  }),
};

async function send(method: string, path: string, body?: unknown, role = "calisan") {
  mocks.setRole(role);
  const token = await signAccessToken({ user_public_id: "usr_test", session_public_id: "ses_test", role }, config);
  return createApp({ config, db: {} as AppDatabase, providerDeliveryQueuePublisher: publisher as never }).request(path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function attemptFor(operation: string, result: Record<string, unknown> | null, status = "success", error: string | null = null) {
  const step = mocks.state.steps.find((item) => item.operation === operation && item.status === "queued");
  if (!step) throw new Error(`No queued ${operation} step`);
  mocks.state.attempts.set(step.request_id as string, {
    status,
    response_metadata: result ? { live_call_performed: true, result } : { live_call_performed: false },
    error_message: error,
  });
}

describe("order action routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    published.length = 0;
    mocks.state.order = { ...mocks.baseOrder };
    mocks.state.steps = [];
    mocks.state.attempts = new Map();
  });

  it("starts the KolayBi workflow with a contact.find provider-delivery job and replays the idempotency key", async () => {
    const response = await send("POST", "/api/orders/ord_1/kolaybi/transfer", { idempotency_key: "kb_1" });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      provider: "kolaybi",
      operation: "contact.find",
      replayed: false,
      live_call_permitted: false,
      live_gate: "providers.kolaybi.live_mode",
    });
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ name: "kolaybi.contact.find" });
    expect(published[0]?.payload.envelope).toMatchObject({ provider: "kolaybi", channel: "accounting", payload: { phone: "05551112233", idempotency_key: "kb_1" } });
    expect(mocks.state.order.kolaybi_status).toBe("contact_lookup");

    const replay = await send("POST", "/api/orders/ord_1/kolaybi/transfer", { idempotency_key: "kb_1" });
    expect(replay.status).toBe(202);
    await expect(replay.json()).resolves.toMatchObject({ replayed: true });
    expect(published).toHaveLength(1);
  });

  it("advances find → create (with retry) → invoice → completed from worker attempts", async () => {
    await send("POST", "/api/orders/ord_1/kolaybi/transfer", { idempotency_key: "kb_2" });

    // Dry-run attempt (no provider result) keeps the step queued.
    attemptFor("contact.find", null);
    let sync = await send("POST", "/api/orders/ord_1/provider-sync");
    await expect(sync.json()).resolves.toMatchObject({ advanced_count: 0 });

    attemptFor("contact.find", { success: true, found: false, contact: null });
    sync = await send("POST", "/api/orders/ord_1/provider-sync");
    expect(sync.status).toBe(200);
    expect(published.at(-1)).toMatchObject({ name: "kolaybi.contact.create" });
    expect(mocks.state.order.kolaybi_status).toBe("contact_create");

    attemptFor("contact.create", null, "terminal_failure", "The selected country is invalid");
    await send("POST", "/api/orders/ord_1/provider-sync");
    expect(published.at(-1)?.payload.envelope.payload).toMatchObject({ country: "Türkiye" });

    attemptFor("contact.create", { success: true, contact_id: 41, address_id: 8 });
    await send("POST", "/api/orders/ord_1/provider-sync");
    expect(published.at(-1)).toMatchObject({ name: "kolaybi.invoice.create" });
    expect(mocks.state.order).toMatchObject({ kolaybi_contact_id: "41", kolaybi_status: "invoice_create" });

    attemptFor("invoice.create", { success: true, data: { id: 5501 } });
    sync = await send("POST", "/api/orders/ord_1/provider-sync");
    await expect(sync.json()).resolves.toMatchObject({ order: { status: "confirmed", kolaybi: { invoice_id: "5501", status: "completed", contact_id: "41" } } });
    expect(published).toHaveLength(4);

    const again = await send("POST", "/api/orders/ord_1/kolaybi/transfer", { idempotency_key: "kb_3" });
    expect(again.status).toBe(409);
    await expect(again.json()).resolves.toMatchObject({ error: { code: "already_transferred" } });
  });

  it("marks the workflow failed when invoice creation fails", async () => {
    mocks.state.order.kolaybi_contact_id = "41";
    await send("POST", "/api/orders/ord_1/kolaybi/transfer", { idempotency_key: "kb_4" });
    expect(published[0]).toMatchObject({ name: "kolaybi.invoice.create" });
    attemptFor("invoice.create", null, "terminal_failure", "HTTP 422");
    await send("POST", "/api/orders/ord_1/provider-sync");
    expect(mocks.state.order).toMatchObject({ kolaybi_status: "failed", kolaybi_error: "Cari oluşturuldu ama fatura oluşturulamadı. Tekrar deneyin." });
  });

  it("requires an invoice for e-document and invoice view actions", async () => {
    const blocked = await send("POST", "/api/orders/ord_1/kolaybi/e-document", { action: "create", idempotency_key: "ed_1" });
    expect(blocked.status).toBe(409);
    await expect(blocked.json()).resolves.toMatchObject({ error: { message: "Önce KolayBi'ye aktarılmalı" } });

    mocks.state.order.kolaybi_invoice_id = "5501";
    const created = await send("POST", "/api/orders/ord_1/kolaybi/e-document", { action: "create", idempotency_key: "ed_1" });
    expect(created.status).toBe(202);
    expect(published.at(-1)).toMatchObject({ name: "kolaybi.invoice.e_document.create" });
    expect(mocks.state.order.e_document_status).toBe("queued");
    attemptFor("invoice.e_document.create", { success: true, document_id: "5501" });
    await send("POST", "/api/orders/ord_1/provider-sync");
    expect(mocks.state.order.e_document_status).toBe("sent");

    const view = await send("POST", "/api/orders/ord_1/kolaybi/invoice", { idempotency_key: "inv_1" });
    await expect(view.json()).resolves.toMatchObject({ operation: "invoice.get", invoice_id: "5501" });
  });

  it("cancels an invoiced order and queues the e-document cancel, then restores to Oluşturuldu", async () => {
    mocks.state.order.kolaybi_invoice_id = "5501";
    const cancelled = await send("POST", "/api/orders/ord_1/cancel", { status: "cancelled", idempotency_key: "c_1" });
    expect(cancelled.status).toBe(200);
    expect(mocks.domainRepository.updateOrderStatus).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled", actorRole: "calisan" }));
    expect(published.at(-1)).toMatchObject({ name: "kolaybi.invoice.e_document.cancel" });
    expect(mocks.state.order.e_document_status).toBe("cancel_queued");

    const restored = await send("POST", "/api/orders/ord_1/restore");
    expect(restored.status).toBe(200);
    expect(mocks.domainRepository.updateOrderStatus).toHaveBeenLastCalledWith(expect.objectContaining({ status: "draft" }));
    const invalid = await send("POST", "/api/orders/ord_1/restore");
    expect(invalid.status).toBe(409);
  });

  it("soft deletes once, preserving commission for cargo operators", async () => {
    const deleted = await send("DELETE", "/api/orders/ord_1", { idempotency_key: "del_1" }, "kargo_operatoru");
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toMatchObject({ deleted: true, replayed: false, commission_preserved: true });
    expect(mocks.repo.softDeleteOrder).toHaveBeenCalledWith({ orderId: 7, actorRole: "kargo_operatoru", actorUserId: 10 });

    const replay = await send("DELETE", "/api/orders/ord_1", { idempotency_key: "del_1" }, "kargo_operatoru");
    await expect(replay.json()).resolves.toMatchObject({ deleted: true, replayed: true });
    expect(mocks.repo.softDeleteOrder).toHaveBeenCalledTimes(1);

    const gone = await send("GET", "/api/orders/ord_1/actions");
    expect(gone.status).toBe(404);
  });

  it("queues NetGSM confirmation calls, reads the IVR report and supports bulk calls", async () => {
    const call = await send("POST", "/api/orders/ord_1/confirmation-call", { idempotency_key: "tc_1" });
    expect(call.status).toBe(202);
    expect(published.at(-1)?.payload.envelope).toMatchObject({ provider: "netgsm", operation: "call.confirmation.create", channel: "voice", payload: { telefon: "05551112233" } });
    expect(mocks.state.order.confirmation_call_count).toBe(1);
    attemptFor("call.confirmation.create", { success: true, bulkId: "B77" });
    await send("POST", "/api/orders/ord_1/provider-sync");
    expect(mocks.state.order).toMatchObject({ confirmation_call_status: "araniyor", confirmation_call_bulk_id: "B77" });

    await send("POST", "/api/orders/ord_1/confirmation-call/status", { idempotency_key: "ts_1" });
    attemptFor("call.confirmation.status", { success: true, call_status: "cevaplandi", pressed_key: "9", listen_seconds: 12, confirmation_outcome: "iptal_istegi" });
    await send("POST", "/api/orders/ord_1/provider-sync");
    expect(mocks.state.order).toMatchObject({ confirmation_status: "iptal_istegi", confirmation_pressed_key: "9", confirmation_listen_seconds: 12 });

    mocks.state.order.confirmation_status = "teyit_edildi";
    const bulk = await send("POST", "/api/orders/bulk/confirmation-calls", { order_public_ids: ["ord_1", "ord_missing"], idempotency_key: "bulk_1" }, "kargo_operatoru");
    expect(bulk.status).toBe(202);
    await expect(bulk.json()).resolves.toMatchObject({
      queued_count: 0,
      results: [
        { order_public_id: "ord_1", skipped_reason: "already_confirmed" },
        { order_public_id: "ord_missing", skipped_reason: "not_found" },
      ],
    });
  });

  it("bulk KolayBi transfer queues per order with derived keys and skips transferred orders", async () => {
    const bulk = await send("POST", "/api/orders/bulk/kolaybi-transfer", { order_public_ids: ["ord_1"], idempotency_key: "bk_1" });
    await expect(bulk.json()).resolves.toMatchObject({ queued_count: 1, results: [{ order_public_id: "ord_1", queued: true }] });
    expect(mocks.state.steps[0]).toMatchObject({ idempotency_key: "bk_1:ord_1" });
    mocks.state.order.kolaybi_invoice_id = "1";
    const again = await send("POST", "/api/orders/bulk/kolaybi-transfer", { order_public_ids: ["ord_1"], idempotency_key: "bk_2" });
    await expect(again.json()).resolves.toMatchObject({ queued_count: 0, results: [{ skipped_reason: "already_transferred" }] });
  });

  it("updates notes and manual confirmation, and rejects unknown roles", async () => {
    await send("PATCH", "/api/orders/ord_1/notes", { notes: "Kapıya bırak" });
    expect(mocks.state.order.notes).toBe("Kapıya bırak");
    const manual = await send("PATCH", "/api/orders/ord_1/confirmation", { confirmation_status: "teyit_edildi" });
    await expect(manual.json()).resolves.toMatchObject({ order: { confirmation_status: "teyit_edildi" } });
    await send("PATCH", "/api/orders/ord_1/confirmation", { confirmation_status: "bekliyor" });
    expect(mocks.state.order.confirmation_status).toBeNull();
    const forbidden = await send("GET", "/api/orders/ord_1/actions", undefined, "musteri");
    expect(forbidden.status).toBe(403);
  });
});
