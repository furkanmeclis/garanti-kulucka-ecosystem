-- Up Migration
-- Compatible with parallel migration 029; never remove this shared column on rollback.
ALTER TABLE users ADD COLUMN IF NOT EXISTS sip_extension TEXT;
CREATE INDEX IF NOT EXISTS users_sip_extension_idx ON users(sip_extension) WHERE sip_extension IS NOT NULL;
CREATE TABLE call_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'netgsm' CHECK (provider = 'netgsm'),
  unique_id TEXT UNIQUE,
  common_id TEXT,
  asterisk_id TEXT,
  direction TEXT CHECK (direction IN ('inbound', 'outbound', 'internal')),
  status TEXT CHECK (status IN ('answered', 'missed', 'busy', 'timeout', 'failed', 'cancelled')),
  caller TEXT, callee TEXT, clid TEXT,
  internal_number TEXT, customer_number TEXT, incoming_number TEXT,
  trunk TEXT, queue_name TEXT, context_name TEXT, dtmf_digits TEXT,
  talk_seconds INTEGER CHECK (talk_seconds >= 0),
  hold_seconds INTEGER CHECK (hold_seconds >= 0),
  initiated_at TIMESTAMPTZ, queued_at TIMESTAMPTZ, connected_at TIMESTAMPTZ, ended_at TIMESTAMPTZ,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  recording_url TEXT,
  recording_file_id BIGINT REFERENCES files(id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK (source IN ('netgsm_webhook', 'netgsm_report', 'softphone', 'legacy')),
  raw_payload JSONB NOT NULL DEFAULT '{}',
  events JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(events) = 'array'),
  missed_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX call_logs_user_time_idx ON call_logs(user_id, initiated_at DESC);
CREATE INDEX call_logs_customer_time_idx ON call_logs(customer_id, initiated_at DESC);
CREATE INDEX call_logs_order_idx ON call_logs(order_id);
CREATE INDEX call_logs_time_idx ON call_logs(initiated_at DESC, id DESC);
CREATE INDEX call_logs_direction_status_idx ON call_logs(direction, status, initiated_at DESC);
CREATE INDEX call_logs_common_id_idx ON call_logs(common_id);
CREATE INDEX call_logs_asterisk_id_idx ON call_logs(asterisk_id);
CREATE INDEX call_logs_recording_idx ON call_logs(recording_file_id);
CREATE INDEX call_logs_unarchived_idx ON call_logs(id) WHERE recording_url IS NOT NULL AND recording_file_id IS NULL;
CREATE INDEX call_logs_merge_idx ON call_logs(user_id, customer_number, initiated_at) WHERE source = 'softphone';
COMMENT ON TABLE call_logs IS 'NetGSM santral events/CDR, nightly report and beta softphone. Legacy arama_kayitlari is imported separately by the migrator; preserve its legacy identity in raw_payload and legacy_id_map.';
-- Down Migration
DROP TABLE IF EXISTS call_logs;
