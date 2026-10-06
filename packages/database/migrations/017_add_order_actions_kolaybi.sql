-- Up Migration

-- Legacy order actions parity (SiparislerPage detail/bulk actions, server.js KolayBi cari-olustur and
-- NetGSM siparis-arama routes, supabase 073). Orders are soft deleted so commission ledger rows keep
-- their order link; KolayBi ids, e-document state and confirmation call (IVR) state live on the order.
ALTER TABLE orders
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN deleted_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN kolaybi_contact_id TEXT,
  ADD COLUMN kolaybi_address_id TEXT,
  ADD COLUMN kolaybi_invoice_id TEXT,
  ADD COLUMN kolaybi_status TEXT,
  ADD COLUMN kolaybi_error TEXT,
  ADD COLUMN e_document_status TEXT,
  ADD COLUMN confirmation_call_status TEXT,
  ADD COLUMN confirmation_call_bulk_id TEXT,
  ADD COLUMN confirmation_pressed_key TEXT,
  ADD COLUMN confirmation_listen_seconds INTEGER,
  ADD COLUMN confirmation_call_count INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT orders_kolaybi_status_check CHECK (
    kolaybi_status IS NULL OR kolaybi_status IN ('contact_lookup', 'contact_create', 'invoice_create', 'completed', 'failed', 'cancelled')
  ),
  ADD CONSTRAINT orders_e_document_status_check CHECK (
    e_document_status IS NULL OR e_document_status IN ('queued', 'sent', 'cancel_queued', 'cancelled', 'failed')
  );

CREATE INDEX orders_deleted_at_idx ON orders(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX orders_deleted_by_user_id_idx ON orders(deleted_by_user_id);

-- Every provider job an order action enqueues (one row per atomic operation / workflow step).
CREATE TABLE order_provider_steps (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('kolaybi_transfer', 'e_document_create', 'e_document_cancel', 'invoice_get', 'confirmation_call', 'confirmation_status')),
  provider TEXT NOT NULL CHECK (provider IN ('kolaybi', 'netgsm')),
  operation TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'succeeded', 'failed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL UNIQUE,
  job_id TEXT,
  queued BOOLEAN NOT NULL DEFAULT false,
  request_payload JSONB NOT NULL DEFAULT '{}',
  result JSONB,
  error_message TEXT,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT order_provider_steps_request_payload_object CHECK (jsonb_typeof(request_payload) = 'object')
);
CREATE INDEX order_provider_steps_order_id_created_at_idx ON order_provider_steps(order_id, created_at DESC);
CREATE INDEX order_provider_steps_status_idx ON order_provider_steps(status) WHERE status = 'queued';
CREATE INDEX order_provider_steps_actor_user_id_idx ON order_provider_steps(actor_user_id);

-- Down Migration
DROP TABLE IF EXISTS order_provider_steps;
DROP INDEX IF EXISTS orders_deleted_by_user_id_idx;
DROP INDEX IF EXISTS orders_deleted_at_idx;
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_e_document_status_check,
  DROP CONSTRAINT IF EXISTS orders_kolaybi_status_check,
  DROP COLUMN IF EXISTS confirmation_call_count,
  DROP COLUMN IF EXISTS confirmation_listen_seconds,
  DROP COLUMN IF EXISTS confirmation_pressed_key,
  DROP COLUMN IF EXISTS confirmation_call_bulk_id,
  DROP COLUMN IF EXISTS confirmation_call_status,
  DROP COLUMN IF EXISTS e_document_status,
  DROP COLUMN IF EXISTS kolaybi_error,
  DROP COLUMN IF EXISTS kolaybi_status,
  DROP COLUMN IF EXISTS kolaybi_invoice_id,
  DROP COLUMN IF EXISTS kolaybi_address_id,
  DROP COLUMN IF EXISTS kolaybi_contact_id,
  DROP COLUMN IF EXISTS deleted_by_user_id,
  DROP COLUMN IF EXISTS deleted_at;
