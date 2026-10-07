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
  handleProviderDeliveryJobWithTransport,
  handleProviderWebhookJob,
  isProviderLiveTransportError,
} from "./providers/handlers.js";
import type { ProviderAttemptRepository } from "./providers/attempts.js";
import type { ProviderAccountConfigRepository } from "./providers/account-config.js";
import { assertProviderEnvelope } from "./providers/registry.js";
import { buildProviderDryRunRequest } from "./providers/dry-run-transport.js";
import { providerTransportPolicyFor } from "./providers/transport-policy.js";
import type { PttFetchTransport } from "./providers/ptt.js";
import type { SuratFetchTransport } from "./providers/surat.js";
import type { KolaybiFetchTransport } from "./providers/kolaybi.js";
import type { WhatsappFetchTransport } from "./providers/whatsapp.js";
import type { InstagramFetchTransport } from "./providers/instagram.js";
import type { InstagramGraphFetchTransport } from "./providers/instagram-graph.js";
import type { ProviderMediaFileResolver } from "./providers/media-files.js";
import type { MessengerFetchTransport } from "./providers/messenger.js";
import type { NetgsmFetchTransport } from "./providers/netgsm.js";
import type { VapiFetchTransport } from "./providers/vapi.js";
import type { StorageOrphanReconciler } from "./storage-orphans.js";
import { shipmentWritebackFrom, type ShipmentWritebackRepository } from "./shipment-writeback.js";
import { instagramAnalyticsFrom, type InstagramAnalyticsRepository } from "./instagram-insights.js";
import { dataRetentionPolicyFromEnv, runDataRetention, type DataRetentionStore } from "./data-retention.js";
import type { StorageOrphanReconciliationResult } from "./storage-orphans.js";

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

export interface MigrationReportProcessorResult {
  queue: "migration-reports";
  status: "accepted_report";
  run_id: string;
  report_type: string;
  generated_at: string | null;
  summary: {
    status: string | null;
    total_checks: number | null;
    failed_checks: number | null;
    planned_rows: number | null;
    blocked_rows: number | null;
  };
  metadata: {
    job_id: string;
    secret_free: true;
  };
}

export interface AiReplyProcessorResult {
  queue: "ai-replies";
  status: "drafted_fixture";
  conversation_public_id: string;
  draft_text: string;
  live_call_performed: false;
  metadata: {
    job_id: string;
    model: "fixture-ai";
    prompt_version: string | null;
    source_message_length: number;
  };
}

export type StorageOrphanReconciliationProcessorResult = StorageOrphanReconciliationResult;

export interface WorkerProcessorRegistry {
  queues: readonly QueueName[];
  processors: ReadonlyMap<QueueName, QueueProcessor>;
  dispatch: (queue: QueueName, job: WorkerJob) => Promise<WorkerProcessorResult>;
}

export interface WorkerProcessorRegistryOptions {
  lifecycleRecorder?: WorkerLifecycleRecorder;
  providerAttemptRepository?: ProviderAttemptRepository;
  providerAccountConfigRepository?: ProviderAccountConfigRepository;
  pttTransport?: PttFetchTransport;
  suratTransport?: SuratFetchTransport;
  kolaybiTransport?: KolaybiFetchTransport;
  whatsappTransport?: WhatsappFetchTransport;
  instagramTransport?: InstagramFetchTransport;
  instagramGraphTransport?: InstagramGraphFetchTransport;
  mediaFileResolver?: ProviderMediaFileResolver;
  messengerTransport?: MessengerFetchTransport;
  netgsmTransport?: NetgsmFetchTransport;
  vapiTransport?: VapiFetchTransport;
  storageOrphanReconciler?: StorageOrphanReconciler;
  shipmentWritebackRepository?: ShipmentWritebackRepository;
  instagramAnalyticsRepository?: InstagramAnalyticsRepository;
  dataRetentionStore?: DataRetentionStore;
}

