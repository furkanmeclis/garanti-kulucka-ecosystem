import pino from "pino";
import { createStructuredLog } from "@garanti-kulucka/shared";
import { resolveMetricsExposure } from "@garanti-kulucka/shared";
import { startWorkerHttpServer } from "./observability.js";
import { createWorkerRuntime } from "./runtime.js";

const logger = pino({ name: "worker" });
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const runtime = createWorkerRuntime({ redisUrl, logger, databaseUrl: process.env.DATABASE_URL ?? null });
let shuttingDown = false;
const metricsExposure = resolveMetricsExposure(process.env);
const healthPort = Number.parseInt(process.env.WORKER_HTTP_PORT ?? "3001", 10);
const httpServer = startWorkerHttpServer(healthPort, {
  metrics: runtime.metrics,
  health: { redis: runtime.connection, db: runtime.db },
  exposure: metricsExposure,
  internalListener: metricsExposure.port === healthPort,
});
const internalMetricsServer =
  metricsExposure.enabled && metricsExposure.port !== null && metricsExposure.port !== healthPort
    ? startWorkerHttpServer(metricsExposure.port, {
        metrics: runtime.metrics,
        health: { redis: runtime.connection, db: runtime.db },
        exposure: metricsExposure,
        internalListener: true,
      })
    : null;

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
    httpServer.close();
    internalMetricsServer?.close();
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
