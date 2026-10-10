import { Queue, Worker } from "bullmq";
import { createDatabase, type AppDatabase } from "@garanti-kulucka/database";
import { Redis } from "ioredis";
import type pino from "pino";
import {
  createStructuredLog,
  settingsChangedMessageSchema,
  type JobEnvelope,
  type QueueName,
  type SettingsChangedMessage,
} from "@garanti-kulucka/shared";
import { bindProviderConfigInvalidation, type SettingsChangeSubscriber } from "./settings-invalidation.js";
import {
  createWorkerProcessorRegistry,
  type WorkerLifecycleRecorder,
  type WorkerProcessorRegistry,
} from "./processors.js";
import { DatabaseShipmentWritebackRepository } from "./shipment-writeback.js";
import { DatabaseDataRetentionStore } from "./data-retention.js";
import { DatabaseInboundMessageStore } from "./inbound-messages.js";
import { DatabaseInstagramAnalyticsRepository, enqueueInstagramInsights, instagramInsightsIntervalMs } from "./instagram-insights.js";
import { StorageOrphanReconciler } from "./storage-orphans.js";
import { DatabaseKolaybiProductRepository } from "./kolaybi-products.js";
import { cargoPipelineIntervalMs, DatabaseCargoPipelineStore, runCargoPipelineTick } from "./cargo-pipeline.js";
import { S3ProviderMediaFileResolver, type ProviderMediaFileResolver } from "./providers/media-files.js";
import { DatabaseProviderAttemptRepository, type ProviderAttemptRepository } from "./providers/attempts.js";
import {
  DatabaseProviderAccountConfigRepository,
  type ProviderAccountConfigRepository,
} from "./providers/account-config.js";
import { createSecretDecryptor } from "./providers/encryption.js";
import {
  createWorkerMetrics,
  MetricsProviderAttemptRepository,
  recordJobCompletion,
  recordJobFailure,
  registerQueueDepthCollector,
  type WorkerMetrics,
} from "./observability.js";
import { drainWorkers, type DrainWorkersResult } from "./shutdown.js";
import { workerJobOptions } from "./queues.js";

class RedisSettingsChangeSubscriber implements SettingsChangeSubscriber {
  private readonly subscriber: Redis;

  constructor(redisUrl: string) {
    this.subscriber = new Redis(redisUrl, { maxRetriesPerRequest: null });
  }

  async subscribeSettingsChanged(handler: (message: SettingsChangedMessage) => void | Promise<void>): Promise<void> {
    this.subscriber.on("message", (channel, raw) => {
      if (channel !== "settings.changed") {
        return;
      }

      // One malformed publish must not crash every worker replica (JSON.parse used to throw here).
      let message: unknown;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      const parsed = settingsChangedMessageSchema.safeParse(message);
      if (parsed.success) {
        void Promise.resolve(handler(parsed.data)).catch(() => undefined);
      }
    });
    await this.subscriber.subscribe("settings.changed");
  }

  async close(): Promise<void> {
    this.subscriber.disconnect();
  }
}

export interface WorkerRuntime {
  connection: Redis;
  registry: WorkerProcessorRegistry;
  workers: Map<QueueName, Worker<JobEnvelope>>;
  schedulers: Map<QueueName, Queue<JobEnvelope>>;
  metricQueues: Map<QueueName, Queue<JobEnvelope>>;
  metrics: WorkerMetrics;
  db: AppDatabase | null;
  /** Pauses all workers, waits for active jobs up to the shutdown timeout, then releases connections. */
  close: () => Promise<DrainWorkersResult>;
}

export interface WorkerRuntimeOptions {
  redisUrl: string;
  logger: pino.Logger;
  databaseUrl?: string | null;
  lifecycleRecorder?: WorkerLifecycleRecorder;
  providerAttemptRepository?: ProviderAttemptRepository;
  providerAccountConfigRepository?: ProviderAccountConfigRepository;
  mediaFileResolver?: ProviderMediaFileResolver;
  settingsChangeSubscriber?: SettingsChangeSubscriber;
  metrics?: WorkerMetrics;
  concurrency?: number;
  shutdownTimeoutMs?: number;
}

