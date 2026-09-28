import { toSafeMigratorError } from "./errors.js";

export interface PostgresSourceClient {
  connect(): Promise<unknown>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: unknown[],
  ): Promise<{ rows: Row[] }>;
  end(): Promise<void>;
}

export async function withReadonlyRepeatableReadTransaction<Result>(
  client: PostgresSourceClient,
  operation: () => Promise<Result>,
): Promise<Result> {
  let transactionOpen = false;
  let operationFailed = false;

  try {
    await client.connect();
    await client.query("begin transaction isolation level repeatable read read only");
    transactionOpen = true;
    const result = await operation();
    await client.query("commit");
    transactionOpen = false;
    return result;
  } catch (error) {
    operationFailed = true;
    if (transactionOpen) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the original migration failure.
      }
    }
    throw toSafeMigratorError(error);
  } finally {
    try {
      await client.end();
    } catch (error) {
      if (!operationFailed) {
        throw toSafeMigratorError(error);
      }
    }
  }
}
