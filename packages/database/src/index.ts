import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { installSafeIntegerTypeParsers } from "./integers.js";
import type { Database } from "./schema.js";

export type AppDatabase = Kysely<Database>;

export function createDatabase(connectionString: string): AppDatabase {
  installSafeIntegerTypeParsers();

  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString }),
    }),
  });
}

export { installSafeIntegerTypeParsers, parseSafePostgresInt8 } from "./integers.js";
export type * from "./schema.js";
