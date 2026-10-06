import type { AppDatabase } from "@garanti-kulucka/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";
import {
  callSnapshotPatch,
  isCargoNotReceived,
  isWithinCallHours,
  normalizeVapiCallPolicy,
  vapiStatistics,
  vapiWebhookCallId,
  vapiWebhookPatch,
} from "../src/voice/vapi-rules.js";
import { cdrStatistics, filterCdrByDirection, type NetgsmCdrRow } from "../src/voice/netgsm-repository.js";

const mocks = vi.hoisted(() => {
  const now = new Date("2026-10-06T08:00:00.000Z");
  let role = "admin";
  const queueItem = {
    id: 5,
    public_id: "vcq_1",
    shipment_id: 9,
    shipment_public_id: "shp_1",
    customer_phone: "05551112233",
    customer_name: "Ahmet Yılmaz",
    cargo_provider: "ptt",
    tracking_number: "TRK1",
    last_event_text: "Şubede bekliyor",
    status: "bekliyor",
    priority: 0,
    attempt_count: 0,
    max_attempts: 3,
    last_called_at: null as Date | null,
    idempotency_key: "q#shp_1",
    actor_user_id: 10,
    created_at: now,
    updated_at: now,
  };
  const call = {
    id: 7,
    public_id: "vcl_1",
    queue_id: 5,
    shipment_id: 9,
    shipment_public_id: "shp_1",
    vapi_call_id: "call_abc" as string | null,
    customer_phone: "05551112233",
    customer_name: "Ahmet Yılmaz",
    cargo_provider: "ptt",
    tracking_number: "TRK1",
    last_event_text: "Şubede bekliyor",
    status: "basladi",
    summary: null,
    transcript: null as unknown,
    duration_seconds: null,
    cost: null,
    ended_reason: null,
    error_message: null,
    is_test: false,
    idempotency_key: "call_key",
    request_id: "req_vapi_call_call_key",
    job_id: "job_vapi_call_call_key",
    queued: true,
    started_at: now,
    ended_at: null,
    actor_user_id: 10,
    created_at: now,
    updated_at: now,
  };
  const policy = { enabled: true, max_deneme: 3, arama_baslangic_saati: "00:00", arama_bitis_saati: "23:59", tekrar_arama_saat: 24 };
  return {
    now,
    queueItem,
    call,
    policy,
    setRole: (next: string) => {
      role = next;
    },
    authRepository: {
      findUserByPublicId: vi.fn(async () => ({
        id: 10,
        public_id: "usr_test",
        role_id: 1,
        email: "admin@example.com",
        password_hash: "hash",
        first_name: "Admin",
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
    policyModule: {
      readVapiCallPolicy: vi.fn(async () => ({ ...policy })),
      writeVapiCallPolicy: vi.fn(async () => undefined),
      readNetgsmTeyitSettings: vi.fn(async () => ({ aktif: false, ilk_arama_dakika: 5, max_deneme: 3, deneme_arasi_dakika: 10 })),
      writeNetgsmTeyitSettings: vi.fn(async () => undefined),
    },
    vapiRepository: {
      providerReadiness: vi.fn(async () => ({ account_configured: true })),
      listCargoNotReceived: vi.fn(async () => ({
        rows: [
          {
            shipment_public_id: "shp_1",
            tracking_number: "TRK1",
            recipient_phone: "05551112233",
            recipient_name: "Ahmet Yılmaz",
            provider: "ptt",
            last_event_text: "Şubede bekliyor",
            last_event_at: now,
            status: "in_transit",
            created_at: now,
            queued: true,
            queue_status: "bekliyor",
            attempt_count: 1,
            called_last_24h: false,
          },
        ],
        total: 1,
      })),
      addToQueue: vi.fn(async () => ({ added: 1, skipped: 1, replayed: 0 })),
      listQueue: vi.fn(async () => ({ rows: [queueItem], total: 1 })),
      listWaitingQueue: vi.fn(async () => [queueItem]),
      getQueueItem: vi.fn(async () => queueItem as typeof queueItem | null),
      deleteQueueItem: vi.fn(async () => true),
      setQueueStatus: vi.fn(async () => undefined),
      markQueueCalling: vi.fn(async () => undefined),
      findShipmentId: vi.fn(async () => null),
      findCallByIdempotencyKey: vi.fn(async (): Promise<typeof call | null> => null),
      createCall: vi.fn(async () => "vcl_1"),
      markCallQueued: vi.fn(async () => undefined),
      getCall: vi.fn(async () => call as typeof call | null),
      listCalls: vi.fn(async () => ({ rows: [call], total: 1 })),
      statisticsInput: vi.fn(async () => ({
        calls: [
          { status: "tamamlandi", duration_seconds: 60, cost: "0.1000" },
          { status: "cevapsiz", duration_seconds: null, cost: null },
        ],
        queueWaiting: 4,
      })),
      listWebhookEvents: vi.fn(async () => ({
        rows: [
          {
            public_id: "whe_1",
            event_type: "status-update",
            external_event_id: null,
            status: "received",
            received_at: now,
            raw_payload: { body: { message: { type: "end-of-call-report", call: { id: "call_abc" }, endedReason: "customer-busy" } } },
          },
        ],
        total: 1,
      })),
      getWebhookEvent: vi.fn(async () => null),
      reconcileOpenCalls: vi.fn(async () => undefined),
    },
    netgsmRepository: {
      isConfigured: vi.fn(async () => true),
      latestCdrSnapshot: vi.fn(async () => ({
        request_id: "req_netgsm_call_report_x",
        status: "success",
        synced_at: now,
        error_message: null,
        records: [
          { id: "1", tarih: "06.10.2026 10:00", arayanNumara: "905551112233", arayanAdi: "", arananNumara: "908501", yontem: "Sesli", sure: "00:01:00", sureSaniye: 60, yon: "Gelen Arama", yonKod: 1, sesKaydi: "https://rec/1.mp3", hat: null },
          { id: "2", tarih: "06.10.2026 11:00", arayanNumara: "908501", arayanAdi: "", arananNumara: "905550000000", yontem: "Sesli", sure: "00:00:30", sureSaniye: 30, yon: "Giden Arama", yonKod: 0, sesKaydi: null, hat: null },
        ],
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

vi.mock("../src/voice/policy.js", () => mocks.policyModule);

vi.mock("../src/voice/repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/voice/repository.js")>();
  return {
    ...actual,
    VapiRepository: vi.fn(function VapiRepository() {
      return mocks.vapiRepository;
    }),
  };
});

vi.mock("../src/voice/netgsm-repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/voice/netgsm-repository.js")>();
  return {
    ...actual,
    NetgsmVoiceRepository: vi.fn(function NetgsmVoiceRepository() {
      return mocks.netgsmRepository;
    }),
  };
});

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "vapi-voice-route-test-secret-value",
  encryptionKey: "vapi-voice-route-encryption-key",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

const published: Array<{ job_id: string; name: string; payload: { envelope: { payload: Record<string, unknown>; provider: string; operation: string; request_id: string } } }> = [];
const publisher = {
  publish: vi.fn(async (job: (typeof published)[number]) => {
    published.push(job);
    return job.job_id;
  }),
};

async function token(role = "admin") {
  mocks.setRole(role);
  return signAccessToken({ user_public_id: "usr_test", session_public_id: "ses_test", role }, config);
}

function app() {
  return createApp({ config, db: {} as AppDatabase, providerDeliveryQueuePublisher: publisher as never });
}

async function request(method: string, path: string, body?: unknown, role = "admin") {
  return app().request(path, {
    method,
    headers: { authorization: `Bearer ${await token(role)}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("VAPI voice routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    published.length = 0;
    mocks.policyModule.readVapiCallPolicy.mockImplementation(async () => ({ ...mocks.policy }));
  });

  it("is admin only like legacy App.jsx", async () => {
    for (const path of ["/api/vapi/statistics", "/api/vapi/queue", "/api/netgsm/cdr"]) {
      const response = await request("GET", path, undefined, "calisan");
      expect(response.status).toBe(403);
    }
  });

  it("returns legacy statistics with queue waiting count", async () => {
    const response = await request("GET", "/api/vapi/statistics");
    expect(response.status).toBe(200);
    expect(mocks.vapiRepository.reconcileOpenCalls).toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      statistics: { toplam_arama: 2, cevaplanan: 1, cevapsiz: 1, kuyruk_bekleyen: 4, basari_orani: 50, toplam_maliyet: "0.1000" },
    });
  });

  it("lists cargo-not-received customers with legacy field names and validates the provider filter", async () => {
    const response = await request("GET", "/api/vapi/cargo-not-received?provider=ptt&page=1&page_size=25");
    expect(response.status).toBe(200);
    expect(mocks.vapiRepository.listCargoNotReceived).toHaveBeenCalledWith(expect.objectContaining({ provider: "ptt", limit: 25, offset: 0 }));
    await expect(response.json()).resolves.toMatchObject({
      total: 1,
      data: [{ id: "shp_1", alici_ad: "Ahmet Yılmaz", alici_telefon: "05551112233", kargo_firmasi: "ptt", kuyrukta: true, kuyruk_durumu: "bekliyor" }],
    });
    expect((await request("GET", "/api/vapi/cargo-not-received?provider=aras")).status).toBe(400);
  });

  it("adds to the queue with policy max attempts and requires an idempotency key", async () => {
    const response = await request("POST", "/api/vapi/queue", {
      items: [{ shipment_public_id: "shp_1", customer_phone: "05551112233", customer_name: "Ahmet" }],
      idempotency_key: "queue_1",
    });
    expect(response.status).toBe(201);
    expect(mocks.vapiRepository.addToQueue).toHaveBeenCalledWith(expect.objectContaining({ maxAttempts: 3, idempotencyKey: "queue_1" }));
    await expect(response.json()).resolves.toMatchObject({ eklenen: 1, atlanan: 1 });
    expect((await request("POST", "/api/vapi/queue", { items: [] })).status).toBe(400);
  });

  it("lists and deletes queue rows", async () => {
    const list = await request("GET", "/api/vapi/queue?status=bekliyor");
    await expect(list.json()).resolves.toMatchObject({ data: [{ id: "vcq_1", durum: "bekliyor", deneme_sayisi: 0, max_deneme: 3, kargo_id: "shp_1" }] });
    expect((await request("GET", "/api/vapi/queue?status=bogus")).status).toBe(400);
    expect((await request("DELETE", "/api/vapi/queue/vcq_1")).status).toBe(200);
    mocks.vapiRepository.deleteQueueItem.mockResolvedValueOnce(false);
    expect((await request("DELETE", "/api/vapi/queue/vcq_x")).status).toBe(404);
  });

  it("queues a single vapi.call.create job and marks the queue row as araniyor", async () => {
    const response = await request("POST", "/api/vapi/calls", {
      queue_public_id: "vcq_1",
      customer_phone: "05551112233",
      customer_name: "Ahmet Yılmaz",
      cargo_provider: "ptt",
      tracking_number: "TRK1",
      last_event_text: "Şubede bekliyor",
      idempotency_key: "call_key",
    });
    expect(response.status).toBe(202);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ name: "vapi.call.create", job_id: "job_vapi_call_call_key" });
    expect(published[0]?.payload.envelope).toMatchObject({
      provider: "vapi",
      operation: "call.create",
      payload: { customer_phone: "05551112233", tracking_number: "TRK1", idempotency_key: "call_key", call_public_id: "vcl_1" },
    });
    expect(mocks.vapiRepository.markQueueCalling).toHaveBeenCalledWith(5, expect.any(Date));
    await expect(response.json()).resolves.toMatchObject({ call_id: "vcl_1", live_gate: "providers.vapi.live_mode", live_call_permitted: false });
  });

  it("replays idempotent single calls, rejects mismatched reuse and disabled VAPI", async () => {
    mocks.vapiRepository.findCallByIdempotencyKey.mockResolvedValueOnce(mocks.call);
    const replay = await request("POST", "/api/vapi/calls", { customer_phone: "05551112233", tracking_number: "TRK1", idempotency_key: "call_key" });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ replayed: true });

    mocks.vapiRepository.findCallByIdempotencyKey.mockResolvedValueOnce(mocks.call);
    const conflict = await request("POST", "/api/vapi/calls", { customer_phone: "05559999999", idempotency_key: "call_key" });
    expect(conflict.status).toBe(409);

    mocks.policyModule.readVapiCallPolicy.mockResolvedValueOnce({ ...mocks.policy, enabled: false });
    const disabled = await request("POST", "/api/vapi/calls", { customer_phone: "05551112233", idempotency_key: "new_key" });
    expect(disabled.status).toBe(400);
    await expect(disabled.json()).resolves.toMatchObject({ error: { message: "VAPI devre dışı. Ayarlardan etkinleştirin." } });
    expect(published).toHaveLength(0);
  });

  it("runs bulk calls with max-attempt and recall-window rules", async () => {
    mocks.vapiRepository.listWaitingQueue.mockResolvedValueOnce([
      { ...mocks.queueItem },
      { ...mocks.queueItem, id: 6, public_id: "vcq_2", attempt_count: 3 },
      { ...mocks.queueItem, id: 8, public_id: "vcq_3", last_called_at: new Date(Date.now() - 60 * 60 * 1000) },
    ]);
    const response = await request("POST", "/api/vapi/calls/bulk", { idempotency_key: "bulk_1" });
    expect(response.status).toBe(202);
    expect(published).toHaveLength(1);
    expect(published[0]?.payload.envelope.payload).toMatchObject({ idempotency_key: "bulk_1:vcq_1" });
    expect(mocks.vapiRepository.setQueueStatus).toHaveBeenCalledWith(6, "basarisiz");
    await expect(response.json()).resolves.toMatchObject({ aranan: 1, hatali: 0, toplam_kuyruk: 3 });
  });

  it("rejects bulk calls outside call hours with the legacy message", async () => {
    mocks.policyModule.readVapiCallPolicy.mockResolvedValueOnce({ ...mocks.policy, arama_baslangic_saati: "23:59", arama_bitis_saati: "00:00" });
    const response = await request("POST", "/api/vapi/calls/bulk", { idempotency_key: "bulk_2" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "outside_call_hours", message: "Arama saatleri dışında. Aramalar 23:59-00:00 arasında yapılabilir." },
    });
    expect(published).toHaveLength(0);
  });

  it("lists calls with filters and queues a call.get backfill for an open call detail", async () => {
    const list = await request("GET", "/api/vapi/calls?status=basladi&q=Ahmet&page=1&page_size=20");
    expect(mocks.vapiRepository.listCalls).toHaveBeenCalledWith({ status: "basladi", search: "Ahmet", limit: 20, offset: 0 });
    await expect(list.json()).resolves.toMatchObject({ data: [{ id: "vcl_1", vapi_call_id: "call_abc", durum: "basladi" }] });

    const detail = await request("GET", "/api/vapi/calls/vcl_1");
    expect(detail.status).toBe(200);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ name: "vapi.call.get" });
    expect(published[0]?.payload.envelope).toMatchObject({ operation: "call.get", payload: { vapi_call_id: "call_abc" } });
    expect(published[0]?.payload.envelope.request_id.startsWith("req_vapi_call_get_vcl_1_")).toBe(true);
    await expect(detail.json()).resolves.toMatchObject({ backfill_queued: true });

    mocks.vapiRepository.getCall.mockResolvedValueOnce(null);
    expect((await request("GET", "/api/vapi/calls/vcl_x")).status).toBe(404);
  });

  it("exposes webhook history derived from frozen call.webhook ingestion", async () => {
    const response = await request("GET", "/api/vapi/webhooks?call_id=call_abc");
    await expect(response.json()).resolves.toMatchObject({
      data: [{ public_id: "whe_1", event_type: "end-of-call-report", vapi_call_id: "call_abc", ended_reason: "customer-busy" }],
    });
    expect((await request("GET", "/api/vapi/webhooks/whe_x")).status).toBe(404);
  });

  it("reads and validates the call policy config", async () => {
    const get = await request("GET", "/api/vapi/config");
    await expect(get.json()).resolves.toMatchObject({ config: { enabled: true }, provider: { account_configured: true, live_gate: "providers.vapi.live_mode" } });
    const put = await request("PUT", "/api/vapi/config", { ...mocks.policy, max_deneme: 5 });
    expect(put.status).toBe(200);
    expect(mocks.policyModule.writeVapiCallPolicy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ max_deneme: 5 }));
    expect((await request("PUT", "/api/vapi/config", { ...mocks.policy, arama_baslangic_saati: "9" })).status).toBe(400);
  });
});

describe("NetGSM voice routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    published.length = 0;
  });

  it("queues a netgsm.call.report sync and serves the latest CDR snapshot by direction", async () => {
    const sync = await request("POST", "/api/netgsm/cdr/sync", { baslangic_tarih: "2026-10-01", bitis_tarih: "2026-10-06", idempotency_key: "cdr_1" });
    expect(sync.status).toBe(202);
    expect(published[0]).toMatchObject({ name: "netgsm.call.report" });
    expect(published[0]?.payload.envelope.payload).toEqual({ start_date: "2026-10-01", stop_date: "2026-10-06" });

    const gelen = await request("GET", "/api/netgsm/cdr?yon=gelen&sayfa=1&sayfa_boyutu=10");
    await expect(gelen.json()).resolves.toMatchObject({ success: true, data: { toplamKayit: 1, toplamSure: "00:01:00", kayitlar: [{ yonKod: 1 }] } });

    const stats = await request("GET", "/api/netgsm/cdr/istatistik");
    await expect(stats.json()).resolves.toMatchObject({ data: { gelenArama: 1, gidenArama: 1, gelenCevapli: 1, cevaplananOran: 100, toplamGorisme: 2 } });

    const status = await request("GET", "/api/netgsm/status");
    await expect(status.json()).resolves.toMatchObject({ configured: true });
  });

  it("returns the worker failure as an API error and validates teyit settings", async () => {
    mocks.netgsmRepository.latestCdrSnapshot.mockResolvedValueOnce({
      request_id: "r",
      status: "terminal_failure",
      synced_at: mocks.now,
      error_message: "Geçersiz kullanıcı adı veya şifre veya API erişim izni yok",
      records: [],
    });
    const failed = await request("GET", "/api/netgsm/cdr?yon=giden");
    await expect(failed.json()).resolves.toMatchObject({ success: false, error: "Geçersiz kullanıcı adı veya şifre veya API erişim izni yok" });

    const ok = await request("PUT", "/api/netgsm/teyit-settings", { aktif: true, ilk_arama_dakika: 5, max_deneme: 3, deneme_arasi_dakika: 10 });
    expect(ok.status).toBe(200);
    const bad = await request("PUT", "/api/netgsm/teyit-settings", { aktif: true, ilk_arama_dakika: 0, max_deneme: 3, deneme_arasi_dakika: 10 });
    expect(bad.status).toBe(400);
  });
});

describe("VAPI legacy rules", () => {
  it("filters cargo-not-received texts like KARGO_ALMAYAN_KEYWORDS", () => {
    expect(isCargoNotReceived("Şubede bekliyor")).toBe(true);
    expect(isCargoNotReceived("ADRESTE BULUNAMADI")).toBe(true);
    expect(isCargoNotReceived("Teslim edildi")).toBe(false);
    expect(isCargoNotReceived("İade sürecinde, şubede bekliyor")).toBe(false);
    expect(isCargoNotReceived("Dağıtımda")).toBe(false);
    expect(isCargoNotReceived(null)).toBe(false);
  });

  it("maps webhook events like legacy /api/vapi/webhook", () => {
    const at = new Date("2026-10-06T10:00:00.000Z");
    expect(vapiWebhookCallId({ message: { call: { id: "c1" } } })).toBe("c1");
    expect(vapiWebhookPatch({ message: { type: "status-update", status: "in-progress", call: { id: "c1" } } }, at)).toEqual({
      patch: { status: "cevaplandi" },
      ended: false,
      unanswered: false,
    });
    const busy = vapiWebhookPatch({ message: { type: "end-of-call-report", endedReason: "customer-busy", call: { id: "c1" } } }, at);
    expect(busy).toMatchObject({ ended: true, unanswered: true, patch: { status: "cevapsiz" } });
    const done = vapiWebhookPatch(
      { message: { type: "end-of-call-report", summary: "Özet", transcript: "AI: Merhaba", durationSeconds: 61.6, cost: 0.12, call: { id: "c1" } } },
      at,
    );
    expect(done).toMatchObject({ ended: true, unanswered: false, patch: { status: "tamamlandi", summary: "Özet", transcript: { text: "AI: Merhaba" }, duration_seconds: 62, cost: "0.12" } });
    expect(vapiWebhookPatch({ message: { type: "transcript", call: { id: "c1" } } }, at)).toBeNull();
  });

  it("applies call.get backfill only for ended calls", () => {
    expect(callSnapshotPatch({ ended: false })).toBeNull();
    expect(
      callSnapshotPatch({ ended: true, ended_at: "2026-10-06T10:01:00.000Z", summary: "S", transcript: "T", duration_seconds: 60, cost: 0.2 }),
    ).toMatchObject({ status: "tamamlandi", summary: "S", transcript: { text: "T" }, duration_seconds: 60, cost: "0.2" });
  });

  it("computes statistics and call-hour policy", () => {
    expect(vapiStatistics({ calls: [], queueWaiting: 0 })).toMatchObject({ toplam_arama: 0, basari_orani: 0, toplam_maliyet: "0.0000" });
    const policy = normalizeVapiCallPolicy({ enabled: true, arama_baslangic_saati: "09:00", arama_bitis_saati: "18:00" });
    expect(policy).toMatchObject({ enabled: true, max_deneme: 3, tekrar_arama_saat: 24 });
    expect(isWithinCallHours(policy, new Date("2026-10-06T07:00:00.000Z"))).toBe(true); // 10:00 TR
    expect(isWithinCallHours(policy, new Date("2026-10-06T17:30:00.000Z"))).toBe(false); // 20:30 TR
  });

  it("computes NetGSM CDR statistics like legacy /api/netgsm/cdr/istatistik", () => {
    const rows = [
      { yonKod: 1, sureSaniye: 30 },
      { yonKod: 2, sureSaniye: 0 },
      { yonKod: 0, sureSaniye: 90 },
    ] as NetgsmCdrRow[];
    expect(filterCdrByDirection(rows, "giden")).toHaveLength(1);
    expect(cdrStatistics(rows)).toEqual({
      gelenArama: 2,
      gidenArama: 1,
      gelenCevapli: 1,
      gelenCevapsiz: 1,
      toplamSure: "00:02:00",
      toplamGorisme: 3,
      ortalamaSure: "00:00:40",
      cevaplananOran: 50,
    });
  });
});
