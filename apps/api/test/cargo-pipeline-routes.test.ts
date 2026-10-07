import type { AppDatabase } from "@garanti-kulucka/database";
import type { JobEnvelope } from "@garanti-kulucka/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const mocks = vi.hoisted(() => {
  const now = new Date("2026-10-07T08:00:00.000Z");
  let role = "admin";
  const row = {
    public_id: "cpl_1",
    shipment_public_id: "shp_1",
    order_public_id: "ord_1",
    conversation_public_id: "cnv_1",
    vapi_call_public_id: null,
    channel: "whatsapp",
    phone: "05551234567",
    customer_name: "Ayşe Yılmaz",
    tracking_number: "KP123",
    cargo_provider: "ptt",
    last_event_text: "Şubede bekliyor",
    step: "sms",
    status: "bekliyor",
    next_run_at: now,
    force_run: false,
    attempt_count: 0,
    max_attempts: 3,
    error_message: null,
    created_at: now,
    updated_at: now,
  };
  const settings = new Map<string, unknown>();
  return {
    now,
    row,
    settings,
    setRole: (next: string) => {
      role = next;
    },
    authRepository: {
      findUserByPublicId: vi.fn(async () => ({ id: 10, public_id: "usr_test", role_id: 1, email: "admin@example.com", password_hash: "hash", first_name: "Admin", last_name: "User", phone: null, is_active: true, is_online: false, last_seen_at: null, sip_username: null, sip_password_encrypted: null, created_at: now, updated_at: now, role_name: role })),
      findSessionByPublicId: vi.fn(async () => ({ id: 100, public_id: "ses_test", user_id: 10, user_agent: null, ip_address: null, expires_at: new Date("2099-02-01T00:00:00.000Z"), revoked_at: null, created_at: now, updated_at: now })),
    },
    pipeline: {
      list: vi.fn(async () => ({ rows: [row], total: 1 })),
      applyAction: vi.fn(async (publicId: string, action: string) => (publicId === "cpl_1" ? { ...row, status: action === "cancel" ? "iptal" : "bekliyor", force_run: action === "run_now" } : null)),
      delete: vi.fn(async (publicId: string) => publicId === "cpl_1"),
    },
    vapi: {
      reconcileOpenCalls: vi.fn(async () => undefined),
      findCallByIdempotencyKey: vi.fn(async () => undefined),
      createCall: vi.fn(async () => "vcl_test"),
      markCallQueued: vi.fn(async () => undefined),
    },
    sms: { recordMessage: vi.fn(async () => ({})) },
    domain: {
      getConversationDeliveryTarget: vi.fn(async () => ({ public_id: "cnv_1", channel: "instagram", external_thread_id: "igsid_1", customer_phone: null })),
      createMessage: vi.fn(async () => ({ public_id: "msg_test", attachments: [] })),
    },
  };
});

vi.mock("../src/auth/repository.js", () => ({
  AuthRepository: vi.fn(function AuthRepository() {
    return mocks.authRepository;
  }),
  isAdminRole: (role: string) => role === "admin" || role === "owner",
}));

vi.mock("../src/cargo/pipeline-repository.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/cargo/pipeline-repository.js")>()),
  CargoPipelineRepository: vi.fn(function CargoPipelineRepository() {
    return mocks.pipeline;
  }),
}));

vi.mock("../src/voice/repository.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/voice/repository.js")>()),
  VapiRepository: vi.fn(function VapiRepository() {
    return mocks.vapi;
  }),
}));

vi.mock("../src/sms/repository.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/sms/repository.js")>()),
  SmsRepository: vi.fn(function SmsRepository() {
    return mocks.sms;
  }),
}));

vi.mock("../src/domain/repository.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/domain/repository.js")>()),
  DomainRepository: vi.fn(function DomainRepository() {
    return mocks.domain;
  }),
}));

vi.mock("../src/voice/policy.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/voice/policy.js")>()),
  readSetting: vi.fn(async (_context: unknown, scope: string, key: string) => mocks.settings.get(`${scope}.${key}`) ?? null),
  writeSetting: vi.fn(async (_context: unknown, scope: string, key: string, value: unknown) => {
    mocks.settings.set(`${scope}.${key}`, value);
  }),
  readVapiCallPolicy: vi.fn(async () => ({ enabled: true, max_deneme: 3, arama_baslangic_saati: "09:00", arama_bitis_saati: "18:00", tekrar_arama_saat: 24 })),
}));

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "cargo-pipeline-route-test-secret-value",
  encryptionKey: "cargo-pipeline-route-encryption-key",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

const jobs: JobEnvelope[] = [];

