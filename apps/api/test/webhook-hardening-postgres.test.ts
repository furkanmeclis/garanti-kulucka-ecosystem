import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { Kysely, PostgresDialect } from "kysely";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installSafeIntegerTypeParsers, sql, type Database } from "@garanti-kulucka/database";
import { createApp } from "../src/app.js";
import { signAccessToken } from "../src/auth/tokens.js";
import { createSecretEncryptor } from "../src/security/encryption.js";
import type { JobEnvelope } from "@garanti-kulucka/shared";

// An explicit local database only; each run migrates and drops its own schema.
const url = process.env.WEBHOOK_TEST_DATABASE_URL;
const suite = url && ["localhost", "127.0.0.1"].includes(new URL(url).hostname) ? describe : describe.skip;
suite("webhook hardening PostgreSQL", () => {
  const schema = `test_webhooks_${randomUUID().replaceAll("-", "")}`;
  let root: Pool;
  let db: Kysely<Database>;
  const secret = "local-meta-test-secret";
  const config = { databaseUrl: null, jwtSecret: "test", encryptionKey: "local-encryption", encryptionKeyId: "test", accessTokenTtlSeconds: 300, refreshTokenTtlDays: 1, redisUrl: null, corsOrigin: null, webhookRateLimitPerMinute: 600 };
  const encryptor = createSecretEncryptor(config.encryptionKey, config.encryptionKeyId);
  const jobs = new Map<string, JobEnvelope>();
  function app() {
    return createApp({ config, db, webhookQueuePublisher: { publish: async (job) => { jobs.set(job.job_id, job); return job.job_id; } } });
  }
  beforeAll(async () => {
    installSafeIntegerTypeParsers();
    root = new Pool({ connectionString: url });
    await root.query(`CREATE SCHEMA ${schema}`);
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: url, options: `-c search_path=${schema},public` }) }) });
    const dir = new URL("../../../packages/database/migrations/", import.meta.url);
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) await sql.raw(readFileSync(new URL(file, dir), "utf8").split("-- Down Migration")[0]!).execute(db);
  });
  afterEach(async () => {
    vi.unstubAllEnvs(); jobs.clear();
    await db.deleteFrom("webhook_events").execute();
    await db.deleteFrom("integration_settings").execute();
    await db.deleteFrom("integration_accounts").execute();
    await db.deleteFrom("settings").where("key", "=", "webhook.app_secret").execute();
  });
  afterAll(async () => { await db?.destroy(); await root?.query(`DROP SCHEMA ${schema} CASCADE`); await root?.end(); });
  async function sharedSecret() {
    await sql`INSERT INTO settings(public_id, scope, key, value, is_secret) VALUES ('set_webhook_test', 'global', 'webhook.app_secret', ${JSON.stringify(encryptor.encryptJson(secret))}::jsonb, true)`.execute(db);
  }
  async function deliver(api: ReturnType<typeof app>, provider: string, payload: unknown, key = secret) {
    const body = JSON.stringify(payload);
    return api.request(`/webhooks/${provider}`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", key).update(body).digest("hex")}` }, body });
  }
  it("decrypts shared secrets, persists verification, and deduplicates concurrent overlapping batches across API instances", async () => {
    vi.stubEnv("APP_ENV", "production"); await sharedSecret();
    const batch = (...ids: string[]) => ({ object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: { messages: ids.map((id) => ({ id })) } }] }] });
    expect((await deliver(app(), "whatsapp", batch("forged"), "wrong")).status).toBe(403);
    expect(await db.selectFrom("webhook_events").selectAll().execute()).toHaveLength(0);
    const responses = await Promise.all([deliver(app(), "whatsapp", batch("a", "b")), deliver(app(), "whatsapp", batch("b", "c")), deliver(app(), "whatsapp", batch("a", "b"))]);
    expect(responses.map((response) => response.status)).toEqual([202, 202, 202]);
    const rows = await db.selectFrom("webhook_events").selectAll().execute();
    expect(rows).toHaveLength(3); expect(jobs.size).toBe(3);
    expect(rows.every((row) => row.verification_status === "verified")).toBe(true);
    await db.updateTable("webhook_events").set({ status: "processed", processed_at: new Date() }).execute(); jobs.clear();
    expect((await deliver(app(), "whatsapp", batch("a", "b", "c"))).status).toBe(202);
    expect(jobs.size).toBe(0);
  });
  it("deduplicates id-less events durably even with JSON whitespace changes", async () => {
    await sharedSecret();
    const payload = { object: "page", entry: [{ id: "page", messaging: [{ read: { watermark: 123 } }] }] };
    expect((await deliver(app(), "messenger", payload)).status).toBe(202);
    await db.updateTable("webhook_events").set({ status: "processed", processed_at: new Date() }).execute(); jobs.clear();
    const body = JSON.stringify(payload, null, 2);
    const response = await app().request("/webhooks/messenger", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` }, body });
    expect(response.status).toBe(202); expect(jobs.size).toBe(0);
    expect(await db.selectFrom("webhook_events").selectAll().execute()).toHaveLength(1);
  });
  it("reuses the existing encrypted account secret without requiring an account query on a single-account provider", async () => {
    vi.stubEnv("APP_ENV", "production");
    const provider = await db.selectFrom("integration_providers").select("id").where("key", "=", "instagram").executeTakeFirstOrThrow();
    const account = await db.insertInto("integration_accounts").values({ public_id: "iac_local", provider_id: provider.id, display_name: "local", status: "active", metadata: {} }).returning("id").executeTakeFirstOrThrow();
    await db.insertInto("integration_settings").values({ public_id: "ins_local", provider_id: provider.id, account_id: account.id, key: "app_secret", value: encryptor.encryptJson(secret), is_secret: true }).execute();
    expect((await deliver(app(), "instagram", { event_id: "local-account" })).status).toBe(202);
    expect((await deliver(app(), "instagram", { event_id: "wrong-secret" }, "wrong")).status).toBe(403);
  });
  it("exposes only verification booleans to authenticated admins", async () => {
    await sharedSecret();
    expect((await app().request("/admin/settings/webhook-verification")).status).toBe(401);
    const role = await db.selectFrom("roles").select("id").where("name", "=", "admin").executeTakeFirstOrThrow();
    const user = await db.insertInto("users").values({ public_id: "usr_webhook_status", role_id: role.id, email: "webhook-status@example.test", password_hash: "test", first_name: "Test", last_name: "Admin", is_active: true, is_online: false }).returning("id").executeTakeFirstOrThrow();
    await db.insertInto("user_sessions").values({ public_id: "ses_webhook_status", user_id: user.id, expires_at: new Date(Date.now() + 60000) }).execute();
    const token = await signAccessToken({ user_public_id: "usr_webhook_status", session_public_id: "ses_webhook_status", role: "admin" }, config);
    const response = await app().request("/admin/settings/webhook-verification", { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(secret);
    expect(JSON.parse(text)).toEqual({ data: { whatsapp: true, instagram: true, messenger: true, "facebook-data-deletion": true, ivr: false, santral: false } });
    await db.deleteFrom("users").where("id", "=", user.id).execute();
  });
  it("marks unsigned development receipts unverified and fails closed in production", async () => {
    const request = () => app().request("/webhooks/instagram", { method: "POST", headers: { "content-type": "application/json" }, body: '{"event_id":"unsigned"}' });
    vi.stubEnv("APP_ENV", "development"); expect((await request()).status).toBe(202);
    expect((await db.selectFrom("webhook_events").selectAll().executeTakeFirstOrThrow()).verification_status).toBe("unverified");
    vi.stubEnv("APP_ENV", "production"); expect((await request()).status).toBe(403);
    expect(await db.selectFrom("webhook_events").selectAll().execute()).toHaveLength(1);
  });
});
