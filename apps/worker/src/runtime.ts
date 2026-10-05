import { Worker } from "bullmq";
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
import { DatabaseProviderAttemptRepository, type ProviderAttemptRepository } from "./providers/attempts.js";
import {
  DatabaseProviderAccountConfigRepository,
  type ProviderAccountConfigRepository,
} from "./providers/account-config.js";
import { createSecretDecryptor } from "./providers/encryption.js";

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
  close: () => Promise<void>;
}

export interface WorkerRuntimeOptions {
  redisUrl: string;
  logger: pino.Logger;
  databaseUrl?: string | null;
  lifecycleRecorder?: WorkerLifecycleRecorder;
  providerAttemptRepository?: ProviderAttemptRepository;
  providerAccountConfigRepository?: ProviderAccountConfigRepository;
  settingsChangeSubscriber?: SettingsChangeSubscriber;
}

export function createWorkerRuntime(options: WorkerRuntimeOptions): WorkerRuntime {
  const connection = new Redis(options.redisUrl, {
    maxRetriesPerRequest: null,
  });
  const db: AppDatabase | null =
    options.providerAttemptRepository || !options.databaseUrl ? null : createDatabase(options.databaseUrl);
  const providerAttemptRepository =
    options.providerAttemptRepository ??
    (db ? new DatabaseProviderAttemptRepository(db) : undefined);
  const decryptor = createSecretDecryptor(
    process.env.APP_ENCRYPTION_KEY ?? "local-development-encryption-key-change-me",
    process.env.APP_ENCRYPTION_KEY_ID ?? "default",
  );
  const providerAccountConfigRepository =
    options.providerAccountConfigRepository ??
    (db ? new DatabaseProviderAccountConfigRepository(db, decryptor) : undefined);
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
    ...(providerAttemptRepository ? { providerAttemptRepository } : {}),
    ...(providerAccountConfigRepository ? { providerAccountConfigRepository } : {}),
  });

  const workers = new Map<QueueName, Worker<JobEnvelope>>();

  for (const queue of registry.queues) {
    const worker = new Worker<JobEnvelope>(
      queue,
      async (job) => registry.dispatch(queue, job),
      {
        connection,
        concurrency: Number.parseInt(process.env.WORKER_CONCURRENCY ?? "5", 10),
      },
    );

    worker.on("completed", (job) => {
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

  return {
    connection,
    registry,
    workers,
    close: async () => {
      await Promise.all([...workers.values()].map((worker) => worker.close()));
      await settingsChangeSubscriber?.close();
      connection.disconnect();
      await db?.destroy();
    },
  };
}
