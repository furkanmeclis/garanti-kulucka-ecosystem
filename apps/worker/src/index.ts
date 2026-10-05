import type { Server } from "node:http";
import pino from "pino";
import { createStructuredLog, resolveMetricsExposure, ServiceConfigError, validateServiceEnv } from "@garanti-kulucka/shared";
import { startWorkerHttpServer } from "./observability.js";
import { createWorkerRuntime } from "./runtime.js";

const logger = pino({ name: "worker" });

let env: ReturnType<typeof validateServiceEnv<"worker">>;
try {
  env = validateServiceEnv("worker", process.env);
} catch (error) {
  if (error instanceof ServiceConfigError) {
    logger.fatal(
      createStructuredLog({
        level: "error",
        service: "worker",
        event: "worker.config_invalid",
        msg: "Worker configuration is invalid",
        context: { app_env: error.appEnv, issues: error.issues },
      }),
      error.message,
    );
    process.exit(78);
  }
  throw error;
}

const redisUrl = env.REDIS_URL ?? "redis://localhost:6379";
const shutdownTimeoutMs = env.WORKER_SHUTDOWN_TIMEOUT_MS ?? 30_000;
const runtime = createWorkerRuntime({
  redisUrl,
  logger,
  databaseUrl: env.DATABASE_URL ?? null,
  concurrency: env.WORKER_CONCURRENCY ?? 5,
  shutdownTimeoutMs,
});
let shuttingDown = false;
const metricsExposure = resolveMetricsExposure(process.env);
const healthPort = env.WORKER_HTTP_PORT ?? 3001;
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

function closeHttpServer(server: Server | null): Promise<void> {
  if (!server?.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

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
      context: { signal, timeout_ms: shutdownTimeoutMs },
    }),
    "Worker shutdown started",
  );

  try {
    // Health/metrics listeners stay up while jobs drain so probes and scrapes keep working.
    const result = await runtime.close();
    await Promise.all([closeHttpServer(httpServer), closeHttpServer(internalMetricsServer)]);
    if (!result.drained) {
      process.exitCode = 1;
    }
    logger.info(
      createStructuredLog({
        level: result.drained ? "info" : "warn",
        service: "worker",
        event: "worker.shutdown_completed",
        msg: "Worker shutdown completed",
        context: { signal, drained: result.drained, timed_out_workers: result.timedOutWorkers },
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
