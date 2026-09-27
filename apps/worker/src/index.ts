import pino from "pino";
import { createWorkerRuntime } from "./runtime.js";

const logger = pino({ name: "worker" });
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const runtime = createWorkerRuntime({ redisUrl, logger });
let shuttingDown = false;

logger.info({ queues: [...runtime.workers.keys()] }, "Worker runtime ready");

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info({ signal }, "Worker shutdown started");

  try {
    await runtime.close();
    logger.info({ signal }, "Worker shutdown completed");
  } catch (error) {
    logger.error({ signal, err: error }, "Worker shutdown failed");
    process.exitCode = 1;
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
