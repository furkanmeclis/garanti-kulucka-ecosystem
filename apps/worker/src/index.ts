import pino from "pino";
import { queueNames } from "./queues.js";

const logger = pino({ name: "worker" });

logger.info({ queues: queueNames }, "Worker bootstrap ready");

process.on("SIGINT", () => {
  logger.info("Worker received SIGINT");
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("Worker received SIGTERM");
  process.exit(0);
});
