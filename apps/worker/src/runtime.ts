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
import { StorageOrphanReconciler } from "./storage-orphans.js";
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

      const parsed = settingsChangedMessageSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        void handler(parsed.data);
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
  const mediaFileResolver =
    options.mediaFileResolver ?? (db ? new S3ProviderMediaFileResolver(db) : undefined);
  const settingsChangeSubscriber =
    options.settingsChangeSubscriber ??
    (options.redisUrl ? new RedisSettingsChangeSubscriber(options.redisUrl) : undefined);
  void bindProviderConfigInvalidation(providerAccountConfigRepository, settingsChangeSubscriber);
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
  void storageScheduler.add(
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
  );

  const metricQueues = new Map<QueueName, Queue<JobEnvelope>>(
    registry.queues.map((queue) => [queue, new Queue<JobEnvelope>(queue, { connection })]),
  );
  registerQueueDepthCollector(metrics, metricQueues);

  return {
    connection,
    registry,
    workers,
    schedulers,
    metricQueues,
    metrics,
    db,
    close: async () => {
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
