-- Up Migration

-- data.retention.prune (worker) deletes provider_attempts by started_at and processed webhook events by
-- processed_at in id batches (docs/operations/LOG_RETENTION_AND_PERSONAL_DATA.md); these indexes keep
-- the candidate scans off sequential reads.
CREATE INDEX IF NOT EXISTS provider_attempts_started_at_idx ON provider_attempts(started_at);
CREATE INDEX IF NOT EXISTS webhook_events_processed_at_idx ON webhook_events(processed_at) WHERE processed_at IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS webhook_events_processed_at_idx;
DROP INDEX IF EXISTS provider_attempts_started_at_idx;
