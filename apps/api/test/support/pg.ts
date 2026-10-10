import { createDatabase, type AppDatabase } from "@garanti-kulucka/database";
import { afterAll, describe } from "vitest";

/**
 * Real-Postgres repository tests. They run only when TEST_DATABASE_URL points at a migrated database
 * (`npm run db:migrate:up`), e.g. the compose postgres; without it the suites are skipped. Every test runs in
 * a transaction that is rolled back, so the database is left as it was.
 */
export const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "";
export const describePg = testDatabaseUrl ? describe : describe.skip;

class Rollback extends Error {}

let shared: AppDatabase | null = null;

function database() {
  shared ??= createDatabase(testDatabaseUrl);
  return shared;
}

afterAll(async () => {
  await shared?.destroy();
  shared = null;
});

export async function withRollback(run: (db: AppDatabase) => Promise<void>) {
  try {
    await database().transaction().execute(async (transaction) => {
      await run(transaction as unknown as AppDatabase);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}
