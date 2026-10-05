-- Up Migration

ALTER TABLE orders
  ADD COLUMN manual_adjustment_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Down Migration

ALTER TABLE orders
  DROP COLUMN IF EXISTS manual_adjustment_amount;
