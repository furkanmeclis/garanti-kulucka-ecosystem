-- Up Migration

-- Legacy vapi_arama_kuyrugu: cargo-not-received customers waiting for a VAPI AI call.
CREATE TABLE vapi_call_queue (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  shipment_id BIGINT REFERENCES shipments(id) ON DELETE SET NULL,
  customer_phone TEXT NOT NULL CHECK (length(btrim(customer_phone)) > 0),
  customer_name TEXT,
  cargo_provider TEXT,
  tracking_number TEXT,
  last_event_text TEXT,
  status TEXT NOT NULL DEFAULT 'bekliyor' CHECK (status IN ('bekliyor', 'araniyor', 'tamamlandi', 'basarisiz')),
  priority INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  last_called_at TIMESTAMPTZ,
  idempotency_key TEXT,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX vapi_call_queue_status_priority_idx ON vapi_call_queue(status, priority DESC, created_at ASC);
CREATE INDEX vapi_call_queue_shipment_id_idx ON vapi_call_queue(shipment_id);
CREATE INDEX vapi_call_queue_actor_user_id_idx ON vapi_call_queue(actor_user_id);
-- Legacy merge-duplicates: one open queue row per shipment + phone.
CREATE UNIQUE INDEX vapi_call_queue_open_shipment_phone_idx
  ON vapi_call_queue(shipment_id, customer_phone)
  WHERE shipment_id IS NOT NULL AND status IN ('bekliyor', 'araniyor');

-- Legacy vapi_aramalar: one row per outbound VAPI call (queued through provider-delivery).
CREATE TABLE vapi_calls (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  queue_id BIGINT REFERENCES vapi_call_queue(id) ON DELETE SET NULL,
  shipment_id BIGINT REFERENCES shipments(id) ON DELETE SET NULL,
  vapi_call_id TEXT,
  customer_phone TEXT NOT NULL,
  customer_name TEXT,
  cargo_provider TEXT,
  tracking_number TEXT,
  last_event_text TEXT,
  status TEXT NOT NULL DEFAULT 'basladi' CHECK (status IN ('basladi', 'cevaplandi', 'cevapsiz', 'tamamlandi', 'hata', 'iptal')),
  summary TEXT,
  transcript JSONB,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  cost NUMERIC(12, 4),
  ended_reason TEXT,
  error_message TEXT,
  is_test BOOLEAN NOT NULL DEFAULT false,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL,
  job_id TEXT,
  queued BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vapi_calls_vapi_call_id_idx ON vapi_calls(vapi_call_id) WHERE vapi_call_id IS NOT NULL;
CREATE INDEX vapi_calls_started_at_idx ON vapi_calls(started_at DESC);
CREATE INDEX vapi_calls_status_started_at_idx ON vapi_calls(status, started_at DESC);
CREATE INDEX vapi_calls_request_id_idx ON vapi_calls(request_id);
CREATE INDEX vapi_calls_queue_id_idx ON vapi_calls(queue_id);
CREATE INDEX vapi_calls_shipment_id_idx ON vapi_calls(shipment_id);
CREATE INDEX vapi_calls_actor_user_id_idx ON vapi_calls(actor_user_id);

-- Down Migration
DROP TABLE IF EXISTS vapi_calls;
DROP TABLE IF EXISTS vapi_call_queue;
