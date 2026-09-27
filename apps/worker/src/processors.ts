import type { Job } from "bullmq";
import type { JobEnvelope, QueueName } from "@garanti-kulucka/shared";
import { validateJobEnvelope } from "./queues.js";
import { handleProviderDeliveryJob, handleProviderWebhookJob } from "./providers/handlers.js";
import type { ProviderAttemptRepository } from "./providers/attempts.js";

export type WorkerLifecycleEventName = "started" | "completed" | "failed";

export interface WorkerLifecycleEvent {
  event: WorkerLifecycleEventName;
  queue: QueueName;
  job_id: string;
  name: string;
  occurred_at: string;
  error_message?: string;
}

export type WorkerLifecycleRecorder = (
  event: WorkerLifecycleEvent,
) => Promise<void> | void;

export type WorkerProcessorResult = unknown;
export type WorkerJob = Pick<Job<JobEnvelope>, "id" | "name" | "data">;
export type QueueProcessor = (job: WorkerJob) => Promise<WorkerProcessorResult>;

export interface WorkerProcessorRegistry {
  queues: readonly QueueName[];
  processors: ReadonlyMap<QueueName, QueueProcessor>;
  dispatch: (queue: QueueName, job: WorkerJob) => Promise<WorkerProcessorResult>;
}

export interface WorkerProcessorRegistryOptions {
  lifecycleRecorder?: WorkerLifecycleRecorder;
  providerAttemptRepository?: ProviderAttemptRepository;
}

export const workerQueueNames: QueueName[] = [
  "provider-webhooks",
  "provider-delivery",
  "shipment-tracking",
  "ai-replies",
  "migration-reports",
];

function assertJobMatchesQueue(queue: QueueName, job: WorkerJob): JobEnvelope {
  const envelope = validateJobEnvelope(job.data);

  if (envelope.queue !== queue) {
    throw new Error(`Job queue mismatch: worker=${queue} envelope=${envelope.queue}`);
  }

  if (envelope.name !== job.name) {
    throw new Error(`Job name mismatch: worker=${job.name} envelope=${envelope.name}`);
  }

  return envelope;
}

function assertProviderJobName(envelope: JobEnvelope): void {
  const payload = envelope.payload as {
    envelope?: {
      provider?: unknown;
      operation?: unknown;
    };
  };
  const provider = payload.envelope?.provider;
  const operation = payload.envelope?.operation;

  if (typeof provider !== "string" || typeof operation !== "string") {
    throw new Error(`Provider job payload is missing provider operation metadata: ${envelope.name}`);
  }

  const expectedName = `${provider}.${operation}`;
  if (envelope.name !== expectedName) {
    throw new Error(`Unknown provider job name: ${envelope.name}`);
  }
}

function createProviderWebhookProcessor(
  providerAttemptRepository?: ProviderAttemptRepository,
): QueueProcessor {
  return async (job) => {
    const envelope = assertJobMatchesQueue("provider-webhooks", job);
    assertProviderJobName(envelope);
    const result = handleProviderWebhookJob(envelope);
    await providerAttemptRepository?.persist(result.attempt);
    return result;
  };
}

function createProviderDeliveryProcessor(
  providerAttemptRepository?: ProviderAttemptRepository,
): QueueProcessor {
  return async (job) => {
    const envelope = assertJobMatchesQueue("provider-delivery", job);
    assertProviderJobName(envelope);
    const result = handleProviderDeliveryJob(envelope);
    await providerAttemptRepository?.persist(result.attempt);
    return result;
  };
}

function createUnimplementedProcessor(queue: QueueName): QueueProcessor {
  return async (job) => {
    assertJobMatchesQueue(queue, job);
    throw new Error(`Worker processor is not implemented for queue: ${queue}`);
  };
}

export function createWorkerProcessorRegistry(
  options: WorkerLifecycleRecorder | WorkerProcessorRegistryOptions = {},
): WorkerProcessorRegistry {
  const lifecycleRecorder =
    typeof options === "function" ? options : options.lifecycleRecorder ?? (() => undefined);
  const providerAttemptRepository =
    typeof options === "function" ? undefined : options.providerAttemptRepository;
  const processors = new Map<QueueName, QueueProcessor>([
    ["provider-webhooks", createProviderWebhookProcessor(providerAttemptRepository)],
    ["provider-delivery", createProviderDeliveryProcessor(providerAttemptRepository)],
    ["shipment-tracking", createUnimplementedProcessor("shipment-tracking")],
    ["ai-replies", createUnimplementedProcessor("ai-replies")],
    ["migration-reports", createUnimplementedProcessor("migration-reports")],
  ]);

  return {
    queues: workerQueueNames,
    processors,
    dispatch: async (queue, job) => {
      const processor = processors.get(queue);
      const envelope = validateJobEnvelope(job.data);
      const lifecycleBase = {
        queue,
        job_id: envelope.job_id,
        name: job.name,
      };

      await lifecycleRecorder({
        ...lifecycleBase,
        event: "started",
        occurred_at: new Date().toISOString(),
      });

      try {
        if (!processor) {
          throw new Error(`Unknown worker queue: ${queue}`);
        }

        const result = await processor(job);

        await lifecycleRecorder({
          ...lifecycleBase,
          event: "completed",
          occurred_at: new Date().toISOString(),
        });

        return result;
      } catch (error) {
        await lifecycleRecorder({
          ...lifecycleBase,
          event: "failed",
          occurred_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : "Unknown worker error",
        });

        throw error;
      }
    },
  };
}
