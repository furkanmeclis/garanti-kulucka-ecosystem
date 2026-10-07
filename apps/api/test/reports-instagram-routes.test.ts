import type { AppDatabase } from "@garanti-kulucka/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiConfig } from "../src/config.js";

const routeMocks = vi.hoisted(() => {
  const now = new Date("2026-10-06T09:00:00.000Z");
  let role = "admin";
  const publication = {
    id: 1,
    public_id: "igp_1",
    account_id: 7,
    media_kind: "image",
    media_type: "IMAGE",
    media_url: "https://cdn.example.com/photo.jpg",
    file_id: null as number | null,
    caption: "Yeni ürün",
    idempotency_key: "ig_key_1",
    request_id: "req_igpub_ig_key_1_abcd",
    job_id: "job_igpub_ig_key_1",
    queued: true,
    created_by_user_id: 10,
    created_at: now,
    updated_at: now,
  };
  const account = {
    id: 7,
    public_id: "iac_1",
    display_name: "garantikulucka",
    external_account_id: "1789",
    status: "active",
    metadata: {
      analytics: {
        followers: { followers_count: 1520, media_count: 88 },
        insights: [
          {
            name: "reach",
            period: "day",
            values: [
              { value: 10, end_time: "2026-09-20T07:00:00+0000" },
              { value: 40, end_time: "2026-10-04T07:00:00+0000" },
              { value: 60, end_time: "2026-10-05T07:00:00+0000" },
            ],
          },
          { name: "impressions", period: "day", values: [{ value: 300, end_time: "2026-10-05T07:00:00+0000" }] },
          { name: "follower_count", period: "day", values: [{ value: 5, end_time: "2026-10-05T07:00:00+0000" }] },
        ],
      },
    },
  };

  return {
    now,
    publication,
    account,
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
    reportRepository: {
      getAggregates: vi.fn(async () => ({
        metrics: {
          toplam: 5,
          ciro: 350.5,
          iptal: 1,
          iade: 1,
          sevk_edildi: 1,
          teslim_edildi: 1,
          kargoya_giden: 2,
          ptt: 1,
          surat: 1,
          ptt_subede: 1,
          surat_subede: 1,
          teyit_edildi: 2,
          teyit_bekliyor: 1,
          kargo_iade: 1,
          ptt_kargo_iade: 1,
          surat_kargo_iade: 0,
          kargo_takip_iade: 1,
        },
        statusCounts: [
          { status: "iade", count: 1 },
          { status: "teyit_bekliyor", count: 1 },
          { status: "sevk_edildi", count: 1 },
          { status: "teslim_edildi", count: 1 },
          { status: "iptal", count: 1 },
        ],
        daily: [
          { date: "2026-10-02", orders: 2, revenue: 200, cancelled: 1, returned: 0 },
          { date: "2026-10-01", orders: 1, revenue: 100, cancelled: 0, returned: 0 },
          { date: "2026-10-03", orders: 2, revenue: 50.5, cancelled: 0, returned: 1 },
        ],
        personnel: [
          { user_public_id: "usr_c", first_name: "Can", last_name: "Kaya", listed: true, orders: 2, revenue: 200, cancelled: 1 },
          { user_public_id: "usr_a", first_name: "Ayşe", last_name: "Yılmaz Demir", listed: true, orders: 3, revenue: 100, cancelled: 0 },
          { user_public_id: "usr_x", first_name: "Eski", last_name: "Personel", listed: false, orders: 1, revenue: 10, cancelled: 0 },
        ],
        personnelOptions: [{ public_id: "usr_a", first_name: "Ayşe", last_name: "Yılmaz Demir" }],
      })),
    },
    instagramRepository: {
      findAccount: vi.fn(async (_publicId: string | null) => account as typeof account | null),
      findMediaFile: vi.fn(async (): Promise<unknown> => null),
      findByIdempotencyKey: vi.fn(async (): Promise<unknown> => null),
      recordPublication: vi.fn(async (input: Record<string, unknown>) => ({
        ...publication,
        media_kind: input.mediaKind,
        media_type: input.mediaType,
        media_url: input.mediaUrl,
        file_id: input.fileId,
        caption: input.caption,
        idempotency_key: input.idempotencyKey,
        request_id: input.requestId,
        job_id: input.jobId,
        queued: input.queued,
      })),
      getPublication: vi.fn(async (): Promise<unknown> => null),
    },
    storage: {
      createDownloadInstruction: vi.fn(async (objectKey: string) => ({
        method: "GET",
        bucket: "garage-media",
        object_key: objectKey,
        headers: {},
        presigned_url: `https://garage.example.com/${objectKey}?X-Amz-Signature=abc`,
        expires_at: "2026-10-06T10:00:00.000Z",
      })),
    },
  };
});

