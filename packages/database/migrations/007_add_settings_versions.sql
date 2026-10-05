-- Up Migration

CREATE TABLE settings_versions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  settings_id BIGINT NOT NULL REFERENCES settings(id) ON DELETE CASCADE,
  version_number BIGINT NOT NULL,
  value JSONB NOT NULL,
  is_secret BOOLEAN NOT NULL DEFAULT false,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT settings_versions_version_number_positive CHECK (version_number > 0),
  UNIQUE (settings_id, version_number)
);
CREATE INDEX settings_versions_settings_id_idx ON settings_versions(settings_id, version_number DESC);

CREATE TABLE integration_settings_versions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  integration_settings_id BIGINT NOT NULL REFERENCES integration_settings(id) ON DELETE CASCADE,
  version_number BIGINT NOT NULL,
  value JSONB NOT NULL,
  is_secret BOOLEAN NOT NULL DEFAULT false,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT integration_settings_versions_version_number_positive CHECK (version_number > 0),
  UNIQUE (integration_settings_id, version_number)
);
CREATE INDEX integration_settings_versions_setting_id_idx
  ON integration_settings_versions(integration_settings_id, version_number DESC);

-- Down Migration

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM settings_versions) THEN
    RAISE EXCEPTION 'Cannot drop settings versions while records exist';
  END IF;
  IF EXISTS (SELECT 1 FROM integration_settings_versions) THEN
    RAISE EXCEPTION 'Cannot drop integration settings versions while records exist';
  END IF;
END
$$;

DROP INDEX IF EXISTS integration_settings_versions_setting_id_idx;
DROP TABLE IF EXISTS integration_settings_versions;
DROP INDEX IF EXISTS settings_versions_settings_id_idx;
DROP TABLE IF EXISTS settings_versions;
