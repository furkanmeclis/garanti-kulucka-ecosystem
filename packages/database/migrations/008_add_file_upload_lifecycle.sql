-- Up Migration

ALTER TABLE files
  ADD COLUMN upload_status TEXT NOT NULL DEFAULT 'available',
  ADD COLUMN scan_status TEXT NOT NULL DEFAULT 'skipped',
  ADD COLUMN upload_type TEXT NOT NULL DEFAULT 'singlepart',
  ADD COLUMN multipart_upload_id TEXT,
  ADD COLUMN completed_at TIMESTAMPTZ,
  ADD COLUMN abandoned_at TIMESTAMPTZ,
  ADD CONSTRAINT files_upload_status_check CHECK (upload_status IN ('pending', 'available', 'abandoned')),
  ADD CONSTRAINT files_scan_status_check CHECK (scan_status IN ('pending', 'clean', 'infected', 'skipped')),
  ADD CONSTRAINT files_upload_type_check CHECK (upload_type IN ('singlepart', 'multipart'));

UPDATE files
SET completed_at = created_at
WHERE completed_at IS NULL
  AND upload_status = 'available';

CREATE INDEX files_upload_status_created_at_idx ON files(upload_status, created_at);
CREATE INDEX files_scan_status_idx ON files(scan_status);
CREATE INDEX files_multipart_upload_id_idx ON files(multipart_upload_id) WHERE multipart_upload_id IS NOT NULL;

-- Down Migration

ALTER TABLE files
  DROP CONSTRAINT IF EXISTS files_upload_type_check,
  DROP CONSTRAINT IF EXISTS files_scan_status_check,
  DROP CONSTRAINT IF EXISTS files_upload_status_check;

DROP INDEX IF EXISTS files_multipart_upload_id_idx;
DROP INDEX IF EXISTS files_scan_status_idx;
DROP INDEX IF EXISTS files_upload_status_created_at_idx;

ALTER TABLE files
  DROP COLUMN IF EXISTS abandoned_at,
  DROP COLUMN IF EXISTS completed_at,
  DROP COLUMN IF EXISTS multipart_upload_id,
  DROP COLUMN IF EXISTS upload_type,
  DROP COLUMN IF EXISTS scan_status,
  DROP COLUMN IF EXISTS upload_status;
