# Log Retention And Personal Data Policy

## Scope

Applies to API, worker and migrator structured logs (`createStructuredLog`), metrics, `provider_attempts`, `admin_audit` / integration audit rows, webhook event records and migrator reports.

## What Logs May Contain

- Correlation identifiers: `request_id`, `job_id`, webhook event ID, `provider_attempt_id`, public IDs (`usr_`, `cnv_`, `ord_`, ...).
- Operational fields: service, event name, queue, provider, operation, status code, duration, result code.
- No secrets, ever. `redactValue` removes passwords, tokens, authorization headers, cookies, connection strings, presigned URL query strings and provider secrets before logging or persisting attempt metadata. New log fields must go through the shared redaction helper.

## What Logs Must Not Contain

- Message bodies, customer names, phone numbers, e-mail addresses, postal addresses, national ID numbers, payment details or call recordings.
- Raw provider request/response bodies. Provider attempt metadata keeps redacted request shape and status, not customer content.
- Metric label values derived from personal data. Labels use route patterns, provider and queue names only; IDs never become label values.

When personal data is needed to debug, look it up in the database through the admin UI with an audited session instead of adding it to logs.

## Retention Periods

| Data | Location | Retention |
| --- | --- | --- |
| Application structured logs (API, worker) | log aggregation | 30 days hot, then deleted |
| Error and incident logs referenced in an incident note | incident archive | 1 year |
| Migrator logs and reports | migration archive (hashed manifest) | 2 years after cutover |
| Metrics | Prometheus | 30 days raw, 13 months downsampled |
| `provider_attempts` rows | PostgreSQL | 180 days |
| Webhook event records | PostgreSQL | 90 days after processing |
| Admin and integration audit rows | PostgreSQL | 2 years, append-only |
| BullMQ completed / failed jobs | Redis | last 500 completed / 1000 failed per queue (`removeOnComplete`, `removeOnFail`) |

Database-side pruning for `provider_attempts` and webhook event records is not automated yet; until the scheduled pruning job exists, operators run the pruning as a reviewed manual SQL change once per month.

Business records (customers, conversations, messages, orders, shipments, invoices) follow legal retention for commercial and tax records, not this log policy.

## Personal Data Rights (KVKK)

1. Access or deletion requests are handled on business records in PostgreSQL through the admin process, with an audit row.
2. Because logs and metrics do not hold personal data by design, they do not need per-person erasure; expiry by retention is sufficient.
3. If personal data is found in logs, treat it as an incident: restrict access, delete the affected log range in the aggregation store, fix the redaction gap with a test in `packages/shared` redaction tests, and record it.

## Access

- Log and metric access is limited to operators with production access; dashboards do not expose raw log lines to non-operators.
- `/metrics` is protected as described in `OBSERVABILITY.md`.
