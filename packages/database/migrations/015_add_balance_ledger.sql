-- Up Migration

-- Legacy staff balance ledger and payment request parity (legacy supabase 004, 029, 035, 072, 073).
-- Append-only staff commission ledger: balance = SUM(amount) per user.
CREATE TABLE payment_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'seen', 'approved', 'rejected')),
  processed_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ,
  note TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payment_requests_user_id_created_at_idx ON payment_requests(user_id, created_at DESC);
CREATE INDEX payment_requests_status_idx ON payment_requests(status);

CREATE TABLE balance_movements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  payment_request_id BIGINT REFERENCES payment_requests(id) ON DELETE SET NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('commission', 'cancellation', 'return', 'payment', 'adjustment', 'rollback')),
  amount NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  description TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX balance_movements_user_id_created_at_idx ON balance_movements(user_id, created_at DESC);
CREATE INDEX balance_movements_order_id_idx ON balance_movements(order_id);
CREATE UNIQUE INDEX balance_movements_order_commission_idx ON balance_movements(order_id)
  WHERE kind = 'commission' AND order_id IS NOT NULL;

-- Down Migration
DROP TABLE IF EXISTS balance_movements;
DROP TABLE IF EXISTS payment_requests;
