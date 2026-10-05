-- Up Migration

CREATE TABLE social_comments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  integration_account_id BIGINT REFERENCES integration_accounts(id) ON DELETE SET NULL,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook')),
  external_comment_id TEXT NOT NULL,
  media_id TEXT,
  post_id TEXT,
  username TEXT,
  text TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'manual', 'auto_replied', 'replied', 'deleted', 'hidden', 'error')),
  classification TEXT,
  classification_reason TEXT,
  confidence NUMERIC(4, 3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  ai_reply_draft TEXT,
  manual_reply TEXT,
  reply_type TEXT CHECK (reply_type IS NULL OR reply_type IN ('public', 'private')),
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, external_comment_id)
);
CREATE INDEX social_comments_status_received_at_idx ON social_comments(status, received_at DESC);
CREATE INDEX social_comments_platform_received_at_idx ON social_comments(platform, received_at DESC);
CREATE INDEX social_comments_integration_account_id_idx ON social_comments(integration_account_id);

CREATE TABLE social_comment_actions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  comment_id BIGINT NOT NULL REFERENCES social_comments(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('reply', 'private_reply', 'hide', 'delete', 'mark_manual')),
  idempotency_key TEXT NOT NULL UNIQUE,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(request_payload) = 'object'),
  job_id TEXT,
  queued BOOLEAN NOT NULL DEFAULT false,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX social_comment_actions_comment_id_idx ON social_comment_actions(comment_id, created_at DESC);
CREATE INDEX social_comment_actions_actor_user_id_idx ON social_comment_actions(actor_user_id);

-- Down Migration
DROP TABLE IF EXISTS social_comment_actions;
DROP TABLE IF EXISTS social_comments;
