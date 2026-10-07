-- Up Migration

-- Legacy ResetPasswordPage used Supabase auth.resetPasswordForEmail. Here the API stores a single-use,
-- hashed token (1 hour) and queues an `smtp.email.send` provider-delivery job with the reset link; the
-- SMTP account (host / port / from / username + password token) lives in integration settings.
INSERT INTO integration_providers (public_id, key, name)
VALUES ('prv_smtp', 'smtp', 'SMTP E-posta')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE password_reset_tokens (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  requested_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_user_id_idx ON password_reset_tokens(user_id, created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS password_reset_tokens;
DELETE FROM integration_providers WHERE key = 'smtp' AND NOT EXISTS (SELECT 1 FROM integration_accounts WHERE integration_accounts.provider_id = integration_providers.id);
