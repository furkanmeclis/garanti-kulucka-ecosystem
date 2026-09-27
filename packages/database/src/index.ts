import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database } from "./schema.js";

export function createDatabase(connectionString: string): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString }),
    }),
  });
}

export type { Database } from "./schema.js";