export const workerQueueNames: QueueName[] = [
  "provider-webhooks",
  "provider-delivery",
  "shipment-tracking",
  "ai-replies",
  "migration-reports",
  "storage-orphan-reconciliation",
  "data-retention",
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
  providerAccountConfigRepository?: ProviderAccountConfigRepository,
  pttTransport?: PttFetchTransport,
  suratTransport?: SuratFetchTransport,
  kolaybiTransport?: KolaybiFetchTransport,
  whatsappTransport?: WhatsappFetchTransport,
  instagramTransport?: InstagramFetchTransport,
  messengerTransport?: MessengerFetchTransport,
  netgsmTransport?: NetgsmFetchTransport,
  vapiTransport?: VapiFetchTransport,
  extras: {
    instagramGraphTransport?: InstagramGraphFetchTransport;
    mediaFileResolver?: ProviderMediaFileResolver;
    shipmentWritebackRepository?: ShipmentWritebackRepository;
    instagramAnalyticsRepository?: InstagramAnalyticsRepository;
  } = {},
): QueueProcessor {
  return async (job) => {
    const envelope = assertJobMatchesQueue("provider-delivery", job);
    assertProviderJobName(envelope);
    const requestEnvelope = providerRequestEnvelopeSchema.parse(
      (envelope.payload as { envelope?: unknown }).envelope,
    );
    let result;
    try {
      if (providerAccountConfigRepository) {
        result = await handleProviderDeliveryJobWithTransport(envelope, {
          accountConfigRepository: providerAccountConfigRepository,
          ...(pttTransport ? { pttTransport } : {}),
          ...(suratTransport ? { suratTransport } : {}),
          ...(kolaybiTransport ? { kolaybiTransport } : {}),
          ...(whatsappTransport ? { whatsappTransport } : {}),
          ...(instagramTransport ? { instagramTransport } : {}),
          ...(messengerTransport ? { messengerTransport } : {}),
          ...(netgsmTransport ? { netgsmTransport } : {}),
          ...(vapiTransport ? { vapiTransport } : {}),
          ...(extras.instagramGraphTransport ? { instagramGraphTransport: extras.instagramGraphTransport } : {}),
          ...(extras.mediaFileResolver ? { mediaFileResolver: extras.mediaFileResolver } : {}),
          ...providerFailureInputFromJob(job),
        });
      } else {
        result = handleProviderDeliveryJob(envelope);
      }
    } catch (error) {
      if (providerAttemptRepository && isProviderLiveTransportError(error)) {
        await providerAttemptRepository.persist(error.attempt);
      } else {
        await persistProviderFailureAttempt(
          providerAttemptRepository,
          requestEnvelope,
          envelope,
          job,
          error,
        );
      }
      throw error;
    }
    await providerAttemptRepository?.persist(result.attempt);
    if (result.live_call_performed && extras.shipmentWritebackRepository) {
      const update = shipmentWritebackFrom(requestEnvelope, result.response_payload);
      if (update) {
        // A write-back failure must not fail (and so retry) a carrier call that already succeeded.
        try {
          const applied = await extras.shipmentWritebackRepository.apply(update);
          return { ...result, shipment_writeback: applied ? "applied" : "skipped" };
        } catch {
          return { ...result, shipment_writeback: "failed" };
        }
      }
    }
    if (result.live_call_performed && extras.instagramAnalyticsRepository) {
      const analytics = instagramAnalyticsFrom(requestEnvelope, result.response_payload);
      if (analytics) {
        // Same rule as the shipment write-back: storing the snapshot never retries the Graph call.
        try {
          const stored = await extras.instagramAnalyticsRepository.store(analytics.accountPublicId, analytics.snapshot);
          return { ...result, instagram_analytics: stored ? "stored" : "skipped" };
        } catch {
          return { ...result, instagram_analytics: "failed" };
        }
      }
    }
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

function asRecord(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${label} must be an object`);
  }

  return input as Record<string, unknown>;
}

function assertNoSecretLeak(input: unknown): void {
  const serialized = JSON.stringify(input);
  const secretPatterns = [/postgres:\/\//i, /DATABASE_URL/i, /password=/i, /secret/i, /token/i];
  const matchedPattern = secretPatterns.find((pattern) => pattern.test(serialized));

  if (matchedPattern) {
    throw new Error(`Migration report contains secret-like content: ${matchedPattern.source}`);
  }
}

function nullableNumber(input: unknown): number | null {
  return typeof input === "number" && Number.isFinite(input) ? input : null;
}

function nonEmptyString(input: unknown, label: string): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }

  return input.trim();
}

function createAiReplyDraft(input: {
  prompt: string;
  customerMessage: string;
  language: string | null;
}): string {
  const normalizedMessage = input.customerMessage.replace(/\s+/g, " ").trim();
  const messagePreview =
    normalizedMessage.length > 180 ? `${normalizedMessage.slice(0, 177)}...` : normalizedMessage;
  const languagePrefix = input.language === "en" ? "Hello" : "Merhaba";
  const instruction = input.prompt.replace(/\s+/g, " ").trim();

  return `${languagePrefix}, mesajınızı aldık. ${instruction} Konu ozeti: ${messagePreview}`;
}

function createAiReplyProcessor(): QueueProcessor {
  return async (job) => {
    const envelope = assertJobMatchesQueue("ai-replies", job);

    if (envelope.name !== "ai.reply.generate") {
      throw new Error(`Unknown AI reply job name: ${envelope.name}`);
    }

    const payload = asRecord(envelope.payload, "AI reply payload");
    const conversationPublicId = nonEmptyString(
      payload.conversation_public_id,
      "AI reply conversation_public_id",
    );
    const customerMessage = nonEmptyString(payload.customer_message, "AI reply customer_message");
    const prompt = nonEmptyString(payload.prompt, "AI reply prompt");
    const language = typeof payload.language === "string" ? payload.language : null;
    const promptVersion = typeof payload.prompt_version === "string" ? payload.prompt_version : null;

    return {
      queue: "ai-replies",
      status: "drafted_fixture",
      conversation_public_id: conversationPublicId,
      draft_text: createAiReplyDraft({
        prompt,
        customerMessage,
        language,
      }),
      live_call_performed: false,
      metadata: {
        job_id: envelope.job_id,
        model: "fixture-ai",
        prompt_version: promptVersion,
        source_message_length: customerMessage.length,
      },
    } satisfies AiReplyProcessorResult;
  };
}

function createMigrationReportProcessor(): QueueProcessor {
  return async (job) => {
    const envelope = assertJobMatchesQueue("migration-reports", job);

    if (envelope.name !== "migration.report") {
      throw new Error(`Unknown migration report job name: ${envelope.name}`);
    }

    const payload = asRecord(envelope.payload, "Migration report payload");
    const runId = payload.run_id;
    const reportType = payload.report_type;
    const report = asRecord(payload.report, "Migration report");

    if (typeof runId !== "string" || runId.trim().length === 0) {
      throw new Error("Migration report payload is missing run_id");
    }

    if (typeof reportType !== "string" || reportType.trim().length === 0) {
      throw new Error("Migration report payload is missing report_type");
    }

    assertNoSecretLeak(report);

    const totals = asRecord(report.totals ?? {}, "Migration report totals");
    const checks = Array.isArray(report.checks) ? report.checks : null;
    const generatedAt = typeof report.generatedAt === "string" ? report.generatedAt : null;
    const status = typeof report.status === "string" ? report.status : null;

    return {
      queue: "migration-reports",
      status: "accepted_report",
      run_id: runId,
      report_type: reportType,
      generated_at: generatedAt,
      summary: {
        status,
        total_checks: checks?.length ?? null,
        failed_checks: nullableNumber(totals.failed),
        planned_rows: nullableNumber(totals.plannedRows),
        blocked_rows: nullableNumber(totals.blockedRows),
      },
      metadata: {
        job_id: envelope.job_id,
        secret_free: true,
      },
    } satisfies MigrationReportProcessorResult;
  };
}

function createStorageOrphanReconciliationProcessor(
  storageOrphanReconciler?: StorageOrphanReconciler,
): QueueProcessor {
  return async (job) => {
    const envelope = assertJobMatchesQueue("storage-orphan-reconciliation", job);

    if (envelope.name !== "storage.orphans.reconcile") {
      throw new Error(`Unknown storage orphan reconciliation job name: ${envelope.name}`);
    }

    if (!storageOrphanReconciler) {
      throw new Error("Storage orphan reconciliation requires a database-backed reconciler");
    }

    const payload = asRecord(envelope.payload, "Storage orphan reconciliation payload");
    const mode = payload.mode === "apply" ? "apply" : "dry_run";
    const limit = typeof payload.limit === "number" && Number.isFinite(payload.limit) ? payload.limit : 100;

    return storageOrphanReconciler.reconcile({
      mode,
      limit,
      deleteEnabled: process.env.STORAGE_ORPHAN_DELETE_ENABLED === "true",
    });
  };
}

function createDataRetentionProcessor(dataRetentionStore?: DataRetentionStore): QueueProcessor {
  return async (job) => {
    const envelope = assertJobMatchesQueue("data-retention", job);
    if (envelope.name !== "data.retention.prune") {
      throw new Error(`Unknown data retention job name: ${envelope.name}`);
    }
    if (!dataRetentionStore) {
      throw new Error("Data retention requires a database-backed store");
    }
    const payload = asRecord(envelope.payload, "Data retention payload");
    return runDataRetention({
      store: dataRetentionStore,
      policy: dataRetentionPolicyFromEnv(),
      mode: payload.mode === "apply" ? "apply" : "dry_run",
      deleteEnabled: process.env.DATA_RETENTION_DELETE_ENABLED === "true",
    });
  };
}

export function createWorkerProcessorRegistry(
  options: WorkerLifecycleRecorder | WorkerProcessorRegistryOptions = {},
): WorkerProcessorRegistry {
  const lifecycleRecorder =
    typeof options === "function" ? options : options.lifecycleRecorder ?? (() => undefined);
  const providerAttemptRepository =
    typeof options === "function" ? undefined : options.providerAttemptRepository;
  const providerAccountConfigRepository =
    typeof options === "function" ? undefined : options.providerAccountConfigRepository;
  const pttTransport =
    typeof options === "function" ? undefined : options.pttTransport;
  const suratTransport =
    typeof options === "function" ? undefined : options.suratTransport;
  const kolaybiTransport =
    typeof options === "function" ? undefined : options.kolaybiTransport;
  const whatsappTransport =
    typeof options === "function" ? undefined : options.whatsappTransport;
  const instagramTransport =
    typeof options === "function" ? undefined : options.instagramTransport;
  const messengerTransport =
    typeof options === "function" ? undefined : options.messengerTransport;
  const netgsmTransport =
    typeof options === "function" ? undefined : options.netgsmTransport;
  const vapiTransport =
    typeof options === "function" ? undefined : options.vapiTransport;
  const storageOrphanReconciler =
    typeof options === "function" ? undefined : options.storageOrphanReconciler;
  const instagramGraphTransport =
    typeof options === "function" ? undefined : options.instagramGraphTransport;
  const mediaFileResolver =
    typeof options === "function" ? undefined : options.mediaFileResolver;
  const shipmentWritebackRepository =
    typeof options === "function" ? undefined : options.shipmentWritebackRepository;
  const instagramAnalyticsRepository =
    typeof options === "function" ? undefined : options.instagramAnalyticsRepository;
  const dataRetentionStore =
    typeof options === "function" ? undefined : options.dataRetentionStore;
  const processors = new Map<QueueName, QueueProcessor>([
    ["provider-webhooks", createProviderWebhookProcessor(providerAttemptRepository)],
    [
      "provider-delivery",
      createProviderDeliveryProcessor(
        providerAttemptRepository,
        providerAccountConfigRepository,
        pttTransport,
        suratTransport,
        kolaybiTransport,
        whatsappTransport,
        instagramTransport,
        messengerTransport,
        netgsmTransport,
        vapiTransport,
        {
          ...(instagramGraphTransport ? { instagramGraphTransport } : {}),
          ...(mediaFileResolver ? { mediaFileResolver } : {}),
          ...(shipmentWritebackRepository ? { shipmentWritebackRepository } : {}),
          ...(instagramAnalyticsRepository ? { instagramAnalyticsRepository } : {}),
        },
      ),
    ],
    ["shipment-tracking", createShipmentTrackingProcessor()],
    ["ai-replies", createAiReplyProcessor()],
    ["migration-reports", createMigrationReportProcessor()],
    ["storage-orphan-reconciliation", createStorageOrphanReconciliationProcessor(storageOrphanReconciler)],
    ["data-retention", createDataRetentionProcessor(dataRetentionStore)],
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
