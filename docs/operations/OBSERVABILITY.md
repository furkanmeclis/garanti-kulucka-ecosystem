# Observability: Metrics, Health And Readiness

API and worker expose Prometheus-compatible metrics (text exposition format `0.0.4`) through a dependency-free registry in `packages/shared/src/observability/metrics.ts`. Metric names, types and labels are frozen in `packages/shared/src/contracts/observability/runtime-metrics.ts` and `storage-metrics.ts`.

## Exposure And Protection

| Variable | Default | Meaning |
| --- | --- | --- |
| `METRICS_ENABLED` | `false` | `/metrics` answers `404` unless this is exactly `true`. |
| `METRICS_BEARER_TOKEN` | empty | When set, every scrape must send `Authorization: Bearer <token>`; wrong or missing token answers `401`. |
| `METRICS_PORT` | empty | Dedicated internal listener for `/metrics`. Without a token, metrics are served only on this listener and never on the public API port. |
| `METRICS_HOST` | `0.0.0.0` | Bind address of the API internal metrics listener. |
| `WORKER_HTTP_PORT` | `3001` | Worker health listener (`/health/live`, `/health/ready`, `/metrics`). It is never published to the host in `compose.yaml`. |
| `WORKER_HTTP_HOST` | `0.0.0.0` | Bind address of the worker health listener. |

Rules:

- With `METRICS_ENABLED=true` and no token and no `METRICS_PORT`, metrics stay disabled (fail closed).
- The public API port serves `/metrics` only with a bearer token.
- The internal port must stay on the private network (no ingress route, no host port mapping in production).

## Metric Catalog

| Metric | Type | Labels | Source |
| --- | --- | --- | --- |
| `http_requests_total` | counter | `method`, `route`, `status` | API (route is the Hono route pattern, `unmatched` for 404s, so IDs never become label values) |
| `http_request_duration_seconds` | histogram | `method`, `route`, `status` | API |
| `webhook_ingress_duration_seconds` | histogram | `provider`, `status` | API, `POST /webhooks/*` |
| `realtime_socket_connections` | gauge | none | API, Socket.IO engine client count per instance |
| `queue_jobs` | gauge | `queue`, `state` (`waiting`, `active`, `delayed`, `failed`, `prioritized`, `waiting-children`) | worker, collected from BullMQ at scrape time |
| `queue_job_retries_total` | counter | `queue` | worker, failed attempt with attempts remaining |
| `queue_job_dead_letters_total` | counter | `queue` | worker, attempts exhausted (job stays in the failed set) |
| `provider_attempts_total` | counter | `provider`, `operation`, `status` | worker, every persisted provider attempt |
| `provider_attempt_duration_seconds` | histogram | `provider`, `operation`, `status` | worker |
| `provider_attempt_errors_total` | counter | `provider`, `operation` | worker, `retryable_failure` + `terminal_failure` |
| `migration_rows` | gauge | `run_id`, `report_type`, `entity`, `state` (`planned`, `blocked`, `applied`, `inserted`) | worker, from `migration.report` jobs |
| `migration_report_last_received_timestamp_seconds` | gauge | `run_id`, `report_type` | worker |
| `storage_orphan_candidate_count` | gauge | `bucket` | worker reconciliation job |
| `storage_orphan_cleanup_apply_total` | counter | `bucket`, `result_code` | API admin cleanup and worker reconciliation |
| `storage_orphan_cleanup_error_total` | counter | `bucket`, `result_code` | API admin cleanup |
| `garage_capacity_bytes`, `garage_backup_age_seconds` | gauge | see storage contract | external scrape of Garage and backup tooling |

All series carry a `service` label (`api` or `worker`). Error rate per provider is `rate(provider_attempt_errors_total[5m]) / rate(provider_attempts_total[5m])`.

## Health, Readiness And Dependency Health

| Endpoint | API | Worker | Meaning |
| --- | --- | --- | --- |
| `GET /health/live` | yes | yes | Process is running and the event loop answers. Never checks dependencies; use for liveness probes and restarts. |
| `GET /health/ready` | yes | yes | Dependency readiness. `200` + `status: "ok"` only when every dependency is `ok`; otherwise `503` + `status: "degraded"`. Use for load balancer membership and rollout gates. |
| `dependencies.<name>` | `database` | `redis`, `database` | Per-dependency `status`, `latency_ms`, `error`. Worker probes have a 2 second timeout. |

A degraded readiness with healthy liveness means the dependency is the problem: do not restart the process in a loop, follow the dependency runbook in `ALERTS_AND_INCIDENT_RUNBOOKS.md`.

The worker container has a compose healthcheck on `/health/ready` through Node `fetch`; no extra binary is required in the image.
