-- Up Migration

ALTER TABLE migration_runs
  ADD COLUMN row_content_checksums JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT migration_runs_row_content_checksums_array
    CHECK (jsonb_typeof(row_content_checksums) = 'array');

-- Down Migration

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM migration_runs
    WHERE row_content_checksums <> '[]'::jsonb
  ) THEN
    RAISE EXCEPTION 'Cannot drop migration row content checksums while migration_runs contains row fingerprints';
  END IF;
END
$$;

ALTER TABLE migration_runs
  DROP CONSTRAINT IF EXISTS migration_runs_row_content_checksums_array,
  DROP COLUMN IF EXISTS row_content_checksums;
