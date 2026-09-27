# Naming And Schema Rules

## Identifier Rules

- Language: English
- Style: lowercase `snake_case`
- No quoted identifiers
- No Turkish table or column names
- No mixed casing
- No abbreviations unless established and documented

## Legacy To Canonical Examples

| Legacy | Canonical |
| --- | --- |
| `kullanicilar` | `users` |
| `roller` | `roles` |
| `musteriler` | `customers` |
| `siparisler` | `orders` |
| `siparis_kalemleri` | `order_items` |
| `konusmalar` | `conversations` |
| `mesajlar` | `messages` |
| `kargo_gonderimleri` | `shipments` |
| `kargo_takip` | `shipment_tracking_events` |
| `bakiye_hareketleri` | `balance_transactions` |
| `odeme_istekleri` | `payment_requests` |
| `teyit_aramalari` | `confirmation_calls` |
| `ayarlar` | `settings` |
| `islem_loglari` | `audit_logs` |
| `urunler` | `products` |
| `stok_hareketleri` | `stock_movements` |

## PostgreSQL Rules

- Prefer `bigint generated always as identity` for internal primary keys.
- Use `uuid` only for public opaque IDs, external correlation, or distributed merge requirements.
- Use `timestamptz`, never `timestamp without time zone`.
- Use `numeric` for money.
- Use `text` for strings; enforce limits with `check (length(column) <= n)` when needed.
- Add `not null` wherever semantically required.
- Add indexes for every foreign key column.
- Use `jsonb` for provider payload snapshots and optional dynamic settings only.
- Use lookup tables or text checks for evolving business statuses.

## Core Tables To Build

```text
users
roles
permissions
role_permissions
user_sessions
refresh_tokens
login_attempts
customers
customer_addresses
conversations
messages
message_attachments
orders
order_items
products
stock_movements
shipments
shipment_tracking_events
invoices
accounting_contacts
balance_transactions
payment_requests
integration_providers
integration_accounts
integration_tokens
integration_settings
webhook_subscriptions
webhook_events
files
audit_logs
settings
job_runs
legacy_id_map
```