async function request(method: string, path: string, body?: unknown, role = "admin") {
  mocks.setRole(role);
  const token = await signAccessToken({ user_public_id: "usr_test", session_public_id: "ses_test", role }, config);
  const app = createApp({
    config,
    db: {} as AppDatabase,
    providerDeliveryQueuePublisher: {
      publish: async (job) => {
        jobs.push(job);
        return job.job_id;
      },
    },
  });
  return app.request(path, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

describe("cargo pipeline routes (legacy KargoPipelinePage)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobs.length = 0;
    mocks.settings.clear();
  });

  it("lists rows for staff after reconciling VAPI results and validates filters", async () => {
    const response = await request("GET", "/api/cargo-pipeline?status=bekliyor&step=sms&page=2&page_size=20", undefined, "kargo_operatoru");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 1, page: 2, page_size: 20, data: [{ public_id: "cpl_1", step: "sms", next_run_at: "2026-10-07T08:00:00.000Z" }] });
    expect(mocks.vapi.reconcileOpenCalls).toHaveBeenCalled();
    expect(mocks.pipeline.list).toHaveBeenCalledWith({ status: "bekliyor", step: "sms", page: 2, pageSize: 20 });
    expect((await request("GET", "/api/cargo-pipeline?status=nope")).status).toBe(400);
    expect((await request("GET", "/api/cargo-pipeline?status=tumu")).status).toBe(200);
    expect(mocks.pipeline.list).toHaveBeenLastCalledWith({ status: null, step: null, page: 1, pageSize: 50 });
  });

  it("reads defaults and stores the legacy config for managers only", async () => {
    expect(await (await request("GET", "/api/cargo-pipeline/config")).json()).toMatchObject({ config: { aktif: false, baslangic_saati: "09:00", sms_gecikme_dk: 30 } });
    const config = { aktif: true, baslangic_saati: "08:30", bitis_saati: "21:00", mesaj_gecikme_dk: 0, sms_gecikme_dk: 15, vapi_gecikme_dk: 45, max_deneme: 4, mesaj_sablonu: "Merhaba {musteri_adi}" };
    expect((await request("PUT", "/api/cargo-pipeline/config", config)).status).toBe(200);
    expect(mocks.settings.get("global.kargo_pipeline_ayarlar")).toEqual(config);
    expect((await request("PUT", "/api/cargo-pipeline/config", { ...config, baslangic_saati: "22:00" })).status).toBe(400);
    expect((await request("PUT", "/api/cargo-pipeline/config", config, "calisan")).status).toBe(403);
    expect((await request("GET", "/api/cargo-pipeline/config", undefined, "calisan")).status).toBe(403);
  });

  it("applies row actions and deletes rows", async () => {
    const run = await request("POST", "/api/cargo-pipeline/cpl_1/actions", { action: "run_now" }, "owner");
    expect(run.status).toBe(200);
    expect(await run.json()).toMatchObject({ item: { public_id: "cpl_1", force_run: true } });
    expect(mocks.pipeline.applyAction).toHaveBeenCalledWith("cpl_1", "run_now", expect.any(Date));
    expect((await request("POST", "/api/cargo-pipeline/cpl_1/actions", { action: "explode" })).status).toBe(400);
    expect((await request("POST", "/api/cargo-pipeline/cpl_x/actions", { action: "cancel" })).status).toBe(404);
    expect((await request("POST", "/api/cargo-pipeline/cpl_1/actions", { action: "cancel" }, "calisan")).status).toBe(403);
    expect((await request("DELETE", "/api/cargo-pipeline/cpl_1")).status).toBe(200);
    expect((await request("DELETE", "/api/cargo-pipeline/cpl_x")).status).toBe(404);
    expect((await request("DELETE", "/api/cargo-pipeline/cpl_1", undefined, "kargo_operatoru")).status).toBe(403);
  });

  it("queues test SMS, channel message and VAPI call with the filled template", async () => {
    mocks.settings.set("global.kargo_pipeline_ayarlar", { mesaj_sablonu: "Sayın {musteri_adi}: {takip_no} {takip_link}" });
    const sms = await request("POST", "/api/cargo-pipeline/test", { type: "sms", phone: "0555 123 45 67", customer_name: "Ali", tracking_number: "KP9", idempotency_key: "t1" });
    expect(sms.status).toBe(202);
    expect(await sms.json()).toMatchObject({ type: "sms", queued: true, message: "Sayın Ali: KP9 https://gonderitakip.ptt.gov.tr/Track/Verify?q=KP9", live_gate: "providers.netgsm.live_mode" });
    expect(jobs[0]).toMatchObject({ name: "netgsm.sms.send", payload: { envelope: { payload: { recipient_phone: "05551234567" } } } });
    expect(mocks.sms.recordMessage).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "cargo_pipeline_test_t1", recipientPhone: "05551234567" }));

    const missingConversation = await request("POST", "/api/cargo-pipeline/test", { type: "mesaj", phone: "05551234567", idempotency_key: "t2" });
    expect(missingConversation.status).toBe(400);
    const channel = await request("POST", "/api/cargo-pipeline/test", { type: "mesaj", phone: "05551234567", conversation_public_id: "cnv_1", idempotency_key: "t2" });
    expect(channel.status).toBe(202);
    expect(await channel.json()).toMatchObject({ type: "mesaj", queued: true, live_gate: "providers.instagram.live_mode" });
    expect(jobs[1]).toMatchObject({ name: "instagram.message.send", payload: { envelope: { payload: { to: "igsid_1", human_agent: true } } } });

    const vapi = await request("POST", "/api/cargo-pipeline/test", { type: "vapi", phone: "05551234567", idempotency_key: "t3" });
    expect(vapi.status).toBe(202);
    expect(await vapi.json()).toMatchObject({ type: "vapi", call_id: "vcl_test", queued: true });
    expect(mocks.vapi.createCall).toHaveBeenCalledWith(expect.objectContaining({ isTest: true, idempotencyKey: "cargo_pipeline_test_t3" }));
    expect(jobs[2]).toMatchObject({ name: "vapi.call.create" });

    expect((await request("POST", "/api/cargo-pipeline/test", { type: "sms", phone: "05551234567", idempotency_key: "t4" }, "calisan")).status).toBe(403);
  });
});
