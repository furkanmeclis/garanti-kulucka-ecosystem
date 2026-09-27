import { Worker } from "bullmq";
import { Redis } from "ioredis";
import type pino from "pino";
import type { JobEnvelope, QueueName } from "@garanti-kulucka/shared";
import {
  createWorkerProcessorRegistry,
  type WorkerLifecycleRecorder,
  type WorkerProcessorRegistry,
} from "./processors.js";

export interface WorkerRuntime {
  connection: Redis;
  registry: WorkerProcessorRegistry;
  workers: Map<QueueName, Worker<JobEnvelope>>;
  close: () => Promise<void>;
}

export interface WorkerRuntimeOptions {
  redisUrl: string;
  logger: pino.Logger;
  lifecycleRecorder?: WorkerLifecycleRecorder;
}

export function createWorkerRuntime(options: WorkerRuntimeOptions): WorkerRuntime {
  const connection = new Redis(options.redisUrl, {
    maxRetriesPerRequest: null,
  });
  const registry = createWorkerProcessorRegistry(
    options.lifecycleRecorder ??
      ((event) => {
        options.logger.info(event, "Worker job lifecycle event");
      }),
  );

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
        {
          queue,
          job_id: job.data.job_id,
          bullmq_job_id: job.id,
          name: job.name,
        },
        "Worker job completed",
      );
    });

    worker.on("failed", (job, error) => {
      options.logger.error(
        {
          queue,
          job_id: job?.data.job_id,
          bullmq_job_id: job?.id,
          name: job?.name,
          err: error,
        },
        "Worker job failed",
      );
    });

    worker.on("error", (error) => {
      options.logger.error({ queue, err: error }, "Worker runtime error");
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
    },
  };
}
