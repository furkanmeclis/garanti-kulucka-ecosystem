import type { AppDatabase } from "@garanti-kulucka/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const routeMocks = vi.hoisted(() => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const template = {
    id: 3,
    public_id: "smt_1",
    title: "Kargo Bilgi",
    body: "{musteri_adi}, {takip_no} kargonuz yolda.",
    sort_order: 1,
    is_active: true,
    is_system: true,
    created_by_user_id: null,
    created_at: now,
    updated_at: now,
  };
  const message = {
    id: 9,
    public_id: "sms_1",
    recipient_phone: "5551112233",
    customer_name: "Ahmet Yılmaz",
    message: "Merhaba",
    is_automatic: false,
    status: "queued",
    error_message: null,
    provider_bulk_id: null,
    shipment_id: null,
    tracking_number: "TRK1",
    template_id: null,
    idempotency_key: "k#0",
    request_id: "req_sms_k_0",
    job_id: "job_sms_k_0",
    queued: true,
    actor_user_id: 10,
    created_at: now,
    updated_at: now,
  };
  let role = "calisan";

  return {
    now,
    template,
    message,
    setRole: (next: string) => {
      role = next;
    },
    authRepository: {
      findUserByPublicId: vi.fn(async () => ({
        id: 10,
        public_id: "usr_test",
        role_id: 1,
        email: "calisan@example.com",
        password_hash: "hash",
        first_name: "Calisan",
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
    smsRepository: {
      listTemplates: vi.fn(async () => [template]),
      createTemplate: vi.fn(async (input: { title: string; body: string }) => ({ ...template, public_id: "smt_new", title: input.title, body: input.body, is_system: false })),
      updateTemplate: vi.fn(async (_publicId: string, input: { title?: string; body?: string }) => ({ ...template, ...input })),
      deleteTemplate: vi.fn(async (_publicId: string): Promise<void> => undefined),
      listHistory: vi.fn(async () => ({
        rows: [
          { ...message, attempt_status: "success", attempt_error_message: null },
          { ...message, public_id: "sms_2", is_automatic: true, attempt_status: "terminal_failure", attempt_error_message: "30: Geçersiz kullanıcı" },
        ],
        total: 2,
      })),
      findMessagesByIdempotencyKeys: vi.fn(async (): Promise<unknown[]> => []),
      recordMessage: vi.fn(async (input: { recipientPhone: string; idempotencyKey: string; jobId: string | null; queued: boolean; requestId: string; message: string }) => ({
        ...message,
        recipient_phone: input.recipientPhone,
        message: input.message,
        idempotency_key: input.idempotencyKey,
        job_id: input.jobId,
        queued: input.queued,
        request_id: input.requestId,
      })),
      listTrackableShipments: vi.fn(async () => [
        { public_id: "shp_1", provider: "ptt", tracking_number: "TRK1", barcode_number: null, recipient_name: "Ahmet" },
        { public_id: "shp_2", provider: "ptt", tracking_number: "TRK2", barcode_number: "BAR2", recipient_name: "Ayşe" },
      ]),
    },
  };
});

vi.mock("../src/auth/repository.js", () => ({
  AuthRepository: vi.fn(function AuthRepository() {
    return routeMocks.authRepository;
  }),
  isAdminRole: (role: string) => role === "admin" || role === "owner",
}));

vi.mock("../src/sms/repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/sms/repository.js")>();
  return {
    ...actual,
    SmsRepository: vi.fn(function SmsRepository() {
      return routeMocks.smsRepository;
    }),
  };
});

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const { SmsSystemTemplateDeleteError } = await import("../src/sms/repository.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "sms-center-route-test-secret-value",
  encryptionKey: "sms-center-route-encryption-key",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

const published: Array<{ job_id: string; name: string; payload: { envelope: { payload: Record<string, unknown>; provider: string } } }> = [];
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

async function send(method: string, path: string, body: unknown, role = "calisan") {
  return app().request(path, {
    method,
    headers: { authorization: `Bearer ${await token(role)}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("SMS center routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    published.length = 0;
  });

  it("queues one NetGSM provider-delivery job per manual recipient with derived idempotency keys", async () => {
    const response = await send("POST", "/api/sms/manual-send", {
      recipients: ["0555 111 22 33", "+90 (532) 000 00 00"],
      message: "Kargonuz yolda",
      idempotency_key: "sms_manual_abc",
    }, "kargo_operatoru");

    expect(response.status).toBe(202);
    expect(published).toHaveLength(2);
    expect(published[0]).toMatchObject({ name: "netgsm.sms.send", job_id: "job_sms_sms_manual_abc_0" });
    expect(published[0]?.payload.envelope).toMatchObject({
      provider: "netgsm",
      payload: { recipient_phone: "05551112233", message: "Kargonuz yolda", idempotency_key: "sms_manual_abc#0" },
    });
    expect(published[1]?.payload.envelope.payload).toMatchObject({ recipient_phone: "905320000000" });
    expect(routeMocks.smsRepository.recordMessage).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toMatchObject({
      provider: "netgsm",
      operation: "sms.send",
      recipient_count: 2,
      queued_count: 2,
      replayed: false,
      live_call_permitted: false,
      live_gate: "providers.netgsm.live_mode",
    });
  });

  it("replays existing idempotent sends without publishing and rejects mismatched reuse", async () => {
    routeMocks.smsRepository.findMessagesByIdempotencyKeys.mockResolvedValueOnce([
      { ...routeMocks.message, recipient_phone: "05551112233", message: "Kargonuz yolda", idempotency_key: "k#0" },
    ]);
    const replay = await send("POST", "/api/sms/manual-send", { recipients: ["05551112233"], message: "Kargonuz yolda", idempotency_key: "k" });
    expect(replay.status).toBe(202);
    expect(published).toHaveLength(0);
    await expect(replay.json()).resolves.toMatchObject({ replayed: true, recipient_count: 1 });

    routeMocks.smsRepository.findMessagesByIdempotencyKeys.mockResolvedValueOnce([
      { ...routeMocks.message, recipient_phone: "05551112233", message: "Başka", idempotency_key: "k#0" },
    ]);
    const conflict = await send("POST", "/api/sms/manual-send", { recipients: ["05551112233"], message: "Kargonuz yolda", idempotency_key: "k" });
    expect(conflict.status).toBe(409);
  });

  it("rejects unfilled template variables, invalid phones and forbidden roles", async () => {
    const unfilled = await send("POST", "/api/sms/manual-send", { recipients: ["05551112233"], message: "Merhaba {musteri_adi}", idempotency_key: "x" });
    expect(unfilled.status).toBe(400);
    await expect(unfilled.json()).resolves.toMatchObject({ error: { code: "unfilled_variables" } });

    const badPhone = await send("POST", "/api/sms/manual-send", { recipients: ["123"], message: "Merhaba", idempotency_key: "y" });
    expect(badPhone.status).toBe(400);

    const forbidden = await send("POST", "/api/sms/manual-send", { recipients: ["05551112233"], message: "Merhaba", idempotency_key: "z" }, "muhasebe");
    expect(forbidden.status).toBe(403);
    expect(published).toHaveLength(0);
  });

  it("lists history with legacy type/search filters and worker-derived delivery status", async () => {
    const response = await app().request("/api/sms/history?type=automatic&q=555&page=2&page_size=25", {
      headers: { authorization: `Bearer ${await token()}` },
    });
    expect(response.status).toBe(200);
    expect(routeMocks.smsRepository.listHistory).toHaveBeenCalledWith({ type: "automatic", query: "555", limit: 25, offset: 25 });
    await expect(response.json()).resolves.toMatchObject({
      total: 2,
      page: 2,
      data: [
        { public_id: "sms_1", status: "sent", customer_name: "Ahmet Yılmaz" },
        { public_id: "sms_2", status: "failed", is_automatic: true, error_message: "30: Geçersiz kullanıcı" },
      ],
    });

    const invalid = await app().request("/api/sms/history?type=bogus", { headers: { authorization: `Bearer ${await token()}` } });
    expect(invalid.status).toBe(400);
  });

  it("supports template CRUD and protects system templates from deletion", async () => {
    const list = await app().request("/api/sms/templates", { headers: { authorization: `Bearer ${await token()}` } });
    await expect(list.json()).resolves.toMatchObject({ data: [{ public_id: "smt_1", title: "Kargo Bilgi", is_system: true }] });

    const created = await send("POST", "/api/sms/templates", { title: "Yeni", body: "Metin" });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({ template: { public_id: "smt_new", title: "Yeni", is_system: false } });

    const empty = await send("POST", "/api/sms/templates", { title: " ", body: "Metin" });
    expect(empty.status).toBe(400);

    const updated = await send("PATCH", "/api/sms/templates/smt_1", { title: "Kargo Bilgi 2", body: "Yeni metin" });
    expect(updated.status).toBe(200);
    expect(routeMocks.smsRepository.updateTemplate).toHaveBeenCalledWith("smt_1", { title: "Kargo Bilgi 2", body: "Yeni metin" });

    routeMocks.smsRepository.deleteTemplate.mockRejectedValueOnce(new SmsSystemTemplateDeleteError());
    const system = await send("DELETE", "/api/sms/templates/smt_1", {});
    expect(system.status).toBe(403);
    await expect(system.json()).resolves.toMatchObject({ error: { message: "Sistem şablonları silinemez" } });

    const deleted = await send("DELETE", "/api/sms/templates/smt_2", {});
    expect(deleted.status).toBe(200);
  });

  it("triggers the PTT/Sürat tracking sweep through provider-delivery jobs", async () => {
    const response = await send("POST", "/api/sms/automatic/trigger", { provider: "ptt", idempotency_key: "sms_auto_ptt_1" }, "admin");
    expect(response.status).toBe(202);
    expect(routeMocks.smsRepository.listTrackableShipments).toHaveBeenCalledWith("ptt", expect.any(Date));
    expect(published.map((job) => job.name)).toEqual(["ptt.shipment.track", "ptt.shipment.track"]);
    await expect(response.json()).resolves.toMatchObject({ provider: "ptt", checked_count: 2, queued_count: 2, live_gate: "providers.ptt.live_mode" });

    const invalid = await send("POST", "/api/sms/automatic/trigger", { provider: "aras", idempotency_key: "x" });
    expect(invalid.status).toBe(400);
  });
});
