CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE roles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  key TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
  role_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX role_permissions_permission_id_idx ON role_permissions(permission_id);

CREATE TABLE users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  role_id BIGINT NOT NULL REFERENCES roles(id),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_online BOOLEAN NOT NULL DEFAULT false,
  last_seen_at TIMESTAMPTZ,
  sip_username TEXT,
  sip_password_encrypted TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_email_not_blank CHECK (length(trim(email)) > 0)
);
CREATE UNIQUE INDEX users_email_lower_idx ON users(lower(email));
CREATE INDEX users_role_id_idx ON users(role_id);
CREATE INDEX users_active_idx ON users(is_active);

CREATE TABLE user_sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT,
  ip_address TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX user_sessions_user_id_idx ON user_sessions(user_id);
CREATE INDEX user_sessions_expires_at_idx ON user_sessions(expires_at);

CREATE TABLE refresh_tokens (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  session_id BIGINT NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_session_id_idx ON refresh_tokens(session_id);
CREATE INDEX refresh_tokens_expires_at_idx ON refresh_tokens(expires_at);

CREATE TABLE login_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  success BOOLEAN NOT NULL,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email_created_at_idx ON login_attempts(email, created_at);

CREATE TABLE customers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  username TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customers_phone_idx ON customers(phone);
CREATE INDEX customers_email_lower_idx ON customers(lower(email)) WHERE email IS NOT NULL;
CREATE INDEX customers_username_idx ON customers(username);

CREATE TABLE customer_addresses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label TEXT,
  address_line TEXT NOT NULL,
  district TEXT,
  city TEXT,
  country TEXT NOT NULL DEFAULT 'TR',
  postal_code TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customer_addresses_customer_id_idx ON customer_addresses(customer_id);

CREATE TABLE conversations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  assigned_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'instagram', 'messenger', 'phone', 'manual')),
  external_thread_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  is_in_pool BOOLEAN NOT NULL DEFAULT false,
  human_agent_enabled BOOLEAN NOT NULL DEFAULT false,
  unread_count BIGINT NOT NULL DEFAULT 0,
  last_message_text TEXT,
  last_message_sender_type TEXT,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX conversations_customer_id_idx ON conversations(customer_id);
CREATE INDEX conversations_assigned_user_id_idx ON conversations(assigned_user_id);
CREATE INDEX conversations_channel_status_idx ON conversations(channel, status);
CREATE UNIQUE INDEX conversations_channel_external_thread_idx ON conversations(channel, external_thread_id) WHERE external_thread_id IS NOT NULL;

CREATE TABLE files (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  bucket TEXT NOT NULL,
  object_key TEXT NOT NULL,
  original_name TEXT,
  mime_type TEXT,
  byte_size BIGINT,
  checksum TEXT,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bucket, object_key)
);
CREATE INDEX files_created_by_user_id_idx ON files(created_by_user_id);

CREATE TABLE messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer', 'user', 'ai', 'system')),
  sender_name TEXT,
  body TEXT,
  external_message_id TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_id_sent_at_idx ON messages(conversation_id, sent_at);
CREATE UNIQUE INDEX messages_external_message_id_idx ON messages(external_message_id) WHERE external_message_id IS NOT NULL;

CREATE TABLE message_attachments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_id BIGINT NOT NULL REFERENCES files(id) ON DELETE RESTRICT,
  attachment_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX message_attachments_message_id_idx ON message_attachments(message_id);
CREATE INDEX message_attachments_file_id_idx ON message_attachments(file_id);

CREATE TABLE products (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  sku TEXT,
  name TEXT NOT NULL,
  category TEXT,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock_quantity BIGINT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  external_product_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX products_sku_idx ON products(sku) WHERE sku IS NOT NULL;
CREATE INDEX products_active_idx ON products(is_active);

CREATE TABLE orders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  conversation_id BIGINT REFERENCES conversations(id) ON DELETE SET NULL,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  order_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  source TEXT NOT NULL DEFAULT 'manual',
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'TRY',
  confirmation_status TEXT,
  notes TEXT,
  external_order_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX orders_customer_id_idx ON orders(customer_id);
CREATE INDEX orders_conversation_id_idx ON orders(conversation_id);
CREATE INDEX orders_created_by_user_id_idx ON orders(created_by_user_id);
CREATE INDEX orders_status_created_at_idx ON orders(status, created_at);

CREATE TABLE order_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  quantity BIGINT NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12,2) NOT NULL,
  total_amount NUMERIC(12,2) NOT NULL,
  external_product_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX order_items_order_id_idx ON order_items(order_id);
CREATE INDEX order_items_product_id_idx ON order_items(product_id);

