import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import { jobEnvelopeSchema, type JobEnvelope, type QueueName } from "@garanti-kulucka/shared";

export function validateJobEnvelope(input: unknown): JobEnvelope {
  return jobEnvelopeSchema.parse(input);
}

export const queueNames: QueueName[] = [
  "provider-webhooks",
  "provider-delivery",
  "shipment-tracking",
  "ai-replies",
  "migration-reports",
  "storage-orphan-reconciliation",
  "data-retention",
];

/**
 * Defaults for jobs the worker publishes itself. Completed jobs are kept a week (longer than any dedupe bucket, e.g.
 * the 6 h Instagram insights interval), failed ones two weeks for inspection, then Redis drops them.
 */
export const workerJobOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 2_000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60, count: 5_000 },
  removeOnFail: { age: 14 * 24 * 60 * 60, count: 5_000 },
} satisfies JobsOptions;

export interface QueueRegistry {
  connection: Redis;
  queues: Map<QueueName, Queue<JobEnvelope>>;
  add: (job: JobEnvelope, options?: JobsOptions) => Promise<string>;
  close: () => Promise<void>;
}

export function createQueueRegistry(redisUrl: string): QueueRegistry {
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
  });

  const queues = new Map(
    queueNames.map((name) => [
      name,
      new Queue<JobEnvelope>(name, {
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
      }),
    ]),
  );

  return {
    connection,
    queues,
    add: async (input, options) => {
      const job = validateJobEnvelope(input);
      const queue = queues.get(job.queue);
      if (!queue) {
        throw new Error(`Unknown queue: ${job.queue}`);
      }

      const queued = await queue.add(job.name, job, {
        jobId: job.job_id,
        ...options,
      });

      return queued.id ?? job.job_id;
    },
    close: async () => {
      await Promise.all([...queues.values()].map((queue) => queue.close()));
      connection.disconnect();
    },
  };
}
