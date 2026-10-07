-- Up Migration

-- Legacy DataDeletionPage (server.js POST /api/veri-silme-talebi + POST /api/facebook/data-deletion):
-- public KVKK / Meta data deletion requests. The legacy server wrote them to `veri_silme_talepleri`
-- and replied with a `DEL-...` reference; operators review and close them from the admin panel.
CREATE TABLE data_deletion_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  reference TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'form' CHECK (source IN ('form', 'facebook')),
  full_name TEXT,
  email TEXT,
  phone TEXT,
  instagram_username TEXT,
  messenger_psid TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'rejected')),
  resolution_note TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT data_deletion_requests_form_name CHECK (source <> 'form' OR full_name IS NOT NULL)
);
CREATE INDEX data_deletion_requests_status_idx ON data_deletion_requests(status, requested_at DESC);
CREATE INDEX data_deletion_requests_resolved_by_user_id_idx ON data_deletion_requests(resolved_by_user_id);

-- Down Migration
DROP TABLE IF EXISTS data_deletion_requests;
