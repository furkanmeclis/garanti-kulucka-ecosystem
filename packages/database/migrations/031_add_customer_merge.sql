-- Up Migration
-- One person can own several Messenger/Instagram identities on the same account.
-- External identity uniqueness remains account + external_id, so webhook resolution stays unambiguous.
ALTER TABLE customer_external_identities DROP CONSTRAINT customer_external_identities_customer_account_key;
CREATE INDEX customer_external_identities_customer_account_idx
  ON customer_external_identities(customer_id, integration_account_id);

-- Merged legacy customers legitimately have several primary source mappings to one target.
-- Keep every source mapping and its original role; other entity types retain target uniqueness.
DROP INDEX legacy_id_map_run_primary_target_key;
CREATE UNIQUE INDEX legacy_id_map_run_primary_target_key
  ON legacy_id_map(run_id, target_table, target_id)
  WHERE mapping_role = 'primary' AND target_table NOT IN ('customers', 'customer_addresses');

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX customers_merge_name_idx ON customers USING gin (lower(btrim(full_name)) gin_trgm_ops);

-- Down Migration
-- Refuse rollback if the live data cannot satisfy the old constraints.
ALTER TABLE customer_external_identities ADD CONSTRAINT customer_external_identities_customer_account_key
  UNIQUE (customer_id, integration_account_id);
DROP INDEX customer_external_identities_customer_account_idx;
DROP INDEX legacy_id_map_run_primary_target_key;
CREATE UNIQUE INDEX legacy_id_map_run_primary_target_key
  ON legacy_id_map(run_id, target_table, target_id) WHERE mapping_role = 'primary';
DROP INDEX customers_merge_name_idx;
