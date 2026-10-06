-- Up Migration

CREATE TABLE sms_templates (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK (length(btrim(title)) > 0),
  body TEXT NOT NULL CHECK (length(btrim(body)) > 0),
  sort_order INTEGER NOT NULL DEFAULT 99,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sms_templates_sort_order_idx ON sms_templates(sort_order, created_at);
CREATE INDEX sms_templates_created_by_user_id_idx ON sms_templates(created_by_user_id);

CREATE TABLE sms_messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  recipient_phone TEXT NOT NULL,
  customer_name TEXT,
  message TEXT NOT NULL,
  is_automatic BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  error_message TEXT,
  provider_bulk_id TEXT,
  shipment_id BIGINT REFERENCES shipments(id) ON DELETE SET NULL,
  tracking_number TEXT,
  template_id BIGINT REFERENCES sms_templates(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL,
  job_id TEXT,
  queued BOOLEAN NOT NULL DEFAULT false,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sms_messages_created_at_idx ON sms_messages(created_at DESC);
CREATE INDEX sms_messages_is_automatic_created_at_idx ON sms_messages(is_automatic, created_at DESC);
CREATE INDEX sms_messages_request_id_idx ON sms_messages(request_id);
CREATE INDEX sms_messages_shipment_id_idx ON sms_messages(shipment_id);
CREATE INDEX sms_messages_template_id_idx ON sms_messages(template_id);
CREATE INDEX sms_messages_actor_user_id_idx ON sms_messages(actor_user_id);

-- Down Migration
DROP TABLE IF EXISTS sms_messages;
DROP TABLE IF EXISTS sms_templates;
