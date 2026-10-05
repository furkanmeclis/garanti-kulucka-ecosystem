# Storage Alerts And Incidents

This runbook covers production alerts for API readiness dependency health and Garage orphan cleanup failures.

## Alert Signals

| Signal | Source | Severity | Page condition |
| --- | --- | --- | --- |
| API readiness degraded | `GET /health/ready` | page | HTTP `503` or `status: "degraded"` for two consecutive checks |
| Database dependency degraded | `GET /health/ready` dependency detail | page | `dependencies.database.status: "degraded"` |
| Orphan cleanup apply failure | structured log `storage.orphan_cleanup` | page | `mode: "apply"` with `result_code` other than `deleted` during an approved cleanup window |
| Cleanup error total | `storage_orphan_cleanup_error_total` | page | any increase over 5 minutes |
| Cleanup apply volume | `storage_orphan_cleanup_apply_total` | ticket | unexpected apply count outside an approved cleanup window |
| Garage capacity | `garage_capacity_bytes{state="free"}` | page | below production free-space threshold |
| Garage backup age | `garage_backup_age_seconds` | page | above the approved recovery point objective |

## Dependency Health Response

1. Confirm the current `/health/ready` response and capture the `x-request-id` response header.
2. If only readiness is degraded and liveness remains healthy, keep the API deployment running while investigating the dependency.
3. Check database connectivity, migration status, connection pool saturation, and recent rollout events.
4. Pause cleanup, upload, and migration operations until readiness returns `200` with `status: "ok"`.
5. Record dependency status, latency, error text, deployment version, and request IDs in the incident notes.

## Storage Cleanup Failure Response

1. Set `STORAGE_ORPHAN_DELETE_ENABLED=false` and roll API instances.
2. Stop the cleanup batch and collect every `storage.orphan_cleanup` log for the affected `cleanup_request_id` values.
3. Group failures by `result_code`, bucket, and object key.
4. For `storage_bucket_mismatch`, do not retry until the file metadata and configured `S3_BUCKET_MEDIA` are reconciled.
5. For S3 access, timeout, or unknown errors, verify Garage health, credentials, and bucket policy before retrying.
6. Use preserved file metadata to restore or verify the affected objects from backups.
7. Re-run dry-run before any retry and keep apply enabled only for the approved window.

## Metric Contract

The shared metric contract lives in `packages/shared/src/contracts/observability/storage-metrics.ts`.

API-owned metrics:

- `storage_orphan_candidate_count{bucket}`: gauge from orphan candidate summary count.
- `storage_orphan_cleanup_apply_total{bucket,result_code}`: counter for controlled cleanup apply attempts that reached the delete gate.
- `storage_orphan_cleanup_error_total{bucket,result_code}`: counter for cleanup failures.

Externally scraped metrics:

- `garage_capacity_bytes{bucket,state}`: capacity/free/used bytes from Garage or infrastructure telemetry.
- `garage_backup_age_seconds{bucket}`: age of latest verified backup or restore probe evidence.
