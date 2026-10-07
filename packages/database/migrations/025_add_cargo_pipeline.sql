-- Up Migration

-- Legacy "Teslim Alınmayan Kargo Pipeline" (supabase 069 `kargo_pipeline_kuyrugu`): a shipment whose last carrier
-- event says the parcel was not collected walks mesaj → sms → vapi. The worker engine claims due rows with
-- FOR UPDATE SKIP LOCKED; `force_run` is the legacy `run_now` action (ignores working hours once).
CREATE TABLE cargo_pipeline_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  shipment_id BIGINT REFERENCES shipments(id) ON DELETE SET NULL,
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  conversation_id BIGINT REFERENCES conversations(id) ON DELETE SET NULL,
  vapi_call_id BIGINT REFERENCES vapi_calls(id) ON DELETE SET NULL,
  channel TEXT,
  phone TEXT,
  customer_name TEXT,
  tracking_number TEXT,
  cargo_provider TEXT,
  last_event_text TEXT,
  step TEXT NOT NULL DEFAULT 'mesaj' CHECK (step IN ('mesaj', 'sms', 'vapi', 'tamamlandi', 'teslim')),
  status TEXT NOT NULL DEFAULT 'bekliyor' CHECK (status IN ('bekliyor', 'isleniyor', 'tamamlandi', 'hata', 'iptal', 'teslim')),
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  force_run BOOLEAN NOT NULL DEFAULT false,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Legacy UNIQUE (kargo_id, siparis_id): one pipeline run per shipment.
  CONSTRAINT cargo_pipeline_items_shipment_id_key UNIQUE (shipment_id)
);
CREATE INDEX cargo_pipeline_items_due_idx ON cargo_pipeline_items(status, next_run_at);
CREATE INDEX cargo_pipeline_items_step_idx ON cargo_pipeline_items(step);
CREATE INDEX cargo_pipeline_items_created_at_idx ON cargo_pipeline_items(created_at DESC);
CREATE INDEX cargo_pipeline_items_order_id_idx ON cargo_pipeline_items(order_id);
CREATE INDEX cargo_pipeline_items_conversation_id_idx ON cargo_pipeline_items(conversation_id);
CREATE INDEX cargo_pipeline_items_vapi_call_id_idx ON cargo_pipeline_items(vapi_call_id);

-- Down Migration
DROP TABLE IF EXISTS cargo_pipeline_items;