CREATE TABLE shipments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('ptt', 'surat', 'manual')),
  tracking_number TEXT,
  barcode_number TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  recipient_name TEXT NOT NULL,
  recipient_phone TEXT,
  recipient_address TEXT NOT NULL,
  recipient_city TEXT,
  recipient_district TEXT,
  last_event_text TEXT,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX shipments_order_id_idx ON shipments(order_id);
CREATE INDEX shipments_customer_id_idx ON shipments(customer_id);
CREATE INDEX shipments_provider_status_idx ON shipments(provider, status);
CREATE INDEX shipments_tracking_number_idx ON shipments(tracking_number) WHERE tracking_number IS NOT NULL;

CREATE TABLE shipment_tracking_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  shipment_id BIGINT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  description TEXT,
  location TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX shipment_tracking_events_shipment_id_occurred_at_idx ON shipment_tracking_events(shipment_id, occurred_at);

CREATE TABLE integration_providers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE integration_accounts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  provider_id BIGINT NOT NULL REFERENCES integration_providers(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  external_account_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT integration_accounts_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX integration_accounts_provider_id_idx ON integration_accounts(provider_id);
CREATE UNIQUE INDEX integration_accounts_provider_external_id_idx ON integration_accounts(provider_id, external_account_id) WHERE external_account_id IS NOT NULL;

CREATE TABLE integration_tokens (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  account_id BIGINT NOT NULL REFERENCES integration_accounts(id) ON DELETE CASCADE,
  token_type TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  last_refreshed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX integration_tokens_account_id_idx ON integration_tokens(account_id);

CREATE TABLE integration_settings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  account_id BIGINT REFERENCES integration_accounts(id) ON DELETE CASCADE,
  provider_id BIGINT NOT NULL REFERENCES integration_providers(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  is_secret BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, account_id, key) NULLS NOT DISTINCT
);
CREATE INDEX integration_settings_account_id_idx ON integration_settings(account_id);
CREATE INDEX integration_settings_provider_id_idx ON integration_settings(provider_id);

CREATE TABLE webhook_subscriptions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  provider_id BIGINT NOT NULL REFERENCES integration_providers(id) ON DELETE CASCADE,
  account_id BIGINT REFERENCES integration_accounts(id) ON DELETE CASCADE,
  callback_path TEXT NOT NULL,
  verify_token_hash TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT webhook_subscriptions_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX webhook_subscriptions_provider_id_idx ON webhook_subscriptions(provider_id);
CREATE INDEX webhook_subscriptions_account_id_idx ON webhook_subscriptions(account_id);

CREATE TABLE webhook_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  provider_id BIGINT NOT NULL REFERENCES integration_providers(id) ON DELETE CASCADE,
  account_id BIGINT REFERENCES integration_accounts(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  external_event_id TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'received',
  payload_hash TEXT NOT NULL,
  raw_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX webhook_events_provider_id_idx ON webhook_events(provider_id);
CREATE INDEX webhook_events_account_id_idx ON webhook_events(account_id);
CREATE INDEX webhook_events_status_received_at_idx ON webhook_events(status, received_at);
CREATE UNIQUE INDEX webhook_events_provider_external_event_idx ON webhook_events(provider_id, external_event_id) WHERE external_event_id IS NOT NULL;

CREATE TABLE audit_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  old_value JSONB,
  new_value JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_actor_user_id_idx ON audit_logs(actor_user_id);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type, entity_id);
CREATE INDEX audit_logs_created_at_idx ON audit_logs(created_at);

CREATE TABLE settings (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  is_secret BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope, key)
);

CREATE TABLE job_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  queue_name TEXT NOT NULL,
  job_name TEXT NOT NULL,
  external_job_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts BIGINT NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}',
  error_message TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT job_runs_payload_object CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX job_runs_queue_status_idx ON job_runs(queue_name, status);
CREATE INDEX job_runs_external_job_id_idx ON job_runs(external_job_id) WHERE external_job_id IS NOT NULL;

CREATE TABLE legacy_id_map (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_system TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id TEXT NOT NULL,
  checksum TEXT,
  migrated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_system, source_table, source_id)
);
CREATE INDEX legacy_id_map_target_idx ON legacy_id_map(target_table, target_id);

INSERT INTO integration_providers (public_id, key, name)
VALUES
  ('prv_ptt', 'ptt', 'PTT Kargo'),
  ('prv_surat', 'surat', 'Surat Kargo'),
  ('prv_kolaybi', 'kolaybi', 'KolayBi'),
  ('prv_whatsapp', 'whatsapp', 'WhatsApp Cloud API'),
  ('prv_instagram', 'instagram', 'Instagram Graph API'),
  ('prv_messenger', 'messenger', 'Messenger Graph API'),
  ('prv_netgsm', 'netgsm', 'NetGSM'),
  ('prv_vapi', 'vapi', 'Vapi'),
  ('prv_sip', 'sip', 'SIP Webphone')
ON CONFLICT (key) DO NOTHING;
