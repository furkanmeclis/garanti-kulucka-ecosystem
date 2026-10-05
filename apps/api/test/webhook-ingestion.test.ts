import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { JobEnvelope, ProviderName } from "@garanti-kulucka/shared";
import { createWebhookRoutes, type WebhookSignaturePolicy } from "../src/http/webhook-routes.js";
import type { AppBindings } from "../src/http/types.js";
import { MemoryRateLimitStore } from "../src/http/rate-limit.js";
import { hashWebhookPayload } from "../src/webhooks/payload-hash.js";
import type {
  StoreWebhookEventInput,
  StoredWebhookEvent,
  WebhookEventRepository,
  WebhookResolution,
} from "../src/webhooks/repository.js";

class FakeWebhookRepository implements WebhookEventRepository {
  storedInputs: StoreWebhookEventInput[] = [];

  constructor(private readonly verification: Partial<WebhookResolution> = {}) {}

  async resolve(input: { provider: ProviderName; accountPublicId: string | null }): Promise<WebhookResolution> {
    return {
      providerId: 1,
      providerKey: input.provider,
      accountId: input.accountPublicId ? 10 : null,
      accountPublicId: input.accountPublicId,
      verifyTokenRequired: false,
      verifyTokenMatched: true,
      ...this.verification,
    };
  }

  async storeReceivedEvent(input: StoreWebhookEventInput): Promise<StoredWebhookEvent> {
    this.storedInputs.push(input);
    return {
      id: 123,
      public_id: "wev_test",
      provider_key: input.provider,
      account_public_id: input.accountPublicId,
      event_type: input.eventType,
      external_event_id: input.externalEventId,
      payload_hash: input.payloadHash,
      status: "received",
    };
  }

  async findReceivedEventByExternalId(input: {
    provider: ProviderName;
    accountPublicId: string | null;
    externalEventId: string;
  }): Promise<StoredWebhookEvent | null> {
    const stored = this.storedInputs.find(
      (candidate) =>
        candidate.provider === input.provider &&
        candidate.accountPublicId === input.accountPublicId &&
        candidate.externalEventId === input.externalEventId,
    );
    return stored
      ? {
          id: 123,
          public_id: "wev_test",
          provider_key: stored.provider,
          account_public_id: stored.accountPublicId,
          event_type: stored.eventType,
          external_event_id: stored.externalEventId,
          payload_hash: stored.payloadHash,
          status: "received",
        }
      : null;
  }
}

function createTestApp(input: {
  repository: WebhookEventRepository;
  jobs?: JobEnvelope[];
  policy?: WebhookSignaturePolicy;
  warnings?: unknown[];
}) {
  const app = new Hono<AppBindings>();
  app.use("*", async (context, next) => {
    context.set("requestId", "req_test_webhook");
    context.set("rateLimitStore", new MemoryRateLimitStore());
    context.set("config", {
      databaseUrl: null,
      jwtSecret: "test",
      encryptionKey: "test",
      encryptionKeyId: "test",
      accessTokenTtlSeconds: 300,
      refreshTokenTtlDays: 30,
      redisUrl: null,
      corsOrigin: null,
    });
    context.set("logger", {
      info: () => undefined,
      warn: (payload) => {
        input.warnings?.push(payload);
      },
      error: () => undefined,
    });
    await next();
  });
  app.route(
    "/webhooks",
    createWebhookRoutes({
      repository: input.repository,
      queuePublisher: {
        publish: async (job) => {
          input.jobs?.push(job);
          return "job_test";
        },
      },
      signaturePolicyResolver: async () => input.policy ?? { mode: "off", secret: null },
    }),
  );
  return app;
}

function metaSignature(body: string) {
  return `sha256=${createHmac("sha256", "meta-secret").update(body).digest("hex")}`;
}

