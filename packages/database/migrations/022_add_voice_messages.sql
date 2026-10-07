-- Up Migration

-- Legacy SesliMesajlarPage (server.js /api/netgsm/sesli-mesaj/*): bulk NetGSM voice messages (TTS text
-- or an uploaded audio id). Each row is one `netgsm.voice.message.send` provider-delivery job; the
-- NetGSM bulk id and per-number report come back through provider attempts.
CREATE TABLE voice_messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  recipients JSONB NOT NULL CHECK (jsonb_typeof(recipients) = 'array' AND jsonb_array_length(recipients) BETWEEN 1 AND 500),
  recipient_count INTEGER NOT NULL CHECK (recipient_count BETWEEN 1 AND 500),
  message_text TEXT,
  audio_id TEXT,
  ringtime INTEGER NOT NULL DEFAULT 20 CHECK (ringtime BETWEEN 10 AND 30),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'dry_run')),
  bulk_id TEXT,
  error_message TEXT,
  request_id TEXT NOT NULL,
  job_id TEXT,
  report_request_id TEXT,
  report JSONB,
  report_checked_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT voice_messages_content CHECK (message_text IS NOT NULL OR audio_id IS NOT NULL)
);
CREATE INDEX voice_messages_created_at_idx ON voice_messages(created_at DESC, id DESC);
CREATE INDEX voice_messages_status_idx ON voice_messages(status);
CREATE INDEX voice_messages_bulk_id_idx ON voice_messages(bulk_id);
CREATE INDEX voice_messages_created_by_user_id_idx ON voice_messages(created_by_user_id);

-- Down Migration
DROP TABLE IF EXISTS voice_messages;
