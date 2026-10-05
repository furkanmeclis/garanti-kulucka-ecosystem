-- Up Migration

CREATE TABLE migration_deferred_reconciliations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL REFERENCES migration_runs(run_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  source_system TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_column TEXT NOT NULL,
  lookup_source_table TEXT NOT NULL,
  lookup_source_id TEXT NOT NULL,
  lookup_target_table TEXT NOT NULL,
  lookup_mapping_role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  resolved_target_id TEXT,
  resolved_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT migration_deferred_reconciliations_source_nonblank
    CHECK (btrim(source_system) <> '' AND btrim(source_table) <> '' AND btrim(source_id) <> ''),
  CONSTRAINT migration_deferred_reconciliations_target_nonblank
    CHECK (btrim(target_table) <> '' AND btrim(target_id) <> '' AND btrim(target_column) <> ''),
  CONSTRAINT migration_deferred_reconciliations_lookup_nonblank
    CHECK (
      btrim(lookup_source_table) <> ''
      AND btrim(lookup_source_id) <> ''
      AND btrim(lookup_target_table) <> ''
      AND btrim(lookup_mapping_role) <> ''
    ),
  CONSTRAINT migration_deferred_reconciliations_resolved_shape
    CHECK (
      (status = 'pending' AND resolved_target_id IS NULL AND resolved_at IS NULL)
      OR (status = 'resolved' AND resolved_target_id IS NOT NULL AND resolved_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX migration_deferred_reconciliations_lookup_key
  ON migration_deferred_reconciliations(
    run_id,
    source_system,
    source_table,
    source_id,
    target_table,
    target_id,
    target_column
  );
CREATE INDEX migration_deferred_reconciliations_pending_idx
  ON migration_deferred_reconciliations(run_id, status, lookup_target_table, lookup_mapping_role);
CREATE INDEX migration_deferred_reconciliations_lookup_map_idx
  ON migration_deferred_reconciliations(
    run_id,
    source_system,
    lookup_source_table,
    lookup_source_id,
    lookup_target_table,
    lookup_mapping_role
  );

-- Down Migration

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM migration_deferred_reconciliations) THEN
    RAISE EXCEPTION 'Cannot drop migration deferred reconciliations while records exist';
  END IF;
END
$$;

DROP INDEX IF EXISTS migration_deferred_reconciliations_lookup_map_idx;
DROP INDEX IF EXISTS migration_deferred_reconciliations_pending_idx;
DROP INDEX IF EXISTS migration_deferred_reconciliations_lookup_key;
DROP TABLE IF EXISTS migration_deferred_reconciliations;
