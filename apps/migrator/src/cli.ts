import pino from "pino";
import { createStructuredLog, ServiceConfigError, validateServiceEnv } from "@garanti-kulucka/shared";
import { parseMigratorCliCommand, runMigratorCommand } from "./commands.js";
import { createMigratorFailureLogPayload } from "./logging.js";

const logger = pino({ name: "migrator" });

try {
  validateServiceEnv("migrator", process.env);
} catch (error) {
  if (error instanceof ServiceConfigError) {
    logger.error(
      createStructuredLog({
        level: "error",
        service: "migrator",
        event: "migrator.config_invalid",
        msg: "Migrator configuration is invalid",
        context: { app_env: error.appEnv, issues: error.issues },
      }),
      error.message,
    );
    process.exit(78);
  }
  throw error;
}

const { command, options } = parseMigratorCliCommand(process.argv.slice(2));

logger.info(
  createStructuredLog({
    level: "info",
    service: "migrator",
    event: "migrator.command_accepted",
    msg: "Migrator command accepted",
    context: { command, reportFile: options.reportFile },
  }),
  "Migrator command accepted",
);

try {
  await runMigratorCommand(command, process.env, options);
  logger.info(
    createStructuredLog({
      level: "info",
      service: "migrator",
      event: "migrator.command_completed",
      msg: "Migrator command completed",
      context: { command, reportFile: options.reportFile },
    }),
    "Migrator command completed",
  );
} catch (error) {
  logger.error(
    createMigratorFailureLogPayload(error, command, options.reportFile),
    "Migrator command failed",
  );
  process.exit(1);
}
