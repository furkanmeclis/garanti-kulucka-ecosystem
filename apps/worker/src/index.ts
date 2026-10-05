import pino from "pino";
import { createStructuredLog } from "@garanti-kulucka/shared";
import { createWorkerRuntime } from "./runtime.js";

const logger = pino({ name: "worker" });
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const runtime = createWorkerRuntime({ redisUrl, logger, databaseUrl: process.env.DATABASE_URL ?? null });
let shuttingDown = false;

logger.info(
  createStructuredLog({
    level: "info",
    service: "worker",
    event: "worker.runtime_ready",
    msg: "Worker runtime ready",
    context: { queues: [...runtime.workers.keys()] },
  }),
  "Worker runtime ready",
);

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info(
    createStructuredLog({
      level: "info",
      service: "worker",
      event: "worker.shutdown_started",
      msg: "Worker shutdown started",
      context: { signal },
    }),
    "Worker shutdown started",
  );

  try {
    await runtime.close();
    logger.info(
      createStructuredLog({
        level: "info",
        service: "worker",
        event: "worker.shutdown_completed",
        msg: "Worker shutdown completed",
        context: { signal },
      }),
      "Worker shutdown completed",
    );
  } catch (error) {
    logger.error(
      createStructuredLog({
        level: "error",
        service: "worker",
        event: "worker.shutdown_failed",
        msg: "Worker shutdown failed",
        context: { signal, err: error },
      }),
      "Worker shutdown failed",
    );
    process.exitCode = 1;
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
