import type { AppDatabase } from "@garanti-kulucka/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const routeMocks = vi.hoisted(() => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  let role = "calisan";
  const draft = (id: string, overrides: Record<string, unknown> = {}) => ({
    order_id: 1,
    order_public_id: id,
    order_number: `ORD-${id}`,
    order_status: "pending",
    total_amount: "2550.00",
    currency: "TRY",
    cargo_provider: "ptt",
    customer_id: 3,
    recipient_name: "Ayşe Yılmaz",
    recipient_phone: "5551112233",
    recipient_address: "Atatürk Cad. 1",
    recipient_city: "İzmir",
    recipient_district: "Bornova",
    items: [{ name: "Kuluçka Makinesi", quantity: 1, unit_price: "2550.00", total_amount: "2550.00" }],
    existing_shipment: null,
    ...overrides,
  });
  const shipment = (publicId: string, provider = "ptt") => ({
    id: 9,
    public_id: publicId,
    order_id: 1,
    customer_id: 3,
    provider,
    tracking_number: null,
    barcode_number: provider === "ptt" ? "2791727900008" : null,
    status: "pending",
    recipient_name: "Ayşe Yılmaz",
    recipient_phone: "5551112233",
    recipient_address: "Atatürk Cad. 1",
    recipient_city: "İzmir",
    recipient_district: "Bornova",
    last_event_text: null,
    shipped_at: null,
    delivered_at: null,
    raw_payload: null,
    created_at: now,
    updated_at: now,
    order_number: "ORD-ord_1",
    customer_full_name: "Ayşe Yılmaz",
    tracking_events: [],
  });
  return {
    now,
    draft,
    shipment,
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
    shipmentRepository: {
      getDraft: vi.fn(async (id: string): Promise<unknown> => draft(id)),
      createShipment: vi.fn(),
      getPrintData: vi.fn(),
      markPrinted: vi.fn(),
      getSender: vi.fn(async () => ({ name: "Garanti Kuluçka", phone: "03320000000", address: "Sanayi Mh.", city: "Konya", district: "Karatay" })),
    },
    domainRepository: {
      getShipmentByPublicId: vi.fn(async (publicId: string) => shipment(publicId)),
    },
  };
});

vi.mock("../src/auth/repository.js", () => ({
  AuthRepository: vi.fn(function AuthRepository() {
    return routeMocks.authRepository;
  }),
  isAdminRole: (role: string) => role === "admin" || role === "owner",
}));

vi.mock("../src/shipments/repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shipments/repository.js")>();
  return {
    ...actual,
    ShipmentCreateRepository: vi.fn(function ShipmentCreateRepository() {
      return routeMocks.shipmentRepository;
    }),
  };
});

