import pino from "pino";
import { parseMigratorCommand } from "./commands.js";

const logger = pino({ name: "migrator" });
const command = parseMigratorCommand(process.argv.slice(2));

logger.info({ command }, "Migrator command accepted");
