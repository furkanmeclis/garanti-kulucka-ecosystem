-- Up Migration

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM migration_batches) THEN
    RAISE EXCEPTION 'Cannot add migration run manifests while migration_batches contains data';
  END IF;
  IF EXISTS (SELECT 1 FROM legacy_id_map) THEN
    RAISE EXCEPTION 'Cannot add migration run manifests while legacy_id_map contains data';
  END IF;
END
$$;

CREATE TABLE migration_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL UNIQUE,
  source_system TEXT NOT NULL,
  source_database_identity JSONB NOT NULL,
  table_snapshot JSONB NOT NULL,
  row_counts JSONB NOT NULL,
  batch_size BIGINT NOT NULL CHECK (batch_size > 0),
  mapping_catalog_version TEXT NOT NULL,
  plan_fingerprint TEXT NOT NULL,
  source_manifest_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT migration_runs_run_id_nonblank
    CHECK (btrim(run_id) <> ''),
  CONSTRAINT migration_runs_source_database_identity_object
    CHECK (jsonb_typeof(source_database_identity) = 'object'),
  CONSTRAINT migration_runs_table_snapshot_array
    CHECK (jsonb_typeof(table_snapshot) = 'array'),
  CONSTRAINT migration_runs_row_counts_array
    CHECK (jsonb_typeof(row_counts) = 'array')
);
CREATE INDEX migration_runs_source_manifest_hash_idx
  ON migration_runs(source_manifest_hash);

ALTER TABLE migration_batches
  ADD CONSTRAINT migration_batches_run_id_fkey
  FOREIGN KEY (run_id) REFERENCES migration_runs(run_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE legacy_id_map
  DROP CONSTRAINT legacy_id_map_source_target_role_key;
ALTER TABLE legacy_id_map
  ADD COLUMN run_id TEXT NOT NULL;
ALTER TABLE legacy_id_map
  ADD CONSTRAINT legacy_id_map_run_id_fkey
  FOREIGN KEY (run_id) REFERENCES migration_runs(run_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE legacy_id_map
  ADD CONSTRAINT legacy_id_map_run_source_target_role_key
  UNIQUE (run_id, source_system, source_table, source_id, target_table, mapping_role);
CREATE UNIQUE INDEX legacy_id_map_run_primary_target_key
  ON legacy_id_map(run_id, target_table, target_id)
  WHERE mapping_role = 'primary';

CREATE FUNCTION reject_migration_run_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'migration_runs rows are immutable';
END
$$;

CREATE TRIGGER migration_runs_immutable
BEFORE UPDATE OR DELETE ON migration_runs
FOR EACH ROW EXECUTE FUNCTION reject_migration_run_mutation();

-- Down Migration

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM migration_runs) THEN
    RAISE EXCEPTION 'Cannot drop migration run manifests while migration_runs contains data';
  END IF;
END
$$;

ALTER TABLE migration_batches
  DROP CONSTRAINT IF EXISTS migration_batches_run_id_fkey;
ALTER TABLE legacy_id_map
  DROP CONSTRAINT IF EXISTS legacy_id_map_run_source_target_role_key;
DROP INDEX IF EXISTS legacy_id_map_run_primary_target_key;
ALTER TABLE legacy_id_map
  DROP CONSTRAINT IF EXISTS legacy_id_map_run_id_fkey;
ALTER TABLE legacy_id_map
  DROP COLUMN IF EXISTS run_id;
ALTER TABLE legacy_id_map
  ADD CONSTRAINT legacy_id_map_source_target_role_key
  UNIQUE (source_system, source_table, source_id, target_table, mapping_role);
DROP TRIGGER IF EXISTS migration_runs_immutable ON migration_runs;
DROP FUNCTION IF EXISTS reject_migration_run_mutation();
DROP TABLE IF EXISTS migration_runs;
