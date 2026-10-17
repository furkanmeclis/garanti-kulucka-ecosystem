# Migration Apply Runbook

`migrate --apply` is manual-only and fail-closed by default. Do not enable it from deployment defaults, scheduled jobs, or unattended scripts.

## Progress Reports

Every `migrate --dry-run`, `migrate --apply` and `verify` command (passed or failed) also publishes its report to the worker's `migration-reports` queue as a `migration.report` job when `REDIS_URL` is set (compose sets it; `MIGRATION_REPORT_QUEUE_ENABLED=false` turns it off). The queued report holds only counts: per-entity planned / blocked / applied / inserted rows, totals and verification check names with pass/fail. Warnings, row data, URLs and identities stay in the `--report-file` output. The worker turns it into `migration_rows` and `migration_report_last_received_timestamp_seconds` (`OBSERVABILITY.md`), which drive the "Göç ve Depolama" dashboard and the `MigrationRunStalled` alert. Publishing is best effort: an unreachable Redis prints a warning and never changes the command result. `run_id` is `MIGRATION_RUN_ID`, or `dry-run-<timestamp>` for a dry-run without one.

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

`MIGRATION_CONVERSATION_ACCOUNTS_FILE` is the single integration account snapshot for both conversations and customer external identities. Its `instagram` and `messenger` entries are also the accounts that customer `ig_`/`fb_` identities resolve to (one active account per provider; `whatsapp` entries are not customer identities). The dry-run fails closed, exactly like apply, when any customer external identity has no active account for its provider; the error lists only the provider names and the unresolved count. A passed dry-run therefore always reports `customerTransform.unresolvedIdentities = 0`. Customers carrying `woocommerce_id` or `kolaybi_id` cannot be resolved through this file yet.

The report includes the full secret-free migration result. Confirm inline media counts/decoded byte totals, bridge `s3://` media counts per MIME (omitted without storage access), customer resolution paths, shipment linkage counts, duplicate product warnings, and order total adjustment warnings before apply.

## 3. Apply

Apply requires both gates:

- `MIGRATION_APPLY_ENABLED=true`
- `MIGRATION_BACKUP_EVIDENCE=/path/to/readable/backup-evidence.json`

The command also refuses if the source and target database identities are the same. Gate failures occur before database connections are opened.

### Message media (owner decision, Faz B)

Inline `data:` and bridge `s3://` message media are not migrated. Message apply never uploads, downloads or HEADs these files and does not require Garage/S3 configuration. No `files` or `message_attachments` rows are created for them. Text and timestamps remain, with a Turkish note appended on a new line: `📎 Görsel/Video/Ses kaydı/Belge (eski sistemden taşınmadı)` (only the note if the text is blank).

`raw_payload.media_omitted` preserves kind, MIME and inline decoded byte size, without base64 or the bridge URI. Bridge byte size is `null` because it is unavailable without accessing storage. Both live and fallback base64 fields are removed. http(s) URLs remain references only and are never downloaded. The checksum cache retains no message payloads. Dry-run keeps separate inline byte/MIME, bridge MIME/count and remote URL counters. Malformed bridge keys do not block omitted media.

This decision covers messages. The separate shortcut media migration retains its own storage requirements (Faz B exception).

### Synthetic order customers

A snapshot pre-pass groups unmatched orders by the last 10 phone digits, creating one customer per phone; orders without phone digits each get their own customer. Short legacy numbers retain their digits as the phone identity (the local copy has one nine-digit number). The latest order by legacy creation date supplies the name; distinct older names (case/whitespace insensitive) go into notes as `Eski siparişlerde geçen adlar: A, B`. The latest order containing address fields supplies the default address (`TR` country normalization). Equal timestamps break ties by legacy UUID.

Customers and addresses are written before their orders in the batch transaction. Dedicated `legacy_id_map` roles `synthetic_customer` and `synthetic_customer_address` use `phone:<last10>` as source identity (order UUID for phoneless orders), making reruns and resume idempotent. Review `orderTransform.syntheticCustomersFromOrders` (orders), `syntheticCustomers` (unique customers), `syntheticPhoneCustomers` and `syntheticPhonelessCustomers`. Expected local legacy snapshot: 2,379 orders → 2,271 customers (2,260 phones + 11 phoneless); 2,304 orders resolve by phone and 12 by customer ID.

Shipment reports expose `duplicateRowsDropped = duplicateRows + supersededInsertTimeRows` in dry-run and apply; reconcile `sourceRows = uniqueEvents + duplicateRowsDropped + futureDatedRows + undatedRows`.

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

### Split legacy threads (conversation merge)