vi.mock("../src/domain/repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/domain/repository.js")>();
  return {
    ...actual,
    DomainRepository: vi.fn(function DomainRepository() {
      return routeMocks.domainRepository;
    }),
  };
});

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const shipmentsModule = await import("../src/shipments/repository.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "shipment-create-route-test-secret",
  encryptionKey: "shipment-create-encryption-key",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

const published: Array<{ job_id: string; name: string; payload: { envelope: { payload: Record<string, unknown> } } }> = [];
const publisher = {
  publish: vi.fn(async (job: (typeof published)[number]) => {
    published.push(job);
    return job.job_id;
  }),
};

async function token(role = "calisan") {
  routeMocks.setRole(role);
  return signAccessToken({ user_public_id: "usr_test", session_public_id: "ses_test", role }, config);
}

function app() {
  return createApp({ config, db: {} as AppDatabase, providerDeliveryQueuePublisher: publisher as never });
}

async function request(path: string, init: { method?: string; body?: unknown; role?: string } = {}) {
  return app().request(path, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${await token(init.role ?? "calisan")}`, "content-type": "application/json" },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

function created(orderPublicId: string, provider: "ptt" | "surat", overrides: Record<string, unknown> = {}) {
  return {
    shipment_public_id: `shp_${orderPublicId}`,
    replayed: false,
    barcode_number: provider === "ptt" ? "2791727900008" : null,
    barcode_pool_exhausted: false,
    barcode_range: provider === "ptt" ? "27917279" : null,
    measurements: { weight_kg: 1, desi: provider === "ptt" ? 15 : 18 },
    draft: routeMocks.draft(orderPublicId),
    recipient: { name: "Ayşe Yılmaz", phone: "5551112233", address: "Atatürk Cad. 1", city: "İzmir", district: "Bornova" },
    ...overrides,
  };
}

describe("shipment create routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    published.length = 0;
  });

  it("returns the order shipment draft with legacy measurements for kargo_operatoru", async () => {
    const response = await request("/api/orders/ord_1/shipment-draft", { role: "kargo_operatoru" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      order_number: "ORD-ord_1",
      recipient: { city: "İzmir", district: "Bornova" },
      missing_field: null,
      measurements: { ptt: { weight_kg: 1, desi: 15 }, surat: { weight_kg: 1, desi: 18 } },
      existing_shipment: null,
    });
  });

  it("creates a PTT shipment with allocated barcode and queues kabulEkle2 on provider-delivery", async () => {
    routeMocks.shipmentRepository.createShipment.mockResolvedValueOnce(created("ord_1", "ptt"));
    const response = await request("/api/orders/ord_1/shipments", {
      method: "POST",
      body: { provider: "ptt", payment_status: "karsi_odemeli", idempotency_key: "kargo_ptt_ord_1", recipient_city: "İzmir" },
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      provider: "ptt",
      operation: "shipment.create",
      queued: true,
      replayed: false,
      live_call_permitted: false,
      live_gate: "providers.ptt.live_mode",
      barcode_number: "2791727900008",
      message: "PTT Kargo barkod oluşturuldu! Takip: 2791727900008",
      shipment: { public_id: "shp_ord_1", status: "pending" },
    });
    expect(routeMocks.shipmentRepository.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({
        orderPublicId: "ord_1",
        provider: "ptt",
        paymentStatus: "karsi_odemeli",
        idempotencyKey: "kargo_ptt_ord_1",
        actorUserId: 10,
        recipientOverrides: { address: undefined, city: "İzmir", district: undefined },
      }),
    );
    expect(published).toHaveLength(1);
    expect(published[0]?.name).toBe("ptt.shipment.create");
    expect(published[0]?.payload.envelope.payload).toMatchObject({
      barkodNo: "2791727900008",
      aliciAdi: "Ayşe Yılmaz",
      aliciIl: "İzmir",
      desi: 15,
      kapidaOdeme: true,
      kapidaOdemeTutar: "2550.00",
      ucretAlicidan: true,
      odemeTipi: "alici",
    });
  });

  it("queues Sürat OrtakBarkodOlustur with sender-paid payment when ödeme alındı", async () => {
    routeMocks.shipmentRepository.createShipment.mockResolvedValueOnce(created("ord_2", "surat"));
    routeMocks.domainRepository.getShipmentByPublicId.mockResolvedValueOnce(routeMocks.shipment("shp_ord_2", "surat"));
    const response = await request("/api/orders/ord_2/shipments", {
      method: "POST",
      body: { provider: "surat", payment_status: "odeme_alindi", idempotency_key: "kargo_surat_ord_2" },
    });
    expect(response.status).toBe(201);
    expect(published[0]?.name).toBe("surat.shipment.create");
    expect(published[0]?.payload.envelope.payload).toMatchObject({
      aliciAd: "Ayşe Yılmaz",
      kg: 1,
      desi: 18,
      kargoTuru: 3,
      kapidaOdemeTutari: 0,
      kapidaOdemeTahsilatTipi: 0,
    });
  });

  it("replays an idempotent create without queueing a second provider job", async () => {
    routeMocks.shipmentRepository.createShipment.mockResolvedValueOnce(created("ord_1", "ptt", { replayed: true }));
    const response = await request("/api/orders/ord_1/shipments", {
      method: "POST",
      body: { provider: "ptt", idempotency_key: "kargo_ptt_ord_1" },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ replayed: true, queued: false, job_id: null });
    expect(published).toHaveLength(0);
  });

  it("maps already-exists, missing field and unknown order errors to legacy messages", async () => {
    routeMocks.shipmentRepository.createShipment.mockRejectedValueOnce(new shipmentsModule.ShipmentAlreadyExistsError("shp_old"));
    const exists = await request("/api/orders/ord_1/shipments", { method: "POST", body: { provider: "ptt", idempotency_key: "k1" } });
    expect(exists.status).toBe(409);
    await expect(exists.json()).resolves.toMatchObject({
      error: { code: "shipment_already_exists", message: "Bu sipariş için gönderi daha önce oluşturulmuş.", shipment_public_id: "shp_old" },
    });

    routeMocks.shipmentRepository.createShipment.mockRejectedValueOnce(new shipmentsModule.MissingRecipientFieldError("İl bilgisi eksik (ORD-1)"));
    const missing = await request("/api/orders/ord_1/shipments", { method: "POST", body: { provider: "ptt", idempotency_key: "k2" } });
    expect(missing.status).toBe(422);
    await expect(missing.json()).resolves.toMatchObject({ error: { code: "missing_recipient_field", message: "İl bilgisi eksik (ORD-1)" } });

    routeMocks.shipmentRepository.createShipment.mockRejectedValueOnce(new shipmentsModule.ShipmentOrderNotFoundError("ord_x"));
    const unknown = await request("/api/orders/ord_x/shipments", { method: "POST", body: { provider: "ptt", idempotency_key: "k3" } });
    expect(unknown.status).toBe(404);

    const invalid = await request("/api/orders/ord_1/shipments", { method: "POST", body: { provider: "aras" } });
    expect(invalid.status).toBe(400);
    expect(published).toHaveLength(0);
  });

  it("bulk creates like legacy topluKargoAktar: skips orders with shipments and blocks on missing addresses", async () => {
    routeMocks.shipmentRepository.getDraft.mockImplementation(async (id: string) =>
      id === "ord_done"
        ? routeMocks.draft(id, { existing_shipment: { public_id: "shp_done", provider: "ptt", status: "pending", tracking_number: null, barcode_number: "x" } })
        : routeMocks.draft(id),
    );
    routeMocks.shipmentRepository.createShipment.mockImplementation(async (input: { orderPublicId: string }) => created(input.orderPublicId, "ptt"));
    const response = await request("/api/shipments/bulk-create", {
      method: "POST",
      body: { provider: "ptt", order_public_ids: ["ord_a", "ord_b", "ord_done"], idempotency_key: "toplu_1" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { created_count: number; skipped_count: number; message: string; results: Array<Record<string, unknown>> };
    expect(body).toMatchObject({ created_count: 2, skipped_count: 1, failed_count: 0, message: "2 sipariş PTT Kargo'ya aktarıldı!" });
    expect(routeMocks.shipmentRepository.createShipment).toHaveBeenCalledWith(
      expect.objectContaining({ orderPublicId: "ord_a", paymentStatus: "karsi_odemeli", idempotencyKey: "toplu_1:ord_a" }),
    );
    expect(published.map((job) => job.name)).toEqual(["ptt.shipment.create", "ptt.shipment.create"]);

    routeMocks.shipmentRepository.getDraft.mockImplementation(async (id: string) =>
      id === "ord_c" ? routeMocks.draft(id, { recipient_district: null }) : routeMocks.draft(id),
    );
    const blocked = await request("/api/shipments/bulk-create", {
      method: "POST",
      body: { provider: "surat", order_public_ids: ["ord_a", "ord_c"], idempotency_key: "toplu_2" },
    });
    expect(blocked.status).toBe(422);
    await expect(blocked.json()).resolves.toMatchObject({
      error: { message: "1 siparişte adres bilgisi eksik. Önce adres bilgilerini tamamlayın.", order_public_ids: ["ord_c"] },
    });

    routeMocks.shipmentRepository.getDraft.mockImplementation(async (id: string) =>
      routeMocks.draft(id, { existing_shipment: { public_id: "shp", provider: "ptt", status: "pending", tracking_number: "1", barcode_number: null } }),
    );
    const nothing = await request("/api/shipments/bulk-create", {
      method: "POST",
      body: { provider: "ptt", order_public_ids: ["ord_a"], idempotency_key: "toplu_3" },
    });
    expect(nothing.status).toBe(409);
    routeMocks.shipmentRepository.getDraft.mockImplementation(async (id: string) => routeMocks.draft(id));
  });

  it("serves print data with CODE128 barcode and marks the label printed", async () => {
    routeMocks.shipmentRepository.getPrintData.mockResolvedValueOnce({
      shipment_public_id: "shp_1",
      provider: "surat",
      status: "pending",
      tracking_number: "SRT123456",
      barcode_number: null,
      barcode_value: "SRT123456",
      payment_type: "cash_on_delivery",
      label_printed_at: null,
      recipient_name: "Ayşe Yılmaz",
      recipient_phone: "5551112233",
      recipient_address: "Atatürk Cad. 1",
      recipient_city: "İzmir",
      recipient_district: "Bornova",
      order_public_id: "ord_1",
      order_number: "ORD-1",
      order_total_amount: "2550.00",
      order_currency: "TRY",
      order_created_at: routeMocks.now,
      items: [],
      created_at: routeMocks.now,
    });
    const print = await request("/api/shipments/shp_1/print", { role: "kargo_operatoru" });
    expect(print.status).toBe(200);
    await expect(print.json()).resolves.toMatchObject({
      provider_label: "Sürat Kargo",
      barcode_value: "SRT123456",
      barcode_format: "CODE128",
      invoice_title: "Sipariş: ORD-1",
    });

    routeMocks.shipmentRepository.markPrinted.mockResolvedValueOnce({ label_printed_at: routeMocks.now });
    const printed = await request("/api/shipments/shp_1/printed", { method: "POST", body: { idempotency_key: "print_1" } });
    expect(printed.status).toBe(200);
    await expect(printed.json()).resolves.toMatchObject({ shipment_public_id: "shp_1", label_printed_at: routeMocks.now.toISOString() });

    routeMocks.shipmentRepository.getPrintData.mockResolvedValueOnce(null);
    expect((await request("/api/shipments/shp_none/print")).status).toBe(404);
  });

  it("downloads PDF, ZPL and EPL cargo labels with the Code 128 barcode", async () => {
    const printData = {
      shipment_public_id: "shp_1",
      provider: "ptt",
      status: "pending",
      tracking_number: "KP123456789TR",
      barcode_number: "2785001234567",
      barcode_value: null,
      payment_type: "prepaid",
      label_printed_at: null,
      recipient_name: "Ayşe Işık",
      recipient_phone: "5551112233",
      recipient_address: "Atatürk Cad. 1",
      recipient_city: "Konya",
      recipient_district: "Selçuklu",
      order_public_id: "ord_1",
      order_number: "ORD-1",
      order_total_amount: "2550.00",
      order_currency: "TRY",
      order_created_at: routeMocks.now,
      items: [{ name: "Kuluçka Makinesi", quantity: 1, unit_price: "2550.00", total_amount: "2550.00" }],
      created_at: routeMocks.now,
    };
    routeMocks.shipmentRepository.getPrintData.mockResolvedValue(printData);

    const pdf = await request("/api/shipments/shp_1/label?format=pdf", { role: "kargo_operatoru" });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(pdf.headers.get("content-disposition")).toBe('attachment; filename="etiket-2785001234567.pdf"');
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");

    const zpl = await request("/api/shipments/shp_1/label?format=zpl");
    const zplText = await zpl.text();
    expect(zplText).toMatch(/^\^XA\n\^CI28/);
    expect(zplText).toContain("^BCN,220,Y,N,N^FD2785001234567^FS");
    expect(zplText).toContain("^FDAyşe Işık^FS");

    const epl = await request("/api/shipments/shp_1/label?format=epl");
    const eplText = await epl.text();
    expect(eplText).toContain('B60,620,0,1,3,7,220,B,"2785001234567"');
    expect(eplText).toContain('"Ayse Isik"');
    expect(eplText).toContain("\nP1\n");

    expect((await request("/api/shipments/shp_1/label?format=png")).status).toBe(400);
    routeMocks.shipmentRepository.getPrintData.mockResolvedValueOnce({ ...printData, barcode_number: null, tracking_number: null });
    const missing = await request("/api/shipments/shp_1/label");
    expect(missing.status).toBe(409);
    await expect(missing.json()).resolves.toMatchObject({ error: { code: "barcode_missing" } });
    routeMocks.shipmentRepository.getPrintData.mockResolvedValueOnce(null);
    expect((await request("/api/shipments/shp_none/label")).status).toBe(404);
    routeMocks.shipmentRepository.getPrintData.mockReset();
  });

  it("denies anonymous callers and unknown roles", async () => {
    const anonymous = await app().request("/api/orders/ord_1/shipment-draft");
    expect(anonymous.status).toBe(401);
    const unknownRole = await request("/api/orders/ord_1/shipments", { method: "POST", role: "misafir", body: { provider: "ptt", idempotency_key: "k" } });
    expect(unknownRole.status).toBe(403);
  });
});
