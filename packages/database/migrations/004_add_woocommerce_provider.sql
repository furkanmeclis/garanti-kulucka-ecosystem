-- Up Migration

DO $$
DECLARE
  matching_rows INTEGER;
  existing_provider integration_providers%ROWTYPE;
BEGIN
  SELECT COUNT(*)
  INTO matching_rows
  FROM integration_providers
  WHERE key = 'woocommerce' OR public_id = 'prv_woocommerce';

  IF matching_rows = 0 THEN
    INSERT INTO integration_providers (public_id, key, name)
    VALUES ('prv_woocommerce', 'woocommerce', 'WooCommerce');
  ELSIF matching_rows = 1 THEN
    SELECT *
    INTO existing_provider
    FROM integration_providers
    WHERE key = 'woocommerce' OR public_id = 'prv_woocommerce';

    IF existing_provider.public_id IS DISTINCT FROM 'prv_woocommerce'
      OR existing_provider.key IS DISTINCT FROM 'woocommerce'
      OR existing_provider.name IS DISTINCT FROM 'WooCommerce'
      OR existing_provider.is_active IS DISTINCT FROM TRUE
    THEN
      RAISE EXCEPTION 'Existing WooCommerce provider does not match the canonical migration seed';
    END IF;
  ELSE
    RAISE EXCEPTION 'WooCommerce provider key and public id resolve to different rows';
  END IF;
END
$$;

-- Down Migration

-- Provider rows may predate this migration and may acquire direct or indirect
-- dependencies. Rollback intentionally leaves the validated seed in place.
DO $$
BEGIN
  NULL;
END
$$;