vi.mock("../src/auth/repository.js", () => ({
  AuthRepository: vi.fn(function AuthRepository() {
    return routeMocks.authRepository;
  }),
  isAdminRole: (role: string) => role === "admin" || role === "owner",
}));

vi.mock("../src/reports/repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/reports/repository.js")>();
  return {
    ...actual,
    ReportRepository: vi.fn(function ReportRepository() {
      return routeMocks.reportRepository;
    }),
  };
});

vi.mock("../src/instagram/repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/instagram/repository.js")>();
  return {
    ...actual,
    InstagramRepository: vi.fn(function InstagramRepository() {
      return routeMocks.instagramRepository;
    }),
  };
});

vi.mock("../src/files/storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/files/storage.js")>();
  return { ...actual, createMediaStorageFromEnv: () => routeMocks.storage };
});

vi.mock("../src/files/policy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/files/policy.js")>();
  return {
    ...actual,
    loadStoragePolicies: async () => ({
      upload: { allowedContentTypes: ["image/jpeg"], maxUploadBytes: 1, requireSha256Checksum: true },
      malwareScan: { required: false },
    }),
    scanStatusAllowsDownload: (status: string) => status !== "infected",
  };
});

const { createApp } = await import("../src/app.js");
const { signAccessToken } = await import("../src/auth/tokens.js");
const reports = await import("../src/reports/repository.js");
const instagram = await import("../src/instagram/repository.js");

const config: ApiConfig = {
  databaseUrl: null,
  jwtSecret: "reports-instagram-route-test-secret",
  encryptionKey: "reports-instagram-route-encryption",
  encryptionKeyId: "test",
  accessTokenTtlSeconds: 300,
  refreshTokenTtlDays: 30,
  redisUrl: null,
  corsOrigin: null,
};

const published: Array<{ job_id: string; name: string; queue: string; payload: { envelope: Record<string, unknown> & { payload: Record<string, unknown> } } }> = [];
const publisher = {
  publish: vi.fn(async (job: (typeof published)[number]) => {
    published.push(job);
    return job.job_id;
  }),
};

async function token(role: string) {
  routeMocks.setRole(role);
  return signAccessToken({ user_public_id: "usr_test", session_public_id: "ses_test", role }, config);
}

function app() {
  return createApp({ config, db: {} as AppDatabase, providerDeliveryQueuePublisher: publisher as never });
}

