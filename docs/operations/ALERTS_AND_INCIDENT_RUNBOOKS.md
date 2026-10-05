# Alerts And Incident Runbooks

Thresholds below are the production starting values. Change them only together with this document. Storage-specific alerts stay in `STORAGE_ALERTS_AND_INCIDENTS.md`; metric definitions are in `OBSERVABILITY.md`.

## Alert Thresholds

| Alert | Expression | For | Severity |
| --- | --- | --- | --- |
| QueueBacklogHigh | `sum by (queue) (queue_jobs{state=~"waiting\|delayed\|prioritized"}) > 500` | 10m | ticket |
| QueueBacklogCritical | same expression `> 2000`, or `provider-webhooks` waiting `> 200` | 5m | page |
| QueueStalled | `queue_jobs{state="waiting"} > 0` and `sum by (queue) (rate(queue_job_retries_total[10m]) + rate(queue_job_dead_letters_total[10m])) == 0` and no `active` jobs | 15m | page |
| DeadLettersIncreasing | `increase(queue_job_dead_letters_total[15m]) > 0` | 0m | ticket |
| DeadLettersBurst | `increase(queue_job_dead_letters_total[15m]) > 20` or `queue_jobs{state="failed"} > 500` | 0m | page |
| RetryStorm | `sum by (queue) (rate(queue_job_retries_total[5m])) > 1` | 10m | ticket |
| ProviderErrorRateHigh | `rate(provider_attempt_errors_total[5m]) / rate(provider_attempts_total[5m]) > 0.10` with at least 20 attempts in 5m | 10m | ticket |
| ProviderErrorRateCritical | same ratio `> 0.50` | 5m | page |
| ProviderLatencyHigh | `histogram_quantile(0.95, sum by (le, provider, operation) (rate(provider_attempt_duration_seconds_bucket[5m]))) > 5` | 15m | ticket |
| WebhookLatencyHigh | `histogram_quantile(0.95, sum by (le, provider) (rate(webhook_ingress_duration_seconds_bucket[5m]))) > 1` | 10m | page (Meta retries and disables slow webhooks) |
| WebhookErrors | `sum by (provider) (rate(webhook_ingress_duration_seconds_count{status=~"5.."}[5m])) > 0` | 5m | page |
| ApiErrorRate | `sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.02` | 10m | page |
| ApiLatencyHigh | `histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m]))) > 1.5` | 15m | ticket |
| ReadinessDegraded | `/health/ready` returns `503` on API or worker | 2 checks (1m) | page |
| DatabaseDown | `dependencies.database.status = "degraded"` on API or worker | 1m | page |
| RedisDown | worker `dependencies.redis.status = "degraded"` | 1m | page |
| RealtimeConnectionsDrop | `sum(realtime_socket_connections)` drops more than 50% versus 30 minutes ago during business hours | 5m | ticket |
| MetricsScrapeMissing | `up{job=~"api\|worker"} == 0` | 5m | page |
| DiskSpaceLow | host or volume free space `< 15%` (PostgreSQL, Redis AOF, Garage data) | 10m | page; `< 25%` ticket |
| BackupStale | newest verified PostgreSQL backup older than 26h, or `garage_backup_age_seconds > 93600` | 0m | page |
| MigrationRunStalled | during an approved run, `time() - migration_report_last_received_timestamp_seconds > 1800` | 0m | ticket |

## Common First Steps

1. Acknowledge the alert and open an incident note with the alert name, start time and deployed version tag.
2. Check `GET /health/live` and `GET /health/ready` for API and worker; record dependency `status`, `latency_ms`, `error`.
3. Pull structured logs for the window by `service`, `event`, `request_id`, `job_id`. Logs are already redacted; never paste raw provider payloads or tokens into the incident note.
4. Correlate: API `request_id` → queued `job_id` → `provider_attempt_id` (`pat_...`) in `provider_attempts`.

## Queue Backlog

1. Identify the queue from `queue_jobs{state="waiting"}` and compare with `active`.
2. If `active` is `0`: the worker is down or disconnected. Check worker `/health/ready`, container restarts and Redis.
3. If `active` equals worker concurrency for a long time: check `provider_attempt_duration_seconds` for slow providers; a slow provider holds slots.
4. Scale worker replicas or raise `WORKER_CONCURRENCY` only when the provider rate limit allows it.
5. Do not delete waiting jobs. Webhook jobs are the only copy of the provider event until processed.

## Dead Letters

1. List failed jobs for the queue (BullMQ failed set) and group by `failedReason` and provider.
2. Look up the matching `provider_attempts` rows (`retry_decision = 'dead_letter'`, `error_code`).
3. Fix the cause (credential rotation in admin settings, provider outage, contract change) before retrying.
4. Retry only idempotent jobs, or jobs with an `idempotency_key`. Non-idempotent provider calls (shipment create, invoice create, SMS send) must be checked against the provider before a manual retry.
5. Record retried and discarded job IDs in the incident note.

## Provider Error Rate Or Latency

1. Split by `provider` and `operation`; check `status_code` distribution in `provider_attempts` for the window.
2. `401/403`: credential or token expired. Rotate it through admin integration settings; the worker reloads on `settings.changed`.
3. `429`: lower concurrency or wait for the provider window; retries follow the configured backoff.
4. `5xx`/timeouts: provider outage. Keep retries running; if the outage exceeds the retry window, disable the live mode flag for that provider/account so jobs dead-letter predictably instead of hammering the provider.
5. Malformed response: capture the redacted `response_metadata` and open a contract issue; do not change the frozen contract during the incident.

## Webhook Latency Or Errors

1. Webhook ingress must answer fast; processing happens in the `provider-webhooks` queue. High ingress latency usually means database or Redis latency on the insert/enqueue path.
2. Check API readiness and `http_request_duration_seconds` for `/health/ready`.
3. Check signature failures (`4xx` on webhook routes) after a secret rotation; confirm the webhook signature settings in admin.
4. If Meta delivery is disabled because of slow answers, re-subscribe after recovery and replay missed events from the provider console.

## Database Down

1. Confirm with `/health/ready` on both API and worker; check PostgreSQL container/host, disk space and connection count.
2. Keep API and worker processes running; they recover when the database returns. Do not run migrations or the migrator during the incident.
3. If the database is lost, follow the backup restore procedure and record the recovery point.

## Redis Down

1. Worker readiness shows `dependencies.redis.status = "degraded"`; API webhook enqueue, Socket.IO fanout and rate limits are affected.
2. Redis is not a source of truth. Restart or fail over Redis; BullMQ jobs persisted in AOF resume automatically.
3. After recovery confirm `queue_jobs` drains and clients reconnect (`realtime_socket_connections` recovers).
4. Webhook requests rejected during the outage are retried by providers; verify with provider delivery logs.

## Disk Space And Backup Age

1. Disk: identify the volume (PostgreSQL, Redis, Garage). Free space by pruning old images and logs per the retention policy; never delete database WAL or Garage data blocks manually.
2. Backup stale: check the backup job logs, run a manual backup, then verify with a restore probe. Postpone deployments that include migrations until a fresh verified backup exists.
