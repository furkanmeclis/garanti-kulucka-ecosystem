-- Up Migration

CREATE TABLE customer_external_identities (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  integration_account_id BIGINT NOT NULL REFERENCES integration_accounts(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_external_identities_external_id_not_blank CHECK (length(trim(external_id)) > 0),
  CONSTRAINT customer_external_identities_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT customer_external_identities_account_external_id_key UNIQUE (integration_account_id, external_id),
  CONSTRAINT customer_external_identities_customer_account_key UNIQUE (customer_id, integration_account_id)
);
CREATE INDEX customer_external_identities_customer_id_idx
  ON customer_external_identities(customer_id);
CREATE INDEX customer_external_identities_integration_account_id_idx
  ON customer_external_identities(integration_account_id);

ALTER TABLE conversations
  ADD COLUMN integration_account_id BIGINT;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_integration_account_id_fkey
  FOREIGN KEY (integration_account_id)
  REFERENCES integration_accounts(id)
  ON DELETE SET NULL;
CREATE INDEX conversations_integration_account_id_idx
  ON conversations(integration_account_id);

DROP INDEX conversations_channel_external_thread_idx;
CREATE UNIQUE INDEX conversations_account_external_thread_idx
  ON conversations(integration_account_id, external_thread_id)
  WHERE integration_account_id IS NOT NULL AND external_thread_id IS NOT NULL;
CREATE UNIQUE INDEX conversations_accountless_channel_external_thread_idx
  ON conversations(channel, external_thread_id)
  WHERE integration_account_id IS NULL AND external_thread_id IS NOT NULL;

ALTER TABLE legacy_id_map
  ADD COLUMN mapping_role TEXT NOT NULL DEFAULT 'primary';
ALTER TABLE legacy_id_map
  DROP CONSTRAINT legacy_id_map_source_system_source_table_source_id_key;
ALTER TABLE legacy_id_map
  ADD CONSTRAINT legacy_id_map_source_target_role_key
  UNIQUE (source_system, source_table, source_id, target_table, mapping_role);

-- Down Migration

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM legacy_id_map
    GROUP BY source_system, source_table, source_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot restore legacy_id_map source-only uniqueness while multi-target mappings exist';
  END IF;
END
$$;

ALTER TABLE legacy_id_map
  DROP CONSTRAINT IF EXISTS legacy_id_map_source_target_role_key;
ALTER TABLE legacy_id_map
  ADD CONSTRAINT legacy_id_map_source_system_source_table_source_id_key
  UNIQUE (source_system, source_table, source_id);
ALTER TABLE legacy_id_map
  DROP COLUMN IF EXISTS mapping_role;

DROP INDEX IF EXISTS conversations_account_external_thread_idx;
DROP INDEX IF EXISTS conversations_accountless_channel_external_thread_idx;
CREATE UNIQUE INDEX conversations_channel_external_thread_idx
  ON conversations(channel, external_thread_id)
  WHERE external_thread_id IS NOT NULL;
DROP INDEX IF EXISTS conversations_integration_account_id_idx;
ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_integration_account_id_fkey;
ALTER TABLE conversations
  DROP COLUMN IF EXISTS integration_account_id;

DROP INDEX IF EXISTS customer_external_identities_integration_account_id_idx;
DROP INDEX IF EXISTS customer_external_identities_customer_id_idx;
DROP TABLE IF EXISTS customer_external_identities;
