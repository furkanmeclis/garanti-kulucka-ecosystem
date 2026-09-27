import pino from "pino";
import { parseMigratorCliCommand, runMigratorCommand } from "./commands.js";

const logger = pino({ name: "migrator" });
const { command, options } = parseMigratorCliCommand(process.argv.slice(2));

logger.info({ command, reportFile: options.reportFile }, "Migrator command accepted");

try {
  await runMigratorCommand(command, process.env, options);
  logger.info({ command, reportFile: options.reportFile }, "Migrator command completed");
} catch (error) {
  logger.error({ err: error, command, reportFile: options.reportFile }, "Migrator command failed");
  process.exit(1);
}
