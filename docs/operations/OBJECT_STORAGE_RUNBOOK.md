# Object Storage Runbook

Garage is the supported S3-compatible object storage target for media files. MinIO is outside the production target.

## Runtime Configuration

- `S3_ENDPOINT`: Garage endpoint used by API presigned upload, download, and cleanup operations.
- `S3_REGION`: Garage signing region. The default is `garage`.
- `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`: application-scoped Garage credentials.
- `S3_BUCKET_MEDIA`: canonical media bucket. File cleanup apply rejects records from any other bucket.
- `S3_UPLOAD_URL_EXPIRES_SECONDS`: upload and download presigned URL expiry, clamped to 60-3600 seconds.
- `STORAGE_ORPHAN_DELETE_ENABLED`: production delete gate for API apply and worker reconciliation. The default is closed; set to `true` only during an approved cleanup window.
- `STORAGE_ORPHAN_RECONCILIATION_INTERVAL_MS`: BullMQ schedule interval for `storage.orphans.reconcile`; default `86400000`.
- `STORAGE_ORPHAN_RECONCILIATION_LIMIT`: maximum candidates per scheduled worker pass; default `100`.

Admin settings:

- `storage.upload_policy`: `{ allowed_content_types, max_upload_bytes, require_sha256_checksum }`. Presigned upload creation rejects disallowed MIME types, oversized files, and missing/invalid base64 SHA-256 checksums before signing Garage requests.
- `storage.malware_scan_policy`: `{ mode, allow_skipped_downloads }`. `mode: "skip"` marks new files as `skipped`; `mode: "manual"` leaves new files `pending` for a future scanner/manual updater.

## Bucket And Prefix Policy

- Media objects use the canonical `media/YYYY/MM/DD/<file_public_id>/<slug>` prefix.
- Object keys are relative, single-slash, traversal-free paths enforced by the API.
- Tenant separation is modeled through the canonical database record and public ID prefix, not through ad hoc object key input from clients.
- Lifecycle age is managed as an operational policy setting and reviewed together with `/api/files/orphans` summary counts before cleanup.
- Single-part uploads create an `available` metadata row because Garage does not call back after a raw presigned `PUT`.
- Multipart uploads create a `pending` metadata row. Only `POST /api/files/{file_public_id}/multipart-uploads/complete` completes Garage multipart upload and marks the row `available`; abort marks it `abandoned`.
- Downloads require `upload_status = available` and `scan_status = clean`, or `scan_status = skipped` when `storage.malware_scan_policy.allow_skipped_downloads` is true.
- No malware scanner is integrated in this phase. The scan status column is the application boundary for a future scanner.

## Orphan Cleanup Procedure

1. Confirm Garage backups are current and the restore probe below has passed for the target bucket.
2. Review orphan candidates with `GET /api/files/orphans?limit=100` as an admin.
3. For each candidate, call `POST /api/files/{file_public_id}/orphan-cleanup-dry-run` with a review reason. This returns the exact Garage `delete_object` action and performs no deletion.
4. During the approved window, set `STORAGE_ORPHAN_DELETE_ENABLED=true` on the API deployment and restart or roll the API instances.
5. Call `POST /api/files/{file_public_id}/orphan-cleanup` with `confirmation: "delete_orphan_object"`. The API rechecks that the file is still unattached, validates the bucket against `S3_BUCKET_MEDIA`, and then issues one Garage delete operation.
6. Set `STORAGE_ORPHAN_DELETE_ENABLED=false` immediately after the batch and roll API instances again.
7. Re-run `GET /api/files/orphans` and compare the summary count with the reviewed batch.

The API keeps canonical file metadata after object deletion. This preserves auditability and enables reconciliation against backups.

## Scheduled Orphan Reconciliation

The worker schedules `storage.orphans.reconcile` on the `storage-orphan-reconciliation` BullMQ queue.

- Default mode is report-only dry-run.
- If `STORAGE_ORPHAN_DELETE_ENABLED` is not `true`, even an `apply` payload returns `delete_disabled`.
- Candidates reuse the API orphan criteria: unattached `available` files, unattached `abandoned` uploads, and unattached `pending` uploads older than 24 hours.
- Worker results include candidate bucket/key/action summaries. Treat these as operational reports, not customer-facing deletion records.

## Restore Probe

1. Select a non-customer test object under the media prefix.
2. Upload through `POST /api/files/uploads` and the returned presigned `PUT` instruction.
3. Download through `GET /api/files/{file_public_id}/download` and verify checksum/byte size.
4. Restore the object from the Garage backup path into the same bucket and key.
5. Repeat the download instruction and checksum verification.

## Garage Backup And Restore Drill

Use the Garage admin host/container with the production `garage.toml`. Replace bucket/key paths before running commands.

Inspect cluster layout and bucket state:

```sh
garage status
garage layout show
garage bucket list
garage bucket info garanti-media
```

Take a metadata snapshot and object-data filesystem snapshot:

```sh
sudo systemctl stop garage
sudo tar -C /var/lib/garage -cpf /backups/garage-meta-$(date -u +%Y%m%dT%H%M%SZ).tar meta
sudo rsync -aHAX --delete /var/lib/garage/data/ /backups/garage-data/
sudo systemctl start garage
garage status
```

Restore to a drill node or empty replacement volume:

```sh
sudo systemctl stop garage
sudo rm -rf /var/lib/garage/meta /var/lib/garage/data
sudo tar -C /var/lib/garage -xpf /backups/garage-meta-YYYYMMDDTHHMMSSZ.tar
sudo rsync -aHAX /backups/garage-data/ /var/lib/garage/data/
sudo chown -R garage:garage /var/lib/garage
sudo systemctl start garage
garage status
garage bucket info garanti-media
```

Verify object restore through S3-compatible commands:

```sh
aws --endpoint-url "$S3_ENDPOINT" s3api head-object --bucket garanti-media --key media/YYYY/MM/DD/fil_example/probe.pdf
aws --endpoint-url "$S3_ENDPOINT" s3 cp s3://garanti-media/media/YYYY/MM/DD/fil_example/probe.pdf /tmp/probe.pdf
sha256sum /tmp/probe.pdf
```

Node-loss drill:

```sh
garage status
garage layout show
garage layout assign -z dc1 -c 1G <replacement-node-id>
garage layout apply --version <next-layout-version>
garage repair --all-nodes --yes
garage status
```

Record layout version, lost node ID, replacement node ID, repair start/end timestamps, affected bucket, sampled object keys, and checksum verification in the drill report.

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
