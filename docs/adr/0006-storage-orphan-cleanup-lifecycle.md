# ADR 0006: Storage Orphan Cleanup Lifecycle

## Status

Accepted, amended by P9

## Context

Garage orphan object cleanup can delete object bytes while the canonical `files` row remains useful for audit, reconciliation, and restore evidence. The cleanup surface already requires admin authorization, a dry-run review, `confirmation: "delete_orphan_object"`, the `STORAGE_ORPHAN_DELETE_ENABLED` production gate, orphan eligibility recheck, and configured bucket matching.

The original decision kept orphan cleanup metadata-preserving and avoided lifecycle columns. P9 adds a separate requirement: multipart uploads must not expose metadata as available until Garage completion succeeds, abandoned pending uploads must become orphan candidates, and downloads need a malware-scan boundary.

## Decision

Keep orphan object cleanup metadata-preserving. The API and worker delete only the Garage object and keep the canonical `files` metadata row unchanged.

The operational lifecycle state is represented by:

- structured cleanup logs with `cleanup_request_id` and `result_code`;
- `storage_orphan_cleanup_apply_total` and `storage_orphan_cleanup_error_total` metrics;
- the preserved `files.bucket` and `files.object_key` metadata for backup restore and incident investigation.

Add upload and scan lifecycle columns to `files` for application availability, not deletion history:

- `upload_status`: `pending`, `available`, `abandoned`;
- `scan_status`: `pending`, `clean`, `infected`, `skipped`;
- `upload_type`: `singlepart`, `multipart`;
- `multipart_upload_id`, `completed_at`, `abandoned_at`.

Multipart upload rows start `pending` and become `available` only after the complete endpoint successfully completes Garage multipart upload. Aborted multipart rows become `abandoned`. Unattached abandoned rows and old pending rows are orphan candidates.

No real malware scanner is integrated in this phase. `scan_status` is a pluggable boundary; downloads are blocked unless status is `clean` or `skipped` is explicitly allowed by admin scan policy.

## Consequences

- Operators can reconcile, audit, and restore deleted orphan objects using preserved metadata.
- Cleanup does not imply application-level file deletion; it is an object-storage lifecycle operation.
- Upload availability is now explicit and can be queried without inferring from object existence.
- Future scanner integration can update `scan_status` without changing the download contract.
