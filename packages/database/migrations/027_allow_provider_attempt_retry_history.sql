-- Up Migration

-- provider_attempts kept one row per (provider, idempotency_key) for every status. A provider-delivery job that
-- failed once and was retried by BullMQ could then never record its next attempt: persist() hit the unique
-- index, the job failed again (even after a successful carrier call) and was retried — re-sending the SMS or
-- message. Failures may now repeat (retry history); a key still succeeds at most once, which the worker uses
-- as its replay guard before a live call.
DROP INDEX IF EXISTS provider_attempts_idempotency_key_idx;
CREATE UNIQUE INDEX IF NOT EXISTS provider_attempts_idempotency_success_idx
  ON provider_attempts(provider_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND status = 'success';
CREATE INDEX IF NOT EXISTS provider_attempts_provider_idempotency_idx
  ON provider_attempts(provider_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Down Migration
-- Restoring the strict index fails while retry history rows exist; prune duplicates (keep the newest) first.
DELETE FROM provider_attempts a
  USING provider_attempts b
  WHERE a.idempotency_key IS NOT NULL
    AND a.provider_id = b.provider_id
    AND a.idempotency_key = b.idempotency_key
    AND a.id < b.id;
DROP INDEX IF EXISTS provider_attempts_provider_idempotency_idx;
DROP INDEX IF EXISTS provider_attempts_idempotency_success_idx;
CREATE UNIQUE INDEX IF NOT EXISTS provider_attempts_idempotency_key_idx
  ON provider_attempts(provider_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
