import { Worker } from "bullmq";
import { createDatabase, type AppDatabase } from "@garanti-kulucka/database";
import { Redis } from "ioredis";
import type pino from "pino";
import { createStructuredLog, type JobEnvelope, type QueueName } from "@garanti-kulucka/shared";
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
      connection.disconnect();
      await db?.destroy();
    },
  };
}
