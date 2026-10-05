# Migration Apply Runbook

`migrate --apply` is manual-only and fail-closed by default. Do not enable it from deployment defaults, scheduled jobs, or unattended scripts.

## 1. Backup

1. Confirm the source and target PostgreSQL URLs point to different databases.
2. Take a target database backup with the standard production backup process.
3. Store the backup artifact outside the target database host.
4. Write a local backup evidence file for the migrator operator.

Evidence file format:

```json
{
  "targetDatabaseIdentity": {
    "host": "target-db.example.internal",
    "port": "5432",
    "database": "garanti"
  },
  "createdAt": "2026-10-05T09:00:00.000Z"
}
```

`createdAt` must be newer than `MIGRATION_BACKUP_MAX_AGE_HOURS`; the default is `24`.

## 2. Dry-Run First

Run dry-run with the same source URL, batch size, conversation account snapshot, and user public id snapshot planned for apply.

```bash
SOURCE_DATABASE_URL=postgres://... \
MIGRATION_BATCH_SIZE=500 \
MIGRATION_CONVERSATION_ACCOUNTS_FILE=/secure/migration/conversation-accounts.json \
MIGRATION_USER_PUBLIC_IDS_FILE=/secure/migration/user-public-ids.json \
garanti-migrator migrate --dry-run --report-file /secure/migration/dry-run-report.json
```

Review the dry-run report before continuing.

The report includes the full secret-free migration result. Confirm inline media counts/decoded byte totals, customer resolution paths, shipment linkage counts, duplicate product warnings, and order total adjustment warnings before apply.

## 3. Apply

Apply requires both gates:

- `MIGRATION_APPLY_ENABLED=true`
- `MIGRATION_BACKUP_EVIDENCE=/path/to/readable/backup-evidence.json`

The command also refuses if the source and target database identities are the same. Gate failures occur before database connections are opened.

If the dry-run report contains inline `data:` message media, apply also requires Garage/S3-compatible storage configuration:

- `MIGRATION_MEDIA_S3_ENDPOINT`
- `MIGRATION_MEDIA_S3_ACCESS_KEY_ID`
- `MIGRATION_MEDIA_S3_SECRET_ACCESS_KEY`
- `MIGRATION_MEDIA_S3_BUCKET`
- optional `MIGRATION_MEDIA_S3_REGION`
- optional `MIGRATION_MEDIA_S3_PREFIX`

Missing storage configuration for a batch with inline media is fail-closed before that batch writes messages. The migrator uploads the decoded media, records a `files` row with checksum, size, MIME type, `upload_status=available`, and scan status, then links it through `message_attachments`.

```bash
SOURCE_DATABASE_URL=postgres://... \
TARGET_DATABASE_URL=postgres://... \
MIGRATION_RUN_ID=legacy-import-2026-10-05 \
MIGRATION_BATCH_SIZE=500 \
MIGRATION_APPLY_ENABLED=true \
MIGRATION_BACKUP_EVIDENCE=/secure/migration/backup-evidence.json \
MIGRATION_CONVERSATION_ACCOUNTS_FILE=/secure/migration/conversation-accounts.json \
MIGRATION_USER_PUBLIC_IDS_FILE=/secure/migration/user-public-ids.json \
garanti-migrator migrate --apply --report-file /secure/migration/apply-report.json
```

The apply command registers the run manifest, applies batches in dependency order, resumes completed batches by persisted state, runs deferred reconciliation, runs verification, and writes a secret-free operation report.

Order totals are authoritative from the legacy order row. If VAT-inclusive item totals differ, apply stores the difference in `orders.manual_adjustment_amount` and reports a warning; this is not a deferred reconciliation item.

## 4. Verify

Run verification again after apply:

```bash
TARGET_DATABASE_URL=postgres://... \
MIGRATION_RUN_ID=legacy-import-2026-10-05 \
garanti-migrator verify --report-file /secure/migration/verify-report.json
```

The report must pass before the target is promoted.

## 5. Rollback Or Forward-Fix

If verification fails before promotion, restore the backup and preserve the apply and verify reports.

If the target has already been promoted, do not re-run with a different `MIGRATION_RUN_ID` unless the incident owner approves it. Prefer a forward-fix using the same run evidence and keep the report files attached to the incident record.
