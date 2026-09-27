import pino from "pino";
import { parseMigratorCommand, runMigratorCommand } from "./commands.js";

const logger = pino({ name: "migrator" });
const command = parseMigratorCommand(process.argv.slice(2));

logger.info({ command }, "Migrator command accepted");

try {
  await runMigratorCommand(command);
  logger.info({ command }, "Migrator command completed");
} catch (error) {
  logger.error({ err: error, command }, "Migrator command failed");
  process.exit(1);
}
