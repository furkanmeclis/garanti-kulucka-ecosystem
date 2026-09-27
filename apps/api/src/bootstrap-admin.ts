import pino from "pino";
import { loadConfig } from "./config.js";
import { createApiDatabase } from "./database.js";
import { bootstrapAdmin } from "./bootstrap/admin.js";

const logger = pino({ name: "api-bootstrap-admin" });

const config = loadConfig();
const database = createApiDatabase(config);

if (!database.db) {
  logger.error("DATABASE_URL is required to bootstrap the first admin");
  process.exit(1);
}

const email = process.env.FIRST_ADMIN_EMAIL;
const password = process.env.FIRST_ADMIN_PASSWORD;

if (!email || !password) {
  logger.error("FIRST_ADMIN_EMAIL and FIRST_ADMIN_PASSWORD are required");
  process.exit(1);
}

try {
  const result = await bootstrapAdmin(database.db, {
    email,
    password,
    firstName: process.env.FIRST_ADMIN_FIRST_NAME ?? "System",
    lastName: process.env.FIRST_ADMIN_LAST_NAME ?? "Owner",
  });

  logger.info(
    {
      status: result.status,
      email: result.email,
      public_id: result.publicId,
    },
    "Admin bootstrap completed",
  );
} catch (error) {
  logger.error({ err: error }, "Admin bootstrap failed");
  process.exitCode = 1;
} finally {
  await database.destroy();
}
