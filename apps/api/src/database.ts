import { createDatabase, type AppDatabase } from "@garanti-kulucka/database";
import type { ApiConfig } from "./config.js";

export interface ApiDatabaseHandle {
  db: AppDatabase | null;
  destroy: () => Promise<void>;
}

export function createApiDatabase(config: ApiConfig): ApiDatabaseHandle {
  if (!config.databaseUrl) {
    return {
      db: null,
      destroy: async () => undefined,
    };
  }

  const db = createDatabase(config.databaseUrl);

  return {
    db,
    destroy: () => db.destroy(),
  };
}