export function createWorkerRuntime(options: WorkerRuntimeOptions): WorkerRuntime {
  const connection = new Redis(options.redisUrl, {
    maxRetriesPerRequest: null,
  });
  const db: AppDatabase | null =
    options.providerAttemptRepository || !options.databaseUrl ? null : createDatabase(options.databaseUrl);
  const metrics = options.metrics ?? createWorkerMetrics();
  const providerAttemptRepository = new MetricsProviderAttemptRepository(
    metrics,
    options.providerAttemptRepository ?? (db ? new DatabaseProviderAttemptRepository(db) : undefined),
  );
  const decryptor = createSecretDecryptor(
    process.env.APP_ENCRYPTION_KEY ?? "local-development-encryption-key-change-me",
    process.env.APP_ENCRYPTION_KEY_ID ?? "default",
  );
  const providerAccountConfigRepository =
    options.providerAccountConfigRepository ??
    (db ? new DatabaseProviderAccountConfigRepository(db, decryptor) : undefined);
  const storageOrphanReconciler = db ? new StorageOrphanReconciler(db) : undefined;
  const shipmentWritebackRepository = db ? new DatabaseShipmentWritebackRepository(db) : undefined;
  const instagramAnalyticsRepository = db ? new DatabaseInstagramAnalyticsRepository(db) : undefined;
  const kolaybiProductRepository = db ? new DatabaseKolaybiProductRepository(db) : undefined;
  const dataRetentionStore = db ? new DatabaseDataRetentionStore(db) : undefined;
  const inboundMessageStore = db ? new DatabaseInboundMessageStore(db) : undefined;
  const mediaFileResolver =
    options.mediaFileResolver ?? (db ? new S3ProviderMediaFileResolver(db) : undefined);
  const settingsChangeSubscriber =
    options.settingsChangeSubscriber ??
    (options.redisUrl ? new RedisSettingsChangeSubscriber(options.redisUrl) : undefined);
  // Background startup work reports its failures instead of becoming an unhandled rejection (which exits Node).
  const reportStartupFailure = (event: string, msg: string) => (error: unknown) => {
    options.logger.error(createStructuredLog({ level: "error", service: "worker", event, msg, context: { err: error } }), msg);
  };
  bindProviderConfigInvalidation(providerAccountConfigRepository, settingsChangeSubscriber).catch(
    reportStartupFailure("worker.provider_config_hydrate_failed", "Provider config cache could not be warmed up"),
  );
  const registry = createWorkerProcessorRegistry({
    lifecycleRecorder:
      options.lifecycleRecorder ??
      ((event) => {
        options.logger.info(
          createStructuredLog({
            level: "info",
            service: "worker",
            event: `worker.job_${event.event}`,
            job_id: event.job_id,
            msg: "Worker job lifecycle event",
            context: { ...event },
          }),
          "Worker job lifecycle event",
        );
      }),
    providerAttemptRepository,
    ...(providerAccountConfigRepository ? { providerAccountConfigRepository } : {}),
    ...(storageOrphanReconciler ? { storageOrphanReconciler } : {}),
    ...(mediaFileResolver ? { mediaFileResolver } : {}),
    ...(shipmentWritebackRepository ? { shipmentWritebackRepository } : {}),
    ...(instagramAnalyticsRepository ? { instagramAnalyticsRepository } : {}),
    ...(kolaybiProductRepository ? { kolaybiProductRepository } : {}),
    ...(dataRetentionStore ? { dataRetentionStore } : {}),
    ...(inboundMessageStore ? { inboundMessageStore } : {}),
  });

  const workers = new Map<QueueName, Worker<JobEnvelope>>();
  const schedulers = new Map<QueueName, Queue<JobEnvelope>>();

  for (const queue of registry.queues) {
    const worker = new Worker<JobEnvelope>(
      queue,
      async (job) => registry.dispatch(queue, job),
      {
        connection,
        concurrency: options.concurrency ?? 5,
      },
    );

    worker.on("completed", (job, returnValue) => {
      recordJobCompletion(metrics, queue, job.data, returnValue);
      // The carrier call succeeded but storing its result did not (the job is not retried, to avoid re-sending):
      // make that visible instead of only returning "failed" in the job result.
      const followUps = ["shipment_writeback", "instagram_analytics", "kolaybi_products"] as const;
      const failedFollowUp = followUps.find((key) => (returnValue as Record<string, unknown> | null)?.[key] === "failed");
      if (failedFollowUp) {
        options.logger.error(
          createStructuredLog({
            level: "error",
            service: "worker",
            event: "worker.result_writeback_failed",
            request_id: job.data.request_id ?? null,
            job_id: job.data.job_id,
            msg: "Provider call succeeded but its result could not be stored",
            context: { queue, name: job.name, step: failedFollowUp },
          }),
          "Provider call succeeded but its result could not be stored",
        );
      }
      options.logger.info(
        createStructuredLog({
          level: "info",
          service: "worker",
          event: "worker.job_completed",
          request_id: job.data.request_id ?? null,
          job_id: job.data.job_id,
          msg: "Worker job completed",
          context: {
            queue,
            bullmq_job_id: job.id,
            name: job.name,
          },
        }),
        "Worker job completed",
      );
    });

    worker.on("failed", (job, error) => {
      recordJobFailure(metrics, queue, job);
      options.logger.error(
        createStructuredLog({
          level: "error",
          service: "worker",
          event: "worker.job_failed",
          request_id: job?.data.request_id ?? null,
          job_id: job?.data.job_id ?? null,
          msg: "Worker job failed",
          context: {
            queue,
            bullmq_job_id: job?.id,
            name: job?.name,
            err: error,
          },
        }),
        "Worker job failed",
      );
    });

    worker.on("error", (error) => {
      options.logger.error(
        createStructuredLog({
          level: "error",
          service: "worker",
          event: "worker.runtime_error",
          msg: "Worker runtime error",
          context: { queue, err: error },
        }),
        "Worker runtime error",
      );
    });

    workers.set(queue, worker);
  }

  const storageScheduler = new Queue<JobEnvelope>("storage-orphan-reconciliation", { connection });
  schedulers.set("storage-orphan-reconciliation", storageScheduler);
  storageScheduler.add(
    "storage.orphans.reconcile",
    {
      job_id: "storage_orphans_reconcile_scheduled",
      queue: "storage-orphan-reconciliation",
      name: "storage.orphans.reconcile",
      payload: {
        mode: process.env.STORAGE_ORPHAN_DELETE_ENABLED === "true" ? "apply" : "dry_run",
        limit: Number.parseInt(process.env.STORAGE_ORPHAN_RECONCILIATION_LIMIT ?? "100", 10),
      },
      requested_at: new Date().toISOString(),
      request_id: "storage_orphans_reconcile_scheduled",
    },
    {
      jobId: "storage_orphans_reconcile_scheduled",
      repeat: {
        every: Number.parseInt(process.env.STORAGE_ORPHAN_RECONCILIATION_INTERVAL_MS ?? "86400000", 10),
      },
    },
  ).catch(reportStartupFailure("worker.storage_orphan_schedule_failed", "Repeatable job could not be scheduled"));

  // provider_attempts / webhook_events pruning (LOG_RETENTION_AND_PERSONAL_DATA.md); counts only
  // unless DATA_RETENTION_DELETE_ENABLED=true.
  const retentionScheduler = new Queue<JobEnvelope>("data-retention", { connection });
  schedulers.set("data-retention", retentionScheduler);
  retentionScheduler.add(
    "data.retention.prune",
    {
      job_id: "data_retention_prune_scheduled",
      queue: "data-retention",
      name: "data.retention.prune",
      payload: { mode: process.env.DATA_RETENTION_DELETE_ENABLED === "true" ? "apply" : "dry_run" },
      requested_at: new Date().toISOString(),
      request_id: "data_retention_prune_scheduled",
    },
    {
      jobId: "data_retention_prune_scheduled",
      repeat: {
        every: Number.parseInt(process.env.DATA_RETENTION_INTERVAL_MS ?? "86400000", 10),
      },
    },
  ).catch(reportStartupFailure("worker.data_retention_schedule_failed", "Repeatable job could not be scheduled"));

  // These queues also publish the worker's own jobs (cargo pipeline SMS / VAPI, Instagram insights): same retry and
  // retention defaults as the API publishers, otherwise they ran once and were kept in Redis forever.
  const metricQueues = new Map<QueueName, Queue<JobEnvelope>>(
    registry.queues.map((queue) => [queue, new Queue<JobEnvelope>(queue, { connection, defaultJobOptions: workerJobOptions })]),
  );
  registerQueueDepthCollector(metrics, metricQueues);

  // Live Instagram statistics: refresh every active account each interval (INSTAGRAM_INSIGHTS_INTERVAL_MS,
  // default 6 h, 0 disables). The worker's live gate still decides whether Graph is actually called.
  const insightsIntervalMs = instagramInsightsIntervalMs();
  const deliveryQueue = metricQueues.get("provider-delivery");
  const enqueueInsights = () => {
    if (!instagramAnalyticsRepository || !deliveryQueue) return;
    void enqueueInstagramInsights({
      repository: instagramAnalyticsRepository,
      publish: (job) => deliveryQueue.add(job.name, job, { jobId: job.job_id }),
      intervalMs: insightsIntervalMs,
    }).catch((error: unknown) => {
      options.logger.error(
        createStructuredLog({
          level: "error",
          service: "worker",
          event: "worker.instagram_insights_schedule_failed",
          msg: "Instagram insights refresh could not be scheduled",
          context: { err: error },
        }),
        "Instagram insights refresh could not be scheduled",
      );
    });
  };
  const insightsTimer = insightsIntervalMs > 0 && instagramAnalyticsRepository ? setInterval(enqueueInsights, insightsIntervalMs) : null;
  insightsTimer?.unref();
  if (insightsTimer) enqueueInsights();

  // Legacy kargoPipelineCron (teslim alınmayan kargo: mesaj → sms → vapi). CARGO_PIPELINE_INTERVAL_MS, default 60 s,
  // 0 disables; the pipeline itself stays off until global setting kargo_pipeline_ayarlar.aktif is true.
  const cargoPipelineStore = db ? new DatabaseCargoPipelineStore(db) : undefined;
  const cargoPipelineInterval = cargoPipelineIntervalMs();
  let cargoPipelineTick: Promise<void> | null = null;
  const tickCargoPipeline = () => {
    if (!cargoPipelineStore || !deliveryQueue || cargoPipelineTick) return;
    cargoPipelineTick = runCargoPipelineTick({
      store: cargoPipelineStore,
      publish: async (job) => (await deliveryQueue.add(job.name, job, { jobId: job.job_id })).id ?? null,
    })
      .catch((error: unknown) => {
        options.logger.error(
          createStructuredLog({
            level: "error",
            service: "worker",
            event: "worker.cargo_pipeline_tick_failed",
            msg: "Cargo pipeline tick failed",
            context: { err: error },
          }),
          "Cargo pipeline tick failed",
        );
      })
      .then(() => undefined)
      .finally(() => {
        cargoPipelineTick = null;
      });
  };
  const cargoPipelineTimer = cargoPipelineInterval > 0 && cargoPipelineStore ? setInterval(tickCargoPipeline, cargoPipelineInterval) : null;
  cargoPipelineTimer?.unref();

  return {
    connection,
    registry,
    workers,
    schedulers,
    metricQueues,
    metrics,
    db,
    close: async () => {
      if (insightsTimer) clearInterval(insightsTimer);
      if (cargoPipelineTimer) clearInterval(cargoPipelineTimer);
      // Let a running tick finish its claimed rows before the database goes away (they used to stay `isleniyor`).
      await cargoPipelineTick;
      const result = await drainWorkers(workers.values(), options.shutdownTimeoutMs ?? 30_000);
      await Promise.all([...metricQueues.values()].map((queue) => queue.close()));
      await Promise.all([...schedulers.values()].map((scheduler) => scheduler.close()));
      await settingsChangeSubscriber?.close();
      connection.disconnect();
      await db?.destroy();
      return result;
    },
  };
}
