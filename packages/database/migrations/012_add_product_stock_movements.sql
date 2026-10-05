-- Up Migration
ALTER TABLE products
  ADD COLUMN unit TEXT NOT NULL DEFAULT 'Adet',
  ADD COLUMN description TEXT;

ALTER TABLE products
  ADD CONSTRAINT products_stock_quantity_non_negative CHECK (stock_quantity >= 0) NOT VALID;

CREATE INDEX products_category_idx ON products(category);

CREATE TABLE stock_movements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('in', 'out', 'adjustment')),
  quantity BIGINT NOT NULL CHECK (quantity > 0),
  previous_quantity BIGINT NOT NULL,
  new_quantity BIGINT NOT NULL CHECK (new_quantity >= 0),
  notes TEXT,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX stock_movements_product_created_idx ON stock_movements(product_id, created_at DESC);
CREATE INDEX stock_movements_created_by_user_id_idx ON stock_movements(created_by_user_id);

-- Down Migration
DROP TABLE IF EXISTS stock_movements;
DROP INDEX IF EXISTS products_category_idx;
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_stock_quantity_non_negative;
ALTER TABLE products
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS unit;
