import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { JobEnvelope, ProviderName } from "@garanti-kulucka/shared";
import { createWebhookRoutes } from "../src/http/webhook-routes.js";
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
}

function createTestApp(input: { repository: WebhookEventRepository; jobs?: JobEnvelope[] }) {
  const app = new Hono();
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
    }),
  );
  return app;
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
    const response = await createTestApp({ repository, jobs }).request(
      "/webhooks/whatsapp?account_public_id=iac_test",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event_type: "message.received", event_id: "evt_1", text: "hello" }),
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
      payload: {
        webhook_event_public_id: "wev_test",
        provider: "whatsapp",
        account_public_id: "iac_test",
      },
    });
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

  it("rejects configured webhook verification mismatches", async () => {
    const repository = new FakeWebhookRepository({
      verifyTokenRequired: true,
      verifyTokenMatched: false,
    });
    const response = await createTestApp({ repository }).request("/webhooks/meta", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ object: "page" }),
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
