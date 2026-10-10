import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createDatabase, sql, type AppDatabase } from "@garanti-kulucka/database";
import type { JobEnvelope } from "@garanti-kulucka/shared";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/app.js";
import type { ApiConfig } from "../../apps/api/src/config.js";
import { DatabaseInboundMessageStore } from "../../apps/worker/src/inbound-messages.js";
import { createWorkerProcessorRegistry } from "../../apps/worker/src/processors.js";

/**
 * End to end, fixtures only: signed Meta webhook → API ingestion (webhook_events + queued job) → worker
 * inbound processor → customers / conversations / messages / social_comments. Needs TEST_DATABASE_URL pointing
 * at a migrated database (e.g. the compose postgres); skipped otherwise. No provider is ever called.
 */
const databaseUrl = process.env.TEST_DATABASE_URL ?? "";
const describePg = databaseUrl ? describe : describe.skip;
const appSecret = "fixture-app-secret";
const fixture = (provider: string, name: string) => readFileSync(new URL(`../../contracts/providers/${provider}/fixtures/inbound/${name}`, import.meta.url), "utf8");

const config: ApiConfig = {
  databaseUrl: null, jwtSecret: "inbound-e2e-secret", encryptionKey: "inbound-e2e-encryption-key", encryptionKeyId: "test",
  accessTokenTtlSeconds: 300, refreshTokenTtlDays: 30, redisUrl: null, corsOrigin: null,
};

describePg("inbound webhook pipeline (API → queue → worker → Postgres)", () => {
  const db: AppDatabase = createDatabase(databaseUrl);
  const jobs: JobEnvelope[] = [];
  const app = createApp({ config, db, webhookQueuePublisher: { publish: async (job) => (jobs.push(job), job.job_id) } });
  const registry = createWorkerProcessorRegistry({ inboundMessageStore: new DatabaseInboundMessageStore(db) });

  async function deliver(provider: string, body: string, signature = `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`) {
    return app.request(`/webhooks/${provider}`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signature }, body });
  }

  async function runQueuedJobs() {
    const results = [];
    for (const job of jobs.splice(0)) results.push(await registry.dispatch("provider-webhooks", { id: job.job_id, name: job.name, data: job }));
    return results;
  }

  async function setSecret(provider: string) {
    await sql`insert into integration_settings (public_id, provider_id, account_id, key, value, is_secret)
      select ${`ins_e2e_${provider}`}, id, null, 'webhook.app_secret', ${JSON.stringify(appSecret)}::jsonb, false from integration_providers where key = ${provider}`.execute(db);
  }

  afterEach(async () => {
    jobs.length = 0;
    await sql`delete from messages where external_message_id in ('wamid.FIXTURE_TEXT_1', 'wamid.FIXTURE_IMAGE_1', 'aWdfZAG1fixture_dm_1')`.execute(db);
    await sql`delete from conversations where external_thread_id in ('905551112233', 'IGSID_FIXTURE_CUSTOMER')`.execute(db);
    await sql`delete from customers where phone = '905551112233'`.execute(db);
    await sql`delete from social_comments where external_comment_id = '17900000000000001'`.execute(db);
    await sql`delete from webhook_events where raw_payload::text like '%FIXTURE%' or raw_payload::text like '%fixture%'`.execute(db);
    await sql`delete from integration_settings where public_id like 'ins_e2e_%'`.execute(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("creates the customer, conversation and unread messages from a signed WhatsApp webhook exactly once", async () => {
    await setSecret("whatsapp");
    const body = fixture("whatsapp", "text_image_status.json");
    expect((await deliver("whatsapp", body, "sha256=forged")).status).toBe(401);
    expect(jobs).toHaveLength(0);

    expect((await deliver("whatsapp", body)).status).toBe(202);
    await expect(runQueuedJobs()).resolves.toMatchObject([{ status: "processed", messages_created: 2 }]);

    const conversation = await db
      .selectFrom("conversations")
      .innerJoin("customers", "customers.id", "conversations.customer_id")
      .select(["conversations.channel", "conversations.unread_count", "conversations.last_message_text", "conversations.last_message_sender_type", "customers.full_name", "customers.phone"])
      .where("conversations.external_thread_id", "=", "905551112233")
      .executeTakeFirstOrThrow();
    expect(conversation).toMatchObject({ channel: "whatsapp", unread_count: 2, last_message_text: "[Görsel] Bu model", last_message_sender_type: "customer", full_name: "Fixture Müşteri" });
    const events = await db.selectFrom("webhook_events").select(["status", "processed_at"]).where(sql<boolean>`raw_payload::text like '%wamid.FIXTURE_TEXT_1%'`).execute();
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe("processed");
    expect(events[0]!.processed_at).not.toBeNull();

    // Meta redelivers the same payload: the API answers from the stored event and nothing is counted twice.
    expect((await deliver("whatsapp", body)).status).toBe(202);
    await runQueuedJobs();
    const again = await db.selectFrom("conversations").select("unread_count").where("external_thread_id", "=", "905551112233").executeTakeFirstOrThrow();
    expect(again.unread_count).toBe(2);
    const messages = await db.selectFrom("messages").select("external_message_id").where("external_message_id", "in", ["wamid.FIXTURE_TEXT_1", "wamid.FIXTURE_IMAGE_1"]).execute();
    expect(messages).toHaveLength(2);
  });

  it("stores Instagram DMs and comments, skipping our own echo", async () => {
    await setSecret("instagram");
    expect((await deliver("instagram", fixture("instagram", "dm_echo_comment.json"))).status).toBe(202);
    await expect(runQueuedJobs()).resolves.toMatchObject([{ status: "processed", messages_created: 1, comments_created: 1, skipped: 2 }]);
    const rows = await db
      .selectFrom("messages")
      .innerJoin("conversations", "conversations.id", "messages.conversation_id")
      .select(["messages.external_message_id", "conversations.channel", "conversations.customer_id"])
      .where("conversations.external_thread_id", "=", "IGSID_FIXTURE_CUSTOMER")
      .execute();
    expect(rows).toEqual([{ external_message_id: "aWdfZAG1fixture_dm_1", channel: "instagram", customer_id: null }]);
    const comment = await db.selectFrom("social_comments").select(["platform", "username", "status"]).where("external_comment_id", "=", "17900000000000001").executeTakeFirstOrThrow();
    expect(comment).toEqual({ platform: "instagram", username: "fixture.kullanici", status: "pending" });
  });
});
