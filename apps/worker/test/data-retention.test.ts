import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobEnvelope } from "@garanti-kulucka/shared";
import { dataRetentionPolicyFromEnv, runDataRetention, type DataRetentionStore, type RetentionTable } from "../src/data-retention.js";
import { createWorkerMetrics, recordJobCompletion } from "../src/observability.js";
import { createWorkerProcessorRegistry } from "../src/processors.js";

const now = new Date("2026-10-07T09:00:00.000Z");
const policy = { providerAttemptsDays: 180, webhookEventsDays: 90, batchSize: 2, maxBatches: 10 };

function fakeStore(rows: Record<RetentionTable, number>) {
  const remaining = { ...rows };
  const cutoffs: Array<[RetentionTable, string]> = [];
  const store: DataRetentionStore = {
    countCandidates: vi.fn(async (table: RetentionTable, cutoff: Date) => {
      cutoffs.push([table, cutoff.toISOString()]);
      return remaining[table];
    }),
    deleteBatch: vi.fn(async (table: RetentionTable, _cutoff: Date, limit: number) => {
      const removed = Math.min(limit, remaining[table]);
      remaining[table] -= removed;
      return removed;
    }),
  };
  return { store, remaining, cutoffs };
}

afterEach(() => {
  delete process.env.DATA_RETENTION_DELETE_ENABLED;
});

describe("data retention pruning", () => {
  it("only counts candidates until DATA_RETENTION_DELETE_ENABLED is set", async () => {
    const { store, remaining, cutoffs } = fakeStore({ provider_attempts: 5, webhook_events: 3 });
    const result = await runDataRetention({ store, policy, mode: "apply", deleteEnabled: false, now });
    expect(result).toMatchObject({ mode: "dry_run", delete_enabled: false });
    expect(result.tables.map((table) => [table.table, table.candidates, table.deleted])).toEqual([
      ["provider_attempts", 5, 0],
      ["webhook_events", 3, 0],
    ]);
    expect(store.deleteBatch).not.toHaveBeenCalled();
    expect(remaining).toEqual({ provider_attempts: 5, webhook_events: 3 });
    // 180 and 90 days before the run.
    expect(cutoffs).toEqual([
      ["provider_attempts", "2026-04-10T09:00:00.000Z"],
      ["webhook_events", "2026-07-09T09:00:00.000Z"],
    ]);
  });

  it("deletes in batches and reports a run cut short by the batch cap", async () => {
    const full = fakeStore({ provider_attempts: 5, webhook_events: 4 });
    const result = await runDataRetention({ store: full.store, policy, mode: "apply", deleteEnabled: true, now });
    expect(result.mode).toBe("apply");
    expect(result.tables).toMatchObject([
      { table: "provider_attempts", candidates: 5, deleted: 5, complete: true },
      { table: "webhook_events", candidates: 4, deleted: 4, complete: true },
    ]);
    expect(full.remaining).toEqual({ provider_attempts: 0, webhook_events: 0 });

    const capped = fakeStore({ provider_attempts: 9, webhook_events: 0 });
    const partial = await runDataRetention({ store: capped.store, policy: { ...policy, maxBatches: 2 }, mode: "apply", deleteEnabled: true, now });
    expect(partial.tables[0]).toMatchObject({ candidates: 9, deleted: 4, complete: false });
    expect(capped.store.deleteBatch).toHaveBeenCalledTimes(2);
  });

  it("reads the policy from the environment with a 30-day floor", () => {
    expect(dataRetentionPolicyFromEnv({})).toEqual({ providerAttemptsDays: 180, webhookEventsDays: 90, batchSize: 1000, maxBatches: 50 });
    expect(dataRetentionPolicyFromEnv({ DATA_RETENTION_PROVIDER_ATTEMPTS_DAYS: "7", DATA_RETENTION_WEBHOOK_EVENTS_DAYS: "120", DATA_RETENTION_BATCH_SIZE: "5" })).toMatchObject({
      providerAttemptsDays: 30,
      webhookEventsDays: 120,
      batchSize: 100,
    });
  });

  it("runs as data.retention.prune on the data-retention queue and exports metrics", async () => {
    const { store } = fakeStore({ provider_attempts: 3, webhook_events: 1 });
    const registry = createWorkerProcessorRegistry({ dataRetentionStore: store });
    const envelope: JobEnvelope = { job_id: "data_retention_prune_scheduled", queue: "data-retention", name: "data.retention.prune", payload: { mode: "apply" }, requested_at: now.toISOString() };
    const job = { id: "bull_1", name: envelope.name, data: envelope };

    const dryRun = await registry.dispatch("data-retention", job as never);
    expect(dryRun).toMatchObject({ mode: "dry_run" });

    process.env.DATA_RETENTION_DELETE_ENABLED = "true";
    const applied = (await registry.dispatch("data-retention", job as never)) as { mode: string; tables: unknown[] };
    expect(applied).toMatchObject({ mode: "apply", tables: [{ table: "provider_attempts", deleted: 3 }, { table: "webhook_events", deleted: 1 }] });

    await expect(registry.dispatch("data-retention", { ...job, name: "data.retention.other", data: { ...envelope, name: "data.retention.other" } } as never)).rejects.toThrow("Unknown data retention job name");
    await expect(createWorkerProcessorRegistry().dispatch("data-retention", job as never)).rejects.toThrow("database-backed store");

    const metrics = createWorkerMetrics();
    recordJobCompletion(metrics, "data-retention", envelope, applied);
    recordJobCompletion(metrics, "data-retention", envelope, dryRun);
    const text = await metrics.registry.render();
    expect(text).toContain('data_retention_deleted_rows_total{table="provider_attempts",service="worker"} 3');
    expect(text).toContain('data_retention_candidate_rows{table="provider_attempts",service="worker"} 3');
  });
});
