-- Up Migration

-- The orders list flags mükerrer orders by the customer's phone (last 10 digits) and name. These expression indexes
-- match DomainRepository.findDuplicateOrdersFor exactly, so the check reads only the customers that share a target's
-- phone tail or name instead of normalising every live order on each page load.
CREATE INDEX IF NOT EXISTS customers_phone_tail_idx
  ON customers ((right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)));
CREATE INDEX IF NOT EXISTS customers_name_key_idx
  ON customers ((lower(btrim(coalesce(full_name, '')))));

-- Down Migration
DROP INDEX IF EXISTS customers_name_key_idx;
DROP INDEX IF EXISTS customers_phone_tail_idx;
