import { describe, expect, it } from "vitest";
import type { JobEnvelope } from "@garanti-kulucka/shared";
import { createWebhookQueuePublisher } from "../src/webhooks/queue-publisher.js";

const webhookJob: JobEnvelope = {
  job_id: "job_webhook_1",
  queue: "provider-webhooks",
  name: "provider.webhook.received",
  payload: {
    webhook_event_public_id: "wev_test",
  },
  requested_at: "2026-01-01T00:00:00.000Z",
};

describe("webhook queue publisher", () => {
  it("publishes provider webhook jobs with stable BullMQ job ids", async () => {
    const calls: Array<{ job: JobEnvelope; jobId: string | undefined }> = [];
    const publisher = createWebhookQueuePublisher(async (job, options) => {
      calls.push({ job, jobId: options?.jobId });
      return "queued_job_id";
    });

    await expect(publisher.publish(webhookJob)).resolves.toBe("queued_job_id");
    expect(calls).toEqual([
      {
        job: webhookJob,
        jobId: "job_webhook_1",
      },
    ]);
  });

  it("rejects attempts to publish non-webhook queues", async () => {
    const publisher = createWebhookQueuePublisher(async () => {
      throw new Error("addJob must not be called");
    });

    await expect(
      publisher.publish({
        ...webhookJob,
        queue: "provider-delivery",
      }),
    ).rejects.toThrow("Webhook publisher cannot publish queue: provider-delivery");
  });
});
