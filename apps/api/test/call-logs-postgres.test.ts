import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Pool } from "pg";
import { Kysely, PostgresDialect } from "kysely";
import {
  CallLogsRepository,
  installSafeIntegerTypeParsers,
  sql,
  type Database,
} from "@garanti-kulucka/database";
import { createApp } from "../src/app.js";
import { signAccessToken } from "../src/auth/tokens.js";
import type { ApiConfig } from "../src/config.js";
import { DatabaseCallLogJobs } from "../../worker/src/call-logs.js";
import { DatabaseProviderAttemptRepository } from "../../worker/src/providers/attempts.js";

// Explicitly isolated local test PostgreSQL only; never read DATABASE_URL or connect to a deployment.
const url = process.env.CALL_LOGS_TEST_DATABASE_URL;
const suite =
  url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname)
    ? describe
    : describe.skip;
suite("call logs PostgreSQL routes, merge and archive", () => {
  const schema = `test_calls_${randomUUID().replaceAll("-", "")}`;
  let root: Pool;
  let db: Kysely<Database>;
  const tokens = new Map<string, string>();
  const publish = vi.fn(async () => "job_test");
  const notify = vi.fn();
  const config: ApiConfig = {
    databaseUrl: null,
    jwtSecret: "call-local-test-secret",
    encryptionKey: "local-test-encryption",
    encryptionKeyId: "test",
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlDays: 1,
    redisUrl: null,
    corsOrigin: null,
  };
  let app: ReturnType<typeof createApp>;
  let userId: number;
  beforeAll(async () => {
    installSafeIntegerTypeParsers();
    root = new Pool({ connectionString: url });
    await root.query(`CREATE SCHEMA ${schema}`);
    db = new Kysely<Database>({
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: url,
          options: `-c search_path=${schema},public`,
        }),
      }),
    });
    const dir = new URL(
      "../../../packages/database/migrations/",
      import.meta.url,
    );
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await sql
        .raw(
          readFileSync(new URL(file, dir), "utf8").split(
            "-- Down Migration",
          )[0]!,
        )
        .execute(db);
    await sql`INSERT INTO roles(public_id,name,description,is_system) VALUES ('rol_calisan','calisan','Test',true), ('rol_cargo','kargo_operatoru','Test',true) ON CONFLICT (name) DO NOTHING`.execute(
      db,
    );
    for (const [i, role] of [
      "calisan",
      "admin",
      "owner",
      "kargo_operatoru",
    ].entries()) {
      const r = await db
        .selectFrom("roles")
        .select("id")
        .where("name", "=", role)
        .executeTakeFirstOrThrow();
      const u = await db
        .insertInto("users")
        .values({
          public_id: `usr_${role}`,
          role_id: r.id,
          email: `${role}@example.test`,
          password_hash: "test",
          first_name: role,
          last_name: "Test",
          phone: null,
          is_active: true,
          is_online: false,
          last_seen_at: null,
          sip_username: null,
          sip_extension: String(101 + i),
          sip_password_encrypted: null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      if (role === "calisan") userId = u.id;
      await db
        .insertInto("user_sessions")
        .values({
          public_id: `ses_${role}`,
          user_id: u.id,
          user_agent: null,
          ip_address: null,
          expires_at: new Date(Date.now() + 86400000),
          revoked_at: null,
        })
        .execute();
      tokens.set(
        role,
        await signAccessToken(
          {
            user_public_id: `usr_${role}`,
            session_public_id: `ses_${role}`,
            role,
          },
          config,
        ),
      );
    }
    await sql`INSERT INTO customers(public_id,full_name,phone) VALUES ('cus_test','Test','+90 555 111 22 33')`.execute(
      db,
    );
    await sql`INSERT INTO orders(public_id,customer_id,order_number) SELECT 'ord_test',id,'TEST-1' FROM customers WHERE public_id='cus_test'`.execute(
      db,
    );
    await sql`INSERT INTO integration_accounts(public_id,provider_id,display_name,status) SELECT 'iac_netgsm',id,'Test','active' FROM integration_providers WHERE key='netgsm'`.execute(
      db,
    );
    app = createApp({
      config,
      db,
      providerDeliveryQueuePublisher: { publish },
      realtimePublisher: {
        publish: vi.fn(),
        broadcast: vi.fn(),
        publishToConversation: vi.fn(),
        publishToUser: notify,
      },
    });
  }, 90000);
  beforeEach(async () => {
    if (db) {
      await db.deleteFrom("call_logs").execute();
      await db.deleteFrom("files").execute();
      await db
        .deleteFrom("settings")
        .where("key", "=", "netgsm.santral_webhook_token")
        .execute();
    }
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await db?.destroy();
    if (root) {
      await root.query(`DROP SCHEMA ${schema} CASCADE`);
      await root.end();
    }
  });
  function request(path: string, role = "calisan", body?: unknown) {
    return app.request(path, {
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
      headers: {
        "content-type": "application/json",
        ...(tokens.has(role)
          ? { authorization: `Bearer ${tokens.get(role)}` }
          : {}),
      },
    });
  }
  const client = {
    direction: "outbound",
    phone: "05551112233",
    order_public_id: "ord_test",
    customer_public_id: "cus_test",
    started_at: "2026-10-17T10:00:00Z",
    ended_at: "2026-10-17T10:01:00Z",
    client_status: "answered",
    talk_seconds: 40,
  };
  const cdr = {
    scenario: "cdr",
    unique_id: "u1",
    internal_num: "101",
    customer_num: "+905551112233",
    arayan: "101",
    aranan: "05551112233",
    yon: 2,
    sondurum: 1,
    bas: "2026-10-17 13:00:30",
    sure: 45,
    seskaydi: "https://dosyaindir.netgsm.com.tr/upload.php?q=test",
  };
  it("merges browser first, CDR first and concurrent calls while retaining order linkage", async () => {
    for (const order of ["client-first", "cdr-first", "concurrent"]) {
      await db.deleteFrom("call_logs").execute();
      const browser = () =>
        request("/api/call-logs/client-events", "calisan", client);
      const webhook = () =>
        request("/api/netgsm/webhook/santral", "anonymous", cdr);
      if (order === "client-first") {
        expect((await browser()).status).toBe(201);
        expect((await webhook()).status).toBe(200);
      } else if (order === "cdr-first") {
        await webhook();
        expect((await browser()).status).toBe(201);
      } else await Promise.all([browser(), webhook()]);
      const rows = await db.selectFrom("call_logs").selectAll().execute();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        unique_id: "u1",
        source: "netgsm_webhook",
        talk_seconds: 45,
        user_id: userId,
      });
      expect(rows[0]?.order_id).not.toBeNull();
      expect(rows[0]?.customer_id).not.toBeNull();
      await webhook();
      expect(
        await db.selectFrom("call_logs").selectAll().execute(),
      ).toHaveLength(1);
    }
  });
  it("merges an early provider row that only learns the extension from CDR", async () => {
    await request("/api/netgsm/webhook/santral", "anonymous", {
      scenario: "InboundtoPBX",
      unique_id: "u1",
      customer_num: client.phone,
      timestamp: String(Date.parse(client.started_at)),
    });
    await request("/api/call-logs/client-events", "calisan", client);
    await request("/api/netgsm/webhook/santral", "anonymous", cdr);
    const rows = await db.selectFrom("call_logs").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.order_id).not.toBeNull();
    expect(rows[0]?.events).toHaveLength(3);
  });
  it("reconciles report calls and preserves all original report fields with mock HTTP", async () => {
    const value = {
      date: "17.10.2026 13:00:30",
      source: "101",
      destination: "05551112233",
      duration: "45",
      direction: "0",
      recording: cdr.seskaydi,
      line: "8500000000",
      directory: "Fixture",
      additional: "preserved",
    };
    const transport = vi.fn(async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify([{ uniqueid: "report1", values: [value] }]),
    }));
    const configs = {
      getAccountConfig: async () => ({
        provider: "netgsm" as const,
        account_public_id: "iac_netgsm",
        live_mode: true,
        settings: { api_url: "https://netgsm.test" },
        tokens: { usercode: "mock", password: "mock" },
      }),
    };
    const jobs = new DatabaseCallLogJobs(
      db,
      configs,
      new DatabaseProviderAttemptRepository(db),
      publish,
      transport,
    );
    await jobs.run({
      job_id: "reconcile",
      queue: "provider-delivery",
      name: "netgsm.call.reconcile",
      payload: {},
      requested_at: new Date().toISOString(),
    });
    const row = await db
      .selectFrom("call_logs")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      unique_id: "report1",
      source: "netgsm_report",
      status: "answered",
      direction: "outbound",
      user_id: userId,
      trunk: value.line,
    });
    expect(row.raw_payload).toEqual({ ...value, uniqueid: "report1" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalled();
  });
  it("keeps distinct browser calls inside the same two-minute window separate", async () => {
    await request("/api/call-logs/client-events", "calisan", client);
    const next = {
      ...client,
      started_at: "2026-10-17T10:01:30Z",
      ended_at: "2026-10-17T10:02:00Z",
    };
    await request("/api/call-logs/client-events", "calisan", next);
    await request("/api/call-logs/client-events", "calisan", next);
    expect(await db.selectFrom("call_logs").selectAll().execute()).toHaveLength(
      2,
    );
    await request("/api/netgsm/webhook/santral", "anonymous", cdr);
    await request("/api/netgsm/webhook/santral", "anonymous", {
      ...cdr,
      unique_id: "u2",
      bas: "2026-10-17 13:01:40",
    });
    const rows = await db.selectFrom("call_logs").selectAll().execute();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.unique_id && r.order_id)).toBe(true);
  });
  it("does not merge another extension, number, direction or calls beyond two minutes", async () => {
    await request("/api/call-logs/client-events", "calisan", client);
    for (const [i, change] of [
      { internal_num: "102" },
      { customer_num: "05559998877" },
      { yon: 1 },
      { bas: "2026-10-17 13:03:00" },
    ].entries())
      await request("/api/netgsm/webhook/santral", "anonymous", {
        ...cdr,
        ...change,
        unique_id: `other${i}`,
      });
    expect(await db.selectFrom("call_logs").selectAll().execute()).toHaveLength(
      5,
    );
  });
  it("enforces own/all on list, detail, recording and client events", async () => {
    await request("/api/netgsm/webhook/santral", "anonymous", cdr);
    await request("/api/netgsm/webhook/santral", "anonymous", {
      ...cdr,
      unique_id: "other",
      internal_num: "102",
    });
    for (const role of ["calisan", "admin", "owner"]) {
      const res = await request("/api/call-logs", role);
      expect(res.status).toBe(200);
      expect((await res.json()).data).toHaveLength(role === "calisan" ? 1 : 2);
    }
    const other = await db
      .selectFrom("call_logs")
      .select("public_id")
      .where("unique_id", "=", "other")
      .executeTakeFirstOrThrow();
    expect((await request(`/api/call-logs/${other.public_id}`)).status).toBe(
      404,
    );
    expect(
      (await request(`/api/call-logs/${other.public_id}/recording`)).status,
    ).toBe(404);
    expect(
      (await request(`/api/call-logs/${other.public_id}`, "admin")).status,
    ).toBe(200);
    expect((await request("/api/call-logs", "anonymous")).status).toBe(401);
    expect((await request("/api/call-logs", "kargo_operatoru")).status).toBe(
      403,
    );
    expect(
      (await request("/api/call-logs/client-events", "kargo_operatoru", client))
        .status,
    ).toBe(403);
    expect((await request("/api/call-logs?status=bogus")).status).toBe(400);
  });
  it("accepts form, records all scenarios, rejects token with 200 and emits a missed notification once", async () => {
    await sql`INSERT INTO settings(public_id,key,value,scope) VALUES ('set_test','netgsm.santral_webhook_token','"test_token_123456789"','global')`.execute(
      db,
    );
    expect(
      (await request("/api/netgsm/webhook/santral", "anonymous", cdr)).status,
    ).toBe(200);
    expect(await db.selectFrom("call_logs").selectAll().execute()).toHaveLength(
      0,
    );
    for (const scenario of [
      "Inbound_call",
      "Outbound_call",
      "Local_call",
      "Answer",
      "Hangup",
      "Queue",
      "InboundtoPBX",
      "Context",
      "DTMF",
      "QueueLeave",
      "cdr",
    ]) {
      const payload = {
        ...cdr,
        scenario,
        unique_id: "missed",
        yon: "1",
        sondurum: "2",
        digit: "5",
        timestamp: "1792231200000",
      };
      const response = await app.request(
        "/api/netgsm/webhook/santral?token=test_token_123456789",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(
            Object.entries(payload).map(([k, v]) => [k, String(v)]),
          ),
        },
      );
      expect(response.status).toBe(200);
    }
    const call = await db
      .selectFrom("call_logs")
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(call.events).toHaveLength(11);
    expect(call.raw_payload).toMatchObject({ scenario: "cdr", sondurum: "2" });
    expect(notify.mock.calls.map((c) => c[0]).sort()).toEqual([
      "usr_admin",
      "usr_calisan",
      "usr_owner",
    ]);
    expect(
      await db.selectFrom("webhook_events").selectAll().execute(),
    ).not.toHaveLength(0);
  });
  it("archives into Garage once, blocks generic file access by another user and live-gates downloads", async () => {
    const repo = new CallLogsRepository(db);
    const row = await repo.ingest(cdr, "netgsm_webhook");
    let live = false;
    const configs = {
      getAccountConfig: async () => ({
        provider: "netgsm" as const,
        account_public_id: "iac_netgsm",
        live_mode: live,
        settings: {},
        tokens: {},
      }),
    };
    const download = vi.fn(async () => ({
      bytes: Buffer.from("RIFF-test-audio"),
      mime: "audio/wav",
    }));
    const put = vi.fn(async () => {});
    const jobs = new DatabaseCallLogJobs(
      db,
      configs,
      new DatabaseProviderAttemptRepository(db),
      publish,
      undefined,
      download,
      put,
    );
    const job = {
      job_id: "recording",
      queue: "provider-delivery" as const,
      name: "netgsm.call.recording.archive",
      payload: { call_log_public_id: row.public_id },
      requested_at: new Date().toISOString(),
    };
    expect(await jobs.run(job)).toMatchObject({ status: "live_mode_disabled" });
    expect(download).not.toHaveBeenCalled();
    live = true;
    vi.stubEnv("S3_BUCKET_MEDIA", "local-test-bucket");
    await Promise.all([jobs.run(job), jobs.run(job)]);
    expect(download).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
    expect(await db.selectFrom("files").selectAll().execute()).toHaveLength(1);
    vi.stubEnv("S3_ENDPOINT", "http://127.0.0.1:9000");
    vi.stubEnv("S3_ACCESS_KEY_ID", "local-test-access");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "local-test-secret");
    const ownRecording = await request(
      `/api/call-logs/${row.public_id}/recording`,
    );
    expect(ownRecording.status).toBe(200);
    expect((await ownRecording.json()).download.presigned_url).toContain(
      "127.0.0.1:9000",
    );
    await db
      .updateTable("call_logs")
      .set({ user_id: null })
      .where("id", "=", row.id)
      .execute();
    expect(
      (await request(`/api/files/fil_${row.public_id}/download`)).status,
    ).toBe(404);
    expect(
      (await request(`/api/call-logs/${row.public_id}/recording`)).status,
    ).toBe(404);
    expect(
      (await request(`/api/call-logs/${row.public_id}/recording`, "admin"))
        .status,
    ).toBe(200);
    expect(
      (await request(`/api/call-logs/${row.public_id}/recording`, "owner"))
        .status,
    ).toBe(200);
  });
});
