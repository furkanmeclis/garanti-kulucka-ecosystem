import type { ProviderAttempt } from "@garanti-kulucka/shared";
import { afterEach, expect, it } from "vitest";
import { DatabaseProviderAttemptRepository } from "../src/providers/attempts.js";
import { describePg, testDatabase } from "./support/pg.js";

function attempt(overrides: Partial<ProviderAttempt>): ProviderAttempt {
  return {
    provider: "netgsm",
    operation: "sms.send",
    direction: "outbound",
    request_id: "req_pg_retry",
    started_at: "2026-10-10T08:00:00.000Z",
    duration_ms: 5,
    status: "retryable_failure",
    status_code: 503,
    retry_decision: "retry",
    next_retry_at: "2026-10-10T08:00:02.000Z",
    idempotency_key: "pg_retry_sms_1",
    request_metadata: {},
    response_metadata: { live_call_performed: true, accepted: false },
    error: { code: "provider_http_error", message: "NetGSM returned HTTP 503" },
    ...overrides,
  };
}

const keys = ["pg_retry_sms_1", "pg_dry_then_live"];

async function withCleanup(run: (db: ReturnType<typeof testDatabase>) => Promise<void>) {
  await run(testDatabase());
}

describePg("provider attempt persistence across BullMQ retries", () => {
  // The repository opens its own transactions, so rows are removed afterwards instead of rolled back.
  afterEach(async () => {
    await testDatabase().deleteFrom("provider_attempts").where("idempotency_key", "in", keys).execute();
  });

  it("records every failed retry, then the success, and exposes the live success as the replay guard", async () => {
    await withCleanup(async (db) => {
      const repository = new DatabaseProviderAttemptRepository(db);
      await repository.persist(attempt({}));
      // Before migration 027 this second row violated the (provider, idempotency_key) unique index.
      await repository.persist(attempt({ started_at: "2026-10-10T08:00:02.000Z" }));
      expect(await repository.findLiveSuccess("netgsm", "pg_retry_sms_1")).toBeNull();

      const success = await repository.persist(attempt({ status: "success", status_code: 200, retry_decision: "none", next_retry_at: null, error: null, response_metadata: { live_call_performed: true, accepted: true } }));
      const replay = await repository.findLiveSuccess("netgsm", "pg_retry_sms_1");
      expect(replay?.public_id).toBe(success.public_id);

      // A second live success for the same key (two workers raced) keeps the first row instead of failing the job.
      const duplicate = await repository.persist(attempt({ status: "success", status_code: 200, retry_decision: "none", next_retry_at: null, error: null, response_metadata: { live_call_performed: true, accepted: true } }));
      expect(duplicate.public_id).toBe(success.public_id);
      const rows = await db.selectFrom("provider_attempts").select(["status"]).where("idempotency_key", "=", "pg_retry_sms_1").execute();
      expect(rows.map((row) => row.status).sort()).toEqual(["retryable_failure", "retryable_failure", "success"]);
    });
  });

  it("lets a live success replace a dry-run success of the same key", async () => {
    await withCleanup(async (db) => {
      const repository = new DatabaseProviderAttemptRepository(db);
      const dryRun = { status: "success" as const, status_code: 202, retry_decision: "none" as const, next_retry_at: null, error: null, idempotency_key: "pg_dry_then_live", response_metadata: { live_call_performed: false, accepted: true } };
      await repository.persist(attempt(dryRun));
      expect(await repository.findLiveSuccess("netgsm", "pg_dry_then_live")).toBeNull();
      const live = await repository.persist(attempt({ ...dryRun, status_code: 200, response_metadata: { live_call_performed: true, accepted: true } }));
      expect((await repository.findLiveSuccess("netgsm", "pg_dry_then_live"))?.public_id).toBe(live.public_id);
    });
  });
});
