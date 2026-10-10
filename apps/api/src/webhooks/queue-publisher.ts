import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import type { JobEnvelope } from "@garanti-kulucka/shared";
import { jobEnvelopeSchema } from "@garanti-kulucka/shared";

export interface WebhookQueuePublisher {
  publish: (job: JobEnvelope) => Promise<string | null>;
  close?: () => Promise<void>;
}

export interface ProviderDeliveryQueuePublisher {
  publish: (job: JobEnvelope) => Promise<string | null>;
  close?: () => Promise<void>;
}

export const noopWebhookQueuePublisher: WebhookQueuePublisher = {
  publish: async () => null,
};

export const noopProviderDeliveryQueuePublisher: ProviderDeliveryQueuePublisher = {
  publish: async () => null,
};

export function createWebhookQueuePublisher(
  addJob: (job: JobEnvelope, options?: JobsOptions) => Promise<string | null>,
): WebhookQueuePublisher {
  return {
    publish: async (input) => {
      const job = jobEnvelopeSchema.parse(input);
      if (job.queue !== "provider-webhooks") {
        throw new Error(`Webhook publisher cannot publish queue: ${job.queue}`);
      }

      return addJob(job, { jobId: job.job_id });
    },
  };
}

export function createProviderDeliveryQueuePublisher(
  addJob: (job: JobEnvelope, options?: JobsOptions) => Promise<string | null>,
): ProviderDeliveryQueuePublisher {
  return {
    publish: async (input) => {
      const job = jobEnvelopeSchema.parse(input);
      if (job.queue !== "provider-delivery") {
        throw new Error(`Provider delivery publisher cannot publish queue: ${job.queue}`);
      }

      return addJob(job, { jobId: job.job_id });
    },
  };
}

export function createBullMqWebhookQueuePublisher(redisUrl: string): WebhookQueuePublisher {
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
  });
  const queue = new Queue<JobEnvelope>("provider-webhooks", {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 2_000,
      },
      removeOnComplete: 500,
      removeOnFail: 1_000,
    },
  });
  const publisher = createWebhookQueuePublisher(async (job, options) => {
    const queued = await queue.add(job.name, job, options);
    return queued.id ?? job.job_id;
  });

  return {
    ...publisher,
    close: async () => {
      await queue.close();
      connection.disconnect();
    },
  };
}

export function createBullMqProviderDeliveryQueuePublisher(redisUrl: string): ProviderDeliveryQueuePublisher {
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
  });
  const queue = new Queue<JobEnvelope>("provider-delivery", {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 2_000,
      },
      removeOnComplete: 500,
      removeOnFail: 1_000,
    },
  });
  const publisher = createProviderDeliveryQueuePublisher(async (job, options) => {
    const queued = await queue.add(job.name, job, options);
    return queued.id ?? job.job_id;
  });

  return {
    ...publisher,
    close: async () => {
      await queue.close();
      connection.disconnect();
    },
  };
}

export function buildWebhookJob(input: {
  eventPublicId: string;
  provider: string;
  accountPublicId: string | null;
  payloadHash: string;
  eventType: string;
  externalEventId: string | null;
  requestId?: string;
}): JobEnvelope {
  return jobEnvelopeSchema.parse({
    // One job per stored event: re-queueing an event that never got processed cannot run it twice in parallel.
    job_id: `job_webhook_${input.eventPublicId}`,
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
    ...(input.requestId ? { request_id: input.requestId } : {}),
  });
}
