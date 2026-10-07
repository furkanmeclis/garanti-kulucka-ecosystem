import { sql, type AppDatabase } from "@garanti-kulucka/database";

/**
 * Database pruning from docs/operations/LOG_RETENTION_AND_PERSONAL_DATA.md:
 * - `provider_attempts` rows older than 180 days (by `started_at`)
 * - webhook event records 90 days after processing (by `processed_at`; unprocessed rows stay)
 * Runs as the scheduled `data.retention.prune` job. Like storage orphan cleanup it only counts
 * candidates unless DATA_RETENTION_DELETE_ENABLED=true, and deletes in small id batches so a run
 * never holds long locks.
 */

export type RetentionTable = "provider_attempts" | "webhook_events";

export interface DataRetentionPolicy {
  providerAttemptsDays: number;
  webhookEventsDays: number;
  batchSize: number;
  maxBatches: number;
}

export interface RetentionTableResult {
  table: RetentionTable;
  cutoff: string;
  candidates: number;
  deleted: number;
  /** false when the batch cap stopped an apply run before every candidate was removed */
  complete: boolean;
}

export interface DataRetentionResult {
  mode: "dry_run" | "apply";
  delete_enabled: boolean;
  tables: RetentionTableResult[];
}

export interface DataRetentionStore {
  countCandidates: (table: RetentionTable, cutoff: Date) => Promise<number>;
  deleteBatch: (table: RetentionTable, cutoff: Date, limit: number) => Promise<number>;
}

function intFrom(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Retention windows never go below 30 days, whatever the environment says. */
export function dataRetentionPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): DataRetentionPolicy {
  return {
    providerAttemptsDays: intFrom(env.DATA_RETENTION_PROVIDER_ATTEMPTS_DAYS, 180, 30, 3650),
    webhookEventsDays: intFrom(env.DATA_RETENTION_WEBHOOK_EVENTS_DAYS, 90, 30, 3650),
    batchSize: intFrom(env.DATA_RETENTION_BATCH_SIZE, 1000, 100, 10_000),
    maxBatches: intFrom(env.DATA_RETENTION_MAX_BATCHES, 50, 1, 1000),
  };
}

function cutoffFor(now: Date, days: number) {
  return new Date(now.getTime() - days * 86_400_000);
}

export async function runDataRetention(input: {
  store: DataRetentionStore;
  policy: DataRetentionPolicy;
  mode: "dry_run" | "apply";
  deleteEnabled: boolean;
  now?: Date;
}): Promise<DataRetentionResult> {
  const now = input.now ?? new Date();
  const apply = input.mode === "apply" && input.deleteEnabled;
  const plan: Array<[RetentionTable, number]> = [
    ["provider_attempts", input.policy.providerAttemptsDays],
    ["webhook_events", input.policy.webhookEventsDays],
  ];
  const tables: RetentionTableResult[] = [];
  for (const [table, days] of plan) {
    const cutoff = cutoffFor(now, days);
    const candidates = await input.store.countCandidates(table, cutoff);
    let deleted = 0;
    let complete = !apply ? candidates === 0 : true;
    if (apply && candidates > 0) {
      complete = false;
      for (let batch = 0; batch < input.policy.maxBatches; batch++) {
        const removed = await input.store.deleteBatch(table, cutoff, input.policy.batchSize);
        deleted += removed;
        if (removed < input.policy.batchSize) {
          complete = true;
          break;
        }
      }
    }
    tables.push({ table, cutoff: cutoff.toISOString(), candidates, deleted, complete });
  }
  return { mode: apply ? "apply" : "dry_run", delete_enabled: input.deleteEnabled, tables };
}

export class DatabaseDataRetentionStore implements DataRetentionStore {
  constructor(private readonly db: AppDatabase) {}

  async countCandidates(table: RetentionTable, cutoff: Date): Promise<number> {
    const row =
      table === "provider_attempts"
        ? await this.db.selectFrom("provider_attempts").select(sql<string>`count(*)`.as("total")).where("started_at", "<", cutoff).executeTakeFirst()
        : await this.db
            .selectFrom("webhook_events")
            .select(sql<string>`count(*)`.as("total"))
            .where("processed_at", "is not", null)
            .where("processed_at", "<", cutoff)
            .executeTakeFirst();
    return Number(row?.total ?? 0);
  }

  async deleteBatch(table: RetentionTable, cutoff: Date, limit: number): Promise<number> {
    const result =
      table === "provider_attempts"
        ? await this.db
            .deleteFrom("provider_attempts")
            .where("id", "in", (eb) => eb.selectFrom("provider_attempts").select("id").where("started_at", "<", cutoff).orderBy("id").limit(limit))
            .executeTakeFirst()
        : await this.db
            .deleteFrom("webhook_events")
            .where("id", "in", (eb) =>
              eb.selectFrom("webhook_events").select("id").where("processed_at", "is not", null).where("processed_at", "<", cutoff).orderBy("id").limit(limit),
            )
            .executeTakeFirst();
    return Number(result.numDeletedRows ?? 0);
  }
}