Legacy `konusmalar` can hold several rows for one thread (same integration account and `kanal_konusma_id`, or same channel and thread for account-less conversations). The target allows one conversation per thread, so apply collapses each group into one conversation; this was decided in PR #7 (option 1, merge).

- Winner: most recent `son_mesaj_tarihi`, then `guncelleme_tarihi`, then `olusturma_tarihi`, then the greatest legacy id. Its status, pool, assignment and `last_message_*` are kept; `unread_count` is the sum over the group.
- Merged-away rows get no target row. Their legacy ids map to the winner with `legacy_id_map.mapping_role = 'merged_into'`; their messages and order links resolve to the winner. Every message keeps its own row and timestamp.
- Review `dryRunReport.conversationMerge` (groups, member rows, merged-away rows, per-channel counts, `groupsWithMultipleCustomers`, `messagesInMergedGroups`, `messagesReassigned`) before apply. Merging never blocks the dry-run. The apply report repeats the group counts under `migration.conversationMerge`.
- Verify expects `conversations source rows = migrated conversations + merged-away rows`, and checks `legacy_id_map.merged_conversations` (every merged-away row points at a migrated conversation of the same run).
- The plan is deterministic for a source snapshot, so a resumed or repeated apply with the same `MIGRATION_RUN_ID` lands on the same winners.

Pass the same `MIGRATION_CONVERSATION_ACCOUNTS_FILE` used for the dry-run; without it apply stops at the first customer batch that carries an external identity.

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

## Shortcut media and communication history

`kisayollar`, `sms_gonderimler`, and `vapi_aramalar` are included in the canonical migration plan. Review `dryRunReport.communicationTransforms` before apply. The exact observed status maps are SMS `basarili → sent` and VAPI `basladi → basladi`; an unknown/null status stops migration. These are historical rows with `queued=false`, so migration does not send SMS or initiate calls. Optional shipment links resolve through the same run's primary `legacy_id_map`; unresolved links stay null and are counted (`unresolvedShipments` in dry-run, `unresolved_optional_shipment` warnings in apply). There is no SMS customer FK in the current target schema.

Shortcut media is the sole exception to the Faz B decision to leave legacy message media behind. Dry-run never downloads public files or contacts object storage. Apply requires the existing `MIGRATION_MEDIA_S3_*` settings when any shortcut media is present; it validates/prepares every media item before writing that batch. Keep access to the three legacy public files or an HTTPS backup available until apply succeeds. `MIGRATION_SHORTCUT_MEDIA_BASE_URL` can point to a backup origin/base path; the original `/storage/v1/object/public/<bucket>/<path>` is appended. Redirects are rejected, downloads time out after 30 seconds and are capped at 25 MiB. HTTP overrides are accepted only on loopback for offline tests.

Objects follow the API convention `media/YYYY/MM/DD/fil_…/<sanitized-filename>` using the source creation date, deterministic file ids and SHA-256 checksum. Shortcut object keys do not use `MIGRATION_MEDIA_S3_PREFIX`. HEAD checks existence/size before PUT; retries after a DB rollback reuse the same object. Verify checks primary and media/attachment id maps, file availability/checksum/size and shortcut attachment references. Seeded `msc_default_*` shortcuts with matching codes are updated in place; a collision with an operator-created shortcut stops apply.

Reference local snapshot (2026-10-17): 53 shortcuts (6 inactive), 7 inline files / 2,254,896 decoded bytes, 3 public URLs; 270 SMS / 21 VAPI calls. All 266 non-null SMS shipment ids exist in the source; VAPI shipment ids are all null. The remaining SMS rows have no shipment id.

## Call history and temporary snapshot disk

Legacy `arama_kayitlari` is included as `call_logs` (local snapshot: 192 rows, 74 answered / 118 failed). Review `dryRunReport.communicationTransforms.call_logs`, especially unresolved optional users/orders/customers. User IDs use the same `MIGRATION_USER_PUBLIC_IDS_FILE` prepared before apply; order IDs resolve through the current run's order id-map. Customer phones must match uniquely by last ten digits. Unresolved optional links stay null and are counted. Unknown direction/status values stop migration. The original row, including notes, is preserved in `raw_payload`; no calls or notification jobs are initiated.

Apply now reads each planned legacy batch once and replays it from a private temporary snapshot after manifest validation. Provide local temporary disk (`TMPDIR`/container temp volume) for the raw JSON snapshot, including inline base64, even though message media is omitted from the target. Temporary directories are `migrator-snapshot-*`, private to the migrator, and removed on success or caught failure. After a process kill or host crash, remove abandoned directories as they contain source data. Dry-run only spools digest tuples, without row payloads. Persistent batch offsets and manifest hashing are unchanged; runtime cursors are separate metadata.
