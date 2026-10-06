-- Up Migration

ALTER TABLE shipments ADD COLUMN create_idempotency_key TEXT;
ALTER TABLE shipments ADD COLUMN payment_type TEXT
  CHECK (payment_type IS NULL OR payment_type IN ('cash_on_delivery', 'prepaid'));
ALTER TABLE shipments ADD COLUMN label_printed_at TIMESTAMPTZ;
ALTER TABLE shipments ADD COLUMN created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX shipments_create_idempotency_key_uidx
  ON shipments(create_idempotency_key)
  WHERE create_idempotency_key IS NOT NULL;
CREATE INDEX shipments_ptt_barcode_number_idx
  ON shipments(barcode_number text_pattern_ops)
  WHERE provider = 'ptt' AND barcode_number IS NOT NULL;

-- Down Migration
DROP INDEX IF EXISTS shipments_ptt_barcode_number_idx;
DROP INDEX IF EXISTS shipments_create_idempotency_key_uidx;
ALTER TABLE shipments DROP COLUMN IF EXISTS created_by_user_id;
ALTER TABLE shipments DROP COLUMN IF EXISTS label_printed_at;
ALTER TABLE shipments DROP COLUMN IF EXISTS payment_type;
ALTER TABLE shipments DROP COLUMN IF EXISTS create_idempotency_key;
