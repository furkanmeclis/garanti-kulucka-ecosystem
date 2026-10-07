import type { AppDatabase } from "@garanti-kulucka/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const mocks = vi.hoisted(() => {
  const now = new Date("2026-10-06T08:00:00.000Z");
  let role = "admin";
  const baseRow = {
    id: 3,
    public_id: "vms_1",
    recipients: ["05551112233", "05559998877"] as unknown,
    recipient_count: 2,
    message_text: "Siparişiniz kargoda" as string | null,
    audio_id: null as string | null,
    ringtime: 20,
    status: "queued",
    bulk_id: null as string | null,
    error_message: null as string | null,
    request_id: "req_netgsm_voice_message_k1_abcd",
    job_id: "job_netgsm_voice_message_vms_1" as string | null,
    report_request_id: null as string | null,
    report: null as unknown,
    report_checked_at: null as Date | null,
    idempotency_key: "k1",
    created_by_user_id: 10,
    created_at: now,
    updated_at: now,
  };
  type Row = typeof baseRow;
  const state = { row: { ...baseRow } as Row };
  const attempts = new Map<string, { status: string; response_metadata: unknown; error_message: string | null }>();
  return {
    now,
    baseRow,
    state,
    attempts,
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
    voiceRepository: {
      activeAccountPublicId: vi.fn(async (): Promise<string | null> => "iac_netgsm"),
      findByIdempotencyKey: vi.fn(async (): Promise<Row | null> => null),
      get: vi.fn(async (publicId: string) => (publicId === state.row.public_id ? state.row : null)),
      create: vi.fn(async (input: { recipients: string[]; messageText: string | null; audioId: string | null; ringtime: number; requestId: string; idempotencyKey: string }) => {
        state.row = { ...baseRow, recipients: input.recipients, recipient_count: input.recipients.length, message_text: input.messageText, audio_id: input.audioId, ringtime: input.ringtime, request_id: input.requestId, idempotency_key: input.idempotencyKey, job_id: null };
        return state.row;
      }),
      update: vi.fn(async (_id: number, changes: Partial<Row>) => {
        state.row = { ...state.row, ...changes };
        return state.row;
      }),
      list: vi.fn(async () => ({ rows: [state.row], total_count: 1, recipient_total: state.row.recipient_count })),
      latestAttempt: vi.fn(async (requestId: string) => attempts.get(requestId) ?? null),
      phonebook: vi.fn(async () => ({
        rows: [
          { kind: "staff", public_id: "usr_1", name: "Ayşe Operatör", phone: null, extension: "1001", role: "calisan" },
          { kind: "customer", public_id: "cus_1", name: "Ahmet Yılmaz", phone: "05551112233", extension: null, role: null },
        ],
        total_count: 2,
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

vi.mock("../src/voice/voice-message-repository.js", () => ({
  VoiceMessageRepository: vi.fn(function VoiceMessageRepository() {
    return mocks.voiceRepository;
  }),
}));

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/auth/tokens.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "voice-message-route-test-secret-value",
  encryptionKey: "voice-message-route-encryption-key",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

type PublishedJob = { job_id: string; name: string; payload: { envelope: { payload: Record<string, unknown>; provider: string; operation: string; request_id: string; account_public_id?: string } } };
const published: PublishedJob[] = [];
const publisher = {
  publish: vi.fn(async (job: PublishedJob) => {
    published.push(job);
    return job.job_id;
  }),
};

async function request(method: string, path: string, body?: unknown, role = "admin") {
  mocks.setRole(role);
  const token = await signAccessToken({ user_public_id: "usr_test", session_public_id: "ses_test", role }, config);
  return createApp({ config, db: {} as AppDatabase, providerDeliveryQueuePublisher: publisher as never }).request(path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("NetGSM voice message and phonebook routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    published.length = 0;
    mocks.attempts.clear();
    mocks.state.row = { ...mocks.baseRow };
  });

  it("is admin only (owner and admin are managers)", async () => {
    for (const [method, path] of [
      ["GET", "/api/netgsm/sesli-mesaj"],
      ["POST", "/api/netgsm/sesli-mesaj"],
      ["GET", "/api/netgsm/sesli-mesaj/vms_1"],
      ["POST", "/api/netgsm/sesli-mesaj/vms_1/rapor"],
      ["GET", "/api/netgsm/rehber"],
    ] as const) {
      expect((await request(method, path, method === "POST" ? {} : undefined, "calisan")).status).toBe(403);
    }
    expect((await request("GET", "/api/netgsm/rehber", undefined, "owner")).status).toBe(200);
    expect((await app401()).status).toBe(401);
  });

  it("queues netgsm.voice.message.send with deduplicated numbers and the active account", async () => {
    const response = await request("POST", "/api/netgsm/sesli-mesaj", {
      recipients: ["0555 111 22 33", "05559998877", "05551112233"],
      message: "Siparişiniz kargoda",
      ringtime: 25,
      idempotency_key: "k1",
    });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { voice_message: { status: string; recipient_count: number; recipients: string[] }; queued: boolean; live_call_permitted: boolean };
    expect(body).toMatchObject({ queued: true, live_call_permitted: false });
    expect(body.voice_message).toMatchObject({ status: "queued", recipient_count: 2, recipients: ["05551112233", "05559998877"] });
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ name: "netgsm.voice.message.send", job_id: "job_netgsm_voice_message_vms_1" });
    expect(published[0]?.payload.envelope).toMatchObject({
      provider: "netgsm",
      operation: "voice.message.send",
      account_public_id: "iac_netgsm",
      payload: { recipients: ["05551112233", "05559998877"], message: "Siparişiniz kargoda", ringtime: 25, recipient_count: 2 },
    });
  });

  it("validates the payload and replays or rejects reused idempotency keys", async () => {
    for (const payload of [
      { recipients: [], message: "x", idempotency_key: "a" },
      { recipients: ["05551112233"], idempotency_key: "a" },
      { recipients: ["05551112233"], message: "x", audio_id: "12", idempotency_key: "a" },
      { recipients: ["abc"], message: "x", idempotency_key: "a" },
      { recipients: ["05551112233"], message: "x", ringtime: 45, idempotency_key: "a" },
    ]) {
      expect((await request("POST", "/api/netgsm/sesli-mesaj", payload)).status).toBe(400);
    }
    mocks.voiceRepository.findByIdempotencyKey.mockResolvedValueOnce(mocks.state.row);
    const replay = await request("POST", "/api/netgsm/sesli-mesaj", { recipients: ["05551112233", "05559998877"], message: "Siparişiniz kargoda", idempotency_key: "k1" });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true });
    mocks.voiceRepository.findByIdempotencyKey.mockResolvedValueOnce(mocks.state.row);
    const conflict = await request("POST", "/api/netgsm/sesli-mesaj", { recipients: ["05551112233"], message: "Başka", idempotency_key: "k1" });
    expect(conflict.status).toBe(409);
    expect(published).toHaveLength(0);
  });

  it("reads the send attempt back: live success stores the bulk id, dry run and failures are explicit", async () => {
    mocks.attempts.set(mocks.baseRow.request_id, { status: "success", response_metadata: { live_call_performed: false }, error_message: null });
    let detail = (await (await request("GET", "/api/netgsm/sesli-mesaj/vms_1")).json()) as { voice_message: { status: string; error_message: string; bulk_id: string | null } };
    expect(detail.voice_message.status).toBe("dry_run");
    expect(detail.voice_message.error_message).toContain("providers.netgsm.live_mode");

    mocks.state.row = { ...mocks.baseRow };
    mocks.attempts.set(mocks.baseRow.request_id, { status: "terminal_failure", response_metadata: {}, error_message: "30 - Geçersiz kullanıcı" });
    detail = (await (await request("GET", "/api/netgsm/sesli-mesaj/vms_1")).json()) as typeof detail;
    expect(detail.voice_message).toMatchObject({ status: "failed", error_message: "30 - Geçersiz kullanıcı" });

    mocks.state.row = { ...mocks.baseRow };
    mocks.attempts.set(mocks.baseRow.request_id, { status: "success", response_metadata: JSON.stringify({ result: { success: true, bulkId: 987654, netgsm_code: "00" } }), error_message: null });
    const list = (await (await request("GET", "/api/netgsm/sesli-mesaj?status=queued&limit=10")).json()) as { data: Array<{ status: string; bulk_id: string }>; recipient_total: number };
    expect(list.data[0]).toMatchObject({ status: "sent", bulk_id: "987654" });
    expect(list.recipient_total).toBe(2);
    expect((await request("GET", "/api/netgsm/sesli-mesaj?status=bogus")).status).toBe(400);
    expect((await request("GET", "/api/netgsm/sesli-mesaj/vms_missing")).status).toBe(404);
  });

  it("queues netgsm.voice.message.report by bulk id and stores the per-number report", async () => {
    const early = await request("POST", "/api/netgsm/sesli-mesaj/vms_1/rapor", { idempotency_key: "r1" });
    expect(early.status).toBe(409);

    mocks.state.row = { ...mocks.baseRow, status: "sent", bulk_id: "987654" };
    const queued = await request("POST", "/api/netgsm/sesli-mesaj/vms_1/rapor", { idempotency_key: "r1" });
    expect(queued.status).toBe(202);
    expect(published[0]).toMatchObject({ name: "netgsm.voice.message.report" });
    expect(published[0]?.payload.envelope).toMatchObject({ operation: "voice.message.report", payload: { bulk_id: "987654", voice_message_public_id: "vms_1" } });
    expect(mocks.state.row.report_request_id).toBe("req_netgsm_voice_report_r1");
    expect((await request("POST", "/api/netgsm/sesli-mesaj/vms_1/rapor", { idempotency_key: "r1" })).status).toBe(200);
    expect(published).toHaveLength(1);

    mocks.attempts.set("req_netgsm_voice_report_r1", {
      status: "success",
      response_metadata: { result: { report_ready: true, rows: [{ phone: "05551112233", status: "cevaplandi", pressed_key: null, listen_seconds: 12 }] } },
      error_message: null,
    });
    const detail = (await (await request("GET", "/api/netgsm/sesli-mesaj/vms_1")).json()) as { voice_message: { report: { report_ready: boolean; rows: unknown[] }; report_checked_at: string | null } };
    expect(detail.voice_message.report).toMatchObject({ report_ready: true, rows: [{ phone: "05551112233", status: "cevaplandi" }] });
    expect(detail.voice_message.report_checked_at).not.toBeNull();
  });

  it("serves the phonebook from customers and staff SIP extensions", async () => {
    const response = await request("GET", "/api/netgsm/rehber?kind=staff&search=ay&limit=20");
    expect(response.status).toBe(200);
    expect(mocks.voiceRepository.phonebook).toHaveBeenCalledWith({ kind: "staff", search: "ay", limit: 20, offset: 0 });
    expect(await response.json()).toMatchObject({ total_count: 2, data: [{ kind: "staff", extension: "1001" }, { kind: "customer" }] });
    expect((await request("GET", "/api/netgsm/rehber?kind=vendor")).status).toBe(400);
  });
});

function app401() {
  return createApp({ config, db: {} as AppDatabase, providerDeliveryQueuePublisher: publisher as never }).request("/api/netgsm/rehber");
}
