# Object Storage Runbook

Garage is the supported S3-compatible object storage target for media files. MinIO is outside the production target.

## Runtime Configuration

- `S3_ENDPOINT`: Garage endpoint used by API presigned upload, download, and cleanup operations.
- `S3_REGION`: Garage signing region. The default is `garage`.
- `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`: application-scoped Garage credentials.
- `S3_BUCKET_MEDIA`: canonical media bucket. File cleanup apply rejects records from any other bucket.
- `S3_UPLOAD_URL_EXPIRES_SECONDS`: upload and download presigned URL expiry, clamped to 60-3600 seconds.
- `STORAGE_ORPHAN_DELETE_ENABLED`: production delete gate. The default is closed; set to `true` only during an approved cleanup window.

## Bucket And Prefix Policy

- Media objects use the canonical `media/YYYY/MM/DD/<file_public_id>/<slug>` prefix.
- Object keys are relative, single-slash, traversal-free paths enforced by the API.
- Tenant separation is modeled through the canonical database record and public ID prefix, not through ad hoc object key input from clients.
- Lifecycle age is managed as an operational policy setting and reviewed together with `/api/files/orphans` summary counts before cleanup.

## Orphan Cleanup Procedure

1. Confirm Garage backups are current and the restore probe below has passed for the target bucket.
2. Review orphan candidates with `GET /api/files/orphans?limit=100` as an admin.
3. For each candidate, call `POST /api/files/{file_public_id}/orphan-cleanup-dry-run` with a review reason. This returns the exact Garage `delete_object` action and performs no deletion.
4. During the approved window, set `STORAGE_ORPHAN_DELETE_ENABLED=true` on the API deployment and restart or roll the API instances.
5. Call `POST /api/files/{file_public_id}/orphan-cleanup` with `confirmation: "delete_orphan_object"`. The API rechecks that the file is still unattached, validates the bucket against `S3_BUCKET_MEDIA`, and then issues one Garage delete operation.
6. Set `STORAGE_ORPHAN_DELETE_ENABLED=false` immediately after the batch and roll API instances again.
7. Re-run `GET /api/files/orphans` and compare the summary count with the reviewed batch.

The API keeps canonical file metadata after object deletion. This preserves auditability and enables reconciliation against backups.

## Restore Probe

1. Select a non-customer test object under the media prefix.
2. Upload through `POST /api/files/uploads` and the returned presigned `PUT` instruction.
3. Download through `GET /api/files/{file_public_id}/download` and verify checksum/byte size.
4. Restore the object from the Garage backup path into the same bucket and key.
5. Repeat the download instruction and checksum verification.

## Observability

- Correlate API request ID, admin actor, file public ID, bucket, object key, cleanup request ID, and result code in structured JSON logs with `event: "storage.orphan_cleanup"`.
- The cleanup log fields are `request_id`, `actor_id`, `file_public_id`, `bucket`, `object_key`, `cleanup_request_id`, and `result_code`.
- Alert on any `storage_operation_disabled`, `storage_bucket_mismatch`, S3 `AccessDenied`, S3 timeout, or orphan cleanup apply failure.
- Track `storage_orphan_candidate_count`, `storage_orphan_cleanup_apply_total`, `storage_orphan_cleanup_error_total`, `garage_capacity_bytes`, and `garage_backup_age_seconds`.
- `garage_capacity_bytes` and `garage_backup_age_seconds` are externally scraped infrastructure gauges until Garage metrics and backup evidence are wired into an in-process source.
- Page the operator when disk free percentage drops below the production threshold or backup age exceeds the approved recovery point objective.

## Incident Response

1. Disable `STORAGE_ORPHAN_DELETE_ENABLED`.
2. Stop active cleanup batches and capture request IDs.
3. Use the preserved file metadata to identify affected bucket/key pairs.
4. Restore objects from Garage backup, then verify through presigned download.
5. Record impacted file public IDs, request IDs, backup source, restore timestamp, and verification checksums in the incident notes.
