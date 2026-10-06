-- Up Migration

-- Legacy RaporlarPage filters every metric by the order creation time; the canonical
-- report aggregates run date-range scans on orders.created_at.
CREATE INDEX orders_created_at_idx ON orders(created_at);
CREATE INDEX shipments_order_id_created_at_idx ON shipments(order_id, created_at DESC)
  WHERE order_id IS NOT NULL;

-- Legacy /instagram/yayinla publish requests, recorded before the provider-delivery
-- `instagram.media.publish` job is queued so idempotent replays never enqueue twice.
CREATE TABLE instagram_publications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  account_id BIGINT REFERENCES integration_accounts(id) ON DELETE SET NULL,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('image', 'video')),
  media_type TEXT NOT NULL DEFAULT 'IMAGE' CHECK (media_type IN ('IMAGE', 'REELS', 'VIDEO')),
  media_url TEXT,
  file_id BIGINT REFERENCES files(id) ON DELETE SET NULL,
  caption TEXT NOT NULL DEFAULT '' CHECK (length(caption) <= 2200),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL,
  job_id TEXT,
  queued BOOLEAN NOT NULL DEFAULT false,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT instagram_publications_media_source CHECK (media_url IS NOT NULL OR file_id IS NOT NULL)
);
CREATE INDEX instagram_publications_created_at_idx ON instagram_publications(created_at DESC);
CREATE INDEX instagram_publications_request_id_idx ON instagram_publications(request_id);
CREATE INDEX instagram_publications_account_id_idx ON instagram_publications(account_id);
CREATE INDEX instagram_publications_file_id_idx ON instagram_publications(file_id);
CREATE INDEX instagram_publications_created_by_user_id_idx ON instagram_publications(created_by_user_id);

-- Down Migration
DROP TABLE IF EXISTS instagram_publications;
DROP INDEX IF EXISTS shipments_order_id_created_at_idx;
DROP INDEX IF EXISTS orders_created_at_idx;