async function call(method: string, path: string, role: string, body?: unknown) {
  return app().request(path, {
    method,
    headers: { authorization: `Bearer ${await token(role)}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("legacy RaporlarPage KPI formulas", () => {
  it("derives aktif, şubede, every legacy rate and chart breakdown from SQL aggregates", async () => {
    const aggregates = await routeMocks.reportRepository.getAggregates();
    const analysis = reports.buildReportAnalysis(
      { startDate: "2026-10-01", endDate: "2026-10-03", personnelPublicId: null, cargoProvider: "tumu" },
      aggregates,
    );

    expect(analysis.metrics).toMatchObject({ toplam: 5, aktif: 3, ciro: 350.5, subede_toplam: 2 });
    expect(analysis.rates).toEqual({
      teslim: 50, // teslim / (sevk + teslim)
      iptal: 20, // iptal / toplam
      iade: 20, // iade / toplam
      kargo_iade: 50, // kargo iadesi / kargoya verilenler
      teyit: 66.7, // teyit edildi / aktif
      sube: 100, // şubede / kargolanan
    });
    expect(analysis.status_distribution.map((row) => row.status)).toEqual([
      "teyit_bekliyor",
      "sevk_edildi",
      "teslim_edildi",
      "iptal",
      "iade",
    ]);
    expect(analysis.cargo_providers).toEqual([
      { provider: "ptt", active: 1, returns: 1 },
      { provider: "surat", active: 1, returns: 0 },
    ]);
    expect(analysis.personnel_performance).toEqual([
      { user_public_id: "usr_a", name: "Ayşe Yılmaz", orders: 3, revenue: 100, cancelled: 0 },
      { user_public_id: "usr_c", name: "Can Kaya", orders: 2, revenue: 200, cancelled: 1 },
      { user_public_id: "usr_x", name: "—", orders: 1, revenue: 10, cancelled: 0 },
    ]);
    expect(analysis.daily_source).toBe("daily_series");
    expect(analysis.daily.map((row) => row.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("keeps legacy zero-denominator and kargolanan fallback behaviour", () => {
    expect(reports.yuzdeHesapla(3, 0)).toBe(0);
    expect(reports.yuzdeHesapla(1, 3)).toBe(33.3);
    const analysis = reports.buildReportAnalysis(
      { startDate: "2026-10-01", endDate: "2026-10-01", personnelPublicId: null, cargoProvider: "ptt" },
      {
        metrics: { ...reports.emptyReportMetricAggregates(), toplam: 4, ptt: 3, surat: 1, ptt_subede: 1 },
        statusCounts: [],
        daily: [],
        personnel: [],
        personnelOptions: [],
      },
    );
    expect(analysis.rates.sube).toBe(25); // kargoya_giden 0 -> ptt + surat
    expect(analysis.rates.teyit).toBe(0);
    expect(analysis.daily_source).toBe("filtered_rows");
  });

  it("zero-fills the unfiltered daily series and caps it at 90 days like gunluk_istatistikler", () => {
    const filled = reports.buildDailySeries(
      { startDate: "2026-10-01", endDate: "2026-10-04", personnelPublicId: null, cargoProvider: "tumu" },
      [{ date: "2026-10-03", orders: 2, revenue: 20, cancelled: 0, returned: 0 }],
    );
    expect(filled.daily.map((row) => [row.date, row.orders])).toEqual([
      ["2026-10-01", 0],
      ["2026-10-02", 0],
      ["2026-10-03", 2],
      ["2026-10-04", 0],
    ]);
    const capped = reports.buildDailySeries(
      { startDate: "2026-01-01", endDate: "2026-10-01", personnelPublicId: null, cargoProvider: "tumu" },
      [],
    );
    expect(capped.daily).toHaveLength(90);
    expect(capped.daily[0]?.date).toBe("2026-07-04");
    const filtered = reports.buildDailySeries(
      { startDate: "2026-10-01", endDate: "2026-10-04", personnelPublicId: "usr_a", cargoProvider: "tumu" },
      [{ date: "2026-10-03", orders: 2, revenue: 20, cancelled: 0, returned: 0 }],
    );
    expect(filtered.daily).toHaveLength(1);
  });

  it("maps canonical and legacy status spellings onto the legacy durum keys", () => {
    expect(reports.legacyOrderStatusSynonyms.sevk_edildi).toContain("dispatched");
    expect(reports.legacyOrderStatusSynonyms.teyit_bekliyor).toEqual(
      expect.arrayContaining(["awaiting_confirmation", "pending_confirmation"]),
    );
    expect(reports.pttBranchPatterns).toContain("%Adreste Yok%");
    expect(reports.suratBranchPatterns).toContain("%AliciSubede%");
  });
});

describe("report analysis route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes date range, personnel and cargo filters to the SQL aggregate for admins", async () => {
    const response = await call(
      "GET",
      "/api/reports/analysis?start_date=2026-10-01&end_date=2026-10-03&cargo_provider=ptt&personnel_public_id=usr_a",
      "admin",
    );
    expect(response.status).toBe(200);
    expect(routeMocks.reportRepository.getAggregates).toHaveBeenCalledWith({
      startDate: "2026-10-01",
      endDate: "2026-10-03",
      cargoProvider: "ptt",
      personnelPublicId: "usr_a",
    });
    await expect(response.json()).resolves.toMatchObject({
      filters: { start_date: "2026-10-01", end_date: "2026-10-03", cargo_provider: "ptt", personnel_public_id: "usr_a" },
      daily_source: "filtered_rows",
    });
  });

  it("defaults to the legacy last-30-days window and rejects invalid filters", async () => {
    const response = await call("GET", "/api/reports/analysis", "admin");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { filters: { start_date: string; end_date: string } };
    expect(reports.differenceInCalendarDays(body.filters.end_date, body.filters.start_date)).toBe(29);

    expect((await call("GET", "/api/reports/analysis?start_date=2026-10-05&end_date=2026-10-01", "admin")).status).toBe(400);
    expect((await call("GET", "/api/reports/analysis?start_date=2026-02-30", "admin")).status).toBe(400);
    expect((await call("GET", "/api/reports/analysis?cargo_provider=aras", "admin")).status).toBe(400);
  });

  it("keeps İş Analizi admin-only", async () => {
    expect((await call("GET", "/api/reports/analysis", "calisan")).status).toBe(403);
    expect((await call("GET", "/api/reports/analysis", "kargo_operatoru")).status).toBe(403);
    expect((await app().request("/api/reports/analysis")).status).toBe(401);
  });
});

describe("Instagram publish and analytics routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    published.length = 0;
    routeMocks.instagramRepository.findAccount.mockImplementation(async () => routeMocks.account);
    routeMocks.instagramRepository.findByIdempotencyKey.mockImplementation(async () => null);
    routeMocks.instagramRepository.findMediaFile.mockImplementation(async () => null);
  });

  it("queues instagram.media.publish on provider-delivery for staff with the legacy photo payload", async () => {
    const response = await call("POST", "/api/instagram/publications", "calisan", {
      image_url: "https://cdn.example.com/photo.jpg",
      caption: "Yeni ürün",
      idempotency_key: "ig_key_1",
    });

    expect(response.status).toBe(202);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ queue: "provider-delivery", name: "instagram.media.publish", job_id: "job_igpub_ig_key_1" });
    expect(published[0]?.payload.envelope).toMatchObject({
      provider: "instagram",
      operation: "media.publish",
      account_public_id: "iac_1",
      payload: { image_url: "https://cdn.example.com/photo.jpg", caption: "Yeni ürün", idempotency_key: "ig_key_1" },
    });
    await expect(response.json()).resolves.toMatchObject({
      provider: "instagram",
      operation: "media.publish",
      queued: true,
      replayed: false,
      live_call_permitted: false,
      live_gate: "providers.instagram.live_mode",
      publication: { status: "queued", media_kind: "image", media_type: "IMAGE" },
    });
  });

  it("publishes Garage uploads as a presigned GET and detects video reels from the MIME type", async () => {
    routeMocks.instagramRepository.findMediaFile.mockImplementation(async () => ({
      id: 33,
      public_id: "fil_video",
      object_key: "media/2026/10/video.mp4",
      mime_type: "video/mp4",
      upload_status: "available",
      scan_status: "skipped",
    }));
    const response = await call("POST", "/api/instagram/publications", "admin", {
      file_public_id: "fil_video",
      caption: "",
      idempotency_key: "ig_key_video",
    });

    expect(response.status).toBe(202);
    expect(routeMocks.storage.createDownloadInstruction).toHaveBeenCalledWith("media/2026/10/video.mp4");
    expect(published[0]?.payload.envelope.payload).toMatchObject({
      video_url: "https://garage.example.com/media/2026/10/video.mp4?X-Amz-Signature=abc",
      media_type: "REELS",
      file_public_id: "fil_video",
    });
    expect(routeMocks.instagramRepository.recordPublication).toHaveBeenCalledWith(
      expect.objectContaining({ mediaKind: "video", mediaUrl: null, fileId: 33 }),
    );
  });

  it("replays idempotent publishes without queueing and rejects mismatched reuse", async () => {
    routeMocks.instagramRepository.findByIdempotencyKey.mockImplementation(async () => routeMocks.publication);
    const replay = await call("POST", "/api/instagram/publications", "calisan", {
      image_url: "https://cdn.example.com/photo.jpg",
      caption: "Yeni ürün",
      idempotency_key: "ig_key_1",
    });
    expect(replay.status).toBe(202);
    await expect(replay.json()).resolves.toMatchObject({ replayed: true });
    expect(published).toHaveLength(0);

    const conflict = await call("POST", "/api/instagram/publications", "calisan", {
      image_url: "https://cdn.example.com/other.jpg",
      caption: "Yeni ürün",
      idempotency_key: "ig_key_1",
    });
    expect(conflict.status).toBe(409);
  });

  it("validates media source, caption length, outbound URL policy and role", async () => {
    const base = { caption: "x", idempotency_key: "ig_key_v" };
    expect((await call("POST", "/api/instagram/publications", "calisan", base)).status).toBe(400);
    expect(
      (await call("POST", "/api/instagram/publications", "calisan", { ...base, image_url: "https://cdn.example.com/a.jpg", caption: "a".repeat(2201) })).status,
    ).toBe(400);
    expect(
      (await call("POST", "/api/instagram/publications", "calisan", { ...base, image_url: "http://127.0.0.1/a.jpg" })).status,
    ).toBe(400);
    expect(
      (await call("POST", "/api/instagram/publications", "kargo_operatoru", { ...base, image_url: "https://cdn.example.com/a.jpg" })).status,
    ).toBe(403);
    routeMocks.instagramRepository.findMediaFile.mockImplementation(async () => ({
      id: 1,
      public_id: "fil_pdf",
      object_key: "media/a.pdf",
      mime_type: "application/pdf",
      upload_status: "available",
      scan_status: "clean",
    }));
    expect((await call("POST", "/api/instagram/publications", "calisan", { ...base, file_public_id: "fil_pdf" })).status).toBe(400);
    expect(published).toHaveLength(0);
  });

  it("reports publication status and the media id from the worker attempt", async () => {
    routeMocks.instagramRepository.getPublication.mockImplementation(async () => ({
      ...routeMocks.publication,
      account_public_id: "iac_1",
      file_public_id: null,
      attempt_status: "success",
      attempt_error_message: null,
      attempt_response_metadata: { live_call_performed: true, body_preview: "{\"id\":\"17890000\"}" },
    }));
    const response = await call("GET", "/api/instagram/publications/igp_1", "calisan");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "published", media_id: "17890000" });
    expect(instagram.mediaIdFromAttemptResponse({ body_preview: "not-json" })).toBeNull();
  });

  it("serves legacy account insights for the selected days from the backend snapshot", async () => {
    const response = await call("GET", "/api/instagram/insights/account?days=7", "calisan");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ name: string; values: unknown[] }>;
      followers: unknown;
      period: { days: number };
      dry_run: boolean;
    };
    expect(body.period.days).toBe(7);
    expect(body.dry_run).toBe(true);
    expect(body.followers).toEqual({ followers_count: 1520, media_count: 88 });
    expect(body.data.map((metric) => metric.name)).toEqual(["impressions", "reach"]);
    expect(body.data.find((metric) => metric.name === "reach")?.values).toHaveLength(2);

    routeMocks.instagramRepository.findAccount.mockImplementation(async () => null);
    const missing = await call("GET", "/api/instagram/insights/account?days=28", "admin");
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({ error: { message: "Instagram bagli degil" } });
    expect((await call("GET", "/api/instagram/insights/account", "kargo_operatoru")).status).toBe(403);
  });

  it("reports a live worker snapshot and queues instagram.insights.account refreshes", async () => {
    const liveAccount = {
      ...routeMocks.account,
      metadata: { analytics: { ...routeMocks.account.metadata.analytics, source: "instagram_graph", synced_at: "2026-10-07T06:00:00.000Z" } },
    };
    routeMocks.instagramRepository.findAccount.mockImplementation(async () => liveAccount as never);
    const live = (await (await call("GET", "/api/instagram/insights/account?days=7", "admin")).json()) as { dry_run: boolean; synced_at: string | null; live_gate: string };
    expect(live).toMatchObject({ dry_run: false, synced_at: "2026-10-07T06:00:00.000Z", live_gate: "providers.instagram.live_mode" });

    published.length = 0;
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-07T09:01:00.000Z"));
    const refresh = await call("POST", "/api/instagram/insights/account/refresh", "calisan", {});
    expect(refresh.status).toBe(202);
    const body = (await refresh.json()) as { request_id: string; queued: boolean; live_call_permitted: boolean };
    expect(body).toMatchObject({ queued: true, live_call_permitted: false });
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ name: "instagram.insights.account", queue: "provider-delivery" });
    expect(published[0]?.payload.envelope).toMatchObject({ operation: "insights.account", account_public_id: "iac_1", payload: { days: 30, reason: "manual" } });
    // Same five-minute bucket → the same job id, so BullMQ dedupes repeated clicks.
    await call("POST", "/api/instagram/insights/account/refresh", "admin", {});
    expect(published[1]?.job_id).toBe(published[0]?.job_id);
    clock.mockRestore();

    routeMocks.instagramRepository.findAccount.mockImplementation(async () => null);
    expect((await call("POST", "/api/instagram/insights/account/refresh", "admin", {})).status).toBe(400);
    expect((await call("POST", "/api/instagram/insights/account/refresh", "kargo_operatoru", {})).status).toBe(403);
  });
});
