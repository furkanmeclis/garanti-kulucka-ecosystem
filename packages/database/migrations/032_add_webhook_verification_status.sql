-- Up Migration
ALTER TABLE webhook_events ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified'
  CHECK (verification_status IN ('verified', 'unverified', 'rejected'));

-- Down Migration
ALTER TABLE webhook_events DROP COLUMN verification_status;
