import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database } from "./schema.js";

export type AppDatabase = Kysely<Database>;

export function createDatabase(connectionString: string): AppDatabase {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString }),
    }),
  });
}

export type * from "./schema.js";