describe("webhook ingestion", () => {
  it("creates stable payload hashes independent of object key order", () => {
    const left = hashWebhookPayload({ provider: "whatsapp", body: { b: 2, a: 1 } });
    const right = hashWebhookPayload({ body: { a: 1, b: 2 }, provider: "whatsapp" });

    expect(left).toBe(right);
  });

  it("accepts provider callbacks, stores received event, and enqueues provider-webhooks job", async () => {
    const repository = new FakeWebhookRepository();
    const jobs: JobEnvelope[] = [];
    const requestBody = JSON.stringify({ event_type: "message.received", event_id: "evt_1", text: "hello" });
    const response = await createTestApp({
      repository,
      jobs,
      policy: { mode: "enforce", secret: "meta-secret" },
    }).request(
      "/webhooks/whatsapp?account_public_id=iac_test",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": metaSignature(requestBody),
        },
        body: requestBody,
      },
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({
      status: "accepted",
      provider: "whatsapp",
      event_public_id: "wev_test",
      queued: true,
      job_id: "job_test",
    });
    expect(body.payload_hash).toHaveLength(64);
    expect(repository.storedInputs).toHaveLength(1);
    expect(repository.storedInputs[0]).toMatchObject({
      provider: "whatsapp",
      accountPublicId: "iac_test",
      eventType: "message.received",
      externalEventId: "evt_1",
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      queue: "provider-webhooks",
      name: "provider.webhook.received",
      request_id: "req_test_webhook",
      payload: {
        webhook_event_public_id: "wev_test",
        provider: "whatsapp",
        account_public_id: "iac_test",
      },
    });
  });

  it("accepts unsigned legacy-shaped provider callbacks when no secret is configured and logs a warning", async () => {
    const repository = new FakeWebhookRepository();
    const jobs: JobEnvelope[] = [];
    const warnings: unknown[] = [];
    const response = await createTestApp({ repository, jobs, warnings }).request("/webhooks/vapi", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "call.ended", call: { id: "call_legacy" } }),
    });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({
      status: "accepted",
      provider: "vapi",
      event_public_id: "wev_test",
      queued: true,
      job_id: "job_test",
    });
    expect(jobs).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(warnings[0])).toContain("webhook.signature_unverified");
    expect(JSON.stringify(warnings[0])).not.toContain("call_legacy");
  });

  it("does not leak verification secrets in accepted responses or persisted raw payload", async () => {
    const repository = new FakeWebhookRepository();
    const response = await createTestApp({ repository }).request(
      "/webhooks/netgsm?verify_token=secret-value&account_public_id=iac_sms",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-token": "secret-value",
        },
        body: JSON.stringify({ event_type: "sms.status", id: "sms_1" }),
      },
    );
    const responseText = await response.text();
    const rawPayload = JSON.stringify(repository.storedInputs[0]?.rawPayload);

    expect(response.status).toBe(202);
    expect(responseText).not.toContain("secret-value");
    expect(rawPayload).not.toContain("secret-value");
  });

  it("rejects Meta-family callbacks with bad signatures when a secret is configured in enforce mode", async () => {
    const repository = new FakeWebhookRepository();
    const response = await createTestApp({
      repository,
      policy: { mode: "enforce", secret: "meta-secret" },
    }).request("/webhooks/meta", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=bad" },
      body: JSON.stringify({ object: "page", event_id: "evt_unsigned" }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "webhook_signature_invalid",
        message: "Webhook signature is missing or invalid",
      },
    });
    expect(repository.storedInputs).toHaveLength(0);
  });

  it("accepts bad signatures in report_only mode and emits a warning", async () => {
    const repository = new FakeWebhookRepository();
    const warnings: unknown[] = [];
    const response = await createTestApp({
      repository,
      warnings,
      policy: { mode: "report_only", secret: "meta-secret" },
    }).request("/webhooks/meta", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=bad" },
      body: JSON.stringify({ object: "page", event_id: "evt_report_only" }),
    });

    expect(response.status).toBe(202);
    expect(repository.storedInputs).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(warnings[0])).toContain("invalid_signature");
  });

  it("returns the same accepted response for replayed event ids without enqueueing duplicate work", async () => {
    const repository = new FakeWebhookRepository();
    const jobs: JobEnvelope[] = [];
    const app = createTestApp({
      repository,
      jobs,
      policy: { mode: "enforce", secret: "meta-secret" },
    });
    const requestBody = JSON.stringify({ event_type: "message.received", event_id: "evt_replay" });
    const request = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": metaSignature(requestBody),
      },
      body: requestBody,
    };

    const first = await app.request("/webhooks/meta", request);
    const replay = await app.request("/webhooks/meta", request);

    expect(first.status).toBe(202);
    expect(replay.status).toBe(202);
    await expect(replay.json()).resolves.toEqual(await first.clone().json());
    expect(repository.storedInputs).toHaveLength(1);
    expect(jobs).toHaveLength(1);
  });

  it("rejects configured webhook verification mismatches", async () => {
    const repository = new FakeWebhookRepository({
      verifyTokenRequired: true,
      verifyTokenMatched: false,
    });
    const response = await createTestApp({
      repository,
      policy: { mode: "enforce", secret: "meta-secret" },
    }).request("/webhooks/meta", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": metaSignature(JSON.stringify({ object: "page", event_id: "evt_denied" })),
      },
      body: JSON.stringify({ object: "page", event_id: "evt_denied" }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: {
        code: "webhook_verification_failed",
        message: "Webhook verification failed",
      },
    });
  });
});
