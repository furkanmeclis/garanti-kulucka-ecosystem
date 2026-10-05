-- Up Migration

ALTER TABLE orders
  ADD COLUMN cargo_provider TEXT,
  ADD CONSTRAINT orders_cargo_provider_check CHECK (cargo_provider IS NULL OR cargo_provider IN ('ptt', 'surat'));

CREATE INDEX orders_cargo_provider_idx ON orders(cargo_provider) WHERE cargo_provider IS NOT NULL;

-- Down Migration

DROP INDEX IF EXISTS orders_cargo_provider_idx;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_cargo_provider_check,
  DROP COLUMN IF EXISTS cargo_provider;
