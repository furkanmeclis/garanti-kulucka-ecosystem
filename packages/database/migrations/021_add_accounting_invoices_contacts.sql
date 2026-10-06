-- Up Migration

-- Legacy CariHesaplarPage / FaturaListPage / FaturaOlusturPage kept invoices and cari accounts only in
-- KolayBi. The canonical store keeps them locally; KolayBi sync runs through `provider-delivery` jobs
-- (live calls gated by providers.kolaybi.live_mode + account opt-in in the worker).
CREATE TABLE accounting_contacts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  contact_type TEXT NOT NULL DEFAULT 'individual' CHECK (contact_type IN ('individual', 'corporate')),
  name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  tax_number TEXT,
  tax_office TEXT,
  phone TEXT,
  email TEXT,
  address_line TEXT,
  district TEXT,
  city TEXT,
  country TEXT NOT NULL DEFAULT 'Türkiye',
  notes TEXT,
  kolaybi_contact_id TEXT UNIQUE,
  kolaybi_address_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local', 'queued', 'synced', 'failed')),
  sync_error TEXT,
  sync_request_id TEXT,
  sync_job_id TEXT,
  last_synced_at TIMESTAMPTZ,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX accounting_contacts_name_lower_idx ON accounting_contacts(lower(name));
CREATE INDEX accounting_contacts_phone_idx ON accounting_contacts(phone);
CREATE INDEX accounting_contacts_tax_number_idx ON accounting_contacts(tax_number);
CREATE INDEX accounting_contacts_sync_status_idx ON accounting_contacts(sync_status);
CREATE INDEX accounting_contacts_customer_id_idx ON accounting_contacts(customer_id);
CREATE INDEX accounting_contacts_created_by_user_id_idx ON accounting_contacts(created_by_user_id);

CREATE SEQUENCE invoice_number_seq START 1;

CREATE TABLE invoices (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  invoice_number TEXT NOT NULL UNIQUE,
  contact_id BIGINT NOT NULL REFERENCES accounting_contacts(id) ON DELETE RESTRICT,
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  invoice_type TEXT NOT NULL DEFAULT 'sale' CHECK (invoice_type IN ('sale', 'sale_return')),
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'partially_paid', 'paid', 'cancelled')),
  currency TEXT NOT NULL DEFAULT 'TRY',
  issue_date DATE NOT NULL,
  due_date DATE,
  description TEXT,
  subtotal NUMERIC(14, 2) NOT NULL CHECK (subtotal >= 0),
  vat_total NUMERIC(14, 2) NOT NULL CHECK (vat_total >= 0),
  grand_total NUMERIC(14, 2) NOT NULL CHECK (grand_total >= 0),
  paid_total NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (paid_total >= 0),
  kolaybi_invoice_id TEXT,
  e_document_status TEXT,
  sync_status TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local', 'queued', 'synced', 'failed')),
  sync_error TEXT,
  sync_request_id TEXT,
  sync_job_id TEXT,
  last_synced_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL UNIQUE,
  cancelled_at TIMESTAMPTZ,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX invoices_issue_date_idx ON invoices(issue_date DESC, id DESC);
CREATE INDEX invoices_contact_id_idx ON invoices(contact_id);
CREATE INDEX invoices_order_id_idx ON invoices(order_id);
CREATE INDEX invoices_status_idx ON invoices(status);
CREATE INDEX invoices_sync_status_idx ON invoices(sync_status);
CREATE INDEX invoices_created_by_user_id_idx ON invoices(created_by_user_id);

CREATE TABLE invoice_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES products(id) ON DELETE SET NULL,
  description TEXT NOT NULL CHECK (length(btrim(description)) > 0),
  quantity NUMERIC(12, 3) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL DEFAULT 'Adet',
  unit_price NUMERIC(14, 2) NOT NULL CHECK (unit_price >= 0),
  vat_rate NUMERIC(5, 2) NOT NULL DEFAULT 20 CHECK (vat_rate >= 0 AND vat_rate <= 100),
  line_subtotal NUMERIC(14, 2) NOT NULL,
  line_vat NUMERIC(14, 2) NOT NULL,
  line_total NUMERIC(14, 2) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX invoice_items_invoice_id_idx ON invoice_items(invoice_id, sort_order);
CREATE INDEX invoice_items_product_id_idx ON invoice_items(product_id);

CREATE TABLE invoice_payments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'bank_transfer' CHECK (method IN ('cash', 'bank_transfer', 'credit_card', 'other')),
  vault_id TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  sync_status TEXT NOT NULL DEFAULT 'local' CHECK (sync_status IN ('local', 'queued', 'synced', 'failed')),
  sync_error TEXT,
  sync_request_id TEXT,
  sync_job_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX invoice_payments_invoice_id_idx ON invoice_payments(invoice_id, paid_at);
CREATE INDEX invoice_payments_created_by_user_id_idx ON invoice_payments(created_by_user_id);

-- Down Migration
DROP TABLE IF EXISTS invoice_payments;
DROP TABLE IF EXISTS invoice_items;
DROP TABLE IF EXISTS invoices;
DROP SEQUENCE IF EXISTS invoice_number_seq;
DROP TABLE IF EXISTS accounting_contacts;
