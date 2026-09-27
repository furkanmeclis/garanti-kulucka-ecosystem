import { randomUUID } from "node:crypto";
import type { JobEnvelope } from "@garanti-kulucka/shared";
import { jobEnvelopeSchema } from "@garanti-kulucka/shared";

export interface WebhookQueuePublisher {
  publish: (job: JobEnvelope) => Promise<string | null>;
}

export const noopWebhookQueuePublisher: WebhookQueuePublisher = {
  publish: async () => null,
};

export function buildWebhookJob(input: {
  eventPublicId: string;
  provider: string;
  accountPublicId: string | null;
  payloadHash: string;
  eventType: string;
  externalEventId: string | null;
}): JobEnvelope {
  return jobEnvelopeSchema.parse({
    job_id: `job_${randomUUID().replaceAll("-", "")}`,
    queue: "provider-webhooks",
    name: "provider.webhook.received",
    payload: {
      webhook_event_public_id: input.eventPublicId,
      provider: input.provider,
      account_public_id: input.accountPublicId,
      payload_hash: input.payloadHash,
      event_type: input.eventType,
      external_event_id: input.externalEventId,
    },
    requested_at: new Date().toISOString(),
  });
}
