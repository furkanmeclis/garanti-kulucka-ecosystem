import { readFile } from "node:fs/promises";
import pino from "pino";
import { loadConfig } from "./config.js";
import { createApiDatabase } from "./database.js";
import { createSecretEncryptor } from "./security/encryption.js";
import { bootstrapLegacyUsers, parseLegacyUsers } from "./bootstrap/legacy-users.js";
import { openPrivateOutput } from "./bootstrap/private-file.js";

const logger = pino({ name: "api-bootstrap-legacy-users" });
const config = loadConfig();
const database = createApiDatabase(config);
try {
  const input = process.env.LEGACY_USERS_FILE;
  const output = process.env.LEGACY_USERS_PASSWORDS_FILE;
  if (!database.db || !input || !output || !process.env.APP_ENCRYPTION_KEY) {
    throw new Error("Missing bootstrap configuration");
  }
  const users = parseLegacyUsers(JSON.parse(await readFile(input, "utf8")));
  const file = await openPrivateOutput(output);
  try {
    const result = await bootstrapLegacyUsers(database.db, users,
      createSecretEncryptor(config.encryptionKey, config.encryptionKeyId), async (credentials) => {
        await file.writeFile(JSON.stringify(credentials, null, 2) + "\n", "utf8");
        await file.sync();
      });
    logger.info(result, "Legacy users bootstrap completed");
  } finally { await file.close(); }
} catch {
  // Database/validation errors can contain PII; never log their details.
  logger.error("Legacy users bootstrap failed; verify configuration, input identities and output path");
  process.exitCode = 1;
} finally { await database.destroy(); }
