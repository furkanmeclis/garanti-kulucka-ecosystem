import type { Job } from "bullmq";
import {
  type JobEnvelope,
  type ProviderRequestEnvelope,
  type QueueName,
  providerRequestEnvelopeSchema,
} from "@garanti-kulucka/shared";
import { validateJobEnvelope } from "./queues.js";
import {
  createProviderFailureAttempt,
  handleProviderDeliveryJob,
  handleProviderWebhookJob,
} from "./providers/handlers.js";
import type { ProviderAttemptRepository } from "./providers/attempts.js";
import { assertProviderEnvelope } from "./providers/registry.js";
import { buildProviderDryRunRequest } from "./providers/dry-run-transport.js";
import { providerTransportPolicyFor } from "./providers/transport-policy.js";

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
export type WorkerJob = Pick<Job<JobEnvelope>, "id" | "name" | "data"> &
  Partial<Pick<Job<JobEnvelope>, "attemptsMade" | "opts">>;
export type QueueProcessor = (job: WorkerJob) => Promise<WorkerProcessorResult>;

export interface ShipmentTrackingProcessorResult {
  provider: ProviderRequestEnvelope["provider"];
  request_id: string;
  queue: "shipment-tracking";
  status: "accepted_fixture";
  tracking_number: string | null;
  live_call_performed: false;
  metadata: {
    job_id: string;
    fixture_only: true;
    transport_policy: ReturnType<typeof providerTransportPolicyFor>;
    dry_run_request: ReturnType<typeof buildProviderDryRunRequest>;
  };
}

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

function assertShipmentTrackingJobName(
  envelope: JobEnvelope,
  requestEnvelope: ProviderRequestEnvelope,
): void {
  const expectedName = `${requestEnvelope.provider}.shipment.track`;

  if (envelope.name !== expectedName) {
    throw new Error(`Unknown shipment tracking job name: ${envelope.name}`);
  }
}

function providerErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.trim().length > 0) {
      return code;
    }
  }

  return "worker_processor_error";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown worker error";
}

function providerFailureInputFromJob(job: WorkerJob): {
  attempt_number: number;
  max_attempts: number;
} {
  return {
    attempt_number: Math.max(1, (job.attemptsMade ?? 0) + 1),
    max_attempts: Math.max(1, Number(job.opts?.attempts ?? 1)),
  };
}

async function persistProviderFailureAttempt(
  providerAttemptRepository: ProviderAttemptRepository | undefined,
  envelope: ProviderRequestEnvelope,
  jobEnvelope: JobEnvelope,
  job: WorkerJob,
  error: unknown,
): Promise<void> {
  if (!providerAttemptRepository) {
    return;
  }

  await providerAttemptRepository.persist(
    createProviderFailureAttempt(envelope, jobEnvelope, {
      ...providerFailureInputFromJob(job),
      status_code: null,
      error_code: providerErrorCode(error),
      error_message: errorMessage(error),
    }),
  );
}

function createProviderWebhookProcessor(
  providerAttemptRepository?: ProviderAttemptRepository,
): QueueProcessor {
  return async (job) => {
    const envelope = assertJobMatchesQueue("provider-webhooks", job);
    assertProviderJobName(envelope);
    const requestEnvelope = providerRequestEnvelopeSchema.parse(
      (envelope.payload as { envelope?: unknown }).envelope,
    );
    let result;
    try {
      result = handleProviderWebhookJob(envelope);
    } catch (error) {
      await persistProviderFailureAttempt(
        providerAttemptRepository,
        requestEnvelope,
        envelope,
        job,
        error,
      );
      throw error;
    }
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
    const requestEnvelope = providerRequestEnvelopeSchema.parse(
      (envelope.payload as { envelope?: unknown }).envelope,
    );
    let result;
    try {
      result = handleProviderDeliveryJob(envelope);
    } catch (error) {
      await persistProviderFailureAttempt(
        providerAttemptRepository,
        requestEnvelope,
        envelope,
        job,
        error,
      );
      throw error;
    }
    await providerAttemptRepository?.persist(result.attempt);
    return result;
  };
}

function createShipmentTrackingProcessor(): QueueProcessor {
  return async (job) => {
    const envelope = assertJobMatchesQueue("shipment-tracking", job);
    const requestEnvelope = providerRequestEnvelopeSchema.parse(
      (envelope.payload as { envelope?: unknown }).envelope,
    );

    assertShipmentTrackingJobName(envelope, requestEnvelope);

    if (requestEnvelope.direction !== "outbound") {
      throw new Error(`Shipment tracking jobs must be outbound: ${requestEnvelope.request_id}`);
    }

    if (requestEnvelope.operation !== "shipment.track") {
      throw new Error(`Unsupported shipment tracking operation: ${requestEnvelope.operation}`);
    }

    assertProviderEnvelope(requestEnvelope, "delivery");

    const trackingNumber =
      typeof requestEnvelope.payload.tracking_number === "string"
        ? requestEnvelope.payload.tracking_number
        : null;

    return {
      provider: requestEnvelope.provider,
      request_id: requestEnvelope.request_id,
      queue: "shipment-tracking",
      status: "accepted_fixture",
      tracking_number: trackingNumber,
      live_call_performed: false,
      metadata: {
        job_id: envelope.job_id,
        fixture_only: true,
        transport_policy: providerTransportPolicyFor(requestEnvelope),
        dry_run_request: buildProviderDryRunRequest(requestEnvelope),
      },
    } satisfies ShipmentTrackingProcessorResult;
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
    ["shipment-tracking", createShipmentTrackingProcessor()],
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
          error_message: errorMessage(error),
        });

        throw error;
      }
    },
  };
}
